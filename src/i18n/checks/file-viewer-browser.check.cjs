/* global __dirname */
// Production FileViewer -> ErrorState, file browser claim, fileWebUrl and shared
// openSignedIn/sessionUrl. Synthetic commit/discard hooks, metadata/download state,
// account/navigation, native browser/Alert and deferred transport; no real effects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const original = process.env.FILE_VIEWER_BROWSER_ORIGINAL;
const cache = new Map();
let scope, env, query, actions, props, route, focused, locale, stored;
const requests = [],
  launches = [],
  alerts = [],
  listeners = new Set();
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const effect = (fn, deps) => {
  const s = scope,
    i = s.cursor++,
    old = s.slots[i];
  if (!old || !deps || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
    const slot = { deps, fn, cleanup: null };
    s.slots[i] = slot;
    s.effects.push(() => {
      old?.cleanup?.();
      slot.cleanup = fn();
    });
  }
};
const react = {
  useRef(v) {
    const s = scope,
      i = s.cursor++;
    return (s.slots[i] ??= { current: v });
  },
  useState(v) {
    const r = react.useRef(typeof v === 'function' ? v() : v);
    return [
      r.current,
      (next) => {
        r.current = typeof next === 'function' ? next(r.current) : next;
      },
    ];
  },
  useMemo(fn, deps) {
    const s = scope,
      i = s.cursor++,
      old = s.slots[i];
    if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) s.slots[i] = { deps, value: fn() };
    return s.slots[i].value;
  },
  useEffect: effect,
  useLayoutEffect: effect,
};
function mount(fn) {
  const s = { slots: [], effects: [], cursor: 0 };
  let previous;
  return {
    renderOnly() {
      previous = s.slots.slice();
      s.cursor = 0;
      s.effects = [];
      const old = scope;
      scope = s;
      try {
        return fn();
      } finally {
        scope = old;
      }
    },
    commit() {
      previous = undefined;
      for (const f of s.effects.splice(0)) f();
    },
    render() {
      const tree = this.renderOnly();
      this.commit();
      return tree;
    },
    abandon() {
      s.slots = previous;
      s.effects = [];
    },
    replay() {
      for (const slot of s.slots) slot?.cleanup?.();
      for (const slot of s.slots) if (slot?.fn) slot.cleanup = slot.fn();
    },
    unmount() {
      for (const slot of s.slots) slot?.cleanup?.();
    },
  };
}
const jsx = (type, props) => ({ type, props });
const nodes = (t) =>
  !t || typeof t !== 'object'
    ? []
    : Array.isArray(t)
      ? t.flatMap(nodes)
      : [t, ...nodes(t.props?.children)];
