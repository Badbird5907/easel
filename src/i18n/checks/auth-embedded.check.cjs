const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
// Executes production EmbeddedSignIn/lifetime/i18n with synthetic hooks, native
// WebView, Alert and timers. No network, storage or native effects. Not React reconciliation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
    get dirty() {
      return s.dirty;
    },
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

const root = path.resolve(__dirname, '../..');
const cache = new Map();
const allowed = new Set(['i18n', 'i18n/runtime', 'i18n/en', 'i18n/fr', 'i18n/ar',
  'features/auth/EmbeddedSignIn', 'features/auth/authEmbeddedLifetime', 'features/auth/oauth']);
const elements = names => Object.fromEntries(names.split(' ').map(n => [n, n]));
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
let openApp = async () => {};
const prompts = [], timers = [], calls = [];
const native = { goBack: () => calls.push('back'), reload: () => calls.push('reload') };
const forbidden = () => { throw new Error('Forbidden external effect'); };
const mocks = {
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': { ...elements('View Modal Pressable'), Platform: { OS: 'ios' }, Linking: { openURL: url => openApp(url), canOpenURL: forbidden }, Alert: { prompt: (...args) => prompts.push(args) } },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 17, bottom: 9 }) },
  'react-native-webview': { WebView: 'WebView' },
  'lucide-react-native': elements('ArrowLeft ChevronLeft Lock RotateCw X'),
  '@/design': { ...elements('Button Callout Icon IconButton ProgressBar Text TextField'), useTheme: () => ({ colors: { bg: 'synthetic-bg' } }) },
  // Load the real OAuth module for its callback predicate, never call its effects.
  'expo-crypto': { getRandomBytes: forbidden, digestStringAsync: forbidden },
  'expo-device': {}, 'expo-web-browser': { openAuthSessionAsync: forbidden, dismissAuthSession: forbidden },
  '@/canvas/client': {}, '@/canvas/session': { OAUTH_REDIRECT_URI: 'easel://oauth/callback', SignInError: Error },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  if (isIntlPolyfills(name)) return intlPolyfills;
  const key = name.startsWith('.') ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name)) : name;
  if (mocks[key]) return mocks[key];
  assert.ok(key.startsWith('@/') && allowed.has(key.slice(2)), 'Unexpected import ' + key);
  const file = ['.ts', '.tsx', '/index.ts'].map(e => path.join(root, key.slice(2)) + e).find(fs.existsSync);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  new vm.Script(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, { filename: file }).runInNewContext({
    module, exports: module.exports, require: n => load(n, file), Intl, Date, Error, URL,
    setTimeout(fn, delay) { assert.equal(delay, 0); const timer = { fn, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.cleared = true; },
  });
  return module.exports;
}
allowed.add('features/auth/duoLink');
const runtime = load('@/i18n/runtime');
const { EmbeddedSignIn } = load('@/features/auth/EmbeddedSignIn');
const locale = lang => { runtime.setAccountLocale('synthetic-viewer', lang); return runtime.createTranslator(lang); };
const walk = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(walk) : [tree, ...walk(tree.props?.children)];
const nodes = (tree, type) => walk(tree).filter(n => n.type === type);
const one = (tree, type, predicate = () => true) => { const n = nodes(tree, type).find(n => predicate(n.props)); assert.ok(n, 'Missing ' + type); return n.props; };
const child = tree => walk(tree).find(n => typeof n.type === 'function');
const equal = (a, b, message = 'raw protocol equality') => assert.ok(JSON.stringify(a) === JSON.stringify(b), message);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
for (const lang of ['en', 'fr', 'ar']) {
  const catalog = load('@/i18n/' + lang)[lang];
  for (const [key, digest] of Object.entries(require('./auth-embedded.baseline.json').catalogs[lang]))
    assert.equal(hash(JSON.stringify(catalog[key])), digest, lang + ':' + key);
  const keys = Object.keys(catalog).filter(k => k.startsWith('authEmbedded.'));
  assert.ok(keys.length >= 17);
  for (const key of keys) assert.ok(typeof catalog[key] === 'string');
}
// Runtime-only arbitrary input: never serialize credentials or print assertion values.
const input = () => ' ' + crypto.randomBytes(15).toString('hex') + ' العربية é ';
const request = (siteAdmin = false) => ({
  url: 'https://campus.invalid/login/oauth2/auth?authentication_provider=raw%20value',
  host: { host: 'campus.invalid', baseUrl: 'https://campus.invalid' }, state: 'same-state', verifier: input(), key: {}, embedded: true, siteAdmin
});
const http = (web, url = 'https://identity.invalid/challenge', statusCode = 401) => web.onHttpError({ nativeEvent: { url, statusCode } });
const deliverTimers = () => { for (const timer of timers.splice(0)) timer.fn(); }; // Also deliver cancelled timers deliberately.
function fixture(os = 'ios', siteAdmin = false) {
  locale('en'); mocks['react-native'].Platform.OS = os; calls.length = 0; prompts.length = 0; timers.length = 0;
  const completions = [];
  let props = { request: request(siteAdmin), onFinish: url => completions.push(url) };
  const parent = mount(() => EmbeddedSignIn(props));
  let webMount, webNode, formMount, formNode, modal, tree, form;
  function render() {
    modal = parent.render();
    const next = child(modal);
    if (webNode?.key !== next?.key || !next) { formMount?.unmount(); formMount = undefined; formNode = undefined; webMount?.unmount(); webMount = undefined; }
    webNode = next;
    if (!next) { tree = form = undefined; return; }
    webMount ??= mount(() => webNode.type(webNode.props));
    tree = webMount.render();
    one(tree, 'WebView').ref.current = native;
    const nextForm = child(tree);
    if (formNode?.key !== nextForm?.key || !nextForm) { formMount?.unmount(); formMount = undefined; }
    formNode = nextForm;
    if (nextForm) { formMount ??= mount(() => formNode.type(formNode.props)); form = formMount.render(); }
    else form = undefined;
  }
  render();
  return {
    render, parent, completions,
    get modal() { return modal.props; }, get tree() { return tree; }, get web() { return one(tree, 'WebView'); }, get form() { return form; },
    get webMount() { return webMount; }, get formMount() { return formMount; }, get request() { return props.request; },
    replace(value = request(siteAdmin)) { props = { ...props, request: value }; render(); },
    abandon(value) { const previous = props; props = { ...props, request: value }; const speculative = parent.renderOnly(); parent.abandon(); props = previous; return speculative; },
    unmount() { parent.unmount(); webMount?.unmount(); formMount?.unmount(); },
  };
}
function icon(f, key) { return one(f.tree, 'IconButton', p => p.accessibilityLabel === runtime.t('authEmbedded.' + key)); }
function field(f, key) { return one(f.form, 'TextField', p => p.label === runtime.t('authEmbedded.' + key)); }
function button(tree, key) { return one(tree, 'Button', p => p.children === runtime.t('authEmbedded.' + key)); }
function assertOptions(web, req) {
  equal(web.source, { uri: req.url, ...(req.siteAdmin && { headers: { cookie: 'canvas_sa_delegated=1' } }) });
  equal(web.originWhitelist, ['http://*', 'https://*', 'easel://*', 'duotrustedendpoints://*']);
  assert.equal(web.incognito, true); assert.equal(web.setSupportMultipleWindows, false);
  assert.equal(web.javaScriptCanOpenWindowsAutomatically, true);
  assert.equal(web.javaScriptEnabled, true); assert.equal(web.domStorageEnabled, true);
  assert.equal(web.applicationNameForUserAgent, 'Easel');
  const bridge = mocks['react-native'].Platform.OS === 'android' ? load('@/features/auth/duoLink').DUO_CLIPBOARD_BRIDGE : '';
  assert.equal(web.injectedJavaScriptBeforeContentLoaded, (req.siteAdmin ? "document.cookie = 'canvas_sa_delegated=1; path=/'; true;" : '') + bridge || undefined);
  assert.equal(web.injectedJavaScript, bridge || undefined);
}
for (const os of ['ios', 'android']) for (const admin of [false, true]) {
  const f = fixture(os, admin), original = f.web;
  assert.equal(f.modal.presentationStyle, os === 'ios' ? 'pageSheet' : 'fullScreen');
  assert.equal(f.modal.statusBarTranslucent, true); assert.equal(f.modal.navigationBarTranslucent, true);
  assert.equal(f.modal.animationType, 'slide');
  assertOptions(original, f.request);
  original.onLoadProgress({ nativeEvent: { progress: 0.61 } });
  original.onNavigationStateChange({ url: 'https://RAW.invalid/path?raw=%20', canGoBack: true });
  for (const lang of ['en', 'fr', 'ar', 'ar', 'en']) {
    const t = locale(lang); f.render();
    assert.equal(f.web.source, original.source); assert.equal(f.web.originWhitelist, original.originWhitelist);
    assertOptions(f.web, f.request);
    assert.equal(one(f.tree, 'ProgressBar').value, 0.61);
    assert.equal(one(f.tree, 'ProgressBar').accessibilityLabel, t('authEmbedded.loading'));
    assert.ok(nodes(f.tree, 'Text').some(n => n.props.children === 'raw.invalid'));
    assert.ok(nodes(f.tree, 'View').some(n => n.props.accessibilityLabel === t('authEmbedded.securePage', { host: 'raw.invalid' })));
  }
  icon(f, 'previous').onPress(); icon(f, 'reload').onPress(); equal(calls, ['back', 'reload']);
  f.web.onLoadEnd(); f.render(); assert.equal(nodes(f.tree, 'ProgressBar').length, 0);
  f.web.onLoadStart(); f.render(); assert.equal(nodes(f.tree, 'ProgressBar').length, 1);
  http(f.web, f.request.host.baseUrl + '/login/oauth2/auth'); f.render();
  assert.equal(prompts.length, 0); assert.equal(f.form, undefined);
  for (const lang of ['fr', 'ar']) {
    const t = locale(lang); f.render();
    assert.equal(one(f.tree, 'Callout').children, t('authEmbedded.developerKey', { host: f.request.host.host }));
  }
  button(f.tree, 'retry').onPress(); f.render(); assert.equal(nodes(f.tree, 'Callout').length, 0);
  f.web.onError({ nativeEvent: { url: 'easel://oauth/callback?raw', description: 'RAW' } }); f.render();
  assert.equal(nodes(f.tree, 'Callout').length, 0);
  f.web.onError({ nativeEvent: { url: 'https://identity.invalid', description: 'RAW' } }); f.render();
  assert.equal(one(f.tree, 'Callout').children, runtime.t('authEmbedded.loadError'));
  // Preserve existing Android error Cancel/back policy.
  const before = calls.length; button(f.tree, 'cancel').onPress();
  if (os === 'android') { assert.equal(calls[before], 'back'); assert.equal(f.completions.length, 0); }
  else equal(f.completions, [null]);
  f.unmount();
}
// Existing callback predicate/top-frame policy is deliberately unchanged.
for (const os of ['ios', 'android']) {
  const f = fixture(os);
  for (const url of ['https://identity.invalid', 'http://identity.invalid', 'easel://unrelated'])
    assert.equal(f.web.onShouldStartLoadWithRequest({ url, isTopFrame: false }), true);
  const url = 'easel://oauth/callback?code=opaque&state=opaque';
  assert.equal(f.web.onShouldStartLoadWithRequest({ url, isTopFrame: false }), false);
  f.web.onShouldStartLoadWithRequest({ url }); f.modal.onRequestClose();
  equal(f.completions, [url]); f.unmount();
}
// Android: locale retention, rapid edits, latest username, keyboard/tap coalescing.
{
  const f = fixture('android'); http(f.web); f.render();
  const source = f.web.source, formMount = f.formMount;
  const username = input(), password = input();
  field(f, 'username').onChangeText(username); field(f, 'password').onChangeText(password);
  for (const lang of ['fr', 'ar', 'ar', 'en']) {
    locale(lang); f.render(); assert.equal(f.formMount, formMount); assert.equal(f.web.source, source);
    equal(field(f, 'username').value, username); equal(field(f, 'password').value, password);
  }
  const oldSubmit = button(f.form, 'signIn').onPress, keyboard = field(f, 'password').onSubmitEditing;
  field(f, 'username').onChangeText(''); oldSubmit(); keyboard(); assert.equal(timers.length, 0);
  field(f, 'username').onChangeText(username); keyboard(); oldSubmit(); keyboard();
  assert.equal(timers.length, 0); f.render(); assert.equal(timers.length, 1); equal(f.web.basicAuthCredential, { username, password });
  const cred = f.web.basicAuthCredential; locale('ar'); f.render(); assert.equal(f.web.basicAuthCredential, cred);
  deliverTimers(); equal(calls, ['reload']);
  http(f.web); f.render(); assert.ok(nodes(f.form, 'Text').some(n => n.props.children === runtime.t('authEmbedded.credentialsFailed')));
  equal(field(f, 'username').value, ''); equal(field(f, 'password').value, '');
  f.unmount();
}
// Cancelled/replaced challenges can never supply a newer challenge's credentials.
for (const os of ['ios', 'android']) {
  const f = fixture(os); http(f.web); f.render();
  let submit, cancel;
  const value = { username: input(), password: input() };
  if (os === 'ios') {
    submit = () => prompts[0][2][1].onPress({ login: value.username, password: value.password });
    cancel = prompts[0][2][0].onPress;
    assert.equal(prompts[0][3], 'login-password');
  } else {
    field(f, 'username').onChangeText(value.username); field(f, 'password').onChangeText(value.password);
    submit = button(f.form, 'signIn').onPress; cancel = button(f.form, 'cancel').onPress;
  }
  http(f.web); f.render(); if (os === 'ios') assert.equal(prompts.length, 1);
  cancel(); f.render(); http(f.web); f.render(); submit(); cancel(); f.render();
  assert.equal(f.web.basicAuthCredential, undefined); assert.equal(timers.length, 0);
  // A different challenge URL at the same host invalidates the previous prompt.
  const previous = os === 'ios' ? prompts.at(-1)[2][1].onPress : button(f.form, 'signIn').onPress;
  http(f.web, 'https://identity.invalid/new-challenge'); f.render(); previous({ login: value.username, password: value.password });
  assert.equal(timers.length, 0); f.unmount();
}
// Native prompts relabel on the next opening, never reopen/reset on locale alone.
{
  const f = fixture('ios'); locale('fr'); f.render(); http(f.web); f.render();
  assert.equal(prompts[0][0], runtime.t('authEmbedded.signInTo', { host: 'identity.invalid' }));
  assert.equal(prompts[0][1], runtime.t('authEmbedded.credentialsNeeded'));
  assert.equal(prompts[0][2][0].text, runtime.t('authEmbedded.cancel'));
  assert.equal(prompts[0][2][1].text, runtime.t('authEmbedded.signIn'));
  locale('ar'); f.render(); assert.equal(prompts.length, 1);
  const value = { login: input(), password: input() }, submit = prompts[0][2][1].onPress;
  submit(undefined); submit(''); assert.equal(timers.length, 0);
  submit(value); submit(value); f.render(); assert.equal(timers.length, 1);
  equal(f.web.basicAuthCredential, { username: value.login, password: value.password });
  deliverTimers(); http(f.web); f.render();
  assert.equal(prompts.at(-1)[1], runtime.t('authEmbedded.credentialsFailed')); f.unmount();
}
// Every stale callback class is inert after exact-object replacement, hiding,
// explicit completion, cancellation or unmount, including retained Modal close.
for (const os of ['ios', 'android']) for (const mode of ['replace', 'hide', 'finish', 'cancel', 'unmount']) {
  const f = fixture(os); f.web.onNavigationStateChange({ url: f.request.url, canGoBack: true });
  f.web.onError({ nativeEvent: { url: f.request.url } }); f.render();
  const web = f.web, close = f.modal.onRequestClose, back = icon(f, 'previous').onPress, reload = icon(f, 'reload').onPress;
  const retry = button(f.tree, 'retry').onPress;
  http(web); f.render();
  let submit;
  if (os === 'ios') { const callback = prompts.at(-1)[2][1].onPress; submit = () => callback({ login: input(), password: input() }); }
  else { field(f, 'username').onChangeText(input()); field(f, 'password').onChangeText(input()); submit = button(f.form, 'signIn').onPress; }
  if (mode === 'replace') f.replace();
  if (mode === 'hide') f.replace(null);
  if (mode === 'finish') web.onShouldStartLoadWithRequest({ url: 'easel://oauth/callback?opaque' });
  if (mode === 'cancel') close();
  if (mode === 'unmount') f.unmount();
  const finished = f.completions.length, prompted = prompts.length, effects = calls.length;
  close(); back(); reload(); retry(); submit(); http(web);
  web.onLoadStart(); web.onLoadEnd(); web.onLoadProgress({ nativeEvent: { progress: 0.99 } });
  web.onNavigationStateChange({ url: 'https://stale.invalid', canGoBack: true }); web.onError({ nativeEvent: { url: 'https://stale.invalid' } });
  assert.equal(web.onShouldStartLoadWithRequest({ url: 'easel://oauth/callback?stale' }), false);
  deliverTimers(); assert.equal(f.completions.length, finished); assert.equal(prompts.length, prompted); assert.equal(calls.length, effects);
  if (mode === 'replace') { f.render(); assert.equal(f.web.basicAuthCredential, undefined); assert.equal(one(f.tree, 'ProgressBar').value, 0.1); f.modal.onRequestClose(); assert.equal(f.completions.length, finished + 1); }
  if (mode !== 'unmount') f.unmount();
}
// Deferred 0ms reload may be delivered even after clearTimeout; recheck ownership.
for (const os of ['ios', 'android']) for (const mode of ['replace', 'hide', 'cancel', 'unmount', 'challenge', 'replay']) {
  const f = fixture(os); http(f.web); f.render();
  if (os === 'ios') prompts.at(-1)[2][1].onPress({ login: input(), password: input() });
  else { field(f, 'username').onChangeText(input()); field(f, 'password').onChangeText(input()); button(f.form, 'signIn').onPress(); }
  assert.equal(timers.length, 0); f.render(); assert.equal(timers.length, 1);
  if (mode === 'replace') f.replace();
  if (mode === 'hide') f.replace(null);
  if (mode === 'cancel') f.modal.onRequestClose();
  if (mode === 'unmount') f.unmount();
  if (mode === 'challenge') http(f.web, 'https://new.invalid/challenge');
  if (mode === 'replay') f.parent.replayEffects();
  deliverTimers(); assert.equal(calls.length, 0);
  if (mode !== 'unmount') f.unmount();
}
// Child-only effect replay cannot duplicate the committed credential reload.
{
  const f = fixture('ios'); http(f.web);
  prompts[0][2][1].onPress({ login: input(), password: input() });
  assert.equal(timers.length, 0); f.render(); f.webMount.replayEffects();
  assert.equal(timers.length, 1); deliverTimers(); equal(calls, ['reload']); f.unmount();
}
// A response retired before React commits must not even enqueue a native reload.
for (const os of ['ios', 'android']) {
  const f = fixture(os); http(f.web); f.render();
  if (os === 'ios') prompts[0][2][1].onPress({ login: input(), password: input() });
  else { field(f, 'username').onChangeText(input()); field(f, 'password').onChangeText(input()); button(f.form, 'signIn').onPress(); }
  f.modal.onRequestClose(); f.render(); assert.equal(timers.length, 0); f.unmount();
}
// Abandoned replacement/hide cannot retire the committed request. Initial effect
// replay leaves it eligible, but retires operations created in the old epoch.
{
  const f = fixture('ios');
  const oldClose = f.modal.onRequestClose, source = f.web.source;
  const speculative = f.abandon(request()); speculative.props.onRequestClose(); assert.equal(f.completions.length, 0);
  f.abandon(null); f.render(); assert.equal(f.web.source, source);
  f.parent.replayEffects(); http(f.web); assert.equal(prompts.length, 1);
  const submit = prompts[0][2][1].onPress;
  f.parent.replayEffects(); submit({ login: input(), password: input() }); assert.equal(timers.length, 0);
  oldClose(); oldClose(); equal(f.completions, [null]); f.unmount();
}
console.log('auth-embedded: production presentation/protocol/ownership checks passed (synthetic native/hooks/timers; no external effects)');

