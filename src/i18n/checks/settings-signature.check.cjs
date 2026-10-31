/* global __dirname */
// Executes the signature route, lifetime helper and real Canvas serializer with synthetic boundaries.
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
const depsEqual = (a, b) =>
  a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
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
const { QueryClient, MutationObserver } = require('@tanstack/query-core');
const queryClient = new QueryClient({
  defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
});
const calls = {
  requests: [],
  cache: [],
  alerts: [],
  success: [],
  error: [],
  back: [],
  allow: [],
  repeat: [],
  retry: [],
};
let requests = [],
  online = true,
  focused = true,
  locale = 'en',
  prevention;
const makeClient = (id) => ({
  request: (...args) => {
    calls.requests.push([id, ...args]);
    assert.ok(requests.length, 'unexpected transport entry');
    return Promise.resolve(requests.shift());
  },
});
const settings = () => ({
  useSignature: true,
  signature: 'Save',
  useOutOfOffice: true,
  outOfOfficeFirstDate: '2030-01-02',
  outOfOfficeLastDate: null,
  outOfOfficeSubject: 'Preview',
  outOfOfficeMessage: '<p>Raw Arabic العربية</p>',
});
const data = () => ({ available: true, enabled: true, text: 'Save', settings: settings() });
let env, query;
function reset() {
  for (const a of Object.values(calls)) a.length = 0;
  requests = [];
  online = true;
  focused = true;
  locale = 'en';
  prevention = null;
  env = { account: { id: 'a', user: { id: 'student' } }, client: makeClient('a') };
  query = {
    data: data(),
    isError: false,
    isPending: false,
    error: null,
    refetch: async () => {
      calls.retry.push(true);
    },
  };
}
const navigation = { isFocused: () => focused };
const design = Object.fromEntries(
  [
    'Button',
    'Callout',
    'Card',
    'EmptyState',
    'ListGroup',
    'ListItem',
    'Screen',
    'Skeleton',
    'Switch',
    'Text',
    'TextField',
  ].map((k) => [k, k]),
);
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'View', Alert: { alert: (...a) => calls.alerts.push(a) } },
  'lucide-react-native': { Signature: 'Signature' },
  'expo-router': {
    Stack: { Screen: 'Stack.Screen' },
    router: { back: () => calls.back.push(true) },
    useNavigation: () => navigation,
    useIsFocused: () => focused,
    usePreventRemove(dirty, callback) {
      react.useLayoutEffect(() => {
        prevention = { dirty, callback };
        return () => {
          prevention = null;
        };
      }, [dirty, callback]);
      return () => calls.allow.push(true);
    },
  },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/client': { CanvasError: class extends Error {} },
  '@tanstack/react-query': {
    useQueryClient: () => ({
      invalidateQueries: (...a) => {
        calls.cache.push(a);
      },
    }),
  },
  '@/canvas/query': {
    useAccountKey: () => env.account.id,
    useCanvasQuery: () => query,
    // Real installed observer; simulated useMutation lifecycle and connectivity.
    useCanvasMutation(fn, options) {
      const client = env.client;
      const opts = {
        mutationFn: (v) => {
          assert.ok(online);
          return fn(client, v);
        },
        ...options,
      };
      const [observer] = react.useState(() => new MutationObserver(queryClient, opts));
      react.useEffect(() => {
        observer.setOptions(opts);
      });
      return { mutateAsync: observer.mutate, reset: observer.reset };
    },
  },
  '@/features/offline/connectivity': { isOnline: () => online },
  '@/features/offline/useOnline': { useOnline: () => online },
  '@/design': {
    ...design,
    haptics: { success: () => calls.success.push(true), error: () => calls.error.push(true) },
  },
  '@/i18n': {
    useTranslation: () => ({ locale, t: runtime.createTranslator(locale) }),
    formatNumber: (...a) => runtime.formatNumber(...a),
  },
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
const SignatureScreen = load('@/app/(app)/signature').default;
const api = load('@/canvas/api/conversations');
function nodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap((v) => nodes(v, type));
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree.props] : []), ...nodes(tree.props.children, type)];
}
const first = (h, type) => nodes(h.tree, type)[0];
const field = (h) => first(h, 'TextField');
const header = (h) =>
  nodes(h.tree, 'Stack.Screen')
    .find((n) => n.options.headerRight)
    ?.options.headerRight().props;
