const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
// Actual owned components/route/LTI engine and unchanged API/session adapters.
// Synthetic commit/discard/replay hooks, native calls, query, preferences and transport only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const crypto = require('node:crypto');
let scope;
const effect = (kind) => (fn, deps) => {
  const s = scope,
    i = s.cursor++,
    old = s.slots[i];
  if (!old || !deps || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
    const slot = { deps, fn, kind, cleanup: null };
    s.slots[i] = slot;
    s[kind].push(() => {
      old?.cleanup?.();
      slot.cleanup = fn();
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
        assert.ok(s.mounted, 'setState after unmount');
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
    return (s.slots[i] ??= { current: initial });
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
  useLayoutEffect: effect('layouts'),
  useEffect: effect('effects'),
  useSyncExternalStore(subscribe, snapshot) {
    const [, update] = react.useState(0);
    react.useLayoutEffect(() => subscribe(() => update((n) => n + 1)), [subscribe]);
    return snapshot();
  },
};
react.useImperativeHandle = (ref, create, deps) =>
  react.useLayoutEffect(() => {
    if (!ref) return;
    const value = create();
    if (typeof ref === 'function') ref(value);
    else ref.current = value;
    return () => {
      if (typeof ref === 'function') ref(null);
      else ref.current = null;
    };
  }, deps);

function mount(fn) {
  const s = {
    cursor: 0,
    slots: [],
    layouts: [],
    effects: [],
    mounted: true,
    dirty: false,
  };
  let previous;
  const m = {
    renderOnly() {
      assert.ok(s.mounted);
      previous ??= s.slots.slice();
      s.cursor = 0;
      s.dirty = false;
      const old = scope;
      scope = s;
      try {
        return fn();
      } finally {
        scope = old;
      }
    },
    abandon() {
      s.slots = previous;
      previous = undefined;
      s.layouts = [];
      s.effects = [];
      s.dirty = false;
    },
    commit() {
      previous = undefined;
      for (const key of ['layouts', 'effects']) while (s[key].length) s[key].shift()();
    },
    render() {
      let tree = m.renderOnly();
      m.commit();
      let limit = 15;
      while (s.dirty) {
        assert.ok(limit--);
        tree = m.renderOnly();
        m.commit();
      }
      return tree;
    },
    replayEffects() {
      for (const slot of s.slots) slot?.cleanup?.();
      for (const kind of ['layouts', 'effects'])
        for (const slot of s.slots) if (slot?.kind === kind) slot.cleanup = slot.fn();
    },
    unmount() {
      for (const slot of s.slots) slot?.cleanup?.();
      s.mounted = false;
    },
  };
  return m;
}

const root = path.resolve(__dirname, '../..'),
  cache = new Map();
const calls = [],
  alerts = [],
  queues = new Map();
const defer = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};
const queue = (key, value) => {
  if (!queues.has(key)) queues.set(key, []);
  queues.get(key).push(value);
};
const enter = async (key, args, fallback) => {
  calls.push([key, ...args]);
  const values = queues.get(key);
  if (values?.length) {
    const value = values.shift();
    if (value instanceof Error) throw value;
    return await value;
  }
  return fallback;
};
const baseUrl = 'https://school.invalid';
const client = {
  baseUrl,
  get: (url, params) =>
    url.includes('session_token')
      ? enter('session', [url, params], { session_url: 'https://signed.invalid/once' })
      : url.includes('module_item_sequence')
        ? enter('sequence', [url, params], { items: [{ current: { module_id: 7 } }] })
        : enter('get', [url, params], {
            id: 42,
            name: 'New Quizzes',
            url: '/once?session_token=test#raw',
          }),
  post: (...args) => enter('post', args, {}),
};
let env, props, query, params;
const colors = { accentFg: 'accent', bg: 'bg' };
const jsx = (type, props, key) => ({ type, props, key });
const mock = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': new Proxy(
    {
      Platform: { OS: 'ios' },
      Alert: {
        alert: (...args) => {
          calls.push(['alert', ...args]);
          alerts.push(args);
        },
      },
    },
    { get: (o, k) => o[k] ?? k },
  ),
  'lucide-react-native': new Proxy({}, { get: (_o, k) => k }),
  'expo-crypto': {
    digestStringAsync: () => {
      throw Error('unexpected crypto');
    },
  },
  'expo-router': { useLocalSearchParams: () => params },
  'expo-web-browser': {
    WebBrowserPresentationStyle: { FULL_SCREEN: 'full' },
    openBrowserAsync: (...args) => enter('browser', args, { type: 'cancel' }),
  },
  '@tanstack/react-query': {
    useQueryClient: () => ({ invalidateQueries: (...args) => enter('invalidate', args) }),
  },
  '@/design': new Proxy(
    { useTheme: () => ({ colors: { ...colors } }) },
    { get: (o, k) => o[k] ?? k },
  ),
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/query': {
    useCanvasQuery: (...args) => {
      assert.deepEqual(args[0], ['courses', params.courseId, 'quizzes', 'new']);
      return query;
    },
  },
  '@/features/course/CourseScope': { CourseScope: 'CourseScope' },
  '@/features/course/states': {
    DetailSkeleton: 'DetailSkeleton',
    LoadError: 'LoadError',
    useRefreshControl: (keys) => ({ keys }),
  },
  '@/features/web/open': {
    openWebView: (...args) => {
      calls.push(['webview', ...args]);
    },
  },
  '@/features/lti/preferences': { toolOpenMode: (...args) => enter('mode', args, undefined) },
};
const allowed = new Set([
  'canvas/api/cacheSeed',
  'features/planner/submissionCache',
  'i18n',
  'i18n/en',
  'i18n/fr',
  'i18n/ar',
  'i18n/runtime',
  'lib/dates',
  'canvas/client',
  'canvas/html',
  'canvas/api/lti',
  'canvas/api/quizzes',
  'features/course/format',
  'features/course/FactList',
  'features/grades/format',
  'features/grades/calculate',
  'features/quizzes/quizPresentation',
  'features/quizzes/NewQuizLaunch',
  'features/lti/launch',
  'features/lti/lifetime',
  'features/content/browser',
  'app/(app)/course/[courseId]/quiz/new/[assignmentId]',
]);
function load(name, parent = path.join(root, 'entry.ts')) {
  if (isIntlPolyfills(name)) return intlPolyfills;
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mock[key]) return mock[key];
  assert.ok(key.startsWith('@/') && allowed.has(key.slice(2)), key);
  const file = ['.ts', '.tsx', '/index.ts']
    .map((ext) => path.join(root, key.slice(2)) + ext)
    .find(fs.existsSync);
  if (cache.has(file)) return cache.get(file).exports;
  const m = { exports: {} };
  cache.set(file, m);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function('require', 'module', 'exports', js)((n) => load(n, file), m, m.exports);
  return m.exports;
}
const runtime = load('@/i18n/runtime'),
  dates = load('@/lib/dates');
