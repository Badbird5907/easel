/* global __dirname */
// Production About, legal adapters and developer persistence with synthetic hooks,
// native/query/storage/browser boundaries. No HTTP or real account/native effects.
// The reconciler models commits, abandoned renders and effect replay, not React Compiler.
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
        assert.ok(s.mounted, 'update after unmount');
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
react.useSyncExternalStore = (subscribe, snapshot) => {
  const [, update] = react.useState(0);
  react.useLayoutEffect(() => subscribe(() => update((n) => n + 1)), [subscribe]);
  return snapshot();
};
let env, terms, profile, locale, focused, development, dev, now, browserQueue;
let storedValue = null;
let rejectStorage = false;
const calls = { browser: [], storage: [], notices: [], success: [] };
const navigation = { isFocused: () => focused };
const application = { nativeApplicationVersion: '001.02-beta+9', nativeBuildVersion: '00017' };
const constants = { expoConfig: { version: 'config.001' } };
const platform = { OS: 'ios' };
const design = Object.fromEntries(
  [
    'Button',
    'Callout',
    'Card',
    'IconTile',
    'ListGroup',
    'ListItem',
    'Screen',
    'Sheet',
    'Skeleton',
    'Switch',
    'Text',
  ].map((k) => [k, k]),
);
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'View', Platform: platform },
  'lucide-react-native': { FileText: 'FileText', Lock: 'Lock', ShieldCheck: 'ShieldCheck' },
  'expo-router': {
    Stack: { Screen: 'Stack.Screen' },
    useIsFocused: () => focused,
    useNavigation: () => navigation,
  },
  'expo-application': application,
  'expo-constants': { default: constants, __esModule: true },
  'expo-web-browser': {
    openBrowserAsync: (url) => {
      calls.browser.push(url);
      return browserQueue.length ? browserQueue.shift() : Promise.resolve({ type: 'dismiss' });
    },
  },
  '@react-native-async-storage/async-storage': {
    __esModule: true,
    default: {
      getItem: async (key) => {
        calls.storage.push(['get', key]);
        return storedValue;
      },
      setItem: async (...args) => {
        calls.storage.push(['set', ...args]);
        if (rejectStorage) throw Error('synthetic storage failure');
      },
    },
  },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/query': { useCanvasQuery: (key) => (key[1] === 'terms' ? terms : profile) },
  '@tanstack/react-query': {
    useQuery: () => {
      throw Error('unexpected sign-in query');
    },
  },
  '@/features/content/RichContent': { RichContent: 'RichContent' },
  '@/features/settings/developer': { useDeveloperMode: () => dev.useDeveloperMode() },
  '@/design': {
    ...design,
    haptics: { success: () => calls.success.push(true) },
    useToast: () => ({ show: (message) => calls.notices.push(message), element: null }),
  },
  '@/i18n': { useTranslation: () => ({ locale, t: runtime.createTranslator(locale) }) },
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
  new Function('require', 'module', 'exports', '__DEV__', 'Date', code)(
    (name) => load(name, path.dirname(p)),
    module,
    module.exports,
    development,
    { now: () => now },
  );
  return module.exports;
}
const runtime = load('@/i18n/runtime');
const About = load('@/app/(app)/about').default;
const legal = load('@/canvas/api/legal');
const nodes = (tree, type) => {
  if (Array.isArray(tree)) return tree.flatMap((v) => nodes(v, type));
  if (!tree || typeof tree !== 'object') return [];
  return [
    ...(tree.type === type ? [tree.props] : []),
    ...nodes(tree.props.children, type),
    ...nodes(tree.props.trailing, type),
    ...nodes(tree.props.leading, type),
  ];
};
const first = (h, type) => nodes(h.tree, type)[0];
const tr = (key, args) => runtime.createTranslator(locale)('settingsAbout.' + key, args);
const row = (h, key) => nodes(h.tree, 'ListItem').find((n) => n.title === tr(key));
const sheet = (h) => first(h, 'Sheet');
const browse = (h) => first(h, 'Button');
const tap = (h, count = 1, gap = 1) => {
  for (let i = 0; i < count; i++) {
    now += gap;
    row(h, 'version').onPress();
  }
};
const writes = () => calls.storage.filter((v) => v[0] === 'set');
async function setup(options = {}) {
  for (const values of Object.values(calls)) values.length = 0;
  locale = options.locale ?? 'en';
  focused = true;
  development = options.development ?? false;
  storedValue = options.storedValue ?? null;
  rejectStorage = options.rejectStorage ?? false;
  env = {
    account: {
      id: 'a',
      user: { id: 'u' },
      host: 'School',
      baseUrl: 'https://school.invalid',
      authMethod: 'oauth',
    },
    client: {},
  };
  terms = {
    data: {
      html: '<p>Terms of use — العربية</p>',
      url: 'https://terms.invalid/Terms%20of%20use',
      none: false,
    },
    isPending: false,
    isError: false,
  };
  profile = { data: { loginId: 'Unavailable' }, isPending: false, isError: false };
  application.nativeApplicationVersion = '001.02-beta+9';
  application.nativeBuildVersion = '00017';
  constants.expoConfig = { version: 'config.001' };
  platform.OS = 'ios';
  now = 10000;
  browserQueue = [];
  const file = path.join(root, 'features/settings/developer.ts');
  cache.delete(file);
  const adapter = stubs['@/features/settings/developer'];
  delete stubs['@/features/settings/developer'];
  dev = load(file);
  stubs['@/features/settings/developer'] = adapter;
  const h = mount(() => jsx(About, {}));
  h.render();
  await flush();
  h.render();
  return h;
}
async function main() {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings-about.baseline.json')));
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2880);
    for (const [key, hash] of Object.entries(baseline.catalogs[lang])) {
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
        hash,
        lang + '/' + key,
      );
    }
    assert.equal(Object.keys(catalog).filter((key) => key.startsWith('settingsAbout.')).length, 33);
    let h = await setup({ locale: lang });
    assert.equal(first(h, 'Stack.Screen').options.title, tr('title'));
    assert.equal(row(h, 'school').value, 'School');
    assert.equal(row(h, 'loginId').value, 'Unavailable');
    assert.equal(row(h, 'version').value.replace(/[\u2068\u2069]/g, ''), '001.02-beta+9 (00017)');
    assert.ok(row(h, 'version').accessibilityLabel.includes('001.02-beta+9'));
    assert.ok(row(h, 'version').accessibilityLabel.includes('00017'));
    assert.equal(row(h, 'signedInWith').value, tr('schoolSignIn'));
    env.account.authMethod = 'token';
    h.render();
    assert.equal(row(h, 'signedInWith').value, tr('accessToken'));
    for (const raw of ['Unknown', 'Not shown by your school', '', 'الإصدار']) {
      profile.data.loginId = raw;
      application.nativeApplicationVersion = raw;
      h.render();
      assert.equal(row(h, 'loginId').value, raw);
      assert.equal(row(h, 'version').value.replace(/[\u2068\u2069]/g, ''), raw + ' (00017)');
    }
    application.nativeApplicationVersion = null;
    application.nativeBuildVersion = null;
    h.render();
    assert.equal(row(h, 'version').value, 'config.001');
    constants.expoConfig = null;
    h.render();
    assert.equal(row(h, 'version').value, tr('unknown'));
    profile.data.loginId = null;
    h.render();
    assert.equal(row(h, 'loginId').value, tr('notShown'));
    profile = { data: undefined, isError: true, isPending: false };
    h.render();
    assert.equal(row(h, 'loginId').value, tr('unavailable'));
    profile = { data: undefined, isError: false, isPending: true };
    h.render();
    assert.equal(row(h, 'loginId').value, undefined);
    assert.equal(nodes(h.tree, 'Skeleton').length, 1);
    for (const os of ['ios', 'android']) {
      platform.OS = os;
      h.render();
      assert.ok(
        nodes(h.tree, 'Text').some((n) => n.children === tr(os === 'ios' ? 'privacyIos' : 'privacyAndroid')),
      );
    }
    row(h, 'terms').onPress();
    h.render();
    assert.equal(sheet(h).visible, true);
    assert.equal(first(h, 'RichContent').html, terms.data.html);
    assert.equal(sheet(h).title, tr('terms'));
    assert.equal(browse(h).children, tr('openBrowser'));
    await row(h, 'privacyPolicy').onPress();
    await flush();
    assert.deepEqual(calls.browser, ['https://school.invalid/privacy_policy']);
    tap(h, 3);
    assert.equal(calls.notices.length, 0);
    assert.equal(writes().length, 0);
    for (const left of [3, 2, 1]) {
      tap(h);
      assert.equal(calls.notices.at(-1), tr('moreTaps', { count: left }));
    }
    assert.equal(writes().length, 0);
    tap(h);
    tap(h, 8);
    assert.deepEqual(writes(), [['set', 'easel.developerMode', '1']]);
    assert.equal(calls.success.length, 1);
    assert.equal(calls.notices.at(-1), tr('enabledNotice'));
    h.render();
    tap(h);
    assert.equal(calls.notices.at(-1), tr('alreadyOn'));
    const toggle = first(h, 'Switch').onValueChange;
    toggle(false);
    toggle(false);
    toggle(true);
    assert.deepEqual(
      writes().map((w) => w[2]),
      ['1', '0'],
    );
    h.render();
    assert.equal(first(h, 'Switch'), undefined);
    tap(h, 7);
    h.render();
    assert.deepEqual(
      writes().map((w) => w[2]),
      ['1', '0', '1'],
    );
    h.unmount();
    h = await setup({ locale: lang, development: true });
    assert.equal(first(h, 'Switch').disabled, true);
    first(h, 'Switch').onValueChange(false);
    tap(h, 10);
    assert.equal(writes().length, 0);
    assert.equal(calls.success.length, 0);
    assert.equal(calls.notices.at(-1), tr('alwaysOnNotice'));
    h.unmount();
  }
  // Existing persisted release preference loads; a storage rejection does not change
  // the production hook's immediate in-memory toggle or create an About lock.
  let persisted = await setup({ storedValue: '1', rejectStorage: true });
  assert.equal(first(persisted, 'Switch').value, true);
  first(persisted, 'Switch').onValueChange(false);
  await flush();
  persisted.render();
  assert.equal(first(persisted, 'Switch'), undefined);
  tap(persisted, 7);
  await flush();
  persisted.render();
  assert.equal(first(persisted, 'Switch').value, true);
  assert.deepEqual(
    writes().map((w) => w[2]),
    ['0', '1'],
  );
  persisted.unmount();
  for (const lang of ['en', 'fr', 'ar']) {
    const translate = runtime.createTranslator(lang);
    for (const count of [1, 2, 3]) {
      const notice = translate('settingsAbout.moreTaps', { count });
      assert.ok(notice.includes(new Intl.NumberFormat(lang).format(count)));
      assert.ok(!notice.includes('{count}'));
    }
    if (lang === 'en') {
      assert.match(translate('settingsAbout.moreTaps', { count: 1 }), /1 more time to/);
      assert.match(translate('settingsAbout.moreTaps', { count: 3 }), /3 more times to/);
    }
  }
  // Exact original timing: <1500 continues; 1500 and 1501 reset. Seven taps enable.
  for (const gap of [1499, 1500, 1501]) {
    const h = await setup();
    tap(h, 6);
    tap(h, 1, gap);
    assert.equal(writes().length, gap === 1499 ? 1 : 0);
    if (gap !== 1499) {
      tap(h, 5);
      assert.equal(writes().length, 0);
      tap(h);
      assert.equal(writes().length, 1);
    }
    h.unmount();
  }
  let h = await setup();
  tap(h, 4);
  row(h, 'terms').onPress();
  h.render();
  const oldClose = sheet(h).onClose,
    oldBrowse = browse(h).onPress;
  const rawHtml = first(h, 'RichContent').html;
  locale = 'ar';
  terms = { ...terms, data: { ...terms.data } };
  h.render();
  assert.equal(sheet(h).visible, true);
  assert.equal(first(h, 'RichContent').html, rawHtml);
  tap(h, 3);
  assert.equal(writes().length, 1);
  oldClose();
  h.render();
  assert.equal(sheet(h).visible, false);
  oldBrowse();
  await flush();
  assert.equal(calls.browser.length, 0);
  row(h, 'terms').onPress();
  h.render();
  oldClose();
  h.render();
  assert.equal(sheet(h).visible, true);
  // Hidden sheet browser callbacks cannot launch, but fresh controls remain usable.
  browse(h).onPress();
  await flush();
  assert.deepEqual(calls.browser, [terms.data.url]);
  h.unmount();

  // Same-resource query clones and locale switches keep an entered browser claim.
  h = await setup();
  row(h, 'terms').onPress();
  h.render();
  const sameResource = deferred();
  browserQueue.push(sameResource.promise);
  browse(h).onPress();
  terms = { ...terms, data: { ...terms.data }, isError: true };
  locale = 'fr';
  h.render();
  assert.equal(sheet(h).visible, true);
  browse(h).onPress();
  assert.equal(calls.browser.length, 1);
  sameResource.reject(Error('Unknown'));
  await flush();
  browse(h).onPress();
  await flush();
  assert.equal(calls.browser.length, 2);
  h.unmount();

  // Query failure still exposes the web fallback; none wins over HTML; pending blocks callbacks.
  for (const variant of ['none', 'pending', 'url', 'missing', 'error', 'cached-error', 'empty-url']) {
    h = await setup();
    if (variant === 'none') terms.data.none = true;
    if (variant === 'pending') terms.isPending = true;
    if (variant === 'url') terms.data.html = null;
    if (variant === 'missing' || variant === 'error') terms.data = undefined;
    if (variant === 'error' || variant === 'cached-error') terms.isError = true;
    if (variant === 'empty-url') terms.data = { html: null, url: '', none: false };
    h.render();
    browse(h).onPress();
    await flush();
    assert.equal(calls.browser.length, 0);
    if (variant === 'none') assert.equal(row(h, 'terms'), undefined);
    else {
      row(h, 'terms').onPress();
      h.render();
      await flush();
    }
    if (['none', 'pending'].includes(variant)) {
      assert.equal(calls.browser.length, 0);
      assert.equal(sheet(h).visible, false);
    } else if (variant === 'cached-error') assert.equal(sheet(h).visible, true);
    else assert.deepEqual(calls.browser, [terms.data?.url ?? 'https://school.invalid/terms_of_use']);
    h.unmount();
  }

  // Committed ownership replacement retires every relevant retained control, then recovers.
  for (const transition of [
    'account',
    'user',
    'client',
    'baseUrl',
    'html',
    'url',
    'none',
    'pending',
    'focus',
    'unmount',
  ]) {
    h = await setup();
    tap(h, 7);
    h.render();
    row(h, 'terms').onPress();
    h.render();
    const open = row(h, 'terms').onPress,
      close = sheet(h).onClose,
      web = browse(h).onPress;
    const toggle = first(h, 'Switch').onValueChange,
      version = row(h, 'version').onPress,
      privacy = row(h, 'privacyPolicy').onPress;
    const priorWrites = writes().length,
      priorNotices = calls.notices.length;
    if (transition === 'account') env.account = { ...env.account, id: 'b' };
    if (transition === 'user') env.account = { ...env.account, user: { id: 'v' } };
    if (transition === 'client') env.client = {};
    if (transition === 'baseUrl') env.account.baseUrl = 'https://other.invalid';
    if (transition === 'html') terms.data = { ...terms.data, html: '<p>Replacement</p>' };
    if (transition === 'url') terms.data = { ...terms.data, url: 'https://new.invalid' };
    if (transition === 'none') terms.data = { ...terms.data, none: true };
    if (transition === 'pending') terms.isPending = true;
    if (transition === 'focus') focused = false;
    if (transition === 'unmount') h.unmount();
    else h.render();
    open();
    close();
    web();
    await flush();
    assert.equal(calls.browser.length, 0, transition);
    if (!['html', 'url', 'none', 'pending'].includes(transition)) {
      toggle(false);
      version();
      privacy();
      await flush();
      assert.equal(writes().length, priorWrites, transition);
      assert.equal(calls.notices.length, priorNotices, transition);
      assert.equal(calls.browser.length, 0, transition);
    }
    if (transition !== 'unmount') {
      assert.equal(sheet(h).visible, false, transition);
      focused = true;
      terms.isPending = false;
      terms.data = { ...terms.data, none: false };
      h.render();
      row(h, 'terms').onPress();
      h.render();
      assert.equal(sheet(h).visible, true, transition);
      close();
      h.render();
      assert.equal(sheet(h).visible, true, 'old close cannot close replacement ' + transition);
      browse(h).onPress();
      await flush();
      assert.equal(calls.browser.length, 1, transition);
      first(h, 'Switch').onValueChange(false);
      h.render();
      assert.equal(first(h, 'Switch'), undefined);
      h.unmount();
    }
  }

  // Event-time focus checks close the gap before a focus render commits.
  h = await setup();
  const unfocusedTap = row(h, 'version').onPress;
  focused = false;
  for (let i = 0; i < 7; i++) unfocusedTap();
  row(h, 'terms').onPress();
  await row(h, 'privacyPolicy').onPress();
  assert.equal(writes().length, 0);
  assert.equal(calls.browser.length, 0);
  h.unmount();

  // Single-entry browser claims, late successes/rejections, cleanup only of own operation.
  for (const settlement of ['resolve', 'reject']) {
    for (const transition of [
      'account',
      'user',
      'client',
      'baseUrl',
      'html',
      'url',
      'focus',
      'replay',
      'unmount',
    ]) {
      h = await setup();
      row(h, 'terms').onPress();
      h.render();
      const firstRun = deferred(),
        secondRun = deferred();
      browserQueue.push(firstRun.promise, secondRun.promise);
      const press = browse(h).onPress;
      press();
      press();
      await row(h, 'privacyPolicy').onPress();
      assert.equal(calls.browser.length, 1);
      if (transition === 'account') env.account.id = 'b';
      if (transition === 'user') env.account.user.id = 'v';
      if (transition === 'client') env.client = {};
      if (transition === 'baseUrl') env.account.baseUrl = 'https://new.invalid';
      if (transition === 'html') terms.data.html = '<b>New</b>';
      if (transition === 'url') terms.data.url = 'https://new.invalid';
      if (transition === 'focus') {
        focused = false;
        h.render();
        focused = true;
      }
      if (transition === 'replay') h.replay();
      if (transition === 'unmount') h.unmount();
      else {
        h.render();
        row(h, 'terms').onPress();
        h.render();
        browse(h).onPress();
        assert.equal(calls.browser.length, 2, transition);
      }
      firstRun[settlement](settlement === 'reject' ? Error('Open in browser') : { type: 'dismiss' });
      await flush();
      if (transition !== 'unmount') {
        browse(h).onPress();
        assert.equal(calls.browser.length, 2, 'old settlement released newer claim');
        secondRun[settlement](settlement === 'reject' ? Error('raw failure') : { type: 'opened' });
        await flush();
        browse(h).onPress();
        await flush();
        assert.equal(calls.browser.length, 3, 'claim recovers');
        h.unmount();
      }
    }
  }
  // Abandoned replacement cannot retire committed callbacks, reset progress or adopt speculative controls.
  h = await setup();
  tap(h, 4);
  row(h, 'terms').onPress();
  h.render();
  const committedOpen = row(h, 'terms').onPress,
    committedClose = sheet(h).onClose;
  const priorEnv = env,
    priorTerms = terms;
  env = { ...env, account: { ...env.account, id: 'speculative' }, client: {} };
  terms = { ...terms, data: { ...terms.data, html: '<p>Speculative</p>' } };
  const draft = h.renderOnly();
  h.abandon();
  env = priorEnv;
  terms = priorTerms;
  nodes(draft, 'ListItem')
    .find((n) => n.title === tr('terms'))
    .onPress();
  nodes(draft, 'ListItem')
    .find((n) => n.title === tr('privacyPolicy'))
    .onPress();
  for (let i = 0; i < 7; i++)
    nodes(draft, 'ListItem')
      .find((n) => n.title === tr('version'))
      .onPress();
  await flush();
  assert.equal(writes().length, 0);
  assert.equal(calls.browser.length, 0);
  committedClose();
  h.render();
  assert.equal(sheet(h).visible, false);
  committedOpen();
  h.render();
  assert.equal(sheet(h).visible, true);
  tap(h, 3);
  assert.equal(writes().length, 1);
  h.unmount();

  // Real legal adapter semantics with synthetic clients: original HTML and URL bytes survive.
  for (const [answers, expected] of [
    [
      [{ terms_type: 'no_terms', content: '<b>ignored</b>' }],
      { html: null, url: 'https://api.invalid/terms_of_use', none: true },
    ],
    [
      [{ content: '  <p>Terms of use</p>\n' }],
      { html: '  <p>Terms of use</p>\n', url: 'https://api.invalid/terms_of_use', none: false },
    ],
    [
      [{ content: '  ' }, { content: '<i>Privacy policy</i>', redirectUrl: 'https://raw.invalid/?x=%2f' }],
      { html: '<i>Privacy policy</i>', url: 'https://raw.invalid/?x=%2f', none: false },
    ],
    [[Error('first'), Error('second')], { html: null, url: 'https://api.invalid/terms_of_use', none: false }],
    [
      [{}, { redirectUrl: 'https://redirect.invalid/Unknown' }],
      { html: null, url: 'https://redirect.invalid/Unknown', none: false },
    ],
  ]) {
    const pending = [...answers],
      paths = [];
    const client = {
      baseUrl: 'https://api.invalid',
      get: async (url) => {
        paths.push(url);
        const value = pending.shift();
        if (value instanceof Error) throw value;
        return value;
      },
    };
    assert.deepEqual(await legal.fetchTerms(client), expected);
    assert.equal(pending.length, 0);
    assert.equal(paths[0], '/api/v1/accounts/self/terms_of_service');
    if (answers.length === 2) assert.equal(paths[1], '/api/v1/acceptable_use_policy');
  }
  console.log(
    'PASS About: three locales/raw provenance, legal fallbacks, tap timing/developer storage, committed ownership and browser races; 2880 historical hashes/language; TZ=' +
      process.env.TZ,
  );
  console.log(
    'Synthetic hooks/query/storage/browser/native boundaries only; no native/Compiler/RTL/AT acceptance.',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
