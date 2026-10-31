const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
// Production auth forms, routes, lifetime helper and locale runtime. Synthetic
// hooks/native/auth/session/school/browser boundaries; no HTTP, storage or accounts.
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
  'features/auth/authFormsLifetime', 'features/auth/SignInFlow', 'features/auth/TokenHelp',
  'app/sign-in', 'app/(app)/add-account']);
const jsx = (type, props, key) => ({ type, props, key });
const elements = (names) => Object.fromEntries(names.split(' ').map(n => [n, n]));
const calls = [];
const operations = [];
let behavior = {}, session, registeredKey, confirmation;
class SignInError extends Error { }
class ObsoleteSignInError extends Error { }
class SignInCanceled extends Error { }
const account = (id = 'one', authMethod = 'token') => ({
  id, host: id + '.test', baseUrl: 'https://' + id + '.test',
  authMethod, expired: true, user: { name: 'RAW ' + id, shortName: 'RAW SHORT ' + id, id, avatarUrl: null }
});
const pending = (a = account()) => ({ account: a, client: { boundary: a.id }, credentials: { accessToken: 'inert-dummy' } });
let result;
const stage = (name, fallback) => (...args) => { calls.push([name, ...args]); return behavior[name] ? behavior[name](...args) : fallback(...args); };
const normalizeHost = value => value?.trim() ? { host: value.trim().replace(/^https:\/\//, ''), baseUrl: 'https://' + value.trim().replace(/^https:\/\//, '') } : null;
const mocks = {
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': { ...elements('View TextInput'), Platform: { OS: 'ios' }, Keyboard: { dismiss() { } } },
  'lucide-react-native': elements('AppWindow Globe KeyRound School ShieldCheck SquareAsterisk Ticket ExternalLink'),
  '@/design': {
    ...elements('Avatar Button Callout Card IconTile ListGroup ListItem OptionGroup Screen Sheet Text TextField'),
    haptics: { selection() { }, success: () => calls.push(['success']), error: () => calls.push(['error']) }
  },
  '@/canvas/client': { normalizeHost },
  '@/canvas/session': {
    useSession: () => session, SignInError, ObsoleteSignInError,
    storedClientCredentials: stage('stored', async () => null),
    verifyToken: stage('verifyToken', async () => result),
    verifyOAuth: stage('verifyOAuth', async () => result),
    createOAuthSource: () => ({ capture() {}, abandon() {} }),
    discardSignIn: stage('discard', async () => { }),
    wrongAccountMessage: () => 'RAW shared identity error',
  },
  '@/canvas/api/legal': { fetchRequiresTerms: stage('terms', async () => false), acceptTerms: stage('accept', async () => { }) },
  '@/features/auth/keys': { developerKeyFor: stage('key', () => registeredKey) },
  '@/features/auth/schools': {
    typedSchool: value => value.trim() ? { name: value, host: value } : null,
    searchSchools: value => value === 'school' ? [{ name: 'RAW SCHOOL', host: 'selected.test', authenticationProvider: 'saml' }] : [],
  },
  '@/features/auth/oauth': {
    SignInCanceled,
    checkSchool: stage('check', async () => { }),
    createAuthorization: stage('create', async (host, key, options) => ({ host, key, options, state: 'inert-state', verifier: 'inert-verifier', embedded: options.mode === 'embedded' })),
    authorizeInBrowser: stage('authorize', async () => 'easel://oauth/callback?code=inert'),
    codeFromCallback: stage('code', () => 'inert-code'),
    exchangeCode: stage('exchange', async () => ({ access_token: 'inert-response' })),
  },
  '@/features/auth/TermsStep': { TermsStep: 'TermsStep' },
  '@/features/auth/EmbeddedSignIn': { EmbeddedSignIn: 'EmbeddedSignIn' },
  '@/features/auth/signOut': { confirmSignOut: (...args) => { confirmation = args; } },
  'expo-web-browser': { openBrowserAsync: stage('open', async () => ({ type: 'opened' })) },
  'expo-router': { router: { back: () => calls.push(['back']) } },
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
    fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    }
  }).outputText, { filename: file }).runInNewContext({ module, exports: module.exports, require: n => load(n, file), Intl, Date, Error, URL });
  if (key === '@/features/auth/authFormsLifetime') {
    const claim = module.exports.authFormsClaim;
    module.exports.authFormsClaim = (...args) => {
      const operation = claim(...args);
      if (operation) operations.push(operation);
      return operation;
    };
  }
  return module.exports;
}
const runtime = load('@/i18n/runtime');
const { SignInFlow } = load('@/features/auth/SignInFlow');
const { TokenHelp } = load('@/features/auth/TokenHelp');
const SignInScreen = load('@/app/sign-in').default;
const AddAccountScreen = load('@/app/(app)/add-account').default;
const locale = lang => { runtime.setAccountLocale('synthetic-viewer', lang); return runtime.createTranslator(lang); };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const walk = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(walk) : [tree, ...walk(tree.props?.children), ...walk(tree.props?.footer)];
const nodes = (tree, type) => walk(tree).filter(n => n.type === type);
const one = (tree, type, predicate = () => true) => { const n = nodes(tree, type).find(n => predicate(n.props)); assert.ok(n, 'Missing ' + type); return n.props; };
const names = () => calls.map(c => c[0]);
const count = name => calls.filter(c => c[0] === name).length;
const equal = (a, b, message = 'protocol equality') => assert.ok(JSON.stringify(a) === JSON.stringify(b), message);
function saveOptions(expectedAccountId) {
  const options = calls.find(c => c[0] === 'save')[2];
  equal(Object.keys(options).sort(), ['current', 'expectedAccountId']);
  assert.equal(options.expectedAccountId, expectedAccountId);
  assert.equal(options.current, operations.at(-1).current, 'save must forward original operation predicate by identity');
}
function reset() {
  behavior = {}; calls.length = 0; operations.length = 0; registeredKey = { clientId: 'inert-id', clientSecret: null }; result = pending(); locale('en');
  session = {
    accounts: [], active: null,
    addAccount: stage('save', async p => p.account), switchAccount: stage('switch', async () => { }), signOut: stage('remove', async () => { })
  };
}
function form(props = {}) {
  const f = { props }; f.m = mount(() => SignInFlow(f.props)); f.render = () => f.tree = f.m.render(); f.render();
  f.field = key => one(f.tree, 'TextField', p => p.label === runtime.createTranslator(runtime.getLocaleState().locale)('authForms.' + key));
  f.edit = (key, value) => { f.field(key).onChangeText(value); f.render(); };
  f.method = value => { one(f.tree, 'OptionGroup', p => p.options.some(o => o.value === value)).onSelect(value); f.render(); };
  f.submit = () => one(f.tree, 'Button', p => p.size === 'lg').onPress();
  return f;
}
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
for (const lang of ['en', 'fr', 'ar']) {
  const catalog = load('@/i18n/' + lang)[lang];
  for (const [key, digest] of Object.entries(require('./auth-forms.baseline.json').catalogs[lang]))
    assert.equal(hash(JSON.stringify(catalog[key])), digest, lang + ':' + key);
}

