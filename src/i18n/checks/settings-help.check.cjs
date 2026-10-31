/* global __dirname */
// Executes Help route, ownership helper and real Help API mapper with synthetic boundaries.
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
const calls = { push: [], browser: [], canvas: [], retry: [] };
let env, help, courses, queryClient, locale, focused, report, browserResult;
let useRealCanvasLinks = false;
const navigation = { isFocused: () => focused };
const course = { id: '27', name: 'Teachers', code: 'Help', color: 'raw-color' };
const links = () => [
  {
    id: 'ask',
    title: 'Ask an instructor',
    subtitle: 'Teachers',
    action: { kind: 'ask-instructor' },
    isNew: true,
    featured: true,
  },
  { id: 'report', title: 'Report a problem', subtitle: null, action: { kind: 'report-problem' } },
  {
    id: 'external',
    title: 'Help',
    subtitle: 'New',
    action: { kind: 'url', url: 'https://outside.invalid/help' },
  },
  { id: 'internal', title: 'Internal', action: { kind: 'url', url: '/courses/27' } },
  { id: 'fallback', title: 'Fallback', action: { kind: 'url', url: '/unknown' } },
];
const query = (data, kind) => ({
  data,
  isPending: false,
  isError: false,
  error: null,
  refetch: async () => {
    calls.retry.push(kind);
  },
});
function reset() {
  Object.values(calls).forEach((a) => {
    a.length = 0;
  });
  env = {
    account: { id: 'a', user: { id: 'u' }, host: 'Help', baseUrl: 'https://school.invalid' },
    client: {},
  };
  queryClient = {};
  locale = 'en';
  focused = true;
  report = undefined;
  browserResult = undefined;
  useRealCanvasLinks = false;
  help = query({ name: 'Help', nameOrigin: 'generated-help', links: links() }, 'help');
  courses = query([course], 'courses');
}
const design = Object.fromEntries(
  [
    'AccentScope',
    'Badge',
    'Button',
    'Callout',
    'Card',
    'EmptyState',
    'IconTile',
    'ListGroup',
    'ListItem',
    'OptionGroup',
    'Screen',
    'Sheet',
    'Text',
    'TextField',
  ].map((k) => [k, k]),
);
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'View', Platform: { OS: 'ios' } },
  'lucide-react-native': Object.fromEntries(
    ['BookOpen', 'Bug', 'CircleCheck', 'LifeBuoy', 'MessageCircleQuestion'].map((k) => [k, k]),
  ),
  'expo-application': {},
  'expo-constants': {},
  'expo-router': {
    Stack: { Screen: 'Stack.Screen' },
    router: { push: (v) => calls.push.push(v) },
    useLocalSearchParams: () => ({ report }),
    useNavigation: () => navigation,
    useIsFocused: () => focused,
  },
  'expo-web-browser': {
    openBrowserAsync: (url) => {
      calls.browser.push(url);
      return browserResult ?? Promise.resolve({ type: 'opened' });
    },
  },
  '@tanstack/react-query': { useQueryClient: () => queryClient },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/query': {
    useCanvasQuery: (key, fn, options) => {
      assert.deepEqual(key, ['help', 'links']);
      assert.equal(options.staleTime, 3600000);
      return help;
    },
    useCanvasMutation: () => {
      throw Error('Report submission must not run');
    },
  },
  '@/canvas/api/courses': { useDashboardCourses: () => courses },
  '@/canvas/api/profile': {
    useProfile: () => {
      throw Error('Report form must not mount');
    },
  },
  '@/features/offline/useOnline': { useOnline: () => true },
  '@/features/offline/connectivity': {
    isOnline: () => {
      throw Error('Report entry is forbidden in Help browsing checks');
    },
  },
  '@/features/content/links': {
    openCanvasLink: (...args) => {
      calls.canvas.push(args);
      if (useRealCanvasLinks) return realCanvasLinks.openCanvasLink(...args);
    },
    resolveCanvasLink: (url) => (url === '/courses/27' ? {} : null),
  },
  '@/features/course/states': { ListSkeleton: 'ListSkeleton', LoadError: 'LoadError' },
  '@/design': design,
  '@/i18n': { useTranslation: () => ({ locale, t: runtime.createTranslator(locale) }) },
};
function load(file, from = root) {
  if (Object.hasOwn(stubs, file)) return stubs[file];
  let p = file.startsWith('@/') ? path.join(root, file.slice(2)) : path.resolve(from, file);
  if (!path.extname(p)) p += fs.existsSync(p + '.ts') ? '.ts' : '.tsx';
  const alias = '@/' + path.relative(root, p).replace(/\.tsx?$/, '');
  if (Object.hasOwn(stubs, alias)) return stubs[alias];
  assert.ok(p.startsWith(root + '/'), 'unmocked module: ' + file);
  if (cache.has(p)) return cache.get(p);
  const code = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
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
const HelpScreen = load('@/app/(app)/help').default;
const api = load('@/canvas/api/help');
// Keep existing isolated route assertions, and additionally execute the shared
// production browser fallback so a lost promise cannot pass behind a stub.
const canvasLinksStub = stubs['@/features/content/links'];
delete stubs['@/features/content/links'];
const realCanvasLinks = load('@/features/content/links');
stubs['@/features/content/links'] = canvasLinksStub;
function nodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap((v) => nodes(v, type));
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree.props] : []), ...nodes(tree.props.children, type)];
}
const first = (h, type) => nodes(h.tree, type)[0];
const mounted = () => {
  const h = mount(() => jsx(HelpScreen, {}));
  h.render();
  return h;
};
const link = (h, title = 'Ask an instructor') => nodes(h.tree, 'ListItem').find((n) => n.title === title);
const sheet = (h) => first(h, 'Sheet');
const openSheet = (h) => {
  link(h).onPress();
  h.render();
  assert.equal(sheet(h).visible, true);
};
const select = (h) => link(h, 'Teachers')?.onPress;
const digest = (v) => crypto.createHash('sha256').update(v).digest('hex');
async function main() {
  const baseline = require('./settings-help.baseline.json');
  for (const language of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + language)[language];
    assert.equal(Object.keys(baseline.catalogs[language]).length, 2906);
    for (const [key, hash] of Object.entries(baseline.catalogs[language]))
      assert.equal(digest(JSON.stringify(catalog[key])), hash, language + '/' + key);
    assert.equal(Object.keys(catalog).filter((k) => k.startsWith('settingsHelp.')).length, 16);
  }
  const source = fs.readFileSync(path.join(root, 'app/(app)/help.tsx'), 'utf8');
  const apiSource = fs.readFileSync(path.join(root, 'canvas/api/help.ts'), 'utf8');
  assert.equal(digest(source.slice(source.indexOf('/** "Report a problem"'))), baseline.reportSource);
  assert.equal(
    digest(source.slice(source.indexOf('const severities:'), source.indexOf('/** The school'))),
    baseline.severitySource,
  );
  assert.equal(
    digest(apiSource.slice(apiSource.indexOf('/** `user_perceived_severity`'))),
    baseline.reportApiSource,
  );
  // Execute the real mapper with a fail-closed client; no HTTP transport exists.
  const signal = new AbortController().signal;
  let raw = {};
  const client = {
    get: async (...args) => {
      assert.deepEqual(args, ['/api/v1/accounts/self/help_links', undefined, signal]);
      return raw;
    },
  };
  for (const name of [undefined, '', 'Help', 'New', 'Aide']) {
    raw = { help_link_name: name };
    const result = await api.fetchHelpLinks(client, signal);
    assert.equal(result.name, name || 'Help');
    assert.equal(result.nameOrigin, name ? undefined : 'generated-help');
  }
  const rawLinks = [
    { id: 'ordinary', text: 'Help', url: ' https://example.invalid/ ' },
    { id: 'hidden', text: 'Teacher', url: '/hidden', available_to: ['teacher'] },
    {
      id: 'feature',
      text: 'New',
      subtext: ' Teachers ',
      url: '#teacher_feedback',
      available_to: ['student'],
      is_featured: true,
      is_new: true,
    },
    { id: 'report_a_problem', text: 'Report', url: '#create_ticket', available_to: ['user'] },
    { id: 'other', text: 'Other', url: '#ada_chatbot' },
    { text: '', url: '/no-title' },
    { text: 'Nobody', url: '/none', available_to: [] },
  ];
  raw = { default_help_links: rawLinks };
  const defaults = await api.fetchHelpLinks(client, signal);
  assert.deepEqual(
    defaults.links.map((l) => l.id),
    ['feature', 'ordinary', 'report_a_problem'],
  );
  assert.deepEqual(
    defaults.links.map((l) => l.action),
    [
      { kind: 'ask-instructor' },
      { kind: 'url', url: 'https://example.invalid/' },
      { kind: 'report-problem' },
    ],
  );
  assert.equal(defaults.links[0].subtitle, 'Teachers');
  assert.equal(defaults.links[0].isNew, true);
  raw.custom_help_links = [];
  assert.deepEqual(await api.fetchHelpLinks(client, signal), defaults);
  raw.custom_help_links = [{ text: 'Custom', url: '/custom' }];
  assert.deepEqual(
    (await api.fetchHelpLinks(client, signal)).links.map((l) => l.id),
    ['link-0'],
  );
  raw.custom_help_links = [{ text: 'Hidden', url: '/custom', available_to: ['teacher'] }];
  assert.equal((await api.fetchHelpLinks(client, signal)).links.length, 0);
  for (const lang of ['en', 'fr', 'ar']) {
    reset();
    locale = lang;
    const t = runtime.createTranslator(lang);
    let h = mounted();
    assert.equal(first(h, 'Stack.Screen').options.title, t('settingsHelp.title'));
    assert.equal(link(h).title, 'Ask an instructor');
    assert.equal(link(h).subtitle, 'Teachers');
    assert.equal(
      link(h).accessibilityLabel,
      t('settingsHelp.linkLabel', {
        title: 'Ask an instructor',
        details:
          t('settingsHelp.separator') + t('settingsHelp.new') + t('settingsHelp.separator') + 'Teachers',
      }),
    );
    assert.equal(first(h, 'ListGroup').footer, t('settingsHelp.footer', { host: 'Help' }));
    for (const name of ['Help', 'New', 'Teachers']) {
      help = { ...help, data: { name, links: links() } };
      h.render();
      assert.equal(first(h, 'Stack.Screen').options.title, name);
    }
    openSheet(h);
    assert.equal(sheet(h).title, t('settingsHelp.ask'));
    assert.equal(link(h, 'Teachers').subtitle, 'Help');
    const launch = select(h);
    launch();
    launch();
    assert.deepEqual(calls.push, [
      {
        pathname: '/compose',
        params: {
          courseId: '27',
          recipientIds: 'course_27_teachers',
          recipientNames: t('settingsHelp.teachers'),
        },
      },
    ]);
    h.unmount();
    reset();
    locale = lang;
    help = { ...help, data: undefined, isPending: true };
    h = mounted();
    assert.equal(first(h, 'View').accessibilityLabel, t('settingsHelp.loading'));
    help = { ...help, isPending: false };
    h.render();
    assert.equal(first(h, 'View').accessibilityLabel, t('settingsHelp.loading'));
    help = { ...help, data: { name: 'Help', links: [] } };
    h.render();
    assert.equal(first(h, 'EmptyState').description, t('settingsHelp.emptyBody', { host: 'Help' }));
    help = { ...help, isError: true, error: Error('Help') };
    h.render();
    assert.equal(first(h, 'LoadError').error.message, 'Help');
    h.unmount();
    reset();
    locale = lang;
    h = mounted();
    openSheet(h);
    courses = { ...courses, data: undefined, isPending: true };
    h.render();
    assert.equal(first(h, 'Text').children, t('settingsHelp.coursesLoading'));
    courses = { ...courses, isPending: false };
    h.render();
    assert.equal(first(h, 'Text').children, t('settingsHelp.coursesLoading'));
    courses = { ...courses, data: [] };
    h.render();
    assert.equal(first(h, 'Text').children, t('settingsHelp.coursesEmpty'));
    courses = { ...courses, data: [course], isError: true, error: Error('Teachers') };
    h.render();
    assert.equal(first(h, 'LoadError').title, t('settingsHelp.coursesError'));
    assert.equal(select(h), undefined);
    h.unmount();
  }
  reset();
  let h = mounted();
  openSheet(h);
  const retainedSelection = select(h);
  locale = 'fr';
  h.render();
  assert.equal(sheet(h).visible, true);
  retainedSelection();
  assert.equal(calls.push[0].params.recipientNames, 'Enseignants');
  h.unmount();
  reset();
  h = mounted();
  openSheet(h);
  const close = sheet(h).onClose;
  close();
  h.render();
  openSheet(h);
  close();
  h.render();
  assert.equal(sheet(h).visible, true);
  h.unmount();
  // Every committed source transition retires link, Sheet and course callbacks.
  const transitions = [
    () => {
      env = { ...env, account: { ...env.account, id: 'b' } };
    },
    () => {
      env = { ...env, account: { ...env.account, user: { id: 'v' } } };
    },
    () => {
      env = { ...env, account: { ...env.account, baseUrl: 'https://other.invalid' } };
    },
    () => {
      env = { ...env, account: { ...env.account, expired: true } };
    },
    () => {
      env = { ...env, client: {} };
    },
    () => {
      queryClient = {};
    },
    () => {
      help = { ...help, data: { ...help.data, links: links() } };
    },
    () => {
      help = { ...help, isError: true, error: Error('denied') };
    },
    () => {
      help = { ...help, isPending: true };
    },
    () => {
      help = {
        ...help,
        refetch: async () => {
          calls.retry.push('new');
        },
      };
    },
    () => {
      focused = false;
    },
  ];
  for (const change of transitions) {
    reset();
    h = mounted();
    openSheet(h);
    const retained = [
      link(h, 'Report a problem').onPress,
      link(h, 'Help').onPress,
      select(h),
      sheet(h).onClose,
    ];
    change();
    h.render();
    for (const action of retained) await action();
    assert.equal(calls.push.length, 0);
    assert.equal(calls.browser.length, 0);
    assert.equal(sheet(h).visible, false);
    h.unmount();
  }
  for (const change of [
    () => {
      courses = { ...courses, data: [{ ...course }] };
    },
    () => {
      courses = { ...courses, isError: true, error: Error('denied') };
    },
    () => {
      courses = { ...courses, isPending: true };
    },
    () => {
      courses = { ...courses, refetch: async () => {} };
    },
  ]) {
    reset();
    h = mounted();
    openSheet(h);
    const old = select(h);
    const oldDismiss = sheet(h).onClose;
    change();
    h.render();
    old();
    oldDismiss();
    h.render();
    assert.equal(calls.push.length, 0);
    assert.equal(sheet(h).visible, true);
    h.unmount();
  }
  reset();
  h = mounted();
  const press = link(h, 'Report a problem').onPress;
  press();
  press();
  assert.deepEqual(calls.push, [{ pathname: '/help', params: { report: '1' } }]);
  h.unmount();
  reset();
  h = mounted();
  const internal = link(h, 'Internal').onPress;
  internal();
  internal();
  assert.deepEqual(calls.canvas, [['/courses/27', 'https://school.invalid']]);
  h.unmount();
  reset();
  h = mounted();
  const fallback = link(h, 'Fallback').onPress;
  fallback();
  fallback();
  await flush();
  assert.deepEqual(calls.canvas, [['/unknown', 'https://school.invalid']]);
  h.unmount();
  // Same-school fallback keeps its entry claim until the real helper's native
  // promise settles, including owner replacement and rejection.
  for (const outcome of ['resolve', 'reject']) {
    reset();
    useRealCanvasLinks = true;
    const firstBrowser = deferred();
    browserResult = firstBrowser.promise;
    h = mounted();
    const oldFallback = link(h, 'Fallback').onPress;
    oldFallback();
    await flush();
    oldFallback();
    assert.equal(calls.browser.length, 1, 'pending same-school browser must coalesce across awaits');
    assert.equal(calls.browser[0], 'https://school.invalid/unknown');
    env = { ...env, client: {} };
    h.render();
    link(h, 'Fallback').onPress();
    assert.equal(calls.browser.length, 1, 'owner replacement cannot bypass an entered browser');
    firstBrowser[outcome](outcome === 'reject' ? Error('synthetic browser failure') : { type: 'dismiss' });
    await flush();
    const secondBrowser = deferred();
    browserResult = secondBrowser.promise;
    link(h, 'Fallback').onPress();
    oldFallback();
    await flush();
    assert.equal(calls.browser.length, 2, 'current control recovers; retired control stays inert');
    assert.equal(calls.push.length, 0);
    h.unmount();
    secondBrowser.reject(Error('synthetic late rejection'));
    await flush();
    assert.equal(calls.browser.length, 2);
  }
  reset();
  const browser = deferred();
  browserResult = browser.promise;
  h = mounted();
  const external = link(h, 'Help').onPress;
  external();
  external();
  assert.deepEqual(calls.browser, ['https://outside.invalid/help']);
  env = { ...env, client: {} };
  h.render();
  link(h, 'Help').onPress();
  assert.equal(calls.browser.length, 1);
  browser.resolve();
  await flush();
  link(h, 'Help').onPress();
  await flush();
  assert.equal(calls.browser.length, 2);
  await external();
  assert.equal(calls.browser.length, 2);
  h.unmount();
  // Query retries coalesce across owner replacement; completion cannot clear another claim or reopen a Sheet.
  for (const kind of ['help', 'courses']) {
    reset();
    const d = deferred();
    const retry = () => {
      calls.retry.push(kind);
      return d.promise;
    };
    if (kind === 'help') help = { ...help, isError: true, error: Error('raw'), refetch: retry };
    else courses = { ...courses, isError: true, error: Error('raw'), refetch: retry };
    h = mounted();
    if (kind === 'courses') openSheet(h);
    const old = first(h, 'LoadError').onRetry;
    old();
    old();
    assert.equal(calls.retry.length, 1);
    env = { ...env, client: {} };
    h.render();
    if (kind === 'courses') openSheet(h);
    first(h, 'LoadError').onRetry();
    assert.equal(calls.retry.length, 1);
    d.reject(Error('late'));
    await flush();
    first(h, 'LoadError').onRetry();
    await flush();
    assert.equal(calls.retry.length, 2);
    old();
    assert.equal(calls.retry.length, 2);
    const disposedRetry = first(h, 'LoadError').onRetry;
    h.unmount();
    disposedRetry();
    assert.equal(calls.retry.length, 2);
  }
  // Immediate navigation focus check covers the interval before a focus-hook commit.
  reset();
  h = mounted();
  openSheet(h);
  const staleSelect = select(h);
  focused = false;
  staleSelect();
  assert.equal(calls.push.length, 0);
  h.unmount();
  // Abandoned render cannot retire the committed owner or activate speculative callbacks.
  reset();
  h = mounted();
  openSheet(h);
  const committedClose = sheet(h).onClose;
  const original = help;
  help = { ...help, data: { ...help.data, links: links() } };
  const draft = h.renderOnly();
  h.abandon();
  help = original;
  await nodes(draft, 'ListItem')
    .find((n) => n.title === 'Help')
    .onPress();
  assert.equal(calls.browser.length, 0);
  committedClose();
  h.render();
  assert.equal(sheet(h).visible, false);
  h.replay();
  openSheet(h);
  const unmounted = [select(h), sheet(h).onClose, link(h, 'Help').onPress];
  h.unmount();
  for (const f of unmounted) await f();
  assert.equal(calls.push.length, 0);
  assert.equal(calls.browser.length, 0);
  // A speculative locale must not replace the committed recipient snapshot.
  reset();
  h = mounted();
  openSheet(h);
  const launchBeforeLocale = select(h);
  locale = 'ar';
  h.renderOnly();
  h.abandon();
  locale = 'en';
  launchBeforeLocale();
  assert.equal(calls.push[0].params.recipientNames, 'Teachers');
  h.unmount();
  // Unknown provenance and legacy collisions are never inferred from English text.
  reset();
  locale = 'fr';
  help = { ...help, data: { ...help.data, nameOrigin: 'future-origin' } };
  h = mounted();
  assert.equal(first(h, 'Stack.Screen').options.title, 'Help');
  h.unmount();
  // Installed query-core produces real cached-error results, with synthetic rejection only.
  const { QueryClient, QueryObserver } = require('@tanstack/query-core');
  for (const kind of ['help', 'courses']) {
    reset();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const observer = new QueryObserver(qc, {
      queryKey: ['a', kind],
      enabled: false,
      initialData: kind === 'help' ? help.data : courses.data,
      queryFn: async () => {
        throw Error('Denied');
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    if (kind === 'help') help = observer.getCurrentResult();
    else courses = observer.getCurrentResult();
    h = mounted();
    openSheet(h);
    const retained = kind === 'help' ? link(h, 'Report a problem').onPress : select(h);
    await observer.refetch();
    const failed = observer.getCurrentResult();
    assert.equal(failed.isError, true);
    assert.ok(failed.data);
    if (kind === 'help') help = failed;
    else courses = failed;
    h.render();
    retained();
    assert.equal(calls.push.length, 0);
    assert.equal(first(h, 'LoadError').error.message, 'Denied');
    if (kind === 'help') assert.equal(sheet(h).visible, false);
    else assert.equal(select(h), undefined);
    h.unmount();
    unsubscribe();
    observer.destroy();
    qc.clear();
  }
  // Replay while a browser promise is pending does not release its duplicate claim.
  reset();
  const d = deferred();
  browserResult = d.promise;
  h = mounted();
  link(h, 'Help').onPress();
  h.replay();
  link(h, 'Help').onPress();
  assert.equal(calls.browser.length, 1);
  h.unmount();
  d.reject(Error('late'));
  await flush();
  console.log(
    'PASS settings-help: 3 locales, 2906 historical hashes/language, raw/provenance/API/routes, error/cache gating, duplicate/retry/browser and committed source/focus/Sheet/unmount/replay/abandoned ownership; TZ=' +
      process.env.TZ,
  );
  console.log(
    'Synthetic hooks/query/router/browser/session/transport only; no HTTP, native, storage or message/report effects.',
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
