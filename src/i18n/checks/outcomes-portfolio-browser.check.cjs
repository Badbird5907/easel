/* global __dirname */
// Actual lists, list owner and signed-in helper; synthetic commit/session/native edges only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const original = process.env.OUTCOMES_PORTFOLIO_ORIGINAL;
let scope, env, query, online, focused, route, navigation, locale;
const requests = [], browsers = [], listeners = new Map(), cache = new Map();
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const react = {
  useState(initial) { const s = scope, i = s.cursor++; if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial; return [s.slots[i], v => { assert.ok(s.mounted, 'no state after unmount'); const n = typeof v === 'function' ? v(s.slots[i]) : v; if (!Object.is(n, s.slots[i])) { s.slots[i] = n; s.dirty = true; } }]; },
  useRef(initial) { const s = scope, i = s.cursor++; return s.slots[i] ??= { current: initial }; },
  useMemo(fn, deps) { const s = scope, i = s.cursor++, old = s.slots[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) s.slots[i] = { deps, value: fn() }; return s.slots[i].value; },
  useLayoutEffect(fn, deps) { const s = scope, i = s.cursor++, old = s.slots[i]; if (!old || !deps || deps.some((v, j) => !Object.is(v, old.deps[j]))) { const slot = { deps, fn }; s.slots[i] = slot; s.effects.push(() => { old?.cleanup?.(); slot.cleanup = fn(); }); } },
  useSyncExternalStore(_s, get) { return get(); },
};
react.useCallback = (fn, deps) => react.useMemo(() => fn, deps);
const jsx = (type, props) => ({ type, props });
const mocks = {
  react, 'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { FlatList: 'FlatList', View: 'View' },
  'lucide-react-native': { ExternalLink: 'ExternalLink', Target: 'Target', FolderOpen: 'FolderOpen' },
  'expo-router': { useNavigation: () => navigation, useRoute: () => route, useIsFocused: () => focused },
  'expo-web-browser': { openBrowserAsync: target => { const d = deferred(); browsers.push({ target, ...d }); return d.promise; } },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/query': { useCanvasQuery: () => query },
  '@/design': new Proxy({}, { get: (_o, key) => key }),
  '@/features/course/states': { ListSkeleton: 'ListSkeleton', LoadError: 'LoadError', useRefreshControl: () => null },
  '@/features/offline/useOnline': { useOnline: () => online },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.') ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name)) : name;
  if (mocks[key]) return mocks[key];
  assert.ok(key.startsWith('@/'), `Unmocked dependency: ${key}`);
  const file = ['.ts', '.tsx', '/index.ts'].map(ext => path.join(root, key.slice(2)) + ext).find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const selected = original && /\/(OutcomeList|EPortfolioList)\.tsx$/.test(file) ? path.join(original, path.basename(file)) : file;
  const js = ts.transpileModule(fs.readFileSync(selected, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', js)(n => load(n, file), module, module.exports);
  return module.exports;
}
const runtime = load('@/i18n/runtime');
function setLocale(value) { locale = value; runtime.setAccountLocale(env.account.id, locale); }
const client = () => ({ baseUrl: 'https://school.invalid', get(...args) { const d = deferred(); requests.push({ args, ...d }); return d.promise; } });
const row = () => ({ id: 'p /', path: '/eportfolios/p%20%2F', title: 'Raw title', public: false, createdAt: null, updatedAt: null });
function setup(kind) {
  requests.length = browsers.length = 0; listeners.clear();
  env = { account: { id: 'a', baseUrl: 'https://school.invalid' }, client: client() }; online = focused = true; route = { key: 'list' };
  navigation = { isFocused: () => focused, getState: () => ({ index: 0, routes: [route] }), addListener: (event, fn) => { const set = listeners.get(event) ?? new Set(); listeners.set(event, set); set.add(fn); return () => set.delete(fn); } };
  query = { data: kind === 'outcome' ? { kind: 'available', outcomes: [] } : [row()], isPending: false, isError: false, refetch: async () => {} };
  setLocale('en');
}
const emit = name => [...(listeners.get(name) ?? [])].forEach(fn => fn());
function mount(kind) {
  const fn = load(kind === 'outcome' ? '@/features/outcomes/OutcomeList' : '@/features/eportfolios/EPortfolioList')[kind === 'outcome' ? 'OutcomeList' : 'EPortfolioList'];
  const s = { slots: [], cursor: 0, effects: [], mounted: true }; let props = { courseId: 'c /' }, tree;
  const render = () => { let count = 0; do { assert.ok(count++ < 15, 'bounded commit'); s.dirty = false; scope = s; s.cursor = 0; tree = fn(props); scope = null; while (s.effects.length) s.effects.shift()(); } while (s.dirty); return tree; };
  render();
  return { render, change(p) { props = { ...props, ...p }; return render(); }, unmount() { for (const slot of s.slots) slot?.cleanup?.(); s.mounted = false; }, discard(p = {}) { const slots = s.slots.slice(); scope = s; s.cursor = 0; const result = fn({ ...props, ...p }); scope = null; s.slots = slots; s.effects = []; return result; } };
}
const nodes = t => !t || typeof t !== 'object' ? [] : Array.isArray(t) ? t.flatMap(nodes) : [t, ...nodes(t.props?.children)];
const find = (t, type) => nodes(t).find(n => n.type === type)?.props;
function control(m, kind, management = false) { const t = m.render(); return find(kind === 'outcome' || management ? t.props.ListHeaderComponent : t.props.renderItem({ item: query.data[0] }), 'Button'); }
function error(m, kind) { const h = m.render().props.ListHeaderComponent; return kind === 'outcome' ? find(h, 'LoadError')?.error : nodes(h).find(n => n.type === 'Callout' && n.props.tone === 'danger')?.props.children; }
(async () => {
  if (original) {
    for (const kind of ['outcome', 'portfolio']) {
      setup(kind); const m = mount(kind), old = control(m, kind); old.onPress(); old.onPress();
      assert.equal(requests.length, 2, 'original duplicate requests reproduced');
      env = { ...env, client: client(), account: { ...env.account, id: 'b' } }; m.render();
      requests[0].resolve({ session_url: 'https://signed.invalid/retired' }); await flush();
      assert.equal(browsers.length, 1, 'original retired launch reproduced');
      browsers[0].resolve(); requests[1].resolve({ session_url: 'https://signed.invalid/duplicate' }); await flush(); browsers[1].resolve(); await flush(); m.unmount();
      console.log(`BEFORE ${kind}: two synchronous presses requested two sessions; account replacement still entered native browser`);
    }
    return;
  }
  const { CanvasError } = load('@/canvas/client');
  // Real helper checks both boundaries (and uses its real fallback implementation).
  setup('outcome');
  const signed = load('@/features/content/browser').openSignedIn;
  await signed(env.client, '/never', () => false); assert.equal(requests.length, 0);
  for (const kind of ['outcome', 'portfolio']) {
    const changes = {
      account(m) { env = { ...env, account: { ...env.account, id: 'b' } }; m.render(); },
      client(m) { env = { ...env, client: client() }; m.render(); },
      baseUrl(m) { env = { ...env, account: { ...env.account, baseUrl: 'https://other.invalid' } }; m.render(); },
      clientBase(m) { env.client.baseUrl = 'https://other.invalid'; m.render(); },
      expired(m) { env.account = { ...env.account, expired: true }; m.render(); },
      route(m) { route = { key: 'replacement' }; m.render(); },
      navigation(m) { navigation = { ...navigation }; m.render(); },
      query(m) { query = { ...query, data: kind === 'outcome' ? { ...query.data } : [...query.data] }; m.render(); },
      permission(m) { query = { ...query, error: new CanvasError('denied', 403, '/'), isError: true }; m.render(); },
      offline(m) { online = false; m.render(); },
      focus(m) { focused = false; emit('blur'); m.render(); },
      unmount(m) { m.unmount(); },
    };
    if (kind === 'outcome') {
      changes.course = m => m.change({ courseId: 'other' });
      changes.disabled = m => { query = { ...query, data: { kind: 'disabled' } }; m.render(); };
    } else {
      changes.sameKey = m => { query.data[0] = { ...query.data[0] }; m.render(); };
      changes.path = m => { query.data[0].path = '/eportfolios/new'; m.render(); };
      changes.removed = m => { query.data.splice(0, 1); m.render(); };
    }
    for (const [name, change] of Object.entries(changes)) for (const failure of [false, true]) {
      setup(kind); const m = mount(kind), old = control(m, kind); old.onPress();
      assert.equal(requests.length, 1); change(m);
      await old.onPress(); assert.equal(requests.length, 1, `${kind}/${name}: stale entry`);
      if (failure) requests[0].reject(Error('session denied')); else requests[0].resolve({ session_url: 'https://signed.invalid/stale' });
      await flush(); assert.equal(browsers.length, 0, `${kind}/${name}: post-await native guard`);
      if (!['expired', 'offline', 'focus', 'unmount'].includes(name)) {
        control(m, kind, true).onPress(); assert.equal(requests.length, 2, `${kind}/${name}: replacement can launch`);
        requests[1].resolve({ session_url: 'https://signed.invalid/replacement' }); await flush();
        assert.equal(browsers.length, 1); browsers[0].resolve(); await flush();
      }
      if (name !== 'unmount') m.unmount();
    }
    // A native call already entered cannot be revoked. Its late result must not
    // publish errors or clear the replacement operation's pending UI.
    for (const lateFailure of [false, true]) {
      setup(kind); const m = mount(kind); control(m, kind).onPress();
      requests[0].resolve({ session_url: 'https://signed.invalid/old' }); await flush(); assert.equal(browsers.length, 1);
      env = { ...env, client: client() }; m.render(); control(m, kind).onPress();
      assert.equal(requests.length, 2);
      if (lateFailure) browsers[0].reject(Error('old native failure')); else browsers[0].resolve();
      await flush(); assert.equal(control(m, kind).loading, true, 'old finally cannot clear replacement'); assert.equal(error(m, kind), undefined);
      requests[1].resolve({ session_url: 'https://signed.invalid/new' }); await flush(); browsers[1].resolve(); await flush();
      assert.equal(control(m, kind).loading, false); m.unmount();
    }
    // Pending session ownership also isolates old completion from new pending.
    setup(kind); { const m = mount(kind); control(m, kind).onPress(); env = { ...env, client: client() }; m.render(); control(m, kind).onPress(); requests[0].resolve({ session_url: 'https://signed.invalid/old' }); await flush(); assert.equal(browsers.length, 0); assert.equal(control(m, kind).loading, true); requests[1].resolve({ session_url: 'https://signed.invalid/new' }); await flush(); browsers[0].resolve(); await flush(); m.unmount(); }
    // Same-tick duplicates across the row and management button coalesce.
    for (const fallback of [false, true]) {
      setup(kind); const m = mount(kind), button = control(m, kind); const pending = button.onPress(); button.onPress(); control(m, kind, true).onPress();
      assert.equal(requests.length, 1); assert.equal(control(m, kind).loading, true);
      const expected = kind === 'outcome' ? '/courses/c%20%2F/outcomes' : '/eportfolios/p%20%2F';
      assert.deepEqual(requests[0].args, ['/api/v1/login/session_token', { return_to: 'https://school.invalid' + expected }]);
      setLocale('ar'); m.render();
      if (fallback) requests[0].reject(Error('no token')); else requests[0].resolve({ session_url: 'https://signed.invalid/valid' });
      await flush(); assert.equal(browsers[0].target, fallback ? 'https://school.invalid' + expected : 'https://signed.invalid/valid');
      browsers[0].reject(Error('current raw browser error')); await pending;
      assert.ok(error(m, kind));
      const h = m.render().props.ListHeaderComponent;
      assert.ok(JSON.stringify(h).includes(runtime.createTranslator('ar')('contentLists.openError')), 'current committed translation');
      const retry = kind === 'outcome' ? find(h, 'LoadError').onRetry : control(m, kind).onPress;
      retry(); assert.equal(requests.length, 2); requests[1].resolve({ session_url: 'https://signed.invalid/retry' }); await flush(); browsers[1].resolve(); await flush(); assert.equal(error(m, kind), undefined);
      // Captured retry is invalid after replacement.
      env = { ...env, client: client() }; m.render(); await retry(); assert.equal(requests.length, 2); m.unmount();
    }
    // Returning to an identical old source cannot resurrect its pending/error UI.
    setup(kind); { const m = mount(kind), saved = env; control(m, kind).onPress();
      env = { ...env, client: client() }; m.render(); env = saved; m.render();
      assert.equal(control(m, kind).loading, false); control(m, kind).onPress(); assert.equal(requests.length, 2);
      requests[0].resolve({ session_url: 'https://signed.invalid/old-source' }); await flush(); assert.equal(browsers.length, 0);
      assert.equal(control(m, kind).loading, true); requests[1].resolve({ session_url: 'https://signed.invalid/restored' }); await flush(); browsers[0].resolve(); await flush(); m.unmount(); }
    // Focus returning never revives old controls, even if events batch before render.
    setup(kind); { const m = mount(kind), old = control(m, kind); emit('blur'); emit('focus'); m.render(); await old.onPress(); assert.equal(requests.length, 0); control(m, kind).onPress(); assert.equal(requests.length, 1); requests[0].resolve({ session_url: 'https://signed.invalid/focus' }); await flush(); browsers[0].resolve(); await flush(); m.unmount(); }
    // Discarded render doesn't publish an owner or retire committed work.
    setup(kind); { const m = mount(kind); control(m, kind).onPress(); const saved = env; env = { ...env, client: client() }; const discarded = m.discard(); env = saved; const stale = find(discarded.props.ListHeaderComponent, 'Button'); await stale.onPress(); assert.equal(requests.length, 1); requests[0].resolve({ session_url: 'https://signed.invalid/committed' }); await flush(); assert.equal(browsers.length, 1); browsers[0].resolve(); await flush(); m.unmount(); }
    // Unmount after native entry guards delayed native rejection/finalization.
    setup(kind); { const m = mount(kind); control(m, kind).onPress(); requests[0].resolve({ session_url: 'https://signed.invalid/entered' }); await flush(); m.unmount(); browsers[0].reject(Error('unmounted')); await flush(); }
  }
  // In-place source mutations also fail the captured row/path predicate without
  // relying on a React rerender. Same-key replacement is not the captured row.
  for (const mutate of [() => { query.data[0].path = '/eportfolios/other'; }, () => { query.data[0] = { ...query.data[0] }; }, () => { query.data.length = 0; }, () => { query.error = new CanvasError('denied', 403, '/'); }]) {
    setup('portfolio'); const m = mount('portfolio'), old = control(m, 'portfolio'); old.onPress(); mutate(); await old.onPress(); assert.equal(requests.length, 1); requests[0].reject(Error('fallback')); await flush(); assert.equal(browsers.length, 0); m.unmount();
  }
  // Browser fallbacks preserve existing online permissions: management remains
  // available even if the list endpoint denies access; unavailable rows cannot open.
  for (const kind of ['outcome', 'portfolio']) for (const code of [403, 404, 405, 501]) {
    setup(kind); query.error = new CanvasError('restricted', code, '/'); query.isError = true;
    const m = mount(kind); const h = control(m, kind, true); h.onPress();
    assert.equal(requests.length, 1); const expected = kind === 'outcome' ? '/courses/c%20%2F/outcomes' : '/dashboard/eportfolios';
    assert.equal(requests[0].args[1].return_to, 'https://school.invalid' + expected);
    requests[0].reject(Error('fallback')); await flush(); assert.equal(browsers[0].target, 'https://school.invalid' + expected); browsers[0].resolve(); await flush();
    if (kind === 'portfolio') { await control(m, kind).onPress(); assert.equal(requests.length, 1); }
    online = false; m.render(); await h.onPress(); assert.equal(requests.length, 1); m.unmount();
  }
  for (const kind of ['outcome', 'portfolio']) {
    setup(kind); query.data = undefined; const m = mount(kind); control(m, kind, true).onPress(); assert.equal(requests.length, 1);
    requests[0].reject(Error('unavailable list')); await flush(); assert.equal(browsers.length, 1); browsers[0].resolve(); await flush(); m.unmount();
  }
  setup('outcome'); { query.data = { kind: 'disabled' }; const m = mount('outcome'); control(m, 'outcome').onPress(); assert.equal(requests.length, 1); requests[0].resolve({ session_url: 'https://signed.invalid/disabled-fallback' }); await flush(); browsers[0].resolve(); await flush(); m.unmount(); }
  setup('portfolio'); { const m = mount('portfolio'), old = control(m, 'portfolio', true); old.onPress(); query.data[0].path = '/changed'; await old.onPress(); assert.equal(requests.length, 1); requests[0].resolve({ session_url: 'https://signed.invalid/old-management' }); await flush(); assert.equal(browsers.length, 0); m.unmount(); }
  console.log(`outcomes/portfolio browser lifetimes passed (${process.env.TZ ?? 'host TZ'}; actual lists/owner/signed-in helper; synthetic boundaries)`);
})().catch(e => { console.error(e); process.exitCode = 1; });
