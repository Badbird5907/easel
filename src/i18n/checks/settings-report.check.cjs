/* global __dirname */
// Executes ReportProblem, its form owner, the actual mutation wrapper and report serializer.
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
  useSyncExternalStore(subscribe, get) {
    const [, update] = react.useState(0);
    react.useLayoutEffect(() => subscribe(() => update((v) => v + 1)), [subscribe]);
    return get();
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
const { QueryClient, MutationObserver } = require('@tanstack/query-core');
const calls = { requests: [], success: [], error: [], warning: [], back: [], expired: [], network: [] };
let env, profile, queryClient, locale, focused, online, requests;
const application = { nativeApplicationVersion: '1.2.3', nativeBuildVersion: '42' };
const constants = { expoConfig: { version: '9.8.7' } };
const platform = { OS: 'ios', Version: '18.0' };
class AuthError extends Error {}
const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity, networkMode: 'always' } },
  });
function makeClient(id) {
  return {
    baseUrl: 'https://' + id + '.invalid',
    post: (url, body) => {
      assert.ok(requests.length, 'unexpected transport entry');
      calls.requests.push({ id, url, body, json: JSON.stringify(body) });
      return requests.shift().promise;
    },
  };
}
function reset() {
  Object.values(calls).forEach((v) => {
    v.length = 0;
  });
  env = {
    account: { id: 'a', user: { id: 'Comment' }, host: 'Report sent', baseUrl: 'https://a.invalid' },
    client: makeClient('a'),
  };
  profile = { data: { email: 'Subject' } };
  queryClient = makeQueryClient();
  locale = 'en';
  focused = online = true;
  requests = [];
  Object.assign(application, { nativeApplicationVersion: '1.2.3', nativeBuildVersion: '42' });
  constants.expoConfig = { version: '9.8.7' };
  Object.assign(platform, { OS: 'ios', Version: '18.0' });
}
const navigation = { isFocused: () => focused };
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
  'react-native': { View: 'View', Platform: platform },
  'lucide-react-native': Object.fromEntries(
    ['BookOpen', 'Bug', 'CircleCheck', 'LifeBuoy', 'MessageCircleQuestion'].map((k) => [k, k]),
  ),
  'expo-application': application,
  'expo-constants': constants,
  'expo-router': {
    Stack: { Screen: 'Stack.Screen' },
    router: { back: () => calls.back.push(true) },
    useLocalSearchParams: () => ({ report: '1' }),
    useIsFocused: () => focused,
    useNavigation: () => navigation,
  },
  'expo-web-browser': {},
  '@tanstack/react-query': { useQueryClient: () => queryClient },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/api/courses': {},
  '@/canvas/api/profile': { useProfile: () => profile },
  '@/canvas/query': { useCanvasMutation: (...args) => realMutation(...args) },
  '@/features/offline/connectivity': { isOnline: () => online },
  '@/features/offline/useOnline': { useOnline: () => online },
  '@/features/content/links': {},
  '@/features/course/states': {},
  '@/design': {
    ...design,
    haptics: Object.fromEntries(['success', 'error', 'warning'].map((k) => [k, () => calls[k].push(true)])),
  },
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
// Execute the exact production wrapper function, with only its external boundaries
// injected. React's useMutation lifecycle is simulated; installed query-core is real.
const querySource = fs.readFileSync(path.join(root, 'canvas/query.tsx'), 'utf8');
const wrapper = querySource.slice(
  querySource.indexOf('export function useCanvasMutation'),
  querySource.indexOf('/** Query-key prefix'),
);
const wrapperJS = ts.transpileModule(wrapper, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const realMutation = new Function(
  'exports',
  'useCanvas',
  'useMutation',
  'isOnline',
  'OfflineError',
  'reportReachable',
  'noteRequestError',
  'CanvasAuthError',
  'markAccountExpired',
  wrapperJS + '\nreturn exports.useCanvasMutation;',
)(
  {},
  () => env,
  (options) => {
    const [observer] = react.useState(() => new MutationObserver(queryClient, options));
    react.useEffect(() => {
      observer.setOptions(options);
    });
    return { mutateAsync: observer.mutate, reset: observer.reset };
  },
  () => online,
  class extends Error {},
  () => {},
  (error, url) => calls.network.push([error, url]),
  AuthError,
  async (...args) => {
    calls.expired.push(args);
  },
);
const runtime = load('@/i18n/runtime');
const HelpScreen = load('@/app/(app)/help').default;
const api = load('@/canvas/api/help');
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
const fields = (h) => nodes(h.tree, 'TextField');
const button = (h) => first(h, 'Button');
const select = (h) => first(h, 'OptionGroup');
const fill = (h, severity = 'just_a_comment') => {
  fields(h)[0].onChangeText(' Subject ');
  fields(h)[1].onChangeText(' Description ');
  select(h).onSelect(severity);
};
const enqueue = () => {
  const d = deferred();
  requests.push(d);
  return d;
};
const digest = (v) => crypto.createHash('sha256').update(v).digest('hex');
const values = [
  'just_a_comment',
  'not_urgent',
  'workaround_possible',
  'blocks_what_i_need_to_do',
  'extreme_critical_emergency',
];
async function main() {
  const baseline = require('./settings-report.baseline.json');
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2955);
    for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
      assert.equal(digest(JSON.stringify(catalog[key])), hash, lang + '/' + key);
    assert.equal(Object.keys(catalog).filter((k) => k.startsWith('settingsReport.')).length, 27);
    reset();
    locale = lang;
    let h = mounted();
    const t = runtime.createTranslator(lang);
    assert.equal(calls.requests.length, 0);
    assert.equal(first(h, 'Stack.Screen').options.title, t('settingsReport.title'));
    assert.equal(first(h, 'Text').children, t('settingsReport.instructions', { host: 'Report sent' }));
    assert.deepEqual(
      fields(h).map((v) => v.label),
      ['subject', 'description', 'replyTo'].map((v) => t('settingsReport.' + v)),
    );
    assert.equal(fields(h)[1].placeholder, t('settingsReport.placeholder'));
    assert.equal(fields(h)[2].helperText, t('settingsReport.replyHelp'));
    assert.equal(fields(h)[0].returnKeyType, 'next');
    assert.equal(fields(h)[1].multiline, true);
    assert.equal(fields(h)[2].autoComplete, 'email');
    assert.equal(fields(h)[2].keyboardType, 'email-address');
    assert.equal(fields(h)[2].autoCapitalize, 'none');
    assert.equal(fields(h)[2].textContentType, 'emailAddress');
    assert.equal(button(h).children, t('settingsReport.send'));
    await button(h).onPress();
    h.render();
    assert.equal(calls.warning.length, 1);
    assert.equal(fields(h)[0].error, t('settingsReport.subjectRequired'));
    assert.equal(fields(h)[1].error, t('settingsReport.descriptionRequired'));
    assert.ok(nodes(h.tree, 'Text').some((v) => v.children === t('settingsReport.severityRequired')));
    assert.equal(select(h).header, t('settingsReport.severity'));
    assert.deepEqual(
      select(h).options.map((v) => v.value),
      values,
    );
    for (const [i, key] of ['comment', 'notUrgent', 'workaround', 'blocking', 'emergency'].entries()) {
      assert.equal(select(h).options[i].label, t('settingsReport.' + key));
      assert.equal(select(h).options[i].subtitle, t('settingsReport.' + key + 'Body'));
    }
    const submit = button(h).onPress;
    fill(h); // No render: the retained callback must read all native edits.
    const d = enqueue();
    const run = submit();
    submit();
    fields(h)[2].onSubmitEditing();
    await flush();
    assert.equal(calls.requests.length, 1);
    const context = {
      Hostname: 'https://a.invalid',
      User: 'Comment',
      'App Version': 'Easel 1.2.3 (42)',
      Platform: 'iOS',
      'OS Version': '18.0',
    };
    const body = {
      error: {
        subject: 'Subject',
        comments:
          'Description\n\n-----------------------------------\nHostname: https://a.invalid\nUser: Comment\nApp Version: Easel 1.2.3 (42)\nPlatform: iOS\nOS Version: 18.0',
        email: 'Subject',
        user_perceived_severity: 'just_a_comment',
        url: 'https://a.invalid',
        http_env: context,
      },
    };
    assert.deepEqual(calls.requests[0], {
      id: 'a',
      url: '/api/v1/error_reports',
      body,
      json: JSON.stringify(body),
    });
    profile = { data: { email: 'new@example.invalid' } };
    h.render();
    d.resolve();
    await run;
    h.render();
    assert.equal(calls.success.length, 1);
    assert.equal(first(h, 'EmptyState').title, t('settingsReport.sent'));
    assert.equal(
      first(h, 'EmptyState').description,
      t('settingsReport.sentReply', { host: 'Report sent', email: 'Subject' }),
    );
    const done = first(h, 'EmptyState').action;
    assert.equal(done.label, t('settingsReport.done'));
    done.onPress();
    done.onPress();
    assert.equal(calls.back.length, 1);
    h.unmount();
  }
  // Same-account object/profile/locale refresh leaves the draft and severity alone.
  reset();
  let h = mounted();
  fill(h, values[4]);
  h.render();
  const oldSubmit = button(h).onPress;
  for (const lang of ['fr', 'ar', 'en']) {
    locale = lang;
    env = { ...env, account: { ...env.account, user: { ...env.account.user } } };
    profile = { data: { email: lang } };
    h.render();
    assert.deepEqual(
      fields(h).map((v) => v.value),
      [' Subject ', ' Description ', lang],
    );
    assert.equal(select(h).selected, values[4]);
  }
  fields(h)[2].onChangeText('');
  profile = { data: { email: 'should-not-return' } };
  h.render();
  assert.equal(fields(h)[2].value, '');
  let d = enqueue();
  let run = oldSubmit();
  await flush();
  assert.equal(calls.requests[0].body.error.email, undefined);
  assert.ok(!calls.requests[0].json.includes('"email"'));
  d.resolve();
  await run;
  h.render();
  assert.equal(
    first(h, 'EmptyState').description,
    runtime.createTranslator('en')('settingsReport.sentBody', { host: 'Report sent' }),
  );
  h.unmount();
  // Profile errors/pending/null emails do not impose a reporting policy.
  for (const data of [undefined, { email: null }]) {
    reset();
    profile = { data, isError: true, error: Error('profile denied') };
    h = mounted();
    fill(h);
    fields(h)[2].onChangeText(' manual@example.invalid ');
    d = enqueue();
    run = button(h).onPress();
    await flush();
    assert.equal(calls.requests[0].body.error.email, 'manual@example.invalid');
    d.resolve();
    await run;
    h.unmount();
  }
  // Entry connectivity recheck without a rerender; no automatic send on recovery.
  reset();
  h = mounted();
  fill(h);
  online = false;
  await button(h).onPress();
  assert.equal(calls.requests.length, 0);
  h.render();
  assert.equal(button(h).disabled, true);
  online = true;
  h.render();
  assert.equal(calls.requests.length, 0);
  d = enqueue();
  run = button(h).onPress();
  await flush();
  d.reject(Error('Subject'));
  await run;
  h.render();
  assert.equal(first(h, 'Callout').title, runtime.createTranslator('en')('settingsReport.failed'));
  assert.equal(first(h, 'Callout').children, 'Subject');
  assert.equal(fields(h)[0].value, ' Subject ');
  assert.equal(button(h).loading, false);
  assert.equal(calls.error.length, 1);
  d = enqueue();
  run = button(h).onPress();
  await flush();
  d.resolve();
  await run;
  h.render();
  assert.equal(calls.requests.length, 2);
  h.unmount();
  const transitions = [
    () => {
      env = { ...env, account: { ...env.account, id: 'b' } };
    },
    () => {
      env = { ...env, account: { ...env.account, user: { id: 'b' } } };
    },
    () => {
      env = { ...env, account: { ...env.account, baseUrl: 'https://b.invalid' } };
    },
    () => {
      env = { ...env, account: { ...env.account, host: 'Other' } };
    },
    () => {
      env = { ...env, client: makeClient('b') };
    },
    () => {
      queryClient = makeQueryClient();
    },
    () => {
      focused = false;
    },
  ];
  for (const change of transitions) {
    for (const outcome of ['resolve', 'reject']) {
      reset();
      h = mounted();
      fill(h);
      const retained = {
        input: fields(h)[0].onChangeText,
        select: select(h).onSelect,
        submit: button(h).onPress,
        keyboard: fields(h)[2].onSubmitEditing,
      };
      d = enqueue();
      run = retained.submit();
      await flush();
      assert.equal(calls.requests.length, 1);
      change();
      h.render();
      retained.input('STALE');
      retained.select(values[3]);
      retained.submit();
      retained.keyboard();
      d[outcome](outcome === 'reject' ? Error('late') : undefined);
      await run;
      h.render();
      assert.equal(calls.requests.length, 1);
      assert.equal(calls.success.length + calls.error.length, 0);
      assert.equal(first(h, 'EmptyState'), undefined);
      assert.equal(first(h, 'Callout'), undefined);
      assert.notEqual(fields(h)[0].value, 'STALE');
      h.unmount();
    }
    reset();
    h = mounted();
    fill(h);
    d = enqueue();
    run = button(h).onPress();
    await flush();
    d.resolve();
    await run;
    h.render();
    const done = first(h, 'EmptyState').action.onPress;
    change();
    h.render();
    done();
    assert.equal(calls.back.length, 0);
    h.unmount();
  }
  // Unmount retires every form callback and an accepted late transport completion.
  reset();
  h = mounted();
  fill(h);
  const retained = [
    button(h).onPress,
    fields(h)[2].onSubmitEditing,
    () => fieldsBefore[0].onChangeText('late'),
  ];
  const fieldsBefore = fields(h);
  d = enqueue();
  run = retained[0]();
  await flush();
  h.unmount();
  retained.forEach((f) => f());
  d.resolve();
  await run;
  assert.equal(calls.requests.length, 1);
  assert.equal(calls.success.length, 0);
  // A newer run survives the older run's finalizer (both resolution orders).
  for (const oldFirst of [true, false]) {
    reset();
    h = mounted();
    fill(h);
    const old = enqueue();
    const oldRun = button(h).onPress();
    await flush();
    env = { ...env, client: makeClient('b') };
    h.render();
    fill(h);
    const newer = enqueue();
    const newRun = button(h).onPress();
    await flush();
    if (oldFirst) {
      old.reject(Error('late'));
      await oldRun;
      h.render();
      assert.equal(button(h).loading, true);
    }
    newer.resolve();
    await newRun;
    h.render();
    const done = first(h, 'EmptyState').action.onPress;
    if (!oldFirst) {
      old.resolve();
      await oldRun;
      h.render();
    }
    assert.equal(calls.success.length, 1);
    assert.equal(calls.error.length, 0);
    done();
    done();
    assert.equal(calls.back.length, 1);
    h.unmount();
  }
  // Enter before passive observer option refresh: the original mutation wrapper
  // still owns auth expiry and request errors after later account/client renders.
  reset();
  h = mounted();
  fill(h);
  const originalClient = env.client;
  d = enqueue();
  run = button(h).onPress();
  env = {
    account: { id: 'b', user: { id: 'b' }, host: 'b', baseUrl: 'https://b.invalid' },
    client: makeClient('b'),
  };
  h.render();
  await flush();
  assert.equal(calls.requests[0].id, 'a');
  const authError = new AuthError('denied');
  d.reject(authError);
  await run;
  assert.deepEqual(calls.expired, [['a', originalClient]]);
  assert.deepEqual(calls.network, [[authError, 'https://a.invalid']]);
  assert.equal(calls.error.length, 0);
  h.unmount();
  // Speculative source/profile/locale renders never alter the committed draft or fallback.
  reset();
  h = mounted();
  fill(h);
  h.render();
  const originalEnv = env;
  const committed = button(h).onPress;
  env = { ...env, client: makeClient('b') };
  const abandoned = h.renderOnly();
  h.abandon();
  env = originalEnv;
  nodes(abandoned, 'TextField')[0].onChangeText('abandoned');
  await nodes(abandoned, 'Button')[0].onPress();
  assert.equal(calls.requests.length, 0);
  profile = { data: { email: 'speculative' } };
  locale = 'ar';
  h.renderOnly();
  h.abandon();
  profile = { data: { email: 'Subject' } };
  locale = 'en';
  d = enqueue();
  run = committed();
  await flush();
  assert.equal(calls.requests[0].body.error.email, 'Subject');
  d.resolve();
  await run;
  h.unmount();
  // Effect replay keeps the draft and duplicate admission claim; retired effects
  // cannot announce success. Once settled the current form can retry explicitly.
  reset();
  h = mounted();
  fill(h);
  h.render();
  h.replay();
  h.render();
  assert.equal(fields(h)[0].value, ' Subject ');
  d = enqueue();
  run = button(h).onPress();
  await flush();
  h.replay();
  button(h).onPress();
  assert.equal(calls.requests.length, 1);
  d.resolve();
  await run;
  h.render();
  assert.equal(calls.success.length, 0);
  assert.equal(button(h).loading, false);
  d = enqueue();
  run = button(h).onPress();
  await flush();
  d.resolve();
  await run;
  h.render();
  const staleDone = first(h, 'EmptyState').action.onPress;
  h.unmount();
  staleDone();
  assert.equal(calls.back.length, 0);
  // Editing while an entered request is pending preserves the newer draft.
  for (const outcome of ['resolve', 'reject']) {
    reset();
    h = mounted();
    fill(h);
    d = enqueue();
    run = button(h).onPress();
    await flush();
    fields(h)[0].onChangeText('newer draft');
    d[outcome](outcome === 'reject' ? Error('old') : undefined);
    await run;
    h.render();
    assert.equal(fields(h)[0].value, 'newer draft');
    assert.equal(calls.success.length + calls.error.length, 0);
    h.unmount();
  }
  // Success copy relocalizes without changing the submitted recipient or Done claim.
  reset();
  h = mounted();
  fill(h);
  d = enqueue();
  run = button(h).onPress();
  await flush();
  d.resolve();
  await run;
  h.render();
  const localeDone = first(h, 'EmptyState').action.onPress;
  locale = 'ar';
  profile = { data: { email: 'later' } };
  h.render();
  assert.equal(
    first(h, 'EmptyState').description,
    runtime.createTranslator('ar')('settingsReport.sentReply', { host: 'Report sent', email: 'Subject' }),
  );
  localeDone();
  first(h, 'EmptyState').action.onPress();
  assert.equal(calls.back.length, 1);
  h.unmount();
  // A focus cycle shares the draft, but new controls own a distinct run.
  reset();
  h = mounted();
  fill(h);
  const oldFocus = enqueue();
  const oldFocusRun = button(h).onPress();
  await flush();
  const oldInput = fields(h)[0].onChangeText;
  focused = false;
  h.render();
  focused = true;
  h.render();
  assert.equal(fields(h)[0].value, ' Subject ');
  oldInput('stale focus');
  assert.equal(fields(h)[0].value, ' Subject ');
  const newFocus = enqueue();
  const newFocusRun = button(h).onPress();
  await flush();
  oldFocus.resolve();
  await oldFocusRun;
  h.render();
  assert.equal(button(h).loading, true);
  newFocus.resolve();
  await newFocusRun;
  assert.equal(calls.success.length, 1);
  h.unmount();
  // Navigation's immediate focus state guards entry before the focus-hook render.
  reset();
  h = mounted();
  fill(h);
  focused = false;
  await button(h).onPress();
  assert.equal(calls.requests.length, 0);
  h.unmount();
  // Untouched fallback follows committed profile refresh even through retained callbacks.
  reset();
  h = mounted();
  fill(h);
  const profileSubmit = button(h).onPress;
  profile = { data: { email: ' updated@example.invalid ' } };
  h.render();
  d = enqueue();
  run = profileSubmit();
  await flush();
  assert.equal(calls.requests[0].body.error.email, 'updated@example.invalid');
  d.resolve();
  await run;
  h.unmount();
  for (const lang of ['en', 'fr', 'ar']) {
    reset();
    locale = lang;
    profile = { isError: true, data: undefined };
    h = mounted();
    fill(h);
    d = enqueue();
    run = button(h).onPress();
    await flush();
    assert.equal(calls.requests[0].body.error.email, undefined);
    d.reject(Error('Report sent'));
    await run;
    h.render();
    assert.equal(first(h, 'Callout').title, runtime.createTranslator(lang)('settingsReport.failed'));
    assert.equal(first(h, 'Callout').children, 'Report sent');
    h.unmount();
  }
  // Version/device fallback and every exact severity value use production form + serializer.
  for (const [i, value] of values.entries()) {
    reset();
    application.nativeApplicationVersion = i === 0 ? '' : null;
    application.nativeBuildVersion = i === 0 ? '' : null;
    if (i > 1) constants.expoConfig = null;
    platform.OS = i === 4 ? 'web' : 'android';
    platform.Version = 35;
    h = mounted();
    fill(h, value);
    d = enqueue();
    run = button(h).onPress();
    await flush();
    assert.equal(
      calls.requests[0].body.error.http_env['App Version'],
      i === 0 ? 'Easel  ()' : i === 1 ? 'Easel 9.8.7 (dev)' : 'Easel  (dev)',
    );
    assert.equal(calls.requests[0].body.error.http_env.Platform, 'Android');
    assert.equal(calls.requests[0].body.error.http_env['OS Version'], '35');
    assert.equal(calls.requests[0].body.error.user_perceived_severity, value);
    d.resolve();
    await run;
    h.unmount();
  }
  // Public helper argument order and raw protocol independent of presentation.
  let serialized;
  await api.sendProblemReport(
    {
      baseUrl: 'raw-url',
      post: async (...args) => {
        serialized = args;
      },
    },
    {
      subject: 'Comment',
      description: 'Done',
      severity: values[0],
      email: '',
      context: { Hostname: 'Subject', User: 'Done' },
    },
  );
  assert.deepEqual(serialized, [
    '/api/v1/error_reports',
    {
      error: {
        subject: 'Comment',
        comments: 'Done\n\n-----------------------------------\nHostname: Subject\nUser: Done',
        email: undefined,
        user_perceived_severity: values[0],
        url: 'raw-url',
        http_env: { Hostname: 'Subject', User: 'Done' },
      },
    },
  ]);
  console.log(
    'PASS settings-report: 3 locales, 2955 historical hashes/language, production form/serializer/mutation wrapper + installed observer, raw protocol, live drafts, deferred duplicate/offline/retry/source/focus/unmount/replay/abandoned and Done ownership; TZ=' +
      process.env.TZ,
  );
  console.log(
    'Synthetic hooks/native/session/transport only. No HTTP, reports, messages, storage, browser or device effects.',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
