const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
// Actual ShareScreen, owned lifetime, parser/store, file descriptors, normalization
// and route classification. Denied-by-default synthetic hook/native/session boundaries.
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
  h.commit = (passive = true) => {
    for (const [at, s] of h.nodes) if (draft.get(at) !== s) retire(s);
    h.nodes = draft;
    for (const kind of passive ? ['layout', 'passive'] : ['layout'])
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

react.useSyncExternalStore = (subscribe, snapshot) => {
  const [, update] = react.useState(0);
  react.useLayoutEffect(() => subscribe(() => update((n) => n + 1)), [subscribe]);
  return snapshot();
};
let env,
  locale,
  focused,
  accounts,
  incoming,
  params,
  back = true;
const calls = [];
const publications = [];
let onPush;
let nativePayload;
const navigation = { isFocused: () => focused };
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': {
    View: 'View',
    Linking: {
      openURL() {
        throw Error('Unexpected Linking');
      },
    },
  },
  'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
  'expo-router': {
    useIsFocused: () => focused,
    useNavigation: () => navigation,
    useLocalSearchParams: () => params,
    Stack: { Screen: 'StackScreen' },
    router: {
      push(target) {
        calls.push(['push', target]);
        onPush?.(target);
      },
      canGoBack() {
        calls.push(['canGoBack']);
        return back;
      },
      dismissAll() {
        calls.push(['dismissAll']);
      },
      replace(target) {
        calls.push(['replace', target]);
      },
    },
  },
  'expo-sharing': {
    useIncomingShare: () => incoming,
    clearSharedPayloads() {
      calls.push(['clear']);
      nativePayload = null;
    },
  },
  'expo-web-browser': {
    openBrowserAsync(url) {
      calls.push(['browser', url]);
      return Promise.resolve();
    },
  },
  '@/features/web/open': {
    openWebView(target) {
      calls.push(['web', target]);
    },
  },
  '@/canvas/session': { useCanvas: () => env, useSession: () => ({ accounts }) },
  '@/features/course/states': { ListSkeleton: 'ListSkeleton' },
  '@/features/share/PasteLink': { PasteLink: 'PasteLink' },
  '@/features/share/SharedPreview': { SharedPreview: 'SharedPreview' },
  '@/design': Object.fromEntries(
    [
      'Button',
      'Callout',
      'Card',
      'EmptyState',
      'IconTile',
      'ListGroup',
      'ListItem',
      'Screen',
      'Section',
      'Text',
    ].map((v) => [v, v]),
  ),
  '@/i18n': { useTranslation: () => ({ locale, t: runtime.createTranslator(locale) }) },
};
const allowed = new Set([
  'features/share/ShareScreen.tsx',
  'features/share/useShareIntake.ts',
  'features/share/shareScreenLifetime.ts',
  'features/share/content.ts',
  'features/share/links.ts',
  'features/content/links.ts',
  'features/files/kinds.ts',
  'lib/dates.ts',
  'i18n/runtime.ts',
  'i18n/en.ts',
  'i18n/fr.ts',
  'i18n/ar.ts',
]);
function load(file, from = root) {
  if (isIntlPolyfills(file)) return intlPolyfills;
  if (Object.hasOwn(stubs, file)) return stubs[file];
  let p = file.startsWith('@/') ? path.join(root, file.slice(2)) : path.resolve(from, file);
  if (!path.extname(p)) p += fs.existsSync(p + '.ts') ? '.ts' : '.tsx';
  const alias = '@/' + path.relative(root, p).replace(/\.tsx?$/, '');
  if (Object.hasOwn(stubs, alias)) return stubs[alias];
  assert.ok(allowed.has(path.relative(root, p)), 'unmocked module: ' + file);
  if (cache.has(p)) return cache.get(p);
  let source =
    process.env.SHARE_SCREEN_BEFORE && p.endsWith('/ShareScreen.tsx')
      ? fs.readFileSync(process.env.SHARE_SCREEN_BEFORE, 'utf8')
      : fs.readFileSync(p, 'utf8');
  if (process.env.SHARE_INTAKE_BEFORE && p.endsWith('/useShareIntake.ts')) {
    source = fs.readFileSync(path.resolve(root, '../node_modules/expo-sharing/src/useIncomingShare.ts'), 'utf8')
      .replace("from './Sharing'", "from 'expo-sharing'")
      .replace('export function useIncomingShare()', 'export function useShareIntake()');
  }
  const code = ts.transpileModule(source, {
    fileName: p,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  cache.set(p, module.exports);
  new Function(
    'require',
    'module',
    'exports',
    '__DEV__',
    'Date',
    'fetch',
    'WebSocket',
    'XMLHttpRequest',
    code,
  )(
    (name) => load(name, path.dirname(p)),
    module,
    module.exports,
    false,
    Date,
    () => {
      throw Error('Unexpected fetch');
    },
    () => {
      throw Error('Unexpected WebSocket');
    },
    () => {
      throw Error('Unexpected XMLHttpRequest');
    },
  );
  return module.exports;
}

const runtime = load('@/i18n/runtime');
const actualIntake = load('@/features/share/useShareIntake').useShareIntake;
let useRealIntake = false;
// Existing owner/parser cases retain their exact synthetic input states. The
// intake suite switches this boundary to the actual hook and mocks only Expo/RN.
stubs['@/features/share/useShareIntake'] = {
  useShareIntake: () => useRealIntake ? actualIntake() : incoming,
};
const content = load('@/features/share/content');
const originalSet = content.setSharedContent;
content.setSharedContent = (value) => {
  publications.push(value);
  const published = originalSet(value);
  return process.env.SHARE_SCREEN_BEFORE ? undefined : published;
};
const { ShareScreen, leaveShare } = load('@/features/share/ShareScreen');
const { ShareScreenOwner, shareScreenNoticeBody } = load('@/features/share/shareScreenLifetime');
const nodes = (tree, type) => {
  if (Array.isArray(tree)) return tree.flatMap((v) => nodes(v, type));
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree.props] : []), ...nodes(tree.props.children, type)];
};
const tr = (key, args) => runtime.createTranslator(locale)('shareScreen.' + key, args);
const first = (h, type) => nodes(h.tree, type)[0];
const item = (h, key) => nodes(h.tree, 'ListItem').find((v) => v.title === tr(key));
const buttons = (h) => [...nodes(h.tree, 'ListItem'), ...nodes(h.tree, 'Button')].map((v) => v.onPress);
function store() {
  const h = mount(() => jsx(() => jsx('Store', { value: content.useSharedContent() }), {}));
  h.render();
  const value = first(h, 'Store').value;
  h.unmount();
  return value;
}
const rawFile = { shareType: 'file', value: 'content://shared/report', mimeType: 'application/pdf' };
const resolvedFile = {
  contentType: 'file',
  contentUri: 'file:///cache/%2f.pdf?raw=&{name}',
  originalName: 'Shared file',
  contentSize: 12,
  contentMimeType: 'application/pdf',
};
const shared = (raw = [], resolved = [], resolving = false) => ({
  sharedPayloads: raw,
  resolvedSharedPayloads: resolved,
  isResolving: resolving,
  error: null,
});
function setup(
  lang = 'en',
  source = shared([
    { shareType: 'url', value: 'https://school.invalid/courses/12/assignments/34?x=a%26b#raw' },
  ]),
  link,
) {
  calls.length = publications.length = 0;
  onPush = undefined;
  locale = lang;
  focused = true;
  back = true;
  env = {
    account: {
      id: 'a',
      host: 'school.invalid',
      baseUrl: 'https://school.invalid',
      user: { id: 'u', name: 'Done <&>{school} العربية' },
    },
    client: {},
  };
  accounts = [env.account];
  incoming = source;
  nativePayload = source;
  params = { link };
  const h = mount(() => jsx(ShareScreen, {}));
  h.render();
  return h;
}
let passed = 0,
  failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    failed++;
    console.error('FAIL ' + name + ': ' + error.stack);
  }
}
check('2997 reviewed values each, peers excluded, new values allowed', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'share-screen.baseline.json')));
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2997);
    assert.ok(!Object.keys(baseline.catalogs[lang]).some((k) => /^share(Courses|Assignments)\./.test(k)));
    for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
        hash,
        lang + '/' + key,
      );
    assert.equal(Object.keys(catalog).filter((k) => k.startsWith('shareScreen.')).length, 23);
  }
});
check('leaveShare exact scoped implementation and public protocol', () => {
  const source = fs.readFileSync(path.join(root, 'features/share/ShareScreen.tsx'), 'utf8');
  const scoped = source.match(/export function leaveShare\(\) \{[\s\S]*?\n\}/)[0];
  assert.equal(
    crypto.createHash('sha256').update(scoped).digest('hex'),
    '9e4813a20012d7097a12db9a44ea6672cebe99dfca13fd7f633d29c718bc7aca',
  );
  for (const canBack of [true, false]) {
    calls.length = 0;
    back = canBack;
    leaveShare();
    assert.deepEqual(calls, [['clear'], ['canGoBack'], canBack ? ['dismissAll'] : ['replace', '/']]);
  }
});
for (const lang of ['en', 'fr', 'ar']) {
  check(lang + ' full presentation, locale-only continuity and raw slots', () => {
    const h = setup(lang);
    assert.equal(first(h, 'StackScreen').options.title, tr('title'));
    assert.equal(first(h, 'Section').title, tr('pasteAlternative'));
    assert.equal(first(h, 'Button').children, tr('done'));
    assert.equal(item(h, 'open').subtitle, tr('openNativeHelp'));
    assert.equal(item(h, 'submit').subtitle, tr('submitUrlHelp'));
    assert.equal(nodes(h.tree, 'Text').length, 0);
    accounts.push({ id: 'b' });
    env.account.host = 'another site';
    h.render();
    assert.equal(
      first(h, 'Text').children,
      tr('accountHelp', { name: env.account.user.name, school: 'another site' }),
    );
    for (const host of ['', 'another site', 'Open in browser', ' <&>{school} العربية ']) {
      const text = shareScreenNoticeBody(host, 'Done <&>{destination}', runtime.createTranslator(lang));
      assert.equal(
        text,
        tr('otherBody', {
          destination: host === '' ? tr('anotherSite') : host,
          school: 'Done <&>{destination}',
        }),
      );
    }
    const oldSubmit = item(h, 'submit').onPress;
    const original = store();
    const count = publications.length;
    locale = lang === 'fr' ? 'ar' : 'fr';
    h.render();
    assert.equal(item(h, 'submit').title, tr('submit'));
    assert.equal(store(), original);
    assert.equal(publications.length, count);
    oldSubmit();
    assert.deepEqual(calls, [['push', '/share/courses']]);
    h.unmount();
    assert.ok(!calls.some((c) => c[0] === 'clear'));
  });
  check(lang + ' empty/fallback/failed/waiting file readiness', () => {
    let h = setup(lang, shared());
    assert.equal(first(h, 'StackScreen').options.title, tr('openTitle'));
    assert.equal(first(h, 'EmptyState').title, tr('emptyTitle'));
    assert.equal(first(h, 'EmptyState').description, tr('emptyBody'));
    assert.equal(first(h, 'Section').title, tr('pasteTitle'));
    assert.equal(nodes(h.tree, 'ListItem').length, 0);
    assert.equal(nodes(h.tree, 'Button').length, 0);
    assert.equal(nodes(h.tree, 'PasteLink').length, 1);
    h.unmount();
    h = setup(lang, shared(), ' /courses/12?x=1 ');
    assert.equal(first(h, 'SharedPreview').content.url, 'https://school.invalid/courses/12?x=1');
    assert.ok(item(h, 'open'));
    h.unmount();
    h = setup(lang, shared(Array(6).fill(rawFile), [resolvedFile], true), '/courses/9');
    assert.equal(first(h, 'ListSkeleton').rows, 4);
    assert.equal(nodes(h.tree, 'ListItem').length, 0);
    assert.ok(first(h, 'Button'));
    assert.equal(store().url, null);
    incoming = { ...incoming, isResolving: false, error: Error('RAW ERROR') };
    h.render();
    assert.equal(first(h, 'Callout').title, tr('readErrorTitle'));
    assert.equal(first(h, 'Callout').children, tr('readErrorBody'));
    assert.equal(nodes(h.tree, 'ListItem').length, 0);
    h.unmount();
    h = setup(lang, shared([rawFile], [], false), '/courses/12');
    assert.equal(store().url, 'https://school.invalid/courses/12');
    assert.equal(nodes(h.tree, 'ListItem').length, 0);
    h.unmount();
  });
  check(lang + ' files first, raw file details, URL/text precedence and action set', () => {
    const rawUrl = { shareType: 'url', value: 'https://other.invalid/Done?name=%26%7Bschool%7D#raw' };
    const rawText = { shareType: 'text', value: '  Done <&>{school} العربية  ' };
    const source = shared([rawFile, rawUrl, rawText], [resolvedFile]);
    const h = setup(lang, source, '/courses/99');
    const value = first(h, 'SharedPreview').content;
    assert.deepEqual(value, content.toSharedContent(source.sharedPayloads, source.resolvedSharedPayloads));
    assert.equal(value.files[0].name, 'Shared file');
    assert.equal(value.files[0].uri, resolvedFile.contentUri);
    assert.equal(content.kindOf(value), 'files');
    assert.equal(item(h, 'submit').subtitle, tr('submitFilesHelp'));
    assert.equal(item(h, 'upload').subtitle, tr('uploadHelp'));
    assert.ok(item(h, 'browser'));
    assert.equal(first(h, 'Callout').title, tr('otherTitle'));
    assert.equal(
      first(h, 'Callout').children,
      tr('otherBody', { destination: 'other.invalid', school: 'school.invalid' }),
    );
    assert.equal(item(h, 'open'), undefined);
    item(h, 'upload').onPress();
    assert.deepEqual(calls, [['push', '/share/folder']]);
    h.unmount();
    const t = setup(lang, shared([rawText]));
    assert.equal(item(t, 'submit').subtitle, tr('submitTextHelp'));
    assert.equal(item(t, 'upload'), undefined);
    assert.equal(store().text, rawText.value.trim());
    assert.equal(nodes(t.tree, 'ListItem').length, 1);
    t.unmount();
  });
}
check('exact native/web/external targets and duplicate/reentrant callbacks', () => {
  for (const [url, expected, key] of [
    [
      'https://school.invalid/courses/12/assignments/34?x=a%26b#raw',
      [
        'push',
        {
          pathname: '/course/[courseId]/assignment/[assignmentId]',
          params: {
            courseId: '12',
            assignmentId: '34',
            canvasUrl: 'https://school.invalid/courses/12/assignments/34?x=a%26b#raw',
          },
        },
      ],
      'open',
    ],
    [
      'https://school.invalid/unknown?raw=%26%7Bschool%7D#é',
      ['web', { url: 'https://school.invalid/unknown?raw=%26%7Bschool%7D#%C3%A9' }],
      'open',
    ],
    [
      'https://other.invalid/raw?name=%26%7Bschool%7D',
      ['browser', 'https://other.invalid/raw?name=%26%7Bschool%7D'],
      'browser',
    ],
  ]) {
    const h = setup('en', shared([{ shareType: 'url', value: url }]));
    if (expected[0] === 'web') assert.equal(item(h, 'open').subtitle, tr('openWebHelp'));
    const retained = buttons(h);
    const open = item(h, key).onPress;
    onPush = () => {
      onPush = undefined;
      retained.forEach((fn) => fn());
    };
    open();
    retained.forEach((fn) => fn());
    assert.deepEqual(calls, [expected]);
    onPush = undefined;
    h.render();
    first(h, 'Button').onPress();
    first(h, 'Button').onPress();
    assert.deepEqual(calls.slice(1), [['clear'], ['canGoBack'], ['dismissAll']]);
    h.unmount();
  }
});
check('text-embedded link opens while submitting text, invalid URL empty-host fallback', () => {
  const h = setup(
    'ar',
    shared([{ shareType: 'text', value: 'Raw <&> https://school.invalid/courses/12. rest' }]),
  );
  assert.ok(item(h, 'open'));
  assert.equal(item(h, 'submit').subtitle, tr('submitTextHelp'));
  assert.equal(store().text, 'Raw <&> https://school.invalid/courses/12. rest');
  h.unmount();
  const h2 = setup('fr', shared([{ shareType: 'url', value: 'another site' }]));
  assert.equal(
    first(h2, 'Callout').children,
    tr('otherBody', { destination: tr('anotherSite'), school: 'school.invalid' }),
  );
  item(h2, 'browser').onPress();
  assert.deepEqual(calls, [['browser', 'another site']]);
  h2.unmount();
});
for (const change of [
  'account',
  'user',
  'client',
  'baseUrl',
  'host',
  'payload',
  'resolved',
  'link',
  'focus',
  'event-focus',
  'replay',
  'unmount',
]) {
  check(change + ' retires every old Open/Submit/Upload/Done callback', () => {
    const h = setup(
      'en',
      shared([rawFile, { shareType: 'url', value: 'https://school.invalid/courses/12' }], [resolvedFile]),
    );
    const retained = buttons(h);
    if (change === 'account') env.account.id = 'b';
    if (change === 'user') env.account.user.id = 'v';
    if (change === 'client') env.client = {};
    if (change === 'baseUrl') env.account.baseUrl = 'https://new.invalid';
    if (change === 'host') env.account.host = 'new.invalid';
    if (change === 'payload')
      incoming = { ...incoming, sharedPayloads: [{ shareType: 'text', value: 'replacement' }] };
    if (change === 'resolved')
      incoming = { ...incoming, resolvedSharedPayloads: [{ ...resolvedFile, originalName: 'replacement' }] };
    if (change === 'link') params = { link: '/courses/13' };
    if (change === 'focus') focused = false;
    if (change === 'unmount') h.unmount();
    else if (change === 'replay') h.replay();
    else if (change === 'event-focus') focused = false;
    else h.render();
    retained.forEach((fn) => fn());
    assert.deepEqual(calls, []);
    if (!['unmount', 'event-focus', 'focus'].includes(change)) {
      h.render();
      item(h, 'submit').onPress();
      assert.deepEqual(calls, [['push', '/share/courses']]);
    }
    if (change !== 'unmount') h.unmount();
  });
}
check('layout commit publishes before picker; abandoned render has no publication or cleanup', () => {
  const h = setup();
  const original = store();
  const originalSource = incoming;
  const retained = item(h, 'submit').onPress;
  incoming = shared([{ shareType: 'text', value: 'New source <&>' }]);
  const count = publications.length;
  const draft = h.renderOnly();
  nodes(draft, 'ListItem')[0].onPress();
  assert.deepEqual(calls, []);
  assert.equal(store(), original);
  assert.equal(publications.length, count);
  h.abandon();
  incoming = originalSource;
  retained();
  assert.deepEqual(calls, [['push', '/share/courses']]);
  calls.length = 0;
  incoming = shared([{ shareType: 'text', value: 'Committed source' }]);
  h.tree = h.renderOnly();
  h.commit(false);
  onPush = () => assert.equal(store().text, 'Committed source');
  item(h, 'submit').onPress();
  assert.deepEqual(calls, [['push', '/share/courses']]);
  h.unmount();
});
check('same-resource clones and locale keep owner, focus return gets fresh actions', () => {
  const h = setup();
  const retained = item(h, 'submit').onPress;
  const count = publications.length;
  env.account = { ...env.account, user: { ...env.account.user } };
  locale = 'ar';
  h.render();
  assert.equal(publications.length, count);
  retained();
  focused = false;
  h.render();
  focused = true;
  h.render();
  retained();
  assert.equal(calls.length, 1);
  item(h, 'submit').onPress();
  assert.equal(calls.length, 2);
  h.unmount();
});
check('replay/stale instance cleanup never clears new native payload or newer content', () => {
  const old = setup();
  const retained = buttons(old);
  const newer = setup('fr', shared([{ shareType: 'text', value: 'new native payload' }]));
  const published = store();
  old.unmount();
  retained.forEach((fn) => fn());
  assert.equal(store(), published);
  assert.deepEqual(calls, []);
  const beforeReplay = buttons(newer);
  newer.replay();
  beforeReplay.forEach((fn) => fn());
  assert.deepEqual(calls, []);
  newer.render();
  item(newer, 'submit').onPress();
  assert.deepEqual(calls, [['push', '/share/courses']]);
  newer.unmount();
});
for (const replace of ['new-reference', 'same-reference', 'mutate']) {
  check(replace + ' store change rejects pre-render screen controls without republishing', () => {
    const h = setup();
    const retained = buttons(h);
    const previous = store();
    if (replace === 'new-reference') content.setSharedContent({ files: [], url: null, text: 'new' });
    if (replace === 'same-reference') content.setSharedContent(previous);
    if (replace === 'mutate') previous.url = 'https://new.invalid';
    const count = publications.length;
    retained.forEach((fn) => fn());
    assert.deepEqual(calls, []);
    assert.equal(publications.length, count);
    h.unmount();
  });
}
check('reentrant publication returns own record and cannot admit action for newer content', () => {
  setup().unmount();
  const value = { files: [], url: null, text: 'owner' };
  const owner = new ShareScreenOwner(value, true, navigation);
  let subscribed = false;
  // Capture only the real store subscription, with a synthetic synchronous consumer.
  const originalHook = react.useSyncExternalStore;
  let unsubscribe;
  react.useSyncExternalStore = (subscribe, snapshot) => {
    unsubscribe = subscribe(() => {
      if (!subscribed) {
        subscribed = true;
        content.setSharedContent({ files: [], url: null, text: 'newer' });
      }
    });
    return snapshot();
  };
  content.useSharedContent();
  react.useSyncExternalStore = originalHook;
  owner.activate();
  owner.enter(owner.getSnapshot(), () => calls.push(['unexpected']));
  assert.equal(store().text, 'newer');
  assert.deepEqual(calls, []);
  owner.retire();
  unsubscribe();
});
check('store publication between render and commit prevents stale publication and entry', () => {
  const h = setup();
  incoming = shared([{ shareType: 'text', value: 'rendered draft' }]);
  const draft = h.renderOnly();
  const replacement = { files: [], url: null, text: 'newer store record' };
  content.setSharedContent(replacement);
  const count = publications.length;
  h.tree = draft;
  h.commit();
  assert.equal(store(), replacement);
  assert.equal(publications.length, count);
  buttons(h).forEach((fn) => fn());
  assert.deepEqual(calls, []);
  h.unmount();
});
check('old replay cannot overwrite a newer store publication', () => {
  const h = setup();
  const retained = buttons(h);
  const replacement = { files: [], url: null, text: 'newer' };
  content.setSharedContent(replacement);
  const count = publications.length;
  h.replay();
  h.render();
  retained.forEach((fn) => fn());
  buttons(h).forEach((fn) => fn());
  assert.equal(store(), replacement);
  assert.equal(publications.length, count);
  assert.deepEqual(calls, []);
  h.unmount();
});
check('parser boundary: equal counts alone cannot correlate files (adapter race regression in share-intake.check.cjs)', () => {
  const newerRaw = { ...rawFile, value: 'content://shared/new' };
  const h = setup('en', shared([newerRaw], [resolvedFile]));
  assert.equal(content.fileCount(incoming.sharedPayloads), store().files.length);
  assert.equal(store().files[0].uri, resolvedFile.contentUri);
  assert.ok(item(h, 'submit'));
  assert.ok(item(h, 'upload'));
  // Deliberately injected impossible pair tests the unchanged parser/readiness contract.
  // The deferred real-adapter integration now prevents this observed A/B race.
  h.unmount();
});
check('documented native gap: unobserved new OS payload remains subject to global Done clear', () => {
  const h = setup();
  nativePayload = shared([{ shareType: 'text', value: 'new OS event not delivered to React' }]);
  first(h, 'Button').onPress();
  assert.equal(nativePayload, null);
  assert.deepEqual(calls, [['clear'], ['canGoBack'], ['dismissAll']]);
  h.unmount();
});
console.log(`ShareScreen: ${passed} groups passed; ${failed} failed (${process.env.TZ ?? 'default TZ'}).`);
if (failed) process.exitCode = 1;

// Shared synthetic boundary harness; no native modules or real effects loaded.
module.exports = {
  mount, jsx, load, setup, item, first, store, calls, publications, nodes,
  rawFile, resolvedFile, shared, actualIntake,
  useIntakeBoundaries(sharing, appState) {
    useRealIntake = true;
    Object.assign(stubs['expo-sharing'], sharing);
    stubs['react-native'].AppState = appState;
  },
};
