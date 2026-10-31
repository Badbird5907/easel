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

const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
const requests = [],
  injections = [],
  launches = [],
  links = [];
const timers = new Map(),
  listeners = new Set();
let timerId = 0,
  env,
  online = true,
  assets = {},
  theme = null,
  fontScale = 1,
  scheme = 'light';
let stored = true;
const colors = new Proxy({}, { get: () => '#112233' });
const client = (baseUrl = 'https://canvas.invalid') => ({
  baseUrl,
  get(url, params) {
    const d = defer();
    requests.push({ ...d, client: this, url, params });
    return d.promise;
  },
});
const defer = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const jsx = (type, props, key) => ({ type, props, key });
const mock = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': {
    View: 'View',
    Platform: { OS: 'ios' },
    PixelRatio: { getFontScale: () => fontScale },
    AppState: {
      addEventListener(type, fn) {
        assert.equal(type, 'change');
        listeners.add(fn);
        return { remove: () => listeners.delete(fn) };
      },
    },
  },
  'react-native-webview': { WebView: 'WebView' },
  'expo-web-browser': {
    openBrowserAsync() {
      throw Error('native browser forbidden');
    },
  },
  '@/canvas/query': {
    useCanvasQuery() {
      throw Error('unexpected query');
    },
  },
  '@/canvas/session': {
    useCanvas: () => env,
    isStoredAccountClient: (id, c) =>
      stored && id === env.account.id && c === env.client && !env.account.expired,
  },
  '@/design': { useTheme: () => ({ colors, scheme }) },
  '@/canvas/api/brand': {
    extractThemeFiles: (html) => ({ html, files: [] }),
    useSchoolTheme: () => ({ data: theme }),
  },
  '@/features/offline/schoolTheme': { useSchoolThemeEnabled: () => true },
  '@/features/offline/useOnline': { useOnline: () => online },
  '@/features/offline/store': { useLocalStore: () => assets },
  '@/features/sync/assets': { assetIndex: {}, offlineAssetHtml: (_a, _b, html) => html + '<!-- offline -->' },
  '@/features/lti/launch': {
    useLaunchTool:
      () =>
      async (...args) =>
        launches.push(args),
  },
  '@/features/content/links': { openCanvasLink: (...args) => links.push(args) },
};
const allowed = new Set([
  'features/content/RichContent',
  'features/content/session',
  'features/content/presentation',
  'features/content/browser',
  'features/web/session',
  'features/lti/action',
  'features/lti/lifetime',
  'canvas/api/lti',
  'canvas/client',
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
  if (mock[key]) return mock[key];
  assert.ok(key.startsWith('@/') && allowed.has(key.slice(2)), key);
  const file = ['.ts', '.tsx', '/index.ts']
    .map((ext) => path.join(root, key.slice(2)) + ext)
    .find(fs.existsSync);
  if (cache.has(file)) return cache.get(file).exports;
  const m = { exports: {} };
  cache.set(file, m);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', code)(
    (n) => load(n, file),
    m,
    m.exports,
    (fn, delay) => {
      assert.equal(delay, 600000);
      timers.set(++timerId, fn);
      return timerId;
    },
    (id) => timers.delete(id),
  );
  return m.exports;
}
const runtime = load('@/i18n/runtime');
const { RichContent, buildDocument } = load('@/features/content/RichContent');
const { useContentSession } = load('@/features/content/session');
const sessions = load('@/features/web/session');
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
const message = (web, type) => web.props.onMessage({ nativeEvent: { data: JSON.stringify({ type }) } });
function find(tree, type) {
  if (!tree) return;
  if (tree.type === type) return tree;
  return [tree.props?.children]
    .flat()
    .map((t) => find(t, type))
    .find(Boolean);
}
const handle = () => ({ injectJavaScript: (script) => injections.push(script) });
const sessionScripts = () => injections.filter((s) => /window.easel(Session|RefreshSession) &&/.test(s));
function setup() {
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
  requests.length = injections.length = launches.length = links.length = 0;
  env = { account: { id: 'a', baseUrl: 'https://canvas.invalid' }, client: client() };
  stored = true;
  online = true;
  assets = {};
  theme = null;
  fontScale = 1;
  scheme = 'light';
  sessions.markSessionStarted('sentinel');
  runtime.setAccountLocale('a', 'en');
}
const initialHtml = '<iframe src="/media_objects_iframe/one"></iframe>';
function component() {
  let props = { html: initialHtml };
  const m = mount(() => RichContent(props));
  let lastRef, web;
  const render = () => {
    web = find(m.render(), 'WebView');
    if (web.props.ref !== lastRef) {
      lastRef?.(null);
      web.props.ref(handle());
      lastRef = web.props.ref;
    }
    return web;
  };
  render();
  return {
    m,
    render,
    get web() {
      return web;
    },
    change: (patch) => {
      props = { ...props, ...patch };
      return render();
    },
  };
}
(async () => {
  // Every historical value is frozen, while future unrelated/additive keys are allowed.
  const baseline = require('./tool-launch-consumers.baseline.json');
  for (const lang of ['en', 'fr', 'ar']) {
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2330);
    const catalog = load('@/i18n/' + lang)[lang];
    for (const [key, digest] of Object.entries(baseline.catalogs[lang]))
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
        digest,
        key,
      );
  }

  // Actual component, unchanged sessionStartUrl -> sessionUrl, in-memory transport.
  for (const outcome of ['success', 'failure', 'blocked']) {
    setup();
    const c = component();
    message(c.web, 'session');
    message(c.web, 'session');
    assert.equal(requests.length, 1);
    assert.equal(timers.size, 1);
    assert.equal(listeners.size, 1);
    assert.equal(requests[0].client, env.client);
    assert.equal(requests[0].url, '/api/v1/login/session_token');
    assert.deepEqual(requests[0].params, { return_to: env.client.baseUrl + '/favicon.ico' });
    if (outcome === 'failure') requests[0].reject(Error('blocked'));
    else
      requests[0].resolve({
        session_url:
          outcome === 'blocked' ? env.client.baseUrl + '/favicon.ico' : 'https://signed.invalid/one',
      });
    await flush();
    assert.equal(sessionScripts().length, 1);
    assert.ok(
      sessionScripts()[0].includes(outcome === 'success' ? '"https://signed.invalid/one"' : '(null)'),
    );
    assert.equal(sessions.sessionIsFresh('a'), outcome === 'success');
    message(c.web, 'session');
    assert.equal(requests.length, 1);
    // Real periodic + AppState overlap coalesces. Failure refresh never activates again.
    [...timers.values()][0]();
    [...timers.values()][0]();
    [...listeners][0]('active');
    assert.equal(requests.length, 2);
    requests[1].reject(Error('refresh blocked'));
    await flush();
    assert.equal(sessionScripts().length, 1);
    c.m.unmount();
  }
  setup();
  sessions.markSessionStarted('a');
  {
    const c = component();
    message(c.web, 'session');
    assert.equal(requests.length, 0);
    assert.match(sessionScripts()[0], /easelSession\(null\)/);
    [...listeners][0]('background');
    [...listeners][0]('active');
    assert.equal(requests.length, 0);
    c.m.unmount();
  }

  // Both overlap orders exercise the actual owner, not a test algorithm.
  for (const order of [
    [true, false],
    [false, true],
  ])
    for (const outcome of ['success', 'failure', 'fresh-refresh']) {
      setup();
      const source = {};
      const m = mount(() => useContentSession('a', env.account.baseUrl, env.client, source, false));
      const owner = m.render();
      owner.attach(handle());
      void owner.request(order[0]);
      if (outcome === 'fresh-refresh') sessions.markSessionStarted('a');
      void owner.request(order[1]);
      void owner.request(order[0]);
      assert.equal(requests.length, 1);
      if (outcome === 'failure') requests[0].reject(Error('blocked'));
      else requests[0].resolve({ session_url: 'https://signed.invalid/joined' });
      await flush();
      assert.equal(sessionScripts().length, 1);
      assert.match(sessionScripts()[0], /window.easelSession &&/);
      assert.ok(sessionScripts()[0].includes(outcome === 'failure' ? '(null)' : '/joined'));
      m.unmount();
    }

  setup();
  {
    const discarded = mount(() => RichContent({ html: initialHtml }));
    assert.equal(find(discarded.renderOnly(), 'WebView'), undefined);
    discarded.abandon();
    discarded.unmount();
    assert.equal(requests.length, 0);
    assert.equal(timers.size, 0);
  }

  const changes = {
    account(c) {
      env = { account: { ...env.account, id: 'b' }, client: client() };
      c.render();
    },
    client(c) {
      env = { ...env, client: client() };
      c.render();
    },
    baseUrl(c) {
      env = { ...env, account: { ...env.account, baseUrl: 'https://other.invalid' } };
      c.render();
    },
    document(c) {
      c.change({ html: '<p>no embeds</p>' });
    },
    theme(c) {
      theme = { css: ['p { color: red; }'], js: [] };
      c.render();
    },
    font(c) {
      fontScale = 1.5;
      c.render();
    },
    variant(c) {
      c.change({ variant: 'subhead' });
    },
    scheme(c) {
      scheme = 'dark';
      c.render();
    },
    offline(c) {
      online = false;
      c.render();
    },
    handle(c) {
      c.web.props.ref(handle());
      c.render();
    },
    missingHandle(c) {
      c.web.props.ref(null);
    },
    unmount(c) {
      c.m.unmount();
    },
    replay(c) {
      c.m.replayEffects();
      c.render();
    },
    awayBack(c) {
      c.change({ html: 'away' });
      c.change({ html: initialHtml });
    },
    expired(c) {
      env = { ...env, account: { ...env.account, expired: true } };
      c.render();
    },
    storedExpiry() {
      stored = false;
    },
  };
  for (const [name, change] of Object.entries(changes))
    for (const failure of [false, true]) {
      setup();
      const c = component(),
        old = c.web;
      message(old, 'session');
      const timer = [...timers.values()][0],
        listener = [...listeners][0];
      change(c);
      const count = requests.length;
      message(old, 'session');
      old.props.onLoadEnd();
      timer();
      listener('active');
      assert.equal(requests.length, count, name + ': stale entry');
      if (failure) requests[0].reject(Error('late'));
      else requests[0].resolve({ session_url: 'https://signed.invalid/stale' });
      await flush();
      assert.equal(sessionScripts().length, 0, name + ': stale injection');
      assert.equal(sessions.sessionIsFresh('a'), false, name + ': stale freshness');
      assert.equal(sessions.sessionIsFresh('sentinel'), true, name + ': must not clear shared freshness');
      if (name !== 'unmount') c.m.unmount();
    }

  // Imperative-ref cleanup/setup replay retains the native key (no remount loop),
  // retires old callbacks and retries demand with a new operation and handle.
  setup();
  {
    const c = component(),
      old = c.web;
    message(old, 'presentationReady');
    message(old, 'session');
    old.props.ref(null);
    old.props.ref(handle());
    const next = c.render();
    assert.equal(next.key, old.key);
    assert.notEqual(next.props.ref, old.props.ref);
    assert.equal(requests.length, 2);
    message(old, 'session');
    old.props.onLoadEnd();
    assert.equal(requests.length, 2);
    requests[0].resolve({ session_url: 'https://signed.invalid/ref-old' });
    requests[1].resolve({ session_url: 'https://signed.invalid/ref-new' });
    await flush();
    assert.equal(sessionScripts().length, 1);
    assert.ok(sessionScripts()[0].includes('/ref-new'));
    runtime.setAccountLocale('a', 'fr');
    c.render();
    assert.ok(injections.at(-1).includes(load('@/i18n/fr').fr['content.openTool']));
    assert.equal(c.render().key, next.key);
    assert.equal(requests.length, 2);
    c.m.unmount();
  }

  // New document can make progress while an old token remains unresolved.
  setup();
  {
    const c = component(),
      old = c.web;
    message(old, 'session');
    const oldTimer = [...timers.values()][0];
    const empty = c.change({ html: '<p>no embeds</p>' });
    assert.notEqual(empty.key, old.key);
    assert.equal(timers.size, 0);
    assert.equal(listeners.size, 0);
    oldTimer();
    old.props.onLoadEnd();
    message(old, 'session');
    assert.equal(requests.length, 1);
    c.change({ html: '<video src="/media/next"></video>' });
    message(c.web, 'session');
    assert.equal(requests.length, 2);
    requests[1].resolve({ session_url: 'https://signed.invalid/fresh' });
    await flush();
    requests[0].resolve({ session_url: 'https://signed.invalid/old' });
    await flush();
    assert.equal(sessionScripts().length, 1);
    assert.ok(sessionScripts()[0].includes('/fresh'));
    c.m.unmount();
  }

  // Committed/discarded presentation renders never reload, request, or publish labels.
  setup();
  {
    const c = component(),
      original = c.web;
    message(original, 'presentationReady');
    runtime.setAccountLocale('a', 'fr');
    const discarded = find(c.m.renderOnly(), 'WebView');
    assert.equal(discarded.props.source, original.props.source);
    message(discarded, 'presentationReady');
    assert.ok(injections.at(-1).includes('Open tool'));
    c.m.abandon();
    runtime.setAccountLocale('a', 'en');
    c.render();
    runtime.setAccountLocale('a', 'ar');
    const ar = c.render();
    assert.equal(ar.key, original.key);
    assert.equal(ar.props.source, original.props.source);
    assert.ok(injections.at(-1).includes(load('@/i18n/ar').ar['content.openTool']));
    assert.equal(requests.length, 0);
    // Abandoned source context is not committed and cannot retire current pending work.
    message(ar, 'session');
    const before = env;
    env = { ...env, client: client() };
    c.m.renderOnly();
    c.m.abandon();
    env = before;
    requests[0].resolve({ session_url: 'https://signed.invalid/kept' });
    await flush();
    assert.equal(sessionScripts().length, 1);
    // Non-session messages and local navigation keep their existing paths.
    ar.props.onMessage({ nativeEvent: { data: '{"type":"height","value":123.2}' } });
    assert.equal(find(c.m.render(), 'View').props.style.height, 124);
    ar.props.onLoadEnd();
    assert.equal(
      ar.props.onShouldStartLoadWithRequest({
        url: env.account.baseUrl + '/courses/1/pages/raw',
        isTopFrame: true,
      }),
      false,
    );
    assert.equal(links.length, 1);
    ar.props.onMessage({
      nativeEvent: { data: '{"type":"launch","url":"/courses/1/external_tools/7","title":"Raw"}' },
    });
    await flush();
    assert.equal(launches.length, 1);
    assert.equal(launches[0][0].title, 'Raw');
    c.m.unmount();
  }

  // Unchanged generated session glue executed in a synthetic DOM: load/timeout
  // activates exactly once, refresh never activates, deferred SOURCE calls load().
  for (const finish of ['load', 'timeout', 'null', 'refresh']) {
    const html = buildDocument(initialHtml, colors, false, 1, 'body', 'https://canvas.invalid');
    const script = html.slice(
      html.indexOf('      // Canvas-hosted embeds'),
      html.indexOf('      function postHeight()'),
    );
    const frames = [],
      jobs = [],
      posts = [];
    let mediaLoads = 0,
      heights = 0;
    const attrs = { 'data-easel-src': '/raw-media' };
    const media = {
      tagName: 'SOURCE',
      parentElement: { load: () => mediaLoads++ },
      getAttribute: (k) => attrs[k],
      removeAttribute: (k) => delete attrs[k],
      setAttribute: (k, v) => {
        attrs[k] = v;
      },
    };
    const window = {
      ReactNativeWebView: { postMessage: (s) => posts.push(JSON.parse(s)) },
      easelPostHeight: () => heights++,
    };
    const document = {
      querySelectorAll: () => [media],
      body: { appendChild: (f) => frames.push(f) },
      createElement: () => ({
        style: {},
        attrs: {},
        setAttribute(k, v) {
          this.attrs[k] = v;
        },
        addEventListener(_type, fn) {
          this.finish = fn;
        },
        remove() {
          this.removed = true;
        },
      }),
    };
    vm.runInNewContext(script, { window, document, setTimeout: (fn, ms) => jobs.push({ fn, ms }) });
    assert.deepEqual(posts, [{ type: 'session' }]);
    if (finish === 'null') window.easelSession(null);
    else {
      window[finish === 'refresh' ? 'easelRefreshSession' : 'easelSession']('https://signed.invalid/once');
      assert.equal(frames.length, 1);
      assert.equal(frames[0].src, 'https://signed.invalid/once');
      assert.equal(frames[0].attrs['aria-hidden'], 'true');
      assert.equal(frames[0].attrs.tabindex, '-1');
      assert.equal(mediaLoads, 0);
      if (finish === 'timeout') jobs.find((j) => j.ms === 6000).fn();
      else frames[0].finish();
      frames[0].finish();
      jobs.find((j) => j.ms === 6000).fn();
      jobs.find((j) => j.ms === 1000).fn();
      assert.equal(frames[0].removed, true);
    }
    assert.equal(mediaLoads, finish === 'refresh' ? 0 : 1);
    assert.equal(heights, finish === 'refresh' ? 0 : 1);
    assert.equal(attrs.src, finish === 'refresh' ? undefined : '/raw-media');
  }
  console.log(
    'content-session: committed component/helper races, real session adapters, synthetic session DOM, 2330 preserved catalog values passed',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
