/* global __dirname */
// Production components + owner + signed-in helper. Only hooks, queries and native edges are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
let scope;
const stateWrites = [];
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
        stateWrites.push({ mounted: s.mounted });
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

const root = path.resolve(__dirname, '../..');
const cache = new Map();
const jsx = (type, props) => ({ type, props });
const elements = new Proxy({}, { get: (_, key) => key });
const requests = [],
  entries = [],
  alerts = [],
  announcements = [];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
let env, focused, online, locale, query, liveQuery, nativeResult;
const listeners = new Set();
const navigation = {
  isFocused: () => focused,
  addListener: (event, fn) => {
    assert.equal(event, 'blur');
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
function reset() {
  requests.length = entries.length = alerts.length = announcements.length = 0;
  focused = online = true;
  locale = 'en';
  nativeResult = undefined;
  listeners.clear();
  env = {
    account: { id: 'a', baseUrl: 'https://school.invalid', user: { id: 'u' } },
    client: {
      baseUrl: 'https://school.invalid',
      get(...args) {
        const d = deferred();
        requests.push({ args, ...d });
        return d.promise;
      },
    },
  };
}
const mocks = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': {
    View: 'View',
    Pressable: 'Pressable',
    Alert: { alert: (...x) => alerts.push(x) },
    AccessibilityInfo: {
      announceForAccessibility: (x) => announcements.push(x),
    },
  },
  'lucide-react-native': elements,
  '@/design': elements,
  '@/design/interop': { AnimatedView: 'AnimatedView' },
  '@/i18n/LocalizedText': { LocalizedText: 'Text' },
  'react-native-reanimated': {
    useReducedMotion: () => true,
    useSharedValue: () => ({ get: () => 1 }),
    useAnimatedStyle: () => ({}),
  },
  'expo-router': {
    useIsFocused: () => focused,
    useNavigation: () => navigation,
  },
  'expo-web-browser': {
    openBrowserAsync: (...args) => {
      entries.push(args);
      return nativeResult;
    },
  },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/api/conferences': {
    useConferences: () => query,
    useLiveConferences: () => liveQuery,
  },
  '@/canvas/api/groups': {
    useGroups: () => ({
      data: [{ id: 'g', name: 'Raw group', courseId: '42' }],
    }),
  },
  '@/features/offline/useOnline': { useOnline: () => online },
  '@/features/course/states': {
    ListSkeleton: 'ListSkeleton',
    LoadError: 'LoadError',
  },
  '@/i18n': {
    useTranslation: () => ({
      locale,
      t: load('@/i18n/runtime').createTranslator(locale),
    }),
  },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mocks[key]) return mocks[key];
  assert.ok(key.startsWith('@/'), `unmocked ${key}`);
  const file = ['.ts', '.tsx', '/index.ts']
    .map((ext) => path.join(root, key.slice(2)) + ext)
    .find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const isComponent = ['ConferenceList.tsx', 'LiveConferences.tsx'].includes(path.basename(file));
  const original = process.env.CONFERENCE_BROWSER_ORIGINAL;
  let source = fs.readFileSync(
    original && isComponent ? path.join(original, path.basename(file)) : file,
    'utf8',
  );
  if (file.endsWith('ConferenceList.tsx')) source += '\nexport {ConferenceCard,RecordingRow};';
  if (file.endsWith('LiveConferences.tsx')) source += '\nexport {ConferenceBanner};';
  const js = ts.transpileModule(source, {
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
const nodes = (t) =>
  !t || typeof t !== 'object' ? [] : Array.isArray(t) ? t.flatMap(nodes) : [t, ...nodes(t.props?.children)];
const find = (t, type) => nodes(t).find((n) => n.type === type)?.props;
const fixture = () => ({
  id: 'c',
  title: 'Raw conference',
  provider: 'Raw provider',
  description: 'Raw description',
  status: 'live',
  startedAt: new Date('2026-01-01'),
  endedAt: null,
  durationMinutes: 60,
  longRunning: false,
  url: '/conference/page',
  joinPath: '/courses/42/conferences/c/join',
  recordings: [
    {
      id: 'r',
      title: 'Raw recording',
      durationMinutes: 20,
      createdAt: null,
      url: 'https://recording.invalid/raw?x=1',
      formats: [],
    },
  ],
});
Object.assign(mocks['@/i18n'], load('@/i18n/runtime'));
const ui = load('@/features/conferences/ConferenceList'),
  home = load('@/features/home/LiveConferences');
function setup(kind) {
  let c = fixture(),
    context = { type: 'course', id: '42' },
    r = c.recordings[0];
  let banner = {
    id: c.id,
    title: c.title,
    startedAt: c.startedAt,
    contextType: 'course',
    contextId: '42',
    joinPath: c.joinPath,
  };
  const m = mount(() =>
    kind === 'home'
      ? home.ConferenceBanner({
          conference: banner,
          contextName: 'Raw course',
          color: undefined,
        })
      : kind === 'card'
        ? ui.ConferenceCard({
            conference: c,
            context,
            now: new Date('2026-01-02'),
          })
        : ui.RecordingRow({
            recording: r,
            conference: c,
            context,
            now: new Date('2026-01-02'),
          }),
  );
  const action = () => find(m.render(), kind === 'recording' ? 'ListItem' : 'Button').onPress;
  return {
    m,
    action,
    replace() {
      if (kind === 'home') banner = { ...banner, title: 'replacement' };
      else if (kind === 'card') c = { ...c, title: 'replacement' };
      else r = { ...r, title: 'replacement' };
    },
    url() {
      if (kind === 'home') banner.joinPath = '/new';
      else if (kind === 'card') c.joinPath = '/new';
      else r.url = '/new';
    },
    context() {
      context = { type: 'group', id: 'g' };
      banner = { ...banner, contextType: 'group', contextId: 'g' };
    },
    parent() {
      c = { ...c, title: 'New parent' };
    },
    mutate() {
      if (kind === 'home') banner.title = 'changed';
      else if (kind === 'card') c.title = 'changed';
      else r.title = 'changed';
    },
    ineligible() {
      if (kind === 'home') online = false;
      else if (kind === 'card') c.status = 'ended';
      else r.url = null;
    },
    expected: kind === 'recording' ? r.url : env.account.baseUrl + c.joinPath,
  };
}
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
for (const kind of ['home', 'card', 'recording']) {
  for (const retirement of [
    'account',
    'client',
    'base',
    'replace',
    'url',
    'context',
    'mutate',
    'blur',
    'unmount',
    'ineligible',
  ])
    for (const fallback of [false, true])
      test(`${kind}: ${retirement}, ${fallback ? 'fallback' : 'session'}`, async () => {
        reset();
        const s = setup(kind),
          press = s.action();
        press();
        assert.equal(requests.length, 1);
        if (retirement === 'account') env = { ...env, account: { ...env.account, id: 'b' } };
        else if (retirement === 'client') env = { ...env, client: { ...env.client } };
        else if (retirement === 'base') env.account.baseUrl = 'https://other.invalid';
        else if (retirement === 'blur') {
          focused = false;
          for (const fn of listeners) fn();
        } else if (retirement === 'unmount') s.m.unmount();
        else s[retirement]();
        if (retirement !== 'unmount') s.m.render();
        const writes = stateWrites.length;
        if (fallback) requests[0].reject(new Error('blocked'));
        else requests[0].resolve({ session_url: 'https://session.invalid/token' });
        await flush();
        assert.equal(entries.length, 0, 'retired launch entered native browser');
        assert.equal(stateWrites.length, writes, 'retired completion wrote state');
        assert.equal(alerts.length + announcements.length, 0);
        press();
        assert.equal(requests.length, 1, 'stale callback restarted lookup');
        if (retirement !== 'unmount') s.m.unmount();
      });
  test(`${kind}: duplicate, failure/retry and committed locale`, async () => {
    reset();
    const s = setup(kind),
      press = s.action();
    const failure = deferred();
    nativeResult = failure.promise;
    press();
    press();
    assert.equal(requests.length, 1, 'duplicate session lookup');
    requests[0].resolve({ session_url: 'https://session.invalid/token' });
    await flush();
    assert.deepEqual(entries, [['https://session.invalid/token']]);
    locale = 'fr';
    s.m.render();
    failure.reject(new Error('Raw native error'));
    await flush();
    const t = load('@/i18n/runtime').createTranslator('fr');
    if (kind === 'home') assert.deepEqual(announcements, [t('conference.error')]);
    else assert.deepEqual(alerts, [[t('conferences.browserError'), 'Raw native error']]);
    nativeResult = undefined;
    s.action()();
    assert.equal(requests.length, 2);
    requests[1].reject(new Error('session blocked'));
    await flush();
    assert.deepEqual(entries[1], [s.expected]);
    s.m.unmount();
  });
  test(`${kind}: stale native failure has no notice or finalizer`, async () => {
    reset();
    const s = setup(kind),
      old = deferred();
    nativeResult = old.promise;
    s.action()();
    requests[0].resolve({ session_url: 'session' });
    await flush();
    s.replace();
    s.m.render();
    const next = deferred();
    nativeResult = next.promise;
    s.action()();
    requests[1].resolve({ session_url: 'new session' });
    await flush();
    old.reject(new Error('old'));
    await flush();
    assert.equal(alerts.length + announcements.length, 0);
    if (kind === 'home')
      assert.equal(find(s.m.render(), 'Button').loading, true, 'old finalizer cleared replacement');
    s.action()();
    assert.equal(requests.length, 2);
    next.resolve();
    await flush();
    if (kind === 'home') assert.equal(find(s.m.render(), 'Button').loading, false);
    s.m.unmount();
  });
  test(`${kind}: abandoned replacement does not retire committed operation`, async () => {
    reset();
    const s = setup(kind);
    s.action()();
    s.replace();
    s.m.renderOnly();
    s.m.abandon();
    requests[0].resolve({ session_url: 'session' });
    await flush();
    assert.equal(entries.length, 1);
    s.m.unmount();
  });
}
for (const kind of ['home', 'card', 'recording']) {
  for (const retirement of ['account', 'replace', 'url', 'context', 'blur', 'unmount', 'ineligible'])
    test(`${kind}: native rejection after ${retirement}`, async () => {
      reset();
      const s = setup(kind),
        d = deferred();
      nativeResult = d.promise;
      s.action()();
      requests[0].resolve({ session_url: 'session' });
      await flush();
      assert.equal(entries.length, 1);
      if (retirement === 'account') env = { ...env, account: { ...env.account, id: 'b' } };
      else if (retirement === 'blur') {
        focused = false;
        for (const fn of listeners) fn();
      } else if (retirement === 'unmount') s.m.unmount();
      else s[retirement]();
      if (retirement !== 'unmount') s.m.render();
      const writes = stateWrites.length;
      d.reject(new Error('stale native'));
      await flush();
      assert.equal(alerts.length + announcements.length, 0, 'stale error notice');
      assert.equal(stateWrites.length, writes, 'stale native finalizer');
      if (retirement !== 'unmount') s.m.unmount();
    });
  test(`${kind}: locale changes during session lookup`, async () => {
    reset();
    const s = setup(kind);
    s.action()();
    locale = 'ar';
    s.m.render();
    requests[0].resolve({ session_url: 'session' });
    await flush();
    assert.deepEqual(entries, [['session']]);
    s.m.unmount();
  });
  test(`${kind}: discarded locale cannot translate a committed failure`, async () => {
    reset();
    const s = setup(kind),
      d = deferred();
    nativeResult = d.promise;
    s.action()();
    requests[0].resolve({ session_url: 'session' });
    await flush();
    locale = 'ar';
    s.m.renderOnly();
    s.m.abandon();
    d.reject(new Error('raw'));
    await flush();
    const t = load('@/i18n/runtime').createTranslator('en');
    assert.equal(
      kind === 'home' ? announcements[0] : alerts[0][0],
      t(kind === 'home' ? 'conference.error' : 'conferences.browserError'),
    );
    s.m.unmount();
  });
  test(`${kind}: raw mutation before another render`, async () => {
    reset();
    const s = setup(kind);
    s.action()();
    s.mutate();
    requests[0].reject(new Error('session fallback'));
    await flush();
    assert.equal(entries.length, 0);
    s.m.unmount();
  });
  test(`${kind}: blur and refocus between commits`, async () => {
    reset();
    const s = setup(kind);
    s.action()();
    focused = false;
    for (const fn of listeners) fn();
    focused = true;
    requests[0].resolve({ session_url: 'old' });
    await flush();
    assert.equal(entries.length, 0);
    s.action()();
    assert.equal(requests.length, 2);
    requests[1].resolve({ session_url: 'new' });
    await flush();
    assert.deepEqual(entries, [['new']]);
    s.m.unmount();
  });
  test(`${kind}: effect replay retires old operation`, async () => {
    reset();
    const s = setup(kind);
    s.action()();
    s.m.replayEffects();
    requests[0].resolve({ session_url: 'old' });
    await flush();
    assert.equal(entries.length, 0);
    s.action()();
    assert.equal(requests.length, 2);
    requests[1].resolve({ session_url: 'new' });
    await flush();
    assert.equal(entries.length, 1);
    s.m.unmount();
    assert.equal(listeners.size, 0);
  });
  for (const identity of ['user', 'clientBase'])
    test(`${kind}: mutated ${identity}`, async () => {
      reset();
      const s = setup(kind);
      s.action()();
      if (identity === 'user') env.account.user.id = 'other';
      else env.client.baseUrl = 'https://other.invalid';
      s.m.render();
      requests[0].resolve({ session_url: 'old' });
      await flush();
      assert.equal(entries.length, 0);
      s.m.unmount();
    });
}
test('recording: same-key parent replacement', async () => {
  reset();
  const s = setup('recording');
  s.action()();
  s.parent();
  s.m.render();
  requests[0].resolve({ session_url: 'old' });
  await flush();
  assert.equal(entries.length, 0);
  s.m.unmount();
});
test('signed-in guard before lookup, fallback and default native options', async () => {
  reset();
  const { openSignedIn } = load('@/features/content/browser');
  await openSignedIn(env.client, '/raw', () => false);
  assert.equal(requests.length, 0);
  const p = openSignedIn(env.client, '/raw?x=1');
  assert.deepEqual(requests[0].args, [
    '/api/v1/login/session_token',
    { return_to: 'https://school.invalid/raw?x=1' },
  ]);
  requests[0].reject(new Error('blocked'));
  await p;
  assert.deepEqual(entries, [['https://school.invalid/raw?x=1']]);
});
for (const type of ['course', 'group'])
  test(`${type}: production list, exact URLs, eligibility, names and expansion`, async () => {
    reset();
    const c = fixture();
    c.joinPath = `/${type}s/42/conferences/c/join`;
    c.status = 'scheduled';
    query = { data: [c], isPending: false, isError: false };
    const context = { type, id: '42' };
    const list = mount(() => ui.ConferenceList({ context }));
    const cardProps = find(list.render(), ui.ConferenceCard);
    assert.strictEqual(cardProps.context, context);
    assert.strictEqual(cardProps.conference, c);
    const card = mount(() => ui.ConferenceCard(cardProps));
    assert.ok(JSON.stringify(card.render()).includes(c.title));
    const rowProps = find(card.render(), ui.RecordingRow);
    assert.strictEqual(rowProps.conference, c);
    assert.strictEqual(rowProps.context, context);
    const row = mount(() => ui.RecordingRow(rowProps));
    assert.equal(find(row.render(), 'ListItem').title, 'Raw recording');
    find(row.render(), 'ListItem').onPress();
    assert.equal(requests[0].args[1].return_to, c.recordings[0].url);
    requests[0].reject(new Error('fallback'));
    await flush();
    assert.deepEqual(entries.pop(), [c.recordings[0].url]);
    for (const [status, url, expected] of [
      ['scheduled', '/conference/page', 'https://school.invalid/conference/page'],
      ['scheduled', null, 'https://school.invalid' + c.joinPath],
      ['live', '/ignored', 'https://school.invalid' + c.joinPath],
    ]) {
      c.status = status;
      c.url = url;
      find(card.render(), 'Button').onPress();
      const req = requests.at(-1);
      assert.equal(req.args[1].return_to, expected);
      req.reject(new Error('fallback'));
      await flush();
      assert.deepEqual(entries.pop(), [expected]);
    }
    c.status = 'ended';
    assert.equal(find(card.render(), 'Button'), undefined);
    assert.ok(find(card.render(), ui.RecordingRow));
    find(card.render(), 'Pressable').onPress();
    assert.equal(find(card.render(), ui.RecordingRow), undefined);
    locale = 'fr';
    assert.equal(find(card.render(), 'Pressable').accessibilityState.expanded, false);
    row.unmount();
    card.unmount();
    list.unmount();
  });
for (const type of ['course', 'group'])
  test(`Home ${type}: production banner props and exact URL`, async () => {
    reset();
    const c = {
      id: 'c',
      title: 'Raw live name',
      startedAt: null,
      contextType: type,
      contextId: type === 'group' ? 'g' : '42',
      joinPath: `/${type}s/42/conferences/c/join`,
    };
    liveQuery = { data: [c] };
    const parent = mount(() =>
      home.LiveConferences({
        courseFor: (id) => (id === '42' ? { code: 'Raw course code', color: 'course-color' } : undefined),
      }),
    );
    const props = find(parent.render(), home.ConferenceBanner);
    assert.equal(props.contextName, type === 'group' ? 'Raw group' : 'Raw course code');
    assert.equal(props.color, 'course-color');
    const banner = mount(() => home.ConferenceBanner(props));
    find(banner.render(), 'Button').onPress();
    assert.equal(requests[0].args[1].return_to, env.account.baseUrl + c.joinPath);
    requests[0].reject(new Error('blocked'));
    await flush();
    assert.deepEqual(entries, [[env.account.baseUrl + c.joinPath]]);
    online = false;
    assert.equal(find(banner.render(), 'Button').disabled, true);
    find(banner.render(), 'Button').onPress();
    assert.equal(requests.length, 1);
    banner.unmount();
    parent.unmount();
  });
(async () => {
  let failures = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
    } catch (e) {
      failures++;
      console.error(`FAIL ${name}: ${e.message}`);
    }
  }
  assert.equal(failures, 0, `${failures}/${tests.length} failed`);
  console.log(
    `Conference browser: ${tests.length} production-component/session synthetic checks passed (${process.env.TZ ?? 'local'}).`,
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