const toggle = (h) => first(h, 'ListItem');
const mounted = () => {
  const h = mount(() => jsx(SignatureScreen, {}));
  h.render();
  return h;
};
const edit = (h, text = '  Draft \nالعربية 😀  ') => {
  field(h).onChangeText(text);
  h.render();
};
const leave = () => {
  assert.ok(prevention.dirty);
  prevention.callback({ repeat: () => calls.repeat.push(true) });
};
const alertButton = (index = 1) => calls.alerts.at(-1)[2][index].onPress;
const ok = () => ({ data: { updateMyInboxSettings: { myInboxSettings: settings() } } });
async function main() {
  const baseline = require('./settings-signature.baseline.json');
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2859);
    for (const [key, hash] of Object.entries(baseline.catalogs[lang])) {
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
        hash,
        lang + '/' + key,
      );
    }
    assert.equal(Object.keys(catalog).filter((k) => k.startsWith('settingsSignature.')).length, 21);
  }
  // Existing trim/dirty semantics, UTF-16 count/limit, raw English collisions.
  reset();
  let h = mounted();
  assert.equal(field(h).value, 'Save');
  assert.equal(header(h).disabled, true);
  edit(h, '  Save \n');
  assert.equal(prevention.dirty, false);
  edit(h);
  leave();
  const keptConfirmation = alertButton();
  const raw = field(h).value;
  for (const lang of ['fr', 'ar', 'en']) {
    locale = lang;
    h.render();
    const t = runtime.createTranslator(lang);
    assert.equal(field(h).value, raw);
    assert.equal(toggle(h).accessibilityState.checked, true);
    assert.equal(header(h).children, t('settingsSignature.save'));
    assert.equal(
      field(h).helperText,
      t('settingsSignature.count', {
        used: new Intl.NumberFormat(lang).format(raw.length),
        max: new Intl.NumberFormat(lang).format(255),
      }),
    );
    assert.equal(field(h).maxLength, api.SIGNATURE_MAX);
    assert.ok(nodes(h.tree, 'Text').some((n) => n.children === raw.trim()));
    assert.equal(calls.alerts.length, 1, 'locale does not recreate an open native alert');
  }
  keptConfirmation();
  keptConfirmation();
  h.render();
  assert.equal(calls.repeat.length, 1);
  assert.equal(prevention.dirty, false);
  assert.equal(calls.allow.length, 0);
  h.unmount();
  // Empty enabled signatures invalid; disabled empty signatures are valid.
  reset();
  h = mounted();
  edit(h, ' \n');
  assert.ok(field(h).error);
  await header(h).onPress();
  assert.equal(calls.requests.length, 0);
  toggle(h).onPress();
  h.render();
  assert.equal(field(h).error, null);
  requests.push(ok());
  await header(h).onPress();
  assert.equal(calls.requests[0][2].body.variables.signature, '');
  assert.equal(calls.requests[0][2].body.variables.useSignature, false);
  h.unmount();
  // Production GraphQL serialization, settings preservation, synchronous coalescing,
  // keyboard/save collisions, and pending toggle/edit callbacks.
  reset();
  h = mounted();
  edit(h, '  ' + '😀'.repeat(130) + '  ');
  const before = settings();
  const d = deferred();
  requests.push(d.promise);
  const press = header(h).onPress,
    keyboard = field(h).onSubmitEditing;
  const write = press();
  keyboard();
  press();
  field(h).onChangeText('must not enter');
  toggle(h).onPress();
  await flush();
  h.render();
  assert.equal(calls.requests.length, 1);
  assert.equal(header(h).loading, true);
  const [account, url, options] = calls.requests[0];
  assert.equal(account, 'a');
  assert.equal(url, '/api/graphql');
  assert.equal(options.method, 'POST');
  assert.equal(options.body.operationName, 'EaselUpdateInboxSettings');
  assert.match(options.body.query, /updateMyInboxSettings/);
  assert.deepEqual(options.body.variables, {
    ...before,
    useSignature: true,
    signature: '😀'.repeat(130).slice(0, 255),
  });
  assert.deepEqual(query.data.settings, before);
  assert.equal(field(h).value, '  ' + '😀'.repeat(130) + '  ');
  locale = 'ar';
  h.render();
  d.resolve(ok());
  await write;
  h.render();
  assert.equal(calls.success.length, 1);
  assert.equal(calls.back.length, 1);
  assert.equal(calls.allow.length, 1);
  assert.equal(prevention.dirty, false);
  await press();
  await keyboard();
  assert.equal(calls.requests.length, 1);
  h.unmount();
  // Current server errors stay raw across locale changes; retry retains the draft.
  reset();
  h = mounted();
  edit(h, 'Your message');
  requests.push({ data: { updateMyInboxSettings: { errors: [{ message: 'Save' }] } } });
  await header(h).onPress();
  h.render();
  assert.equal(calls.error.length, 1);
  locale = 'fr';
  h.render();
  assert.equal(first(h, 'Callout').children, 'Save');
  assert.equal(field(h).value, 'Your message');
  requests.push(ok());
  await header(h).onPress();
  assert.equal(calls.back.length, 1);
  h.unmount();
  // Input arriving before rerender must be the exact draft written by a retained header.
  reset();
  h = mounted();
  const savedHeader = header(h).onPress;
  field(h).onChangeText('latest before render');
  requests.push(ok());
  await savedHeader();
  assert.equal(calls.requests[0][2].body.variables.signature, 'latest before render');
  h.unmount();
  // Discard cancellation, dismissal, replacement, changed drafts and replay.
  reset();
  h = mounted();
  edit(h);
  leave();
  const cancelled = alertButton();
  alertButton(0)();
  cancelled();
  assert.equal(calls.repeat.length, 0);
  leave();
  const dismissed = alertButton();
  calls.alerts.at(-1)[3].onDismiss();
  dismissed();
  assert.equal(calls.repeat.length, 0);
  leave();
  const changed = alertButton();
  field(h).onChangeText('newer');
  changed();
  assert.equal(calls.repeat.length, 0);
  h.render();
  leave();
  const old = alertButton();
  leave();
  assert.equal(calls.alerts.length, 4, 'duplicate back is coalesced');
  const d2 = deferred();
  requests.push(d2.promise);
  const w2 = header(h).onPress();
  old();
  assert.equal(calls.repeat.length, 0);
  leave();
  const discardPending = alertButton();
  discardPending();
  discardPending();
  d2.resolve(ok());
  await w2;
  h.render();
  assert.equal(calls.repeat.length, 1);
  assert.equal(calls.back.length, 0);
  assert.equal(calls.success.length, 0);
  h.unmount();
  // Cached drafts still require a discard decision after a query error. Only
  // the old confirmation retires; a fresh current decision must remain usable.
  reset();
  h = mounted();
  edit(h);
  leave();
  const beforeQueryError = alertButton();
  query = { ...query, isError: true, error: Error('Refresh failed') };
  h.render();
  assert.equal(prevention.dirty, true, 'query failure must not silently discard a draft');
  assert.equal(header(h).disabled, true);
  beforeQueryError();
  assert.equal(calls.repeat.length, 0);
  leave();
  alertButton(0)();
  assert.equal(field(h).value, '  Draft \nالعربية 😀  ');
  leave();
  const currentDiscard = alertButton();
  currentDiscard();
  currentDiscard();
  assert.equal(calls.repeat.length, 1, 'current error-state discard remains one-use');
  h.unmount();
  // Each committed transition retires retained save/input/toggle/discard callbacks.
  for (const transition of [
    'focus',
    'error',
    'pending',
    'unavailable',
    'account',
    'user',
    'client',
    'unmount',
  ]) {
    reset();
    h = mounted();
    edit(h);
    leave();
    const callbacks = [
      header(h).onPress,
      field(h).onSubmitEditing,
      () => fieldBefore.onChangeText('stale'),
      toggle(h).onPress,
      alertButton(),
    ];
    const fieldBefore = field(h);
    if (transition === 'focus') focused = false;
    if (transition === 'error') query = { ...query, isError: true, error: Error('Raw failure') };
    if (transition === 'pending') query = { ...query, isPending: true };
    if (transition === 'unavailable') query = { ...query, data: { available: false } };
    if (transition === 'account') env = { ...env, account: { ...env.account, id: 'b' } };
    if (transition === 'user') env = { ...env, account: { ...env.account, user: { id: 'other' } } };
    if (transition === 'client') env = { ...env, client: makeClient('replacement') };
    if (transition === 'unmount') h.unmount();
    else h.render();
    for (const f of callbacks) await f();
    assert.equal(calls.requests.length, 0, transition);
    assert.equal(calls.repeat.length, 0, transition);
    if (['error', 'pending'].includes(transition)) assert.equal(prevention.dirty, true);
    if (['focus', 'error', 'pending'].includes(transition))
      assert.equal(field(h).value, '  Draft \nالعربية 😀  ', transition);
    if (['account', 'user', 'client'].includes(transition))
      assert.equal(field(h).value, 'Save', transition);
    h.unmount();
  }
  // Retired completions cannot navigate, haptic, erase a later draft or retarget
  // the API's original-account invalidation. Both success and failure are tested.
  for (const transition of ['focus', 'error', 'account', 'client', 'unmount', 'replay']) {
    for (const fail of [false, true]) {
      reset();
      h = mounted();
      edit(h);
      const pending = deferred();
      requests.push(pending.promise);
      const w = header(h).onPress();
      await flush();
      if (transition === 'focus') {
        focused = false;
        h.render();
        focused = true;
      }
      if (transition === 'error') {
        query = { ...query, isError: true, error: Error('failed') };
        h.render();
        query = { ...query, isError: false, error: null };
      }
      if (transition === 'account') env = { ...env, account: { ...env.account, id: 'b' } };
      if (transition === 'client') env = { ...env, client: makeClient('replacement') };
      if (transition === 'unmount') h.unmount();
      else {
        if (transition === 'replay') h.replay();
        h.render();
        edit(h, 'later draft');
      }
      if (fail) pending.reject(Error('stale failure'));
      else pending.resolve(ok());
      await w;
      assert.equal(calls.back.length, 0, transition);
      assert.equal(calls.success.length, 0, transition);
      assert.equal(calls.error.length, 0, transition);
      if (!fail)
        assert.deepEqual(calls.cache, [[{ queryKey: ['a', 'inbox', 'signature'] }]], transition);
      if (transition !== 'unmount') {
        h.render();
        assert.equal(field(h).value, 'later draft');
      }
      h.unmount();
    }
  }
  // A retired save completing while a newer save is pending cannot clear its
  // busy claim, consume a confirmation, or navigate away from the newer form.
  reset();
  h = mounted();
  edit(h, 'older');
  const older = deferred();
  requests.push(older.promise);
  const olderWrite = header(h).onPress();
  await flush();
  focused = false;
  h.render();
  focused = true;
  h.render();
  edit(h, 'newer');
  const newer = deferred();
  requests.push(newer.promise);
  const newerWrite = header(h).onPress();
  await flush();
  h.render();
  older.resolve(ok());
  await olderWrite;
  h.render();
  assert.equal(header(h).loading, true);
  assert.equal(calls.back.length, 0);
  await header(h).onPress();
  assert.equal(calls.requests.length, 2);
  newer.resolve(ok());
  await newerWrite;
  assert.equal(calls.back.length, 1);
  assert.equal(calls.success.length, 1);
  h.unmount();
  // Focus loss and effect replay permanently retire an already-open discard.
  for (const mode of ['focus', 'replay']) {
    reset();
    h = mounted();
    edit(h);
    leave();
    const oldDiscard = alertButton();
    if (mode === 'focus') {
      focused = false;
      h.render();
      focused = true;
      h.render();
    } else h.replay();
    oldDiscard();
    assert.equal(calls.repeat.length, 0, mode);
    h.unmount();
  }
  // Query updates keep same-account drafts but send the newest settings snapshot.
  reset();
  h = mounted();
  edit(h, 'unsaved');
  const previousSave = header(h).onPress;
  query = {
    ...query,
    data: {
      ...data(),
      text: 'from server',
      settings: { ...settings(), outOfOfficeSubject: 'new raw subject' },
    },
  };
  h.render();
  assert.equal(field(h).value, 'unsaved');
  requests.push(ok());
  await previousSave();
  assert.equal(calls.requests[0][2].body.variables.outOfOfficeSubject, 'new raw subject');
  h.unmount();
  // The save hook's own successful invalidation may publish new query data
  // before mutateAsync resolves; that is the same signature, not a new resource.
  reset();
  h = mounted();
  edit(h, 'saved value');
  const invalidated = deferred();
  requests.push(invalidated.promise);
  const saved = header(h).onPress();
  await flush();
  query = {
    ...query,
    data: { ...data(), text: 'saved value', settings: { ...settings(), signature: 'saved value' } },
  };
  h.render();
  invalidated.resolve(ok());
  await saved;
  h.render();
  assert.equal(calls.back.length, 1);
  assert.equal(calls.success.length, 1);
  assert.equal(prevention.dirty, false);
  h.unmount();
  // Offline input remains editable; live connectivity closes entry even before commit.
  reset();
  h = mounted();
  edit(h);
  const retained = header(h).onPress;
  online = false;
  await retained();
  assert.equal(calls.requests.length, 0);
  h.render();
  edit(h, 'offline draft');
  assert.equal(field(h).value, 'offline draft');
  assert.equal(header(h).disabled, true);
  online = true;
  h.render();
  requests.push(ok());
  await header(h).onPress();
  assert.equal(calls.back.length, 1);
  h.unmount();
  // Failed query is fail-closed despite cached data; retry coalesces and retired
  // retry callbacks do not enter transport after recovery, focus or replacement.
  reset();
  query = { ...query, isError: true, error: Error('Your message') };
  h = mounted();
  assert.equal(first(h, 'Callout').children, 'Your message');
  assert.equal(field(h).editable, false);
  const retry = first(h, 'Callout').action.onPress;
  const refetch = deferred();
  query.refetch = () => {
    calls.retry.push(true);
    return refetch.promise;
  };
  h.render();
  const repeatRetry = first(h, 'Callout').action.onPress;
  const r = repeatRetry();
  repeatRetry();
  assert.equal(calls.retry.length, 1);
  refetch.reject(Error('query boundary'));
  await r;
  query = { ...query, isError: false, error: null };
  h.render();
  await retry();
  await repeatRetry();
  assert.equal(calls.retry.length, 1);
  h.unmount();
  for (const transition of ['focus', 'account', 'client', 'unmount']) {
    reset();
    query = { ...query, isError: true, error: Error('failed') };
    h = mounted();
    const retry = first(h, 'Callout').action.onPress;
    if (transition === 'focus') focused = false;
    if (transition === 'account') env = { ...env, account: { ...env.account, id: 'b' } };
    if (transition === 'client') env = { ...env, client: makeClient('replacement') };
    if (transition === 'unmount') h.unmount();
    else h.render();
    await retry();
    assert.equal(calls.retry.length, 0, transition);
    h.unmount();
  }
  // A discarded render cannot retire callbacks or mutate draft state. Commit-only
  // ownership also rejects handlers captured from the speculative replacement.
  reset();
  h = mounted();
  edit(h);
  leave();
  const committedDiscard = alertButton();
  const original = query;
  query = { ...query, isError: true, error: Error('speculative') };
  const abandoned = h.renderOnly();
  const abandonedSave = nodes(abandoned, 'Stack.Screen')
    .find((n) => n.options.headerRight)
    .options.headerRight().props.onPress;
  h.abandon();
  query = original;
  await abandonedSave();
  assert.equal(calls.requests.length, 0);
  committedDiscard();
  assert.equal(calls.repeat.length, 1);
  h.unmount();
  // Loading and unavailable copy has a translation; no writable form is exposed.
  for (const lang of ['en', 'fr', 'ar']) {
    reset();
    locale = lang;
    query = { ...query, data: undefined, isPending: true };
    h = mounted();
    assert.equal(field(h), undefined);
    assert.ok(
      nodes(h.tree, 'View').some(
        (n) => n.accessibilityLabel === runtime.createTranslator(lang)('settingsSignature.loading'),
      ),
    );
    query = { ...query, isPending: false, data: { available: false } };
    h.render();
    assert.equal(
      first(h, 'EmptyState').title,
      runtime.createTranslator(lang)('settingsSignature.unavailable'),
    );
    assert.equal(header(h), undefined);
    h.unmount();
  }
  console.log(
    'PASS signature route/serializer/installed mutation observer: locale/raw/count, save/discard/retry, committed lifetime, 2859 historical hashes; TZ=' +
      process.env.TZ,
  );
  console.log(
    'Synthetic React hooks, navigation, Alert, query, session and transport; no native/storage/HTTP/Compiler acceptance.',
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => queryClient.clear());