async function duoHandoff() {
  const { isDuoAppLink, isDuoPromptPage, DUO_CLIPBOARD_BRIDGE } = load('@/features/auth/duoLink');
  // Synthetic values only: no live authentication links belong in test output or fixtures.
  const link = 'duotrustedendpoints://duo.com/trusted_ep?authkey=synthetic&app_redirect_url=&collect_cert=False';
  assert.equal(isDuoAppLink(link), true);
  for (const bad of [link.replace('duo.com', 'duo.com.evil.test'), link.replace('/trusted_ep', '/other'), link.replace('://', '://user:pass@'), link + '#fragment', 'https://duo.com/trusted_ep']) {
    assert.equal(isDuoAppLink(bad), false);
  }
  for (const os of ['android', 'ios']) {
    let opened = 0, resolve;
    openApp = url => { assert.ok(url === link, 'Preserve the full handoff URL unchanged'); opened++; return new Promise(r => { resolve = r; }); };
    const f = fixture(os);
    assert.equal(f.web.onShouldStartLoadWithRequest({ url: link }), false);
    assert.equal(f.web.onShouldStartLoadWithRequest({ url: link }), false);
    assert.equal(opened, 1);
    assert.equal(f.completions.length, 0, 'Opening Duo must preserve the OAuth session');
    f.web.onError({ nativeEvent: { url: link } }); f.render(); assert.equal(nodes(f.tree, 'Callout').length, 0);
    resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(f.web.onShouldStartLoadWithRequest({ url: 'https://identity.invalid/continue' }), true);
    openApp = async () => { throw new Error('synthetic unavailable'); };
    f.web.onShouldStartLoadWithRequest({ url: link }); await Promise.resolve(); await Promise.resolve(); f.render();
    assert.equal(one(f.tree, 'Callout').children, runtime.t('authEmbedded.duoUnavailable'));
    f.unmount();
    let reject;
    openApp = () => new Promise((_resolve, r) => { reject = r; });
    const retired = fixture(os); retired.web.onShouldStartLoadWithRequest({ url: link }); retired.unmount();
    reject(new Error('synthetic failure after close')); await Promise.resolve(); await Promise.resolve();
    assert.equal(retired.completions.length, 0);
  }
  openApp = async () => { throw new Error('Malformed link must never open an app'); };
  const f = fixture();
  assert.equal(f.web.onShouldStartLoadWithRequest({ url: link.replace('duo.com', 'evil.test') }), false);
  f.render(); assert.equal(one(f.tree, 'Callout').children, runtime.t('authEmbedded.duoUnavailable')); f.unmount();
  console.log('PASS Duo native handoff, unchanged URL, duplicate events, absent app, and retired login');

  const promptUrl = 'https://api-0123abcd.duosecurity.com/frame/prompt';
  const badPages = ['https://campus.invalid', 'http://api-0123abcd.duosecurity.com', promptUrl.replace('.com', '.com.evil.test'), promptUrl.replace('.com', '.com:8443')];
  assert.equal(isDuoPromptPage(promptUrl), true);
  for (const page of badPages) assert.equal(isDuoPromptPage(page), false);

  // Reproduce Duo's actual Android WebView action: writeText with no navigation.
  // Execute the shipped page script and deliver its messages to the real handler.
  let opened = 0;
  openApp = async url => { assert.ok(url === link, 'Bridge preserves the complete URL'); opened++; };
  const bridged = fixture('android'), copied = [], messages = [];
  const clipboard = { writeText: async value => { copied.push(value); return 'copied'; } };
  const window = { ReactNativeWebView: { postMessage(data) {
    messages.push(data);
    bridged.web.onMessage({ nativeEvent: { url: promptUrl, data } });
  } } };
  window.top = window;
  const context = vm.createContext({ window, navigator: { clipboard }, location: new URL(promptUrl), URL, Promise });
  vm.runInContext(bridged.web.injectedJavaScriptBeforeContentLoaded, context);
  const wrapped = clipboard.writeText;
  vm.runInContext(bridged.web.injectedJavaScript, context);
  assert.equal(clipboard.writeText, wrapped, 'Load-end fallback must not wrap twice');
  await clipboard.writeText(link);
  assert.equal(opened, 1); assert.equal(messages.length, 1); assert.equal(copied.length, 0);
  assert.equal(bridged.completions.length, 0);
  assert.equal(await clipboard.writeText('ordinary text'), 'copied');
  await clipboard.writeText(link.replace('duo.com', 'evil.test'));
  assert.equal(copied.length, 2); assert.equal(opened, 1);
  const deliver = (url, data) => bridged.web.onMessage({ nativeEvent: { url, data } });
  for (const page of badPages) deliver(page, messages[0]);
  for (const data of ['invalid JSON', 'null', '{}', JSON.stringify({ type: 'easel-duo-open', url: 'https://evil.test' })]) deliver(promptUrl, data);
  assert.equal(opened, 1, 'Untrusted sources and malformed bridge messages cannot launch apps');
  const lateMessage = bridged.web.onMessage;
  bridged.unmount();
  lateMessage({ nativeEvent: { url: promptUrl, data: messages[0] } });
  assert.equal(opened, 1, 'Retired login cannot launch Duo');

  for (const page of badPages) {
    const original = async () => {};
    const clipboard = { writeText: original };
    const window = { ReactNativeWebView: { postMessage: forbidden } }; window.top = window;
    vm.runInNewContext(DUO_CLIPBOARD_BRIDGE, { window, navigator: { clipboard }, location: new URL(page), URL, Promise });
    assert.equal(clipboard.writeText, original, 'Other sites retain their clipboard API');
  }
  console.log('PASS Duo clipboard-only flow, idempotent injection, origin validation, unchanged normal copies, and no credential copy');
}
duoHandoff().catch(error => { console.error(error); process.exitCode = 1; });
