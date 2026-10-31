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
let env, query, params;
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
  '@/design': new Proxy({ useTheme: () => ({ colors: { ...colors } }) }, { get: (o, k) => o[k] ?? k }),
  '@/canvas/session': { useCanvas: () => env, isStoredAccountClient: () => true },
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
  const js = ts.transpileModule(
    fs.readFileSync(file, 'utf8') + (expose[key] ? '\nexport { ' + expose[key] + ' };' : ''),
    {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  new Function('require', 'module', 'exports', js)((n) => load(n, file), m, m.exports);
  return m.exports;
}

const expose = {
  '@/app/(app)/tools': 'ToolRow, ToolLaunchRow',
  '@/app/(app)/course/[courseId]/index': 'TabRow',
  '@/features/course/ModuleItemParts': 'ToolItem, OpenElsewhere',
  '@/features/course/AssignmentDetails': 'OpenToolButton',
};
for (const name of [
  'features/lti/action',
  'app/(app)/tools',
  'app/(app)/course/[courseId]/index',
  'features/course/ModuleItemParts',
  'features/course/AssignmentDetails',
  'features/course/SubmissionParts',
  'features/course/assignmentPresentation',
  'features/course/navigation',
  'features/content/RichContent',
  'features/content/presentation',
  'features/content/session',
  'features/submissions/annotationViewer',
  'features/submissions/feedbackLaunch',
  'features/submissions/feedbackPresentation',
  'features/submissions/formPresentation',
  'features/submissions/rules',
])
  allowed.add(name);
let online = true;
const assetSnapshot = {};
Object.assign(mock, {
  'expo-image': { Image: 'Image' },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
  'react-native-webview': { WebView: 'WebView' },
  '@/lib/cn': { cn: (...args) => args.join(' ') },
  '@/canvas/api/courses': { useCourse: () => query, useDashboardCourses: () => ({ data: [] }) },
  '@/canvas/api/tabs': { useCourseTabs: () => query },
  '@/canvas/api/pages': { FRONT_PAGE: '__front_page__' },
  '@/canvas/api/submissions': {},
  '@/canvas/api/assignments': {},
  '@/canvas/api/modules': {},
  '@/features/course/modulePresentation': {},
  '@/features/course/ModuleList': { moduleItemIcon: {} },
  '@/features/course/PageContent': {},
  '@/features/course/QuizDetails': {},
  '@/features/reminders/ReminderControl': {},
  '@/features/submissions/GroupCard': {},
  '@/features/submissions/PeerReviews': {},
  '@/features/submissions/uploadStore': {},
  '@/features/files/AttachmentList': {},
  '@/features/files/kinds': {},
  '@/features/submissions/MediaPlayer': {},
  '@/features/lti/ToolOpenChoice': { useToolOpenChoice: () => ({ mode: 'app' }) },
  '@/features/offline/useOnline': { useOnline: () => online },
  '@/features/offline/connectivity': {},
  '@/features/offline/store': { useLocalStore: () => assetSnapshot },
  '@/features/offline/schoolTheme': { useSchoolThemeEnabled: () => false },
  '@/features/sync/assets': { assetIndex: {}, offlineAssetHtml: (_a, _b, html) => html },
  '@/canvas/api/brand': { extractThemeFiles: (html) => ({ html, files: [] }), useSchoolTheme: () => ({}) },
  '@/features/content/links': { openCanvasLink: (...args) => calls.push(['link', ...args]) },
  '@/features/web/session': {
    sessionIsFresh: () => true,
    sessionStartUrl: () => {
      throw Error('unexpected embed session');
    },
    SESSION_MAX_AGE: 60000,
  },
});
Object.assign(mock['react-native'], {
  PixelRatio: { getFontScale: () => 1 },
  AppState: { addEventListener: () => ({ remove() {} }) },
});
Object.assign(mock['expo-router'], {
  Stack: { Screen: 'Stack.Screen' },
  router: { push: (...args) => calls.push(['route', ...args]) },
});
mock['@/canvas/query'].useCanvasQuery = () => query;
mock['@/features/lti/preferences'].useToolOpenMode = () => ({ mode: 'app' });
// Stable theme values: no accidental source reload on every mocked render.
mock['@/design'].useTheme = () => ({ colors, scheme: 'light' });
const runtime = load('@/i18n/runtime');
const api = load('@/features/lti/launch');
const realUseLaunchTool = api.useLaunchTool;
api.useLaunchTool = () => {
  const launch = realUseLaunchTool();
  return (payload, lifetime) => {
    calls.push(['payload', payload, lifetime]);
    return launch(payload, lifetime);
  };
};
const toolsUI = load('@/app/(app)/tools');
const tabsUI = load('@/app/(app)/course/[courseId]/index');
const modulesUI = load('@/features/course/ModuleItemParts');
const assignmentUI = load('@/features/course/AssignmentDetails');
const attemptsUI = load('@/features/course/SubmissionParts');
const contentUI = load('@/features/content/RichContent');
const nodes = (tree) =>
  !tree || typeof tree !== 'object'
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(nodes)
      : [tree, ...nodes(tree.props?.children)];
const find = (tree, type) => nodes(tree).find((n) => n.type === type)?.props;
const count = (key) => calls.filter((c) => c[0] === key).length;
const last = (key) => calls.filter((c) => c[0] === key).at(-1);
const view = (lang) => runtime.setAccountLocale('consumer', lang);
const baseAssignment = () => ({
  courseId: '42',
  id: 'a',
  kind: 'external_tool',
  name: 'RAW اسم',
  htmlUrl: '/assignment',
  locked: false,
});
const baseItem = () => ({
  id: 'i',
  moduleId: 'm',
  type: 'ExternalTool',
  contentId: 't',
  externalUrl: '',
  htmlUrl: '/item',
  title: 'RAW اسم',
  locked: false,
});
const baseTool = () => ({ id: 't', accountId: 'root', name: 'RAW اسم', url: '', webUrl: '/global' });
const baseTab = () => ({
  id: 'context_external_tool_t',
  label: 'RAW اسم',
  external: true,
  hidden: false,
  launchUrl: '',
  htmlUrl: '/tab',
});
function setup() {
  calls.length = 0;
  alerts.length = 0;
  queues.clear();
  online = true;
  env = { client, account: { id: 'original', baseUrl } };
  query = { data: [], isPending: false, isError: false, refetch: () => enter('refetch', [], {}) };
  params = { courseId: '42' };
  view('en');
}
const cases = [
  {
    name: 'global',
    initial: () => ({ tool: baseTool(), context: undefined }),
    render: (p) => toolsUI.ToolRow(toolsUI.ToolLaunchRow(p).props),
    payload: (p) => ({
      toolId: p.tool.id,
      accountId: p.tool.accountId,
      launchType: 'global_navigation',
      title: p.tool.name,
      fallbackUrl: p.tool.webUrl,
    }),
    change: (p) => ({ ...p, tool: { ...p.tool, id: 'other' } }),
    policy: (p) => ({ ...p, tool: { ...p.tool, webUrl: '/new' } }),
    title: (p) => ({ ...p, tool: { ...p.tool, name: 'new title' } }),
  },
  {
    name: 'tab',
    initial: () => ({ tab: baseTab(), courseId: '42', defaultView: 'modules' }),
    render: (p) => tabsUI.TabRow(p),
    payload: (p) => ({
      courseId: p.courseId,
      toolId: p.tab.id,
      launchType: 'course_navigation',
      url: '',
      title: p.tab.label,
      fallbackUrl: p.tab.htmlUrl,
    }),
    change: (p) => ({ ...p, courseId: 'next' }),
    policy: (p) => ({ ...p, toolsReady: false }),
    title: (p) => ({ ...p, tab: { ...p.tab, label: 'new title' } }),
  },
  {
    name: 'module',
    initial: () => ({ item: baseItem(), courseId: '42' }),
    render: (p) => {
      const tree = modulesUI.ToolItem(p);
      return modulesUI.OpenElsewhere(find(tree, modulesUI.OpenElsewhere));
    },
    payload: (p) => ({
      courseId: p.courseId,
      moduleItemId: p.item.id,
      moduleId: p.item.moduleId,
      url: '',
      title: p.item.title,
      fallbackUrl: p.item.htmlUrl,
    }),
    change: (p) => ({ ...p, item: { ...p.item, id: 'other' } }),
    policy: (p) => ({ ...p, item: { ...p.item, locked: true } }),
    title: (p) => ({ ...p, item: { ...p.item, title: 'new title' } }),
  },
  {
    name: 'assignment',
    initial: () => ({ a: baseAssignment() }),
    render: (p) => assignmentUI.OpenToolButton(p),
    payload: (p) => ({
      courseId: p.a.courseId,
      assignmentId: p.a.id,
      launchType: 'assessment',
      title: p.a.name,
      fallbackUrl: p.a.htmlUrl,
    }),
    change: (p) => ({ a: { ...p.a, id: 'other' } }),
    policy: (p) => ({ a: { ...p.a, locked: true } }),
    title: (p) => ({ a: { ...p.a, name: 'new title' } }),
  },
  {
    name: 'attempt',
    initial: () => ({
      assignment: baseAssignment(),
      attempt: { attempt: 1, type: 'basic_lti_launch', url: '/picked', externalToolUrl: '' },
    }),
    render: (p) => attemptsUI.AttemptContent(p),
    payload: (p) => ({
      courseId: p.assignment.courseId,
      assignmentId: p.assignment.id,
      launchType: 'assessment',
      url: '',
      title: p.assignment.name,
      fallbackUrl: p.assignment.htmlUrl,
    }),
    change: (p) => ({ ...p, attempt: { ...p.attempt, attempt: 2 } }),
    policy: (p) => ({ ...p, assignment: { ...p.assignment, locked: true } }),
    title: (p) => ({ ...p, assignment: { ...p.assignment, name: 'new title' } }),
  },
  {
    name: 'document',
    initial: () => ({ html: '<p>raw</p>' }),
    render: (p) => contentUI.RichContent(p),
    payload: () => ({ url: '/courses/42/external_tools/7', courseId: '42', title: 'RAW اسم' }),
    change: (p) => ({ ...p, html: '<p>new</p>' }),
    policy: (p) => ({ ...p, html: '<p>policy replacement</p>' }),
    title: (p) => ({ ...p }),
  },
];
function control(c, tree) {
  if (c.name === 'document') {
    const w = find(tree, 'WebView');
    if (!w) return undefined; // A not-yet-committed replacement has no native owner.
    return () =>
      w.onMessage({
        nativeEvent: {
          data: JSON.stringify({ type: 'launch', url: '/courses/42/external_tools/7', title: 'RAW اسم' }),
        },
      });
  }
  return (find(tree, 'Button') ?? find(tree, 'ListItem'))?.onPress;
}
function pending(tree) {
  return !!(find(tree, 'Button')?.loading || find(tree, 'ListItem')?.disabled);
}
const target = { id: 42, name: 'New Quizzes', url: '/once?session_token=test#raw' };
async function press(c, m) {
  const promise = control(c, m.render())();
  await flush();
  await promise;
  await flush();
}
(async () => {
  // Preserve every historical value while allowing later additive migrations.
  // The baseline also retains the original whole-source hashes as provenance.
  const baseline = require('./tool-launch-consumers.baseline.json');
  for (const lang of ['en', 'fr', 'ar']) {
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2330);
    const catalog = load('@/i18n/' + lang)[lang];
    for (const [key, digest] of Object.entries(baseline.catalogs[lang]))
      assert.equal(crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'), digest, key);
  }
  // Submission history remains readable after assignment locking. This is an
  // existing attempt viewer, distinct from starting a new assignment submission.
  for (const picked of [false, true]) {
    setup();
    const c = cases.find((entry) => entry.name === 'attempt');
    let props = c.initial();
    props = {
      ...props,
      assignment: { ...props.assignment, locked: true, kind: picked ? 'assignment' : 'external_tool' },
    };
    const history = mount(() => c.render(props));
    await press(c, history);
    assert.equal(count('webview'), 1, 'locked assignment still opens its existing LTI submission');
    const payload = last('payload')[1];
    assert.equal(payload.courseId, props.assignment.courseId);
    assert.equal(payload.fallbackUrl, props.assignment.htmlUrl);
    if (picked) assert.equal(payload.url, props.attempt.url);
    else assert.equal(payload.assignmentId, props.assignment.id);
    history.unmount();
  }
  for (const c of cases) {
    setup();
    let p = c.initial();
    const m = mount(() => c.render(p));
    const before = m.render();
    assert.equal(calls.length, 0, c.name + ' no effects launch');
    const wait = defer();
    queue('get', wait.promise);
    const handler = control(c, before);
    const task = handler();
    handler();
    assert.equal(count('get'), 1, c.name + ' synchronous duplicate');
    const source = find(before, 'WebView')?.source;
    p = c.title(p);
    view('fr');
    let tree = m.render();
    if (source) assert.equal(find(tree, 'WebView').source, source);
    assert.equal(count('get'), 1);
    if (!['attempt', 'document'].includes(c.name)) assert.ok(pending(tree));
    wait.resolve(target);
    await task;
    await flush();
    assert.equal(count('webview'), 1, c.name + ' current success');
    // Invocation used the old raw title; fallback and launch data contain no callbacks.
    const expected = c.payload(c.initial());
    assert.deepEqual(last('payload')[1], expected);
    assert.equal(typeof last('payload')[2].isCurrent, 'function');
    assert.deepEqual(
      last('webview')[1].launch,
      c.name === 'document'
        ? { ...expected, fallbackUrl: baseUrl + '/courses/42/external_tools/7' }
        : expected,
    );
    assert.deepEqual(last('get').slice(1), [
      '/api/v1/' +
        (expected.courseId ? 'courses/' + expected.courseId : 'accounts/' + expected.accountId) +
        '/external_tools/sessionless_launch',
      {
        id: c.name === 'document' ? '7' : expected.toolId,
        launch_type:
          c.name === 'document'
            ? 'course_navigation'
            : c.name === 'module'
              ? 'module_item'
              : expected.launchType,
        url: undefined,
        assignment_id: expected.assignmentId,
        module_item_id: expected.moduleItemId,
        resource_link_lookup_uuid: undefined,
      },
    ]);
    assert.ok(!pending(m.render()));
    m.unmount();
    handler();
    await flush();
    assert.equal(count('get'), 1);

    // Current native path preserves every existing option and app route headers/protocol.
    setup();
    p = c.initial();
    const native = mount(() => c.render(p));
    queue('mode', 'browser');
    await press(c, native);
    assert.deepEqual(last('browser').slice(1), [
      baseUrl + '/once?session_token=test&platform=mobile#raw',
      {
        controlsColor: 'accent',
        toolbarColor: 'bg',
        secondaryToolbarColor: 'bg',
        dismissButtonStyle: 'done',
        presentationStyle: 'full',
        enableBarCollapsing: true,
        showTitle: true,
      },
    ]);
    native.unmount();

    // Each delayed engine boundary must see the consumer's committed lifetime.
    for (const boundary of ['get', 'reject', 'mode', 'session', 'session-reject'])
      for (const change of [
        'resource',
        'policy',
        'account',
        'client',
        'baseUrl',
        'unmount',
        'replay',
        'away-back',
      ]) {
        setup();
        p = c.initial();
        const n = mount(() => c.render(p));
        const old = control(c, n.render());
        const d = defer();
        if (boundary.startsWith('session')) {
          queue('get', new Error('launch failed'));
          await old();
          await flush();
          queue('session', d.promise);
          alerts.at(-1)[2][1].onPress();
        } else {
          queue(boundary === 'reject' ? 'get' : boundary, d.promise);
          old();
          await flush();
        }
        const saved = p;
        if (change === 'resource' || change === 'away-back') p = c.change(p);
        if (change === 'policy') p = c.policy(p);
        if (change === 'account') env = { ...env, account: { ...env.account, id: 'replacement' } };
        if (change === 'client') env = { ...env, client: { ...client } };
        if (change === 'baseUrl')
          env = { ...env, account: { ...env.account, baseUrl: 'https://replacement.invalid' } };
        if (change === 'unmount') n.unmount();
        else if (change === 'replay') n.replayEffects();
        else n.render();
        if (change === 'away-back') {
          p = saved;
          n.render();
        }
        const counts = [count('webview'), count('browser'), count('alert')];
        if (boundary === 'reject' || boundary === 'session-reject') d.reject(new Error('late failure'));
        else
          d.resolve(
            boundary === 'get'
              ? target
              : boundary === 'session'
                ? { session_url: 'https://signed.invalid/old' }
                : 'app',
          );
        await flush();
        assert.deepEqual(
          [count('webview'), count('browser'), count('alert')],
          counts,
          c.name + '/' + boundary + '/' + change,
        );
        if (change !== 'replay') {
          const entered = count('get');
          old();
          await flush();
          assert.equal(count('get'), entered, c.name + ' stale entry ' + change);
        }
        if (change !== 'unmount') {
          p = saved;
          n.render();
          await press(c, n);
          assert.equal(count('webview'), counts[0] + 1, c.name + ' fresh retry');
          n.unmount();
        }
      }
    // A settled error alert remains actionable; locale/title updates don't revoke it.
    setup();
    p = c.initial();
    const n = mount(() => c.render(p));
    queue('get', new Error('failure'));
    await press(c, n);
    view('ar');
    p = c.title(p);
    n.render();
    const alert = alerts.at(-1);
    await alert[2][1].onPress();
    await flush();
    assert.equal(count('session'), 1, c.name + ' settled alert');
    assert.equal(count('browser'), 1);
    await alert[2][1].onPress();
    assert.equal(count('session'), 1);
    n.unmount();
    // New deliberate action supersedes old alerts, even after both promises settle.
    setup();
    p = c.initial();
    const a = mount(() => c.render(p));
    queue('get', new Error('first'));
    await press(c, a);
    const stale = alerts.at(-1);
    queue('get', new Error('retry'));
    await press(c, a);
    await stale[2][1].onPress();
    assert.equal(count('session'), 0);
    a.unmount();
    await alerts.at(-1)[2][1].onPress();
    assert.equal(count('session'), 0);
    // Discarded replacement never revokes the committed callback nor becomes actionable.
    setup();
    p = c.initial();
    const b = mount(() => c.render(p));
    const live = control(c, b.render());
    const original = p;
    p = c.change(p);
    const discarded = control(c, b.renderOnly());
    discarded?.();
    await flush();
    assert.equal(count('get'), 0);
    b.abandon();
    p = original;
    live();
    await flush();
    assert.equal(count('webview'), 1);
    b.unmount();
    // Replacement actions own their pending state; old completion cannot clear it.
    setup();
    p = c.initial();
    const o = mount(() => c.render(p));
    const d1 = defer(),
      d2 = defer();
    queue('get', d1.promise);
    control(c, o.render())();
    p = c.change(p);
    queue('get', d2.promise);
    control(c, o.render())();
    d1.resolve(target);
    await flush();
    if (!['attempt', 'document'].includes(c.name))
      assert.ok(pending(o.render()), c.name + ' new spinner survives');
    d2.resolve(target);
    await flush();
    assert.equal(count('webview'), 1);
    assert.ok(!pending(o.render()));
    o.unmount();
    // Native rejection after replacement cannot enter signed fallback.
    setup();
    p = c.initial();
    const r = mount(() => c.render(p));
    const browser = defer();
    queue('mode', 'browser');
    queue('browser', browser.promise);
    control(c, r.render())();
    await flush();
    assert.equal(count('browser'), 1);
    p = c.change(p);
    r.render();
    browser.reject(new Error('native rejected'));
    await flush();
    assert.equal(count('session'), 0);
    r.unmount();
    // Retained alert entry itself is inert after away/back, not just its delayed session result.
    setup();
    p = c.initial();
    const z = mount(() => c.render(p));
    queue('get', new Error('alert'));
    await press(c, z);
    const oldAlert = alerts.at(-1);
    const start = p;
    p = c.policy(p);
    z.render();
    p = start;
    z.render();
    await oldAlert[2][1].onPress();
    assert.equal(count('session'), 0);
    await press(c, z);
    assert.equal(count('webview'), 1);
    z.unmount();
  }

  // Parent membership/error commits revoke retained children before they rerender.
  for (const type of ['global', 'tab']) {
    setup();
    query.data = type === 'global' ? [baseTool()] : [baseTab()];
    const Parent = type === 'global' ? toolsUI.default : tabsUI.default;
    const Child = type === 'global' ? toolsUI.ToolLaunchRow : tabsUI.TabRow;
    const parent = mount(() => Parent());
    let childProps = find(parent.render(), Child);
    const child = mount(() =>
      type === 'global' ? toolsUI.ToolRow(Child(childProps).props) : Child(childProps),
    );
    const old = control(cases[type === 'global' ? 0 : 1], child.render());
    query = { ...query, isError: true, error: new Error('query') };
    parent.render();
    old();
    await flush();
    assert.equal(count('get'), 0);
    query = { ...query, isError: false };
    childProps = find(parent.render(), Child);
    await press(cases[type === 'global' ? 0 : 1], child);
    assert.equal(count('webview'), 1);
    query = { ...query, data: [] };
    parent.render();
    const n = count('get');
    old();
    assert.equal(count('get'), n);
    child.unmount();
    parent.unmount();
  }
  // Adjacent refresh state is owned too: stale settlement cannot clear a replacement refresh.
  setup();
  query.data = [baseTool()];
  const refreshing = mount(() => toolsUI.default());
  const refreshControl = () => find(refreshing.render(), 'Screen').refreshControl.props;
  const refreshOne = defer(),
    refreshTwo = defer();
  queue('refetch', refreshOne.promise);
  const oldRefresh = refreshControl().onRefresh;
  oldRefresh();
  oldRefresh();
  assert.equal(count('refetch'), 1);
  query = { ...query, data: [{ ...baseTool(), id: 'replacement' }] };
  queue('refetch', refreshTwo.promise);
  refreshControl().onRefresh();
  refreshOne.resolve({});
  await flush();
  assert.equal(refreshControl().refreshing, true);
  refreshTwo.resolve({});
  await flush();
  assert.equal(refreshControl().refreshing, false);
  refreshing.unmount();
  oldRefresh();
  assert.equal(count('refetch'), 2);

  // Global row claims allow independent tools concurrently.
  setup();
  const one = mount(() => cases[0].render({ tool: baseTool() }));
  const two = mount(() => cases[0].render({ tool: { ...baseTool(), id: '2' } }));
  const first = defer();
  queue('get', first.promise);
  control(cases[0], one.render())();
  await press(cases[0], two);
  assert.equal(count('get'), 2);
  first.resolve(target);
  await flush();
  assert.equal(count('webview'), 2);
  one.unmount();
  two.unmount();
  // Actual route/web tab behavior remains local and offline; default-view change retires old route.
  setup();
  online = false;
  let tabProps = {
    tab: { ...baseTab(), external: false, id: 'home' },
    courseId: '42',
    defaultView: 'modules',
  };
  const tab = mount(() => tabsUI.TabRow(tabProps));
  const prior = control(cases[1], tab.render());
  await prior();
  assert.equal(count('route'), 1);
  tabProps = { ...tabProps, defaultView: 'feed' };
  const now = control(cases[1], tab.render());
  await prior();
  assert.equal(count('route'), 1);
  await now();
  assert.equal(last('webview')[1].url, '/tab');
  tab.unmount();
  // Non-tool OpenElsewhere stays actionable offline and keeps the original callback protocol.
  setup();
  online = false;
  const local = mount(() =>
    modulesUI.OpenElsewhere({
      item: { ...baseItem(), type: 'File' },
      detail: 'raw',
      action: 'raw',
      onPress: () => calls.push(['local']),
    }),
  );
  await control(cases[2], local.render())();
  assert.equal(count('local'), 1);
  local.unmount();
  // RichContent old launch message and navigation branches, presentation bridge continuity.
  setup();
  let doc = { html: '<p>original</p>' };
  const rich = mount(() => contentUI.RichContent(doc));
  const oldWeb = find(rich.render(), 'WebView');
  const injections = [];
  oldWeb.ref({ injectJavaScript: (x) => injections.push(x) });
  oldWeb.onLoadEnd();
  view('fr');
  const translated = find(rich.render(), 'WebView');
  assert.equal(oldWeb.source, translated.source);
  oldWeb.onMessage({ nativeEvent: { data: '{"type":"height","value":123.2}' } });
  assert.equal(find(rich.render(), 'View').style.height, 124);
  oldWeb.onMessage({ nativeEvent: { data: '{"type":"presentationReady"}' } });
  assert.ok(injections.length);
  doc = { html: '<p>replacement</p>' };
  const newWeb = find(rich.render(), 'WebView');
  assert.notEqual(oldWeb.source, newWeb.source);
  newWeb.onLoadEnd();
  oldWeb.onMessage({ nativeEvent: { data: '{"type":"launch","url":"/courses/42/external_tools/7"}' } });
  assert.equal(
    oldWeb.onShouldStartLoadWithRequest({ url: baseUrl + '/courses/42/external_tools/7', isTopFrame: true }),
    false,
  );
  await flush();
  assert.equal(count('get'), 0);
  await press(cases[5], rich);
  assert.equal(count('webview'), 1);
  rich.unmount();
  // Offline eligibility retires only tool launch paths; valid bridge messages still flow.
  setup();
  const offline = mount(() => contentUI.RichContent({ html: 'same' }));
  const onlineWeb = find(offline.render(), 'WebView');
  online = false;
  const offlineWeb = find(offline.render(), 'WebView');
  for (const web of [onlineWeb, offlineWeb])
    web.onMessage({ nativeEvent: { data: '{"type":"launch","url":"/courses/42/external_tools/7"}' } });
  await flush();
  assert.equal(count('get'), 0);
  offlineWeb.onMessage({ nativeEvent: { data: '{"type":"height","value":150}' } });
  assert.equal(find(offline.render(), 'View').style.height, 150);
  online = true;
  await press(cases[5], offline);
  assert.equal(count('webview'), 1);
  offline.unmount();
  // Parent-only module replacement invalidates a retained child handler before child render.
  setup();
  let moduleProps = { item: baseItem(), courseId: '42' };
  const moduleParent = mount(() => modulesUI.ToolItem(moduleProps));
  let moduleChildProps = find(moduleParent.render(), modulesUI.OpenElsewhere);
  const moduleChild = mount(() => modulesUI.OpenElsewhere(moduleChildProps));
  const moduleOld = control(cases[2], moduleChild.render());
  moduleProps = { ...moduleProps, courseId: 'next' };
  moduleParent.render();
  await moduleOld();
  assert.equal(count('get'), 0);
  moduleChildProps = find(moduleParent.render(), modulesUI.OpenElsewhere);
  await press(cases[2], moduleChild);
  assert.equal(count('webview'), 1);
  moduleChild.unmount();
  moduleParent.unmount();
  // Picked-tool branch preserves the URL and empty raw title exactly.
  setup();
  const picked = mount(() =>
    attemptsUI.AttemptContent({
      assignment: { ...baseAssignment(), kind: 'assignment', name: '' },
      attempt: { attempt: 2, type: 'basic_lti_launch', url: 'https://tool.invalid/raw?x=%2f' },
    }),
  );
  await press(cases[4], picked);
  assert.deepEqual(last('payload')[1], {
    courseId: '42',
    url: 'https://tool.invalid/raw?x=%2f',
    title: '',
    fallbackUrl: '/assignment',
  });
  picked.unmount();
  console.log(
    'tool-launch-consumers: six real consumers + real engine, committed races and 2330 preserved values passed',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
