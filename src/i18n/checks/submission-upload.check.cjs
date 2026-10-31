/* global __dirname */
/** Actual production modules with fail-closed in-memory native boundaries. No app I/O. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const baseline = require('./submission-upload.baseline.json');
const unexpected = [];
const fail = (n) => {
  unexpected.push(n);
  throw Error('Unexpected boundary: ' + n);
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};
const plain = (v) => JSON.parse(JSON.stringify(v));
const equal = (a, b) => assert.deepEqual(plain(a), plain(b));
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

const clientA = { id: 'A' },
  clientB = { id: 'B' };
let account = { id: 'a' },
  client = clientA,
  fontScale = 1;
class CanvasError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
class CanvasNetworkError extends Error {}
const doc = 'synthetic:///documents',
  picked = 'synthetic:///picked/raw.pdf';
const raw = Object.freeze({
  uri: picked,
  name: 'RAW العربية.pdf',
  mimeType: 'application/pdf',
  size: 1234,
});
function environment(seed) {
  const disk = new Map(seed ?? [[picked, 'raw bytes']]),
    dirs = new Set([doc]);
  const calls = [],
    copies = [],
    uploads = [],
    timers = [],
    cleanups = [],
    cache = new Map();
  let copyMode = 'defer',
    existsError = null,
    launchError = null,
    writeError = null;
  const uriOf = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
  const valid = (uri) => {
    if (!uri.startsWith('synthetic:///')) fail('real URI ' + uri);
    return uri;
  };
  class File {
    constructor(...parts) {
      this.uri = valid(uriOf(parts));
      this.name = this.uri.split('/').pop();
    }
    get exists() {
      if (existsError) {
        const e = existsError;
        existsError = null;
        throw e;
      }
      return disk.has(this.uri);
    }
    get size() {
      return 9;
    }
    textSync() {
      calls.push(['read', this.uri]);
      assert.ok(disk.has(this.uri));
      return disk.get(this.uri);
    }
    write(value) {
      calls.push(['write', this.uri]);
      return Promise.reject(Error('Async write must not be used for metadata'));
    }
    writeSync(value) {
      calls.push(['writeSync', this.uri]);
      if (writeError) throw writeError;
      JSON.parse(value);
      disk.set(this.uri, value);
    }
    delete() {
      calls.push(['delete', this.uri]);
      assert.ok(this.uri.startsWith(doc + '/uploads/'));
      disk.delete(this.uri);
    }
    copy(to) {
      calls.push(['copy', this.uri, to.uri]);
      assert.ok(to.uri.startsWith(doc + '/uploads/files/'));
      if (copyMode === 'throw') throw Error('copy sync throw');
      const job = deferred();
      copies.push({ ...job, from: this.uri, to: to.uri });
      return job.promise.then(() => {
        disk.set(to.uri, disk.get(this.uri) ?? 'late bytes');
      });
    }
  }
  class Directory {
    constructor(...parts) {
      this.uri = valid(uriOf(parts));
    }
    get exists() {
      return dirs.has(this.uri) || [...disk.keys()].some((k) => k.startsWith(this.uri + '/'));
    }
    create(options) {
      equal(options, { intermediates: true });
      calls.push(['mkdir', this.uri]);
      dirs.add(this.uri);
    }
    list() {
      return [...disk.keys()]
        .filter((k) => k.startsWith(this.uri + '/') && !k.slice(this.uri.length + 1).includes('/'))
        .map((k) => new File(k));
    }
  }
  function upload(kind, args) {
    calls.push([kind, ...args]);
    if (launchError) throw launchError;
    const job = deferred();
    uploads.push({ ...job, kind, args });
    return job.promise;
  }
  let observer = null;
  const mocks = {
    react: {
      ...react,
      useSyncExternalStore(subscribe, snapshot) {
        if (observer) subscribe(observer);
        return snapshot();
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { View: 'View', useWindowDimensions: () => ({ fontScale }) },
    'expo-file-system': { File, Directory, Paths: { document: doc } },
    'lucide-react-native': elements(
      'CircleCheck RotateCw X File FileArchive FileCode FileHeadphone FileImage FileSpreadsheet FileText FileType FileVideoCamera Globe Presentation',
    ),
    '@/design': elements('Card Divider Icon IconButton ProgressBar Text'),
    '@/features/files/FileThumbnail': { FileThumbnail: 'FileThumbnail' },
    '@/canvas/client': { CanvasError, CanvasNetworkError },
    '@/canvas/session': {
      registerAccountCleanup: (fn) => cleanups.push(fn),
      useCanvas: () => ({ account, client }),
    },
    '@/canvas/uploads': {
      uploadToCanvas: (...a) => upload('canvas', a),
      uploadMediaToKaltura: (...a) => upload('media', a),
    },
  };
  const allowed = new Set([
    'features/submissions/uploadStore',
    'features/submissions/uploadErrors',
    'features/submissions/uploadPresentation',
    'features/submissions/UploadList',
    'features/files/kinds',
    'features/course/format',
    'lib/dates',
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
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    new vm.Script(code, { filename: file }).runInContext(
      vm.createContext({
        module,
        exports: module.exports,
        require: (n) => load(n, file),
        Intl,
        Date,
        Error,
        console,
        fetch: () => fail('fetch'),
        setTimeout: (fn, ms) => {
          assert.equal(ms, 250);
          const timer = { fn };
          timers.push(timer);
          return timer;
        },
      }),
    );
    return module.exports;
  }
  const store = load('@/features/submissions/uploadStore');
  return {
    store,
    load,
    disk,
    calls,
    copies,
    uploads,
    File,
    listen(fn) {
      observer = fn;
      store.useUploads(slot);
      observer = null;
    },
    set copyMode(v) {
      copyMode = v;
    },
    set existsError(v) {
      existsError = v;
    },
    set launchError(v) {
      launchError = v;
    },
    set writeError(v) {
      writeError = v;
    },
    save() {
      timers.splice(0).forEach((t) => t.fn());
    },
    cleanup(id) {
      cleanups.forEach((fn) => fn(id));
    },
    get timerCount() {
      return timers.length;
    },
  };
}
const target = { client: clientA, preflightPath: '/raw/preflight' };
const slot = 'submission|a|201|9003';
const nodes = (t) =>
  !t || typeof t !== 'object'
    ? []
    : Array.isArray(t)
      ? t.flatMap(nodes)
      : [t, ...nodes(t.props?.children)];
const all = (t, type) => nodes(t).filter((n) => n.type === type);
const progress = (job) => job.args.at(-1).onProgress;
const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(e));
(async () => {
  const e = environment(),
    { store: s } = e,
    rt = e.load('@/i18n/runtime');
  const langs = ['en', 'fr', 'ar'];
  const keys =
    'uploading finishing percent done mediaDone failed row retry remove network quota filetype mediaService forbidden generic stopped lost'
      .split(' ')
      .map((k) => 'submissionUpload.' + k);
  const catalogs = Object.fromEntries(langs.map((l) => [l, e.load('@/i18n/' + l)[l]]));
  for (const l of langs) {
    assert.equal(Object.keys(baseline.catalogs[l]).length, 1726);
    for (const [k, v] of Object.entries(baseline.catalogs[l])) equal(catalogs[l][k], v);
    for (const k of keys) {
      assert.ok(!Object.hasOwn(baseline.catalogs[l], k));
      assert.ok(Object.hasOwn(catalogs[l], k));
    }
    equal(Object.keys(catalogs[l]).sort(), Object.keys(catalogs.en).sort());
    for (const k of Object.keys(catalogs.en))
      equal(
        [...new Set(JSON.stringify(catalogs[l][k]).match(/\{\w+\}/g) ?? [])].sort(),
        [...new Set(JSON.stringify(catalogs.en[k]).match(/\{\w+\}/g) ?? [])].sort(),
      );
  }
  for (const f of ['i18n/runtime.ts', 'canvas/uploads.ts'])
    assert.equal(fs.readFileSync(path.join(root, f), 'utf8'), baseline.sources[f]);
  // API/paths, synchronous IDs, copy ordering, captured target/client/raw metadata.
  assert.equal(s.submissionSlot('a', '201', '9003'), slot);
  assert.equal(s.mediaSlot('a', '201', '9003'), 'media|a|201|9003');
  assert.equal(s.commentSlot('a', '201', '9003'), 'comment|a|201|9003');
  const [id] = s.addUploads(slot, target, [raw]);
  assert.equal(typeof id, 'string');
  assert.equal(e.uploads.length, 0);
  assert.equal(s.activeUploadCount('a'), 1);
  assert.equal(s.uploadsFor(slot)[0].file.uri, picked);
  const second = { client: clientB, media: { contextCode: 'course_2' } };
  const [id2] = s.addUploads(slot, second, [
    { ...raw, name: 'VOICE.MP3', mimeType: 'video/other' },
  ]);
  second.media.contextCode = 'mutated';
  e.copies[0].resolve();
  e.copies[1].resolve();
  await flush();
  assert.equal(e.uploads.length, 2);
  assert.equal(e.uploads[0].args[0], clientA);
  assert.equal(e.uploads[0].args[1], target.preflightPath);
  equal(e.uploads[0].args[2], { ...raw, uri: e.copies[0].to });
  equal(Object.keys(e.uploads[0].args[3]), ['onProgress']);
  assert.equal(e.uploads[1].args[0], clientB);
  assert.equal(e.uploads[1].args[2].contextCode, 'course_2');
  assert.equal(e.uploads[1].args[2].type, 'audio');
  for (const [name, mimeType, type] of [
    ['clip.bin', 'audio/custom', 'audio'],
    ['clip.M4A', null, 'audio'],
    ['clip.AAC', 'video/x', 'audio'],
    ['clip.wav', null, 'audio'],
    ['clip.caf', null, 'audio'],
    ['clip.ogg', null, 'video'],
    ['clip.mp4', 'video/mp4', 'video'],
  ]) {
    const x = environment();
    x.store.addUploads(slot, { client: clientA, media: { contextCode: 'course_raw' } }, [
      { ...raw, name, mimeType, size: null },
    ]);
    x.copies[0].resolve();
    await flush();
    const args = x.uploads[0].args;
    assert.equal(args[0], clientA);
    equal(args[1], { ...raw, name, mimeType, size: 9, uri: x.copies[0].to });
    equal(Object.keys(args[2]).sort(), ['contextCode', 'onProgress', 'type']);
    assert.equal(args[2].type, type);
    assert.equal(args[2].contextCode, 'course_raw');
  }
  // Throttle, null/finishing and terminal callbacks; no restart from done/uploading.
  const p = progress(e.uploads[0]);
  p(0.019);
  assert.equal(s.uploadsFor(slot)[0].fraction, 0);
  p(0.02);
  assert.equal(s.uploadsFor(slot)[0].fraction, 0.02);
  p(0.03);
  assert.equal(s.uploadsFor(slot)[0].fraction, 0.02);
  p(null);
  assert.equal(s.uploadsFor(slot)[0].fraction, null);
  p(1);
  assert.equal(s.uploadsFor(slot)[0].fraction, 1);
  s.retryUpload(slot, id);
  assert.equal(e.uploads.length, 2);
  e.uploads[0].resolve({ id: 'file-1', size: 7 });
  e.uploads[1].resolve({ id: 'media-1', type: 'audio' });
  await flush();
  p(0.4);
  assert.equal(s.uploadsFor(slot)[0].fraction, 1);
  s.retryUpload(slot, id);
  assert.equal(e.uploads.length, 2);
  assert.equal(s.activeUploadCount(), 0);
  s.moveUpload(slot, id2, -1);
  equal(s.summarize(s.uploadsFor(slot)), {
    uploading: 0,
    failed: 0,
    ready: true,
    fileIds: ['file-1'],
    media: { id: 'media-1', type: 'audio' },
  });
  e.save();
  assert.equal(e.calls.filter((c) => c[0] === 'writeSync').length, 1);
  const stored = JSON.parse(e.disk.get(doc + '/uploads/a.json'));
  assert.ok(stored[slot].items.every((i) => !('fraction' in i)));
  assert.ok(!('attempts' in stored[slot]));
  // Account counts and finished-vs-interrupted assertions from the older scratch harness.
  const b = s.commentSlot('b', '201', '9003');
  s.addUploads(b, target, [raw]);
  assert.equal(s.activeUploadCount(), 1);
  assert.equal(s.useActiveUploads('b').count, 1);
  e.save();
  const restored = environment(e.disk).store;
  assert.equal(restored.uploadsFor(slot)[0].status, 'done');
  assert.equal(restored.uploadsFor(b)[0].status, 'error');
  assert.equal(
    restored.uploadsFor(b)[0].error,
    'The upload stopped when Easel closed. Retry to send it again.',
  );
  assert.equal(restored.activeUploadCount(), 0);
  const order = environment();
  const ids = order.store.addUploads(slot, target, [raw, { ...raw, name: 'second.pdf' }]);
  order.copies.forEach((c) => c.resolve());
  await flush();
  order.uploads[0].resolve({ id: 'one' });
  order.uploads[1].resolve({ id: 'two' });
  await flush();
  order.store.moveUpload(slot, ids[1], -1);
  equal(order.store.summarize(order.store.uploadsFor(slot)).fileIds, ['two', 'one']);
  order.store.removeUpload(slot, ids[1]);
  equal(order.store.summarize(order.store.uploadsFor(slot)).fileIds, ['one']);
  equal(order.store.summarize([]), {
    uploading: 0,
    failed: 0,
    ready: false,
    fileIds: [],
    media: null,
  });
  // Exact two-account recovery contract retained from m2-recovery-check.cjs.
  const accounts = environment();
  accounts.store.addUploads(slot, target, [raw]);
  accounts.store.addUploads(b, target, [raw]);
  assert.equal(accounts.store.activeUploadCount(), 2);
  assert.equal(accounts.store.activeUploadCount('a'), 1);
  equal(accounts.store.useActiveUploads('b'), {count:1});
  accounts.copies.forEach(c=>c.resolve()); await flush();
  accounts.uploads[0].resolve({id:'file-1',name:raw.name}); await flush();
  assert.equal(accounts.store.activeUploadCount('a'), 0);
  assert.equal(accounts.store.activeUploadCount(), 1);
  accounts.save(); const recovery=environment(accounts.disk).store;
  assert.equal(recovery.uploadsFor(slot)[0].status, 'done');
  assert.equal(recovery.uploadsFor(b)[0].status, 'error');
  assert.equal(recovery.uploadsFor(b)[0].error, 'The upload stopped when Easel closed. Retry to send it again.');
  assert.equal(recovery.activeUploadCount(), 0);
  recovery.retryUpload(b, recovery.uploadsFor(b)[0].id);
  assert.equal(recovery.uploadsFor(b)[0].errorOrigin.kind, 'stopped');
  // Pending copy resolve/reject after remove/clear/account removal cannot publish or upload.
  for (const action of ['remove', 'clear', 'cleanup'])
    for (const outcome of ['resolve', 'reject']) {
      const x = environment(),
        [i] = x.store.addUploads(slot, target, [raw]),
        copy = x.copies[0];
      x.save();
      if (action === 'remove') x.store.removeUpload(slot, i);
      if (action === 'clear') x.store.clearUploads(slot);
      if (action === 'cleanup') x.cleanup('a');
      const [newId] = x.store.addUploads(slot, target, [raw]);
      copy[outcome](Error('copy failure'));
      await flush();
      assert.equal(x.uploads.length, 0);
      assert.ok(!x.disk.has(copy.to));
      assert.equal(x.store.uploadsFor(slot).length, 1);
      assert.equal(x.store.uploadsFor(slot)[0].id, newId);
      x.copies[1].resolve();
      await flush();
      assert.equal(x.uploads.length, 1);
      x.save();
      assert.equal(JSON.parse(x.disk.get(doc + '/uploads/a.json'))[slot].items.length, 1);
    }
  // Network settlements/progress cannot reach cleared/recreated or removed slots.
  for (const action of ['remove', 'clear', 'cleanup'])
    for (const outcome of ['resolve', 'reject']) {
      const x = environment(),
        [i] = x.store.addUploads(slot, target, [raw]);
      x.copies[0].resolve();
      await flush();
      const old = x.uploads[0];
      if (action === 'remove') x.store.removeUpload(slot, i);
      if (action === 'clear') x.store.clearUploads(slot);
      if (action === 'cleanup') x.cleanup('a');
      const [next] = x.store.addUploads(slot, target, [raw]);
      x.copies[1].resolve();
      await flush();
      old[outcome]({ id: 'old' });
      progress(old)(0.7);
      await flush();
      assert.equal(x.store.uploadsFor(slot)[0].id, next);
      assert.equal(x.store.uploadsFor(slot)[0].fraction, 0);
      x.uploads[1].resolve({ id: 'new' });
      await flush();
      equal(x.store.summarize(x.store.uploadsFor(slot)).fileIds, ['new']);
    }
  // Copy failures retain source fallback; missing/status/launch synchronous failures are caught.
  for (const mode of ['throw', 'reject']) {
    const x = environment();
    x.copyMode = mode;
    x.store.addUploads(slot, target, [raw]);
    if (mode === 'reject') x.copies[0].reject(Error('copy'));
    await flush();
    assert.equal(x.uploads[0].args[2].uri, picked);
    assert.equal(x.store.uploadsFor(slot)[0].status, 'uploading');
  }
  for (const mode of ['missing', 'exists', 'launch']) {
    const x = environment(),
      [i] = x.store.addUploads(slot, target, [raw]);
    if (mode === 'exists') x.existsError = Error('exists');
    if (mode === 'launch') x.launchError = new CanvasNetworkError('network');
    if (mode === 'missing') {
      x.disk.delete(picked);
      x.copies[0].reject(Error('copy'));
    } else x.copies[0].resolve();
    await flush();
    const item = x.store.uploadsFor(slot)[0];
    assert.equal(item.status, 'error');
    assert.equal(
      item.errorOrigin.kind,
      mode === 'missing' ? 'lost' : mode === 'launch' ? 'network' : 'generic',
    );
    assert.equal(item.id, i);
  }
  // Current error-only synchronous retry claim; old progress/settlement cannot release it.
  const retry = environment(),
    [rid] = retry.store.addUploads(slot, target, [raw]);
  retry.copies[0].resolve();
  await flush();
  retry.uploads[0].reject(new CanvasNetworkError('native'));
  await flush();
  assert.equal(retry.store.uploadsFor(slot)[0].errorOrigin.kind, 'network');
  retry.store.retryUpload(slot, rid, clientB);
  retry.store.retryUpload(slot, rid, clientB);
  assert.equal(retry.uploads.length, 2);
  assert.equal(retry.uploads[1].args[0], clientB);
  assert.equal(retry.store.uploadsFor(slot)[0].errorOrigin, undefined);
  assert.equal(retry.store.uploadsFor(slot)[0].error, null);
  progress(retry.uploads[0])(0.6);
  assert.equal(retry.store.uploadsFor(slot)[0].fraction, 0);
  retry.uploads[1].resolve({ id: 'retry' });
  await flush();
  assert.equal(retry.store.uploadsFor(slot)[0].errorOrigin, undefined);
  // Reentrant listeners cannot launch a removed copy or release a newer retry claim.
  const reentrant = environment();
  const [reid] = reentrant.store.addUploads(slot, target, [raw]);
  let retried = false;
  reentrant.listen(() => {
    if (!retried && reentrant.store.uploadsFor(slot)[0]?.status === 'error') {
      retried = true;
      reentrant.store.retryUpload(slot, reid, clientB);
    }
  });
  reentrant.copies[0].resolve();
  await flush();
  reentrant.uploads[0].reject(Error('first'));
  await flush();
  assert.equal(reentrant.uploads.length, 2);
  progress(reentrant.uploads[1])(0.5);
  assert.equal(reentrant.store.uploadsFor(slot)[0].fraction, 0.5);
  reentrant.uploads[1].resolve({ id: 'latest' });
  await flush();
  assert.equal(reentrant.store.uploadsFor(slot)[0].uploaded.id, 'latest');
  const removedAtPublish = environment();
  const [pubid] = removedAtPublish.store.addUploads(slot, target, [raw]);
  removedAtPublish.listen(() => {
    if (removedAtPublish.store.uploadsFor(slot)[0]?.file.uri !== picked)
      removedAtPublish.store.clearUploads(slot);
  });
  removedAtPublish.copies[0].resolve();
  await flush();
  assert.equal(removedAtPublish.uploads.length, 0);
  assert.ok(!removedAtPublish.disk.has(removedAtPublish.copies[0].to));
  assert.ok(!removedAtPublish.store.uploadsFor(slot).some((i) => i.id === pubid));
  // Even a partial native copy that rejects is cleaned before source fallback.
  const partial = environment();
  partial.store.addUploads(slot, target, [raw]);
  partial.disk.set(partial.copies[0].to, 'partial bytes');
  partial.copies[0].reject(Error('partial'));
  await flush();
  assert.ok(!partial.disk.has(partial.copies[0].to));
  assert.equal(partial.uploads[0].args[2].uri, picked);
  // Persistence remains debounced and synchronous; failures are caught. Cleanup before/after
  // a flush cannot race a deferred write. File.write deliberately returns a rejected Promise.
  for (const phase of ['before', 'after']) {
    const x = environment();
    x.store.addUploads(slot, target, [raw]);
    if (phase === 'after') x.save();
    x.cleanup('a');
    x.save();
    assert.ok(!x.disk.has(doc + '/uploads/a.json'));
    x.copies[0].resolve();
    await flush();
    x.save();
    assert.ok(!x.disk.has(doc + '/uploads/a.json'));
    assert.equal(x.uploads.length, 0);
  }
  const broken = environment();
  broken.writeError = Error('writeSync');
  broken.store.addUploads(slot, target, [raw]);
  broken.save();
  assert.equal(broken.store.activeUploadCount(), 1);
  // Never delete paths sharing merely the copies directory prefix.
  const outside = { ...raw, uri: doc + '/uploads/files-other/raw' };
  const out = environment([[outside.uri, 'bytes']]);
  out.copyMode = 'throw';
  const [oid] = out.store.addUploads(slot, target, [outside]);
  await flush();
  out.store.removeUpload(slot, oid);
  assert.ok(out.disk.has(outside.uri));
  // Exact classification order and legacy strings; only authored provenance translates.
  const errors = e.load('@/features/submissions/uploadErrors');
  for (const [error, kind, message] of [
    [
      new CanvasNetworkError('quota'),
      'network',
      'Couldn’t reach Canvas. Check your connection, then retry.',
    ],
    [
      new CanvasError('QUOTA extension', 403),
      'quota',
      'Your Canvas storage is full. Delete files in Canvas, then retry.',
    ],
    [
      new CanvasError('EXTENSION media service', 403),
      'filetype',
      `This assignment doesn’t accept ${raw.name}.`,
    ],
    [new CanvasError('filetype'), 'filetype', `This assignment doesn’t accept ${raw.name}.`],
    [
      new CanvasError('MEDIA SERVICE', 403),
      'mediaService',
      'Canvas’s media service didn’t take the recording. Retry.',
    ],
    ...[401, 403].map((n) => [
      new CanvasError('raw', n),
      'forbidden',
      'Canvas didn’t allow this upload.',
    ]),
    ...[new CanvasError('raw', 500), Error('quota'), '', null, {}].map((v) => [
      v,
      'generic',
      'The upload didn’t finish. Retry, or remove the file.',
    ]),
  ]) {
    const described = errors.describeUploadError(error, raw.name);
    assert.equal(described.error, message);
    assert.equal(described.errorOrigin.kind, kind);
    if (kind === 'filetype') assert.equal(described.errorOrigin.name, raw.name);
  }
  const base = {
    id: 'legacy',
    file: raw,
    status: 'error',
    fraction: null,
    uploaded: null,
    media: null,
    error: 'raw error',
  };
  const presentation = e.load('@/features/submissions/uploadPresentation').uploadStatusText;
  // Provenance must be explicitly present, not inherited from another object.
  for (const origin of [
    Object.assign(Object.create({ kind: 'network' }), { unrelated: true }),
    Object.assign(Object.create({ name: 'inherited.txt' }), { kind: 'filetype', extra: true }),
  ]) {
    assert.equal(errors.uploadErrorOrigin(origin), undefined);
    for (const l of langs)
      assert.equal(
        presentation({ ...base, errorOrigin: origin }, rt.createTranslator(l), l),
        base.error,
      );
  }
  equal(errors.uploadErrorOrigin(Object.assign(Object.create(null), { kind: 'network' })), {
    kind: 'network',
  });
  const origins = [
    undefined,
    null,
    'network',
    {},
    { kind: 'unknown' },
    { kind: 'filetype' },
    { kind: 'filetype', name: 4 },
    { kind: 'network', extra: 1 },
    [],
    { kind: 'network' },
    { kind: 'filetype', name: 'ORIGINAL raw.txt' },
  ];
  for (const origin of origins)
    for (const detail of [
      '',
      errors.STOPPED,
      errors.LOST,
      'Couldn’t reach Canvas. Check your connection, then retry.',
      'RAW العربية',
      null,
    ]) {
      const item = {
        ...base,
        error: detail,
        ...(origin === undefined ? {} : { errorOrigin: origin }),
      };
      // Existing legacy error rows stay raw; null is a newly generated stopped message on restore.
      const seed = new Map([
        [picked, 'bytes'],
        [
          doc + '/uploads/a.json',
          JSON.stringify({ [slot]: { destination: { preflightPath: '/raw' }, items: [item] } }),
        ],
      ]);
      const x = environment(seed),
        rest = x.store.uploadsFor(slot)[0];
      assert.equal(rest.error, detail ?? errors.STOPPED);
      if (detail !== null) equal(rest.errorOrigin ?? null, origin ?? null);
      else equal(rest.errorOrigin, { kind: 'stopped' });
      for (const l of langs) {
        const t = rt.createTranslator(l);
        const recognized = errors.uploadErrorOrigin(origin);
        assert.equal(
          presentation(item, t, l),
          recognized
            ? recognized.kind === 'filetype'
              ? t('submissionUpload.filetype', { name: recognized.name })
              : t('submissionUpload.' + recognized.kind)
            : (detail ?? t('submissionUpload.failed')),
        );
      }
      // Trigger save without changing error metadata, then restore JSON again.
      x.store.moveUpload(slot, item.id, 1); // out of bounds is intentionally inert
      x.store.addUploads('comment|a|x|x', target, []);
      x.save();
      const again = environment(x.disk).store.uploadsFor(slot)[0];
      equal(again.errorOrigin ?? null, rest.errorOrigin ?? null);
      assert.equal(again.error, rest.error);
    }
  for (const status of ['uploading', 'done', 'error'])
    for (const missing of [false, true]) {
      const item = { ...base, status, error: errors.STOPPED };
      const seed = new Map([
        [
          doc + '/uploads/a.json',
          JSON.stringify({ [slot]: { destination: { preflightPath: '/raw' }, items: [item] } }),
        ],
      ]);
      if (!missing) seed.set(picked, 'bytes');
      const restored = environment(seed).store.uploadsFor(slot)[0];
      assert.equal(restored.status, status === 'done' ? 'done' : 'error');
      assert.equal(restored.fraction, status === 'done' ? 1 : null);
      if (status === 'done') assert.equal(restored.errorOrigin, undefined);
      else if (missing) assert.equal(restored.errorOrigin.kind, 'lost');
      else if (status === 'uploading') assert.equal(restored.errorOrigin.kind, 'stopped');
      else assert.equal(restored.errorOrigin, undefined);
    }
  // List uses production store and real locale/description helpers. Same hook instance switches
  // languages with no store/native mutations, while committed eligibility gates retained actions.
  const ui = environment(),
    u = ui.store;
  u.addUploads(slot, target, [raw]);
  ui.copies[0].resolve();
  await flush();
  ui.uploads[0].reject(Error('failed'));
  await flush();
  const locale = ui.load('@/i18n/runtime'),
    List = ui.load('@/features/submissions/UploadList').UploadList;
  const h = mount(List, { slot, items: u.uploadsFor(slot) });
  let first;
  for (const l of langs) {
    locale.setAccountLocale('a', l);
    const before = ui.calls.length,
      tree = h.render();
    assert.equal(ui.calls.length, before);
    const t = locale.createTranslator(l),
      buttons = all(tree, 'IconButton');
    assert.equal(
      buttons[0].props.accessibilityLabel,
      t('submissionUpload.retry', { name: raw.name }),
    );
    assert.equal(
      buttons[1].props.accessibilityLabel,
      t('submissionUpload.remove', { name: raw.name }),
    );
    assert.equal(
      all(tree, 'View').find((n) => n.props.accessible).props.accessibilityLabel,
      t('submissionUpload.row', { name: raw.name, status: t('submissionUpload.generic') }),
    );
    if (!first) first = buttons;
  }
  h.render({ slot, items: u.uploadsFor(slot), disabled: true });
  first.forEach((b) => b.props.onPress());
  assert.equal(ui.uploads.length, 1);
  assert.equal(u.uploadsFor(slot).length, 1);
  // An uncommitted enabling render does not override the committed disabled state.
  h.renderOnly({ slot, items: u.uploadsFor(slot), disabled: false });
  first[0].props.onPress();
  assert.equal(ui.uploads.length, 1);
  h.commit();
  first[0].props.onPress();
  first[0].props.onPress();
  assert.equal(ui.uploads.length, 2);
  assert.equal(u.uploadsFor(slot)[0].status, 'uploading');
  h.render({ slot, items: u.uploadsFor(slot) });
  first[0].props.onPress();
  assert.equal(ui.uploads.length, 2);
  ui.uploads[1].resolve({ id: 'done' });
  await flush();
  first[0].props.onPress();
  assert.equal(ui.uploads.length, 2);
  first[1].props.onPress();
  assert.equal(u.uploadsFor(slot).length, 0);
  h.unmount();
  for (const change of ['account', 'client', 'slot', 'items', 'unmount']) {
    account = { id: 'a' };
    client = clientA;
    const x = environment(),
      [id] = x.store.addUploads(slot, target, [raw]);
    x.copies[0].resolve();
    await flush();
    x.uploads[0].reject(Error('failed'));
    await flush();
    const List = x.load('@/features/submissions/UploadList').UploadList,
      p = { slot, items: x.store.uploadsFor(slot) },
      view = mount(List, p),
      buttons = all(view.render(), 'IconButton');
    if (change === 'account') account = { id: 'b' };
    if (change === 'client') client = clientB;
    if (change === 'unmount') view.unmount();
    else
      view.render({
        ...p,
        ...(change === 'slot'
          ? { slot: 'submission|b|1|2' }
          : change === 'items'
            ? { items: [] }
            : {}),
      });
    buttons.forEach((b) => b.props.onPress());
    assert.equal(x.uploads.length, 1);
    assert.equal(x.store.uploadsFor(slot)[0].id, id);
    // Returning to the original context must not revive the obsolete closure.
    if (change === 'account' || change === 'client') {
      account = { id: 'a' };
      client = clientA;
      view.render(p);
      buttons.forEach((b) => b.props.onPress());
      assert.equal(x.uploads.length, 1);
      assert.equal(x.store.uploadsFor(slot).length, 1);
    }
    if (change !== 'unmount') view.unmount();
  }
  account = { id: 'a' };
  client = clientA;
  for (const l of langs)
    for (const fraction of [null, -0.1, 0, 0.004, 0.005, 0.994, 0.999, 1, 1.1]) {
      const item = { ...base, status: 'uploading', fraction },
        t = rt.createTranslator(l);
      const expected =
        fraction === null || fraction <= 0
          ? t('submissionUpload.uploading')
          : fraction >= 1
            ? t('submissionUpload.finishing')
            : t('submissionUpload.percent', { percent: Math.round(fraction * 100) });
      assert.equal(presentation(item, t, l), expected);
      locale.setAccountLocale('a', l);
      const view = mount(List, { slot, items: [item] });
      fontScale = 1.4;
      const tree = view.render();
      equal(
        all(tree, 'View').find((n) => n.props.accessible).props.accessibilityValue ?? null,
        fraction === null ? null : { min: 0, max: 100, now: Math.round(fraction * 100) },
      );
      assert.equal(all(tree, 'ProgressBar')[0].props.value, fraction ?? 0.04);
      assert.ok(all(tree, 'Text').every((n) => n.props.numberOfLines === undefined));
      view.unmount();
      fontScale = 1;
    }
  for (const [name, mimeType, thumbnail] of [
    ['RAW.JPG', 'application/octet-stream', picked],
    ['raw.bin', 'image/png', picked],
    ['raw.pdf', 'application/pdf', null],
  ]) {
    const item = { ...base, file: { ...raw, name, mimeType }, status: 'done' };
    const view = mount(List, { slot, items: [item] });
    const tree = view.render();
    equal(all(tree, 'FileThumbnail')[0].props.file, {
      name,
      filename: name,
      contentType: mimeType,
      thumbnailUrl: thumbnail,
    });
    equal(
      all(tree, 'Text').map((n) => n.props.numberOfLines),
      [1, 2],
    );
    assert.equal(all(tree, 'ProgressBar').length, 0);
    view.unmount();
  }
  const kinds = e.load('@/features/files/kinds');
  for (const l of langs)
    for (const media of [null, { id: 'm', type: 'audio' }]) {
      const item = {
        ...base,
        status: 'done',
        file: { ...raw, size: null },
        uploaded: { size: 42 },
        media,
      };
      const t = rt.createTranslator(l);
      assert.equal(
        presentation(item, t, l),
        [
          kinds.describeFile({ name: raw.name, contentType: raw.mimeType }, l).label,
          kinds.formatSize(42, l),
          t(media ? 'submissionUpload.mediaDone' : 'submissionUpload.done'),
        ].join(' · '),
      );
    }
  await new Promise((resolve) => setImmediate(resolve));
  equal(unhandled, []);
  equal(unexpected, []);
  console.log(
    `PASS submission upload: ${Object.keys(catalogs.en).length} keys/locale; baseline, async copy, synchronous metadata, attempts, restore, raw origins, payloads, counts and committed UI guards (${process.env.TZ ?? 'default TZ'}).`,
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
