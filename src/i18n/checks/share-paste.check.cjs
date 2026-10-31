/* global __dirname */
// Production PasteLink, share links and content route resolver with synthetic hooks,
// native/session/router/clipboard/browser boundaries. No HTTP or real native effects.
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
let env, locale, focused, clipboardQueue, browserQueue;
const calls = { clipboard: [], browser: [], router: [], web: [], announcements: [], warning: [] };
const navigation = { isFocused: () => focused };
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': {
    View: 'View',
    AccessibilityInfo: { announceForAccessibility: (v) => calls.announcements.push(v) },
    Linking: {
      openURL: () => {
        throw Error('unexpected Linking entry');
      },
    },
  },
  'lucide-react-native': { ClipboardPaste: 'ClipboardPaste' },
  'expo-router': {
    useIsFocused: () => focused,
    useNavigation: () => navigation,
    router: { push: (target) => calls.router.push(target) },
  },
  'expo-clipboard': {
    getStringAsync: () => {
      calls.clipboard.push(true);
      assert.ok(clipboardQueue.length, 'unexpected native clipboard entry');
      const result = clipboardQueue.shift();
      if (result instanceof Error) throw result;
      return result;
    },
  },
  'expo-web-browser': {
    openBrowserAsync: (url) => {
      calls.browser.push(url);
      return browserQueue.shift() ?? Promise.resolve({ type: 'dismiss' });
    },
  },
  '@/features/web/open': { openWebView: (target) => calls.web.push(target) },
  '@/canvas/session': { useCanvas: () => env },
  '@/design': {
    Button: 'Button',
    Callout: 'Callout',
    TextField: 'TextField',
    haptics: { warning: () => calls.warning.push(true) },
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
    false,
    Date,
  );
  return module.exports;
}
const runtime = load('@/i18n/runtime');
const { sharePasteNoticeBody } = load('@/features/share/sharePasteLifetime');
const { PasteLink } = load('@/features/share/PasteLink');
const { normalizeLink, linkTarget } = load('@/features/share/links');
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

const tr = (key, args) => runtime.createTranslator(locale)('sharePaste.' + key, args);
const field = (h) => first(h, 'TextField');
const paste = (h) => nodes(h.tree, 'Button')[0].onPress();
const open = (h) => nodes(h.tree, 'Button')[1].onPress();
const notice = (h) => first(h, 'Callout');
const edit = (h, value) => {
  field(h).onChangeText(value);
  h.render();
};
const effects = () =>
  Object.fromEntries(
    Object.entries(calls)
      .filter(([k]) => k !== 'clipboard')
      .map(([k, v]) => [k, v.length]),
  );
