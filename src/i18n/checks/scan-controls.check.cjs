/* global __dirname */
// Executes ScanScreen, scanControlsLifetime and safe production page-store functions.
// All network, storage, picker, browser, query and account effects are synthetic and fail closed.
// The hook reconciler commits effects, discards renders, and replays effects; it is
// not React Compiler/native/event-order/AT acceptance. No HTTP or storage is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
let scope;
const depsEqual = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const effect = (kind) => (fn, deps) => {
  const s = scope,
    i = s.cursor++,
    old = s.slots[i];
  if (!old || !depsEqual(old.deps, deps)) {
    const slot = { deps, fn, kind, cleanup: null };
    s.slots[i] = slot;
    s.jobs[kind].push(() => {
      old?.cleanup?.();
      slot.cleanup = fn();
    });
  }
};
const react = {
  useState(initial) {
    const s = scope,
      i = s.cursor++;
    if (!s.slots[i]) {
      const slot = { value: typeof initial === 'function' ? initial() : initial };
      slot.set = (value) => {
        // React ignores updates to unmounted components (including retained Expo event callbacks).
        if (!s.mounted) return;
        const next = typeof value === 'function' ? value(slot.value) : value;
        if (!Object.is(next, slot.value)) {
          slot.value = next;
          s.host.dirty = true;
        }
      };
      s.slots[i] = slot;
    }
    return [s.slots[i].value, s.slots[i].set];
  },
  useRef(value) {
    const s = scope,
      i = s.cursor++;
    return (s.slots[i] ??= { current: value });
  },
  useMemo(fn, deps) {
    const s = scope,
      i = s.cursor++,
      old = s.slots[i];
    if (!old || !depsEqual(old.deps, deps)) s.slots[i] = { value: fn(), deps };
    return s.slots[i].value;
  },
  useCallback(fn, deps) {
    return react.useMemo(() => fn, deps);
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot();
  },
  useLayoutEffect: effect('layout'),
  useEffect: effect('passive'),
};
const jsx = (type, props, key) => ({ type, props, key });
function mount(fn) {
  const h = { nodes: new Map(), dirty: false, tree: null };
  let draft, saved, stateValues;
  function retire(s) {
    for (const slot of s.slots) slot?.cleanup?.();
    s.mounted = false;
  }
  function visit(node, at) {
    if (Array.isArray(node)) return node.map((v, i) => visit(v, `${at}.${i}`));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      let s = h.nodes.get(at);
      if (!s || s.type !== node.type || s.key !== node.key)
        s = { type: node.type, key: node.key, slots: [], host: h, mounted: true };
      saved.set(s, s.slots.slice());
      for (const slot of s.slots) if (slot?.set) stateValues.set(slot, slot.value);
      s.cursor = 0;
      s.jobs = { layout: [], passive: [] };
      draft.set(at, s);
      const old = scope;
      scope = s;
      let result;
      try {
        result = node.type(node.props);
      } finally {
        scope = old;
      }
      return visit(result, at + '.child');
    }
    return {
      ...node,
      props: { ...node.props, children: visit(node.props.children, at + '.children') },
    };
  }
  h.renderOnly = () => {
    draft = new Map();
    saved = new Map();
    stateValues = new Map();
    h.dirty = false;
    return visit(fn(), 'root');
  };
  h.abandon = () => {
    for (const [slot, value] of stateValues) slot.value = value;
    for (const [s, slots] of saved) s.slots = slots;
    draft = saved = null;
  };
  h.commit = () => {
    for (const [at, s] of h.nodes) if (draft.get(at) !== s) retire(s);
    h.nodes = draft;
    for (const kind of ['layout', 'passive'])
      for (const s of [...draft.values()].reverse()) for (const job of s.jobs[kind]) job();
    draft = saved = null;
  };
  h.render = () => {
    let limit = 20;
    do {
      assert.ok(limit--, 'render loop');
      h.tree = h.renderOnly();
      h.commit();
    } while (h.dirty);
    return h.tree;
  };
  h.replay = () => {
    for (const s of h.nodes.values()) for (const slot of s.slots) slot?.cleanup?.();
    for (const kind of ['layout', 'passive'])
      for (const s of [...h.nodes.values()].reverse())
        for (const slot of s.slots) if (slot?.kind === kind) slot.cleanup = slot.fn();
  };
  h.unmount = () => {
    for (const s of h.nodes.values()) retire(s);
    h.nodes.clear();
  };
  return h;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const calls = {
  capture: [],
  photos: [],
  build: [],
  uploads: [],
  back: [],
  success: [],
  error: [],
  alerts: [],
  announce: [],
};
let env,
  params,
  locale,
  route,
  activeKey,
  captureResult,
  photosResult,
  buildResult,
  uploadEffect,
  successEffect,
  focused;
