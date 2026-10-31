/* global __dirname */
// Production web components, lifetime, parser/scripts and sessionUrl. Synthetic
// commit/discard hooks + native/transport edges, not native acceptance or Compiler.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const h = require('./submission-form.check.cjs');
const {
  load,
  mocks,
  allowed,
  native,
  elements,
  boundary,
  calls,
  allow,
  all,
  deferred,
  flush,
  equal,
  setEnvironment,
} = h;
const baseline = require('./web-controls.baseline.json');
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
Object.assign(mocks.react, react);
function mount(fn) {
  const s = { cursor: 0, slots: [], layouts: [], effects: [], mounted: true, dirty: false };
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
let backHandler, prevent, sheet;
Object.assign(native, elements('Modal Pressable View'), {
  Platform: { OS: 'ios' },
  Linking: { openURL: boundary('link') },
  BackHandler: {
    addEventListener: (_, fn) => {
      backHandler = fn;
      return { remove() {} };
    },
  },
});
mocks['lucide-react-native'] = elements('CloudOff Globe RotateCw Ellipsis');
Object.assign(mocks['@/design'], elements('ProgressBar EmptyState IconButton Text'), {
  useTheme: () => ({ colors: { bg: 'bg', accentFg: 'accent' } }),
});
mocks['react-native-webview'] = { WebView: 'WebView' };
mocks['react-native-safe-area-context'] = { useSafeAreaInsets: () => ({ top: 10, bottom: 20 }) };
mocks['expo-web-browser'] = { openBrowserAsync: boundary('browser') };
mocks['expo-router/react-navigation'] = { useHeaderHeight: () => 20 };
mocks['expo-router'].Stack = { Screen: 'StackScreen' };
mocks['expo-router'].usePreventRemove = (enabled, fn) => {
  prevent = { enabled, fn };
};
mocks['@/features/files/ActionSheet'] = {
  useActionSheet: () => ({
    show: (s) => {
      sheet = s;
    },
    sheet: null,
  }),
};
mocks['@/features/lti/launch'] = {
  launchTarget: boundary('launch'),
  isNewQuizzes: (n) => n === 'New Quizzes',
};
mocks['@/features/lti/preferences'] = {
  useToolOpenMode: () => ({ mode: 'app', setMode: boundary('mode') }),
};
mocks['@/features/web/downloads'] = {
  canvasFileId: (url, base) => (url.startsWith(base + '/files/') ? 'file' : null),
  looksLikeDownload: (url) => url.endsWith('.pdf'),
  openDownload: boundary('download'),
};
mocks['@/features/content/links'] = {
  resolveCanvasLink: (url) => (url.endsWith('/courses/2') ? '/course/2' : null),
};
for (const key of [
  'features/web/AuthenticatedWebView',
  'features/web/PopupSheet',
  'features/web/WebScreen',
  'features/web/lifetime',
  'features/web/scripts',
  'features/web/session',
  'features/content/browser',
]) {
  allowed.add(key);
  delete mocks['@/' + key];
}
const { AuthenticatedWebView: Auth } = load('@/features/web/AuthenticatedWebView');
const { PopupSheet: Popup } = load('@/features/web/PopupSheet');
const { WebScreen: Screen } = load('@/features/web/WebScreen');
const scripts = load('@/features/web/scripts');
const sessions = load('@/features/web/session');
const runtime = load('@/i18n/runtime');
const one = (tree, type) => {
  const a = all(tree, type);
  assert.equal(a.length, 1, String(type));
  return a[0].props;
};
const ev = (x) => ({ nativeEvent: x });
const msg = (x) => ev({ data: JSON.stringify(x) });
const t = (key) => runtime.createTranslator(runtime.displayLocale())(key);
const locale = (l) => runtime.setAccountLocale('test', l);
const client = () => ({ baseUrl: 'https://canvas.test', get: boundary('get') });
const setup = () => {
  locale('en');
  const c = client();
  setEnvironment({ client: c, account: { id: 'a', baseUrl: c.baseUrl }, online: true });
  return c;
};
const attach = (p) => {
  p.ref.current = {
    reload: boundary('reload'),
    goBack: boundary('back'),
    goForward: boundary('forward'),
    injectJavaScript: boundary('inject'),
  };
};
async function ready(m) {
  m.render();
  await flush();
  return m.render();
}
function staleEvents(w) {
  w.onLoadStart();
  w.onLoadProgress(ev({ progress: 0.9 }));
  w.onLoadEnd();
  w.onNavigationStateChange({
    url: 'https://stale.test',
    title: 'stale',
    canGoBack: true,
    loading: false,
  });
  w.onError(ev({ code: 500, description: 'network' }));
  w.onOpenWindow(ev({ targetUrl: 'https://stale.test' }));
  w.onFileDownload(ev({ downloadUrl: 'https://stale.test' }));
  w.onMessage(msg({ type: 'easel-download', url: 'https://stale.test' }));
  w.onContentProcessDidTerminate();
  w.onRenderProcessGone();
  assert.equal(w.onShouldStartLoadWithRequest({ url: 'mailto:stale@test' }), false);
}
async function runAuth(os) {
  native.Platform.OS = os;
  setup();
  let reports = [],
    exits = 0,
    browsers = 0;
  let props = {
    url: 'https://canvas.test/page?raw=%2f#ع',
    title: 'Raw عربية',
    courseId: 'c',
    ref: { current: null },
    onStateChange: (s) => reports.push(s),
    onExit: () => exits++,
    onOpenInBrowser: () => browsers++,
  };
  allow('get', (p, q) => {
    equal([p, q], ['/api/v1/login/session_token', { return_to: new URL(props.url).toString() }]);
    return Promise.resolve({ session_url: 'https://canvas.test/signed?token=%2f' });
  });
  const m = mount(() => Auth(props));
  let tree = await ready(m),
    w = one(tree, 'WebView');
  attach(w);
  assert.ok(sessions.sessionIsFresh('a'));
  assert.equal(w.source.uri, 'https://canvas.test/signed?token=%2f');
  assert.equal(
    w.injectedJavaScriptBeforeContentLoaded,
    os === 'android' ? `${scripts.pageShim}\n${scripts.androidDownloadShim}\n` : scripts.pageShim,
  );
  equal(w.originWhitelist, ['http://*', 'https://*', 'about:*', 'blob:*', 'data:*']);
  assert.equal(w.mediaCapturePermissionGrantType, 'grantIfSameHostElsePrompt');
  assert.equal(w.source.headers, undefined);
  const source = w.source;
  w.onLoadProgress(ev({ progress: 0.4 }));
  w.onNavigationStateChange({
    url: 'https://canvas.test/page',
    title: '',
    canGoBack: true,
    loading: true,
  });
  w.onOpenWindow(ev({ targetUrl: 'https://tool.test/popup' }));
  // A popup update must not discard an unrelated message from the live page
  // while React has not yet committed the updated popup props.
  allow('download');
  w.onMessage(msg({ type: 'easel-download', url: 'https://raw.test/during-popup' }));
  equal(calls.at(-1).slice(0, 2), ['download', 'https://raw.test/during-popup']);
  tree = m.render();
  const popup = one(tree, Popup).popup;
  for (const l of ['fr', 'ar', 'en']) {
    locale(l);
    props = { ...props, onStateChange: (s) => reports.push(s) };
    tree = m.render();
    assert.strictEqual(one(tree, 'WebView').source, source);
    assert.strictEqual(one(tree, Popup).popup, popup);
    assert.equal(
      one(tree, 'ProgressBar').accessibilityLabel,
      runtime.createTranslator(l)('web.loadingTitle', { title: props.title }),
    );
    assert.equal(one(tree, 'ProgressBar').value, 0.4);
    assert.equal(one(tree, 'WebView').downloadingMessage, t('web.downloading'));
  }
  w = one(tree, 'WebView');
  attach(w);
  w.onLoadEnd();
  tree = m.render();
  assert.equal(reports.at(-1).title, '');
  assert.equal(w.onShouldStartLoadWithRequest({ url: 'blob:raw' }), true);
  assert.equal(
    w.onShouldStartLoadWithRequest({
      url: 'https://canvas.test/quizzes/1/take',
      isTopFrame: true,
      navigationType: 'click',
    }),
    true,
  );
  allow('link', Promise.resolve());
  assert.equal(w.onShouldStartLoadWithRequest({ url: 'mailto:raw@example.test' }), false);
  allow('download');
  w.onFileDownload(ev({ downloadUrl: 'https://raw.test/a?sig=%2F' }));
  allow('download');
  w.onMessage(msg({ type: 'easel-download', url: 'https://raw.test/a', name: 'ملف' }));
  equal(calls.at(-1).slice(1), [
    'https://raw.test/a',
    'https://canvas.test',
    { courseId: 'c', name: 'ملف' },
  ]);
  for (const e of [
    { code: -999 },
    { domain: 'WebKitErrorDomain', code: 102 },
    { domain: 'WebKitErrorDomain', code: 204 },
    ...(os === 'android' ? [{ code: -3 }] : []),
  ])
    w.onError(ev({ ...e, description: 'network' }));
  assert.equal(all(m.render(), 'EmptyState').length, 0);
  // Successful reload stays in the same native view with the same source object.
  if (os === 'android') {
    setEnvironment({ online: false });
    tree = m.render();
    const hardware = backHandler;
    assert.equal(hardware(), true);
    tree = m.render();
    allow('back');
    assert.equal(backHandler(), true);
    setEnvironment({ online: true });
    tree = m.render();
    w = one(tree, 'WebView');
  }
  const old = w,
    oldHandle = props.ref.current;
  allow('reload');
  oldHandle.reload();
  oldHandle.reload();
  tree = m.render();
  w = one(tree, 'WebView');
  assert.strictEqual(w.source, source);
  staleEvents(old);
  oldHandle.goBack();
  w.onLoadEnd();
  tree = m.render();
  w = one(tree, 'WebView');
  attach(w);
  allow('reload');
  props.ref.current.reload();
  tree = m.render();
  w = one(tree, 'WebView');
  w.onError(ev({ code: 500, description: 'NETWORK raw native' }));
  w.onLoadEnd();
  for (const l of ['en', 'fr', 'ar']) {
    locale(l);
    const empty = one(m.render(), 'EmptyState');
    assert.equal(empty.title, t('web.failed'));
    assert.equal(
      empty.description,
      runtime.createTranslator(l)('web.failureBrowserHelp', { reason: t('web.connection') }),
    );
  }
  const retry = one(m.render(), 'EmptyState').action.onPress;
  allow('get', Promise.reject(new Error('school blocks sessions')));
  retry();
  retry();
  await flush();
  tree = m.render();
  assert.equal(one(tree, 'WebView').source.uri, 'https://canvas.test/page');
  staleEvents(w);
  retry();
  const before = calls.length;
  const oldBack = backHandler;
  m.unmount();
  if (os === 'android') assert.equal(oldBack(), false);
  staleEvents(one(tree, 'WebView'));
  props.ref.current?.reload();
  assert.equal(calls.length, before);
  assert.equal(exits, 0);
  assert.equal(browsers, 0);
}
async function races() {
  for (const change of ['account', 'client', 'url', 'course', 'resource']) {
    const a = setup();
    const d = deferred();
    allow('get', d.promise);
    let props = { url: 'https://canvas.test/a', courseId: 'c', ref: { current: null } };
    const m = mount(() => Auth(props));
    await ready(m);
    const old = props.ref.current;
    if (change === 'account') setEnvironment({ account: { id: 'b', baseUrl: a.baseUrl } });
    if (change === 'client') setEnvironment({ client: client() });
    if (change === 'url') props = { ...props, url: 'https://canvas.test/b' };
    if (change === 'course') props = { ...props, courseId: 'd' };
    if (change === 'resource') props = { ...props, resourceIdentity: {} };
    allow('get', Promise.resolve({ session_url: 'https://canvas.test/new' }));
    assert.equal(all(m.render(), 'WebView').length, 0);
    await flush();
    let tree = m.render();
    assert.equal(one(tree, 'WebView').source.uri, 'https://canvas.test/new');
    d.resolve({ session_url: 'https://canvas.test/old' });
    await flush();
    tree = m.render();
    assert.equal(one(tree, 'WebView').source.uri, 'https://canvas.test/new');
    old.reload();
    old.goBack();
    if (change === 'account') assert.equal(sessions.sessionIsFresh('a'), false);
    m.unmount();
  }
  setup();
  let pending = deferred(),
    launches = 0;
  let props = {
    url: 'https://signed.test/once?raw=%2f',
    signed: true,
    ref: { current: null },
    relaunch: () => {
      launches++;
      return pending.promise;
    },
  };
  const m = mount(() => Auth(props));
  let tree = await ready(m);
  assert.equal(one(tree, 'WebView').source.uri, props.url);
  assert.equal(launches, 0);
  one(tree, 'WebView').onLoadEnd();
  tree = m.render();
  const retry = props.ref.current.reload;
  retry();
  retry();
  assert.equal(launches, 1);
  pending.reject(new Error('RAW serveur العربية'));
  await flush();
  tree = m.render();
  assert.ok(one(tree, 'EmptyState').description.startsWith('RAW serveur العربية'));
  locale('fr');
  assert.ok(one(m.render(), 'EmptyState').description.startsWith('RAW serveur العربية'));
  pending = deferred();
  props.ref.current.reload();
  await flush();
  setEnvironment({ client: client(), account: { id: 'other', baseUrl: 'https://canvas.test' } });
  const replacement = deferred();
  props = { ...props, relaunch: () => replacement.promise };
  tree = m.render();
  await flush();
  pending.reject(new Error('obsolete'));
  await flush();
  assert.equal(all(m.render(), 'EmptyState').length, 0);
  replacement.resolve('https://signed.test/new');
  await flush();
  tree = m.render();
  assert.equal(one(tree, 'WebView').source.uri, 'https://signed.test/new');
  m.unmount();
  // Signed URL without a producer is first-use only across a mounted identity change.
  setup();
  const n = mount(() => Auth({ url: 'https://signed.test/old', signed: true }));
  await ready(n);
  setEnvironment({ client: client() });
  await ready(n);
  assert.equal(all(n.render(), 'WebView').length, 0);
  assert.equal(one(n.render(), 'EmptyState').title, t('web.failed'));
  n.unmount();
  setup();
  setEnvironment({ online: false });
  const o = mount(() => Auth({ url: 'https://external.test/raw?sig=%2f', title: '' }));
  assert.equal(one(o.render(), 'EmptyState').title, t('web.offline'));
  locale('ar');
  assert.equal(one(o.render(), 'EmptyState').title, t('web.offline'));
  setEnvironment({ online: true });
  const ot = await ready(o);
  assert.equal(one(ot, 'WebView').source.uri, 'https://external.test/raw?sig=%2f');
  assert.equal(one(ot, 'ProgressBar').accessibilityLabel, t('web.loading'));
  o.unmount();
  // A discarded account render must neither consume the initial URL nor revoke work.
  const c = setup();
  const d = deferred();
  allow('get', d.promise);
  const q = mount(() => Auth({ url: 'https://canvas.test/page' }));
  await ready(q);
  setEnvironment({ client: client() });
  q.renderOnly();
  q.abandon();
  setEnvironment({ client: c });
  d.resolve({ session_url: 'https://canvas.test/committed' });
  await flush();
  assert.equal(one(q.render(), 'WebView').source.uri, 'https://canvas.test/committed');
  q.unmount();
}
async function popups(os) {
  native.Platform.OS = os;
  setup();
  const ref = { current: null };
  let closed = 0,
    navigations = [],
    messages = [];
  let props = {
    popup: { id: 'p', url: 'about:blank' },
    ref,
    onClose: () => closed++,
    onNavigate: (u) => navigations.push(u),
    onOpenerMessage: (...v) => messages.push(v),
  };
  const m = mount(() => Popup(props));
  let tree = m.render(),
    w = one(tree, 'WebView');
  attach(w);
  assert.equal(h.textOf(tree).includes(t('web.window')), true);
  w.onNavigationStateChange({ url: 'https://tool.test/path', title: 'RAW عنوان' });
  w.onLoadProgress(ev({ progress: 0.7 }));
  tree = m.render();
  const source = w.source,
    handle = ref.current;
  for (const l of ['en', 'fr', 'ar']) {
    locale(l);
    tree = m.render();
    assert.strictEqual(one(tree, 'WebView').source, source);
    assert.equal(one(tree, 'Pressable').accessibilityLabel, t('web.closeWindow'));
    assert.equal(one(tree, 'ProgressBar').value, 0.7);
    assert.ok(h.textOf(tree).includes('RAW عنوان'));
  }
  const old = one(tree, 'WebView'),
    close = one(tree, 'Modal').onRequestClose;
  props = { ...props, popup: { ...props.popup } };
  tree = m.render();
  w = one(tree, 'WebView');
  attach(w);
  assert.notStrictEqual(w.source, source);
  assert.equal(one(tree, 'ProgressBar').value, 0.08);
  assert.ok(!h.textOf(tree).includes('RAW عنوان'));
  handle.inject('OLD');
  handle.navigate('https://old');
  close();
  old.onMessage(msg({ type: 'easel-popup-self-close' }));
  old.onNavigationStateChange({ url: 'https://old', title: 'old' });
  old.onOpenWindow(ev({ targetUrl: 'https://old' }));
  old.onLoadProgress(ev({ progress: 1 }));
  assert.equal(closed, 0);
  equal(navigations, ['https://tool.test/path']);
  allow('inject');
  ref.current.navigate('https://raw.test/"?x=%2f');
  assert.equal(calls.at(-1)[1], 'location.href = "https://raw.test/\\\"?x=%2f"; true;');
  allow('inject');
  ref.current.inject(scripts.deliverToPopup({ json: '{"raw":1}' }, 'https://origin.test'));
  w.onMessage(
    msg({ type: 'easel-opener-post', data: { json: '{"raw":1}' }, origin: 'https://origin.test' }),
  );
  equal(messages, [[{ json: '{"raw":1}' }, 'https://origin.test']]);
  allow('link', Promise.resolve());
  assert.equal(w.onShouldStartLoadWithRequest({ url: 'tel:123' }), false);
  const oldHandle = ref.current;
  props = { ...props, popup: null };
  tree = m.render();
  oldHandle.inject('OLD');
  assert.equal(all(tree, 'WebView').length, 0);
  props = { ...props, popup: { id: 'p', url: 'about:blank' } };
  tree = m.render();
  m.replayEffects();
  tree = m.render();
  w = one(tree, 'WebView');
  attach(w);
  allow('inject');
  ref.current.inject('LIVE');
  m.unmount();
  w.onMessage(msg({ type: 'easel-popup-self-close' }));
  assert.equal(closed, 0);
}
async function screens(os) {
  native.Platform.OS = os;
  setup();
  let props = {
    url: 'https://canvas.test/page',
    title: '',
    guard: 'Raw guard? Raw message.',
    tool: { id: 't', name: '' },
    launch: { toolId: 't', fallbackUrl: 'https://canvas.test/fallback' },
  };
  const m = mount(() => Screen(props));
  let tree = m.render();
  const child = one(tree, Auth);
  const fake = {
    currentUrl: () => props.url,
    reload: boundary('headerReload'),
    goBack: boundary('headerBack'),
  };
  child.ref.current = fake;
  child.onStateChange({ url: props.url, title: 'Raw page', canGoBack: true, loading: false });
  tree = m.render();
  const options = () => one(tree, mocks['expo-router'].Stack.Screen).options;
  const menu = () =>
    os === 'ios'
      ? options().unstable_headerRightItems()[1].menu.items
      : (one(options().headerRight(), 'View').children, null);
  assert.equal(options().title, 'Raw page');
  const browser = one(tree, Auth).onOpenInBrowser;
  const d = deferred();
  allow('get', d.promise);
  browser();
  browser();
  locale('ar');
  props = { ...props, launch: { ...props.launch } };
  tree = m.render();
  assert.strictEqual(one(tree, Auth).resourceIdentity, child.resourceIdentity);
  d.resolve({ session_url: 'https://canvas.test/browser-signed' });
  allow('browser', Promise.resolve());
  await flush();
  assert.equal(calls.at(-1)[1], 'https://canvas.test/browser-signed');
  await flush();
  let back, mode;
  if (os === 'ios') {
    const items = menu();
    back = items[0].onPress;
    mode = items[2].items[0].onPress;
    assert.equal(items[1].label, t('web.browser'));
  } else {
    const icons = all(options().headerRight(), 'IconButton');
    icons[1].props.onPress();
    const request = sheet;
    assert.equal(request.options[1].label, t('web.browser'));
    locale('fr');
    tree = m.render();
    assert.equal(request.presentation(runtime.createTranslator('fr')).options[1], t('web.browser'));
    assert.equal(
      request.presentation(runtime.createTranslator('fr')).options[2],
      runtime.createTranslator('fr')('web.alwaysBrowser', { name: '' }),
    );
    back = request.options[0].onPress;
    mode = request.options[2].onPress;
  }
  allow('mode');
  mode();
  mode();
  setEnvironment({ online: false });
  allow('headerBack');
  back();
  allow('alert');
  prevent.fn({ repeat: boundary('repeat') });
  const firstAlert = calls.at(-1);
  assert.equal(firstAlert[1], 'Raw guard?');
  assert.equal(firstAlert[2], 'Raw message.');
  const leave = firstAlert[3][1].onPress;
  allow('repeat');
  leave();
  leave();
  tree = m.render();
  assert.equal(prevent.enabled, false);
  const pending = deferred();
  allow('get', pending.promise);
  one(tree, Auth).onOpenInBrowser();
  assert.equal(calls.at(-1)[0], 'get');
  props = {
    ...props,
    tool: { id: 'replacement', name: 'Raw tool' },
    launch: { toolId: 'replacement' },
  };
  tree = m.render();
  assert.equal(options().title, 'Canvas');
  mode();
  back();
  leave();
  pending.resolve({ session_url: 'https://old.test' });
  await flush();
  const fresh = one(tree, Auth).onOpenInBrowser;
  const launch = deferred();
  allow('launch', launch.promise);
  fresh();
  setEnvironment({ client: client() });
  tree = m.render();
  launch.reject(new Error('late'));
  await flush();
  allow('alert');
  allow('launch', Promise.reject(new Error('new failure')));
  one(tree, Auth).onOpenInBrowser();
  await flush();
  assert.equal(calls.at(-1)[1], t('web.browserFailed'));
  m.unmount();
  fresh();
  mode();
}
async function screenPresentation(os) {
  native.Platform.OS = os;
  setup();
  let props = { url: 'https://canvas.test/page', guard: 'Raw guard? Raw message.' };
  let screen = mount(() => Screen(props));
  let tree = screen.render();
  one(tree, Auth).ref.current = { currentUrl: () => props.url };
  one(tree, Auth).onStateChange({
    url: props.url,
    title: 'Loading title',
    canGoBack: false,
    loading: true,
  });
  tree = screen.render();
  const session = deferred();
  const browsersBefore = calls.filter(([kind]) => kind === 'browser').length;
  allow('get', session.promise);
  const opening = one(tree, Auth).onOpenInBrowser();
  one(tree, Auth).onStateChange({
    url: props.url,
    title: 'Loaded title',
    canGoBack: false,
    loading: false,
  });
  tree = screen.render();
  allow('browser', Promise.resolve());
  session.resolve({ session_url: 'https://canvas.test/browser-signed' });
  await opening;
  assert.equal(
    calls.filter(([kind]) => kind === 'browser').length,
    browsersBefore + 1,
    'same-page title/loading updates must not cancel a pending browser action',
  );
  let repeated = 0;
  allow('alert');
  prevent.fn({ repeat: () => repeated++ });
  const leave = calls.at(-1)[3][1].onPress;
  one(tree, Auth).onStateChange({
    url: props.url,
    title: 'Updated title',
    canGoBack: true,
    loading: true,
  });
  tree = screen.render();
  leave();
  leave();
  assert.equal(repeated, 1, 'presentation updates must not discard a leave confirmation');
  screen.unmount();
  h.verifyBoundaries();

  // Navigating away and back still expires the original page's async action.
  setup();
  props = { url: 'https://canvas.test/page' };
  screen = mount(() => Screen(props));
  tree = screen.render();
  one(tree, Auth).ref.current = { currentUrl: () => props.url };
  const staleSession = deferred();
  allow('get', staleSession.promise);
  const staleOpening = one(tree, Auth).onOpenInBrowser();
  one(tree, Auth).onStateChange({
    url: 'https://canvas.test/different',
    title: '',
    canGoBack: true,
    loading: false,
  });
  tree = screen.render();
  one(tree, Auth).onStateChange({
    url: props.url,
    title: '',
    canGoBack: false,
    loading: false,
  });
  tree = screen.render();
  const beforeStaleResult = calls.length;
  staleSession.resolve({ session_url: 'https://canvas.test/obsolete' });
  await staleOpening;
  assert.equal(calls.length, beforeStaleResult, 'returning to a URL cannot revive its old action');
  screen.unmount();
  h.verifyBoundaries();

  setup();
  props = { url: 'https://tool.test/once', signed: true, guard: 'Raw guard? Raw message.' };
  screen = mount(() => Screen(props));
  tree = screen.render();
  const resource = one(tree, Auth).resourceIdentity;
  repeated = 0;
  allow('alert');
  prevent.fn({ repeat: () => repeated++ });
  const oldLeave = calls.at(-1)[3][1].onPress;
  props = { ...props, guard: 'Localized guard? Localized message.' };
  tree = screen.render();
  assert.strictEqual(
    one(tree, Auth).resourceIdentity,
    resource,
    'changing only warning text must not relaunch the embedded resource',
  );
  oldLeave();
  assert.equal(repeated, 0, 'an outdated warning cannot confirm the replacement warning');
  allow('alert');
  prevent.fn({ repeat: () => repeated++ });
  assert.equal(calls.at(-1)[1], 'Localized guard?');
  calls.at(-1)[3][1].onPress();
  assert.equal(repeated, 1);
  screen.unmount();
}
async function recovery() {
  setup();
  let retryCount = 0;
  let props = {
    url: 'https://tool.test/once',
    signed: true,
    ref: { current: null },
    relaunch: async () => {
      retryCount++;
      return 'https://tool.test/fresh';
    },
  };
  const m = mount(() => Auth(props));
  let tree = await ready(m);
  let w = one(tree, 'WebView');
  w.onError(ev({ code: 123, description: 'unclassified native raw' }));
  tree = m.render();
  assert.equal(
    one(tree, 'EmptyState').description,
    runtime.createTranslator('en')('web.failureHelp', { reason: t('web.page') }),
  );
  setEnvironment({ online: false });
  m.render();
  setEnvironment({ online: true });
  tree = await ready(m);
  assert.equal(retryCount, 1);
  assert.equal(one(tree, 'WebView').source.uri, 'https://tool.test/fresh');
  const previous = one(tree, 'WebView');
  attach(previous);
  allow('reload');
  previous.onContentProcessDidTerminate();
  tree = m.render();
  staleEvents(previous);
  w = one(tree, 'WebView');
  w.onRenderProcessGone();
  w.onRenderProcessGone();
  await flush();
  tree = m.render();
  assert.equal(retryCount, 2);
  // Committed callbacks update without sessions; a discarded callback never becomes live.
  let exited = 0;
  props = { ...props, onExit: () => exited++ };
  tree = m.render();
  props = {
    ...props,
    onExit: () => {
      throw Error('discarded callback');
    },
  };
  m.renderOnly();
  m.abandon();
  one(tree, 'WebView').onMessage(msg({ type: 'easel-tool-revisited' }));
  assert.equal(exited, 1);
  props = { ...props, onExit: () => exited++ };
  m.render();
  // Cleanup/replay invalidates the first request and starts one fresh relaunch.
  m.replayEffects();
  await flush();
  tree = m.render();
  assert.equal(retryCount, 3);
  m.unmount();

  // A new resource on the same account cannot reuse the same spent signed URL.
  setup();
  let resource = {},
    count = 0;
  const r = mount(() =>
    Auth({
      url: 'https://signed.test/once',
      signed: true,
      resourceIdentity: resource,
      relaunch: async () => {
        count++;
        return 'https://signed.test/replacement';
      },
    }),
  );
  await ready(r);
  resource = {};
  const replaced = await ready(r);
  assert.equal(count, 1);
  assert.equal(one(replaced, 'WebView').source.uri, 'https://signed.test/replacement');
  r.unmount();

  // Unsigned browser fallback uses actual sessionUrl and cannot open after replacement.
  setup();
  let screenProps = { url: 'https://canvas.test/raw?x=%2f' };
  const screen = mount(() => Screen(screenProps));
  tree = screen.render();
  const d = deferred();
  allow('get', d.promise);
  one(tree, Auth).onOpenInBrowser();
  screenProps = { ...screenProps, courseId: 'new-course' };
  screen.render();
  d.resolve({ session_url: 'https://stale.test' });
  await flush();
  screen.unmount();
  setup();
  const external = mount(() => Screen({ url: 'https://external.test/raw?x=%2f' }));
  tree = external.render();
  allow('browser', Promise.resolve());
  one(tree, Auth).onOpenInBrowser();
  await flush();
  assert.equal(calls.at(-1)[1], 'https://external.test/raw?x=%2f');
  external.unmount();
}
// Root integration adds only an optional launch guard; preserve the old whole-file
// freeze after reversing these exact additions. Session URL/wire code stays frozen.
function frozenSource(file) {
  let source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  source = source.replace("import { Alert } from 'react-native';\nimport { t as translate } from '@/i18n';\n", '')
    .replace(/  if \(client.baseUrl === 'https:\/\/demo\.easel\.invalid'\) \{[^\n]+\n/g, '')
    .replace("import { t } from '@/i18n';\nimport { Alert, Linking }", "import { Linking }")
    .replace(/  if \(baseUrl === 'https:\/\/demo\.easel\.invalid'\) \{[^\n]+\n/g, '');
  if (file === 'features/content/links.ts') {
    // Previously reviewed Help integration forwards the existing native promise.
    const added = '  return WebBrowser.openBrowserAsync(absolute).catch(() => {});';
    assert.equal(source.split(added).length, 2, 'exact Help promise-forwarding delta');
    return source.replace(added, '  WebBrowser.openBrowserAsync(absolute).catch(() => {});');
  }
  if (file !== 'features/content/browser.ts') return source;
  const deltas = [
    [
      '/** "Open in browser" that arrives signed in (PRD LTI-3).\n * An optional caller guard retires launch entry, not a browser already opened. */',
      '/** "Open in browser" that arrives signed in (PRD LTI-3). */',
    ],
    [
      `export async function openSignedIn(client: CanvasClient, url: string, mayOpen?: () => boolean) {
  if (mayOpen && !mayOpen()) return;
  const target = await sessionUrl(client, url);
  if (mayOpen && !mayOpen()) return;
  await WebBrowser.openBrowserAsync(target);
}`,
      `export async function openSignedIn(client: CanvasClient, url: string) {
  await WebBrowser.openBrowserAsync(await sessionUrl(client, url));
}`,
    ],
    [
      'return (url: string, mayOpen?: () => boolean) => openSignedIn(client, url, mayOpen);',
      'return (url: string) => openSignedIn(client, url);',
    ],
  ];
  for (const [added, original] of deltas) {
    assert.equal(source.split(added).length, 2, 'exact optional browser guard delta');
    source = source.replace(added, original);
  }
  return source;
}
async function run() {
  for (const l of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + l)[l];
    assert.equal(Object.keys(baseline.catalogs[l]).length, 1991);
    for (const [k, v] of Object.entries(baseline.catalogs[l])) equal(catalog[k], v);
    assert.ok(Object.keys(catalog).length >= 2019);
    assert.equal(Object.keys(catalog).filter((key) => key.startsWith('web.')).length, 28);
  }
  for (const [file, hash] of Object.entries(baseline.frozen))
    assert.equal(
      crypto
        .createHash('sha256')
        .update(frozenSource(file))
        .digest('hex'),
      hash,
    );
  for (const os of ['ios', 'android']) {
    await runAuth(os);
    h.verifyBoundaries();
    await popups(os);
    h.verifyBoundaries();
    await screens(os);
    h.verifyBoundaries();
    await screenPresentation(os);
    h.verifyBoundaries();
  }
  await races();
  await recovery();
  h.verifyBoundaries();
  console.log(
    'web-controls: production components/parser/sessionUrl, committed races, locale/source/popup purity, frozen catalogs/protocol passed (' +
      process.env.TZ +
      ')',
  );
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
