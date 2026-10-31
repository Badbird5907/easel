/* global __dirname */
// Executes production profile components/helpers/API with synthetic platform and transport boundaries.
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
const calls = {
  put: [],
  get: [],
  uploads: [],
  settings: [],
  alerts: [],
  toast: [],
  cache: [],
  account: [],
  browsers: [],
  permission: [],
  camera: [],
  library: [],
  routes: [],
};
const queues = {
  put: [],
  get: [],
  uploads: [],
  browsers: [],
  permission: [],
  camera: [],
  library: [],
};
const unexpected = [];
function boundary(kind, args) {
  calls[kind].push(args);
  if (!queues[kind].length) {
    unexpected.push(kind);
    return Promise.reject(Error('Unexpected ' + kind));
  }
  return Promise.resolve(queues[kind].shift()).then((result) =>
    typeof result === 'function' ? result() : result,
  );
}
const makeClient = (id) => ({
  baseUrl: `https://${id}.invalid`,
  get: (...args) => boundary('get', [id, ...args]),
  put: (...args) => boundary('put', [id, ...args]),
});
let env = { account: { id: 'a', user: { id: 'student' } }, client: makeClient('a') };
let focused = true,
  online = true,
  locale = 'en',
  menu;
const navigation = { isFocused: () => focused };
const freshProfile = () => ({
  id: 'student',
  name: 'Full name',
  shortName: 'Display name',
  pronouns: 'None',
  email: 'a@example.invalid',
  bio: 'You haven’t written a bio.',
  avatarUrl: null,
  canEditName: true,
  canEditAvatar: true,
});
let query = { data: freshProfile(), isError: false, error: null, refetch: async () => {} };
const cacheClient = { invalidateQueries: (value) => calls.cache.push(value) };
const design = Object.fromEntries(
  [
    'Avatar',
    'Button',
    'Callout',
    'Card',
    'ListGroup',
    'ListItem',
    'OptionGroup',
    'ProgressRing',
    'Screen',
    'Sheet',
    'Skeleton',
    'Text',
    'TextField',
  ].map((k) => [k, k]),
);
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': {
    View: 'View',
    Alert: { alert: (...args) => calls.alerts.push(args) },
    Linking: { openSettings: async () => calls.settings.push(true) },
  },
  'lucide-react-native': { Camera: 'Camera', ExternalLink: 'ExternalLink', Image: 'Image' },
  'expo-router': {
    Stack: { Screen: 'Stack.Screen' },
    router: { push: (...args) => calls.routes.push(args) },
    useIsFocused: () => focused,
    useNavigation: () => navigation,
  },
  '@/canvas/session': {
    useCanvas: () => env,
    updateAccountUser: async (...args) => calls.account.push(args),
  },
  '@/canvas/client': { CanvasError: class extends Error {} },
  '@tanstack/react-query': { useQueryClient: () => cacheClient },
  '@/canvas/query': {
    useAccountKey: () => env.account.id,
    useCanvasQuery: () => query,
    useCanvasMutation(fn, options) {
      const client = env.client;
      const observer = react.useMemo(() => ({ active: null, options: null }), []);
      const current = { fn: (value) => fn(client, value), ...options };
      react.useLayoutEffect(() => {
        observer.options = current;
        if (observer.active) observer.active.options = current;
      });
      return {
        mutateAsync(value) {
          const operation = { options: observer.options };
          observer.active = operation;
          return Promise.resolve()
            .then(() => operation.options.fn(value))
            .then(async (result) => {
              await operation.options.onSuccess?.(result, value);
              return result;
            })
            .finally(() => operation.options.onSettled?.());
        },
        reset() {
          observer.active = null;
        },
      };
    },
  },
  '@/canvas/uploads': { uploadToCanvas: (...args) => boundary('uploads', args) },
  '@/features/files/kinds': { extensionOf: () => null },
  '@/features/course/states': { LoadError: 'LoadError' },
  '@/features/files/ActionSheet': {
    useActionSheet: () => ({
      show: (value) => {
        menu = value;
      },
      sheet: null,
    }),
  },
  '@/features/offline/useOnline': { useOnline: () => online },
  '@/design': {
    ...design,
    haptics: { success() {}, error() {} },
    useToast: () => ({ show: (value) => calls.toast.push(value), element: null }),
  },
  '@/i18n': { useTranslation: () => ({ locale, t: runtime.createTranslator(locale) }) },
  'expo-image-picker': Object.fromEntries(
    [
      ['requestCameraPermissionsAsync', 'permission'],
      ['launchCameraAsync', 'camera'],
      ['launchImageLibraryAsync', 'library'],
    ].map(([fn, kind]) => [fn, (...args) => boundary(kind, args)]),
  ),
  'expo-document-picker': {},
  'expo-web-browser': { openBrowserAsync: (...args) => boundary('browsers', args) },
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
  new Function('require', 'module', 'exports', code)(
    (name) => load(name, path.dirname(p)),
    module,
    module.exports,
  );
  return module.exports;
}