const api = load('@/features/lti/launch'),
  lti = load('@/canvas/api/lti');
const UI = load('@/features/quizzes/NewQuizLaunch').NewQuizLaunch;
const Route = load('@/app/(app)/course/[courseId]/quiz/new/[assignmentId]').default;
const nodes = (tree) =>
  !tree || typeof tree !== 'object'
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(nodes)
      : [tree, ...nodes(tree.props?.children)];
const find = (tree, type) => nodes(tree).find((n) => n.type === type)?.props;
const button = (tree) => find(tree, 'Button');
const count = (key) => calls.filter((c) => c[0] === key).length;
const last = (key) => calls.filter((c) => c[0] === key).at(-1);
const view = (lang, zone = 'UTC') => {
  runtime.setAccountLocale('new-quiz', lang);
  dates.setDisplayTimeZone(zone);
  return runtime.createTranslator(lang);
};
const raw = () => ({
  courseId: 'c/raw?ع',
  assignmentId: 'a/raw&',
  title: 'RAW العربية',
  dueAt: new Date('2025-01-01T00:30Z'),
  points: 1.23456789,
  locked: false,
  lockExplanation: null,
  canvasUrl: '/raw?x=%2f',
});
function setup() {
  queues.clear();
  calls.length = 0;
  alerts.length = 0;
  env = { client, account: { id: 'original', baseUrl } };
  props = raw();
  params = { courseId: props.courseId, assignmentId: props.assignmentId };
  query = {
    data: [{ ...props, htmlUrl: props.canvasUrl }],
    isPending: false,
    isError: false,
    refetch: () => enter('refetch', [], {}),
  };
  view('en');
  mock['react-native'].Platform.OS = 'ios';
  colors.bg = 'bg';
}
function change(kind, m) {
  if (kind === 'account') env = { ...env, account: { ...env.account, id: 'next' } };
  if (kind === 'client') env = { ...env, client: { ...client } };
  if (kind === 'course') props = { ...props, courseId: 'next' };
  if (kind === 'assignment') props = { ...props, assignmentId: 'next' };
  if (kind === 'lock') props = { ...props, locked: true };
  if (kind === 'ready') props = { ...props, ready: false };
  if (kind === 'fallback') props = { ...props, canvasUrl: '/other' };
  if (kind === 'unmount') {
    m.unmount();
    return;
  }
  if (kind === 'replay') {
    m.replayEffects();
    return;
  }
  m.render();
}
async function run() {
  const baseline = require('./new-quiz-launch.baseline.json');
  for (const lang of ['en', 'fr', 'ar']) {
    const c = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2326);
    for (const [k, v] of Object.entries(baseline.catalogs[lang]))
      assert.equal(crypto.createHash('sha256').update(JSON.stringify(c[k])).digest('hex'), v, k);
    assert.equal(Object.keys(c).filter((k) => k.startsWith('newQuizLaunch.')).length, 4);
  }
  // Same instance, raw data, precision, zero/null and explicit Canvas-zone/year presentation.
  setup();
  const m = mount(() => UI(props));
  for (const lang of ['en', 'fr', 'ar'])
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      const t = view(lang, zone);
      const tree = m.render();
      assert.equal(button(tree).children, t('newQuizLaunch.open'));
      assert.ok(JSON.stringify(tree).includes(props.title));
      const p = mount(() => load('@/features/quizzes/quizPresentation').useQuizPresentation());
      const facts = find(tree, load('@/features/course/FactList').FactList).facts;
      assert.deepEqual(facts, [
        { label: t('quizPresentation.due'), value: p.render().date(props.dueAt) },
      ]);
      p.unmount();
      const pointLabel = nodes(tree).find((n) => n.props?.tabular)?.props.children;
      assert.equal(pointLabel, t('quizPresentation.points', {
        count: props.points,
        value: new Intl.NumberFormat(lang, { useGrouping: false, maximumFractionDigits: 2 }).format(1.23),
      }), 'New Quiz points retain the legacy two-decimal rounding');
    }
  assert.equal(calls.length, 0);
  for (const points of [0, 1, null, 1e-21]) {
    props = { ...props, points, dueAt: null };
    const tree = m.render();
    assert.equal(
      find(tree, load('@/features/course/FactList').FactList).facts[0].value,
      runtime.createTranslator('ar')('quizPresentation.noDue'),
    );
    if (points === null) assert.equal(nodes(tree).filter((n) => n.props?.tabular).length, 0);
  }
  // The pre-migration formatter is authoritative for English point rounding,
  // including tiny values and negative zero. This does not change raw points.
  const legacyPoints = load('@/features/course/format').formatPoints;
  view('en');
  for (const points of [0, -0, 1, null, 1e-21, -0.001, 1.005, 1.235, 1000.123456789]) {
    props = { ...props, points };
    const label = nodes(m.render()).find((n) => n.props?.tabular)?.props.children ?? null;
    assert.equal(label, legacyPoints(points), 'legacy point formatting for ' + points);
  }
  props = { ...props, locked: true, lockExplanation: '' };
  assert.equal(find(m.render(), 'Callout').children, '');
  props = { ...props, lockExplanation: 'Raw lock' };
  assert.equal(find(m.render(), 'Callout').children, 'Raw lock');
  m.unmount();
  // Exact legacy ModuleItemContent props/defaults; no callback in serialized launch data.
  for (const canvasUrl of [undefined, null, '', '/raw?%20']) {
    setup();
    props = { ...props, canvasUrl };
    const m = mount(() => UI(props));
    await button(m.render()).onPress();
    assert.deepEqual(last('get'), [
      'get',
      `/api/v1/courses/${props.courseId}/external_tools/sessionless_launch`,
      {
        id: undefined,
        launch_type: 'assessment',
        url: undefined,
        assignment_id: props.assignmentId,
        module_item_id: undefined,
        resource_link_lookup_uuid: undefined,
      },
    ]);
    assert.deepEqual(last('webview')[1].launch, {
      courseId: props.courseId,
      assignmentId: props.assignmentId,
      launchType: 'assessment',
      title: props.title,
      needsSession: true,
      guard: runtime.createTranslator('en')('quizEntry.leave'),
      fallbackUrl:
        canvasUrl ?? `${baseUrl}/courses/${props.courseId}/assignments/${props.assignmentId}`,
    });
    assert.equal(last('webview')[1].signed, true);
    assert.equal(last('webview')[1].url, baseUrl + '/once?session_token=test&platform=mobile#raw');
    m.unmount();
  }
  // Each consumer-owned replacement at fetch success/failure and preference settlement.
  for (const stage of ['get', 'failure', 'mode'])
    for (const kind of [
      'account',
      'client',
      'course',
      'assignment',
      'lock',
      'ready',
      'fallback',
      'unmount',
      'replay',
    ]) {
      setup();
      const wait = defer();
      queue(stage === 'failure' ? 'get' : stage, wait.promise);
      const m = mount(() => UI(props));
      const old = button(m.render()).onPress;
      const pending = old();
      await old();
      await flush();
      assert.equal(count('get'), 1);
      change(kind, m);
      if (stage === 'failure') wait.reject(new Error('raw'));
      else wait.resolve(stage === 'mode' ? 'app' : { id: 42, name: 'New Quizzes', url: '/old' });
      await pending;
      await flush();
      assert.equal(count('webview') + count('browser') + count('alert'), 0, stage + '/' + kind);
      if (kind !== 'unmount') m.unmount();
    }
  // Away/back must retire the old callback and its claim, allowing a fresh action.
  for (const policy of ['locked', 'ready']) {
    setup();
    const d = defer();
    queue('get', d.promise);
    const m = mount(() => UI(props));
    const old = button(m.render()).onPress;
    const p = old();
    props = { ...props, [policy]: policy === 'locked' };
    m.render();
    props = { ...props, [policy]: policy !== 'locked' };
    const fresh = button(m.render()).onPress;
    await old();
    await fresh();
    assert.equal(count('get'), 2);
    d.resolve({ url: '/old' });
    await p;
    assert.equal(count('webview'), 1);
    m.unmount();
  }
  // Discarded renders cannot publish replacement scope or launch; presentation commits retain work.
  setup();
  let d = defer();
  queue('get', d.promise);
  let mm = mount(() => UI(props));
  let old = button(mm.render()).onPress;
  let pending = old();
  const before = { ...props };
  props = { ...props, assignmentId: 'discarded' };
  await button(mm.renderOnly()).onPress();
  mm.abandon();
  props = before;
  assert.equal(count('get'), 1);
  view('fr');
  props = { ...props, title: 'new presentation', dueAt: null };
  mm.render();
  colors.bg = 'theme';
  mm.render();
  d.resolve({ url: '/valid', name: 'New Quizzes' });
  await pending;
  assert.equal(count('webview'), 1);
  mm.unmount();
  // Hook alone: intrinsic account/client/unmount/discard protection, one-argument compatibility.
  for (const kind of ['account', 'client', 'unmount', 'replay']) {
    setup();
    d = defer();
    queue('get', d.promise);
    mm = mount(() => api.useLaunchTool());
    const f = mm.render();
    pending = f({ toolId: '9' });
    change(kind, mm);
    d.resolve({ url: '/old' });
    await pending;
    if (kind !== 'replay') await f({ toolId: '9' });
    if (kind !== 'replay') assert.equal(count('get'), 1);
    assert.equal(count('webview'), 0);
    if (kind !== 'unmount') mm.unmount();
  }
  setup();
  mm = mount(() => api.useLaunchTool());
  const discarded = mm.renderOnly();
  await discarded({ toolId: '9' });
  assert.equal(calls.length, 0);
  mm.abandon();
  mm.unmount();
  // Fallback browser rejection -> session URL: check both boundaries and default options.
  for (const path of ['browserReject', 'browserSession', 'alertSession', 'alertOld'])
    for (const kind of ['account', 'client', 'course', 'assignment', 'lock', 'ready', 'unmount']) {
      setup();
      d = defer();
      if (path.startsWith('browser')) {
        queue('mode', 'browser');
        queue('browser', path === 'browserReject' ? d.promise : new Error('browser'));
        if (path === 'browserSession') queue('session', d.promise);
      } else {
        queue('get', new Error('failure'));
        if (path === 'alertSession') queue('session', d.promise);
      }
      mm = mount(() => UI(props));
      pending = button(mm.render()).onPress();
      await flush();
      let alertOpen;
      if (path.startsWith('alert')) {
        await pending;
        alertOpen = alerts.at(-1)[2][1].onPress;
        if (path === 'alertSession') {
          pending = alertOpen();
          await flush();
        }
      }
      change(kind, mm);
      if (path === 'browserReject') d.reject(new Error('closed'));
      else d.resolve({ session_url: 'https://old.invalid' });
      if (path === 'alertOld') await alertOpen();
      await pending;
      await flush();
      assert.equal(count('browser'), path.startsWith('browser') ? 1 : 0, path + '/' + kind);
      if (path === 'browserReject' || path === 'alertOld') assert.equal(count('session'), 0);
      if (kind !== 'unmount') mm.unmount();
    }
  setup();
  queue('mode', 'browser');
  queue('browser', new Error('failure'));
  mm = mount(() => api.useLaunchTool());
  await mm.render()({ toolId: '9', fallbackUrl: '/raw' });
  assert.deepEqual(last('session'), [
    'session',
    '/api/v1/login/session_token',
    { return_to: baseUrl + '/raw' },
  ]);
  assert.deepEqual(last('browser'), ['browser', 'https://signed.invalid/once']);
  mm.unmount();
  // Native resolution cancel/dismiss/opened is not a rejection and must not trigger fallback.
  for (const type of ['cancel', 'dismiss', 'opened']) {
    setup();
    queue('mode', 'browser');
    queue('browser', { type });
    mm = mount(() => api.useLaunchTool());
    await mm.render()({ toolId: '9' });
    assert.equal(count('session'), 0);
    mm.unmount();
  }
  // Failure controls: consume once, cancel/dismiss suppress, later deliberate retries recover.
  for (const action of ['open', 'cancel', 'dismiss', 'retry']) {
    setup();
    queue('get', new lti.ToolLaunchError('RAW'));
    mm = mount(() => UI(props));
    await button(mm.render()).onPress();
    const alert = alerts.at(-1),
      open = alert[2][1].onPress;
    if (action === 'cancel') alert[2][0].onPress();
    if (action === 'dismiss') alert[3].onDismiss();
    if (action === 'retry') await button(mm.render()).onPress();
    await open();
    await open();
    assert.equal(count('session'), action === 'open' ? 1 : 0);
    await button(mm.render()).onPress();
    assert.ok(count('webview') >= 1);
    mm.unmount();
  }
  // Invocation-language alerts survive presentation-only committed and discarded updates.
  setup();
  view('fr');
  d = defer();
  queue('get', d.promise);
  mm = mount(() => UI(props));
  pending = button(mm.render()).onPress();
  view('ar');
  mm.render();
  props = { ...props, title: 'discarded' };
  mm.renderOnly();
  mm.abandon();
  d.reject(new lti.ToolLaunchError('RAW'));
  await pending;
  assert.equal(
    alerts.at(-1)[0],
    runtime.createTranslator('fr')('tools.failure.title', { name: raw().title }),
  );
  assert.ok(alerts.at(-1)[1].includes('RAW'));
  mm.unmount();
  // Module sequence lookup must be rechecked; an entered mark_read retains ORIGINAL invalidation.
  for (const stage of ['sequence', 'post'])
    for (const kind of ['account', 'client', 'unmount', 'scope']) {
      setup();
      d = defer();
      queue(stage, d.promise);
      let valid = true;
      mm = mount(() => api.useLaunchTool());
      pending = mm.render()({ courseId: 'c', moduleItemId: 'item' }, { isCurrent: () => valid });
      await flush();
      if (kind === 'scope') valid = false;
      else change(kind, mm);
      d.resolve(stage === 'sequence' ? { items: [{ current: { module_id: 'found' } }] } : {});
      await pending;
      await flush();
      assert.equal(count('post'), stage === 'post' ? 1 : 0);
      assert.equal(count('invalidate'), stage === 'post' ? 1 : 0);
      if (stage === 'post')
        assert.deepEqual(last('invalidate'), [
          'invalidate',
          { queryKey: ['original', 'courses', 'c', 'modules'] },
        ]);
      if (kind !== 'unmount') mm.unmount();
    }
  for (const moduleId of [undefined, 'raw/module']) {
    setup();
    queue(moduleId ? 'post' : 'sequence', new Error('denied'));
    mm = mount(() => api.useLaunchTool());
    await mm.render()({ courseId: 'c', moduleItemId: 'item', moduleId });
    await flush();
    assert.equal(count('webview'), 1);
    mm.unmount();
  }
  // Independent tools may proceed concurrently; same-request retry retires old alerts only.
  setup();
  d = defer();
  queue('get', d.promise);
  mm = mount(() => api.useLaunchTool());
  const launch = mm.render();
  pending = launch({ toolId: '1' });
  await launch({ toolId: '2' });
  d.resolve({ url: '/one', name: 'New Quizzes' });
  await pending;
  assert.equal(count('webview'), 2);
  mm.unmount();
  // Route cached/error/pending/empty plus resource-owned, fully settled retry coalescing.
  setup();
  mm = mount(() => Route());
  let tree = mm.render();
  assert.equal(find(tree, UI).ready, true);
  query = { ...query, isError: true, error: new Error('RAW') };
  tree = mm.render();
  assert.equal(find(tree, UI).ready, false);
  assert.equal(find(tree, 'LoadError').error.message, 'RAW');
  assert.equal(find(tree, 'EmptyState'), undefined);
  d = defer();
  queue('refetch', d.promise);
  old = find(tree, 'LoadError').onRetry;
  pending = old();
  await old();
  await flush();
  assert.equal(count('refetch'), 1);
  mm.render();
  await find(mm.render(), 'LoadError').onRetry();
  assert.equal(count('refetch'), 1);
  d.reject(new Error('failure'));
  await pending;
  await old();
  assert.equal(count('refetch'), 2);
  const queued = old();
  params = { ...params, assignmentId: 'replacement' };
  mm.render();
  await queued;
  await old();
  assert.equal(count('refetch'), 2);
  query = { ...query, data: undefined, isPending: true, isError: false };
  tree = mm.render();
  assert.ok(find(tree, 'DetailSkeleton'));
  assert.equal(find(tree, 'EmptyState'), undefined);
  query = { ...query, isPending: false };
  tree = mm.render();
  assert.ok(find(tree, 'EmptyState'));
  mm.unmount();
  // Parent route validity protects a retained child even before that child renders again.
  setup();
  const route = mount(() => Route());
  let childProps = find(route.render(), UI);
  const child = mount(() => UI(childProps));
  const retainedChild = button(child.render()).onPress;
  query = { ...query, isError: true };
  route.render();
  await retainedChild();
  assert.equal(count('get'), 0);
  query = { ...query, isError: false };
  childProps = find(route.render(), UI);
  await retainedChild();
  await button(child.render()).onPress();
  assert.equal(count('get'), 1);
  child.unmount();
  route.unmount();
  // Each retry owner is bound to committed account/client/route, including queued entry.
  for (const kind of ['account', 'client', 'course', 'assignment', 'unmount']) {
    setup();
    query = { ...query, isError: true };
    const route = mount(() => Route());
    const retry = find(route.render(), 'LoadError').onRetry;
    const work = retry();
    if (kind === 'course') params = { ...params, courseId: 'next' };
    if (kind === 'assignment') params = { ...params, assignmentId: 'next' };
    if (kind === 'account') env = { ...env, account: { ...env.account, id: 'next' } };
    if (kind === 'client') env = { ...env, client: { ...client } };
    if (kind === 'unmount') route.unmount();
    else route.render();
    await work;
    await retry();
    assert.equal(count('refetch'), 0);
    if (kind !== 'unmount') route.unmount();
  }
  // Discarded locale/theme renders leave an already-entered launch valid and its options intact.
  setup();
  queue('mode', 'browser');
  d = defer();
  queue('get', d.promise);
  mm = mount(() => api.useLaunchTool());
  pending = mm.render()({ toolId: '9' });
  view('ar');
  colors.bg = 'discarded';
  mm.renderOnly();
  mm.abandon();
  d.resolve({ url: '/valid' });
  await pending;
  assert.equal(last('browser')[2].toolbarColor, 'bg');
  assert.equal(count('session'), 0);
  mm.unmount();
  // The actual unchanged session adapter falls back to an absolute URL if tokens are blocked.
  setup();
  queue('mode', 'browser');
  queue('browser', new Error('native'));
  queue('session', new Error('school blocks tokens'));
  mm = mount(() => api.useLaunchTool());
  await mm.render()({ toolId: '9', fallbackUrl: '/raw?x=%2f' });
  assert.deepEqual(last('browser'), ['browser', baseUrl + '/raw?x=%2f']);
  mm.unmount();
  // Pure legacy exports and adapter URL/return behavior remain exact.
  setup();
  assert.equal(api.toolKey({ toolId: 'context_external_tool_81' }), '81');
  assert.equal(api.toolKey({}, { toolId: 'raw' }), 'raw');
  assert.equal(api.predictOpenMode(null, null, baseUrl), 'browser');
  assert.equal(api.predictOpenMode(null, null, baseUrl, true), 'app');
  for (const name of ['Quizzes 2', ' quizzes.next ', 'New Quizzes', 'QUIZZES'])
    assert.equal(api.isNewQuizzes(name), true);
  assert.equal(api.isNewQuizzes('Quizzes elsewhere'), false);
  assert.deepEqual(
    api.launchRequest(
      { courseId: 'c', assignmentId: 'a', moduleItemId: 'm', url: 'ignored' },
      baseUrl,
    ),
    {
      courseId: 'c',
      accountId: undefined,
      assignmentId: 'a',
      moduleItemId: 'm',
      launchType: 'module_item',
      toolId: undefined,
      resourceLinkLookupUuid: undefined,
    },
  );
  for (const os of ['ios', 'android']) {
    mock['react-native'].Platform.OS = os;
    queue('get', { id: 0, name: '', url: '/once?session_token=raw#h' });
    const r = await api.launchTarget(client, {
      url: '/api/v1/accounts/7/external_tools/sessionless_launch?id=9',
    });
    assert.equal(r.target.toolId, '0');
    assert.equal(r.target.name, '');
    assert.equal(
      r.url,
      baseUrl + '/once?session_token=raw' + (os === 'ios' ? '&platform=mobile' : '') + '#h',
    );
    assert.equal(last('get')[1], '/api/v1/accounts/7/external_tools/sessionless_launch?id=9');
  }
  for (const guard of ['', 'RAW guard']) {
    setup();
    mm = mount(() => api.useLaunchTool());
    await mm.render()({ title: '', guard, fallbackUrl: '' });
    assert.equal(last('webview')[1].title, '');
    assert.equal(last('webview')[1].guard, guard);
    assert.equal(last('webview')[1].launch.fallbackUrl, '');
    mm.unmount();
  }
  console.log('new-quiz-launch checks passed (' + (process.env.TZ ?? 'host') + '; synthetic only)');
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
