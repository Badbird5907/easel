/* global __dirname */
/** Production modules, fail-closed synthetic native/storage/queue/mutation/picker/upload
 * boundaries. Hook effects commit after rendering; no React Compiler/native acceptance.
 * Already-started requests cannot be rolled back by these UI lifetime guards. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { MutationObserver, QueryClient } = require('@tanstack/query-core');
let observerMode = false;
const root = path.resolve(__dirname, '../..');
const baseline = require('./submission-comments.baseline.json');
const unexpected = [],
  calls = [],
  queues = new Map(),
  cache = new Map();
const fail = (name) => {
  unexpected.push(name);
  throw Error('Unexpected boundary: ' + name);
};
const boundary =
  (name) =>
  (...args) => {
    calls.push([name, ...args]);
    const queue = queues.get(name);
    if (!queue?.length) return fail(name);
    return queue.shift()(...args);
  };
const allow = (name, value) => {
  if (!queues.has(name)) queues.set(name, []);
  queues.get(name).push(typeof value === 'function' ? value : () => value);
};
const strict = (name, values) =>
  new Proxy(values, {
    get(o, k) {
      if (k === '__esModule') return false;
      if (k in o) return o[k];
      return fail(name + '.' + String(k));
    },
  });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
let scope;
const effect = (kind) => (fn, deps) => {
  const s = scope,
    i = s.cursor++,
    old = s.slots[i];
  if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
    const next = { deps, cleanup: null };
    s.slots[i] = next;
    s[kind].push(() => {
      old?.cleanup?.();
      next.cleanup = fn();
    });
  }
};
const react = {
  useState(initial) {
    const s = scope,
      i = s.cursor++;
    if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [
      s.slots[i],
      (value) => {
        if (!s.mounted) return fail('setState after unmount');
        const next = typeof value === 'function' ? value(s.slots[i]) : value;
        if (!Object.is(next, s.slots[i])) {
          s.slots[i] = next;
          s.dirty = true;
        }
      },
    ];
  },
  useRef(initial) {
    const s = scope,
      i = s.cursor++;
    if (!(i in s.slots)) s.slots[i] = { current: initial };
    return s.slots[i];
  },
  useMemo(fn, deps) {
    const s = scope,
      i = s.cursor++,
      old = s.slots[i];
    if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) s.slots[i] = { deps, value: fn() };
    return s.slots[i].value;
  },
  useCallback(fn, deps) {
    return react.useMemo(() => fn, deps);
  },
  useEffect: effect('effects'),
  useLayoutEffect: effect('layouts'),
  useSyncExternalStore(_subscribe, snapshot) {
    return snapshot();
  },
};
function mount(fn, initial) {
  let props = initial;
  const s = { cursor: 0, slots: [], layouts: [], effects: [], mounted: true, dirty: false };
  const h = {
    renderOnly(...args) {
      if (args.length) props = args[0];
      const old = scope;
      scope = s;
      s.cursor = 0;
      s.dirty = false;
      try {
        return fn(props);
      } finally {
        scope = old;
      }
    },
    commit() {
      for (const key of ['layouts', 'effects']) while (s[key].length) s[key].shift()();
    },
    render(...args) {
      let tree = h.renderOnly(...args);
      h.commit();
      let limit = 15;
      while (s.dirty) {
        assert.ok(limit--);
        tree = h.renderOnly();
        h.commit();
      }
      return tree;
    },
    unmount() {
      for (const slot of s.slots) slot?.cleanup?.();
      s.mounted = false;
    },
  };
  return h;
}
const jsx = (type, props, key) => ({ type, props, key });
const elements = (names) => Object.fromEntries(names.split(' ').map((n) => [n, n]));

// In-memory filesystem/kv only. Unexpected imports, HTTP, native calls and feedback fail closed.
const disk = new Map(),
  dirs = new Set(),
  kv = new Map(),
  cleanups = [];
let storageFailure = false,
  online = true,
  forcedUnloaded = false,
  uuid = 0;
const uri = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
class Directory {
  constructor(...parts) {
    this.uri = uri(parts);
    assert.ok(this.uri.startsWith('synthetic://documents/'));
  }
  get exists() {
    return dirs.has(this.uri);
  }
  create() {
    calls.push(['mkdir', this.uri]);
    dirs.add(this.uri);
  }
  delete() {
    calls.push(['deleteDir', this.uri]);
    dirs.delete(this.uri);
    for (const k of disk.keys()) if (k.startsWith(this.uri + '/')) disk.delete(k);
  }
}
class File {
  constructor(...parts) {
    this.uri = uri(parts);
    assert.ok(this.uri.startsWith('synthetic://documents/'));
  }
  get exists() {
    return disk.has(this.uri);
  }
  textSync() {
    assert.ok(disk.has(this.uri));
    return disk.get(this.uri);
  }
  writeSync(v) {
    calls.push(['write', this.uri, v]);
    if (storageFailure) throw Error('synthetic disk full');
    disk.set(this.uri, v);
  }
  delete() {
    calls.push(['delete', this.uri]);
    disk.delete(this.uri);
  }
}
const clientA = Object.freeze({ id: 'clientA' }),
  clientB = Object.freeze({ id: 'clientB' });
let account = { id: 'accountA' },
  client = clientA;
const slots = new Map();
const uploadsFor = (key) => slots.get(key) ?? [];
const commentSlot = (a, c, s) => `comment|${a}|${c}|${s}`;
const summarize = (items) => ({
  uploading: items.filter((i) => i.status === 'uploading').length,
  failed: items.filter((i) => i.status === 'error').length,
  fileIds: items.filter((i) => i.status === 'done' && i.uploaded).map((i) => i.uploaded.id),
});
let pickerOptions;
const persistentNotice = Object.freeze({
  tone: 'warning',
  title: 'RAW notice العربية',
  body: 'RAW body',
});
class CanvasNetworkError extends Error {}
const mocks = {
  react: strict('react', react),
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': strict('native', {
    View: 'View',
    AccessibilityInfo: { announceForAccessibility: boundary('announce') },
  }),
  'lucide-react-native': strict('icons', elements('Mic Paperclip SendHorizontal')),
  'expo-file-system': strict('filesystem', {
    File,
    Directory,
    Paths: { document: 'synthetic://documents' },
  }),
  'expo-crypto': { randomUUID: () => String(++uuid) },
  '@/canvas/session': strict('session', {
    useCanvas: () => ({ account, client }),
    registerAccountCleanup: (fn) => cleanups.push(fn),
    loadStoredClients: boundary('loadClients'),
  }),
  '@/canvas/client': {
    CanvasNetworkError,
    CanvasError: class extends Error {},
    CanvasAuthError: class extends Error {},
  },
  '@/canvas/api/submissions': {
    commentFilesPath: (c, a) => `/courses/${c}/assignments/${a}/comments/files`,
    useAddSubmissionComment: (c, a) => {
      const target = { accountId: account.id, client, courseId: c, assignmentId: a };
      if (observerMode) {
        const queryClient = react.useMemo(() => new QueryClient(), []);
        const options = {
          gcTime: Infinity,
          networkMode: 'always',
          mutationFn: (input) => boundary('post')(target, input),
          onSuccess: (result) => boundary('cacheSuccess')(target, result),
        };
        const observer = react.useMemo(() => new MutationObserver(queryClient, options), []);
        react.useEffect(() => {
          observer.setOptions(options);
        }, [observer, options]);
        const result = observer.getCurrentResult();
        return { ...result, mutateAsync: result.mutate };
      }
      return {
        isPending: false,
        reset: boundary('resetObserver'),
        mutateAsync: (input) => boundary('post')(target, input),
      };
    },
  },
  '@/canvas/api/submissionDrafts': strict('draftAPI', {
    fetchSubmissionDraft: boundary('fetchDraft'),
    saveSubmissionDraft: boundary('saveDraft'),
    deleteSubmissionDraft: boundary('deleteDraft'),
  }),
  '@/features/offline/useOnline': { useOnline: () => online },
  '@/features/offline/connectivity': strict('connectivity', {
    isOnline: () => online,
    reportReachable: boundary('reachable'),
    noteRequestError: boundary('requestError'),
  }),
  '@/features/offline/kv': {
    offlineKv: {
      getItemSync: (key) => kv.get(key) ?? null,
      setItemSync: (key, v) => {
        calls.push(['kv', key, v]);
        kv.set(key, v);
      },
      removeItemSync: (key) => {
        calls.push(['kvDelete', key]);
        kv.delete(key);
      },
    },
  },
  '@/design': strict('design', {
    ...elements('Button Callout IconButton Text TextField'),
    haptics: { success: boundary('success'), error: boundary('error') },
  }),
  '@/features/submissions/AudioRecorderSheet': { AudioRecorderSheet: 'AudioRecorderSheet' },
  '@/features/submissions/UploadList': { UploadList: 'UploadList' },
  '@/features/submissions/useAddFiles': {
    useAddFiles: (options) => {
      pickerOptions = options;
      return {
        open: boundary('picker'),
        dismiss: boundary('dismiss'),
        notice: persistentNotice,
        sheet: 'RAW sheet',
      };
    },
  },
  '@/features/submissions/uploadStore': strict('uploads', {
    commentSlot,
    summarize,
    uploadsFor,
    useUploads: uploadsFor,
    addUploads: boundary('addUploads'),
    removeUpload: (slot, id) => {
      boundary('remove')(slot, id);
      slots.set(
        slot,
        uploadsFor(slot).filter((i) => i.id !== id),
      );
    },
  }),
};
const allowed = new Set([
  'features/submissions/CommentComposer',
  'features/submissions/drafts',
  'features/submissions/draftState',
  'features/submissions/draftPresentation',
  'features/offline/submissionDrafts',
  'features/offline/queue',
  'features/offline/store',
  'i18n',
  'i18n/runtime',
  'i18n/en',
  'i18n/fr',
  'i18n/ar',
]);
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mocks[key]) return mocks[key];
  if (!key.startsWith('@/') || !allowed.has(key.slice(2))) return fail('import ' + key);
  const file = ['.ts', '.tsx', '/index.ts']
    .map((e) => path.join(root, key.slice(2)) + e)
    .find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: (n) => load(n, file),
    Intl,
    Date,
    Error,
    console,
    fetch: () => fail('fetch'),
    setTimeout: () => {
      calls.push(['timer']);
      return 1;
    },
    clearTimeout: () => {
      calls.push(['clearTimer']);
    },
  });
  new vm.Script(js, { filename: file }).runInContext(context);
  return module.exports;
}
// Normalize realm prototypes only; leaves production object identity available to strict tests.
const plain = (value) => JSON.parse(JSON.stringify(value));
const equal = (actual, expected) => assert.deepEqual(plain(actual), plain(expected));
const nodes = (t) =>
  !t || typeof t !== 'object'
    ? []
    : Array.isArray(t)
      ? t.flatMap(nodes)
      : [t, ...nodes(t.props?.children)];
const all = (t, type) => nodes(t).filter((n) => n.type === type);
const i18n = load('@/i18n/runtime');
const drafts = load('@/features/submissions/drafts');
const state = load('@/features/submissions/draftState');
const sync = load('@/features/offline/submissionDrafts');
const queue = load('@/features/offline/queue');
mocks['@/features/submissions/drafts'] = {
  useDraft: (...args) => {
    const result = drafts.useDraft(...args);
    return forcedUnloaded ? { ...result, loaded: false } : result;
  },
};
const { CommentComposer } = load('@/features/submissions/CommentComposer');
const langs = ['en', 'fr', 'ar'];
const view = (locale) => {
  i18n.setAccountLocale('view', locale);
  return i18n.createTranslator(locale);
};
const quiet = (fn) => {
  const n = calls.length;
  const result = fn();
  assert.equal(calls.length, n, 'presentation has no side effects');
  return result;
};
const assertQueues = () => {
  equal(unexpected, []);
  for (const [name, q] of queues) assert.equal(q.length, 0, 'unconsumed ' + name);
};
const base = { courseId: 'c', assignmentId: 'a', attempt: 3 };
const target = (p = base) => ({
  accountId: account.id,
  courseId: p.courseId,
  assignmentId: p.assignmentId,
  attempt: p.attempt ?? 0,
});
const slot = (p = base) => commentSlot(account.id, p.courseId, p.assignmentId);
const item = (id, status = 'done', fileId = 'file-' + id) => ({
  id,
  status,
  uploaded: status === 'done' ? { id: fileId } : null,
  file: { name: 'RAW ملف ' + id },
  error: status === 'error' ? 'RAW failure' : null,
});
const field = (tree) => all(tree, 'TextField')[0].props;
const button = (tree) => all(tree, 'Button')[0].props;
const icons = (tree) => all(tree, 'IconButton').map((n) => n.props);
const recorder = (tree) => all(tree, 'AudioRecorderSheet')[0].props;
const notice = (tree) => all(tree, 'Callout')[0].props;
const failure = (tree) => all(tree, 'Callout')[1]?.props;
const edit = (value, p = base) => state.editDraft(target(p), 'comment', value);
const raw = '  RAW <b>é</b> العربية\n ';
const audio = Object.freeze({
  uri: 'synthetic://recording',
  name: 'RAW صوت.m4a',
  mimeType: 'audio/mp4',
  size: 42,
});
const success = (locale = 'en') => {
  allow('success');
  allow('announce', (message) =>
    assert.equal(message, i18n.createTranslator(locale)('commentComposer.posted')),
  );
};
const post = (d, p = base, text = raw, fileIds = []) => {
  const expected = {
    accountId: account.id,
    client,
    courseId: p.courseId,
    assignmentId: p.assignmentId,
  };
  if (!observerMode) allow('resetObserver');
  allow('post', (actual, input) => {
    equal(actual, expected);
    assert.equal(actual.client, expected.client);
    equal(input, { text, fileIds, attempt: p.attempt });
    return d.promise;
  });
};
(async () => {
  const keys = [
    'placeholder',
    'field',
    'uploading',
    'failedAttachments',
    'dismiss',
    'dismissLabel',
    'failureTitle',
    'networkFailure',
    'genericFailure',
    'attach',
    'audio',
    'offline',
    'send',
    'posted',
  ]
    .map((k) => 'commentComposer.' + k)
    .concat(
      ['storageError', 'waiting', 'synced', 'unavailable', 'stale', 'comment', 'device'].map(
        (k) => 'submissionDraft.' + k,
      ),
    );
  const catalogs = Object.fromEntries(langs.map((l) => [l, load('@/i18n/' + l)[l]]));
  for (const l of langs) {
    assert.equal(Object.keys(baseline.catalogs[l]).length, 1743);
    assert.ok(Object.keys(catalogs[l]).length >= 1743 + keys.length);
    for (const k of keys) {
      assert.ok(!Object.hasOwn(baseline.catalogs[l], k));
      assert.ok(Object.hasOwn(catalogs[l], k));
    }
    for (const [k, v] of Object.entries(baseline.catalogs[l])) equal(catalogs[l][k], v);
    equal(Object.keys(catalogs[l]).sort(), Object.keys(catalogs.en).sort());
    for (const k of Object.keys(catalogs[l]))
      equal(
        [...new Set(JSON.stringify(catalogs[l][k]).match(/\{\w+\}/g) ?? [])].sort(),
        [...new Set(JSON.stringify(catalogs.en[k]).match(/\{\w+\}/g) ?? [])].sort(),
      );
  }
  assert.equal(
    fs.readFileSync(path.join(root, 'features/submissions/draftState.ts'), 'utf8'),
    baseline.sources['features/submissions/draftState.ts'],
  );
  const source = fs.readFileSync(path.join(root, 'features/submissions/drafts.ts'), 'utf8');
  assert.equal(
    source
      .slice(0, source.indexOf('  // Presentation-only'))
      .replace(
        "\nimport { useTranslation } from '@/i18n';\n\nimport { draftStatusLabel } from './draftPresentation';",
        '',
      ),
    baseline.sources['features/submissions/drafts.ts'].split('  const statusLabel =')[0],
  );
  assert.equal(
    source.slice(source.indexOf('  return { value:')).replace(', captureForClear', ''),
    baseline.sources['features/submissions/drafts.ts'].slice(
      baseline.sources['features/submissions/drafts.ts'].indexOf('  return { value:'),
    ),
  );
  const draftSyncSource = fs.readFileSync(
    path.join(root, 'features/submissions/draftSync.check.cjs'),
    'utf8',
  );
  assert.equal(
    draftSyncSource.replace(
      "    // Presentation-only boundary; existing behavior assertions remain English.\n    '@/i18n': { useTranslation: () => ({ t: load('@/i18n/runtime').createTranslator('en') }) },\n",
      '',
    ),
    baseline.sources['features/submissions/draftSync.check.cjs'],
  );
  // Actual useDraft/draftState/queue: same-instance statuses and raw values, zero locale writes.
  const dt = { accountId: 'status', courseId: 'c', assignmentId: 'a', attempt: 1 };
  const h = mount(() =>
    drafts.useDraft(dt.accountId, dt.courseId, dt.assignmentId, 'comment', undefined, {
      attempt: dt.attempt,
    }),
  );
  assert.equal(h.render().statusLabel, null);
  for (const value of [raw, '', '\u200fمرحبا']) {
    h.render().setValue(value);
    for (const [status, key] of [
      ['storage-error', 'storageError'],
      ['waiting', 'waiting'],
      ['synced', 'synced'],
      ['unavailable', 'unavailable'],
      ['stale', 'stale'],
      ['device', 'comment'],
    ]) {
      const doc = state.readDraftDocument(dt);
      state.setDraftStatus(dt, 'comment', doc.records.comment.revision, status);
      const before = state.readDraftDocument(dt);
      for (const l of langs)
        quiet(() => {
          const t = view(l),
            d = h.render();
          assert.equal(d.value, value);
          assert.equal(d.statusLabel, t('submissionDraft.' + key));
          assert.equal(state.readDraftDocument(dt), before);
        });
    }
  }
  assert.equal(queue.pendingWrites().length, 0, 'comments never autosync');
  h.unmount();
  // Capture validity includes before-render edits, equal-value rewrites, tombstones and removal.
  for (const change of [
    'none',
    'edit',
    'away-back',
    'same',
    'consume',
    'discard',
    'generation',
    'remove',
    'stale',
    'newAttempt',
  ]) {
    const id = 'clear-' + change,
      t = { ...dt, accountId: id };
    const hook = mount(() => drafts.useDraft(id, 'c', 'a', 'comment', undefined, { attempt: 1 }));
    hook.render().setValue(raw);
    const snap = hook.render().captureForClear();
    if (change === 'edit') state.editDraft(t, 'comment', 'new');
    if (change === 'same') state.editDraft(t, 'comment', raw);
    if (change === 'away-back') {
      state.editDraft(t, 'comment', 'away');
      state.editDraft(t, 'comment', raw);
    }
    if (change === 'stale')
      state.setDraftStatus(
        t,
        'comment',
        state.readDraftDocument(t).records.comment.revision,
        'stale',
      );
    if (change === 'consume') state.consumeDraft(t);
    if (change === 'discard') sync.discardSubmissionDraft(t);
    if (change === 'generation') {
      const d = state.readDraftDocument(t);
      state.writeDraftDocument({ ...d, generation: d.generation + 1 });
    }
    if (change === 'remove') cleanups.forEach((fn) => fn(id));
    if (change === 'newAttempt') state.editDraft({ ...t, attempt: 2 }, 'comment', 'new attempt');
    const unchanged = ['none', 'newAttempt'].includes(change);
    assert.equal(snap.clearIfUnchanged(), unchanged, change);
    if (change === 'newAttempt')
      assert.equal(
        state.readDraftDocument({ ...t, attempt: 2 }).records.comment.value,
        'new attempt',
      );
    if (change === 'edit') assert.equal(state.readDraftDocument(t).records.comment.value, 'new');
    if (change === 'away-back' || change === 'same')
      assert.equal(state.readDraftDocument(t).records.comment.value, raw);
    if (unchanged) assert.equal(state.readDraftDocument(t).records.comment.value, '');
    hook.unmount();
  }
  // Empty snapshots cannot erase a record created after invocation; storage-error status is real.
  const emptyHook = mount(() => drafts.useDraft('empty-snapshot', 'c', 'a', 'comment'));
  const emptyCapture = emptyHook.render().captureForClear();
  emptyHook.render().setValue('created before rerender');
  assert.equal(emptyCapture.clearIfUnchanged(), false);
  assert.equal(emptyHook.render().value, 'created before rerender');
  emptyHook.unmount();
  const storageHook = mount(() => drafts.useDraft('disk-error', 'c', 'a', 'text'));
  storageHook.render();
  storageFailure = true;
  storageHook.render().setValue(raw);
  storageFailure = false;
  for (const l of langs)
    quiet(() => {
      view(l);
      const r = storageHook.render();
      assert.equal(r.value, raw);
      assert.equal(r.statusLabel, i18n.createTranslator(l)('submissionDraft.storageError'));
    });
  storageHook.render().setValue('retry');
  for (const l of langs)
    quiet(() => {
      view(l);
      assert.equal(
        storageHook.render().statusLabel,
        i18n.createTranslator(l)('submissionDraft.device'),
      );
    });
  storageHook.unmount();
  // Existing default clear still clears the latest edit; consumed documents still cannot clear.
  const dh = mount(() => drafts.useDraft('default', 'c', 'a', 'comment'));
  const old = dh.render();
  old.setValue('first');
  old.setValue('latest');
  old.clear();
  assert.equal(dh.render().value, '');
  state.consumeDraft({ accountId: 'default', courseId: 'c', assignmentId: 'a', attempt: 0 });
  quiet(() => old.clear());
  dh.unmount();
  // Text/URL autosync queue behavior, status presentation and conditional clearing are unchanged.
  online = false;
  for (const kind of ['text', 'url']) {
    const t = {
      accountId: 'queue-' + kind,
      courseId: 'c',
      assignmentId: 'a',
      attempt: 1,
      submissionId: 'submission',
    };
    const dh = mount(() =>
      drafts.useDraft(t.accountId, 'c', 'a', kind, undefined, {
        attempt: 1,
        submissionId: t.submissionId,
      }),
    );
    dh.render().setValue(raw);
    dh.render().setValue('latest');
    assert.equal(queue.pendingWrites(t.accountId).length, 1);
    assert.equal(state.readDraftDocument(t).records[kind].status, 'waiting');
    for (const l of langs)
      quiet(() => {
        view(l);
        assert.equal(dh.render().statusLabel, i18n.createTranslator(l)('submissionDraft.waiting'));
      });
    const capture = dh.render().captureForClear();
    assert.equal(capture.clearIfUnchanged(), true);
    const pending = queue.pendingWrites(t.accountId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].payload.revision, 3);
    assert.equal(state.readDraftDocument(t).records[kind].value, '');
    dh.unmount();
  }
  online = true;
  view('en');
  // Disabled callback invocation: current committed state plus synchronous draft/upload reads.
  for (const mode of [
    'offline',
    'unloaded',
    'empty',
    'uploading',
    'failed',
    'emptyBeforeRender',
    'uploadBeforeRender',
    'offlineBeforeRender',
  ]) {
    slots.clear();
    edit(raw);
    online = mode !== 'offline';
    forcedUnloaded = mode === 'unloaded';
    if (mode === 'empty') edit(' \n ');
    if (mode === 'uploading' || mode === 'failed')
      slots.set(slot(), [item('x', mode === 'failed' ? 'error' : 'uploading')]);
    const ch = mount(CommentComposer, base),
      tree = ch.render();
    if (mode === 'emptyBeforeRender') edit('');
    if (mode === 'uploadBeforeRender') slots.set(slot(), [item('x', 'uploading')]);
    if (mode === 'offlineBeforeRender') online = false;
    await quiet(() => button(tree).onPress());
    ch.unmount();
    online = true;
    forcedUnloaded = false;
  }
  slots.clear();
  edit(raw);
  let ch = mount(CommentComposer, base),
    tree = ch.render();
  const retained = button(tree).onPress;
  online = false;
  ch.render();
  await quiet(() => retained());
  online = true;
  tree = ch.render();
  // Every helper is display-time only; original upload objects and errors stay raw.
  for (const status of ['uploading', 'error']) {
    const original = item('helper', status);
    slots.set(slot(), [original]);
    for (const l of langs)
      quiet(() => {
        const t = view(l),
          r = ch.render();
        assert.equal(
          field(r).helperText,
          t(
            status === 'uploading'
              ? 'commentComposer.uploading'
              : 'commentComposer.failedAttachments',
          ),
        );
        assert.equal(all(r, 'UploadList')[0].props.items[0], original);
      });
  }
  slots.clear();
  online = false;
  for (const l of langs)
    quiet(() => {
      const t = view(l);
      assert.equal(button(ch.render()).accessibilityHint, t('commentComposer.offline'));
    });
  online = true;
  tree = ch.render();
  // Live labels, notice passthrough, raw values and audio state with no locale operations.
  icons(tree)[1].onPress();
  for (const l of langs)
    quiet(() => {
      const t = view(l),
        r = ch.render();
      assert.equal(field(r).placeholder, t('commentComposer.placeholder'));
      assert.equal(field(r).accessibilityLabel, t('commentComposer.field'));
      assert.equal(button(r).children, t('commentComposer.send'));
      assert.equal(icons(r)[0].accessibilityLabel, t('commentComposer.attach'));
      assert.equal(icons(r)[1].accessibilityLabel, t('commentComposer.audio'));
      assert.equal(field(r).value, raw);
      assert.equal(recorder(r).visible, true);
      assert.equal(notice(r).title, persistentNotice.title);
      assert.equal(notice(r).children, persistentNotice.body);
      assert.equal(notice(r).action.label, t('commentComposer.dismiss'));
    });
  view('fr');
  tree = ch.render();
  allow('picker');
  icons(tree)[0].onPress();
  allow('dismiss');
  notice(tree).action.onPress();
  allow('addUploads', (key, args, files) => {
    assert.equal(key, slot());
    assert.equal(args.client, client);
    equal(args, { client, preflightPath: '/courses/c/assignments/a/comments/files' });
    assert.equal(files[0], audio);
  });
  recorder(tree).onAttach(audio);
  tree = ch.render();
  assert.equal(recorder(tree).visible, false);
  // Same-render duplicates and pending callbacks, invocation-locale feedback, new edits/uploads.
  slots.set(slot(), [item('submitted')]);
  tree = ch.render();
  const d = deferred();
  post(d, base, raw, ['file-submitted']);
  const running = button(tree).onPress();
  await quiet(() => button(tree).onPress());
  quiet(() => {
    icons(tree)[0].onPress();
    icons(tree)[1].onPress();
    pickerOptions.onRecordAudio();
    notice(tree).action.onPress();
    recorder(tree).onAttach(audio);
    recorder(tree).onClose();
  });
  for (const l of langs)
    quiet(() => {
      view(l);
      assert.equal(button(ch.render()).loading, true);
    });
  field(tree).onChangeText('new work before rerender');
  slots.set(slot(), [item('submitted'), item('later')]);
  allow('remove', (key, id) => {
    assert.equal(key, slot());
    assert.equal(id, 'submitted');
  });
  success('fr');
  d.resolve();
  await running;
  assert.equal(state.readDraftDocument(target()).records.comment.value, 'new work before rerender');
  equal(
    uploadsFor(slot()).map((i) => i.id),
    ['later'],
  );
  assert.equal(button(ch.render()).loading, false);
  ch.unmount();
  // Failure classification is stable, translates in place, retries once, and raw error is not inferred.
  for (const error of [
    new CanvasNetworkError('raw network'),
    new Error('Couldn’t reach Canvas'),
    { message: 'raw' },
  ]) {
    view('en');
    slots.clear();
    edit(raw);
    ch = mount(CommentComposer, base);
    tree = ch.render();
    const d = deferred();
    post(d);
    const running = button(tree).onPress();
    allow('error');
    d.reject(error);
    await running;
    for (const l of langs)
      quiet(() => {
        const t = view(l),
          r = ch.render();
        assert.equal(failure(r).title, t('commentComposer.failureTitle'));
        assert.equal(
          failure(r).children,
          t(
            error instanceof CanvasNetworkError
              ? 'commentComposer.networkFailure'
              : 'commentComposer.genericFailure',
          ),
        );
        assert.equal(field(r).value, raw);
      });
    const retry = deferred();
    post(retry);
    const retrying = button(ch.render()).onPress();
    success('ar');
    retry.resolve();
    await retrying;
    assert.equal(failure(ch.render()), undefined);
    assert.equal(field(ch.render()).value, '');
    ch.unmount();
  }
  // Files-only, exact null attempt/raw whitespace and last-moment snapshot at invocation.
  view('en');
  slots.clear();
  const p = { ...base, attempt: null };
  edit('  ', p);
  slots.set(slot(p), [item('one'), item('two')]);
  ch = mount(CommentComposer, p);
  tree = ch.render();
  edit('\n ', p);
  const fileOnly = deferred();
  post(fileOnly, p, '\n ', ['file-one', 'file-two']);
  const fileRun = button(tree).onPress();
  // A replacement item reusing an ID but referring to a different file is never removed.
  slots.set(slot(p), [item('one', 'done', 'replacement'), item('two')]);
  allow('remove', (_, id) => assert.equal(id, 'two'));
  success();
  fileOnly.resolve();
  await fileRun;
  equal(
    uploadsFor(slot(p)).map((i) => i.uploaded.id),
    ['replacement'],
  );
  ch.unmount();
  // Every identity dimension, both resolve/reject, stale callbacks, and new claim ownership.
  let cases = 0;
  for (const dimension of ['account', 'client', 'course', 'assignment', 'attempt', 'unmount'])
    for (const outcome of ['resolve', 'reject']) {
      account = { id: 'accountA' };
      client = clientA;
      slots.clear();
      view('en');
      edit(raw);
      ch = mount(CommentComposer, base);
      tree = ch.render();
      icons(tree)[1].onPress();
      const oldAudio = pickerOptions.onRecordAudio;
      const d = deferred();
      post(d);
      const running = button(tree).onPress();
      let next = { ...base };
      if (dimension === 'account') account = { id: 'accountB' };
      if (dimension === 'client') client = clientB;
      if (dimension === 'course') next.courseId = 'c2';
      if (dimension === 'assignment') next.assignmentId = 'a2';
      if (dimension === 'attempt') next.attempt = 4;
      if (dimension === 'unmount') ch.unmount();
      else {
        ch.render(next);
        edit('new context', next);
        const r = ch.render();
        assert.equal(recorder(r).visible, false);
        assert.equal(failure(r), undefined);
      }
      await quiet(() => button(tree).onPress());
      quiet(() => {
        icons(tree)[0].onPress();
        icons(tree)[1].onPress();
        oldAudio();
        recorder(tree).onAttach(audio);
        recorder(tree).onClose();
        notice(tree).action.onPress();
        field(tree).onChangeText('obsolete');
      });
      let newer, newRun;
      if (dimension !== 'unmount') {
        newer = deferred();
        post(newer, next, 'new context');
        newRun = button(ch.render()).onPress();
      }
      const n = calls.length;
      if (outcome === 'resolve') d.resolve();
      else d.reject(new CanvasNetworkError());
      await running;
      assert.equal(calls.length, n, 'old completion is silent');
      if (newer) {
        assert.equal(button(ch.render()).loading, true);
        await quiet(() => button(ch.render()).onPress());
        assert.equal(field(ch.render()).value, 'new context');
        success();
        newer.resolve();
        await newRun;
        assert.equal(field(ch.render()).value, '');
        ch.unmount();
      }
      cases++;
    }
  // Rendering a replacement without committing must not authorize its callbacks.
  account = { id: 'accountA' };
  client = clientA;
  slots.clear();
  edit(raw);
  view('en');
  ch = mount(CommentComposer, base);
  tree = ch.render();
  const uncommitted = ch.renderOnly({ ...base, attempt: 99 });
  await quiet(() => button(uncommitted).onPress());
  quiet(() => {
    icons(uncommitted)[0].onPress();
    icons(uncommitted)[1].onPress();
    recorder(uncommitted).onAttach(audio);
    notice(uncommitted).action.onPress();
  });
  ch.commit();
  await quiet(() => button(tree).onPress());
  ch.unmount();
  // A retained callback uses the current committed locale at invocation, not its render locale.
  slots.clear();
  edit(raw);
  view('en');
  ch = mount(CommentComposer, base);
  tree = ch.render();
  view('ar');
  ch.render();
  const retainedLocale = deferred();
  post(retainedLocale);
  const retainedRun = button(tree).onPress();
  view('fr');
  quiet(() => ch.render());
  success('ar');
  retainedLocale.resolve();
  await retainedRun;
  ch.unmount();
  // Installed TanStack observer: options can change before mutationFn begins, and
  // while awaiting its response. Production composer must detach immediately.
  observerMode = true;
  for (const outcome of ['resolve', 'reject']) {
    account = { id: 'accountA' };
    client = clientA;
    slots.clear();
    edit(raw);
    view('en');
    ch = mount(CommentComposer, base);
    tree = ch.render();
    const oldTarget = {
      accountId: account.id,
      client,
      courseId: base.courseId,
      assignmentId: base.assignmentId,
    };
    const first = deferred();
    post(first);
    const oldRun = button(tree).onPress();
    account = { id: 'accountB' };
    client = clientB;
    const next = { courseId: 'other-course', assignmentId: 'other-assignment', attempt: 42 };
    ch.render(next);
    edit('new observer', next);
    tree = ch.render();
    const second = deferred();
    post(second, next, 'new observer');
    const newRun = button(tree).onPress();
    if (outcome === 'resolve') {
      allow('cacheSuccess', (target, result) => {
        equal(target, oldTarget);
        assert.equal(result, 'old result');
      });
      first.resolve('old result');
    } else first.reject(new CanvasNetworkError('old request'));
    await oldRun;
    assert.equal(button(ch.render()).loading, true);
    assert.equal(failure(ch.render()), undefined);
    assert.equal(field(ch.render()).value, 'new observer');
    const nextTarget = {
      accountId: account.id,
      client,
      courseId: next.courseId,
      assignmentId: next.assignmentId,
    };
    allow('cacheSuccess', (target, result) => {
      equal(target, nextTarget);
      assert.equal(result, 'new result');
    });
    success();
    second.resolve('new result');
    await newRun;
    assert.equal(field(ch.render()).value, '');
    ch.unmount();
  }
  assertQueues();
  console.log(
    `PASS submission comments: 21 additive keys, 1743 frozen values/language; production draft/state/queue, locale-only purity, conditional clear, send/attachment guards and ${cases} late completion transitions plus installed TanStack observer races (${process.env.TZ ?? 'default TZ'}). Synthetic boundaries only.`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
