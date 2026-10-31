/* global __dirname */
// Actual screens, scoped owner and signed-in helper; synthetic commit/session/native edges only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const original = process.env.EVENT_NOTIFICATION_ORIGINAL;
let scope, env, query, focused, route, navigation, locale, params;
const requests = [],
  browsers = [],
  listeners = new Map(),
  cache = new Map();
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
const react = {
  useState(initial) {
    const s = scope,
      i = s.cursor++;
    if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [
      s.slots[i],
      (v) => {
        assert.ok(s.mounted, 'no state after unmount');
        const n = typeof v === 'function' ? v(s.slots[i]) : v;
        if (!Object.is(n, s.slots[i])) {
          s.slots[i] = n;
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
  useLayoutEffect(fn, deps) {
    const s = scope,
      i = s.cursor++,
      old = s.slots[i];
    if (!old || !deps || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
      const slot = { deps, fn };
      s.slots[i] = slot;
      s.effects.push(() => {
        old?.cleanup?.();
        slot.cleanup = fn();
      });
    }
  },
  useSyncExternalStore(_s, get) {
    return get();
  },
};
react.useCallback = (fn, deps) => react.useMemo(() => fn, deps);
const jsx = (type, props) => ({ type, props });
const mocks = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': {
    View: 'View',
    RefreshControl: 'RefreshControl',
    Alert: {
      alert() {
        throw Error('unexpected Alert');
      },
    },
    Linking: {
      openURL() {
        throw Error('unexpected Linking');
      },
    },
    Platform: { OS: 'ios' },
  },
  'lucide-react-native': new Proxy({}, { get: (_o, key) => key }),
  'expo-router': {
    useNavigation: () => navigation,
    useRoute: () => route,
    useIsFocused: () => focused,
    useLocalSearchParams: () => params,
    Stack: { Screen: 'Stack.Screen' },
    router: {
      push() {
        throw Error('unexpected navigation');
      },
      back() {
        throw Error('unexpected navigation');
      },
    },
  },
  'expo-web-browser': {
    openBrowserAsync: (...args) => {
      const d = deferred();
      browsers.push({ target: args[0], args, ...d });
      return d.promise;
    },
  },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/api/calendar': {
    useCalendarEvent: () => query,
    useCalendars: () => ({ data: [] }),
    useDeletePersonalEvent: () => ({}),
    useCancelReservation: () => ({}),
  },
  '@/canvas/api/preferences': { useChannels: () => query },
  '@/features/calendar/AgendaRow': { calendarColor: () => null },
  '@/features/content/RichContent': { RichContent: 'RichContent' },
  '@/features/files/ActionSheet': {
    useActionSheet: () => ({
      show() {
        throw Error('unexpected sheet');
      },
      sheet: null,
    }),
  },
  '@/features/reminders/ReminderControl': { ReminderControl: 'ReminderControl' },
  '@/design': new Proxy(
    {},
    {
      get: (_o, key) =>
        key === 'useTheme'
          ? () => ({ scheme: 'light', colors: {} })
          : key === 'useToast'
            ? () => ({
                show() {
                  throw Error('unexpected toast');
                },
                element: null,
              })
            : key === 'haptics'
              ? { selection() {} }
              : key,
    },
  ),
  '@/features/course/states': {
    ListSkeleton: 'ListSkeleton',
    LoadError: 'LoadError',
    useRefreshControl: () => null,
  },
  '@/features/offline/useOnline': { useOnline: () => true },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mocks[key]) return mocks[key];
  assert.ok(key.startsWith('@/'), `Unmocked dependency: ${key}`);
  const file = ['.ts', '.tsx', '/index.ts']
    .map((ext) => path.join(root, key.slice(2)) + ext)
    .find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const selected =
    original && file.includes('/app/(app)/')
      ? path.join(original, file.includes('/event/') ? 'event.tsx' : 'notifications.tsx')
      : file;
  const js = ts.transpileModule(fs.readFileSync(selected, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function('require', 'module', 'exports', js)((n) => load(n, file), module, module.exports);
  return module.exports;
}
const runtime = load('@/i18n/runtime');
function setLocale(value) {
  locale = value;
  runtime.setAccountLocale(env.account.id, locale);
}
const client = () => ({
  baseUrl: 'https://school.invalid',
  get(...args) {
    const d = deferred();
    requests.push({ args, ...d });
    return d.promise;
  },
});
const row = () => ({
  id: 'e /',
  title: 'Raw event',
  htmlUrl: '/calendar?event_id=e%20%2F',
  start: null,
  end: null,
});
function setup(kind) {
  requests.length = browsers.length = 0;
  listeners.clear();
  env = { account: { id: 'a', baseUrl: 'https://school.invalid' }, client: client() };
  focused = true;
  route = { key: 'screen' };
  params = { eventId: 'e /' };
  navigation = {
    isFocused: () => focused,
    getState: () => ({ index: 0, routes: [route] }),
    addListener: (event, fn) => {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(fn);
      return () => set.delete(fn);
    },
  };
  query = { data: kind === 'event' ? row() : [], isPending: false, isError: false, refetch: async () => {} };
  setLocale('en');
}
const emit = (name) => [...(listeners.get(name) ?? [])].forEach((fn) => fn());
function mount(kind) {
  const fn = load(
    kind === 'event' ? '@/app/(app)/event/[eventId]/index' : '@/app/(app)/canvas-notifications',
  ).default;
  const s = { slots: [], cursor: 0, effects: [], mounted: true };
  let props = { courseId: 'c /' },
    tree;
  const render = () => {
    let count = 0;
    do {
      assert.ok(count++ < 15, 'bounded commit');
      s.dirty = false;
      scope = s;
      s.cursor = 0;
      tree = fn(props);
      scope = null;
      while (s.effects.length) s.effects.shift()();
    } while (s.dirty);
    return tree;
  };
  render();
  return {
    render,
    replay() {
      for (const slot of s.slots) slot?.cleanup?.();
      for (const slot of s.slots) if (slot?.fn) slot.cleanup = slot.fn();
      return render();
    },
    change(p) {
      props = { ...props, ...p };
      return render();
    },
    unmount() {
      for (const slot of s.slots) slot?.cleanup?.();
      s.mounted = false;
    },
    discard(p = {}) {
      const slots = s.slots.slice();
      scope = s;
      s.cursor = 0;
      const result = fn({ ...props, ...p });
      scope = null;
      s.slots = slots;
      s.effects = [];
      return result;
    },
  };
}
const nodes = (t) =>
  !t || typeof t !== 'object' ? [] : Array.isArray(t) ? t.flatMap(nodes) : [t, ...nodes(t.props?.children)];
const find = (t, type) => nodes(t).find((n) => n.type === type)?.props;
function control(m, kind, tree = m.render()) {
  return kind === 'settings'
    ? find(tree, 'EmptyState')?.action
    : nodes(tree).find((n) => n.type === 'Button' && n.props.leadingIcon === 'ExternalLink')?.props;
}
let completed = false;
process.once('beforeExit', () => assert.ok(completed, 'suite must settle every awaited operation'));
(async () => {
  if (original) {
    for (const kind of ['event', 'settings', 'communication']) {
      setup(kind);
      const m = mount(kind),
        old = control(m, kind);
      old.onPress();
      old.onPress();
      assert.equal(requests.length, 2, 'original duplicate requests reproduced');
      env = { ...env, client: client(), account: { ...env.account, id: 'b' } };
      m.render();
      requests[0].resolve({ session_url: 'https://signed.invalid/retired' });
      await flush();
      assert.equal(browsers.length, 1, 'original retired launch reproduced');
      browsers[0].resolve();
      requests[1].resolve({ session_url: 'https://signed.invalid/duplicate' });
      await flush();
      browsers[1].resolve();
      await flush();
      m.unmount();
      console.log(
        `BEFORE ${kind}: two synchronous presses requested two sessions; account replacement still entered native browser`,
      );
    }
    return;
  }

  setup('event');
  await load('@/features/content/browser').openSignedIn(env.client, '/never', () => false);
  assert.equal(requests.length, 0, 'actual helper guards before lookup');
  const channel = () => ({ id: 'email', type: 'email', address: 'student.invalid', confirmed: true });
  let scenarios = 0;
  for (const kind of ['event', 'settings', 'communication']) {
    const changes = {
      account(m) {
        env = { ...env, account: { ...env.account, id: 'b' } };
        m.render();
      },
      client(m) {
        env = { ...env, client: client() };
        m.render();
      },
      accountBase(m) {
        env = { ...env, account: { ...env.account, baseUrl: 'https://other.invalid' } };
        m.render();
      },
      clientBase(m) {
        env.client.baseUrl = 'https://other.invalid';
        m.render();
      },
      expired(m) {
        env.account.expired = true;
        m.render();
      },
      route(m) {
        route = { key: 'replacement' };
        m.render();
      },
      navigation(m) {
        navigation = { ...navigation };
        m.render();
      },
      focus(m) {
        focused = false;
        emit('blur');
        m.render();
      },
      unmount(m) {
        m.unmount();
      },
      accountInPlace() {
        env.account.id = 'b';
      },
      accountBaseInPlace() {
        env.account.baseUrl = 'https://other.invalid';
      },
      clientBaseInPlace() {
        env.client.baseUrl = 'https://other.invalid';
      },
      routeBeforeCommit() {
        route = { key: 'replacement' };
      },
      focusBeforeCommit() {
        focused = false;
        emit('blur');
      },
    };
    if (kind === 'event')
      Object.assign(changes, {
        eventRoute(m) {
          params = { eventId: 'other' };
          m.render();
        },
        source(m) {
          query = { ...query, data: { ...query.data } };
          m.render();
        },
        eventId(m) {
          query.data.id = 'other';
          m.render();
        },
        htmlUrl(m) {
          query.data.htmlUrl = '/different';
          m.render();
        },
        sourceInPlace() {
          query.data = { ...query.data };
        },
        idInPlace() {
          query.data.id = 'other';
        },
        urlInPlace() {
          query.data.htmlUrl = '/different';
        },
        pending(m) {
          query = { ...query, isPending: true };
          m.render();
        },
        error(m) {
          query = { ...query, isError: true, error: Error('raw') };
          m.render();
        },
        errorInPlace() {
          query.isError = true;
        },
      });
    if (kind === 'settings')
      Object.assign(changes, {
        channels(m) {
          query = { ...query, data: [channel()] };
          m.render();
        },
        channelsInPlace() {
          query.data.push(channel());
        },
        pending(m) {
          query = { ...query, isPending: true };
          m.render();
        },
        error(m) {
          query = { ...query, isError: true, error: Error('raw') };
          m.render();
        },
        pendingInPlace() {
          query.isPending = true;
        },
        errorInPlace() {
          query.isError = true;
        },
      });
    for (const [name, change] of Object.entries(changes))
      for (const fallback of [false, true]) {
        setup(kind);
        const m = mount(kind),
          old = control(m, kind);
        const pending = old.onPress();
        assert.equal(requests.length, 1);
        change(m);
        await old.onPress();
        assert.equal(requests.length, 1, `${kind}/${name}: retained control blocked`);
        if (fallback) requests[0].reject(Error('session denied'));
        else requests[0].resolve({ session_url: 'https://signed.invalid/retired' });
        await pending;
        assert.equal(
          browsers.length,
          0,
          `${kind}/${name}: delayed ${fallback ? 'fallback' : 'success'} retired`,
        );
        await old.onPress();
        assert.equal(requests.length, 1, `${kind}/${name}: stale after completion`);
        if (name !== 'unmount') m.unmount();
        scenarios++;
      }
    // Exact session endpoint/return_to and native options; locale alone preserves work.
    for (const fallback of [false, true]) {
      setup(kind);
      const m = mount(kind),
        old = control(m, kind),
        pending = old.onPress();
      old.onPress();
      assert.equal(requests.length, 1, 'same-tick presses coalesce');
      const destination =
        kind === 'event'
          ? '/calendar?event_id=e%20%2F'
          : kind === 'settings'
            ? '/profile/settings'
            : '/profile/communication';
      assert.deepEqual(requests[0].args, [
        '/api/v1/login/session_token',
        { return_to: 'https://school.invalid' + destination },
      ]);
      setLocale('ar');
      m.render();
      await control(m, kind).onPress();
      assert.equal(requests.length, 1);
      if (fallback) requests[0].reject(Error('blocked'));
      else requests[0].resolve({ session_url: 'https://signed.invalid/current' });
      await flush();
      assert.deepEqual(
        browsers[0].args,
        [fallback ? 'https://school.invalid' + destination : 'https://signed.invalid/current'],
        'native options unchanged: one URL argument',
      );
      browsers[0].reject(Error('native rejection stays silent'));
      await pending;
      const retry = control(m, kind).onPress();
      assert.equal(requests.length, 2, 'valid retry after native rejection');
      requests[1].resolve({ session_url: 'https://signed.invalid/retry' });
      await flush();
      browsers[1].resolve();
      await retry;
      m.unmount();
      scenarios++;
    }
    // Old session/native completion never frees the replacement claim.
    for (const nativeEntered of [false, true])
      for (const reject of [false, true]) {
        setup(kind);
        const m = mount(kind),
          old = control(m, kind),
          first = old.onPress();
        if (nativeEntered) {
          requests[0].resolve({ session_url: 'https://signed.invalid/old' });
          await flush();
        }
        env = { ...env, client: client() };
        m.render();
        const next = control(m, kind),
          second = next.onPress();
        assert.equal(requests.length, 2);
        await old.onPress();
        assert.equal(requests.length, 2);
        const completion = nativeEntered ? browsers[0] : requests[0];
        if (reject) completion.reject(Error('retired'));
        else completion.resolve({ session_url: 'https://signed.invalid/old' });
        await first;
        await next.onPress();
        assert.equal(requests.length, 2, 'old finalization cannot release new claim');
        requests[1].resolve({ session_url: 'https://signed.invalid/new' });
        await flush();
        assert.equal(browsers.length, nativeEntered ? 2 : 1);
        browsers.at(-1).resolve();
        await second;
        m.unmount();
        scenarios++;
      }
    // A discarded render cannot publish a control or revoke committed work.
    for (const changed of [false, true]) {
      setup(kind);
      const m = mount(kind),
        pending = control(m, kind).onPress(),
        saved = env;
      if (changed) env = { ...env, client: client() };
      const discarded = m.discard();
      env = saved;
      await control(m, kind, discarded).onPress();
      assert.equal(requests.length, 1);
      requests[0].resolve({ session_url: 'https://signed.invalid/committed' });
      await flush();
      browsers[0].resolve();
      await pending;
      await control(m, kind, discarded).onPress();
      assert.equal(requests.length, 1, 'uncommitted control never borrows owner');
      m.unmount();
      scenarios++;
    }
    // Focus return or source A -> B -> A must not revive retained callbacks.
    for (const focus of [false, true]) {
      setup(kind);
      const m = mount(kind),
        old = control(m, kind),
        saved = env;
      if (focus) {
        emit('blur');
        emit('focus');
        m.render();
      } else {
        env = { ...env, client: client() };
        m.render();
        env = saved;
        m.render();
      }
      await old.onPress();
      assert.equal(requests.length, 0);
      const pending = control(m, kind).onPress();
      assert.equal(requests.length, 1);
      requests[0].resolve({ session_url: 'https://signed.invalid/renewed' });
      await flush();
      browsers[0].resolve();
      await pending;
      m.unmount();
      scenarios++;
    }
    setup(kind);
    {
      const m = mount(kind),
        pending = control(m, kind).onPress();
      requests[0].resolve({ session_url: 'https://signed.invalid/entered' });
      await flush();
      m.unmount();
      browsers[0].reject(Error('unmounted native'));
      await pending;
      scenarios++;
    }
  }
  // Both notification controls share a claim; communication survives channel state,
  // selected-channel and locale changes, whereas hidden settings never revives.
  setup('settings');
  {
    const m = mount('settings'),
      settings = control(m, 'settings'),
      communication = control(m, 'communication');
    const first = settings.onPress();
    await communication.onPress();
    assert.equal(requests.length, 1, 'cross-control duplicates coalesce');
    query = { ...query, data: [channel()] };
    m.render();
    const second = control(m, 'communication').onPress();
    assert.equal(requests.length, 2, 'hidden settings yields to current communication');
    requests[0].resolve({ session_url: 'https://signed.invalid/hidden' });
    await first;
    await control(m, 'communication').onPress();
    assert.equal(requests.length, 2, 'hidden completion cannot release communication claim');
    query = { ...query, data: [] };
    m.render();
    await settings.onPress();
    assert.equal(requests.length, 2, 'empty state returning does not revive old action');
    requests[1].resolve({ session_url: 'https://signed.invalid/communication' });
    await flush();
    assert.equal(browsers.length, 1);
    browsers[0].resolve();
    await second;
    const third = control(m, 'settings').onPress();
    assert.equal(requests.length, 3);
    requests[2].reject(Error('no token'));
    await flush();
    assert.equal(browsers[1].target, 'https://school.invalid/profile/settings');
    browsers[1].resolve();
    await third;
    m.unmount();
    scenarios++;
  }
  for (const state of ['channels', 'pending', 'error', 'selection'])
    for (const fallback of [false, true]) {
      setup('communication');
      if (state === 'selection') query.data = [channel(), { ...channel(), id: 'other' }];
      const m = mount('communication'),
        old = control(m, 'communication'),
        pending = old.onPress();
      if (state === 'channels') query = { ...query, data: [channel()] };
      if (state === 'pending') query = { ...query, isPending: true };
      if (state === 'error') query = { ...query, isError: true, error: Error('channel failure') };
      if (state === 'selection')
        nodes(m.render())
          .filter((n) => n.type === 'ListItem')[1]
          .props.onPress();
      setLocale('fr');
      m.render();
      await old.onPress();
      assert.equal(requests.length, 1);
      if (fallback) requests[0].reject(Error('no session'));
      else requests[0].resolve({ session_url: 'https://signed.invalid/account-level' });
      await flush();
      assert.deepEqual(browsers[0].args, [
        fallback ? 'https://school.invalid/profile/communication' : 'https://signed.invalid/account-level',
      ]);
      browsers[0].resolve();
      await pending;
      m.unmount();
      scenarios++;
    }
  // Layout-effect replay retires pending operations. The currently committed
  // UI ticket is republished by replay; older control tickets remain retired.
  for (const kind of ['event', 'settings', 'communication']) {
    setup(kind);
    const m = mount(kind),
      old = control(m, kind),
      first = old.onPress();
    m.replay();
    const second = control(m, kind).onPress();
    assert.equal(requests.length, 2);
    requests[0].reject(Error('replayed session'));
    await first;
    assert.equal(browsers.length, 0);
    await control(m, kind).onPress();
    assert.equal(requests.length, 2);
    requests[1].resolve({ session_url: 'https://signed.invalid/replayed' });
    await flush();
    browsers[0].resolve();
    await second;
    m.unmount();
    scenarios++;
  }
  assert.equal(
    [...listeners.values()].reduce((count, set) => count + set.size, 0),
    0,
    'navigation listeners released',
  );
  // Optional external reviewed baseline: never generated or refreshed by this suite.
  if (process.env.EVENT_NOTIFICATION_CATALOG_BASELINE) {
    const baseline = JSON.parse(fs.readFileSync(process.env.EVENT_NOTIFICATION_CATALOG_BASELINE, 'utf8'));
    for (const lang of ['en', 'fr', 'ar']) {
      assert.equal(Object.keys(baseline.catalogs[lang]).length, 3260);
      const catalog = load('@/i18n/' + lang)[lang];
      for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
        assert.equal(
          crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
          hash,
          lang + '/' + key,
        );
    }
    console.log('All 3260 root-reviewed catalog values per language preserved.');
  }
  console.log(
    `Event/notification browser: ${scenarios} synthetic cases passed; TZ=${process.env.TZ || 'default'}. Actual screens and signed-in/session URL helper; no native/HTTP/storage effects.`,
  );
})().then(() => {
  completed = true;
});
