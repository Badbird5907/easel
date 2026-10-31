/* global __dirname */
/** Freshly transpiled production hook/components/helpers, catalogs, Intl, CanvasError,
 * fileSummary/kinds and timestampName. React hooks are a stateful simulation, native/design
 * nodes are prop records. Pickers/permissions, upload engine/session, Linking/Alerts, haptics,
 * accessibility, animation, safe-area/window metrics, recorder/thumbnail and query/openFile
 * boundaries are mocked. No native UI, actual focus/animation, compiler, I/O or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..'), cache = new Map();
let scope;
const calls = [], alerts = [], jobs = [];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const state = { permission: { granted: true }, document: { canceled: true }, image: { canceled: true }, reduced: false };
let client = { synthetic: true }, account = { id: 'account-a' };
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
        assert.ok(s.mounted, 'setState after unmount');
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
    get dirty() {
      return s.dirty;
    },
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

const jsx = (type, props, key) => ({ type, props, key });
const native = { Platform: { OS: 'ios' }, Alert: { alert: (...args) => alerts.push(args) }, Linking: { openSettings: () => { calls.push(['settings']); return Promise.resolve(); } }, AccessibilityInfo: { sendAccessibilityEvent: (...args) => calls.push(['focus', ...args]) }, useWindowDimensions: () => ({ height: 800, fontScale: 1 }) };
const record = (name, value) => (...args) => { calls.push([name, ...args]); return Promise.resolve(value()); };
const mock = {
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': new Proxy(native, { get: (o, k) => o[k] ?? k }),
  'lucide-react-native': new Proxy({}, { get: (_o, k) => k }),
  'react-native-reanimated': { SlideInDown: { duration: ms => ({ slide: ms }) } },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 12 }) },
  'expo-document-picker': { getDocumentAsync: record('document', () => state.document) },
  'expo-image-picker': {
    requestCameraPermissionsAsync: record('cameraPermission', () => state.permission),
    requestMediaLibraryPermissionsAsync: record('photosPermission', () => state.permission),
    launchCameraAsync: record('camera', () => state.image),
    launchImageLibraryAsync: record('photos', () => state.image),
  },
  '@/canvas/session': { useCanvas: () => ({ client, account }) },
  '@/canvas/uploads': { uploadToCanvas: (...args) => { const job = { ...deferred(), args }; jobs.push(job); calls.push(['upload', ...args]); return job.promise; } },
  '@/canvas/query': {}, '@tanstack/react-query': {},
  '@/design': new Proxy({ useTheme: () => ({ colors: { overlay: 'overlay', fg: 'fg' }, scheme: 'light' }), useReduceMotion: () => state.reduced, withAlpha: (color, alpha) => ({ color, alpha }), deriveAccent: color => ({ accent: color }), haptics: { selection: () => calls.push(['haptic']) } }, { get: (o, k) => o[k] ?? k }),
  '@/design/interop': { AnimatedView: 'AnimatedView' },
  '@/features/files/FileThumbnail': { FileThumbnail: 'FileThumbnail' },
  '@/features/files/open': { openFile: () => { throw Error('unexpected openFile'); } },
  '@/features/submissions/AudioRecorderSheet': { AudioRecorderSheet: 'AudioRecorderSheet' },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.') ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name)) : name;
  if (mock[key]) return mock[key];
  if (!key.startsWith('@/')) return require(key);
  const file = ['.ts', '.tsx', '/index.ts'].map(ext => path.join(root, key.slice(2)) + ext).find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', js)(n => load(n, file), module, module.exports);
  return module.exports;
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, type, test = () => true) => nodes(tree).find(n => n.type === type && test(n.props))?.props;
const i18n = load('@/i18n/runtime'), ui = load('@/features/inbox/attachments'), sheet = load('@/features/inbox/OptionsSheet');
const view = locale => { i18n.setAccountLocale('synthetic', locale); return i18n.createTranslator(locale); };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const local = { uri: 'synthetic://raw', name: 'Attach العربية.txt', size: 43, mimeType: 'text/plain' };
const file = { id: 'raw-id', name: local.name, filename: 'raw.txt', size: 43, contentType: 'text/plain', thumbnailUrl: null };
function hook(options = {}) {
  const config = { folderPath: 'conversation attachments', max: 2, owner: { resource: 'draft-a', focused: true, eligible: true }, ...options };
  const h = mount(() => ui.useAttachmentUploads(config));
  h.value = h.render(); h.config = config;
  return h;
}
(async () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'attachment-lifetime-historical.baseline.json'), 'utf8'));
  for (const [lang, values] of Object.entries(baseline.catalogs)) {
    const catalog = load(`@/i18n/${lang}`)[lang];
    for (const [key, digest] of Object.entries(values)) assert.equal(require('node:crypto').createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'), digest, `${lang}/${key}`);
  }
  const retire = (h, kind) => {
    if (kind === 'unmount') return h.unmount();
    if (kind === 'account') account = { id: account.id + '-next' };
    if (kind === 'client') client = { synthetic: true };
    if (kind === 'resource') h.config.owner.resource += '-next';
    if (kind === 'blur') h.config.owner.focused = false;
    if (kind === 'ineligible') h.config.owner.eligible = false;
    h.value = h.render();
  };
  // Delayed granted/denied permissions cannot enter a later native stage after retirement.
  for (const source of ['photos', 'camera', 'video']) for (const kind of ['account','client','resource','unmount','blur','ineligible']) for (const granted of [true,false]) {
    const h = hook(), wait = deferred(); state.permission = wait.promise;
    const pending = h.value.pick(source); retire(h, kind);
    const before = calls.length, alertsBefore = alerts.length, jobsBefore = jobs.length;
    wait.resolve({ granted }); await pending;
    assert.equal(calls.length, before, `${source}/${kind}/${granted}`); assert.equal(alerts.length, alertsBefore); assert.equal(jobs.length, jobsBefore);
    if (kind !== 'unmount') { assert.deepEqual(h.render().items, []); h.unmount(); }
  }
  // All late picker results, including after blur/re-focus, stay retired. Full replacement clears owned files.
  for (const source of ['files','photos','camera','video']) for (const kind of ['account','client','resource','unmount','blur','ineligible']) {
    const h = hook(), wait = deferred(); state.permission = { granted: true }; state.document = state.image = wait.promise;
    h.value.seed([file]); h.value = h.render();
    const pending = h.value.pick(source); await flush();
    assert.ok(['document','photos','camera'].includes(calls.at(-1)[0]));
    retire(h, kind);
    if (kind === 'blur' || kind === 'ineligible') {
      assert.equal(h.render().files[0], file);
      h.config.owner.focused = h.config.owner.eligible = true; h.render();
    }
    const before = jobs.length;
    wait.resolve({ canceled: false, assets: [{ ...local, fileName: local.name, fileSize: 43, type: 'image' }] }); await pending;
    assert.equal(jobs.length, before);
    if (kind !== 'unmount') { assert.deepEqual(h.render().files, kind === 'blur' || kind === 'ineligible' ? [file] : []); h.unmount(); }
  }
  // Accepted progress/success survives temporary UI retirement, unlike account/resource/unmount.
  for (const kind of ['blur','ineligible','account','client','resource','unmount']) for (const outcome of ['success','error']) {
    const h = hook(); h.value.seed([file]); h.value.add([local]); const job = jobs.at(-1); retire(h, kind);
    job.args[3].onProgress(.75);
    if (outcome === 'success') job.resolve({ ...file, id: 'new-file' }); else job.reject(new Error('synthetic failure'));
    await flush();
    if (kind !== 'unmount') {
      const u = h.render();
      if (kind === 'blur' || kind === 'ineligible') {
        assert.equal(u.items.length, 2); assert.equal(u.files[0], file); assert.equal(u.items[1].status, outcome === 'success' ? 'done' : 'error');
        h.config.owner.focused = h.config.owner.eligible = true;
        assert.equal(h.render().items, u.items);
      } else assert.deepEqual(u.items, []);
      h.unmount();
    }
  }
  // Native denial callbacks retain invocation language and their original UI generation.
  for (const kind of ['account','client','resource','unmount','blur','ineligible','reset','seed']) {
    view('fr'); const h = hook(); state.permission = { granted: false }; await h.value.pick('camera');
    const alert = alerts.at(-1), settings = alert[2][1].onPress;
    assert.equal(alert[0], i18n.createTranslator('fr')('attachment.cameraOff'));
    view('ar'); h.render();
    let before = calls.length; settings(); assert.equal(calls.length, before + 1); assert.equal(calls.at(-1)[0], 'settings');
    if (kind === 'reset') h.value.reset(); else if (kind === 'seed') h.value.seed([file]); else retire(h, kind);
    if (kind === 'blur') { h.config.owner.focused = true; h.render(); }
    before = calls.length; settings(); assert.equal(calls.length, before, kind);
    if (kind !== 'unmount') h.unmount();
  }
  // Every overlapping source shares one native slot; cancellation/errors release it.
  for (const source of ['files','photos','camera','video']) for (const outcome of ['success','cancel','reject']) {
    const h = hook({ max: 1 }), wait = deferred(); state.permission = { granted: true }; state.document = state.image = wait.promise;
    const first = h.value.pick(source); await flush(); const before = calls.length;
    await h.value.pick('files'); await h.value.pick('camera'); assert.equal(calls.length, before);
    const count = jobs.length;
    if (outcome === 'reject') wait.reject(new Error('synthetic picker failure'));
    else wait.resolve({ canceled: outcome === 'cancel', assets: [local,local] });
    if (outcome === 'reject') await assert.rejects(first, /synthetic picker failure/); else await first;
    assert.equal(jobs.length, count + (outcome === 'success' ? 1 : 0));
    h.render().reset(); state.document = { canceled: true }; await h.render().pick('files'); assert.equal(calls.at(-1)[0], 'document'); h.unmount();
  }
  // Native slot remains reserved on blur/refocus: no claim to cancel the entered OS picker.
  {
    const h = hook(), wait = deferred(); state.document = wait.promise;
    const pending = h.value.pick('files'); retire(h, 'blur'); h.config.owner.focused = true; const active = h.render();
    const before = calls.length; await active.pick('files'); assert.equal(calls.length, before);
    wait.resolve({ canceled: true }); await pending;
    state.document = { canceled: true }; await active.pick('files'); assert.equal(calls.length, before + 1); h.unmount();
  }
  // Current capacity wins over stale options; adds reserve slots synchronously before rendering.
  {
    const h = hook(), wait = deferred(); state.document = wait.promise;
    const pending = h.value.pick('files'); h.value.add([local]); h.config.max = 1; h.render();
    const before = jobs.length; wait.resolve({ canceled: false, assets: [local] }); await pending; assert.equal(jobs.length, before); assert.equal(h.render().items.length, 1);
    h.value.add([local]); assert.equal(jobs.length, before); h.unmount();
  }
  // Locale and abandoned replacement renders are inert for live operations and callbacks.
  for (const source of ['files','photos','camera','video']) {
    const h = hook(), wait = deferred(); state.permission = wait.promise; state.document = state.image = source === 'files' ? wait.promise : { canceled: false, assets: [local] };
    const pending = h.value.pick(source), previousClient = client;
    client = { speculative: true }; h.renderOnly(); h.abandon(); client = previousClient;
    for (const locale of ['fr','ar','en']) { view(locale); h.render(); }
    const before = jobs.length; wait.resolve(source === 'files' ? { canceled: false, assets: [local] } : { granted: true }); await pending;
    assert.equal(jobs.length, before + 1); assert.equal(jobs.at(-1).args[0], previousClient); h.unmount();
  }
  // Retained operations from an old committed render never target a replacement owner.
  for (const kind of ['account','client','resource','unmount','blur','ineligible']) {
    const h = hook(), old = h.value; old.add([local]); jobs.at(-1).reject(new Error('synthetic')); await flush();
    const key = h.render().items[0].key; retire(h, kind);
    if (kind === 'blur' || kind === 'ineligible') { h.config.owner.focused = h.config.owner.eligible = true; h.render(); }
    const before = calls.length; old.add([local]); await old.pick('files'); old.retry(key); old.remove(key); assert.equal(calls.length, before);
    if (kind !== 'unmount') { if (kind === 'blur' || kind === 'ineligible') assert.equal(h.render().items.length, 1); h.unmount(); }
  }
  // Actual AttachButton and hook together: menu/recorder ownership, locale, disabled, teardown.
  const controls = () => {
    const h = hook(); let disabled = false, media = true;
    const b = mount(() => ui.AttachButton({ uploads: h.render(), disabled, media }));
    const open = () => { find(b.render(), 'Button').onPress(); return find(b.render(), sheet.OptionsSheet); };
    const audio = () => { open().options.find(o => o.key === 'audio').onPress(); return find(b.render(), 'AudioRecorderSheet'); };
    return { h, b, open, audio, disable: () => { disabled = true; b.render(); }, noMedia: () => { media = false; b.render(); } };
  };
  for (const kind of ['account','client','resource','unmount','blur','ineligible','reset','seed','disabled','media']) {
    const c = controls(), menu = c.open(), oldAudio = menu.options.find(o => o.key === 'audio').onPress;
    if (kind === 'disabled') c.disable(); else if (kind === 'media') c.noMedia();
    else if (kind === 'reset') c.h.value.reset(); else if (kind === 'seed') c.h.value.seed([file]);
    else if (kind === 'unmount') { c.b.unmount(); c.h.unmount(); } else { retire(c.h, kind); c.b.render(); }
    if (kind === 'blur') { c.h.config.owner.focused = true; c.b.render(); }
    const before = calls.length; oldAudio(); for (const o of menu.options.filter(o => o.key !== 'audio')) o.onPress(); await flush(); assert.equal(calls.length, before, kind);
    if (kind !== 'unmount') { assert.notEqual(find(c.b.render(), 'AudioRecorderSheet')?.visible, true, kind); c.b.unmount(); c.h.unmount(); }
  }
  for (const kind of ['blur','account','resource','unmount','disabled','reset']) {
    const c = controls(), recorder = c.audio(); assert.equal(recorder.visible, true);
    if (kind === 'disabled') c.disable(); else if (kind === 'reset') c.h.value.reset();
    else if (kind === 'unmount') { c.b.unmount(); c.h.unmount(); } else { retire(c.h, kind); c.b.render(); }
    const before = jobs.length; recorder.onAttach(local); recorder.onClose(); assert.equal(jobs.length, before);
    if (kind !== 'unmount') { c.b.unmount(); c.h.unmount(); }
  }
  {
    const c = controls(), menu = c.open(); view('ar'); c.b.render(); menu.options.find(o => o.key === 'audio').onPress();
    const recorder = find(c.b.render(), 'AudioRecorderSheet'); assert.equal(recorder.visible, true);
    view('fr'); assert.equal(find(c.b.render(), 'AudioRecorderSheet').visible, true);
    recorder.onAttach({ ...local, name: 'Voice comment raw.m4a' }); const before = jobs.length;
    assert.equal(jobs.at(-1).args[2].name, 'Voice message raw.m4a'); recorder.onAttach(local); assert.equal(jobs.length, before);
    const replacement = c.audio(); assert.equal(replacement.visible, true);
    recorder.onClose(); recorder.onAttach(local); assert.equal(jobs.length, before); assert.equal(find(c.b.render(), 'AudioRecorderSheet').visible, true);
    replacement.onAttach(local); assert.equal(jobs.length, before + 1); c.b.unmount(); c.h.unmount();
  }
  // Plain dismissal and a replacement opening retire a menu, but a selected
  // iOS dismissal may deliver its chosen action exactly once afterward.
  for (const mode of ['dismiss', 'replace', 'selected', 'selected-replaced']) {
    const c = controls(), menu = c.open();
    const audio = menu.options.find(o => o.key === 'audio').onPress;
    if (mode === 'dismiss') menu.onClose();
    if (mode === 'replace') c.open();
    if (mode === 'selected' || mode === 'selected-replaced') menu.onClose(true);
    c.b.render();
    if (mode === 'selected-replaced') c.open();
    audio();
    assert.equal(find(c.b.render(), 'AudioRecorderSheet').visible, mode === 'selected', mode);
    if (mode === 'selected') {
      find(c.b.render(), 'AudioRecorderSheet').onClose();
      audio();
      assert.equal(find(c.b.render(), 'AudioRecorderSheet').visible, false, 'one selected action');
    }
    c.b.unmount(); c.h.unmount();
  }
  // A retained audio action cannot overlap an entered native picker.
  {
    const c = controls(), menu = c.open(), wait = deferred(); state.document = wait.promise;
    const pending = c.h.value.pick('files');
    menu.options.find(o => o.key === 'audio').onPress();
    assert.equal(find(c.b.render(), 'AudioRecorderSheet').visible, false);
    wait.resolve({ canceled: true }); await pending; c.b.unmount(); c.h.unmount();
  }
  console.log(`attachment lifetime: PASS (${process.env.TZ || 'host TZ'}); actual hook/control; deferred synthetic permission/picker/upload/native boundaries; historical hashes preserved`);
})().catch(error => { console.error(error); process.exitCode = 1; });
