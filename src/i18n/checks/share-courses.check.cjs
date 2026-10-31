/* global __dirname */
// Production CoursePicker, local controls, content classifier and courses adapter.
// Synthetic hooks/query/session/router/native boundaries; no HTTP or native effects.
// The reconciler models commits, abandoned renders and effect replay, not React Compiler.
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
        assert.ok(s.mounted, 'update after unmount');
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
react.useSyncExternalStore = (subscribe, snapshot) => {
  const [, update] = react.useState(0);
  react.useLayoutEffect(() => subscribe(() => update((n) => n + 1)), [subscribe]);
  return snapshot();
};
let env, locale, focused, query, queryClient, refreshResult, retryResult;
let listeners = {};
const calls = { router: [], refresh: [], retry: [] };
const navigation = {
  isFocused: () => focused,
  addListener(event, fn) {
    (listeners[event] ??= new Set()).add(fn);
    return () => listeners[event].delete(fn);
  },
};
const native = { RefreshControl: 'RefreshControl', View: 'View' };
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': native,
  'lucide-react-native': { BookOpen: 'BookOpen' },
  'expo-router': {
    Stack: { Screen: 'StackScreen' },
    useIsFocused: () => focused,
    useNavigation: () => navigation,
    router: { push: (target) => calls.router.push(target) },
  },
  '@tanstack/react-query': { useQueryClient: () => queryClient },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/query': { useAccountKey: () => env.account.id, useCanvasQuery: () => query },
  '@/features/files/kinds': {
    describeFile: () => {
      throw Error('Unexpected file inference');
    },
  },
  '@/design': {
    ...Object.fromEntries(
      [
        'Card',
        'EmptyState',
        'IconTile',
        'ListGroup',
        'ListItem',
        'Screen',
        'Text',
        'Callout',
        'Skeleton',
      ].map((x) => [x, x]),
    ),
    useTheme: () => ({ colors: { fgMuted: 'synthetic-muted' } }),
  },
  '@/i18n': { useTranslation: () => ({ locale, t: runtime.createTranslator(locale) }) },
};
function load(file, from = root) {
  if (Object.hasOwn(stubs, file)) return stubs[file];
  assert.ok(file.startsWith('@/') || file.startsWith('.'), 'Unmocked boundary: ' + file);
  let p = file.startsWith('@/') ? path.join(root, file.slice(2)) : path.resolve(from, file);
  if (!path.extname(p)) p += fs.existsSync(p + '.ts') ? '.ts' : '.tsx';
  const alias = '@/' + path.relative(root, p).replace(/\.tsx?$/, '');
  if (Object.hasOwn(stubs, alias)) return stubs[alias];
  assert.ok(p.startsWith(root + '/'), 'Unmocked import: ' + file);
  if (cache.has(p)) return cache.get(p);
  const source =
    process.env.SHARE_COURSES_BEFORE && p.endsWith('/share/CoursePicker.tsx')
      ? process.env.SHARE_COURSES_BEFORE
      : p;
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
  new Function('require', 'module', 'exports', code)(
    (name) => load(name, path.dirname(p)),
    module,
    module.exports,
  );
  return module.exports;
}
const runtime = load('@/i18n/runtime');
const content = load('@/features/share/content');
const { fetchAllCourses } = load('@/canvas/api/tabs');
const { CoursePicker } = load('@/features/share/CoursePicker');
const nodes = (tree, type) => {
  if (Array.isArray(tree)) return tree.flatMap((v) => nodes(v, type));
  if (!tree || typeof tree !== 'object') return [];
  return [
    ...(tree.type === type ? [tree.props] : []),
    ...nodes(tree.props.children, type),
    ...nodes(tree.props.leading, type),
    ...nodes(tree.props.refreshControl, type),
  ];
};
const first = (h, type) => nodes(h.tree, type)[0];
const rows = (h) => nodes(h.tree, 'ListItem');
const refresh = (h) => first(h, 'RefreshControl');
const retry = (h) => first(h, 'Callout').action.onPress;
const tr = (key, args) => runtime.createTranslator(locale)('shareCourses.' + key, args);
const file = {
  name: 'Shared file',
  uri: 'content://raw/الملف?x=%20',
  mimeType: 'x/custom',
  size: 17,
  isImage: false,
};
const payload = () => ({ files: [{ ...file }], url: 'https://raw.test/%20?x=1', text: '  RAW النص  ' });
const course = (id, extra = {}) => ({
  id,
  name: 'Untitled course',
  code: 'RAW-ع',
  color: '#abcdef',
  timing: 'current',
  restricted: false,
  isFavorite: false,
  term: null,
  ...extra,
});
const refetch = (...args) => {
  calls.retry.push(args);
  return retryResult();
};
function reset() {
  listeners = {};
  Object.values(calls).forEach((x) => x.splice(0));
  env = {
    account: {
      id: 'account-A',
      user: { id: 'user-A' },
      baseUrl: 'https://synthetic.invalid',
      host: 'synthetic.invalid',
    },
    client: {},
  };
  locale = 'en';
  focused = true;
  refreshResult = () => Promise.resolve();
  retryResult = () => Promise.resolve({});
  query = {
    data: [course('42'), course('99', { isFavorite: true })],
    isPending: false,
    isError: false,
    error: null,
    refetch,
  };
  queryClient = {
    refetchQueries: (...args) => {
      calls.refresh.push(args);
      return refreshResult();
    },
  };
  content.setSharedContent(payload());
  const h = mount(() => jsx(CoursePicker, {}));
  h.render();
  return h;
}
function focus(value) {
  focused = value;
  for (const listener of listeners[value ? 'focus' : 'blur'] ?? []) listener();
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
test('2995 historical hashes per language; future additions allowed', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'share-courses.baseline.json')));
  for (const lang of ['en', 'fr', 'ar']) {
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2995);
    const catalog = load('@/i18n/' + lang)[lang];
    for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
        hash,
        lang + '/' + key,
      );
    const keys = Object.keys(catalog)
      .filter((key) => key.startsWith('shareCourses.'))
      .sort();
    assert.ok(keys.length >= 11);
    assert.deepEqual(
      keys,
      Object.keys(load('@/i18n/en').en)
        .filter((key) => key.startsWith('shareCourses.'))
        .sort(),
    );
  }
});
test('real course classification, non-favorites, raw names/codes/colors and exact route', async () => {
  const h = reset();
  const wire = [
    { id: '42', name: 'Untitled course', course_code: 'RAW-ع', is_favorite: false },
    { id: '99', name: 'علم', course_code: 'ABC', is_favorite: true },
    { id: 'past', concluded: true },
    { id: 'future', term: { start_at: '2999-01-01T00:00:00Z' } },
    { id: 'restricted', access_restricted_by_date: true },
  ];
  const protocol = [];
  const data = await fetchAllCourses({
    getAll: async (...args) => {
      protocol.push(args);
      return wire;
    },
    get: async (...args) => {
      protocol.push(args);
      return { custom_colors: { course_42: '#123456' } };
    },
  });
  assert.deepEqual(protocol[0], [
    '/api/v1/courses',
    { include: ['term', 'favorites', 'concluded'], state: ['available', 'completed'] },
    { signal: undefined },
  ]);
  query = { ...query, data };
  h.render();
  assert.equal(rows(h).length, 2);
  assert.equal(rows(h)[0].title, 'Untitled course');
  assert.equal(rows(h)[0].subtitle, 'RAW-ع');
  assert.equal(rows(h)[0].leading.props.color, '#123456');
  rows(h)[0].onPress();
  assert.deepEqual(calls.router, [{ pathname: '/share/assignments/[courseId]', params: { courseId: '42' } }]);
  assert.deepEqual(content.kindOf(payload()), 'files');
  h.unmount();
});
test('all three catalogs; full payload messages, plural branches and unchanged payload', () => {
  const h = reset();
  for (locale of ['en', 'fr', 'ar']) {
    for (const count of [1, 2, 3, 11, 100]) {
      const value = { ...payload(), files: Array.from({ length: count }, () => ({ ...file })) };
      const original = JSON.stringify(value);
      content.setSharedContent(value);
      h.render();
      assert.equal(first(h, 'StackScreen').options.title, tr('title'));
      assert.equal(
        first(h, 'Text').children,
        count === 1 ? tr('filePrompt', { name: file.name }) : tr('filesPrompt', { count }),
      );
      assert.equal(JSON.stringify(value), original);
      assert.equal(rows(h)[0].title, 'Untitled course');
    }
    for (const [value, key] of [
      [{ files: [], url: 'https://raw.test', text: 'text' }, 'linkPrompt'],
      [{ files: [], url: null, text: ' RAW ' }, 'textPrompt'],
    ]) {
      content.setSharedContent(value);
      h.render();
      assert.equal(first(h, 'Text').children, tr(key));
    }
    content.setSharedContent({ files: [], url: null, text: ' \n ' });
    h.render();
    assert.equal(first(h, 'EmptyState').title, tr('emptyTitle'));
    assert.equal(first(h, 'EmptyState').description, tr('emptyBody'));
    assert.equal(nodes(h.tree, 'Text').length, 0);
    content.setSharedContent(payload());
    query = { ...query, data: [] };
    h.render();
    assert.equal(first(h, 'EmptyState').title, tr('noCoursesTitle'));
    assert.equal(first(h, 'EmptyState').description, tr('noCoursesBody'));
    query = { ...query, data: [course('42')] };
  }
  h.unmount();
});
test('pending/error/cached suppression and localized retry path', async () => {
  const h = reset();
  const stale = rows(h)[0].onPress;
  query = { ...query, isPending: true };
  h.render();
  assert.equal(rows(h).length, 0);
  assert.ok(nodes(h.tree, 'Skeleton').length);
  const error = new Error('Canvas raw erreur خطأ');
  query = { ...query, isPending: false, isError: true, error };
  for (locale of ['en', 'fr', 'ar']) {
    h.render();
    assert.equal(rows(h).length, 0);
    assert.equal(first(h, 'Callout').title, tr('loadError'));
    assert.equal(first(h, 'Callout').children, error.message);
    assert.equal(first(h, 'Callout').action.label, runtime.createTranslator(locale)('common.retry'));
  }
  stale();
  assert.equal(calls.router.length, 0);
  await retry(h)();
  assert.equal(calls.retry.length, 1);
  query = { ...query, isError: false, error: null };
  h.render();
  assert.equal(rows(h).length, 2);
  h.unmount();
});
test('duplicate navigation claimed before render and across query/locale updates', () => {
  const h = reset();
  const [a, b] = rows(h);
  a.onPress();
  b.onPress();
  a.onPress();
  assert.equal(calls.router.length, 1);
  locale = 'ar';
  query = { ...query, data: [...query.data] };
  h.render();
  rows(h)[0].onPress();
  assert.equal(calls.router.length, 1);
  h.unmount();
});
test('locale-only updates preserve retained selection and refresh context', async () => {
  const h = reset();
  const old = rows(h)[0].onPress;
  locale = 'fr';
  env = { ...env, account: { ...env.account, user: { ...env.account.user } } };
  h.render();
  old();
  assert.equal(calls.router.length, 1);
  h.unmount();
  const h2 = reset();
  const oldRefresh = refresh(h2).onRefresh;
  locale = 'ar';
  h2.render();
  await oldRefresh();
  assert.equal(calls.refresh.length, 1);
  h2.unmount();
});
for (const [name, change] of [
  [
    'account',
    () => {
      env.account = { ...env.account, id: 'B' };
    },
  ],
  [
    'user',
    () => {
      env.account.user.id = 'B';
    },
  ],
  [
    'base URL',
    () => {
      env.account.baseUrl = 'https://other.invalid';
    },
  ],
  [
    'client',
    () => {
      env.client = {};
    },
  ],
  [
    'query client',
    () => {
      queryClient = { ...queryClient };
    },
  ],
  [
    'query data',
    () => {
      query = { ...query, data: [...query.data] };
    },
  ],
  [
    'refetch',
    () => {
      query = { ...query, refetch: (...args) => refetch(...args) };
    },
  ],
  ['payload', () => content.setSharedContent(payload())],
])
  test(name + ' replacement retires rows, retries and refreshes', async () => {
    const h = reset();
    const row = rows(h)[0].onPress;
    const oldRefresh = refresh(h).onRefresh;
    change();
    h.render();
    row();
    await oldRefresh();
    assert.equal(calls.router.length, 0);
    assert.equal(calls.refresh.length, 0);
    rows(h)[0].onPress();
    assert.equal(calls.router.length, 1);
    h.unmount();
    const h2 = reset();
    query = { ...query, isError: true, error: new Error('raw') };
    h2.render();
    const oldRetry = retry(h2);
    change();
    h2.render();
    await oldRetry();
    assert.equal(calls.retry.length, 0);
    await retry(h2)();
    assert.equal(calls.retry.length, 1);
    h2.unmount();
  });