const listeners = new Set();
const navigation = {
  getState: () => ({ index: 0, routes: [{ key: activeKey }] }),
  addListener: (event, fn) => {
    assert.equal(event, 'state');
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  isFocused: () => focused,
};
const unexpected = [];
const fail = (name) => () => {
  unexpected.push(name);
  throw Error('Forbidden boundary: ' + name);
};
class PickerPermissionError extends Error {
  constructor(message, options) {
    super(message);
    this.origin = options?.origin;
  }
}
class PickerUnavailableError extends Error {
  constructor(message, options) {
    super(message);
    this.origin = options?.origin;
  }
}
const design = Object.fromEntries(
  ['Button', 'Callout', 'Card', 'EmptyState', 'IconButton', 'Screen', 'Text'].map((x) => [x, x]),
);
design.haptics = {
  success: () => {
    calls.success.push(true);
    successEffect?.();
  },
  error: () => calls.error.push(true),
};
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': {
    View: 'View',
    Alert: { alert: (...args) => calls.alerts.push(args) },
    AccessibilityInfo: { announceForAccessibility: (v) => calls.announce.push(v) },
  },
  'expo-router': {
    useLocalSearchParams: () => params,
    useNavigation: () => navigation,
    useRoute: () => route,
    router: { back: () => calls.back.push(true) },
  },
  'expo-image': { Image: 'Image' },
  'expo-camera': {
    CameraView: {
      isDocumentScannerAvailable: process.env.SCAN_SCANNER !== '0',
      scanDocumentAsync: fail('scanner'),
    },
  },
  'expo-file-system': { File: fail('file'), Paths: {} },
  'expo-print': { printToFileAsync: fail('print') },
  '@/features/files/upload': {
    PickerPermissionError,
    PickerUnavailableError,
    pickPhotos: fail('Photos'),
    takePhoto: fail('camera'),
    timestampName: fail('filename'),
  },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/api/submissions': {
    submissionFilesPath: (c, a) => `/api/v1/courses/${c}/assignments/${a}/submissions/self/files`,
  },
  '@/features/submissions/uploadStore': {
    submissionSlot: (a, c, s) => `submission|${a}|${c}|${s}`,
    addUploads: (...args) => {
      calls.uploads.push(args);
      uploadEffect?.();
      return ['upload-id'];
    },
  },
  '@/features/course/CourseScope': { CourseScope: 'CourseScope' },
  '@/design': design,
  '@/i18n': { useTranslation: () => ({ locale, t: runtime.createTranslator(locale) }) },
  'lucide-react-native': Object.fromEntries(
    ['ArrowDown', 'ArrowUp', 'Camera', 'Image', 'ScanLine', 'Trash2'].map((x) => [x, x]),
  ),
};
function load(file, from = root) {
  if (Object.hasOwn(stubs, file)) return stubs[file];
  let p = file.startsWith('@/') ? path.join(root, file.slice(2)) : path.resolve(from, file);
  if (!path.extname(p)) p += fs.existsSync(p + '.ts') ? '.ts' : '.tsx';
  const alias = '@/' + path.relative(root, p).replace(/\.tsx?$/, '');
  if (Object.hasOwn(stubs, alias)) return stubs[alias];
  assert.ok(p.startsWith(root + '/'), 'unmocked module: ' + file);
  assert.ok(
    new Set([
      'i18n/runtime',
      'i18n/en',
      'i18n/fr',
      'i18n/ar',
      'features/submissions/scan',
      'features/submissions/scanControlsLifetime',
      'app/(app)/course/[courseId]/assignment/[assignmentId]/scan',
    ]).has(path.relative(root, p).replace(/\.tsx?$/, '')),
    'unapproved production import: ' + file,
  );
  if (cache.has(p)) return cache.get(p);
  const source = process.env.SCAN_BEFORE && p.endsWith('/scan.tsx') ? process.env.SCAN_BEFORE : p;
  const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    fileName: p,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  cache.set(p, module.exports);
  new Function('require', 'module', 'exports', 'fetch', 'setTimeout', 'setInterval', code)(
    (name) => load(name, path.dirname(p)),
    module,
    module.exports,
    fail('fetch'),
    fail('timer'),
    fail('interval'),
  );
  return module.exports;
}
const runtime = load('@/i18n/runtime');
const store = load('@/features/submissions/scan');
// Only pure in-memory store functions are real. None of the scanner/PDF functions are invoked.
stubs['@/features/submissions/scan'] = {
  ...store,
  capturePages: (...args) => {
    calls.capture.push(args);
    return captureResult;
  },
  pickPages: (...args) => {
    calls.photos.push(args);
    return photosResult;
  },
  buildPdf: (...args) => {
    calls.build.push(args);
    return buildResult;
  },
};
const Screen = load('@/app/(app)/course/[courseId]/assignment/[assignmentId]/scan').default;
const knownKeys = new Set();
const key = () => `${env.account.id}|${params.courseId}|${params.assignmentId}`;
const pdf = {
  uri: 'file:///raw%20العربية.pdf',
  name: 'Scan Oct 30 at 11.12.13.pdf',
  size: 4321,
  mimeType: 'application/pdf',
};
function reset(uris = []) {
  for (const k of knownKeys) store.clearPages(k);
  Object.values(calls).forEach((a) => (a.length = 0));
  env = { account: { id: 'account-a' }, client: {} };
  params = { courseId: '007', assignmentId: '009' };
  route = { key: 'route-1' };
  activeKey = route.key;
  locale = 'en';
  focused = true;
  captureResult = Promise.resolve([]);
  photosResult = Promise.resolve([]);
  buildResult = Promise.resolve(pdf);
  uploadEffect = successEffect = null;
  knownKeys.add(key());
  if (uris.length) store.addPages(key(), uris);
}
function nodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap((v) => nodes(v, type));
  if (!tree || typeof tree !== 'object') return [];
  return [
    ...(tree.type === type ? [tree.props] : []),
    ...Object.values(tree.props ?? {}).flatMap((v) => nodes(v, type)),
  ];
}
const t = (k, p) => runtime.createTranslator(locale)('scanControls.' + k, p);
const button = (h, k, p) => nodes(h.tree, 'Button').find((b) => b.children === t(k, p));
const first = (h, type) => nodes(h.tree, type)[0];
const capture = (h) =>
  button(h, store.hasDocumentScanner ? (store.pagesFor(key()).length ? 'scanMore' : 'scan') : 'photo')
    .onPress;
