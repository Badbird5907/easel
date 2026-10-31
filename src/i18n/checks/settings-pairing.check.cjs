/* global __dirname */
// Executes production pairing route/owner/API with synthetic platform and transport boundaries.
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
// Deterministic clock for production dates; no native timers are entered.
class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : ['2026-11-03T23:20:00Z']));
  }
  static now() {
    return new Date('2026-11-03T23:20:00Z').getTime();
  }
}
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
react.useSyncExternalStore = (subscribe, getSnapshot) => {
  const h = scope.host;
  react.useLayoutEffect(
    () =>
      subscribe(() => {
        h.dirty = true;
      }),
    [subscribe],
  );
  return getSnapshot();
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
const calls = { post: [], get: [], copy: [], share: [], haptics: [], refetch: [] };
const queues = { post: [], get: [], copy: [], share: [], refetch: [] };
function boundary(kind, args) {
  calls[kind].push(args);
  assert.ok(queues[kind].length, 'Unexpected synthetic boundary: ' + kind);
  return Promise.resolve(queues[kind].shift());
}
const makeClient = (id) => ({
  get: (...args) => boundary('get', [id, ...args]),
  post: (...args) => boundary('post', [id, ...args]),
});
let env, online, focused, locale, query, profile;
const navigation = { isFocused: () => focused };
const { QueryClient, MutationObserver } = require('@tanstack/react-query');
const queryClient = new QueryClient({
  defaultOptions: { mutations: { retry: false, networkMode: 'always', gcTime: Infinity } },
});
const design = Object.fromEntries(
  ['Button', 'Callout', 'Card', 'EmptyState', 'Screen', 'Skeleton', 'Text'].map((k) => [k, k]),
);
class CanvasError extends Error {
  constructor(status) {
    super('Synthetic private error');
    this.status = status;
  }
}
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'View', Share: { share: (...args) => boundary('share', args) } },
  'expo-clipboard': { setStringAsync: (...args) => boundary('copy', args) },
  'lucide-react-native': { Copy: 'Copy', RefreshCw: 'RefreshCw', Share2: 'Share2', ShieldOff: 'ShieldOff' },
  'expo-router': {
    Stack: { Screen: 'Stack.Screen' },
    useIsFocused: () => focused,
    useNavigation: () => navigation,
  },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/client': { CanvasError },
  '@/canvas/uploads': {},
  '@tanstack/react-query': {
    useQueryClient: () => {
      throw Error('Unused avatar boundary');
    },
  },
  '@/canvas/query': {
    useCanvasQuery: (key) => (key.includes('pairing') ? query : profile),
    useCanvasMutation(fn) {
      const client = env.client;
      // Installed TanStack observer preserves its real async/options/reset behavior.
      const options = {
        mutationFn: (v) => fn(client, v),
        networkMode: 'always',
        retry: false,
        gcTime: Infinity,
      };
      const observer = react.useMemo(() => new MutationObserver(queryClient, options), []);
      react.useEffect(() => observer.setOptions(options));
      return { mutateAsync: observer.mutate, reset: observer.reset };
    },
  },
  '@/design': { ...design, haptics: { success: () => calls.haptics.push(true) } },
  '@/features/offline/useOnline': { useOnline: () => online },
  '@/features/settings/QrCode': { QrCode: 'QrCode' },
  '@/i18n': { useTranslation: () => ({ t: runtime.createTranslator(locale), locale }) },
};
function load(file, from = root) {
  if (Object.hasOwn(stubs, file)) return stubs[file];
  let p = file.startsWith('@/') ? path.join(root, file.slice(2)) : path.resolve(from, file);
  if (!path.extname(p)) p += fs.existsSync(p + '.ts') ? '.ts' : '.tsx';
  const alias = '@/' + path.relative(root, p).replace(/\.tsx?$/, '');
  if (Object.hasOwn(stubs, alias)) return stubs[alias];
  assert.ok(
    p.startsWith(root + '/') || p.endsWith('/node_modules/expo/src/hooks/useEvent.ts'),
    'unmocked module: ' + file,
  );
  if (cache.has(p)) return cache.get(p);
  const code = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  cache.set(p, module.exports);
  new Function('require', 'module', 'exports', 'Date', code)(
    (name) => load(name, path.dirname(p)),
    module,
    module.exports,
    FixedDate,
  );
  return module.exports;
}