function setup(lang = 'en') {
  for (const values of Object.values(calls)) values.length = 0;
  locale = lang;
  focused = true;
  clipboardQueue = [];
  browserQueue = [];
  env = {
    account: { id: 'a', user: { id: 'u' }, host: 'school.invalid', baseUrl: 'https://school.invalid' },
    client: {},
  };
  const h = mount(() => jsx(PasteLink, {}));
  h.render();
  return h;
}
function transition(h, kind) {
  if (kind === 'account') env.account.id = 'b';
  if (kind === 'user') env.account.user.id = 'v';
  if (kind === 'client') env.client = {};
  if (kind === 'baseUrl') env.account.baseUrl = 'https://replacement.invalid';
  if (kind === 'host') env.account.host = 'another site';
  if (kind === 'focus') focused = false;
  if (kind === 'replay') h.replay();
  if (kind === 'unmount') h.unmount();
  else if (kind !== 'event-focus') h.render();
  if (kind === 'event-focus') focused = false;
}
async function main() {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'share-paste.baseline.json')));
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2939);
    assert.ok(!Object.keys(baseline.catalogs[lang]).some((k) => k.startsWith('settingsHelp.')));
    for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
        hash,
        lang + '/' + key,
      );
    assert.equal(Object.keys(catalog).filter((k) => k.startsWith('sharePaste.')).length, 13);
    const h = setup(lang);
    const translate = runtime.createTranslator(lang);
    for (const raw of ['another site', 'Open in browser', 'Canvas link', '  ', 'é & العربية']) {
      assert.equal(
        sharePasteNoticeBody(raw, raw, translate),
        tr('otherBody', { destination: raw, school: raw }),
      );
    }
    assert.equal(
      sharePasteNoticeBody('', 'another site', translate),
      tr('otherBody', { destination: tr('anotherSite'), school: 'another site' }),
    );
    assert.equal(field(h).label, tr('label'));
    assert.equal(field(h).placeholder, tr('placeholder', { host: env.account.host }));
    assert.equal(field(h).helperText, tr('helper'));
    assert.deepEqual(
      nodes(h.tree, 'Button').map((n) => n.children),
      [tr('paste'), tr('open')],
    );
    assert.equal(nodes(h.tree, 'Button')[1].disabled, true);
    for (const raw of [
      '',
      ' ',
      'Open',
      'another site',
      'https://',
      'ftp://school.invalid/courses/1',
      'https://school.invalid/a b',
    ]) {
      edit(h, raw);
      const submit = field(h).onSubmitEditing;
      const count = calls.warning.length;
      submit();
      submit();
      h.render();
      assert.equal(field(h).value, raw);
      assert.equal(field(h).error, tr(raw.trim() ? 'invalid' : 'empty'));
      assert.equal(calls.warning.length, count + 1);
      assert.equal(calls.router.length + calls.web.length + calls.browser.length, 0);
    }
    for (const raw of [
      '/courses/42',
      ' school.invalid/courses/42/assignments/7?x=%2f#العربية ',
      '/courses/4/pages/Open?x=%26&y=%2F#é',
      '/courses/2/files/folder/Paste%20%26%20عربي',
      '/courses/4/assignments/7?anonymous_asset_id=%26%2F',
    ]) {
      edit(h, raw);
      const normalized = normalizeLink(raw, env.account.baseUrl);
      const target = linkTarget(normalized, env.account);
      assert.equal(target.kind, 'native');
      const submit = field(h).onSubmitEditing,
        button = nodes(h.tree, 'Button')[1].onPress;
      const count = calls.router.length;
      submit();
      button();
      submit();
      assert.equal(calls.router.length, count + 1);
      assert.deepEqual(calls.router.at(-1), target.route);
      assert.equal(calls.router.at(-1).params.canvasUrl, normalized);
      h.render();
      assert.equal(field(h).value, '');
    }
    // Independent known route assertion, in addition to payload parity with the real classifier.
    edit(h, '/courses/42/assignments/7');
    open(h);
    h.render();
    assert.deepEqual(calls.router.at(-1), {
      pathname: '/course/[courseId]/assignment/[assignmentId]',
      params: {
        courseId: '42',
        assignmentId: '7',
        canvasUrl: 'https://school.invalid/courses/42/assignments/7',
      },
    });
    edit(h, 'https://school.invalid/unimplemented?raw=%2f#é');
    open(h);
    h.render();
    assert.deepEqual(calls.web.at(-1), { url: 'https://school.invalid/unimplemented?raw=%2f#%C3%A9' });
    env.account.host = 'another site';
    h.render();
    edit(h, ' https://other.invalid/Open?x=%2f#العربية ');
    open(h);
    h.render();
    assert.equal(notice(h).title, tr('otherTitle'));
    assert.equal(
      notice(h).children,
      tr('otherBody', { destination: 'other.invalid', school: 'another site' }),
    );
    assert.equal(notice(h).action.label, tr('browser'));
    assert.equal(calls.announcements.at(-1), tr('otherTitle'));
    assert.equal(field(h).value, ' https://other.invalid/Open?x=%2f#العربية ');
    const browse = notice(h).action.onPress;
    browserQueue.push(Promise.reject(Error('synthetic external-browser rejection')));
    browse();
    browse();
    await flush();
    h.render();
    assert.deepEqual(calls.browser, [
      'https://other.invalid/Open?x=%2f#%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%8A%D8%A9',
    ]);
    assert.equal(notice(h), undefined);
    open(h);
    h.render();
    notice(h).action.onPress();
    assert.equal(calls.browser.length, 2, 'deliberate new attempt');
    h.unmount();
  }
  // Current clipboard results use the same classifier and preserve its exact payload.
  for (const lang of ['en', 'fr', 'ar']) {
    for (const raw of [' /courses/10 ', ' school.invalid/unknown?x=%2f ', ' other.invalid/Open ', ' Open ']) {
      const h = setup(lang);
      clipboardQueue.push(raw);
      await paste(h);
      h.render();
      const url = normalizeLink(raw, env.account.baseUrl);
      if (!url) {
        assert.equal(field(h).value, raw.trim());
        assert.equal(field(h).error, tr('invalid'));
        assert.equal(calls.warning.length, 1);
      } else {
        const target = linkTarget(url, env.account);
        if (target.kind === 'native') assert.deepEqual(calls.router, [target.route]);
        else if (target.kind === 'web') assert.deepEqual(calls.web, [{ url }]);
        else {
          assert.equal(field(h).value, raw.trim());
          assert.equal(calls.warning.length, 1);
          assert.deepEqual(calls.announcements, [tr('otherTitle')]);
          notice(h).action.onPress();
          assert.deepEqual(calls.browser, [url]);
        }
      }
      h.unmount();
    }
  }
  // Empty/denied and failed reads retain typed values and leave a usable retry.
  for (const result of ['  ', Error('sync clipboard failure'), 'rejected']) {
    const h = setup();
    edit(h, 'typed raw input');
    clipboardQueue.push(result === 'rejected' ? Promise.reject(Error('Open')) : result);
    await paste(h);
    h.render();
    assert.equal(field(h).value, 'typed raw input');
    assert.equal(
      field(h).error,
      tr(typeof result === 'string' && result !== 'rejected' ? 'clipboardEmpty' : 'clipboardError'),
    );
    const priorError = field(h).error;
    locale = 'ar';
    h.render();
    assert.notEqual(field(h).error, priorError);
    assert.equal(field(h).value, 'typed raw input');
    clipboardQueue.push(' /courses/42 ');
    await paste(h);
    h.render();
    assert.equal(calls.router.length, 1);
    assert.equal(field(h).error, null);
    h.unmount();
  }
  // Several native text events can share one committed callback. Every edit is
  // accepted, and submitting before React renders uses the latest entered text.
  for (const submit of ['after-render', 'keyboard', 'button']) {
    const rapid = setup();
    edit(rapid, '/courses/1');
    const input = field(rapid).onChangeText;
    const enter =
      submit === 'button' ? nodes(rapid.tree, 'Button')[1].onPress : field(rapid).onSubmitEditing;
    input('/courses/4');
    input('/courses/42');
    if (submit === 'after-render') {
      rapid.render();
      assert.equal(field(rapid).value, '/courses/42', 'batched text events retain the latest edit');
      open(rapid);
    } else {
      enter();
      enter();
    }
    assert.equal(calls.router.length, 1, submit + ' enters once');
    assert.equal(calls.router[0].params.courseId, '42', submit + ' submits the latest edit');
    rapid.unmount();
  }
  // Paste remains usable after text events that have not rendered yet. A failed
  // read preserves the latest raw input; repeated submit feedback is coalesced.
  for (const feedback of ['', 'invalid', 'other.invalid']) {
    const rapid = setup();
    const input = field(rapid).onChangeText;
    const enter = field(rapid).onSubmitEditing;
    input('/courses/4');
    input(feedback);
    enter();
    enter();
    assert.equal(calls.warning.length, 1, 'one warning per committed submit control');
    rapid.unmount();
  }
  {
    const rapid = setup();
    const input = field(rapid).onChangeText;
    const press = nodes(rapid.tree, 'Button')[0].onPress;
    input('/courses/4');
    input('/courses/42');
    clipboardQueue.push('');
    await press();
    rapid.render();
    assert.equal(calls.clipboard.length, 1);
    assert.equal(field(rapid).value, '/courses/42');
    assert.equal(field(rapid).error, tr('clipboardEmpty'));
    rapid.unmount();
  }
  // Duplicate entry is coalesced before and after React publishes pending state.
  let h = setup();
  const pending = deferred();
  clipboardQueue.push(pending.promise);
  const press = nodes(h.tree, 'Button')[0].onPress;
  press();
  press();
  h.render();
  paste(h);
  assert.equal(calls.clipboard.length, 1);
  locale = 'fr';
  h.render();
  pending.resolve(' https://other.invalid/Paste ');
  await flush();
  h.render();
  assert.equal(calls.announcements.at(-1), tr('otherTitle'));
  assert.equal(field(h).value, 'https://other.invalid/Paste');
  const validNotice = notice(h).action.onPress;
  locale = 'ar';
  env.account = { ...env.account, user: { ...env.account.user } };
  h.render();
  assert.equal(notice(h).title, tr('otherTitle'));
  validNotice();
  validNotice();
  assert.equal(calls.browser.length, 1);
  h.unmount();
  // A newer edit wins even before the paste-start render. Old rejection cannot erase it.
  for (const outcome of ['resolve', 'reject']) {
    h = setup();
    edit(h, '/courses/1');
    const late = deferred();
    clipboardQueue.push(late.promise);
    const input = field(h).onChangeText;
    paste(h);
    input('/courses/20');
    input('/courses/2');
    h.render();
    late[outcome](outcome === 'resolve' ? '/courses/99' : Error('late'));
    await flush();
    h.render();
    assert.equal(field(h).value, '/courses/2');
    assert.equal(field(h).error, null);
    assert.equal(calls.router.length, 0);
    assert.equal(calls.warning.length, 0);
    open(h);
    h.render();
    assert.equal(calls.router[0].params.courseId, '2');
    h.unmount();
  }
  // A current open/notice supersedes pending clipboard work and old controls.
  h = setup();
  edit(h, 'other.invalid/first');
  const old = deferred();
  clipboardQueue.push(old.promise);
  paste(h);
  h.render();
  open(h);
  h.render();
  const oldNotice = notice(h).action.onPress;
  edit(h, 'other.invalid/second');
  open(h);
  h.render();
  oldNotice();
  assert.equal(calls.browser.length, 0);
  old.resolve('/courses/8');
  await flush();
  h.render();
  assert.ok(notice(h).children.includes('other.invalid'));
  notice(h).action.onPress();
  assert.equal(calls.browser[0], 'https://other.invalid/second');
  h.unmount();

  for (const kind of [
    'account',
    'user',
    'client',
    'baseUrl',
    'host',
    'focus',
    'event-focus',
    'replay',
    'unmount',
  ]) {
    for (const outcome of ['native', 'web', 'other', 'empty', 'reject']) {
      h = setup();
      edit(h, '/courses/1');
      const late = deferred();
      clipboardQueue.push(late.promise);
      const staleInput = field(h).onChangeText,
        staleOpen = field(h).onSubmitEditing,
        stalePaste = nodes(h.tree, 'Button')[0].onPress;
      paste(h);
      h.render();
      transition(h, kind);
      const before = effects();
      staleInput('https://other.invalid');
      staleOpen();
      stalePaste();
      if (kind !== 'unmount') paste(h);
      assert.equal(calls.clipboard.length, 1, kind + ' retained native entry');
      if (outcome === 'reject') late.reject(Error('late'));
      else
        late.resolve(
          {
            native: '/courses/99',
            web: 'https://school.invalid/unknown',
            other: 'https://other.invalid/late',
            empty: '',
          }[outcome],
        );
      await flush();
      assert.deepEqual(effects(), before, kind + '/' + outcome + ' stale effects');
      if (kind !== 'unmount') {
        focused = true;
        h.render();
        clipboardQueue.push('/courses/3');
        await paste(h);
        h.render();
        assert.equal(calls.router.length, 1, kind + ' current retry');
        assert.equal(calls.router[0].params.canvasUrl, env.account.baseUrl + '/courses/3');
        h.unmount();
      }
    }
  }
  // The replacement account can type/open while the old native read is still entered.
  for (const outcome of ['resolve', 'reject']) {
    h = setup();
    const late = deferred();
    clipboardQueue.push(late.promise);
    paste(h);
    env = {
      account: { ...env.account, id: 'b', baseUrl: 'https://replacement.invalid', user: { id: 'v' } },
      client: {},
    };
    h.render();
    edit(h, '/courses/2');
    open(h);
    h.render();
    const before = effects();
    late[outcome](outcome === 'resolve' ? '/courses/99' : Error('retired'));
    await flush();
    h.render();
    assert.deepEqual(effects(), before);
    assert.equal(field(h).error, null);
    assert.equal(calls.router.length, 1);
    assert.equal(calls.router[0].params.canvasUrl, 'https://replacement.invalid/courses/2');
    h.unmount();
  }
  // Retained notice action and field controls retire on every identity boundary.
  for (const kind of [
    'account',
    'user',
    'client',
    'baseUrl',
    'host',
    'focus',
    'event-focus',
    'replay',
    'unmount',
  ]) {
    h = setup();
    edit(h, 'other.invalid');
    open(h);
    h.render();
    const browse = notice(h).action.onPress,
      change = field(h).onChangeText,
      submit = field(h).onSubmitEditing;
    transition(h, kind);
    const before = effects();
    browse();
    change('/courses/2');
    submit();
    assert.deepEqual(effects(), before, kind + ' notice retirement');
    if (kind !== 'unmount') h.unmount();
  }
  // Unmount/remount still shares an entered native read, without adopting its URL.
  h = setup();
  const retired = deferred();
  clipboardQueue.push(retired.promise);
  paste(h);
  h.unmount();
  h = mount(() => jsx(PasteLink, {}));
  h.render();
  paste(h);
  assert.equal(calls.clipboard.length, 1);
  retired.resolve('/courses/99');
  await flush();
  h.render();
  assert.equal(calls.router.length, 0);
  const newer = deferred();
  clipboardQueue.push(newer.promise);
  paste(h);
  h.render();
  await flush();
  paste(h);
  assert.equal(calls.clipboard.length, 2);
  newer.resolve('/courses/7');
  await flush();
  h.render();
  assert.equal(calls.router[0].params.courseId, '7');
  h.unmount();

  // Native entry can synchronously reenter retained controls before a render.
  h = setup();
  edit(h, '/courses/5');
  const reenter = field(h).onSubmitEditing;
  const push = stubs['expo-router'].router.push;
  stubs['expo-router'].router.push = (target) => {
    push(target);
    reenter();
  };
  reenter();
  assert.equal(calls.router.length, 1);
  stubs['expo-router'].router.push = push;
  h.unmount();

  // Input dismissal invalidates the exact notice even if the same URL is typed again.
  h = setup();
  edit(h, 'other.invalid');
  open(h);
  h.render();
  const dismissed = notice(h).action.onPress;
  edit(h, '');
  dismissed();
  assert.equal(calls.browser.length, 0);
  edit(h, 'other.invalid');
  open(h);
  h.render();
  dismissed();
  assert.equal(calls.browser.length, 0);
  notice(h).action.onPress();
  assert.equal(calls.browser.length, 1);
  h.unmount();

  // Abandoned identity and locale renders neither retire work nor change its announcement language.
  h = setup();
  const kept = deferred();
  clipboardQueue.push(kept.promise);
  paste(h);
  h.render();
  const committedEnv = env;
  env = { account: { ...env.account, id: 'speculative', user: { id: 'speculative' } }, client: {} };
  locale = 'ar';
  const draft = h.renderOnly();
  h.abandon();
  env = committedEnv;
  locale = 'en';
  nodes(draft, 'TextField')[0].onChangeText('/courses/8');
  nodes(draft, 'TextField')[0].onSubmitEditing();
  nodes(draft, 'Button')[0].onPress();
  assert.equal(calls.clipboard.length, 1);
  assert.equal(calls.router.length, 0);
  locale = 'fr';
  h.renderOnly();
  h.abandon();
  locale = 'en';
  kept.resolve('other.invalid');
  await flush();
  h.render();
  assert.equal(calls.announcements[0], tr('otherTitle'));
  assert.equal(notice(h).title, tr('otherTitle'));
  h.unmount();

  console.log(
    'PASS PasteLink: three catalogs; 2939 historical hashes/language; actual normalization/routing; committed ownership, clipboard races, retained actions, replay and abandoned renders; TZ=' +
      process.env.TZ,
  );
  console.log(
    'Synthetic hooks/native/session/clipboard/router/browser only; no native/Compiler/RTL/AT acceptance.',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
