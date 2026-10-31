const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
/** Production modules, fail-closed synthetic native/storage/query/router/picker/upload
 * boundaries. Hook effects commit after rendering; no React Compiler/native acceptance.
 * Already-started requests cannot be rolled back by these UI lifetime guards. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const baseline = require('./submission-form.baseline.json');
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
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
let scope;
const effect = (kind) => (fn, deps) => {
  const s = scope,
    i = s.cursor++,
    old = s.slots[i];
  if (!old || !deps || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
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

const { MutationObserver, QueryClient } = require('@tanstack/query-core');
const queryClient = new QueryClient({
  defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
});
const clientA = { id: 'A', post: boundary('postA') },
  clientB = { id: 'B', post: boundary('postB') };
let account = { id: 'accountA', user: { id: 'self' } },
  client = clientA,
  online = true;
let group = { data: null, isPending: false, isError: false },
  tools = { data: [] },
  mode = 'kaltura';
let receiver, pickerOptions, lastAttempt;
const store = new Map(),
  docs = new Map();
const docKey = (id, c, a, attempt, kind) => JSON.stringify([id, c, a, attempt, kind]);
const readDoc = (...args) => {
  const key = docKey(...args);
  if (!docs.has(key))
    docs.set(key, {
      value: args[4] === 'text' ? '<p>Raw عربية</p>' : 'example.com/a',
      loaded: true,
      consumed: false,
    });
  return docs.get(key);
};
const log =
  (name) =>
  (...args) =>
    calls.push([name, ...args]);
const native = {
  ...elements('View ScrollView TextInput'),
  Alert: { alert: boundary('alert') },
  AccessibilityInfo: { announceForAccessibility: log('announce') },
};
const formRoute = { key: 'submit' };
const formNavigation = {
  isFocused: () => true,
  getState: () => ({ index: 0, routes: [formRoute] }),
  addListener: () => () => {},
};
const mocks = {
  react: strict('react', react),
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': strict('native', native),
  'expo-router': {
    useNavigation: () => formNavigation,
    useRoute: () => formRoute,
    useIsFocused: () => true,
    router: { push: boundary('push'), replace: boundary('replace'), back: boundary('back') },
  },
  'lucide-react-native': strict(
    'icons',
    elements(
      'CircleCheck ExternalLink FilePen Plus Puzzle X Users FileType File FileArchive FileAudio FileCode FileHeadphone FileImage FileSpreadsheet FileText FileVideoCamera Globe Presentation',
    ),
  ),
  '@/canvas/session': { useCanvas: () => ({ account, client }) },
  '@/canvas/client': {
    CanvasError: class extends Error {},
    CanvasNetworkError: class extends Error {},
  },
  '@/canvas/uploads': {},
  '@/canvas/html': { htmlToText: () => fail('htmlToText') },
  '@/canvas/api/assignments': {
    assignmentKeys: { submission: (courseId, assignmentId) => ['courses', courseId, 'assignments', assignmentId, 'submission'], detail: (...v) => v, groups: (...v) => v },
    toSubmissionDetail: (v) => v,
  },
  '@tanstack/react-query': {
    useQueryClient: () => Object.assign(queryClient, { invalidateQueries: boundary('invalidate') }),
  },
  '@/canvas/query': {
    useAccountKey: () => account.id,
    useCanvasQuery: (key) =>
      key.includes('submission_group')
        ? group
        : key.includes('homework_tools')
          ? tools
          : fail('query ' + key),
    useCanvasMutation(fn, options) {
      const capturedClient = client;
      const config = { mutationFn: (request) => fn(capturedClient, request), ...options };
      const [observer] = react.useState(() => new MutationObserver(queryClient, config));
      react.useEffect(() => {
        observer.setOptions(config);
      });
      return { mutateAsync: observer.mutate, reset: observer.reset };
    },
  },
  '@/features/submissions/draftState': {
    consumeDraft: (target) => {
      calls.push(['consume', target]);
      for (const kind of ['text', 'url'])
        readDoc(
          target.accountId,
          target.courseId,
          target.assignmentId,
          target.attempt,
          kind,
        ).consumed = true;
    },
  },
  '@/features/submissions/drafts': {
    useDraft(id, c, a, kind, _empty, opts) {
      lastAttempt = opts.attempt;
      const doc = readDoc(id, c, a, opts.attempt, kind);
      return {
        ...doc,
        statusLabel: null,
        setValue: (value) => {
          calls.push(['draftEdit', id, c, a, kind, value]);
          if (!doc.consumed) doc.value = value;
        },
        clear: () => fail('unconditional clear'),
        captureForClear: () => (doc.consumed ? null : { value: doc.value }),
      };
    },
  },
  '@/features/submissions/useUploadedDraft': { useUploadedDraft: () => null },
  '@/features/submissions/useAddFiles': {
    useAddFiles: (options) => {
      pickerOptions = options;
      return { open: boundary('picker'), dismiss: boundary('dismiss'), notice: null, sheet: null };
    },
  },
  '@/features/submissions/UploadList': { UploadList: 'Uploads' },
  '@/features/submissions/MediaSubmission': {
    MediaPanel: 'Media',
    useMediaMode: () => ({ mode, retry: boundary('retry') }),
  },
  'expo-crypto': { randomUUID: require('node:crypto').randomUUID },
  '@/features/submissions/toolContent': {
    // Preserve direct receiver guard assertions, but use the real owned registry.
    registerToolEditor: (slot, editor) => {
      receiver = editor.receive;
      const stop = load('@/features/submissions/toolLaunch').registerToolEditor(slot, editor);
      return () => { stop(); if (receiver === editor.receive) receiver = null; };
    },
    revokeToolLaunch: (...args) => load('@/features/submissions/toolLaunch').revokeToolLaunch(...args),
    beginToolLaunch: (...args) => load('@/features/submissions/toolLaunch').beginToolLaunch(...args),
  },
  '@/features/content/browser': { useOpenSignedIn: () => boundary('browser') },
  '@/features/editor/RichEditor': {
    RichEditor: 'Editor',
    isBlankHtml: (s) => !s.replace(/<[^>]*>/g, '').trim(),
  },
  '@/features/offline/useOnline': { useOnline: () => online },
  '@/features/offline/connectivity': { isOnline: () => online },
  '@/features/grades/calculate': {},
  '@/features/grades/format': {},
  '@/design': strict('design', {
    ...elements(
      'Button Callout Card Icon IconButton IconTile ListGroup ListItem SegmentedControl Text TextField Avatar Skeleton',
    ),
    haptics: { success: log('success'), error: log('error') },
  }),
};
// Run the production slot/summary functions, with only store IO synthetic.
const summarySource = fs.readFileSync(
  path.join(root, 'features/submissions/uploadStore.ts'),
  'utf8',
);
const summaryModule = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(summarySource.slice(summarySource.indexOf('export const submissionSlot')), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports: summaryModule.exports, module: summaryModule },
);
mocks['@/features/submissions/uploadStore'] = {
  ...summaryModule.exports,
  useUploads: (slot) => store.get(slot) ?? [],
  uploadsFor: (slot) => store.get(slot) ?? [],
  removeUpload: (slot, id) => {
    calls.push(['remove', slot, id]);
    store.set(
      slot,
      (store.get(slot) ?? []).filter((v) => v.id !== id),
    );
  },
};
const allowed = new Set([
  'features/submissions/useSubmitAssignment',
  'features/planner/submissionCache',
  'features/submissions/SubmitForm',
  'features/submissions/toolLaunch',
  'features/submissions/formPresentation',
  'features/submissions/GroupCard',
  'features/submissions/rules',
  'canvas/api/submissions',
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
  if (isIntlPolyfills(name)) return intlPolyfills;
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
    __DEV__: false,
    URL,
    Date,
    Error,
    console,
    fetch: () => fail('fetch'),
    setTimeout: boundary('timer'),
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
const i18n = load('@/i18n/runtime'),
  dates = load('@/lib/dates');
const { SubmitForm } = load('@/features/submissions/SubmitForm');
const presentation = load('@/features/submissions/formPresentation'),
  rules = load('@/features/submissions/rules');
const slots = summaryModule.exports;
const view = (locale) => {
  i18n.setAccountLocale('test', locale);
  return i18n.createTranslator(locale);
};
const assignment = () => ({
  id: 'a',
  courseId: 'c',
  kind: 'assignment',
  name: 'Raw اسم',
  htmlUrl: 'https://canvas.test/a',
  allowedExtensions: [],
  submissionTypes: [
    'online_text_entry',
    'online_url',
    'online_upload',
    'media_recording',
    'student_annotation',
  ],
  allowedAttempts: 3,
  locked: false,
  lockExplanation: null,
  lockAt: null,
  canSubmit: true,
  groupCategoryId: null,
  dueAt: new Date('2025-01-01T00:30:00Z'),
  annotatableAttachmentId: 'doc',
  submission: { id: 'sub', attempt: 0, extraAttempts: 0 },
});
const props = (a = assignment(), initialType) => ({
  a,
  initialType,
  scrollViewRef: { current: null },
});
const renderChildren = (tree) => {
  if (!tree || typeof tree !== 'object') return tree;
  if (Array.isArray(tree)) return tree.map(renderChildren);
  if (typeof tree.type === 'function') {
    const h = mount(tree.type, tree.props);
    const value = renderChildren(h.render());
    h.unmount();
    return value;
  }
  return { ...tree, props: { ...tree.props, children: renderChildren(tree.props?.children) } };
};
const textOf = (tree) =>
  nodes(tree)
    .flatMap((n) => (typeof n.props?.children === 'string' ? [n.props.children] : []))
    .join(' | ');
const submitButton = (tree) => all(tree, 'Button').find((n) => n.props.size === 'lg');
const choose = (tree, type) => all(tree, 'SegmentedControl')[0].props.onChange(type);
const field = (tree) => all(tree, 'TextField').find((n) => n.props.multiline);
const result = () => ({
  attempt: 1,
  attempts: [],
  submittedAt: new Date('2025-01-01T00:30:00Z'),
  late: true,
});
const upload = (id = 'one', fileId = 'f') => ({
  id,
  status: 'done',
  file: { name: 'raw عربية', uri: 'file://raw' },
  uploaded: { id: fileId },
  media: null,
});
const reset = () => {
  assert.equal(
    [...queues.values()].reduce((n, q) => n + q.length, 0),
    0,
  );
  calls.length = 0;
  store.clear();
  docs.clear();
  account = { id: 'accountA', user: { id: 'self' } };
  client = clientA;
  online = true;
  group = { data: null, isPending: false, isError: false };
  tools = { data: [] };
  mode = 'kaltura';
  view('en');
  dates.setDisplayTimeZone('America/Toronto');
};
const alert = (tree) => {
  let args;
  allow('alert', (...v) => {
    args = v;
  });
  submitButton(tree).props.onPress();
  assert.ok(args);
  return args;
};
const successRequest = (clientName = 'A', pending) => {
  allow('post' + clientName, pending?.promise ?? result());
  for (let i = 0; i < 6; i++) allow('invalidate', undefined);
};
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

async function run() {
  for (const l of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + l)[l];
    assert.equal(Object.keys(baseline.catalogs[l]).length, 1805);
    for (const [k, v] of Object.entries(baseline.catalogs[l])) equal(catalog[k], v);
    equal(Object.keys(catalog).sort(), Object.keys(load('@/i18n/en').en).sort());
  }
  // Same-instance form, raw HTML/comment/title and explicit Canvas-zone child consumers.
  reset();
  let p = props(),
    h = mount(SubmitForm, p),
    tree = h.render();
  field(tree).props.onChangeText(' raw تعليق ');
  tree = h.render();
  const before = calls.length;
  for (const l of ['en', 'fr', 'ar']) {
    const t = view(l);
    tree = h.render();
    const expanded = renderChildren(tree);
    assert.ok(textOf(expanded).includes(p.a.name));
    assert.equal(all(tree, 'Editor')[0].props.label, t('submissionForm.yourText'));
    assert.equal(field(tree).props.value, ' raw تعليق ');
    assert.equal(all(tree, 'Editor')[0].props.value, '<p>Raw عربية</p>');
    const date = presentation.formDate(p.a.dueAt, dates.createDateContext(l, 'America/Toronto'));
    assert.ok(textOf(expanded).includes(date));
  }
  assert.equal(calls.length, before);
  let a = alert(tree);
  const snapshot = a[1];
  view('fr');
  tree = h.render();
  assert.equal(a[1], snapshot);
  successRequest();
  const send = a[2][1].onPress();
  a[2][1].onPress();
  submitButton(tree).props.onPress();
  await send;
  await settle();
  assert.equal(calls.filter((v) => v[0] === 'postA').length, 1);
  equal(calls.find((v) => v[0] === 'postA').slice(1), [
    '/api/v1/courses/c/assignments/a/submissions',
    {
      submission: { submission_type: 'online_text_entry', body: '<p>Raw عربية</p>' },
      comment: { text_comment: 'raw تعليق' },
    },
  ]);
  tree = h.render();
  const events = calls.length;
  for (const l of ['en', 'fr', 'ar']) {
    const t = view(l);
    tree = h.render();
    assert.ok(textOf(renderChildren(tree)).includes(t('submissionForm.submitted')));
  }
  assert.equal(calls.length, events);
  h.unmount();

  // Local drafts remain editable without connectivity or a loaded group roster.
  // Those conditions block submission, not preparation of text, URLs or comments.
  for (const unavailable of ['offline', 'group-pending', 'group-error']) {
    reset();
    online = unavailable !== 'offline';
    p = props({ ...assignment(), groupCategoryId: unavailable === 'offline' ? null : 'group' });
    if (unavailable !== 'offline')
      group = {
        data: null,
        isPending: unavailable === 'group-pending',
        isError: unavailable === 'group-error',
      };
    h = mount(SubmitForm, p);
    tree = h.render();
    const editor = all(tree, 'Editor')[0];
    assert.equal(editor.props.editable, true, unavailable + ': text stays editable');
    editor.props.onChange('<p>Offline عمل</p>');
    assert.equal(readDoc('accountA', 'c', 'a', 1, 'text').value, '<p>Offline عمل</p>');
    tree = h.render();
    assert.equal(field(tree).props.editable, true);
    field(tree).props.onChangeText('offline comment');
    tree = h.render();
    assert.equal(field(tree).props.value, 'offline comment');
    choose(tree, 'online_url');
    tree = h.render();
    const urlField = all(tree, 'TextField').find((node) => node.props.keyboardType === 'url');
    assert.equal(urlField.props.editable, true);
    urlField.props.onChangeText('https://offline.example/work');
    assert.equal(readDoc('accountA', 'c', 'a', 1, 'url').value, 'https://offline.example/work');
    tree = h.render();
    assert.equal(submitButton(tree).props.disabled, true);
    const localEvents = calls.length;
    submitButton(tree).props.onPress();
    assert.equal(calls.length, localEvents, 'no offline/unverified-group confirmation or post');
    h.unmount();
  }

  // Persistent classified and raw failures retranslate without repeating feedback/post.
  for (const error of [
    new mocks['@/canvas/client'].CanvasNetworkError('raw'),
    new Error('maximum number of allowed attempts'),
    new Error('Canvas returned an error 500'),
    new Error('Raw عربية.'),
    new Error(''),
    'raw string',
  ]) {
    reset();
    h = mount(SubmitForm, props());
    tree = h.render();
    a = alert(tree);
    allow('postA', () => Promise.reject(error));
    await a[2][1].onPress();
    const failure = presentation.formFailure(error),
      count = calls.length;
    for (const l of ['en', 'fr', 'ar']) {
      const t = view(l);
      tree = h.render();
      assert.ok(textOf(renderChildren(tree)).includes(presentation.failureText(failure, t)));
    }
    assert.equal(calls.length, count);
    h.unmount();
  }

  // Every native payload, URL normalization, media fallback and exact upload removal.
  for (const type of ['online_url', 'online_upload', 'media_recording', 'student_annotation'])
    for (const mediaMode of type === 'media_recording' ? ['file', 'kaltura'] : ['kaltura']) {
      reset();
      mode = mediaMode;
      p = props(assignment(), type);
      const slot =
        type === 'media_recording'
          ? slots.mediaSlot('accountA', 'c', 'a')
          : slots.submissionSlot('accountA', 'c', 'a');
      const item = upload();
      if (type === 'media_recording' && mode === 'kaltura') {
        item.uploaded = null;
        item.media = { id: 'media', type: 'audio' };
      }
      store.set(slot, [item]);
      h = mount(SubmitForm, p);
      tree = h.render();
      a = alert(tree);
      const pending = deferred();
      successRequest('A', pending);
      const send = a[2][1].onPress();
      await flush();
      store.set(slot, [item, upload('new', 'later')]);
      pending.resolve(result());
      await send;
      const body = calls.find((v) => v[0] === 'postA')[2];
      equal(
        body.submission,
        type === 'online_url'
          ? { submission_type: type, url: 'https://example.com/a' }
          : type === 'student_annotation'
            ? { submission_type: type, annotatable_attachment_id: 'doc' }
            : type === 'media_recording' && mode === 'kaltura'
              ? { submission_type: type, media_comment_id: 'media', media_comment_type: 'audio' }
              : { submission_type: 'online_upload', file_ids: ['f'] },
      );
      if (['online_upload', 'media_recording'].includes(type))
        equal(
          store.get(slot).map((v) => v.id),
          ['new'],
        );
      h.unmount();
    }

  // Validation and per-type surfaces; no requests from invalid/unfinished data.
  for (const [type, setup, key] of [
    [
      'online_text_entry',
      () => (readDoc('accountA', 'c', 'a', 1, 'text').value = '<p></p>'),
      'writeFirst',
    ],
    [
      'online_url',
      () => (readDoc('accountA', 'c', 'a', 1, 'url').value = 'not a url'),
      'urlInvalid',
    ],
    ['online_upload', () => {}, 'addFirst'],
    [
      'online_upload',
      () =>
        store.set(slots.submissionSlot('accountA', 'c', 'a'), [
          { ...upload(), status: 'uploading' },
        ]),
      'waitFiles',
    ],
    [
      'online_upload',
      () =>
        store.set(slots.submissionSlot('accountA', 'c', 'a'), [{ ...upload(), status: 'error' }]),
      'retryFiles',
    ],
    ['media_recording', () => (mode = 'checking'), 'checking'],
    ['media_recording', () => (mode = 'unknown'), 'mediaUnavailable'],
    ['media_recording', () => (mode = 'unavailable'), 'mediaUnavailable'],
    ['media_recording', () => {}, 'recordFirst'],
    [
      'media_recording',
      () =>
        store.set(slots.mediaSlot('accountA', 'c', 'a'), [{ ...upload(), status: 'uploading' }]),
      'waitMedia',
    ],
    [
      'media_recording',
      () => store.set(slots.mediaSlot('accountA', 'c', 'a'), [{ ...upload(), status: 'error' }]),
      'retryMedia',
    ],
  ]) {
    reset();
    setup();
    h = mount(SubmitForm, props(assignment(), type));
    for (const l of ['en', 'fr', 'ar']) {
      const t = view(l);
      tree = h.render();
      submitButton(tree).props.onPress();
      tree = h.render();
      if (type === 'online_url')
        assert.equal(all(tree, 'TextField')[0].props.error, t('submissionForm.' + key));
      else assert.ok(textOf(renderChildren(tree)).includes(t('submissionForm.' + key)));
    }
    assert.equal(calls.length, 0);
    h.unmount();
  }

  // Group prose uses loaded listed-member counts only and preserves empty names.
  for (const status of ['loaded', 'unavailable', undefined])
    for (const name of ['', 'مجموعة']) {
      reset();
      group = {
        data: {
          id: 'g',
          name,
          membersStatus: status,
          members: [
            { id: '1', name: '' },
            { id: '2', name: 'Raw' },
          ],
        },
        isPending: false,
        isError: false,
      };
      p = props({ ...assignment(), groupCategoryId: 'g' });
      h = mount(SubmitForm, p);
      for (const l of ['en', 'fr', 'ar']) {
        const t = view(l);
        tree = h.render();
        a = alert(tree);
        assert.ok(a[1].includes(t('submissionForm.groupNote')));
        const phrase = load('@/features/submissions/GroupCard').groupPhrase(group.data, t);
        assert.ok(a[1].includes(phrase));
        a[2][0].onPress();
      }
      successRequest();
      a = alert(h.render());
      await a[2][1].onPress();
      assert.ok(
        textOf(renderChildren(h.render())).includes(
          view('ar')('submissionForm.submittedGroup', { name }),
        ),
      );
      h.unmount();
    }

  // Tools preserve empty/RTL metadata and original LTI/link request shapes.
  for (const kind of ['lti', 'link', 'file']) {
    reset();
    p = props({ ...assignment(), submissionTypes: ['online_text_entry', 'online_upload'] });
    h = mount(SubmitForm, p);
    tree = h.render();
    receiver({
      kind,
      url: 'https://tool.test/raw',
      title: '',
      toolName: 'أداة',
      lookupUuid: 'uuid',
    });
    tree = h.render();
    if (kind === 'file') store.set(slots.submissionSlot('accountA', 'c', 'a'), [upload()]);
    const n = calls.length;
    for (const l of ['en', 'fr', 'ar']) {
      view(l);
      tree = h.render();
      if (kind !== 'file') assert.ok(textOf(renderChildren(tree)).includes('أداة'));
    }
    assert.equal(calls.length, n);
    a = alert(tree);
    successRequest();
    await a[2][1].onPress();
    const payload = calls.find((v) => v[0] === 'postA')[2].submission;
    equal(
      payload,
      kind === 'file'
        ? { submission_type: 'online_upload', file_ids: ['f'] }
        : {
            submission_type: 'basic_lti_launch',
            url: 'https://tool.test/raw',
            ...(kind === 'lti' ? { resource_link_lookup_uuid: 'uuid' } : {}),
          },
    );
    h.unmount();
  }

  // Duplicate Alert/cancel, stale actions and immediate edits (before React rerenders).
  reset();
  h = mount(SubmitForm, props());
  tree = h.render();
  a = alert(tree);
  submitButton(tree).props.onPress();
  a[2][0].onPress();
  const b = alert(tree);
  a[2][0].onPress();
  await a[2][1].onPress();
  successRequest();
  await b[2][1].onPress();
  assert.equal(calls.filter((v) => v[0] === 'postA').length, 1);
  h.unmount();
  const changes = [
    () => {
      online = false;
    },
    () => {
      readDoc('accountA', 'c', 'a', 1, 'text').value = 'replaced draft';
    },
    () => {
      readDoc('accountA', 'c', 'a', 1, 'text').consumed = true;
    },
    () => {
      field(tree).props.onChangeText('new comment');
    },
    () => {
      choose(tree, 'online_url');
    },
    () => {
      receiver({
        kind: 'lti',
        url: 'https://other.test',
        title: 'raw',
        toolName: 'raw',
        lookupUuid: null,
      });
    },
    () => {
      p = { ...p, a: { ...p.a, canSubmit: false } };
      tree = h.render(p);
    },
    () => {
      p = { ...p, a: { ...p.a, lockExplanation: '', locked: true } };
      tree = h.render(p);
    },
    () => {
      p = { ...p, a: { ...p.a, annotatableAttachmentId: 'new' } };
      tree = h.render(p);
    },
    () => {
      group = { ...group, data: { id: 'g', name: 'New', members: [] } };
      tree = h.render();
    },
    () => {
      readDoc('accountA', 'c', 'a', 1, 'text').loaded = false;
      tree = h.render();
    },
    () => {
      account = { ...account, id: 'other' };
      tree = h.render();
    },
    () => {
      client = clientB;
      tree = h.render();
    },
    () => {
      p = { ...p, a: { ...p.a, id: 'other' } };
      tree = h.render(p);
    },
  ];
  for (const change of changes) {
    reset();
    p = props();
    h = mount(SubmitForm, p);
    tree = h.render();
    a = alert(tree);
    change();
    await a[2][1].onPress();
    assert.equal(calls.filter((v) => v[0].startsWith('post')).length, 0);
    h.unmount();
  }

  // Pre-render upload changes, including same file ID with a different upload identity.
  for (const replacement of [
    [upload('two', 'f')],
    [upload(), upload('two', 'other')],
    [{ ...upload(), status: 'error' }],
  ]) {
    reset();
    const slot = slots.submissionSlot('accountA', 'c', 'a');
    store.set(slot, [upload()]);
    h = mount(SubmitForm, props(assignment(), 'online_upload'));
    tree = h.render();
    a = alert(tree);
    store.set(slot, replacement);
    await a[2][1].onPress();
    assert.equal(calls.filter((v) => v[0] === 'postA').length, 0);
    h.unmount();
  }

  // Owned retained input/picker/navigation callbacks cannot act after context replacement or pending.
  for (const pending of [false, true]) {
    reset();
    tools = { data: [{ id: 'tool', name: 'Raw', description: '' }] };
    h = mount(SubmitForm, props());
    tree = h.render();
    const edit = all(tree, 'Editor')[0].props.onChange,
      comment = field(tree).props.onChangeText,
      pick = receiver,
      navigation = all(tree, 'ListItem')[0].props.onPress;
    let send, d;
    if (pending) {
      a = alert(tree);
      d = deferred();
      successRequest('A', d);
      send = a[2][1].onPress();
      await flush();
    } else {
      client = clientB;
      tree = h.render();
    }
    const count = calls.length;
    edit('stale');
    comment('stale');
    pick({ kind: 'link', url: 'https://stale.test', toolName: 'stale', title: '' });
    navigation();
    assert.equal(calls.length, count);
    if (pending) {
      d.resolve(result());
      await send;
    }
    h.unmount();
  }

  // Installed MutationObserver: replacement before the mutationFn microtask, and late
  // resolve/reject; original API/hook consume/invalidation targets remain pinned.
  for (const change of ['client', 'account', 'assignment', 'unmount'])
    for (const reject of [false, true]) {
      reset();
      p = props();
      h = mount(SubmitForm, p);
      tree = h.render();
      a = alert(tree);
      const d = deferred();
      if (reject) allow('postA', d.promise);
      else successRequest('A', d);
      const send = a[2][1].onPress();
      if (change === 'client') client = clientB;
      else if (change === 'account') account = { ...account, id: 'new' };
      else if (change === 'assignment') p = { ...p, a: { ...p.a, id: 'new' } };
      if (change === 'unmount') h.unmount();
      else tree = h.render(p);
      if (reject) d.reject(new Error('old failure'));
      else d.resolve(result());
      await send;
      await settle();
      assert.equal(calls.filter((v) => v[0] === 'postA').length, 1);
      assert.equal(
        calls.filter((v) => ['error', 'success', 'announce', 'remove'].includes(v[0])).length,
        0,
      );
      if (!reject) {
        assert.ok(
          calls
            .filter((v) => v[0] === 'consume')
            .every((v) => v[1].accountId === 'accountA' && v[1].assignmentId === 'a'),
        );
        assert.ok(
          calls.filter((v) => v[0] === 'invalidate').every((v) => v[1].queryKey[0] === 'accountA'),
        );
      }
      if (change !== 'unmount') h.unmount();
    }

  // Request's own successful invalidation refetch consumes the attempt and advances
  // server state BEFORE mutateAsync settles. Receipt survives; editor stays pinned.
  reset();
  p = props();
  h = mount(SubmitForm, p);
  tree = h.render();
  a = alert(tree);
  allow('postA', result());
  const gate = deferred();
  allow('invalidate', () => {
    p = { ...p, a: { ...p.a, submission: { ...p.a.submission, attempt: 1 }, canSubmit: false } };
    tree = h.render(p);
    return gate.promise;
  });
  for (let i = 0; i < 5; i++) allow('invalidate', undefined);
  const ownSend = a[2][1].onPress();
  await settle();
  assert.equal(lastAttempt, 1);
  assert.ok(docs.get(docKey('accountA', 'c', 'a', 1, 'text')).consumed);
  gate.resolve();
  await ownSend;
  assert.ok(textOf(renderChildren(h.render())).includes('Submitted'));
  assert.equal(calls.filter((v) => v[0] === 'success').length, 1);
  h.unmount();

  // Ordinary refetch and locale changes leave an outstanding confirmation valid.
  reset();
  p = props();
  h = mount(SubmitForm, p);
  tree = h.render();
  a = alert(tree);
  p = { ...p, a: { ...p.a, submission: { ...p.a.submission }, score: 99 } };
  view('ar');
  tree = h.render(p);
  successRequest();
  await a[2][1].onPress();
  assert.equal(calls.filter((v) => v[0] === 'postA').length, 1);
  h.unmount();

  // Raw URL edits that normalize identically still invalidate the confirmed draft.
  reset();
  p = props(assignment(), 'online_url');
  h = mount(SubmitForm, p);
  tree = h.render();
  a = alert(tree);
  readDoc('accountA', 'c', 'a', 1, 'url').value = 'https://example.com/a';
  await a[2][1].onPress();
  assert.equal(calls.filter((v) => v[0] === 'postA').length, 0);
  h.unmount();

  // An old completion cannot unlock newer progress, even after returning to the same client.
  for (const reject of [false, true]) {
    reset();
    p = props();
    h = mount(SubmitForm, p);
    tree = h.render();
    a = alert(tree);
    const old = deferred();
    if (reject) allow('postA', old.promise);
    else successRequest('A', old);
    const oldSend = a[2][1].onPress();
    client = clientB;
    tree = h.render();
    const nextAlert = alert(tree),
      next = deferred();
    successRequest('B', next);
    const nextSend = nextAlert[2][1].onPress();
    await flush();
    if (reject) old.reject(new Error('old'));
    else old.resolve(result());
    await oldSend;
    tree = h.render();
    assert.equal(submitButton(tree).props.loading, true);
    assert.equal(calls.filter((v) => ['success', 'error', 'announce'].includes(v[0])).length, 0);
    next.resolve(result());
    await nextSend;
    assert.equal(calls.filter((v) => v[0] === 'success').length, 1);
    h.unmount();
  }

  // Changed upload-to-Canvas mapping is retained, as is an unposted second media entry.
  for (const mediaCase of [false, true]) {
    reset();
    const slot = (mediaCase ? slots.mediaSlot : slots.submissionSlot)('accountA', 'c', 'a');
    const first = mediaCase
      ? { ...upload(), uploaded: null, media: { id: 'm1', type: 'video' } }
      : upload();
    const second = { ...upload('two'), uploaded: null, media: { id: 'm2', type: 'audio' } };
    store.set(slot, mediaCase ? [first, second] : [first]);
    h = mount(SubmitForm, props(assignment(), mediaCase ? 'media_recording' : 'online_upload'));
    tree = h.render();
    a = alert(tree);
    const d = deferred();
    successRequest('A', d);
    const send = a[2][1].onPress();
    await flush();
    if (!mediaCase) store.set(slot, [upload('one', 'changed')]);
    d.resolve(result());
    await send;
    equal(
      store.get(slot).map((v) => v.id),
      mediaCase ? ['two'] : ['one'],
    );
    h.unmount();
  }

  // Annotation and browser children are real rendering consumers, with guarded navigation.
  reset();
  p = props(assignment(), 'student_annotation');
  h = mount(SubmitForm, p);
  tree = h.render();
  let expanded = renderChildren(tree),
    open = all(expanded, 'Button').find((n) => n.props.children === 'Open document').props.onPress;
  allow('push', undefined);
  open();
  assert.equal(calls.at(-1)[1].params.assignmentId, 'a');
  p = { ...p, a: { ...p.a, annotatableAttachmentId: 'replacement' } };
  tree = h.render(p);
  const n = calls.length;
  open();
  assert.equal(calls.length, n);
  p = { ...p, a: { ...p.a, annotatableAttachmentId: null } };
  for (const l of ['en', 'fr', 'ar']) {
    const t = view(l);
    tree = h.render(p);
    assert.ok(textOf(renderChildren(tree)).includes(t('submissionForm.noDocumentHelp')));
  }
  h.unmount();
  reset();
  const api = load('@/canvas/api/submissions'),
    isNative = api.isNativeSubmissionType;
  // Exercise the existing browser branch with a synthetic capability boundary;
  // production currently supports all five online types natively.
  api.isNativeSubmissionType = (type) => type !== 'online_upload' && isNative(type);
  p = props();
  h = mount(SubmitForm, p);
  for (const l of ['en', 'fr', 'ar']) {
    const t = view(l);
    tree = h.render();
    const browser = all(tree, 'ListItem').find(
      (n) =>
        n.props.title ===
        t('submissionForm.browser', { type: t('submissionForm.type.online_upload') }),
    );
    assert.ok(browser);
    allow('browser', undefined);
    await browser.props.onPress();
    assert.equal(calls.at(-1)[1], p.a.htmlUrl);
  }
  const oldBrowser = all(tree, 'ListItem').at(-1).props.onPress;
  client = clientB;
  tree = h.render();
  const prior = calls.length;
  oldBrowser();
  assert.equal(calls.length, prior);
  h.unmount();
  api.isNativeSubmissionType = isNative;

  // Tool metadata, plain links, picker launch and scan callbacks keep their original targets.
  reset();
  tools = { data: [{ id: 'id', name: '', description: 'وصف', domain: 'raw.test' }] };
  p = props();
  h = mount(SubmitForm, p);
  tree = h.render();
  const tool = all(tree, 'ListItem')[0];
  assert.equal(tool.props.title, '');
  assert.equal(tool.props.subtitle, 'وصف');
  allow('push', undefined);
  tool.props.onPress();
  const { launch, ...legacyParams } = calls.at(-1)[1].params;
  assert.equal(typeof launch, 'string');
  equal(legacyParams, { courseId: 'c', assignmentId: 'a', toolId: 'id', toolName: '' });
  receiver({ kind: 'link', url: 'https://raw.test/', title: '', toolName: '' });
  tree = h.render();
  assert.equal(all(tree, 'TextField')[0].props.value, 'https://raw.test/');
  choose(tree, 'online_upload');
  tree = h.render();
  const scan = pickerOptions.onScan;
  allow('push', undefined);
  scan();
  client = clientB;
  tree = h.render();
  const prev = calls.length;
  scan();
  assert.equal(calls.length, prev);
  h.unmount();

  // A speculative render cannot adopt new permissions/context or expose live callbacks.
  reset();
  p = props();
  h = mount(SubmitForm, p);
  tree = h.render();
  const committed = submitButton(tree).props.onPress;
  const speculative = h.renderOnly({ ...p, a: { ...p.a, id: 'speculative' } });
  submitButton(speculative).props.onPress();
  let seen;
  allow('alert', (...args) => {
    seen = args;
  });
  committed();
  assert.ok(seen[1].includes(p.a.name));
  seen[2][0].onPress();
  h.unmount();

  // Locale-only renders during a pending request preserve its claim and values.
  reset();
  p = props();
  h = mount(SubmitForm, p);
  tree = h.render();
  field(tree).props.onChangeText(' تعليق ');
  tree = h.render();
  a = alert(tree);
  const pendingLocale = deferred();
  successRequest('A', pendingLocale);
  const localeSend = a[2][1].onPress();
  await settle();
  const pendingEvents = calls.length;
  for (const l of ['fr', 'ar', 'en']) {
    view(l);
    tree = h.render();
    assert.equal(submitButton(tree).props.loading, true);
    assert.equal(field(tree).props.value, ' تعليق ');
    assert.equal(all(tree, 'Editor')[0].props.value, '<p>Raw عربية</p>');
  }
  assert.equal(calls.length, pendingEvents);
  pendingLocale.resolve(result());
  await localeSend;
  h.unmount();

  // Retained tool navigation is invalid when its listed target changes.
  reset();
  tools = { data: [{ id: 'tool', name: 'Old', description: null }] };
  h = mount(SubmitForm, props());
  tree = h.render();
  const removedTool = all(tree, 'ListItem')[0].props.onPress;
  tools = { data: [{ id: 'tool', name: 'New', description: null }] };
  tree = h.render();
  const toolEvents = calls.length;
  removedTool();
  assert.equal(calls.length, toolEvents);
  h.unmount();

  // Browser-only capability still permits its navigation with no selected native type.
  reset();
  const apiOnly = load('@/canvas/api/submissions'),
    savedNative = apiOnly.isNativeSubmissionType;
  apiOnly.isNativeSubmissionType = () => false;
  h = mount(SubmitForm, props({ ...assignment(), submissionTypes: ['online_upload'] }));
  tree = h.render();
  assert.equal(submitButton(tree), undefined);
  allow('browser', undefined);
  all(tree, 'ListItem')[0].props.onPress();
  h.unmount();
  apiOnly.isNativeSubmissionType = savedNative;

  // Cached receipt navigation needs no network, but still belongs to its completed context.
  reset();
  p = props();
  h = mount(SubmitForm, p);
  tree = h.render();
  a = alert(tree);
  successRequest();
  await a[2][1].onPress();
  const resultTree = renderChildren(h.render()),
    resultButtons = all(resultTree, 'Button');
  online = false;
  allow('replace', undefined);
  resultButtons[0].props.onPress();
  allow('back', undefined);
  resultButtons[1].props.onPress();
  equal(calls.slice(-2).map((entry) => entry[0]), ['replace', 'back']);
  client = clientB;
  tree = h.render();
  const navEvents = calls.length;
  resultButtons[0].props.onPress();
  resultButtons[1].props.onPress();
  assert.equal(calls.length, navEvents);
  h.unmount();

  // Legacy rule behavior is compared to the frozen, pre-migration production module,
  // including branch precedence, exact equality at close time and extra arithmetic.
  const legacyModule = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      require('./submission-picker.baseline.json').sources['features/submissions/rules.ts'],
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    { module: legacyModule, exports: legacyModule.exports, require: (n) => load(n), Date, URL },
  );
  for (const locked of [true, false])
    for (const lockExplanation of [null, '', 'عربي'])
      for (const allowedAttempts of [null, 0, 1, 3])
        for (const used of [0, 1, 4])
          for (const extra of [0, 2]) {
            const candidate = {
              ...assignment(),
              locked,
              lockExplanation,
              allowedAttempts,
              canSubmit: false,
              submission: { attempt: used, extraAttempts: extra },
              lockAt: new Date('2025-01-01T00:30:00Z'),
            };
            for (const at of [new Date('2025-01-01T00:30:00Z'), new Date('2025-01-01T00:30:01Z')])
              assert.equal(
                rules.submitBlocker(candidate, at),
                legacyModule.exports.submitBlocker(candidate, at),
              );
            assert.equal(
              rules.submitBlocker(candidate),
              legacyModule.exports.submitBlocker(candidate),
            );
            assert.equal(rules.attemptNote(candidate), legacyModule.exports.attemptNote(candidate));
          }

  // Pure presentation with independently specified expected legacy decisions.
  reset();
  const base = assignment(),
    now = new Date('2025-01-01T00:30:00Z');
  assert.equal(rules.submitBlocker({ ...base, locked: true, lockExplanation: '' }, now), '');
  assert.equal(rules.submitBlocker({ ...base, locked: true }, now), 'This assignment is locked.');
  assert.equal(
    rules.submitBlocker({ ...base, allowedAttempts: 1, submission: { attempt: 1 } }, now),
    'You’ve used your only attempt.',
  );
  assert.equal(rules.attemptNote({ ...base, allowedAttempts: null }), null);
  assert.equal(
    rules.attemptNote({
      ...base,
      allowedAttempts: 2,
      submission: { attempt: 1, extraAttempts: 1 },
    }),
    'This is attempt 2 of 3.',
  );
  assert.equal(
    rules.attemptNote({ ...base, allowedAttempts: 2, submission: { attempt: 1 } }),
    'This is your last attempt (2 of 2).',
  );
  for (const l of ['en', 'fr', 'ar']) {
    const t = view(l),
      dc = dates.createDateContext(l, 'America/Los_Angeles'),
      pr = presentation.formRules(t, dc);
    assert.equal(rules.submitBlocker({ ...base, locked: true, lockExplanation: '' }, now, pr), '');
    assert.equal(
      rules.submitBlocker({ ...base, locked: true, lockExplanation: 'Raw قفل' }, now, pr),
      'Raw قفل',
    );
    assert.equal(
      rules.submitBlocker(
        { ...base, allowedAttempts: 2, submission: { attempt: 3, extraAttempts: 1 } },
        now,
        pr,
      ),
      t('submissionForm.usedAttempts', { count: 3 }),
    );
    assert.equal(
      rules.submitBlocker({ ...base, lockAt: new Date('2024-12-31T23:59:00Z') }, now, pr),
      t('submissionForm.closed', {
        date: presentation.formDate(new Date('2024-12-31T23:59:00Z'), dc, now),
      }),
    );
    const date = presentation.formDate(now, dc, now);
    assert.ok(
      date.includes(
        new Intl.DateTimeFormat(l, {
          month: 'short',
          day: 'numeric',
          weekday: 'short',
          timeZone: 'America/Los_Angeles',
        }).format(now),
      ),
    );
    assert.equal(presentation.formTypeLabel('unknown_raw', t), 'unknown raw');
    assert.equal(
      presentation.formTypeLabel('basic_lti_launch', t),
      t('submissionForm.type.external_tool'),
    );
  }
  assert.equal(unexpected.length, 0);
  assert.equal(
    [...queues.values()].reduce((n, q) => n + q.length, 0),
    0,
  );
  console.log(
    'submission-form: production form/presentation/API, installed observer, catalog preservation and synthetic lifetime checks passed (' +
      process.env.TZ +
      ')',
  );
}
if (require.main === module) run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// Shared synthetic boundaries for the coordinated tool route/form check. No extra
// production imports are permitted by the ordinary form suite.
module.exports = {
  mount, load, mocks, allowed, native, elements, strict, boundary, log, calls, allow,
  reset, view, all, nodes, props, assignment, SubmitForm, deferred, flush, equal,
  alert, choose, field, store, slots, textOf, renderChildren, successRequest,
  setEnvironment(next) {
    if ('account' in next) account = next.account;
    if ('client' in next) client = next.client;
    if ('online' in next) online = next.online;
    if ('tools' in next) tools = next.tools;
    if ('group' in next) group = next.group;
  },
  environment: () => ({ account, client, online }),
  verifyBoundaries() {
    assert.equal(unexpected.length, 0);
    assert.equal([...queues.values()].reduce((n, q) => n + q.length, 0), 0);
  },
};