const runtime = load('@/i18n/runtime');
const ProfileScreen = load('@/app/(app)/profile').default;
const api = load('@/canvas/api/profile');
const { pickAvatar } = load('@/features/settings/avatar');
const pickerErrors = load('@/features/files/upload');
function nodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap((v) => nodes(v, type));
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree.props] : []), ...nodes(tree.props.children, type)];
}
const first = (h, type) => nodes(h.tree, type)[0];
const button = (h, key) =>
  nodes(h.tree, 'Button').find(
    (p) => p.children === runtime.createTranslator(locale)('profileForms.' + key),
  );
const fields = (h) => nodes(h.tree, 'TextField');
const choose = (h, source = 1) => {
  button(h, 'changePicture').onPress();
  menu.options[source].onPress();
};
const edit = (h, name = 'Draft') => {
  fields(h)[0].onChangeText(name);
  h.render();
};
const mountProfile = () => {
  const h = mount(() => jsx(ProfileScreen, {}));
  h.render();
  return h;
};
function reset() {
  for (const q of Object.values(queues)) assert.equal(q.length, 0, 'unused synthetic response');
  env = { account: { id: 'a', user: { id: 'student' } }, client: makeClient('a') };
  query = { data: freshProfile(), isError: false, error: null, refetch: async () => {} };
  focused = online = true;
  locale = 'en';
  menu = null;
  for (const list of Object.values(calls)) list.length = 0;
}
const result = (asset = {}) => ({
  canceled: false,
  assets: [{ uri: 'file:///synthetic.jpg', ...asset }],
});
async function main() {
  const baseline = require('./profile-forms.baseline.json');
  const keys = [];
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2716);
    for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
        hash,
        lang + '/' + key,
      );
    keys.push(
      Object.keys(catalog)
        .filter((k) => k.startsWith('profileForms.'))
        .sort(),
    );
  }
  assert.deepEqual(keys[0], keys[1]);
  assert.deepEqual(keys[0], keys[2]);
  assert.equal(keys[0].length, 42);
  reset();
  let h = mountProfile();
  edit(h, '  اسم brut  ');
  fields(h)[1].onChangeText('Alias');
  h.render();
  nodes(h.tree, 'ListItem')
    .find((p) => p.title === 'Pronouns')
    .onPress();
  h.render();
  const p = query.data;
  for (const next of ['fr', 'ar', 'en']) {
    locale = next;
    h.render();
    assert.equal(query.data, p);
    assert.equal(fields(h)[0].value, '  اسم brut  ');
    assert.equal(fields(h)[1].value, 'Alias');
    assert.equal(first(h, 'Sheet').visible, true);
    assert.ok(nodes(h.tree, 'Text').some((p) => p.children === 'You haven’t written a bio.'));
    assert.equal(first(h, 'Avatar').name, 'Full name');
    assert.equal(first(h, 'OptionGroup').options.at(-1).label, 'None');
  }
  // Same-turn keyboard/button/pronoun writes share one synchronous lease.
  const write = deferred();
  queues.put.push(write.promise);
  const save = fields(h)[1].onSubmitEditing;
  save();
  save();
  first(h, 'OptionGroup').onSelect('value:She/Her');
  await flush();
  assert.equal(calls.put.length, 1);
  assert.deepEqual(calls.put[0], [
    'a',
    '/api/v1/users/student',
    { user: { name: 'اسم brut', short_name: 'Alias' } },
  ]);
  edit(h, 'Later edit');
  write.reject(Error('Couldn’t save your name'));
  await flush();
  h.render();
  assert.equal(fields(h)[0].value, 'Later edit');
  locale = 'fr';
  h.render();
  assert.equal(first(h, 'Callout').children, 'Couldn’t save your name');
  assert.equal(first(h, 'Callout').title, 'Impossible d’enregistrer votre nom');
  // Default options translate; wire values and supplied default strings don't.
  queues.put.push({ pronouns: 'She/Her' });
  first(h, 'OptionGroup').onSelect('value:She/Her');
  await flush();
  h.render();
  assert.deepEqual(calls.put.at(-1)[2], { user: { pronouns: 'She/Her' } });
  assert.ok(calls.toast.at(-1).includes('She/Her'));
  queues.put.push({ pronouns: null });
  first(h, 'OptionGroup').onSelect('none');
  await flush();
  assert.deepEqual(calls.put.at(-1)[2], { user: { pronouns: '' } });
  queues.put.push({ pronouns: 'wrong' });
  first(h, 'OptionGroup').onSelect('value:He/Him');
  await flush();
  h.render();
  assert.equal(
    first(h, 'Callout').children,
    runtime.createTranslator('fr')('profileForms.pronounsNotOffered'),
  );
  const raw = new api.PronounsNotOfferedError().message;
  queues.put.push(() => {
    throw Error(raw);
  });
  first(h, 'OptionGroup').onSelect('value:He/Him');
  await flush();
  h.render();
  assert.equal(first(h, 'Callout').children, raw);
  h.unmount();
  // Every identity/eligibility transition invalidates retained actions and work.
  for (const transition of [
    'account',
    'client',
    'profile',
    'permission',
    'offline',
    'query',
    'focus',
    'unmount',
  ]) {
    reset();
    h = mountProfile();
    edit(h);
    const save = fields(h)[1].onSubmitEditing,
      pronoun = first(h, 'OptionGroup').onSelect,
      picture = button(h, 'changePicture').onPress,
      bio = button(h, 'editWeb').onPress;
    picture();
    const oldMenu = menu;
    const pending = deferred();
    queues.put.push(pending.promise);
    save();
    await flush();
    const before = calls.put.length;
    if (transition === 'account') env = { ...env, account: { id: 'b', user: { id: 'student' } } };
    if (transition === 'client') env = { ...env, client: makeClient('new') };
    if (transition === 'profile') query = { ...query, data: { ...query.data, id: 'other' } };
    if (transition === 'permission') {
      query.data.canEditName = false;
      query.data.canEditAvatar = false;
    }
    if (transition === 'offline') online = false;
    if (transition === 'query') query = { ...query, isError: true, error: Error('failed') };
    if (transition === 'focus') focused = false;
    if (transition === 'unmount') h.unmount();
    else h.render();
    save();
    pronoun('value:He/Him');
    oldMenu.options[0].onPress();
    picture();
    await bio();
    pending.resolve({ name: 'Saved' });
    await flush();
    assert.equal(calls.put.length, before, transition);
    assert.equal(calls.permission.length, 0, transition);
    assert.equal(calls.get.length, 0, transition);
    assert.equal(calls.toast.length, 0, transition);
    assert.deepEqual(calls.cache.at(-1), { queryKey: ['a', 'profile'] }, transition);
    assert.equal(calls.account.at(-1)[0], 'a', transition);
    if (transition !== 'unmount') h.unmount();
  }
  // An abandoned render cannot retire committed handlers; replay retires async work.
  reset();
  h = mountProfile();
  edit(h);
  const saved = fields(h)[1].onSubmitEditing,
    original = query;
  query = { ...query, data: { ...query.data, id: 'speculative' } };
  h.renderOnly();
  h.abandon();
  query = original;
  const inFlight = deferred();
  queues.put.push(inFlight.promise);
  saved();
  await flush();
  assert.equal(calls.put.length, 1);
  h.replay();
  inFlight.resolve({ name: 'ok' });
  await flush();
  assert.equal(calls.toast.length, 0);
  h.unmount();
  // Plain dismissal retires the avatar menu; a selected close preserves its
  // delayed handoff. Dismissing an old menu cannot retire a replacement menu.
  for (const selected of [false, true]) {
    reset();
    h = mountProfile();
    button(h, 'changePicture').onPress();
    const shown = menu;
    if (selected) queues.permission.push({ granted: false });
    shown.onClose?.(selected);
    h.render();
    shown.options[0].onPress();
    await flush();
    assert.equal(calls.permission.length, selected ? 1 : 0, 'avatar menu dismissal ownership');
    h.unmount();
  }
  reset();
  h = mountProfile();
  button(h, 'changePicture').onPress();
  const dismissedMenu = menu;
  button(h, 'changePicture').onPress();
  dismissedMenu.onClose?.(false);
  queues.permission.push({ granted: false });
  menu.options[0].onPress();
  await flush();
  assert.equal(calls.permission.length, 1, 'old dismissal preserves replacement menu');
  h.unmount();
  // Permission and native picker await boundaries; stale Alerts/Settings; menu one-use.
  reset();
  h = mountProfile();
  const permission = deferred();
  queues.permission.push(permission.promise);
  choose(h, 0);
  menu.options[0].onPress();
  await flush();
  assert.equal(calls.permission.length, 1);
  online = false;
  h.render();
  permission.resolve({ granted: true });
  await flush();
  assert.equal(calls.camera.length, 0);
  online = true;
  h.render();
  queues.permission.push({ granted: false });
  choose(h, 0);
  await flush();
  assert.equal(calls.alerts.at(-1)[0], 'Camera access is off');
  const oldSettings = calls.alerts.at(-1)[2][1].onPress;
  queues.permission.push({ granted: false });
  choose(h, 0);
  await flush();
  oldSettings();
  assert.equal(calls.settings.length, 0);
  const settings = calls.alerts.at(-1)[2][1].onPress;
  settings();
  settings();
  assert.equal(calls.settings.length, 1);
  queues.permission.push({ granted: false });
  choose(h, 0);
  await flush();
  const staleSettings = calls.alerts.at(-1)[2][1].onPress;
  focused = false;
  h.render();
  focused = true;
  h.render();
  staleSettings();
  assert.equal(calls.settings.length, 1);
  const picker = deferred();
  queues.library.push(picker.promise);
  choose(h);
  await flush();
  query = { ...query, data: { ...query.data } };
  h.render();
  picker.resolve(result());
  await flush();
  assert.equal(calls.uploads.length, 0);
  h.unmount();
  // Picker conversion and options use the actual avatar helper.
  reset();
  let live = true;
  queues.library.push(result({ mimeType: 'image/png', fileSize: 123, fileName: 'ignored.png' }));
  const png = await pickAvatar('library', () => live);
  assert.equal(png.mimeType, 'image/png');
  assert.equal(png.size, 123);
  assert.match(png.name, /^Profile picture .*\.png$/);
  assert.equal(png.uri, 'file:///synthetic.jpg');
  assert.deepEqual(calls.library[0], [
    { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 },
  ]);
  queues.permission.push({ granted: true });
  queues.camera.push(result());
  const jpg = await pickAvatar('camera');
  assert.equal(jpg.mimeType, 'image/jpeg');
  assert.equal(jpg.size, null);
  assert.match(jpg.name, /\.jpg$/);
  assert.deepEqual(calls.camera[0], calls.library[0]);
  queues.library.push({ canceled: true, assets: null });
  assert.equal(await pickAvatar('library'), null);
  queues.permission.push({ granted: true });
  queues.camera.push(() => {
    throw Error('camera unavailable');
  });
  await assert.rejects(
    pickAvatar('camera'),
    (error) =>
      error instanceof pickerErrors.PickerUnavailableError && error.origin === 'camera-unavailable',
  );
  live = false;
  assert.equal(await pickAvatar('camera', () => live), null);
  // Full production profile upload protocol, progress and old-context isolation.
  reset();
  h = mountProfile();
  const upload = deferred();
  queues.library.push(result());
  queues.uploads.push(upload.promise);
  choose(h);
  await flush();
  h.render();
  const [client, destination, file, options] = calls.uploads[0];
  assert.equal(client, env.client);
  assert.equal(destination, '/api/v1/users/self/files');
  assert.deepEqual(options.params, {
    parent_folder_path: 'profile pictures',
    on_duplicate: 'rename',
  });
  locale = 'ar';
  h.render();
  options.onProgress(0.42);
  h.render();
  assert.ok(
    nodes(h.tree, 'View').some(
      (p) =>
        p.accessibilityLabel ===
        runtime.createTranslator('ar')('profileForms.uploadProgress', {
          percent: new Intl.NumberFormat('ar').format(42),
        }),
    ),
  );
  const oldEnv = env;
  env = { account: { id: 'b', user: { id: 'b-user' } }, client: makeClient('b') };
  h.render();
  options.onProgress(0.9);
  h.render();
  assert.equal(nodes(h.tree, 'ProgressRing').length, 0);
  upload.resolve({ id: '42' });
  await flush();
  h.render();
  // Profile opts into stage retirement; the legacy unguarded API is checked below.
  assert.equal(calls.get.length, 0);
  assert.equal(calls.put.length, 0);
  assert.equal(calls.toast.length, 0);
  assert.equal(calls.account.length, 0);
  assert.deepEqual(calls.cache.at(-1), { queryKey: [oldEnv.account.id, 'profile'] });
  assert.equal(file.mimeType, 'image/jpeg');
  h.unmount();
  // A picker survives locale renders, but each entered upload owns its progress
  // callback. Finished callbacks cannot relabel or overwrite a later transfer.
  reset();
  h = mountProfile();
  const delayedPicker = deferred();
  queues.library.push(delayedPicker.promise);
  choose(h);
  locale = 'fr';
  h.render();
  const transfer = deferred();
  queues.uploads.push(transfer.promise);
  delayedPicker.resolve(result());
  await flush();
  h.render();
  const firstProgress = calls.uploads[0][3].onProgress;
  firstProgress(0.25);
  h.render();
  assert.equal(first(h, 'ProgressRing').value, 0.25);
  queues.get.push([{ type: 'attachment', id: '1', token: 'first' }]);
  queues.put.push({ avatar_url: 'first' });
  transfer.resolve({ id: '1' });
  await flush();
  h.render();
  firstProgress(0.8);
  h.render();
  assert.equal(nodes(h.tree, 'ProgressRing').length, 0);
  const nextTransfer = deferred();
  queues.library.push(result());
  queues.uploads.push(nextTransfer.promise);
  choose(h);
  await flush();
  h.render();
  const nextProgress = calls.uploads[1][3].onProgress;
  nextProgress(0.1);
  h.render();
  firstProgress(0.9);
  h.render();
  assert.equal(first(h, 'ProgressRing').value, 0.1);
  nextTransfer.reject(
    Error('Canvas didn’t accept that picture as a profile picture. Try a different photo.'),
  );
  await flush();
  h.render();
  assert.equal(
    first(h, 'Callout').children,
    'Canvas didn’t accept that picture as a profile picture. Try a different photo.',
  );
  // Supplied native errors stay raw despite an identical authored English message.
  queues.library.push(() => {
    throw new pickerErrors.PickerPermissionError(
      'Easel can’t use the camera. Turn on camera access for Easel in Settings.',
    );
  });
  choose(h);
  await flush();
  assert.equal(
    calls.alerts.at(-1)[1],
    'Easel can’t use the camera. Turn on camera access for Easel in Settings.',
  );
  const dismissedSettings = calls.alerts.at(-1)[2][1].onPress;
  calls.alerts.at(-1)[2][0].onPress();
  dismissedSettings();
  assert.equal(calls.settings.length, 0);
  query = { ...query, data: { ...query.data, pronouns: 'none' } };
  h.render();
  assert.equal(first(h, 'OptionGroup').selected, 'value:none');
  assert.equal(first(h, 'OptionGroup').options.at(-1).label, 'none');
  query = { ...query, data: { ...query.data, pronouns: 'She/Her' } };
  h.render();
  assert.equal(
    first(h, 'OptionGroup').options.find((p) => p.value === 'value:She/Her').label,
    'She/Her',
  );
  h.unmount();
  // Token fallback and raw generic error remain unchanged.
  reset();
  queues.uploads.push({ id: '7' });
  queues.get.push([], { avatar: { token: 'FALLBACK' } });
  queues.put.push({ avatar_url: null });
  assert.equal(
    await api.uploadAvatar(env.client, 'student', {
      uri: 'file:///x',
      name: 'raw',
      mimeType: 'x/raw',
      size: null,
    }),
    null,
  );
  assert.deepEqual(calls.get.at(-1), ['a', '/api/v1/files/7', { include: ['avatar'] }]);
  queues.uploads.push({ id: '8' });
  queues.get.push([], {});
  await assert.rejects(api.uploadAvatar(env.client, 'student', {}), /Canvas didn’t accept/);
  // Browser coalesces and checks the signed-in session result before native entry.
  reset();
  h = mountProfile();
  const session = deferred();
  queues.get.push(session.promise);
  const open = button(h, 'editWeb').onPress;
  const launch = open();
  void open();
  await flush();
  assert.equal(calls.get.length, 1);
  locale = 'fr';
  h.render();
  queues.browsers.push({ type: 'cancel' });
  session.resolve({ session_url: 'https://session.invalid/opaque' });
  await launch;
  assert.deepEqual(calls.get[0], [
    'a',
    '/api/v1/login/session_token',
    { return_to: 'https://a.invalid/profile' },
  ]);
  assert.deepEqual(calls.browsers[0], ['https://session.invalid/opaque']);
  const staleSession = deferred();
  queues.get.push(staleSession.promise);
  const staleLaunch = button(h, 'editWeb').onPress();
  await flush();
  online = false;
  h.render();
  staleSession.resolve({ session_url: 'https://stale.invalid' });
  await staleLaunch;
  assert.equal(calls.browsers.length, 1);
  h.unmount();
  reset();
  h = mountProfile();
  queues.get.push(() => {
    throw Error('school blocks session tokens');
  });
  queues.browsers.push({ type: 'opened' });
  await button(h, 'editWeb').onPress();
  assert.deepEqual(calls.browsers[0], ['https://a.invalid/profile']);
  h.unmount();
  // Failed-query retry remains available offline, coalesces, and rejects stale callbacks.
  reset();
  query = { ...query, data: null, isError: true, error: Error('raw failure') };
  let retries = 0;
  const retry = deferred();
  query.refetch = () => {
    retries++;
    return retry.promise;
  };
  online = false;
  h = mountProfile();
  const oldRetry = first(h, 'LoadError').onRetry;
  void oldRetry();
  void oldRetry();
  assert.equal(retries, 1);
  retry.reject(Error('failed'));
  await flush();
  query.refetch = async () => {
    retries++;
  };
  h.render();
  await first(h, 'LoadError').onRetry();
  assert.equal(retries, 2);
  env = { ...env, client: makeClient('b') };
  h.render();
  await oldRetry();
  assert.equal(retries, 2);
  h.unmount();
  assert.deepEqual(unexpected, []);
  for (const q of Object.values(queues)) assert.equal(q.length, 0);
  console.log(
    'profile forms: historical hashes, production form/helper/API deferred boundaries passed; TZ=' +
      process.env.TZ,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
