const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
// Actual terms components, lifetime and legal API callers with synthetic
// hooks/commit/native/browser/query/transport/session boundaries only. No effects
// reach HTTP, native modules, storage or accounts. This is not native/Compiler acceptance.
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
  'features/auth/authTermsLifetime', 'features/auth/TermsStep', 'features/auth/TermsDocument',
  'features/settings/TermsRecheck', 'canvas/api/legal']);
const jsx = (type, props, key) => ({ type, props, key });
const elements = names => Object.fromEntries(names.split(' ').map(n => [n, n]));
const calls = [];
let behavior = {}, session, query, theme, scale, online, now = 100000000;
const listeners = new Set();
class CanvasNetworkError extends Error {}
const stage = (name, fallback) => (...args) => { calls.push([name, ...args]); return behavior[name] ? behavior[name](...args) : fallback(...args); };
const client = (id = 'one') => ({
  baseUrl: 'https://' + id + '.test',
  get: stage('get', async () => ({ requires_terms_acceptance: true })),
  put: stage('put', async () => {}),
});
const account = (id = 'one') => ({ id, host: 'RAW École مدرسة ' + id, baseUrl: 'https://' + id + '.test', user: { name: 'RAW Élodie نور ' + id } });
const mocks = {
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': {
    ...elements('View Modal ScrollView'), PixelRatio: { getFontScale: () => scale },
    Alert: { alert: stage('alert', () => {}) },
    AppState: { addEventListener: (event, fn) => { assert.equal(event, 'change'); listeners.add(fn); return { remove: () => listeners.delete(fn) }; } },
  },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 1, bottom: 2 }) },
  'react-native-webview': { WebView: 'WebView' },
  'lucide-react-native': elements('ExternalLink'),
  '@/design': { ...elements('Button Callout Card Skeleton Text'), useTheme: () => theme,
    haptics: { success: () => calls.push(['success']), error: () => calls.push(['error']) } },
  '@/canvas/client': { CanvasNetworkError },
  '@/canvas/session': { useCanvas: () => session, useSession: () => ({ signOut: stage('signOut', async () => {}) }) },
  '@/canvas/query': { useCanvasQuery: () => { throw Error('unexpected signed-in query'); } },
  '@tanstack/react-query': { useQuery: options => { calls.push(['query', options]); return query; } },
  '@/features/offline/connectivity': { isOnline: () => online },
  'expo-web-browser': { openBrowserAsync: stage('open', async () => ({ type: 'opened' })) },
};
class Clock extends Date { static now() { return now; } }
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
  }).outputText, { filename: file }).runInNewContext({ module, exports: module.exports, require: n => load(n, file), Intl, Date: Clock, Error, URL });
  return module.exports;
}
const runtime = load('@/i18n/runtime');
const { TermsStep } = load('@/features/auth/TermsStep');
const { TermsDocument } = load('@/features/auth/TermsDocument');
const { TermsRecheck } = load('@/features/settings/TermsRecheck');
const legal = load('@/canvas/api/legal');
const locale = lang => { runtime.setAccountLocale('synthetic-viewer', lang); return runtime.createTranslator(lang); };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const walk = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(walk) : [tree, ...walk(tree.props?.children)];
const nodes = (tree, type) => walk(tree).filter(n => n.type === type);
const one = (tree, type, predicate = () => true) => { const n = nodes(tree, type).find(n => predicate(n.props)); assert.ok(n, 'Missing ' + (type.name ?? type)); return n.props; };
const count = name => calls.filter(c => c[0] === name).length;
const equal = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const textContent = tree => Array.isArray(tree) ? tree.map(textContent).join('') : typeof tree === 'object' && tree ? textContent(tree.props?.children) : tree == null ? '' : String(tree);
const rawHtml = '<p dir="rtl">RAW شروط <a target="_blank" href="https://policy.test/raw?q=é">École</a></p>';
const rawUrl = 'https://policy.test/RAW?lang=École#شروط';
function reset() {
  assert.equal(listeners.size, 0, 'leaked AppState listener');
  behavior = {}; calls.length = 0; online = true; now += 2000000; scale = 1;
  theme = { colors: { fg: 'fg-test', accentFg: 'accent-test', border: 'border-test' }, scheme: 'light' };
  session = { account: account(String(now)), client: client(String(now)) };
  query = { data: { html: rawHtml, url: rawUrl, none: false }, isPending: false, isError: false, refetch: stage('refetch', async () => query) };
  locale('en');
}
function component(fn, props) {
  const f = { props }; f.m = mount(() => fn(f.props)); f.render = () => f.tree = f.m.render(); f.render(); return f;
}
const step = (props = {}) => component(TermsStep, { pending: { ...session }, showHeading: true, onAccept: stage('accept', async () => {}), onDecline: stage('decline', async () => {}), ...props });
const action = (f, key) => one(f.tree, 'Button', p => p.children === runtime.createTranslator(runtime.getLocaleState().locale)('authTerms.' + key)).onPress;
const foreground = () => { for (const listener of listeners) listener('active'); };
const alertButtons = () => calls.filter(c => c[0] === 'alert').at(-1)[3];
const checkProps = f => one(f.tree, TermsStep);
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
for (const lang of ['en', 'fr', 'ar']) {
  const catalog = load('@/i18n/' + lang)[lang];
  for (const [key, digest] of Object.entries(require('./auth-terms.baseline.json').catalogs[lang]))
    assert.equal(hash(JSON.stringify(catalog[key])), digest, lang + ':' + key);
}

