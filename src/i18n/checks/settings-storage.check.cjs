/* global __dirname */
// Executes the production Storage route, lifetime helper and size formatter; native/storage/query/sync boundaries are synthetic.
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
const depsEqual = (a, b) =>
  a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
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
  downloads: [],
  saved: [],
  images: [],
  clear: [],
  success: [],
  sync: [],
  settings: [],
  alerts: [],
  push: [],
  retry: [],
};
let env,
  queryClient,
  locale,
  focused,
  courses,
  settings,
  status,
  run,
  online,
  widgets,
  schoolTheme,
  savedRead,
  clearResult,
  syncResult;
const navigation = { isFocused: () => focused };
const rawCourse = {
  id: '27',
  code: 'Course 27',
  name: 'Not on your dashboard',
  color: 'raw-color',
};
function reset() {
  Object.values(calls).forEach((a) => {
    a.length = 0;
  });
  env = { account: { id: 'a' }, client: {} };
  queryClient = {};
  locale = 'en';
  focused = true;
  courses = {
    data: [rawCourse],
    isPending: false,
    isError: false,
    error: Error('raw server error'),
    refetch: async () => {
      calls.retry.push('courses');
    },
  };
  settings = {
    courses: { a: { 27: ['files'], '007': ['pages'] }, b: {} },
    schedule: 'off',
    wifiOnly: true,
  };
  status = { courses: { a: { 27: { bytes: 2500 } } } };
  run = null;
  online = true;
  widgets = { gradesEnabled: false };
  schoolTheme = false;
  savedRead = () => Promise.resolve(1000);
  clearResult = Promise.resolve();
  syncResult = Promise.resolve();
}
const setter = (key) => (value) => {
  calls.settings.push([key, value]);
};
const design = Object.fromEntries(
  [
    'Button',
    'Callout',
    'ListGroup',
    'ListItem',
    'Screen',
    'SegmentedControl',
    'Skeleton',
    'Switch',
    'Text',
  ].map((k) => [k, k]),
);
design.useTheme = () => ({ colors: { fgSubtle: 'subtle', fgMuted: 'muted' } });
design.haptics = { success: () => calls.success.push(true) };
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': {
    View: 'View',
    RefreshControl: 'RefreshControl',
    Alert: { alert: (...args) => calls.alerts.push(args) },
  },
  'expo-router': {
    Stack: { Screen: 'Stack.Screen' },
    router: { push: (v) => calls.push.push(v) },
    useIsFocused: () => focused,
    useNavigation: () => navigation,
    useFocusEffect: (fn) => react.useEffect(() => (focused ? fn() : undefined), [fn, focused]),
  },
  '@tanstack/react-query': { useQueryClient: () => queryClient },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/api/courses': { useDashboardCourses: () => courses },
  '@/features/files/download': {
    listDownloads: (id) => {
      calls.downloads.push(id);
      return [{ size: id === 'a' ? 1500 : 9000 }];
    },
  },
  '@/features/offline/cache': {
    savedDataSize: (...args) => {
      calls.saved.push(args);
      return savedRead();
    },
    imageCacheSize: (...args) => {
      calls.images.push(args);
      return 200;
    },
    clearCache: (...args) => {
      calls.clear.push(args);
      return clearResult;
    },
  },
  '@/features/offline/QueuedChanges': { QueuedChanges: 'QueuedChanges' },
  '@/features/offline/schoolTheme': {
    useSchoolThemeEnabled: () => schoolTheme,
    setSchoolThemeEnabled: setter('theme'),
  },
  '@/features/offline/useOnline': { useOnline: () => online },
  '@/features/sync/components': {
    CourseSyncList: 'CourseSyncList',
    CourseSyncSheet: 'CourseSyncSheet',
    SyncProgressCard: 'SyncProgressCard',
  },
  '@/features/sync/runner': {
    useSyncRun: () => run,
    startSync: (...args) => {
      calls.sync.push(args);
      return syncResult;
    },
  },
  '@/features/sync/settings': {
    useSyncSettings: () => settings,
    useSyncStatus: () => status,
    setSyncSchedule: setter('schedule'),
    setSyncWifiOnly: setter('wifi'),
  },
  '@/features/widgets/settings': {
    useWidgetSettings: () => widgets,
    setGradesWidgetEnabled: setter('widgets'),
  },
  '@/design': design,
  '@/i18n': { useTranslation: () => ({ locale, t: runtime.createTranslator(locale) }) },
  'lucide-react-native': {},
  '@/lib/dates': {},
};
function load(file, from = root) {
  if (Object.hasOwn(stubs, file)) return stubs[file];
  let p = file.startsWith('@/') ? path.join(root, file.slice(2)) : path.resolve(from, file);
  if (!path.extname(p)) p += fs.existsSync(p + '.ts') ? '.ts' : '.tsx';
  const alias = '@/' + path.relative(root, p).replace(/\.tsx?$/, '');
  if (Object.hasOwn(stubs, alias)) return stubs[alias];
  assert.ok(p.startsWith(root + '/'), 'unmocked module: ' + file);
  if (cache.has(p)) return cache.get(p);
  const code = ts.transpileModule(
    fs.readFileSync(
      process.env.SETTINGS_STORAGE_BEFORE && p.endsWith('/app/(app)/storage.tsx')
        ? process.env.SETTINGS_STORAGE_BEFORE
        : p,
      'utf8',
    ),
    {
      fileName: p,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const module = { exports: {} };
  cache.set(p, module.exports);
  new Function('require', 'module', 'exports', code)(
    (name) => load(name, path.dirname(p)),
    module,
    module.exports,
  );
  return module.exports;
}
const runtime = load('@/i18n/runtime');
const Screen = load('@/app/(app)/storage').default;
const { formatSize } = load('@/features/files/kinds');
function nodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap((v) => nodes(v, type));
  if (!tree || typeof tree !== 'object') return [];
  return [
    ...(tree.type === type ? [tree.props] : []),
    ...Object.values(tree.props ?? {}).flatMap((v) => nodes(v, type)),
  ];
}
const first = (h, type) => nodes(h.tree, type)[0];
const button = (h, key) =>
  nodes(h.tree, 'Button').find(
    (b) => b.children === runtime.createTranslator(locale)('settingsStorage.' + key),
  );
const refresh = (h) => first(h, 'RefreshControl');
const sheet = (h) => first(h, 'CourseSyncSheet');
const list = (h) => first(h, 'CourseSyncList');
const mountScreen = () => {
  const h = mount(() => jsx(Screen, {}));
  h.render();
  return h;
};
const settle = async (h) => {
  await flush();
  h.render();
};
const t = (key) => runtime.createTranslator(locale)('settingsStorage.' + key);
const cacheValue = (h) => nodes(h.tree, 'ListItem').find((n) => n.title === t('cache'))?.value;
const confirm = (h) => {
  (button(h, 'clear') ?? nodes(h.tree, 'Button')[0]).onPress();
  return calls.alerts.at(-1)[2][1].onPress;
};
const failure = (h, key) => nodes(h.tree, 'Callout').some((c) => c.children === t(key));
async function race(which) {
  reset();
  const a = deferred();
  savedRead = () => a.promise;
  const h = mountScreen();
  await flush();
  if (which === 'account') {
    const b = deferred();
    savedRead = () => b.promise;
    env = { account: { id: 'b' }, client: {} };
    h.render();
    await flush();
    b.resolve(8000);
    await settle(h);
    const value = nodes(h.tree, 'ListItem').find((n) => n.title === 'Cache').value;
    a.resolve(1000);
    await settle(h);
    assert.equal(
      nodes(h.tree, 'ListItem').find((n) => n.title === 'Cache').value,
      value,
      'late A measurement must not overwrite B',
    );
  } else if (which === 'refresh') {
    const task = refresh(h).onRefresh();
    h.render();
    assert.equal(refresh(h).refreshing, true, 'refresh stays active until measurement settles');
    a.reject(Error('synthetic measurement'));
    await task;
    await settle(h);
    assert.equal(refresh(h).refreshing, false);
    assert.ok(failure(h, 'measureFailed'));
  } else {
    a.resolve(1000);
    await settle(h);
    const c = deferred();
    clearResult = c.promise;
    confirm(h)();
    await flush();
    c.reject(Error('synthetic clear failure'));
    await settle(h);
    assert.equal(calls.success.length, 0, 'failed clear must not report success haptics');
    assert.ok(failure(h, 'clearFailed'));
    assert.equal(nodes(h.tree, 'Button')[0].loading, false);
  }
  h.unmount();
}
async function main() {
  if (process.env.SETTINGS_STORAGE_BEFORE) {
    await race(process.argv[2]);
    return;
  }
  const baseline = require('./settings-storage.baseline.json');
  const digest = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 3051);
    for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
      assert.equal(digest(catalog[key]), hash, lang + '/' + key);
  }
  for (const kind of ['account', 'refresh', 'clear']) await race(kind);
  for (const lang of ['en', 'fr', 'ar']) {
    reset();
    locale = lang;
    const h = mountScreen();
    await settle(h);
    assert.equal(first(h, 'Stack.Screen').options.title, t('title'));
    assert.deepEqual(list(h).courses[0], rawCourse, 'English-looking raw server names remain raw');
    assert.equal(
      list(h).courses[1].code,
      runtime.createTranslator(lang)('settingsStorage.courseFallback', { id: '007' }),
    );
    assert.equal(list(h).courses[1].id, '007');
    assert.equal(cacheValue(h), formatSize(1200, lang));
    assert.deepEqual(calls.downloads, ['a'], 'focus and status measurement coalesce');
    assert.deepEqual(calls.saved, [[]]);
    assert.deepEqual(calls.images, [[]]);
    assert.deepEqual(
      first(h, 'SegmentedControl').options.map((o) => o.value),
      ['off', 'daily', 'weekly'],
    );
    const dl = nodes(h.tree, 'ListItem').find((n) => n.title === t('downloads'));
    assert.equal(
      dl.value,
      runtime.createTranslator(lang)('settingsStorage.countSize', {
        count: 1,
        size: formatSize(1500, lang),
      }),
    );
    assert.equal(
      dl.accessibilityLabel,
      runtime.createTranslator(lang)('settingsStorage.downloadsLabel', {
        count: 1,
        size: formatSize(1500, lang),
      }),
    );
    dl.onPress();
    assert.deepEqual(calls.push, ['/files/downloads']);
    for (const schedule of ['off', 'daily', 'weekly']) {
      settings = { ...settings, schedule };
      h.render();
      assert.equal(
        nodes(h.tree, 'ListGroup').find((g) => g.header === t('automatic')).footer,
        t(
          schedule === 'off'
            ? 'scheduleOff'
            : schedule === 'daily'
              ? 'scheduleDaily'
              : 'scheduleWeekly',
        ),
      );
    }
    first(h, 'SegmentedControl').onChange('daily');
    first(h, 'SegmentedControl').onChange('weekly');
    nodes(h.tree, 'Switch').forEach((sw) => sw.onValueChange(!sw.value));
    assert.deepEqual(calls.settings, [
      ['schedule', 'daily'],
      ['wifi', false],
      ['widgets', true],
      ['theme', true],
    ]);
    button(h, 'sync').onPress();
    button(h, 'sync').onPress();
    await flush();
    assert.deepEqual(calls.sync, [[{ account: env.account, client: env.client }]]);
    h.unmount();
  }
  // Measurements from a newer status snapshot beat an older in-flight read.
  reset();
  const old = deferred();
  savedRead = () => old.promise;
  let h = mountScreen();
  await flush();
  const newer = deferred();
  savedRead = () => newer.promise;
  status = { ...status };
  h.render();
  await flush();
  newer.resolve(5500);
  await settle(h);
  old.resolve(1);
  await settle(h);
  assert.equal(cacheValue(h), formatSize(5700, 'en'));
  h.unmount();
  // Locale-only rerenders preserve selected raw and generated courses and valid callbacks.
  reset();
  h = mountScreen();
  await settle(h);
  list(h).onOpen('007');
  h.render();
  const closeOld = sheet(h).onClose;
  const beforeReads = calls.saved.length;
  locale = 'fr';
  h.render();
  assert.equal(sheet(h).course.id, '007');
  assert.equal(sheet(h).course.code, t('courseFallback').replace('{id}', '007'));
  assert.equal(calls.saved.length, beforeReads);
  closeOld();
  h.render();
  assert.equal(sheet(h).course, null);
  list(h).onOpen('27');
  h.render();
  closeOld();
  h.render();
  assert.equal(sheet(h).course.id, '27');
  const oldClose = sheet(h).onClose;
  list(h).onOpen('007');
  h.render();
  oldClose();
  h.render();
  assert.equal(sheet(h).course.id, '007');
  const staleOpen = list(h).onOpen;
  courses = { ...courses, data: [{ ...rawCourse, name: 'new raw' }] };
  h.render();
  staleOpen('27');
  h.render();
  assert.equal(sheet(h).course, null);
  h.unmount();
  // Selecting sync content must not dismiss the course sheet that hosts those controls.
  reset();
  h = mountScreen();
  await settle(h);
  list(h).onOpen('27');
  h.render();
  settings = {
    ...settings,
    courses: { ...settings.courses, a: { ...settings.courses.a, 27: ['files', 'pages'] } },
  };
  h.render();
  assert.equal(sheet(h).course?.id, '27', 'content selection keeps its course sheet open');
  settings = { ...settings, courses: { ...settings.courses, a: { '007': ['pages'] } } };
  h.render();
  assert.equal(sheet(h).course?.id, '27', 'turning off a dashboard course keeps its sheet open');
  list(h).onOpen('007');
  h.render();
  settings = { ...settings, courses: { ...settings.courses, a: {} } };
  h.render();
  assert.equal(sheet(h).course, null, 'a removed non-dashboard course no longer has a sheet');
  h.unmount();
  // Source replacement retires every exposed account action and global setting callback.
  for (const replace of [
    () => {
      env = { ...env, account: { id: 'b' } };
    },
    () => {
      env = { ...env, client: {} };
    },
    () => {
      queryClient = {};
    },
    () => {
      focused = false;
    },
  ]) {
    reset();
    h = mountScreen();
    await settle(h);
    const clear = confirm(h);
    const staleSync = button(h, 'sync').onPress;
    const schedule = first(h, 'SegmentedControl').onChange;
    const switches = nodes(h.tree, 'Switch');
    const open = list(h).onOpen;
    const pull = refresh(h).onRefresh;
    replace();
    h.render();
    clear();
    staleSync();
    schedule('daily');
    switches.forEach((sw) => sw.onValueChange(true));
    open('27');
    await pull();
    await settle(h);
    assert.equal(calls.clear.length, 0);
    assert.equal(calls.sync.length, 0);
    assert.equal(calls.settings.length, 0);
    assert.equal(sheet(h).course, null);
    h.unmount();
  }
  reset();
  h = mountScreen();
  await settle(h);
  const staleSync = button(h, 'sync').onPress;
  online = false;
  h.render();
  staleSync();
  await flush();
  assert.equal(calls.sync.length, 0);
  const schedule = first(h, 'SegmentedControl').onChange;
  settings = { ...settings, schedule: 'weekly' };
  h.render();
  schedule('daily');
  assert.equal(calls.settings.length, 0);
  h.unmount();
  // Latest native prompt wins; cancel/dismiss/duplicate callbacks are single-use.
  reset();
  h = mountScreen();
  await settle(h);
  const firstClear = confirm(h);
  const secondClear = confirm(h);
  firstClear();
  await flush();
  assert.equal(calls.clear.length, 0);
  secondClear();
  secondClear();
  await settle(h);
  assert.deepEqual(calls.clear, [[queryClient]]);
  assert.equal(calls.success.length, 1);
  const cancelClear = confirm(h);
  calls.alerts.at(-1)[2][0].onPress();
  cancelClear();
  await flush();
  assert.equal(calls.clear.length, 1);
  const dismissClear = confirm(h);
  calls.alerts.at(-1)[3].onDismiss();
  dismissClear();
  await flush();
  assert.equal(calls.clear.length, 1);
  h.unmount();
  // Once entered, global clear continues; replacement account waits and owns its fresh measurements.
  reset();
  h = mountScreen();
  await settle(h);
  const clearDone = deferred();
  clearResult = clearDone.promise;
  confirm(h)();
  await flush();
  assert.equal(calls.clear.length, 1);
  env = { account: { id: 'b' }, client: {} };
  h.render();
  await flush();
  assert.equal(calls.downloads.at(-1), 'a');
  clearDone.resolve();
  await settle(h);
  assert.equal(calls.success.length, 0);
  assert.equal(calls.downloads.at(-1), 'b');
  assert.ok(cacheValue(h));
  h.unmount();
  // Locale changes while failures are pending use the current catalog.
  reset();
  h = mountScreen();
  await settle(h);
  const rejected = deferred();
  clearResult = rejected.promise;
  confirm(h)();
  await flush();
  locale = 'ar';
  h.render();
  rejected.reject(Error('private failure'));
  await settle(h);
  assert.ok(failure(h, 'clearFailed'));
  h.unmount();
  // Abandoned renders don't steal ownership; unmount retires retained confirmations.
  reset();
  h = mountScreen();
  await settle(h);
  const valid = confirm(h);
  const original = env;
  env = { account: { id: 'b' }, client: {} };
  h.renderOnly();
  h.abandon();
  env = original;
  valid();
  await settle(h);
  assert.equal(calls.clear.length, 1);
  const retired = confirm(h);
  h.unmount();
  retired();
  await flush();
  assert.equal(calls.clear.length, 1);
  // Refresh work across status commits has independent settlement ownership.
  reset();
  h = mountScreen();
  await settle(h);
  const r1 = deferred();
  savedRead = () => r1.promise;
  const stalePull = refresh(h).onRefresh;
  const firstRefresh = stalePull();
  assert.equal(stalePull(), firstRefresh);
  h.render();
  await flush();
  status = { ...status };
  const r2 = deferred();
  savedRead = () => r2.promise;
  h.render();
  const secondRefresh = refresh(h).onRefresh();
  h.render();
  await flush();
  r1.resolve(10);
  await firstRefresh;
  await settle(h);
  assert.equal(refresh(h).refreshing, true);
  r2.reject(Error('second measurement'));
  await secondRefresh;
  await settle(h);
  assert.equal(refresh(h).refreshing, false);
  assert.ok(failure(h, 'measureFailed'));
  const reads = calls.saved.length;
  await stalePull();
  await settle(h);
  assert.equal(calls.saved.length, reads);
  h.unmount();
  // Replayed effects cannot coalesce into work from a retired setup epoch.
  reset();
  h = mountScreen();
  h.replay();
  await settle(h);
  assert.ok(cacheValue(h));
  h.unmount();
  // Running eligibility can change before the same account's sync rejects.
  reset();
  h = mountScreen();
  await settle(h);
  const syncFailure = deferred();
  syncResult = syncFailure.promise;
  button(h, 'sync').onPress();
  await flush();
  run = { accountId: 'a' };
  h.render();
  locale = 'fr';
  h.render();
  syncFailure.reject(Error('synthetic sync'));
  await settle(h);
  assert.ok(failure(h, 'syncFailed'));
  h.unmount();
  // A pre-clear snapshot cannot restore old bytes after a successful clear.
  reset();
  const preClear = deferred();
  savedRead = () => preClear.promise;
  h = mountScreen();
  await flush();
  const postClear = deferred();
  savedRead = () => postClear.promise;
  confirm(h)();
  await flush();
  postClear.resolve(30);
  await settle(h);
  preClear.resolve(9000);
  await settle(h);
  assert.equal(cacheValue(h), formatSize(230, 'en'));
  h.unmount();
  // A refresh after clear must not join a superseded pre-clear measurement.
  reset();
  const obsoleteRead = deferred();
  savedRead = () => obsoleteRead.promise;
  h = mountScreen();
  await flush();
  savedRead = () => Promise.resolve(20);
  confirm(h)();
  await settle(h);
  let completed = false;
  const freshPull = refresh(h)
    .onRefresh()
    .then(() => {
      completed = true;
    });
  await settle(h);
  assert.equal(completed, true);
  await freshPull;
  obsoleteRead.resolve(9000);
  await settle(h);
  assert.equal(cacheValue(h), formatSize(220, 'en'));
  h.unmount();
  // Query retry is source-owned, coalesced, and reports synthetic rejection.
  reset();
  courses = { ...courses, data: [], isError: true };
  settings = { ...settings, courses: { a: {} } };
  const retryFailure = deferred();
  courses.refetch = () => {
    calls.retry.push('courses');
    return retryFailure.promise;
  };
  h = mountScreen();
  await settle(h);
  const retry = nodes(h.tree, 'Callout').find((c) => c.action).action.onPress;
  retry();
  retry();
  await flush();
  assert.equal(calls.retry.length, 1);
  retryFailure.reject(Error('synthetic retry'));
  await settle(h);
  assert.ok(failure(h, 'coursesFailed'));
  courses = { ...courses, data: [rawCourse], isError: false };
  h.render();
  retry();
  await flush();
  assert.equal(calls.retry.length, 1);
  h.unmount();
  console.log(
    'settings-storage: production route/helper, locale baseline and synthetic race checks passed',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