const build = (h) => button(h, 'addPdf', { count: store.pagesFor(key()).length }).onPress;
const at = (h, i = 0) => nodes(h.tree, 'View').filter((n) => n.onAccessibilityAction)[i];
const icon = (h, action, i) =>
  nodes(h.tree, 'IconButton').find((n) => n.accessibilityLabel === t(action, { count: i + 1 }));
const action = (h, a, i = 0) => at(h, i).onAccessibilityAction({ nativeEvent: { actionName: a } });
const mountScreen = () => {
  const h = mount(() => jsx(Screen, {}));
  h.render();
  return h;
};
const settle = async (h) => {
  await flush();
  h.render();
};
const prompt = (h) => {
  button(h, 'discardPages').onPress();
  return calls.alerts.at(-1);
};
const leave = () => {
  activeKey = 'another-route';
  [...listeners].forEach((fn) => fn());
};
const returnRoute = () => {
  activeKey = route.key;
  [...listeners].forEach((fn) => fn());
};
const replacements = {
  account: () => {
    env = { ...env, account: { id: 'account-b' } };
    knownKeys.add(key());
  },
  client: () => {
    env = { ...env, client: {} };
  },
  course: () => {
    params = { ...params, courseId: '008' };
    knownKeys.add(key());
  },
  assignment: () => {
    params = { ...params, assignmentId: '010' };
    knownKeys.add(key());
  },
  route: () => {
    route = { key: 'route-2' };
    activeKey = route.key;
  },
  leave,
  pages: () => store.addPages(key(), ['file:///new.png']),
  reorder: () => store.movePage(key(), store.pagesFor(key())[0].id, 1),
  remove: () => store.removePage(key(), store.pagesFor(key())[0].id),
};
let groups = 0;
async function test(name, fn) {
  await fn();
  groups++;
  console.log('PASS ' + name);
}
async function run() {
  // Failing-before probes execute the original route with the same synthetic boundaries.
  if (process.env.SCAN_BEFORE) {
    reset(['a', 'b']);
    const d = deferred();
    captureResult = d.promise;
    buildResult = d.promise;
    const h = mountScreen();
    if (process.env.SCAN_PROBE === 'duplicate') {
      capture(h)();
      capture(h)();
      assert.equal(calls.capture.length, 1, 'capture must claim before render');
    } else if (process.env.SCAN_PROBE === 'at') {
      const before = store.pagesFor(key());
      build(h)();
      action(h, 'remove');
      assert.equal(store.pagesFor(key()), before, 'AT must respect synchronous PDF claim');
    } else {
      const oldKey = key();
      capture(h)();
      replacements.account();
      h.render();
      d.resolve(['late']);
      await flush();
      assert.equal(store.pagesFor(oldKey).length, 2, 'old capture must not append after account replacement');
    }
    h.unmount();
    return;
  }
  await test('duplicate synchronous capture/Photos/PDF claims and exact engine args', async () => {
    reset(['a', 'b']);
    const d = deferred();
    captureResult = d.promise;
    let h = mountScreen();
    const cb = capture(h);
    cb();
    cb();
    button(h, 'photos').onPress();
    build(h)();
    assert.deepEqual(calls.capture, [[]]);
    assert.equal(calls.photos.length, 0);
    assert.equal(calls.build.length, 0);
    d.resolve(['file:///raw%20à.png']);
    await settle(h);
    assert.equal(store.pagesFor(key()).at(-1).uri, 'file:///raw%20à.png');
    const snapshot = store.pagesFor(key());
    const p = deferred();
    buildResult = p.promise;
    const make = build(h);
    make();
    make();
    capture(h)();
    assert.equal(calls.build.length, 1);
    assert.equal(calls.build[0][0], snapshot);
    assert.equal(calls.build[0].length, 1);
    p.resolve(pdf);
    await settle(h);
    assert.deepEqual(calls.uploads, [
      [
        `submission|account-a|007|009`,
        { client: env.client, preflightPath: '/api/v1/courses/007/assignments/009/submissions/self/files' },
        [pdf],
      ],
    ]);
    assert.equal(calls.uploads[0][2][0], pdf);
    assert.equal(calls.back.length, 1);
    assert.equal(calls.success.length, 1);
    assert.equal(store.pagesFor(key()).length, 0);
    make();
    assert.equal(calls.build.length, 1);
    h.unmount();
  });
  for (const [name, replace] of Object.entries(replacements)) {
    for (const kind of ['capture', 'photos', 'pdf'])
      await test(`${kind} retired by ${name}`, async () => {
        reset(['a', 'b']);
        const d = deferred();
        if (kind === 'capture') captureResult = d.promise;
        else if (kind === 'photos') photosResult = d.promise;
        else buildResult = d.promise;
        const h = mountScreen();
        const oldKey = key();
        const invoke =
          kind === 'pdf' ? build(h) : kind === 'photos' ? button(h, 'photos').onPress : capture(h);
        invoke();
        replace();
        h.render();
        const after = store.pagesFor(oldKey);
        d.resolve(kind === 'pdf' ? pdf : ['late']);
        await settle(h);
        assert.equal(store.pagesFor(oldKey), after);
        assert.equal(calls.uploads.length, 0);
        assert.equal(calls.back.length, 0);
        assert.equal(calls.success.length, 0);
        assert.equal(calls.announce.length, 0);
        invoke();
        assert.equal(calls[kind === 'pdf' ? 'build' : kind].length, 1);
        h.unmount();
      });
  }
  await test('unmount retires work but preserves stored page identities', async () => {
    for (const kind of ['capture', 'pdf']) {
      reset(['a']);
      const d = deferred();
      captureResult = buildResult = d.promise;
      const h = mountScreen();
      const before = store.pagesFor(key());
      (kind === 'pdf' ? build(h) : capture(h))();
      h.unmount();
      d.resolve(kind === 'pdf' ? pdf : ['late']);
      await flush();
      assert.equal(store.pagesFor(key()), before);
      assert.equal(calls.uploads.length, 0);
      const next = mountScreen();
      assert.equal(store.pagesFor(key()), before);
      next.unmount();
    }
  });
  await test('AT and buttons share busy, snapshot, bounds and unknown-action guards', async () => {
    reset(['a', 'b', 'c']);
    const h = mountScreen();
    const ids = store.pagesFor(key()).map((p) => p.id);
    const stale = at(h).onAccessibilityAction;
    icon(h, 'movePageDown', 0).onPress();
    h.render();
    assert.deepEqual(
      store.pagesFor(key()).map((p) => p.id),
      [ids[1], ids[0], ids[2]],
    );
    stale({ nativeEvent: { actionName: 'remove' } });
    assert.equal(store.pagesFor(key()).length, 3);
    action(h, 'moveUp', 1);
    h.render();
    assert.deepEqual(
      store.pagesFor(key()).map((p) => p.id),
      ids,
    );
    action(h, 'moveUp', 0);
    action(h, 'unknown', 0);
    assert.equal(store.pagesFor(key()).length, 3);
    action(h, 'remove', 1);
    h.render();
    assert.deepEqual(
      store.pagesFor(key()).map((p) => p.id),
      [ids[0], ids[2]],
    );
    const d = deferred();
    buildResult = d.promise;
    build(h)();
    const before = store.pagesFor(key());
    action(h, 'remove');
    action(h, 'moveDown');
    icon(h, 'removePage', 0).onPress();
    icon(h, 'movePageDown', 0).onPress();
    button(h, 'discardPages').onPress();
    assert.equal(store.pagesFor(key()), before);
    assert.equal(calls.alerts.length, 0);
    d.reject(Error('native-private'));
    await settle(h);
    icon(h, 'removePage', 0).onPress();
    h.render();
    assert.equal(store.pagesFor(key()).length, 1);
    h.unmount();
  });
  await test('retained button and AT/discard callbacks retire on each owner replacement', async () => {
    for (const replace of Object.values(replacements)) {
      reset(['a', 'b']);
      const h = mountScreen();
      const old = store.pagesFor(key()),
        oldKey = key();
      const actions = [
        icon(h, 'removePage', 0).onPress,
        icon(h, 'movePageDown', 0).onPress,
        () => atOld({ nativeEvent: { actionName: 'remove' } }),
        button(h, 'discardPages').onPress,
      ];
      const atOld = at(h).onAccessibilityAction;
      replace();
      h.render();
      const after = store.pagesFor(oldKey);
      actions.forEach((fn) => fn());
      assert.equal(store.pagesFor(oldKey), after);
      assert.equal(calls.alerts.length, 0);
      assert.ok(old);
      h.unmount();
    }
  });
  await test('discard replacement cancellation dismissal single-use and new-edit invalidation', async () => {
    reset(['a', 'b']);
    const h = mountScreen();
    let p = prompt(h);
    const firstConfirm = p[2][1].onPress;
    p = prompt(h);
    firstConfirm();
    assert.equal(store.pagesFor(key()).length, 2);
    p[2][0].onPress();
    p[2][1].onPress();
    assert.equal(store.pagesFor(key()).length, 2);
    p = prompt(h);
    p[3].onDismiss();
    p[2][1].onPress();
    assert.equal(store.pagesFor(key()).length, 2);
    p = prompt(h);
    icon(h, 'movePageDown', 0).onPress();
    p[2][1].onPress();
    assert.equal(store.pagesFor(key()).length, 2);
    h.render();
    p = prompt(h);
    p[2][1].onPress();
    p[2][1].onPress();
    assert.equal(store.pagesFor(key()).length, 0);
    assert.equal(calls.announce.filter((v) => v === t('discarded')).length, 1);
    store.addPages(key(), ['new']);
    p[2][1].onPress();
    assert.equal(store.pagesFor(key()).length, 1);
    h.unmount();
  });
  await test('discard ownership and capture claim invalidate retained native confirmations', async () => {
    for (const replace of Object.values(replacements)) {
      reset(['a', 'b']);
      const h = mountScreen(),
        p = prompt(h),
        oldKey = key();
      replace();
      h.render();
      const after = store.pagesFor(oldKey);
      p[2][1].onPress();
      assert.equal(store.pagesFor(oldKey), after);
      h.unmount();
    }
    reset(['a']);
    const h = mountScreen(),
      p = prompt(h);
    const d = deferred();
    captureResult = d.promise;
    capture(h)();
    p[2][1].onPress();
    assert.equal(store.pagesFor(key()).length, 1);
    d.resolve([]);
    await settle(h);
    p[2][1].onPress();
    assert.equal(store.pagesFor(key()).length, 1);
    h.unmount();
  });
  await test('locale-only updates preserve claims, current announcements, raw data and errors', async () => {
    for (const lang of ['en', 'fr', 'ar']) {
      reset();
      locale = lang;
      const h = mountScreen();
      assert.equal(first(h, 'CourseScope').title, t('title'));
      assert.equal(
        first(h, 'EmptyState').description,
        t(store.hasDocumentScanner ? 'scannerBody' : 'cameraBody'),
      );
      const d = deferred();
      captureResult = d.promise;
      const cb = capture(h);
      cb();
      locale = lang === 'en' ? 'fr' : 'ar';
      h.render();
      assert.equal(first(h, 'Text').children, t('capturing'));
      cb();
      assert.equal(calls.capture.length, 1);
      d.resolve(['raw://à%20file', 'raw://two']);
      await settle(h);
      assert.equal(calls.announce.at(-1), t('added', { count: 2 }));
      assert.deepEqual(
        nodes(h.tree, 'Image').map((n) => n.source.uri),
        ['raw://à%20file', 'raw://two'],
      );
      assert.equal(at(h).accessibilityLabel, t('page', { count: 1 }));
      assert.deepEqual(
        at(h).accessibilityActions.map((a) => a.name),
        ['moveDown', 'remove'],
      );
      const e = deferred();
      buildResult = e.promise;
      build(h)();
      locale = 'fr';
      h.render();
      assert.ok(nodes(h.tree, 'Text').some((n) => n.children === t('building')));
      e.reject(Error('private'));
      await settle(h);
      assert.equal(first(h, 'Callout').children, t('pdfFailed'));
      locale = 'ar';
      h.render();
      assert.equal(first(h, 'Callout').children, t('pdfFailed'));
      h.unmount();
    }
  });
  await test('structured picker metadata only; unknown/legacy errors get honest generic localized text', async () => {
    for (const [error, message] of [
      [new PickerPermissionError('private', { origin: 'camera-permission' }), 'permission'],
      [new PickerUnavailableError('private', { origin: 'camera-unavailable' }), 'unavailable'],
      [new PickerPermissionError('Allow camera access in Settings to take a photo.'), 'captureFailed'],
      [new PickerUnavailableError('private'), 'captureFailed'],
      [Error('private'), 'captureFailed'],
    ]) {
      reset();
      const d = deferred();
      captureResult = d.promise;
      const h = mountScreen();
      capture(h)();
      locale = 'fr';
      h.render();
      d.reject(error);
      await settle(h);
      assert.equal(first(h, 'Callout').children, t(message));
      locale = 'ar';
      h.render();
      assert.equal(first(h, 'Callout').children, t(message));
      assert.equal(calls.error.length, 0);
      h.unmount();
    }
  });
  await test('native modal focus loss and abandoned owner/locale renders preserve accepted work', async () => {
    reset();
    const d = deferred();
    captureResult = d.promise;
    const h = mountScreen();
    capture(h)();
    focused = false;
    h.render();
    const old = env;
    env = { account: { id: 'abandoned' }, client: {} };
    locale = 'fr';
    h.renderOnly();
    h.abandon();
    env = old;
    locale = 'en';
    d.resolve(['accepted']);
    await settle(h);
    assert.equal(store.pagesFor(key()).length, 1);
    assert.equal(calls.announce.at(-1), t('added', { count: 1 }));
    h.unmount();
  });
  await test('navigation departure retires immediately before render and return gets a fresh claim', async () => {
    reset(['a']);
    const d = deferred();
    captureResult = d.promise;
    const h = mountScreen();
    const old = capture(h);
    old();
    leave();
    returnRoute();
    h.render();
    d.resolve(['late']);
    await settle(h);
    assert.equal(store.pagesFor(key()).length, 1);
    old();
    assert.equal(calls.capture.length, 1);
    captureResult = Promise.resolve(['new']);
    capture(h)();
    await settle(h);
    assert.equal(store.pagesFor(key()).length, 2);
    h.unmount();
  });
  await test('upload and success reentrancy cannot clear new pages or navigate a replacement', async () => {
    for (const side of ['upload', 'success']) {
      reset(['a']);
      const h = mountScreen();
      if (side === 'upload') uploadEffect = () => store.addPages(key(), ['new']);
      else successEffect = () => store.addPages(key(), ['new']);
      build(h)();
      await settle(h);
      assert.equal(store.pagesFor(key()).at(-1).uri, 'new');
      assert.equal(calls.back.length, 0);
      assert.equal(calls.success.length, side === 'upload' ? 0 : 1);
      h.unmount();
    }
    reset(['a']);
    const h = mountScreen();
    uploadEffect = () => {
      replacements.account();
      h.render();
    };
    build(h)();
    await settle(h);
    assert.equal(calls.success.length, 0);
    assert.equal(calls.back.length, 0);
    assert.equal(store.pagesFor('account-a|007|009').length, 1);
    h.unmount();
  });
  await test('stale failures do not overwrite a replacement operation; Strict effect replay usable', async () => {
    reset();
    const d = deferred();
    captureResult = d.promise;
    const h = mountScreen();
    capture(h)();
    replacements.client();
    h.render();
    const fresh = deferred();
    captureResult = fresh.promise;
    capture(h)();
    d.reject(Error('old'));
    await settle(h);
    assert.equal(nodes(h.tree, 'Callout').length, 0);
    assert.ok(nodes(h.tree, 'Text').some((n) => n.children === t('capturing')));
    fresh.resolve(['new']);
    await settle(h);
    h.replay();
    h.render();
    captureResult = Promise.resolve([]);
    capture(h)();
    await settle(h);
    assert.equal(calls.capture.length, 3);
    h.unmount();
  });
  await test('empty page snapshot refuses retained PDF entry and Photos contract stays zero args', async () => {
    reset(['a']);
    const h = mountScreen();
    const make = build(h);
    store.clearPages(key());
    make();
    assert.equal(calls.build.length, 0);
    h.render();
    photosResult = Promise.resolve(['photo']);
    button(h, 'choosePhotos').onPress();
    await settle(h);
    assert.deepEqual(calls.photos, [[]]);
    assert.equal(store.pagesFor(key())[0].uri, 'photo');
    h.unmount();
  });
  await test('locale-switched PDF success and Photos cancellation retain the accepted contracts', async () => {
    reset(['a', 'b']);
    const h = mountScreen();
    const d = deferred();
    buildResult = d.promise;
    const before = store.pagesFor(key());
    const make = build(h);
    make();
    locale = 'ar';
    h.render();
    make();
    assert.equal(calls.build.length, 1);
    assert.equal(calls.build[0][0], before);
    d.resolve(pdf);
    await settle(h);
    assert.equal(calls.uploads.length, 1);
    assert.equal(calls.back.length, 1);
    assert.equal(calls.success.length, 1);
    h.unmount();
    reset();
    const canceled = deferred();
    photosResult = canceled.promise;
    const next = mountScreen();
    const choose = button(next, 'choosePhotos').onPress;
    choose();
    choose();
    capture(next)();
    assert.deepEqual(calls.photos, [[]]);
    assert.equal(calls.capture.length, 0);
    locale = 'fr';
    next.render();
    canceled.resolve([]);
    await settle(next);
    assert.equal(store.pagesFor(key()).length, 0);
    assert.equal(calls.announce.length, 0);
    assert.equal(nodes(next.tree, 'Callout').length, 0);
    photosResult = Promise.resolve(['raw']);
    button(next, 'choosePhotos').onPress();
    await settle(next);
    assert.equal(calls.photos.length, 2);
    next.unmount();
  });
  await test('locale-only edit/discard callbacks announce current language without altering page IDs', async () => {
    reset(['a', 'b']);
    const h = mountScreen();
    const oldMove = icon(h, 'movePageDown', 0).onPress;
    const ids = store.pagesFor(key()).map((p) => p.id);
    locale = 'fr';
    h.render();
    oldMove();
    h.render();
    assert.deepEqual(
      store.pagesFor(key()).map((p) => p.id),
      [ids[1], ids[0]],
    );
    assert.equal(calls.announce.at(-1), t('moved', { count: 2 }));
    const p = prompt(h);
    locale = 'ar';
    h.render();
    p[2][1].onPress();
    assert.equal(calls.announce.at(-1), t('discarded'));
    h.unmount();
  });
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'scan-controls.baseline.json'), 'utf8'));
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    for (const [k, hash] of Object.entries(baseline.catalogs[lang]))
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[k])).digest('hex'),
        hash,
        lang + '/' + k,
      );
    for (const [k, value] of Object.entries(baseline.additions[lang])) assert.deepEqual(catalog[k], value);
  }
  assert.deepEqual(unexpected, [], 'no forbidden native/network/timer boundaries entered');
  assert.equal(listeners.size, 0, 'navigation listeners released');
  console.log(
    `Scan controls: ${groups} groups; scanner=${store.hasDocumentScanner}; ${process.env.TZ}; synthetic boundaries only, no native/HTTP/storage effects.`,
  );
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