const one = (t, type) => nodes(t).find((n) => n.type === type)?.props;
const child = (t, name) => nodes(t).find((n) => n.type?.name === name);
const inert = new Proxy({}, { get: (_o, k) => k });
const unexpected = () => {
  throw Error('Unexpected native/storage/action effect');
};
class CanvasError extends Error {
  constructor(status) {
    super('Raw error');
    this.status = status;
  }
}
class CanvasAuthError extends CanvasError {}
class CanvasNetworkError extends Error {}
class FileDownloadError extends Error {
  constructor(kind) {
    super('Raw download error');
    this.kind = kind;
  }
}
const navigation = {
  isFocused: () => focused,
  addListener: (name, fn) => {
    assert.equal(name, 'blur');
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
const mocks = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': {
    Platform: { OS: 'android' },
    View: 'View',
    Alert: { alert: (...a) => alerts.push(a) },
  },
  'expo-router': {
    useIsFocused: () => focused,
    useNavigation: () => navigation,
    useRoute: () => route,
  },
  'expo-router/react-navigation': { useHeaderHeight: () => 88 },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 20 }) },
  'lucide-react-native': inert,
  '@/design': new Proxy(
    { useTheme: () => ({ shadows: { raised: 'shadow' } }) },
    { get: (o, k) => o[k] ?? k },
  ),
  '@/canvas/client': { CanvasError, CanvasAuthError, CanvasNetworkError },
  '@/canvas/session': {
    useCanvas: () => env,
    isStoredAccountClient: (id, client) => stored && id === env.account.id && client === env.client,
  },
  '@/canvas/api/files': { useFile: () => query },
  '@/features/files/download': { FileDownloadError, cachedMeta: () => undefined },
  '@/features/files/open': { seededFile: () => undefined },
  '@/features/files/useFileActions': { useFileActions: () => actions },
  '@/features/files/FileCard': { FileHero: 'FileHero', FileCard: 'FileCard' },
  '@/features/files/FileActionBar': { FileActionBar: 'FileActionBar' },
  '@/features/files/previews/ImagePreview': { ImagePreview: 'ImagePreview' },
  '@/features/files/previews/MediaPreviews': {
    AudioPreview: 'AudioPreview',
    VideoPreview: 'VideoPreview',
  },
  '@/features/files/previews/TextPreviews': {
    TextPreview: 'TextPreview',
    MarkdownPreview: 'MarkdownPreview',
    CsvPreview: 'CsvPreview',
  },
  '@/features/files/previews/WebPreviews': { ANDROID_PDF_LIMIT: 30000000 },
  '@/i18n': {
    useTranslation: () => ({ t: load('@/i18n/runtime').createTranslator(locale), locale }),
  },
  'expo-web-browser': {
    openBrowserAsync: (...args) => {
      const d = deferred();
      launches.push({ args, ...d });
      return d.promise;
    },
  },
  '@react-native-async-storage/async-storage': { getItem: unexpected, setItem: unexpected },
  'expo-clipboard': {},
  'expo-file-system': {},
  'expo-media-library': {},
  'expo-sharing': {},
};
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mocks[key]) return mocks[key];
  if (!key.startsWith('@/')) return require(key);
  const file = ['.ts', '.tsx', '/index.ts']
    .map((ext) => path.join(root, key.slice(2)) + ext)
    .find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const source = original && key === '@/features/files/FileViewer' ? original : file;
  const js = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
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
const makeClient = (baseUrl = 'https://school.invalid') => ({
  baseUrl,
  authHeaders: {},
  get: (...args) => {
    const d = deferred();
    requests.push({ args, ...d });
    return d.promise;
  },
});
function reset(branch = 'metadata') {
  assert.equal(listeners.size, 0);
  requests.length = launches.length = alerts.length = 0;
  env = { account: { id: 'a', baseUrl: 'https://school.invalid' }, client: makeClient() };
  route = { key: 'route-a', name: 'file', params: { fileId: 'f' } };
  focused = stored = true;
  locale = 'en';
  props = { fileId: 'f', courseId: 'c', active: true };
  query = {
    isPending: false,
    isError: true,
    error: new CanvasError(500),
    refetch: () => Promise.resolve(),
  };
  actions = {
    download: {
      status: 'error',
      error: new FileDownloadError('server'),
      ensure: () => Promise.resolve(),
    },
  };
  if (branch === 'download')
    query.data = {
      id: 'f',
      name: 'RAW ملف',
      filename: 'raw.txt',
      size: 42,
      url: 'https://raw.invalid/download?raw=%2f',
      contentType: 'text/plain',
      context: { type: 'course', id: 'c' },
    };
}
const { FileViewer } = load('@/features/files/FileViewer');
function boundary() {
  const viewer = mount(() => FileViewer(props));
  let node, error, tree;
  return {
    render() {
      const next = child(viewer.render(), 'ErrorState');
      if (!next) {
        error?.unmount();
        error = null;
        tree = null;
        return;
      }
      node = next;
      error ??= mount(() => node.type(node.props));
      tree = error.render();
      return tree;
    },
    press() {
      return one(tree, 'Button').onPress;
    },
    get node() {
      return node;
    },
    get error() {
      return error;
    },
    unmount() {
      error?.unmount();
      viewer.unmount();
    },
  };
}
(async () => {
  if (original) {
    reset();
    const b = boundary();
    b.render();
    const press = b.press();
    const first = press(),
      second = press();
    assert.equal(requests.length, 2, 'original duplicate entry reproduced');
    b.unmount();
    requests[0].resolve({ session_url: 'https://signed.invalid/obsolete' });
    requests[1].reject(Error('school blocks sessions'));
    await flush();
    assert.equal(launches.length, 2, 'original opens after unmount, on success AND fallback');
    launches[0].reject(Error('synthetic native rejection'));
    launches[1].resolve();
    await assert.rejects(first, /synthetic native rejection/);
    await second;
    console.log(
      'BEFORE reproduced: duplicate lookups, obsolete success/fallback browser entry after unmount, rejected Button promise',
    );
    return;
  }
  let cases = 0;
  const finish = (request, outcome, target = 'https://signed.invalid/exact?sig=%2f#RAW') =>
    outcome === 'success'
      ? request.resolve({ session_url: target })
      : request.reject(Error('Synthetic session denied'));
  const changes = {
    account: () => {
      env = { ...env, account: { ...env.account, id: 'b' } };
    },
    client: () => {
      env = { ...env, client: makeClient() };
    },
    baseUrl: () => {
      env = { ...env, account: { ...env.account, baseUrl: 'https://other.invalid' } };
    },
    clientBaseUrl: () => {
      env.client.baseUrl = 'https://other.invalid';
    },
    fileId: () => {
      props = { ...props, fileId: 'other' };
    },
    courseId: () => {
      props = { ...props, courseId: 'other' };
    },
    canvasUrl: () => {
      props = { ...props, canvasUrl: 'https://school.invalid/other?raw=%2f' };
    },
    error: () => {
      query.error = new CanvasError(500);
      actions.download.error = new FileDownloadError('server');
    },
    kind: () => {
      query.error = new CanvasError(403);
      actions.download.error = new FileDownloadError('forbidden');
    },
    source: () => {
      if (query.data) query.data = undefined;
      else
        query.data = {
          id: 'f',
          filename: 'raw.txt',
          name: 'RAW',
          size: 1,
          contentType: 'text/plain',
        };
    },
    route: () => {
      route = { ...route, key: 'new-route' };
    },
    routeParams: () => {
      route = { ...route, params: { fileId: 'other' } };
    },
    focus: () => {
      focused = false;
      for (const fn of [...listeners]) fn();
    },
    active: () => {
      props = { ...props, active: false };
    },
    removedAccount: () => {
      stored = false;
    },
    unmount: () => {},
  };
  for (const branch of ['metadata', 'download']) {
    // Exact URLs and native argument list; session failures preserve ordinary absolute URL fallback.
    for (const outcome of ['success', 'fallback'])
      for (const url of [
        undefined,
        '/courses/c/files/f?raw=%2f#ع',
        'https://external.invalid/exact?raw=%2f',
      ]) {
        reset(branch);
        props.canvasUrl = url;
        const b = boundary();
        const tree = b.render();
        assert.equal(!!one(tree, 'FileHero'), branch === 'download');
        if (query.data) assert.equal(one(tree, 'FileHero').file, query.data);
        const expected =
          url ??
          (branch === 'metadata'
            ? 'https://school.invalid/files/f'
            : 'https://school.invalid/courses/c/files/f');
        const press = b.press(),
          work = press();
        await press();
        assert.equal(requests.length, 1, 'same-turn duplicate lookup');
        assert.deepEqual(requests[0].args, [
          '/api/v1/login/session_token',
          { return_to: new URL(expected, env.client.baseUrl).toString() },
        ]);
        finish(requests[0], outcome);
        await flush();
        assert.deepEqual(launches[0].args, [
          outcome === 'success'
            ? 'https://signed.invalid/exact?sig=%2f#RAW'
            : new URL(expected, env.client.baseUrl).toString(),
        ]);
        await press();
        assert.equal(requests.length, 1, 'duplicate while native browser pending');
        launches[0].resolve();
        await work;
        b.unmount();
        cases++;
      }
    for (const [name, change] of Object.entries(changes))
      for (const outcome of ['success', 'fallback']) {
        reset(branch);
        const b = boundary();
        b.render();
        const press = b.press(),
          work = press();
        assert.equal(requests.length, 1);
        change();
        if (name === 'unmount') b.unmount();
        else b.render();
        await press();
        assert.equal(requests.length, 1, name + ': stale control must not start lookup');
        finish(requests[0], outcome);
        await work;
        assert.equal(launches.length, 0, branch + ':' + name + ':' + outcome);
        assert.equal(alerts.length, 0);
        if (name !== 'unmount') b.unmount();
        cases++;
      }
    // Source record replacement / in-place URL changes without changing the rendered destination.
    if (branch === 'download')
      for (const mutate of [false, true]) {
        reset(branch);
        const b = boundary();
        b.render();
        const old = b.press(),
          work = old();
        if (mutate) query.data.url = 'https://raw.invalid/replaced';
        else query.data = { ...query.data };
        b.render();
        await old();
        assert.equal(requests.length, 1);
        finish(requests[0], 'success');
        await work;
        assert.equal(launches.length, 0);
        b.unmount();
        cases++;
      }
    // Locale-only rerenders and account/route object clones keep valid work; rejection
    // uses the latest committed translator, resolves the callback, then allows retry.
    for (const outcome of ['success', 'fallback']) {
      reset(branch);
      const b = boundary();
      b.render();
      const press = b.press(),
        work = press();
      locale = 'fr';
      env = { ...env, account: { ...env.account } };
      route = { ...route };
      b.render();
      await b.press()();
      assert.equal(requests.length, 1);
      finish(requests[0], outcome);
      await flush();
      assert.equal(launches.length, 1);
      locale = 'ar';
      b.render();
      launches[0].reject(Error('RAW native error must not leak'));
      await work;
      const t = load('@/i18n/runtime').createTranslator('ar');
      assert.deepEqual(alerts, [
        [t('conferences.browserError'), t('files.actions.error.unexpected')],
      ]);
      const retry = b.press()();
      assert.equal(requests.length, 2);
      finish(requests[1], 'success');
      await flush();
      launches[1].resolve();
      await retry;
      b.unmount();
      cases++;
    }
    // An entered browser cannot be undone. Its obsolete rejection is quiet and its
    // finally cannot release a replacement operation, even when it settles last.
    for (const oldFirst of [false, true]) {
      reset(branch);
      const b = boundary();
      b.render();
      const old = b.press(),
        first = old();
      finish(requests[0], 'success');
      await flush();
      changes.error();
      b.render();
      const current = b.press(),
        second = current();
      if (oldFirst) {
        launches[0].reject(Error('obsolete'));
        await first;
      }
      await current();
      assert.equal(requests.length, 2);
      finish(requests[1], 'success');
      await flush();
      if (!oldFirst) {
        launches[0].reject(Error('obsolete'));
        await first;
      }
      await current();
      assert.equal(requests.length, 2, 'old finally must not clear new claim');
      assert.equal(alerts.length, 0);
      assert.equal(launches.length, 2);
      launches[1].resolve();
      await second;
      b.unmount();
      cases++;
    }
    // Uncommitted/discarded child renders never retire the current claim or publish
    // their translation. Real commit effects alone own mutable lifecycle state.
    reset(branch);
    const b = boundary();
    b.render();
    const work = b.press()();
    locale = 'fr';
    const oldProps = b.node.props;
    b.node.props = { ...oldProps, browserUrl: 'https://uncommitted.invalid' };
    const draft = b.error.renderOnly();
    await one(draft, 'Button').onPress();
    assert.equal(requests.length, 1);
    b.error.abandon();
    b.node.props = oldProps;
    finish(requests[0], 'success');
    await flush();
    launches[0].reject(Error('current'));
    await work;
    assert.equal(
      alerts[0][0],
      load('@/i18n/runtime').createTranslator('en')('conferences.browserError'),
    );
    b.unmount();
    cases++;
    // A blur/focus round trip between commits still retires old controls and
    // gives the refocused screen a usable replacement claim.
    reset(branch);
    const focus = boundary();
    focus.render();
    const oldPress = focus.press(),
      oldWork = oldPress();
    focused = false;
    for (const fn of [...listeners]) fn();
    focused = true;
    await oldPress();
    assert.equal(requests.length, 1);
    focus.render();
    const newWork = focus.press()();
    assert.equal(requests.length, 2);
    finish(requests[0], 'success');
    await oldWork;
    assert.equal(launches.length, 0);
    finish(requests[1], 'fallback');
    await flush();
    assert.equal(launches.length, 1);
    launches[0].resolve();
    await newWork;
    focus.unmount();
    cases++;
    // Replay retires old promises; a new synchronous claim survives old finalization.
    reset(branch);
    const replay = boundary();
    replay.render();
    const first = replay.press()();
    replay.error.replay();
    const second = replay.press()();
    assert.equal(requests.length, 2);
    finish(requests[0], 'fallback');
    await first;
    await replay.press()();
    assert.equal(requests.length, 2);
    finish(requests[1], 'success');
    await flush();
    assert.equal(launches.length, 1);
    launches[0].resolve();
    await second;
    replay.unmount();
    cases++;
  }
  // Real fileWebUrl preserves group/account destinations and its intentionally
  // different empty-canvasUrl behavior from metadata-without-file errors.
  for (const context of [undefined, { type: 'group', id: 'g' }]) {
    reset('download');
    props.canvasUrl = '';
    query.data.context = context;
    const b = boundary();
    b.render();
    const work = b.press()();
    const expected = context
      ? 'https://school.invalid/groups/g/files/f'
      : 'https://school.invalid/files/f';
    assert.deepEqual(requests[0].args, ['/api/v1/login/session_token', { return_to: expected }]);
    finish(requests[0], 'fallback');
    await flush();
    assert.deepEqual(launches[0].args, [expected]);
    launches[0].resolve();
    await work;
    b.unmount();
    cases++;
  }
  // Policy remains unchanged in both branches, including absent/empty browser URLs.
  for (const kind of [
    'not_found',
    'forbidden',
    'locked',
    'signed_out',
    'offline',
    'server',
    'storage',
    'unknown',
    'future',
  ]) {
    reset('download');
    actions.download.error = new FileDownloadError(kind);
    const b = boundary();
    const tree = b.render(),
      empty = one(tree, 'EmptyState');
    assert.equal(!!empty.action, !['not_found', 'forbidden'].includes(kind));
    assert.equal(
      !!one(tree, 'Button'),
      ['forbidden', 'signed_out', 'server', 'unknown'].includes(kind),
    );
    const t = load('@/i18n/runtime').createTranslator('en');
    assert.equal(
      empty.title,
      t('files.viewer.error.' + (kind === 'future' ? 'unknown' : kind) + '.title'),
    );
    b.unmount();
    cases++;
  }
  for (const [error, kind] of [
    [new CanvasError(404), 'not_found'],
    [new CanvasError(403), 'forbidden'],
    [new CanvasError(401), 'forbidden'],
    [new CanvasAuthError(401), 'signed_out'],
    [new CanvasNetworkError(), 'offline'],
    [new CanvasError(500), 'server'],
    [new Error('raw'), 'unknown'],
  ]) {
    reset();
    query.error = error;
    const b = boundary(),
      tree = b.render();
    assert.equal(b.node.props.kind, kind);
    assert.equal(!!one(tree, 'EmptyState').action, !['not_found', 'forbidden'].includes(kind));
    assert.equal(
      !!one(tree, 'Button'),
      ['forbidden', 'signed_out', 'server', 'unknown'].includes(kind),
    );
    b.unmount();
    cases++;
  }
  reset();
  props.canvasUrl = '';
  const emptyUrl = boundary();
  assert.equal(one(emptyUrl.render(), 'Button'), undefined);
  emptyUrl.unmount();
  // Metadata/download recovery unmounts ErrorState; pending work cannot enter.
  for (const branch of ['metadata', 'download']) {
    reset(branch);
    const b = boundary();
    b.render();
    const press = b.press(),
      work = press();
    if (branch === 'metadata') query.isPending = true;
    else {
      actions.download.status = 'idle';
      query.isError = false;
    }
    b.render();
    await press();
    assert.equal(requests.length, 1);
    finish(requests[0], 'success');
    await work;
    assert.equal(launches.length, 0);
    b.unmount();
    cases++;
  }
  console.log(
    `FileViewer browser: ${cases} synthetic lifecycle/policy cases passed (${process.env.TZ || 'default TZ'})`,
  );
  // All historical values are preserved; this portable fixture permits later keys.
  const baseline = require('./browser-catalogs.baseline.json');
  assert.equal(baseline.catalogKeys.length, 3260);
  for (const language of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + language)[language];
    assert.equal(
      crypto.createHash('sha256')
        .update(JSON.stringify(baseline.catalogKeys.map((key) => [key, catalog[key]])))
        .digest('hex'),
      baseline.catalogHashes[language],
      language + ': all historical catalog values',
    );
  }
  console.log('Catalog preservation: 3260 reviewed values per language');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