async function main() {
  // Equivalent reconstructed pending/query objects and locale changes must not unlock an action.
  reset(); let gate = deferred(); behavior.accept = () => gate.promise;
  let f = step(); const accept = action(f, 'accept'), decline = action(f, 'decline');
  accept(); decline(); accept(); assert.equal(count('accept'), 1); assert.equal(count('decline'), 0);
  for (const lang of ['fr', 'ar', 'en']) {
    const t = locale(lang); f.props = { ...f.props, pending: { ...session, account: { ...session.account } } };
    query = { ...query, data: { ...query.data } }; f.render();
    assert.ok(textContent(f.tree).includes(t('authTerms.schoolRequest', { name: session.account.host })));
    assert.ok(textContent(f.tree).includes(t('authTerms.signingIn', { name: session.account.user.name })));
    equal(one(f.tree, TermsDocument), { html: rawHtml, baseUrl: session.account.baseUrl });
    action(f, 'accept')(); action(f, 'decline')(); assert.equal(count('accept'), 1); assert.equal(count('decline'), 0);
  }
  gate.reject(new CanvasNetworkError()); await tick(); f.render(); assert.equal(count('error'), 1);
  for (const lang of ['fr', 'ar']) { const t = locale(lang); f.render(); assert.ok(textContent(f.tree).includes(t('authTerms.networkError'))); }
  behavior.accept = async () => {}; await action(f, 'accept')(); f.render(); action(f, 'decline')(); assert.equal(count('accept'), 2); assert.equal(count('decline'), 0); f.m.unmount();

  // Failed decline retries, pending acceptance guard, and generic authored error provenance.
  reset(); query.isPending = true; f = step(); action(f, 'accept')(); assert.equal(count('accept'), 0);
  behavior.decline = async () => { throw Error('RAW server message should not become authored UI'); };
  await action(f, 'decline')(); f.render(); assert.ok(textContent(f.tree).includes(locale('en')('authTerms.answerError')));
  behavior.decline = async () => {}; await action(f, 'decline')(); assert.equal(count('decline'), 2); f.m.unmount();

  // Account, client, terms and eligibility replacement, unmount, and abandoned render.
  for (const replacement of ['account', 'client', 'html', 'url', 'pending', 'unmount']) {
    reset(); gate = deferred(); behavior.accept = () => gate.promise; f = step(); const old = action(f, 'accept'); old();
    if (replacement === 'account') f.props.pending = { ...session, account: account('replacement') };
    if (replacement === 'client') f.props.pending = { ...session, client: client('replacement') };
    if (replacement === 'html' || replacement === 'url') query = { ...query, data: { ...query.data, [replacement]: 'RAW replacement' } };
    if (replacement === 'pending') query = { ...query, isPending: true };
    if (replacement === 'unmount') f.m.unmount(); else f.render();
    old(); gate.reject(Error('late')); await tick(); assert.equal(count('accept'), 1); assert.equal(count('error'), 0);
    if (replacement !== 'unmount') { f.render(); assert.equal(nodes(f.tree, 'Callout').length, 0); f.m.unmount(); }
  }
  reset(); gate = deferred(); behavior.accept = () => gate.promise; f = step(); action(f, 'accept')();
  const original = f.props; f.props = { ...original, pending: { ...session, client: client('speculative') } }; f.m.renderOnly(); f.m.abandon(); f.props = original;
  gate.reject(Error('current')); await tick(); f.render(); assert.equal(count('error'), 1); f.m.replayEffects(); f.render(); behavior.accept = async () => {}; await action(f, 'accept')(); assert.equal(count('accept'), 2); f.m.unmount();

  // Retry and browser coalescing, raw URLs, fallback, failed retry and stale browser errors.
  reset(); query = { ...query, data: { ...query.data, html: null }, isError: true }; f = step(); gate = deferred(); behavior.refetch = () => gate.promise;
  let retry = one(f.tree, 'Callout').action.onPress; retry(); retry(); action(f, 'read')(); assert.equal(count('refetch'), 1); assert.equal(count('open'), 0);
  gate.reject(Error('retry')); await tick(); f.render(); assert.ok(textContent(f.tree).includes(locale('en')('authTerms.loadError')));
  behavior.refetch = async () => query; await one(f.tree, 'Callout').action.onPress(); assert.equal(count('refetch'), 2);
  gate = deferred(); behavior.open = () => gate.promise; const read = action(f, 'read'); read(); read(); equal(calls.find(c => c[0] === 'open').slice(1), [rawUrl]);
  locale('ar'); f.render(); action(f, 'read')(); assert.equal(count('open'), 1);
  gate.reject(Error('browser')); await tick(); f.render(); assert.ok(textContent(f.tree).includes(locale('ar')('authTerms.browserError')));
  gate = deferred(); read(); query = { ...query, data: undefined }; f.render(); read(); gate.reject(Error('late')); await tick(); f.render(); assert.ok(!textContent(f.tree).includes(locale('ar')('authTerms.browserError')));
  behavior.open = async () => {}; await action(f, 'read')(); equal(calls.filter(c => c[0] === 'open').at(-1).slice(1), [session.account.baseUrl + '/terms_of_use']);
  retry(); assert.equal(count('refetch'), 2); f.m.unmount(); read(); assert.equal(count('open'), 3);

  // Source identity, unchanged raw body/CSS/bridge, native policy, numeric dimensions and locale labels.
  reset(); f = component(TermsDocument, { html: rawHtml, baseUrl: 'https://source.test/path/' });
  let web = one(f.tree, 'WebView'); const source = web.source; const key = nodes(f.tree, 'WebView')[0].key;
  assert.ok(source.html.includes('<body>' + rawHtml)); assert.ok(source.html.includes('font-size: 15.0px')); equal(source.baseUrl, f.props.baseUrl);
  equal(web.originWhitelist, ['*']); assert.equal(web.scrollEnabled, false); assert.equal(web.textZoom, 100); assert.equal(web.setSupportMultipleWindows, false);
  const request = (url, isTopFrame = true) => ({ url, isTopFrame });
  assert.equal(web.onShouldStartLoadWithRequest(request(rawUrl)), true); assert.equal(count('open'), 0);
  web.onLoadEnd(); web.onMessage({ nativeEvent: { data: '240.2' } }); f.render(); assert.equal(f.tree.props.style.height, 241);
  for (const value of ['Infinity', 'NaN', '-1', '0', '1e100', '', 'not numeric']) { web.onMessage({ nativeEvent: { data: value } }); f.render(); assert.equal(f.tree.props.style.height, 241); }
  for (const lang of ['fr', 'ar', 'en']) { const t = locale(lang); f.render(); web = one(f.tree, 'WebView'); assert.equal(web.source, source); assert.equal(nodes(f.tree, 'WebView')[0].key, key); assert.equal(web.accessibilityLabel, t('authTerms.heading')); assert.equal(f.tree.props.style.height, 241); }
  assert.equal(web.onShouldStartLoadWithRequest(request('about:blank')), true);
  assert.equal(web.onShouldStartLoadWithRequest(request('https://iframe.test', false)), true);
  assert.equal(web.onShouldStartLoadWithRequest(request('mailto:raw@test')), false); assert.equal(count('open'), 0);
  gate = deferred(); behavior.open = () => gate.promise;
  assert.equal(web.onShouldStartLoadWithRequest(request(rawUrl)), false); web.onShouldStartLoadWithRequest(request(rawUrl)); assert.equal(count('open'), 1); equal(calls.find(c => c[0] === 'open').slice(1), [rawUrl]);
  gate.reject(Error('handled')); await tick(); web.onShouldStartLoadWithRequest(request(rawUrl)); assert.equal(count('open'), 2); await tick();
  for (const replacement of ['baseUrl', 'html', 'theme', 'scale']) {
    const old = one(f.tree, 'WebView');
    if (replacement === 'theme') theme = { ...theme, scheme: 'dark' };
    else if (replacement === 'scale') scale = 1.5;
    else f.props = { ...f.props, [replacement]: f.props[replacement] + 'RAW new' };
    f.render(); const next = one(f.tree, 'WebView'); assert.notEqual(next.source, old.source); assert.equal(f.tree.props.style.height, 120);
    old.onLoadEnd(); old.onMessage({ nativeEvent: { data: '999' } }); assert.equal(old.onShouldStartLoadWithRequest(request(rawUrl)), false);
    f.render(); assert.equal(f.tree.props.style.height, 120); assert.equal(next.onShouldStartLoadWithRequest(request(rawUrl)), true);
    next.onLoadEnd(); next.onMessage({ nativeEvent: { data: '330' } }); f.render(); assert.equal(f.tree.props.style.height, 330);
  }
  web = one(f.tree, 'WebView'); f.m.unmount(); web.onLoadEnd(); web.onMessage({ nativeEvent: { data: '123' } }); assert.equal(web.onShouldStartLoadWithRequest(request(rawUrl)), false);
  // Execute the real authored height script with DOM/native posting simulated.
  const script = source.html.match(/<script>([\s\S]*)<\/script>/)[1]; const events = {}; const posted = []; let removed = 0, observed = false;
  const body = { getBoundingClientRect: () => ({ height: 91.2 }) };
  vm.runInNewContext(script, { document: { body, querySelectorAll: selector => { assert.equal(selector, 'a[target]'); return [{ removeAttribute: name => { assert.equal(name, 'target'); removed++; } }]; } },
    window: { ReactNativeWebView: { postMessage: value => posted.push(value) }, ResizeObserver: true, addEventListener: (event, fn) => { events[event] = fn; } },
    ResizeObserver: class { constructor(fn) { this.fn = fn; } observe(value) { assert.equal(value, body); observed = true; this.fn(); } } });
  assert.equal(removed, 1); assert.equal(observed, true); events.load(); equal(posted, ['92', '92', '92']);

  // Recheck's real legal caller arguments, foreground cadence, connectivity, and subscriptions.
  reset(); online = false; f = component(TermsRecheck); assert.equal(count('get'), 0); assert.equal(one(f.tree, 'Modal').visible, false);
  online = true; foreground(); await tick(); f.render(); assert.equal(count('get'), 1); assert.equal(one(f.tree, 'Modal').visible, true);
  equal(calls.find(c => c[0] === 'get').slice(1), ['/api/v1/login/session_token', { return_to: session.client.baseUrl + '/' }]);
  foreground(); now += 30 * 60000 - 1; foreground(); assert.equal(count('get'), 1); now++; foreground(); await tick(); f.render(); assert.equal(count('get'), 2);
  for (const listener of listeners) listener('background'); assert.equal(count('get'), 2); f.m.unmount(); assert.equal(listeners.size, 0);

  // Effect replay reuses the entered read; stale subscribers cannot publish, cadence stays intact.
  reset(); gate = deferred(); behavior.get = () => gate.promise; f = component(TermsRecheck); f.m.replayEffects();
  assert.equal(count('get'), 1); gate.resolve({ requires_terms_acceptance: true }); await tick(); f.render();
  assert.equal(one(f.tree, 'Modal').visible, true); foreground(); assert.equal(count('get'), 1); f.m.unmount();

  // Stale checks cannot show terms for a replacement client/account or after unmount.
  for (const replacement of ['client', 'account', 'unmount']) {
    reset(); gate = deferred(); behavior.get = () => gate.promise; f = component(TermsRecheck);
    if (replacement === 'unmount') f.m.unmount();
    else { session = { ...session, ...(replacement === 'client' ? { client: client('new') } : { account: account('new-' + now) }) }; behavior.get = async () => ({ requires_terms_acceptance: false }); f.render(); }
    gate.resolve({ requires_terms_acceptance: true }); await tick();
    if (replacement !== 'unmount') { f.render(); assert.equal(one(f.tree, 'Modal').visible, false); f.m.unmount(); }
  }

  // Mounted step in recheck: fresh pending wrappers do not unlock; cancel remounts and old buttons die.
  reset(); f = component(TermsRecheck); await tick(); f.render(); let child = step(checkProps(f));
  await action(child, 'decline')(); await action(child, 'decline')(); assert.equal(count('alert'), 1);
  let buttons = alertButtons(); equal(buttons.map(b => [b.text, b.style]), [['Cancel', 'cancel'], ['Sign out', 'destructive']]);
  equal(calls.find(c => c[0] === 'alert').slice(1, 3), [locale('en')('authTerms.signOutTitle', { name: session.account.host }), locale('en')('authTerms.signOutBody')]);
  const oldKey = nodes(f.tree, TermsStep)[0].key; locale('ar'); f.render(); child.props = checkProps(f); child.render(); action(child, 'accept')(); assert.equal(count('put'), 0);
  buttons[0].onPress(); buttons[0].onPress(); buttons[1].onPress(); f.render(); assert.equal(nodes(f.tree, TermsStep)[0].key, oldKey + 1); assert.equal(count('signOut'), 0);
  child.m.unmount(); child = step(checkProps(f)); gate = deferred(); behavior.put = () => gate.promise;
  action(child, 'accept')(); action(child, 'decline')(); action(child, 'accept')(); assert.equal(count('put'), 1); equal(calls.find(c => c[0] === 'put').slice(1), ['/api/v1/users/self', { user: { terms_of_use: true } }]);
  gate.reject(new CanvasNetworkError()); await tick(); child.render(); assert.equal(count('error'), 1); behavior.put = async () => {};
  await action(child, 'accept')(); f.render(); assert.equal(one(f.tree, 'Modal').visible, false); assert.equal(count('success'), 1); assert.equal(count('signOut'), 0); child.m.unmount(); f.m.unmount();

  // Retained Alert callbacks across account/client replacement, hidden state, return, and unmount.
  for (const replacement of ['account', 'client', 'unmount']) {
    reset(); f = component(TermsRecheck); await tick(); f.render(); await checkProps(f).onDecline(); buttons = alertButtons(); const original = session;
    if (replacement === 'unmount') f.m.unmount();
    else { session = { ...session, ...(replacement === 'account' ? { account: account('other-' + now) } : { client: client('other') }) }; behavior.get = async () => ({ requires_terms_acceptance: false }); f.render(); await tick(); f.render(); assert.equal(one(f.tree, 'Modal').visible, false); session = original; f.render(); }
    buttons[1].onPress(); buttons[0].onPress(); assert.equal(count('signOut'), 0);
    if (replacement !== 'unmount') f.m.unmount();
  }
  // Explicit confirmation signs out exactly the original account, once, even before rerender.
  reset(); f = component(TermsRecheck); await tick(); f.render(); const oldProps = checkProps(f); await oldProps.onDecline(); buttons = alertButtons();
  buttons[1].onPress(); buttons[1].onPress(); buttons[0].onPress(); await oldProps.onDecline(); await oldProps.onAccept(); assert.equal(count('signOut'), 1); equal(calls.find(c => c[0] === 'signOut').slice(1), [session.account.id]); assert.equal(count('put'), 0); f.render(); assert.equal(one(f.tree, 'Modal').visible, false); f.m.unmount();

  // Stale acceptance success/error never publishes haptics or rejects into a replacement step.
  for (const outcome of ['resolve', 'reject']) {
    reset(); f = component(TermsRecheck); await tick(); f.render(); gate = deferred(); behavior.put = () => gate.promise; const accepting = checkProps(f).onAccept();
    session = { ...session, client: client('replacement') }; f.render(); gate[outcome](Error('late')); await accepting; assert.equal(count('success'), 0); assert.equal(count('error'), 0); f.m.unmount();
  }
  // A passive check entered before acceptance cannot reopen a dismissed requirement.
  reset(); f = component(TermsRecheck); await tick(); f.render(); gate = deferred(); behavior.get = () => gate.promise; now += 30 * 60000; foreground();
  await checkProps(f).onAccept(); f.render(); gate.resolve({ requires_terms_acceptance: true }); await tick(); f.render(); assert.equal(one(f.tree, 'Modal').visible, false); f.m.unmount();

  // A check started while acceptance awaits also cannot reopen after acceptance succeeds.
  reset(); f = component(TermsRecheck); await tick(); f.render(); const acceptingGate = deferred(); behavior.put = () => acceptingGate.promise;
  const accepting = checkProps(f).onAccept(); gate = deferred(); behavior.get = () => gate.promise; now += 30 * 60000; foreground();
  acceptingGate.resolve(); await accepting; f.render(); gate.resolve({ requires_terms_acceptance: true }); await tick(); f.render();
  assert.equal(one(f.tree, 'Modal').visible, false); f.m.unmount();

  // A no-longer-visible retry is ineligible even when the query retains equivalent data.
  reset(); query = { ...query, data: { ...query.data, html: null }, isError: true }; f = step();
  const obsoleteRetry = one(f.tree, 'Callout').action.onPress; query = { ...query, isError: false }; f.render(); obsoleteRetry(); assert.equal(count('refetch'), 0); f.m.unmount();

  // Shared legal source is executed with a synthetic transport; original fallback and payload policy.
  reset(); const c = client(); const signal = { synthetic: 'abort-signal' };
  behavior.get = async () => { throw Error('blocked by synthetic school'); };
  assert.equal(await legal.fetchRequiresTerms(c), false); equal(await legal.fetchTerms(c, signal), { html: null, url: c.baseUrl + '/terms_of_use', none: false });
  equal(calls.filter(c => c[0] === 'get').slice(-2).map(c => c.slice(1)), [['/api/v1/accounts/self/terms_of_service', undefined, signal], ['/api/v1/acceptable_use_policy', undefined, signal]]);
  behavior.get = async () => ({ content: rawHtml }); equal((await legal.fetchTerms(c)).html, rawHtml);
  behavior.get = async p => p.includes('terms_of_service') ? {} : { redirectUrl: rawUrl }; equal((await legal.fetchTerms(c)).url, rawUrl);
  // Actual useSignInTerms keeps cache and fetch signal contract.
  f = step(); const options = calls.filter(c => c[0] === 'query').at(-1)[1]; equal(options.queryKey, ['sign-in', 'terms', session.client.baseUrl]); assert.equal(options.staleTime, 5 * 60000); assert.equal(options.gcTime, 0); await options.queryFn({ signal }); assert.equal(calls.filter(c => c[0] === 'get').at(-1)[3], signal); f.m.unmount();
  console.log('auth-terms: production components/lifetimes/legal protocols and historical catalogs passed (' + process.env.TZ + '); synthetic boundaries only');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
