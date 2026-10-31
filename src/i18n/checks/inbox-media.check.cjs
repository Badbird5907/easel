/* global __dirname */
// Executes production components/helpers and Expo's installed useEvent hook.
// Native players/views/browser and session transport are synthetic and fail closed.
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
    return { ...node, props: { ...node.props, children: visit(node.props.children, at + '.children') } };
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
const unexpected = [];
const requireBoundary = (queue, name) => {
  if (!queue.length) {
    unexpected.push(name);
    throw Error(name);
  }
};
const requests = [],
  browsers = [],
  players = [],
  nativeCalls = [],
  sessionResults = [],
  browserResults = [];
function client(name) {
  return {
    baseUrl: `https://${name}.invalid`,
    authHeaders: { Authorization: `Bearer synthetic-${name}` },
    async get(...args) {
      requests.push([name, ...args]);
      requireBoundary(sessionResults, 'unexpected session transport');
      return await sessionResults.shift()();
    },
  };
}
let env = { account: { id: 'a' }, client: client('a') };
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'View', Pressable: 'Pressable' },
  'lucide-react-native': Object.fromEntries(['AudioLines', 'Video', 'Play', 'Pause'].map((k) => [k, k])),
  '@/design': Object.fromEntries(['Button', 'Icon', 'IconButton', 'Text', 'ProgressBar'].map((k) => [k, k])),
  '@/canvas/session': { useCanvas: () => env },
  '@/i18n': {
    useTranslation: () => ({
      ...runtime.getLocaleState(),
      t: runtime.createTranslator(runtime.displayLocale()),
    }),
  },
  'expo-web-browser': {
    async openBrowserAsync(...args) {
      browsers.push(args);
      requireBoundary(browserResults, 'unexpected native browser');
      return await browserResults.shift()();
    },
  },
  'expo-video': {
    VideoView: 'VideoView',
    useVideoPlayer(source, setup) {
      const p = react.useMemo(() => {
        const listeners = new Map();
        const player = {
          source,
          status: 'loading',
          duration: 0,
          playing: false,
          currentTime: 0,
          play() {
            nativeCalls.push(['play', player]);
          },
          pause() {
            nativeCalls.push(['pause', player]);
          },
          addListener(event, fn) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(fn);
            return { remove: () => listeners.get(event).delete(fn) };
          },
          emit(event, value) {
            for (const fn of listeners.get(event) ?? []) fn(value);
          },
          callbacks(event) {
            return [...(listeners.get(event) ?? [])];
          },
        };
        setup?.(player);
        players.push(player);
        return player;
      }, [source]);
      react.useEffect(() => {
        p.released = false;
        return () => {
          p.released = true;
        };
      }, [p]);
      return p;
    },
  },
};
function load(file, from = root) {
  if (Object.hasOwn(stubs, file)) return stubs[file];
  let p = file.startsWith('@/') ? path.join(root, file.slice(2)) : path.resolve(from, file);
  if (!path.extname(p)) p += fs.existsSync(p + '.ts') ? '.ts' : '.tsx';
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
  new Function('require', 'module', 'exports', code)(
    (name) => load(name, path.dirname(p)),
    module,
    module.exports,
  );
  return module.exports;
}
stubs.expo = load(path.resolve(root, '../node_modules/expo/src/hooks/useEvent.ts'));
const runtime = load('@/i18n/runtime');
const { MediaMessage } = load('@/features/inbox/MediaMessage');
const { mediaMessagePresentation } = load('@/features/inbox/mediaMessagePresentation');
const { createMediaMessageBrowser } = load('@/features/inbox/mediaMessageBrowser');
function nodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap((v) => nodes(v, type));
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props.children, type)];
}
const one = (h, type) => {
  const values = nodes(h.tree, type);
  assert.equal(values.length, 1, type);
  return values[0].props;
};
const texts = (h) => nodes(h.tree, 'Text').map((n) => n.props.children);
const action = (name) => ({ nativeEvent: { actionName: name } });
const touch = (x) => ({ nativeEvent: { locationX: x } });
const layout = (width) => ({ nativeEvent: { layout: { width } } });
async function main() {
  const baseline = require('./inbox-media.baseline.json');
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
      assert.equal(crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'), hash, key);
    for (const value of Object.values(catalog).filter((_, i) =>
      Object.keys(catalog)[i].startsWith('inboxMedia.'),
    ))
      assert.ok(value);
  }
  for (const locale of ['en', 'fr', 'ar', 'ar-EG-u-nu-arab', 'en-US-u-nu-arab']) {
    const p = mediaMessagePresentation(locale),
      d = new Intl.NumberFormat(locale, { useGrouping: false });
    const pair = new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: 2 });
    for (const value of [0, 9.9, 60, 61.8, 3599, 3600, 7201])
      assert.equal(
        p.clock(value),
        `${d.format(Math.floor(value / 60))}:${pair.format(Math.floor(value % 60))}`,
      );
    for (const value of [-1, NaN, Infinity]) assert.equal(p.clock(value), p.clock(0));
    assert.ok(p.spokenTime(61).includes(d.format(1)));
  }
  assert.equal(mediaMessagePresentation('en').spokenTime(61.9), '1 minute 1 second');
  assert.equal(mediaMessagePresentation('fr').spokenTime(2), '2 secondes');
  let media = { id: 'm', url: '/media_download/one?x=opaque', kind: 'audio', title: 'Loading العربية' };
  let author = 'Audio message';
  const h = mount(() => jsx(MediaMessage, { media, author }));
  runtime.setAccountLocale('a', 'en');
  h.render();
  const p = players.at(-1),
    source = p.source;
  assert.deepEqual(source, { uri: media.url, headers: env.client.authHeaders });
  assert.equal(p.timeUpdateEventInterval, 0.25);
  assert.ok(texts(h).includes(media.title));
  assert.ok(texts(h).includes('Loading'));
  one(h, 'IconButton').onPress();
  assert.deepEqual(nativeCalls.at(-1), ['play', p]);
  p.emit('sourceLoad', { duration: 125.9 });
  p.emit('timeUpdate', { currentTime: 61.9 });
  p.emit('playingChange', { isPlaying: true });
  h.render();
  assert.equal(one(h, 'ProgressBar').value, 61.9 / 125.9);
  assert.ok(texts(h).includes('1:01'));
  assert.ok(texts(h).includes('-1:04'));
  assert.equal(one(h, 'Pressable').accessibilityValue.text, '1 minute 1 second of 2 minutes 5 seconds');
  one(h, 'Pressable').onLayout(layout(100));
  h.render();
  const count = players.length;
  for (const locale of ['fr', 'ar-EG-u-nu-arab', 'en']) {
    runtime.setAccountLocale('a', locale);
    media = { ...media, title: 'Raw title ' + locale };
    author += '!';
    h.render();
    assert.equal(players.length, count);
    assert.equal(players.at(-1), p);
    assert.equal(p.source, source);
    assert.equal(one(h, 'ProgressBar').value, 61.9 / 125.9);
    assert.equal(one(h, 'IconButton').icon, 'Pause');
    assert.equal(
      one(h, 'IconButton').accessibilityLabel,
      runtime.createTranslator(locale)('inboxMedia.pause', {
        label: runtime.createTranslator(locale)('inboxMedia.audioTitle', { title: media.title }),
      }),
    );
    assert.ok(texts(h).includes(mediaMessagePresentation(locale).clock(61.9)));
    one(h, 'Pressable').onPress(touch(50));
    assert.equal(p.currentTime, 62.95);
  }
  one(h, 'IconButton').onPress();
  assert.deepEqual(nativeCalls.at(-1), ['pause', p]);
  one(h, 'Pressable').onAccessibilityAction(action('increment'));
  assert.equal(p.currentTime, 76.9);
  one(h, 'Pressable').onAccessibilityAction(action('decrement'));
  assert.equal(p.currentTime, 46.9);
  one(h, 'Pressable').onPress(touch(-10));
  assert.equal(p.currentTime, 0);
  one(h, 'Pressable').onPress(touch(200));
  assert.equal(p.currentTime, 125.9);
  const oldControl = one(h, 'IconButton'),
    oldTrack = one(h, 'Pressable'),
    oldErrors = p.callbacks('statusChange');
  // An abandoned replacement does not retire committed playback callbacks.
  const original = media;
  media = { ...media, url: '/abandoned' };
  h.renderOnly();
  h.abandon();
  media = original;
  oldControl.onPress();
  assert.deepEqual(nativeCalls.at(-1), ['pause', p]);
  media = { ...media, url: '/replacement' };
  h.render();
  const p2 = players.at(-1);
  assert.notEqual(p2, p);
  assert.ok(p.released);
  const before = nativeCalls.length;
  oldControl.onPress();
  oldTrack.onLayout(layout(999));
  oldTrack.onPress(touch(30));
  oldTrack.onAccessibilityAction(action('increment'));
  for (const callback of oldErrors) callback({ status: 'error' });
  h.render();
  assert.equal(nativeCalls.length, before);
  assert.equal(p.currentTime, 125.9);
  assert.equal(one(h, 'IconButton').icon, 'Play');
  p2.emit('sourceLoad', { duration: 100 });
  h.render();
  one(h, 'Pressable').onPress(touch(50));
  assert.equal(p2.currentTime, 0, 'layout resets');
  p2.emit('statusChange', { status: 'error' });
  h.render();
  assert.equal(nodes(h.tree, 'IconButton').length, 0);
  assert.ok(texts(h).includes('This audio message can’t play here.'));
  const fallback = one(h, 'Button');
  const delayed = deferred();
  sessionResults.push(() => delayed.promise);
  const reqBefore = requests.length;
  fallback.onPress();
  fallback.onPress();
  h.render();
  assert.equal(requests.length, reqBefore + 1);
  assert.equal(one(h, 'Button').loading, true);
  assert.deepEqual(requests.at(-1), [
    'a',
    '/api/v1/login/session_token',
    { return_to: 'https://a.invalid/replacement' },
  ]);
  runtime.setAccountLocale('a', 'fr');
  h.render();
  assert.equal(one(h, 'Button').children, 'Ouvrir dans le navigateur');
  browserResults.push(() => Promise.reject(Error('native detail stays hidden')));
  delayed.resolve({ session_url: 'https://session.invalid/opaque' });
  await flush();
  h.render();
  assert.deepEqual(browsers.at(-1), ['https://session.invalid/opaque']);
  assert.ok(texts(h).includes('Impossible d’ouvrir le navigateur. Réessayez.'));
  assert.equal(one(h, 'Button').loading, false);
  // Retrying after failure is allowed; session endpoint failures retain shared absolute-URL fallback.
  sessionResults.push(() => Promise.reject(Error('school blocks session token')));
  browserResults.push(() => ({ type: 'opened' }));
  fallback.onPress();
  await flush();
  h.render();
  assert.deepEqual(browsers.at(-1), ['https://a.invalid/replacement']);
  assert.equal(nodes(h.tree, 'Text').filter((n) => n.props.accessibilityRole === 'alert').length, 0);
  // Every ownership dimension retires an in-flight session and the retained fallback.
  for (const dimension of ['url', 'kind', 'client', 'account']) {
    const late = deferred();
    sessionResults.push(() => late.promise);
    const oldFallback = one(h, 'Button');
    oldFallback.onPress();
    h.render();
    const b = browsers.length,
      r = requests.length;
    if (dimension === 'url') media = { ...media, url: media.url + '/new' };
    if (dimension === 'kind') media = { ...media, kind: media.kind === 'audio' ? 'video' : 'audio' };
    if (dimension === 'client') env = { ...env, client: client('new-client') };
    if (dimension === 'account') env = { ...env, account: { id: 'b' } };
    h.render();
    assert.equal(nodes(h.tree, 'Button').length, 0, 'failure resets on ' + dimension);
    oldFallback.onPress();
    assert.equal(requests.length, r);
    late.resolve({ session_url: 'https://stale.invalid/' });
    await flush();
    h.render();
    assert.equal(browsers.length, b);
    const current = players.at(-1);
    if (media.kind === 'video') {
      const v = one(h, 'VideoView');
      assert.equal(v.nativeControls, true);
      assert.equal(v.contentFit, 'contain');
      assert.equal(v.allowsPictureInPicture, true);
      assert.deepEqual(v.fullscreenOptions, { enable: true });
      assert.ok(v.accessibilityLabel.includes(media.title));
      const videoCount = players.length,
        videoSource = current.source;
      runtime.setAccountLocale(env.account.id, 'ar');
      media = { ...media, title: null };
      h.render();
      assert.equal(players.length, videoCount);
      assert.equal(current.source, videoSource);
      assert.ok(one(h, 'VideoView').accessibilityLabel.includes(author));
      runtime.setAccountLocale(env.account.id, 'fr');
      media = { ...media, title: 'Raw video' };
      h.render();
      assert.equal(players.length, videoCount);
      assert.ok(one(h, 'VideoView').accessibilityLabel.includes('Raw video'));
    }
    current.emit('statusChange', { status: 'error' });
    h.render();
    one(h, 'Button');
  }
  const pendingNative = deferred();
  sessionResults.push(() => ({ session_url: 'https://entered.invalid/' }));
  browserResults.push(() => pendingNative.promise);
  one(h, 'Button').onPress();
  await flush();
  h.render();
  const enteredRequests = requests.length;
  one(h, 'Button').onPress();
  assert.equal(requests.length, enteredRequests, 'duplicate native-pending tap');
  media = { ...media, url: null, title: null };
  h.render();
  assert.equal(nodes(h.tree, 'Button').length, 0);
  pendingNative.reject(Error('obsolete native failure'));
  await flush();
  h.render();
  assert.equal(nodes(h.tree, 'Text').filter((n) => n.props.accessibilityRole === 'alert').length, 0);
  media = { ...media, url: '/final', kind: 'audio' };
  h.render();
  runtime.setAccountLocale('b', 'en');
  h.render();
  assert.equal(one(h, 'IconButton').accessibilityLabel, `Play Audio message from ${author}`);
  const finalPlayer = players.at(-1);
  // Legacy duration fallback and zero-duration seeking arithmetic are retained.
  one(h, 'Pressable').onAccessibilityAction(action('increment'));
  assert.equal(finalPlayer.currentTime, 15);
  one(h, 'Pressable').onAccessibilityAction(action('decrement'));
  assert.equal(finalPlayer.currentTime, 0);
  finalPlayer.duration = 40;
  finalPlayer.emit('sourceLoad', { duration: 0 });
  h.render();
  one(h, 'Pressable').onLayout(layout(100));
  h.render();
  one(h, 'Pressable').onPress(touch(50));
  assert.equal(finalPlayer.currentTime, 20);
  h.replay();
  h.render();
  one(h, 'IconButton').onPress();
  assert.deepEqual(nativeCalls.at(-1), ['play', finalPlayer]);
  finalPlayer.emit('statusChange', { status: 'error' });
  h.render();
  const unmounted = deferred();
  sessionResults.push(() => unmounted.promise);
  one(h, 'Button').onPress();
  const b = browsers.length;
  h.unmount();
  unmounted.resolve({ session_url: 'https://unmounted.invalid' });
  await flush();
  assert.equal(browsers.length, b);
  // OAuth refresh can rotate credentials without replacing the Canvas client.
  // Retire the old source and its controls, including an old failed-source state.
  const rotatingMedia = { id: 'auth-media', url: '/rotating', kind: 'audio', title: null };
  const rotating = mount(() => jsx(MediaMessage, { media: rotatingMedia, author: 'Raw author' }));
  rotating.render();
  const oldPlayer = players.at(-1);
  const oldPlay = one(rotating, 'IconButton').onPress;
  env.client.authHeaders = { Authorization: 'Bearer synthetic-refreshed' };
  rotating.render();
  const refreshedPlayer = players.at(-1);
  assert.notEqual(refreshedPlayer, oldPlayer, 'credential rotation replaces the media source');
  assert.equal(refreshedPlayer.source.headers.Authorization, 'Bearer synthetic-refreshed');
  const callsBeforeOldPlay = nativeCalls.length;
  oldPlay();
  assert.equal(nativeCalls.length, callsBeforeOldPlay, 'old credential controls are retired');
  refreshedPlayer.emit('statusChange', { status: 'error' });
  rotating.render();
  const oldFallback = one(rotating, 'Button').onPress;
  env.client.authHeaders = { Authorization: 'Bearer synthetic-refreshed-again' };
  rotating.render();
  assert.equal(nodes(rotating.tree, 'Button').length, 0, 'new credentials clear source failure');
  assert.equal(nodes(rotating.tree, 'IconButton').length, 1);
  assert.equal(players.at(-1).source.headers.Authorization, 'Bearer synthetic-refreshed-again');
  const requestsBeforeOldFallback = requests.length;
  oldFallback();
  await flush();
  assert.equal(requests.length, requestsBeforeOldFallback, 'old credential browser control is retired');
  rotating.unmount();
  // Local launch helper also separates replayed generations while an old request is pending.
  let token = {},
    state = [];
  const launch = createMediaMessageBrowser(
    env.client,
    '/helper',
    () => token,
    (s) => state.push(s),
  );
  const first = deferred(),
    second = deferred();
  sessionResults.push(
    () => first.promise,
    () => second.promise,
  );
  const a = launch();
  token = {};
  const c = launch();
  first.resolve({ session_url: 'https://old.invalid' });
  await a;
  browserResults.push(() => ({ type: 'cancel' }));
  second.resolve({ session_url: 'https://new.invalid' });
  await c;
  assert.deepEqual(state, ['opening', 'opening', 'idle']);
  assert.deepEqual(browsers.at(-1), ['https://new.invalid']);
  assert.equal(sessionResults.length, 0);
  assert.equal(browserResults.length, 0);
  assert.deepEqual(unexpected, []);
  console.log(
    'Inbox media: production presentation, source/player lifetimes, browser/session protocol and historical hashes passed (' +
      process.env.TZ +
      ').',
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