const runtime = load('@/i18n/runtime');
const dates = load('@/lib/dates');
const api = load('@/canvas/api/profile');
const Route = load('@/app/(app)/observer-pairing').default;
function nodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap((v) => nodes(v, type));
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree.props] : []), ...nodes(tree.props.children, type)];
}
const label = (key, values) => runtime.createTranslator(locale)('settingsPairing.' + key, values);
const button = (h, key) => nodes(h.tree, 'Button').find((p) => p.children === label(key));
const text = (h) => nodes(h.tree, 'Text').map((p) => p.children);
const issued = (code = 'A &/ع?', expires = '2026-11-04T06:30:00Z') => ({
  user_id: 'synthetic',
  code,
  expires_at: expires,
  workflow_state: 'active',
});
function reset() {
  for (const q of Object.values(queues)) assert.equal(q.length, 0, 'Unused synthetic response');
  for (const list of Object.values(calls)) list.length = 0;
  env = { account: { id: 'a', host: 'school.invalid', user: { id: 'synthetic' } }, client: makeClient('a') };
  query = { data: undefined, isError: false, error: null, refetch: () => boundary('refetch', []) };
  profile = { data: { timeZone: 'America/New_York' } };
  online = focused = true;
  locale = 'en';
}
const allow = () => {
  query = { ...query, data: { allowed: true, accountId: '12 &/' }, isError: false, error: null };
};
const mountRoute = () => {
  const h = mount(() => jsx(Route, {}));
  h.render();
  return h;
};
const settle = async (h) => {
  await flush();
  h.render();
  await flush();
  h.render();
};
const startIssued = async () => {
  reset();
  allow();
  queues.post.push(issued());
  const h = mountRoute();
  await settle(h);
  return h;
};
async function main() {
  const baseline = require('./settings-pairing.baseline.json');
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2859);
    for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
        hash,
        lang + '/' + key,
      );
    const own = Object.keys(catalog)
      .filter((k) => k.startsWith('settingsPairing.'))
      .sort();
    assert.equal(own.length, 26);
    assert.deepEqual(
      own,
      Object.keys(load('@/i18n/en').en)
        .filter((k) => k.startsWith('settingsPairing.'))
        .sort(),
    );
  }
  // Read-only availability serializer and original POST/QR contracts.
  reset();
  const signal = new AbortController().signal;
  for (const type of ['all', 'observer', 'student', null, undefined]) {
    queues.get.push({ account_id: 42, self_registration_type: type });
    assert.deepEqual(await api.fetchPairingAvailability(env.client, signal), {
      allowed: ['all', 'observer'].includes(type),
      accountId: '42',
    });
    assert.deepEqual(calls.get.at(-1), ['a', '/api/v1/accounts/self/terms_of_service', undefined, signal]);
  }
  queues.post.push(issued());
  const wire = await api.createPairingCode(env.client);
  assert.equal(wire.code, issued().code);
  assert.equal(wire.expiresAt.toISOString(), new Date(issued().expires_at).toISOString());
  assert.deepEqual(calls.post[0], ['a', '/api/v1/users/self/observer_pairing_codes']);
  assert.equal(
    api.pairingLink('school.invalid', wire.code, '12 &/'),
    'canvas-parent://school.invalid/pair?code=A%20%26%2F%D8%B9%3F&account_id=12%20%26%2F',
  );

  reset();
  let h = mountRoute();
  h.replay();
  await settle(h);
  assert.equal(calls.post.length, 0);
  assert.ok(text(h).includes(label('checking')));
  query = { ...query, data: { allowed: false, accountId: '12' } };
  h.render();
  await settle(h);
  assert.equal(calls.post.length, 0);
  assert.equal(nodes(h.tree, 'EmptyState')[0].title, label('blockedTitle'));
  query = {
    ...query,
    data: { allowed: true, accountId: '12' },
    isError: true,
    error: Error('raw private failure'),
  };
  h.render();
  await settle(h);
  assert.equal(calls.post.length, 0);
  const retry = nodes(h.tree, 'Callout')[0].action.onPress;
  const check = deferred();
  queues.refetch.push(check.promise);
  retry();
  retry();
  assert.equal(calls.refetch.length, 1);
  check.reject(Error('private'));
  await settle(h);
  allow();
  online = false;
  h.render();
  await settle(h);
  assert.equal(calls.post.length, 0);
  online = true;
  const firstCode = deferred();
  queues.post.push(firstCode.promise);
  h.render();
  h.replay();
  await settle(h);
  assert.equal(calls.post.length, 1);
  assert.equal(nodes(h.tree, 'Skeleton').length, 2);
  firstCode.resolve(issued());
  await settle(h);
  assert.ok(button(h, 'copy'));
  const exactLink = nodes(h.tree, 'QrCode')[0].value;
  for (const language of ['fr', 'ar', 'en']) {
    locale = language;
    h.render();
    await settle(h);
    assert.ok(text(h).includes(issued().code));
    assert.equal(nodes(h.tree, 'QrCode')[0].value, exactLink);
    assert.equal(
      nodes(h.tree, 'QrCode')[0].accessibilityLabel,
      label('qrLabel', { code: issued().code.split('').join(' ') }),
    );
    assert.equal(calls.post.length, 1);
    assert.ok(
      text(h).includes(
        label('expires', {
          date: dates.createDateContext(locale, 'America/New_York').dueIn(new Date(issued().expires_at)),
        }),
      ),
    );
  }
  profile.data.timeZone = null;
  h.render();
  assert.ok(text(h).includes(label('expirationUnavailable')));
  profile.data.timeZone = 'Mars/Unknown';
  h.render();
  assert.ok(text(h).includes(label('expirationUnavailable')));
  profile.data.timeZone = 'Asia/Tokyo';
  h.render();
  assert.ok(
    text(h).includes(
      label('expires', {
        date: dates.createDateContext(locale, 'Asia/Tokyo').dueIn(new Date(issued().expires_at)),
      }),
    ),
  );
  online = false;
  h.render();
  online = true;
  h.render();
  await settle(h);
  assert.equal(calls.post.length, 1);

  // Native payloads and duplicate entry; feedback changes language without reissuing.
  let copy = button(h, 'copy').onPress;
  const copying = deferred();
  queues.copy.push(copying.promise);
  copy();
  copy();
  button(h, 'share').onPress();
  assert.equal(calls.copy.length, 1);
  assert.equal(calls.share.length, 0);
  assert.deepEqual(calls.copy[0], [issued().code]);
  locale = 'fr';
  h.render();
  copying.resolve(true);
  await settle(h);
  assert.ok(text(h).includes(label('copied')));
  assert.equal(calls.haptics.length, 1);
  queues.copy.push(false);
  await button(h, 'copy').onPress();
  h.render();
  assert.ok(text(h).includes(label('copyError')));
  queues.copy.push(Promise.reject(Error('private')));
  await button(h, 'copy').onPress();
  h.render();
  assert.ok(text(h).includes(label('copyError')));
  const share = button(h, 'share').onPress;
  locale = 'ar';
  h.render(); // Retained callbacks use committed presentation, preserving the exact code.
  const sharing = deferred();
  queues.share.push(sharing.promise);
  share();
  share();
  assert.deepEqual(calls.share.at(-1), [{ message: label('shareMessage', { code: issued().code }) }]);
  sharing.reject(Error('private'));
  await settle(h);
  assert.ok(text(h).includes(label('shareError')));
  queues.share.push({ action: 'dismissedAction' });
  await button(h, 'share').onPress();
  h.render();
  assert.equal(calls.haptics.length, 1);

  // Rapid regenerate coalesces synchronously; old controls cannot act for a new issuance.
  const oldCopy = button(h, 'copy').onPress,
    oldShare = button(h, 'share').onPress;
  const regenerate = button(h, 'newCode').onPress;
  const second = deferred();
  queues.post.push(second.promise);
  regenerate();
  regenerate();
  assert.equal(calls.post.length, 1);
  await settle(h);
  assert.equal(calls.post.length, 2);
  oldCopy();
  oldShare();
  assert.equal(calls.copy.length, 3);
  assert.equal(calls.share.length, 2);
  second.resolve(issued('new'));
  await settle(h);
  oldCopy();
  oldShare();
  regenerate();
  await settle(h);
  assert.equal(calls.post.length, 2);
  assert.equal(calls.copy.length, 3);
  assert.ok(text(h).includes('new'));
  // Failed explicit regeneration is visible even while the prior valid code remains.
  queues.post.push(Promise.reject(Error('not displayed')));
  await button(h, 'newCode').onPress();
  await settle(h);
  assert.ok(text(h).includes('new'));
  assert.equal(nodes(h.tree, 'Callout')[0].title, label('createError'));
  queues.post.push(issued('retried'));
  const retryCreate = nodes(h.tree, 'Callout')[0].action.onPress;
  retryCreate();
  retryCreate();
  await settle(h);
  assert.equal(calls.post.length, 4);
  assert.ok(text(h).includes('retried'));
  h.unmount();

  // Create results/errors cannot cross account, client, permission, query, focus or unmount boundaries.
  for (const transition of ['account', 'client', 'denied', 'error', 'school', 'focus', 'unmount']) {
    for (const rejects of [false, true]) {
      reset();
      allow();
      const old = deferred();
      queues.post.push(old.promise);
      h = mountRoute();
      await settle(h);
      if (transition === 'account') env = { ...env, account: { ...env.account, id: 'b' } };
      if (transition === 'client') env = { ...env, client: makeClient('b') };
      if (transition === 'denied') query = { ...query, data: { ...query.data, allowed: false } };
      if (transition === 'error') query = { ...query, isError: true, error: Error('query') };
      if (transition === 'school') query = { ...query, data: { ...query.data, accountId: 'newSchool' } };
      if (transition === 'focus') focused = false;
      if (transition === 'unmount') h.unmount();
      else {
        if (['account', 'client'].includes(transition)) queues.post.push(issued('replacement'));
        h.render();
        await settle(h);
      }
      if (rejects) old.reject(new CanvasError(403));
      else old.resolve(issued('obsolete'));
      await flush();
      if (transition !== 'unmount') {
        h.render();
        assert.ok(!text(h).includes('obsolete'));
        if (['account', 'client'].includes(transition)) {
          assert.ok(text(h).includes('replacement'));
          assert.equal(nodes(h.tree, 'EmptyState').length, 0);
        }
      }
      h.unmount();
    }
  }

  // Retained controls and entered native effects are invalidated without pretending to undo entry.
  for (const transition of [
    'account',
    'client',
    'denied',
    'error',
    'school',
    'focus',
    'unmount',
    'regenerate',
  ]) {
    h = await startIssued();
    const oldCopy = button(h, 'copy').onPress,
      oldShare = button(h, 'share').onPress;
    const native = deferred();
    queues.copy.push(native.promise);
    oldCopy();
    if (transition === 'account') env = { ...env, account: { ...env.account, id: 'b' } };
    if (transition === 'client') env = { ...env, client: makeClient('b') };
    if (transition === 'denied') query = { ...query, data: { ...query.data, allowed: false } };
    if (transition === 'error') query = { ...query, isError: true, error: Error('query') };
    if (transition === 'school') query = { ...query, data: { ...query.data, accountId: 'newSchool' } };
    if (transition === 'focus') focused = false;
    if (transition === 'regenerate') {
      queues.post.push(issued('replacement'));
      button(h, 'newCode').onPress();
    }
    if (transition === 'unmount') h.unmount();
    else {
      if (['account', 'client'].includes(transition)) queues.post.push(issued('replacement'));
      h.render();
      await settle(h);
      if (button(h, 'share')) button(h, 'share').onPress(); // old OS effect still occupies the gate
    }
    oldCopy();
    oldShare();
    assert.equal(calls.copy.length, 1);
    assert.equal(calls.share.length, 0);
    native.resolve(true);
    await flush();
    if (transition !== 'unmount') {
      h.render();
      assert.ok(!text(h).includes(label('copied')));
    }
    assert.equal(calls.haptics.length, 0);
    h.unmount();
  }

  // Retirement between mutation entry and the deferred mutationFn prevents a late POST.
  h = await startIssued();
  button(h, 'newCode').onPress();
  env = { ...env, client: makeClient('new-client') };
  queues.post.push(issued('current'));
  h.render();
  await settle(h);
  assert.equal(calls.post.length, 2);
  assert.equal(calls.post[1][0], 'new-client');
  assert.ok(text(h).includes('current'));
  h.unmount();
  // Going offline before deferred mutation entry cannot issue a code.
  h = await startIssued();
  button(h, 'newCode').onPress();
  online = false;
  h.render();
  await settle(h);
  assert.equal(calls.post.length, 1);
  assert.ok(text(h).includes(issued().code));
  h.unmount();
  // A native focus change before the hook commit blocks entry and clears ignored pending work.
  reset();
  allow();
  const blurPending = deferred();
  queues.post.push(blurPending.promise);
  h = mountRoute();
  await settle(h);
  focused = false;
  blurPending.resolve(issued('hidden'));
  await flush();
  focused = true;
  h.render();
  assert.ok(button(h, 'generate'));
  assert.ok(!text(h).includes('hidden'));
  h.unmount();

  // Even a failed newer generation retires an entered native completion for the old generation.
  h = await startIssued();
  const lateCopy = deferred();
  queues.copy.push(lateCopy.promise);
  button(h, 'copy').onPress();
  queues.post.push(Promise.reject(Error('creation failed')));
  await button(h, 'newCode').onPress();
  await settle(h);
  lateCopy.resolve(true);
  await settle(h);
  assert.equal(calls.haptics.length, 0);
  assert.ok(!text(h).includes(label('copied')));
  h.unmount();
  // Rejected native completions after unmount/account changes never publish an error.
  for (const kind of ['copy', 'share']) {
    h = await startIssued();
    const late = deferred();
    queues[kind].push(late.promise);
    button(h, kind).onPress();
    env = { ...env, account: { ...env.account, id: 'b' } };
    queues.post.push(issued('replacement'));
    h.render();
    await settle(h);
    late.reject(Error('native private'));
    await settle(h);
    assert.ok(!text(h).includes(label(kind + 'Error')));
    h.unmount();
  }
  // Replaying after an entered request does not mint again or accept retired work.
  reset();
  allow();
  const replayed = deferred();
  queues.post.push(replayed.promise);
  h = mountRoute();
  await settle(h);
  h.replay();
  await settle(h);
  replayed.resolve(issued('retired'));
  await settle(h);
  assert.equal(calls.post.length, 1);
  assert.ok(!text(h).includes('retired'));
  assert.ok(button(h, 'generate'));
  h.unmount();
  // Expiry stays Canvas-owned, including an old code; no automatic revocation or regeneration.
  reset();
  allow();
  queues.post.push(issued('past', '2026-11-02T23:20:00Z'));
  h = mountRoute();
  await settle(h);
  assert.ok(text(h).includes('past'));
  queues.copy.push(true);
  await button(h, 'copy').onPress();
  assert.deepEqual(calls.copy[0], ['past']);
  assert.equal(calls.post.length, 1);
  h.unmount();

  // An abandoned replacement render must not retire the still-committed code or native operation.
  h = await startIssued();
  copy = button(h, 'copy').onPress;
  const active = deferred();
  queues.copy.push(active.promise);
  copy();
  const previous = env;
  env = { ...env, client: makeClient('abandoned') };
  h.renderOnly();
  h.abandon();
  env = previous;
  active.resolve(true);
  await settle(h);
  assert.ok(text(h).includes(label('copied')));
  assert.equal(calls.haptics.length, 1);
  assert.equal(calls.post.length, 1);
  // A render never committed cannot issue, even if its callbacks are retained.
  env = { ...env, client: makeClient('never') };
  const abandoned = h.renderOnly();
  h.abandon();
  env = previous;
  nodes(abandoned, 'Button').forEach((p) => p.onPress());
  await flush();
  assert.equal(calls.post.length, 1);
  h.unmount();

  // Raw values colliding with authored English remain raw; absent school ID never fabricates a QR URL.
  reset();
  allow();
  locale = 'fr';
  query = { ...query, data: { allowed: true, accountId: null } };
  queues.post.push(issued('Pairing code'));
  h = mountRoute();
  await settle(h);
  assert.ok(text(h).includes('Pairing code'));
  assert.ok(text(h).includes(label('codeLabel')));
  assert.equal(nodes(h.tree, 'QrCode').length, 0);
  queues.copy.push(true);
  await button(h, 'copy').onPress();
  assert.deepEqual(calls.copy[0], ['Pairing code']);
  h.unmount();

  // Permission-denied POST interpretation remains 401/403; no raw API errors leak into authored UI.
  for (const status of [401, 403]) {
    reset();
    allow();
    queues.post.push(Promise.reject(new CanvasError(status)));
    h = mountRoute();
    await settle(h);
    assert.equal(nodes(h.tree, 'EmptyState')[0].title, label('blockedTitle'));
    assert.equal(nodes(h.tree, 'Button').length, 0);
    h.unmount();
  }
  // A focused visit that returns after a retired initial operation offers explicit generation only.
  reset();
  allow();
  const pending = deferred();
  queues.post.push(pending.promise);
  h = mountRoute();
  await settle(h);
  focused = false;
  h.render();
  focused = true;
  h.render();
  await settle(h);
  pending.resolve(issued());
  await settle(h);
  assert.equal(calls.post.length, 1);
  assert.ok(button(h, 'generate'));
  queues.post.push(issued('manual'));
  await button(h, 'generate').onPress();
  await settle(h);
  assert.ok(text(h).includes('manual'));
  h.unmount();
  reset();
  console.log(
    'settings-pairing: catalogs, actual route/owner/API, installed mutation observer and deferred synthetic effects passed (' +
      process.env.TZ +
      ')',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