async function main() {
  // Real form state and field-error keys survive locale updates. Secrets never enter output.
  reset(); let f = form({ showTitle: true }); f.submit(); f.render();
  for (const lang of ['fr', 'ar', 'en']) { const t = locale(lang); f.render(); assert.equal(f.field('school').error, t('authForms.schoolRequired')); }
  f.edit('school', 'school'); assert.equal(one(f.tree, 'ListItem').title, 'RAW SCHOOL');
  one(f.tree, 'ListItem').onPress(); f.render(); f.method('key'); f.submit(); f.render();
  for (const lang of ['fr', 'ar', 'en']) { const t = locale(lang); f.render(); assert.equal(f.field('clientId').error, t('authForms.clientIdRequired')); }
  f.edit('clientId', '  inert-id  '); f.edit('clientSecret', ' inert-dummy-secret ');
  for (const lang of ['fr', 'ar', 'en']) { locale(lang); f.render(); equal(f.field('clientId').value, '  inert-id  '); equal(f.field('clientSecret').value, ' inert-dummy-secret '); }
  f.method('token'); f.submit(); f.render(); locale('fr'); f.render(); assert.equal(f.field('token').error, runtime.createTranslator('fr')('authForms.tokenRequired'));
  f.edit('token', ' inert-dummy-token '); locale('ar'); f.render(); equal(f.field('token').value, ' inert-dummy-token ');
  f.method('key'); equal(f.field('clientSecret').value, ' inert-dummy-secret '); f.m.unmount();

  // Initial effect replay retains eligibility; rapid input events keep the latest text.
  reset(); f = form(); f.m.replayEffects(); f.render();
  const change = f.field('school').onChangeText; change('first.test'); change('last.test'); f.render();
  equal(f.field('school').value, 'last.test'); f.edit('school', 'last.test'); f.submit(); await tick(); assert.equal(count('save'), 1); f.m.unmount();
  reset(); f = form(); f.edit('school', 'school'); const oldSuggestion = one(f.tree, 'ListItem').onPress;
  f.edit('school', 'replacement.test'); oldSuggestion(); f.render(); equal(f.field('school').value, 'replacement.test'); f.m.unmount();
  // All method option descriptors translate; selection preserves the protocol mode.
  for (const mode of ['browser', 'canvas', 'site-admin', 'embedded']) {
    reset(); f = form(); f.edit('school', 'one.test'); f.method(mode);
    for (const lang of ['en', 'fr', 'ar']) {
      const t = locale(lang); f.render();
      const options = nodes(f.tree, 'OptionGroup').flatMap(n => n.props.options);
      for (const option of options) { assert.equal(option.label, t('authForms.method.' + option.value + '.label')); assert.equal(option.subtitle, t('authForms.method.' + option.value + '.hint')); }
    }
    f.submit(); await tick(); f.render();
    equal(calls.find(c => c[0] === 'create')[3], { mode, forceLogin: false });
    if (mode === 'embedded') { one(f.tree, 'EmbeddedSignIn').onFinish('easel://oauth/callback?code=inert'); await tick(); }
    assert.equal(count('save'), 1); f.m.unmount();
  }
  // Duplicate pre-render submissions, raw token arguments, pending locale and original save ordering.
  reset(); const tokenGate = deferred(); behavior.verifyToken = () => tokenGate.promise;
  f = form({ onSignedIn: a => calls.push(['signed', a]) }); f.edit('school', 'one.test'); f.method('token'); f.edit('token', ' inert-dummy-token ');
  f.submit(); f.submit(); assert.equal(count('verifyToken'), 1); equal(calls.find(c => c[0] === 'verifyToken').slice(1), ['one.test', ' inert-dummy-token ']);
  locale('fr'); f.render(); equal(f.field('token').value, ' inert-dummy-token '); tokenGate.resolve(result); await tick(); f.render();
  equal(names(), ['verifyToken', 'terms', 'save', 'success', 'signed']); saveOptions(undefined); f.m.unmount();

  // The save guard stays tied to the original operation after a newer form starts work.
  reset(); const firstSave = deferred(), secondSave = deferred(); let saves = 0;
  behavior.save = () => ++saves === 1 ? firstSave.promise : secondSave.promise;
  f = form({ onSignedIn: () => calls.push(['signed']) }); f.edit('school', 'one.test'); f.submit(); await tick();
  saveOptions(undefined); const original = calls.find(c => c[0] === 'save')[2].current;
  assert.equal(original(), true); locale('fr'); f.render(); assert.equal(original(), true);
  f.edit('school', 'replacement.test'); f.submit(); await tick();
  const replacement = calls.filter(c => c[0] === 'save')[1][2].current;
  assert.equal(replacement, operations.at(-1).current); assert.equal(replacement(), true); assert.equal(original(), false);
  firstSave.resolve(result.account); await tick(); assert.equal(count('success'), 0); assert.equal(count('signed'), 0);
  secondSave.reject(new ObsoleteSignInError()); await tick(); f.render();
  assert.equal(count('error'), 0); assert.equal(count('success'), 0); assert.equal(count('signed'), 0); assert.equal(nodes(f.tree, 'Callout').length, 0); f.m.unmount();

  // A still-current form can lose session admission; consume that local result on both save paths.
  for (const termsRequired of [false, true]) {
    reset(); behavior.terms = async () => termsRequired;
    behavior.save = async (_pending, options) => { assert.equal(options.current(), true); throw new ObsoleteSignInError(); };
    f = form({ onSignedIn: () => calls.push(['signed']) }); f.edit('school', 'one.test'); f.submit(); await tick(); f.render();
    if (termsRequired) { await one(f.tree, 'TermsStep').onAccept(); await tick(); f.render(); }
    assert.equal(count('save'), 1); saveOptions(undefined);
    assert.equal(count('error'), 0); assert.equal(count('success'), 0); assert.equal(count('signed'), 0);
    assert.equal(count('discard'), 0); assert.equal(nodes(f.tree, 'Callout').length, 0); f.m.unmount();
  }

  // OAuth contracts: selected authentication provider, trimmed manual key and forced-login fallback.
  reset(); let attempts = 0; behavior.authorize = async () => ++attempts === 1 ? 'easel://oauth/callback?error=unsupported_prompt_type' : 'easel://oauth/callback?code=inert';
  f = form({ addingAccount: true }); f.edit('school', 'school'); one(f.tree, 'ListItem').onPress(); f.render(); f.method('key'); f.edit('clientId', ' inert-id '); f.edit('clientSecret', ' inert-dummy-secret ');
  f.submit(); await tick();
  equal(names(), ['check', 'create', 'authorize', 'create', 'authorize', 'code', 'exchange', 'verifyOAuth', 'terms', 'save', 'success']);
  const creations = calls.filter(c => c[0] === 'create'); equal(creations[0][1], { host: 'selected.test', baseUrl: 'https://selected.test' });
  equal(creations[0][2], { clientId: 'inert-id', clientSecret: 'inert-dummy-secret' });
  equal(creations[0][3], { mode: 'browser', authenticationProvider: 'saml', forceLogin: true }); equal(creations[1][3], { mode: 'browser', authenticationProvider: 'saml', forceLogin: false });
  const request = calls.find(c => c[0] === 'exchange')[1]; equal(calls.find(c => c[0] === 'code')[2], request); equal(calls.find(c => c[0] === 'verifyOAuth').slice(1, 4), [request.host, { access_token: 'inert-response' }, request.key]); assert.equal(typeof calls.find(c => c[0] === 'verifyOAuth')[4].source.capture, 'function'); f.m.unmount();

  // A public manual key still sends null for a blank secret; an open sheet relabels in place.
  reset(); f = form(); f.edit('school', 'one.test');
  one(f.tree, 'Button', p => p.variant === 'ghost').onPress(); f.render();
  for (const lang of ['en', 'fr', 'ar']) { locale(lang); f.render(); assert.equal(one(f.tree, 'Sheet').visible, true); }
  f.method('key'); f.edit('clientId', ' inert-public-id '); f.edit('clientSecret', '  '); f.submit(); await tick();
  equal(calls.find(c => c[0] === 'create')[2], { clientId: 'inert-public-id', clientSecret: null }); f.m.unmount();

  // Retire at every awaited stage: no later stage, stale presentation or navigation.
  for (const stageName of ['check', 'create', 'authorize', 'exchange', 'verifyOAuth', 'terms', 'save', 'verifyToken']) {
    reset(); const gate = deferred(); behavior[stageName] = () => gate.promise;
    f = form({ onSignedIn: () => calls.push(['signed']) }); f.edit('school', 'one.test');
    if (stageName === 'verifyToken') { f.method('token'); f.edit('token', 'inert-dummy-token'); }
    f.submit(); await tick(); assert.equal(count(stageName), 1); f.render();
    f.edit('school', 'replacement.test'); const before = names();
    gate.resolve(stageName === 'create' ? { embedded: false } : stageName === 'authorize' ? 'easel://oauth/callback?code=inert' : stageName === 'terms' ? false : result);
    await tick(); f.render(); equal(names(), before, 'Retired stage: ' + stageName); assert.equal(nodes(f.tree, 'Callout').length, 0); f.m.unmount();
  }
  // Rejected retired operation, unmount, and abandoned render do not replace committed eligibility.
  reset(); let gate = deferred(); behavior.check = () => gate.promise; f = form(); f.edit('school', 'one.test'); f.submit(); await tick(); f.m.unmount(); gate.reject(new Error('synthetic')); await tick();
  reset(); gate = deferred(); behavior.verifyToken = () => gate.promise; f = form(); f.edit('school', 'one.test'); f.method('token'); f.edit('token', 'inert-dummy'); f.submit();
  f.props = { expired: account('replacement') }; f.m.renderOnly(); f.m.abandon(); f.props = {}; gate.resolve(result); await tick(); f.render(); assert.equal(count('save'), 1); f.m.unmount();

  // Explicit local errors relabel; shared SignInError messages remain verbatim, even English-looking ones.
  for (const error of [new SignInCanceled(), new Error('synthetic'), new SignInError('Something went wrong. Try again.')]) {
    reset(); behavior.check = async () => { throw error; }; f = form(); f.edit('school', 'one.test'); f.submit(); await tick();
    for (const lang of ['en', 'fr', 'ar']) {
      const t = locale(lang); f.render(); const callout = one(f.tree, 'Callout');
      assert.equal(callout.children, error instanceof SignInError ? error.message : t(error instanceof SignInCanceled ? 'authForms.canceledHelp' : 'authForms.failedHelp'));
    }
    f.m.unmount();
  }
  reset(); registeredKey = null; f = form(); f.edit('school', 'one.test'); f.submit(); await tick(); locale('fr'); f.render();
  assert.ok(f.field('token')); assert.equal(one(f.tree, 'Callout').children, runtime.createTranslator('fr')('authForms.noKey', { host: 'one.test' })); assert.equal(count('check'), 0); f.m.unmount();

  // Stored key lookups: old account and unmounted replies cannot supply replacement credentials.
  reset(); const oldKey = deferred(), newKey = deferred(); behavior.stored = id => id === 'old' ? oldKey.promise : newKey.promise;
  f = form({ expired: account('old', 'oauth') }); locale('fr'); f.render(); assert.equal(count('stored'), 1);
  f.props = { expired: account('new', 'oauth') }; f.render(); newKey.resolve({ clientId: 'new-inert', clientSecret: null }); await tick(); f.render(); oldKey.resolve({ clientId: 'old-inert', clientSecret: null }); await tick(); f.render();
  result = pending(account('new', 'oauth')); f.submit(); await tick(); equal(calls.find(c => c[0] === 'create')[2], { clientId: 'new-inert', clientSecret: null }); saveOptions('new'); f.m.unmount();

  // Embedded cancellation and request-specific callback ownership across a replacement method/attempt.
  reset(); f = form(); f.edit('school', 'one.test'); f.method('embedded'); f.submit(); await tick(); f.render(); const first = one(f.tree, 'EmbeddedSignIn'); assert.ok(first.request);
  f.method('canvas'); f.method('embedded'); f.submit(); await tick(); f.render(); const second = one(f.tree, 'EmbeddedSignIn'); first.onFinish('easel://oauth/callback?code=stale'); await tick(); assert.equal(count('exchange'), 0);
  second.onFinish(null); await tick(); f.render(); assert.equal(one(f.tree, 'Callout').title, runtime.createTranslator('en')('authForms.canceled')); f.m.unmount();

  // Terms callbacks own exactly their pending result, survive locale changes and synchronously lock both actions.
  reset(); behavior.terms = async () => true; gate = deferred(); behavior.accept = () => gate.promise;
  f = form(); f.edit('school', 'one.test'); f.method('token'); f.edit('token', 'inert'); f.submit(); await tick(); f.render(); const terms = one(f.tree, 'TermsStep');
  equal(terms.pending, result); locale('ar'); f.render(); equal(one(f.tree, 'TermsStep').pending, result);
  const accepted = terms.onAccept(); await terms.onDecline(); await terms.onAccept(); assert.equal(count('accept'), 1); assert.equal(count('discard'), 0);
  gate.resolve(); await accepted; await tick(); assert.equal(count('save'), 1); await terms.onAccept(); assert.equal(count('save'), 1); f.m.unmount();
  reset(); behavior.terms = async () => true; f = form(); f.edit('school', 'one.test'); f.method('token'); f.edit('token', 'inert'); f.submit(); await tick(); f.render(); const decline = one(f.tree, 'TermsStep');
  await decline.onDecline(); f.render(); assert.equal(count('discard'), 1); locale('fr'); f.render(); assert.equal(one(f.tree, 'Callout').children, runtime.createTranslator('fr')('authForms.termsRequired', { host: result.account.host })); await decline.onAccept(); assert.equal(count('accept'), 0); f.m.unmount();
  // Acceptance already entered cannot be undone; retiring it prevents the later save.
  reset(); behavior.terms = async () => true; gate = deferred(); behavior.accept = () => gate.promise;
  f = form(); f.edit('school', 'one.test'); f.method('token'); f.edit('token', 'inert'); f.submit(); await tick(); f.render(); const action = one(f.tree, 'TermsStep').onAccept(); f.m.unmount(); gate.resolve(); await action; assert.equal(count('save'), 0);
  // Failed acceptance remains retryable; a retired terms callback cannot begin acceptance.
  reset(); behavior.terms = async () => true; behavior.accept = async () => { throw Error('synthetic'); };
  f = form(); f.edit('school', 'one.test'); f.method('token'); f.edit('token', 'inert'); f.submit(); await tick(); f.render();
  const retryTerms = one(f.tree, 'TermsStep'); await assert.rejects(retryTerms.onAccept()); assert.equal(count('save'), 0);
  behavior.accept = async () => { }; await retryTerms.onAccept(); assert.equal(count('save'), 1); f.m.unmount();
  reset(); behavior.terms = async () => true; f = form(); f.edit('school', 'one.test'); f.method('token'); f.edit('token', 'inert'); f.submit(); await tick(); f.render();
  const retiredTerms = one(f.tree, 'TermsStep'); f.props = { expired: account('replacement') }; f.render();
  await retiredTerms.onAccept(); await retiredTerms.onDecline(); assert.equal(count('accept'), 0); assert.equal(count('discard'), 0); f.m.unmount();
  // A retired rejection is swallowed at the owned callback, so TermsStep cannot publish it.
  reset(); behavior.terms = async () => true; gate = deferred(); behavior.accept = () => gate.promise;
  f = form(); f.edit('school', 'one.test'); f.method('token'); f.edit('token', 'inert'); f.submit(); await tick(); f.render();
  const rejectedAccept = one(f.tree, 'TermsStep').onAccept(); f.m.unmount(); gate.reject(Error('synthetic')); await rejectedAccept; assert.equal(count('save'), 0);
  // Original mismatch cleanup still completes; shared error provenance stays raw.
  reset(); result = pending(account('different', 'oauth')); f = form({ expired: account('expected', 'oauth') }); f.submit(); await tick(); f.render(); equal(names().filter(n => n !== 'stored' && n !== 'key'), ['check', 'create', 'authorize', 'code', 'exchange', 'verifyOAuth', 'discard', 'error']); assert.equal(one(f.tree, 'Callout').children, 'RAW shared identity error'); f.m.unmount();

  // TokenHelp: repeated taps coalesce, rejection relabels, URL changes and unmount reject old callbacks.
  reset(); gate = deferred(); behavior.open = () => gate.promise; let url = 'https://one.test'; let help = mount(() => TokenHelp({ baseUrl: url })); let tree = help.render(); const open = one(tree, 'Button').onPress; const opening = open(); open(); assert.equal(count('open'), 1);
  locale('ar'); tree = help.render(); assert.equal(one(tree, 'Button').children, runtime.createTranslator('ar')('authForms.openSettings')); gate.reject(Error('synthetic')); await opening; tree = help.render(); assert.ok(nodes(tree, 'Text').some(n => n.props.children === runtime.createTranslator('ar')('authForms.openFailed')));
  gate = deferred(); const next = one(tree, 'Button').onPress(); url = 'https://two.test'; tree = help.render(); open(); assert.equal(count('open'), 2); gate.reject(Error('synthetic')); await next; tree = help.render(); assert.equal(nodes(tree, 'Text').length, 3); behavior.open = async () => ({ type: 'opened' }); await one(tree, 'Button').onPress(); equal(calls.at(-1), ['open', 'https://two.test/profile/settings']); const oldOpen = one(tree, 'Button').onPress; help.unmount(); await oldOpen(); assert.equal(count('open'), 3);

  // Routes execute production callbacks against synthetic session/navigation boundaries.
  reset(); let route = mount(() => AddAccountScreen()); tree = route.render(); const signed = tree.props.onSignedIn; signed(account()); signed(account()); assert.equal(count('back'), 1); route.unmount(); signed(account()); assert.equal(count('back'), 1);
  reset(); route = mount(() => AddAccountScreen()); const retired = route.render().props.onSignedIn; route.unmount(); retired(account()); assert.equal(count('back'), 0);
  reset(); session.active = account('expired'); session.accounts = [session.active, { ...account('other'), expired: false }]; route = mount(() => SignInScreen()); tree = route.render();
  const switchRow = one(tree, 'ListItem', p => p.title === 'RAW other'); const removeRow = one(tree, 'ListItem', p => p.destructive); removeRow.onPress(); const oldConfirm = confirmation;
  gate = deferred(); behavior.switch = () => gate.promise; const switching = switchRow.onPress(); switchRow.onPress(); assert.equal(count('switch'), 1); gate.resolve(); await switching;
  locale('fr'); tree = route.render(); assert.equal(one(tree, 'ListItem', p => p.destructive).title, runtime.createTranslator('fr')('authForms.remove', { name: 'RAW expired' }));
  session.active = account('replacement'); session.accounts = [session.active]; route.render(); await oldConfirm[1](oldConfirm[0].id); await switchRow.onPress(); removeRow.onPress(); assert.equal(count('remove'), 0); assert.equal(count('switch'), 1); route.unmount();
  console.log('Auth forms: production forms/routes/lifetime; synthetic hooks, school/auth/terms/session/browser boundaries; historical values preserved; TZ=' + (process.env.TZ || 'default'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