test('event-time focus, blur-return lifetime, unmount and replay', async () => {
  for (const transition of ['event', 'blur-return', 'unmount', 'replay']) {
    const h = reset();
    const row = rows(h)[0].onPress;
    const pull = refresh(h).onRefresh;
    if (transition === 'event') focused = false;
    if (transition === 'blur-return') {
      focus(false);
      focus(true);
    }
    if (transition === 'unmount') h.unmount();
    if (transition === 'replay') h.replay();
    row();
    await pull();
    assert.equal(calls.router.length, 0, transition);
    assert.equal(calls.refresh.length, 0, transition);
    if (transition !== 'unmount') {
      if (transition === 'event') {
        h.render();
        focused = true;
      }
      h.render();
      rows(h)[0].onPress();
      assert.equal(calls.router.length, 1, transition);
      h.unmount();
    }
  }
});
test('abandoned source/query renders do not admit draft actions or retire committed actions', async () => {
  for (const changeSource of [true, false]) {
    const h = reset();
    const oldRow = rows(h)[0].onPress;
    if (changeSource) env.client = {};
    else query = { ...query, data: [...query.data] };
    const draft = h.renderOnly();
    nodes(draft, 'ListItem')[0].onPress();
    await nodes(draft, 'RefreshControl')[0].onRefresh();
    assert.equal(calls.router.length, 0);
    assert.equal(calls.refresh.length, 0);
    h.abandon();
    oldRow();
    assert.equal(calls.router.length, 1);
    h.unmount();
  }
});
test('rejected refreshes recover, deduplicate and preserve original query arguments', async () => {
  const h = reset();
  const d = deferred();
  refreshResult = () => d.promise;
  const oldRow = rows(h)[0].onPress;
  const pull = refresh(h).onRefresh;
  const pending = pull();
  void pull();
  oldRow();
  assert.equal(calls.refresh.length, 1);
  assert.equal(calls.router.length, 0);
  assert.deepEqual(calls.refresh[0], [
    { queryKey: ['account-A', 'courses', 'all'], type: 'active' },
    { throwOnError: true },
  ]);
  h.render();
  assert.equal(refresh(h).refreshing, true);
  query = { ...query, data: [...query.data] };
  h.render();
  d.reject(new Error('refresh failed raw'));
  await assert.doesNotReject(() => pending);
  h.render();
  assert.equal(refresh(h).refreshing, false);
  assert.equal(rows(h).length, 0);
  assert.equal(first(h, 'Callout').children, 'refresh failed raw');
  await retry(h)();
  assert.deepEqual(calls.retry[0], [{ throwOnError: true }]);
  h.render();
  assert.equal(rows(h).length, 2);
  h.unmount();
});
test('retry rejection and synchronous refresh throws remain recoverable in every locale', async () => {
  const h = reset();
  for (locale of ['en', 'fr', 'ar']) {
    refreshResult = () => {
      throw null;
    };
    h.render();
    await assert.doesNotReject(() => refresh(h).onRefresh());
    h.render();
    assert.equal(first(h, 'Callout').children, tr('retryFailed'));
    retryResult = () => Promise.reject(new Error('retry raw'));
    await assert.doesNotReject(() => retry(h)());
    h.render();
    assert.equal(first(h, 'Callout').children, 'retry raw');
    retryResult = () => Promise.resolve({});
    await retry(h)();
    h.render();
    assert.equal(rows(h).length, 2);
  }
  h.unmount();
});
test('late refresh settlement cannot change a replacement/replayed/unmounted owner', async () => {
  for (const transition of ['replacement', 'replay', 'unmount']) {
    const h = reset();
    const d = deferred();
    refreshResult = () => d.promise;
    const pending = refresh(h).onRefresh();
    h.render();
    if (transition === 'replacement') {
      env.client = {};
      h.render();
    }
    if (transition === 'replay') {
      h.replay();
      h.render();
    }
    if (transition === 'unmount') h.unmount();
    d.reject(new Error('obsolete'));
    await pending;
    await flush();
    if (transition !== 'unmount') {
      h.render();
      assert.equal(rows(h).length, 2);
      assert.equal(refresh(h).refreshing, false);
      h.unmount();
    }
  }
});
test('empty payload retires cached rows and cannot retry or refresh', async () => {
  const h = reset();
  const row = rows(h)[0].onPress;
  const pull = refresh(h).onRefresh;
  content.setSharedContent(content.EMPTY);
  h.render();
  row();
  await pull();
  await refresh(h).onRefresh();
  assert.equal(calls.router.length, 0);
  assert.equal(calls.refresh.length, 0);
  h.unmount();
});
test('retained retries reject event-time blur, replay and unmount', async () => {
  for (const transition of ['blur', 'replay', 'unmount']) {
    const h = reset();
    query = { ...query, isError: true, error: new Error('raw') };
    h.render();
    const oldRetry = retry(h);
    if (transition === 'blur') focused = false;
    if (transition === 'replay') h.replay();
    if (transition === 'unmount') h.unmount();
    await oldRetry();
    assert.equal(calls.retry.length, 0, transition);
    if (transition !== 'unmount') h.unmount();
  }
});
test('old completion does not release a newer refresh claim', async () => {
  const h = reset();
  const old = deferred();
  refreshResult = () => old.promise;
  const oldPending = refresh(h).onRefresh();
  h.render();
  env.client = {};
  h.render();
  const current = deferred();
  refreshResult = () => current.promise;
  const currentPending = refresh(h).onRefresh();
  h.render();
  old.reject(new Error('old raw'));
  await oldPending;
  h.render();
  assert.equal(refresh(h).refreshing, true);
  assert.equal(nodes(h.tree, 'Callout').length, 0);
  await refresh(h).onRefresh();
  assert.equal(calls.refresh.length, 2);
  current.resolve();
  await currentPending;
  h.render();
  assert.equal(refresh(h).refreshing, false);
  rows(h)[0].onPress();
  assert.equal(calls.router.length, 1);
  h.unmount();
});
test('publication snapshots preserve legacy payloads and their own identity during reentrant publication', () => {
  const originalHook = react.useSyncExternalStore;
  let subscribe;
  let unsubscribe = () => {};
  try {
    react.useSyncExternalStore = (listener, read) => {
      subscribe = listener;
      return read();
    };
    const initial = content.useSharedContentSnapshot();
    assert.equal(initial, content.getSharedContentSnapshot());
    assert.equal(content.useSharedContent(), initial.content);
    const value = payload();
    let republish = true;
    let replacement;
    unsubscribe = subscribe(() => {
      if (republish) {
        republish = false;
        replacement = content.setSharedContent(value);
      }
    });
    const published = content.setSharedContent(value);
    assert.equal(published.revision, initial.revision + 1);
    assert.equal(replacement.revision, published.revision + 1);
    assert.notEqual(published, replacement);
    assert.equal(content.getSharedContentSnapshot(), replacement);
    assert.equal(published.content, value, 'legacy payload identity is preserved');
    assert.equal(content.useSharedContent(), value);
    assert.equal(Object.isFrozen(published), true);
    assert.equal(content.getSharedContentSnapshot(), content.getSharedContentSnapshot());
  } finally {
    unsubscribe();
    react.useSyncExternalStore = originalHook;
  }
});
test('new publication or in-place payload change retires old controls before React commits', async () => {
  for (const change of ['replace', 'replace-return', 'same-reference', 'mutate']) {
    const h = reset();
    const value = payload();
    content.setSharedContent(value);
    h.render();
    const select = rows(h)[0].onPress;
    const pull = refresh(h).onRefresh;
    if (change === 'mutate') value.files[0].name = 'changed-before-commit.pdf';
    else {
      content.setSharedContent(change === 'same-reference' ? value : payload());
      if (change === 'replace-return') content.setSharedContent(value);
    }
    select();
    await pull();
    assert.equal(calls.router.length, 0, change + ' cannot select the retired share');
    assert.equal(calls.refresh.length, 0, change + ' cannot enter an old refresh');
    h.render();
    rows(h)[0].onPress();
    assert.equal(calls.router.length, 1, change + ' allows the newly committed share');
    h.unmount();
  }
});
(async () => {
  let failed = 0;
  for (const [name, run] of tests) {
    try {
      await run();
    } catch (error) {
      failed++;
      console.error('FAIL ' + name + ': ' + error.message);
    }
  }
  console.log(
    `share-courses: ${tests.length - failed}/${tests.length} groups passed (${process.env.TZ ?? 'default TZ'}); synthetic boundaries only`,
  );
  if (failed) process.exitCode = 1;
})();
