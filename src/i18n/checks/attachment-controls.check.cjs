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
const client = { synthetic: true };
const react = {
  useState(initial) { const s = scope, i = s.cursor++; if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial; return [s.slots[i], v => { s.slots[i] = typeof v === 'function' ? v(s.slots[i]) : v; }]; },
  useRef(v) { return react.useState(() => ({ current: v }))[0]; },
  useMemo(fn, deps) { const r = react.useRef(); if (!r.current || deps.some((v, i) => !Object.is(v, r.current.deps[i]))) r.current = { deps, value: fn() }; return r.current.value; },
  useLayoutEffect(fn, deps) { const s = scope, i = s.cursor++, old = s.slots[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) { s.effects.push(() => { old?.cleanup?.(); s.slots[i] = { deps, cleanup: fn() }; }); } },
  useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
};
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
  '@/canvas/session': { useCanvas: () => ({ client }) },
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
function harness(fn) { const s = { slots: [], cursor: 0, effects: [] }; return props => { scope = s; s.cursor = 0; s.effects = []; try { const tree = fn(props); s.effects.forEach(f => f()); return tree; } finally { scope = null; } }; }
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, type, test = () => true) => nodes(tree).find(n => n.type === type && test(n.props))?.props;
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const i18n = load('@/i18n/runtime'), ui = load('@/features/inbox/attachments'), sheet = load('@/features/inbox/OptionsSheet');
const p = load('@/features/inbox/attachmentPresentation'), { CanvasError } = load('@/canvas/client');
const { fileSummary } = load('@/features/files/AttachmentList');
const view = locale => { i18n.setAccountLocale('synthetic', locale); return i18n.createTranslator(locale); };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const local = { uri: 'synthetic://raw', name: 'Attach العربية.txt', size: 43, mimeType: 'text/plain' };
const file = { id: 'raw-id', name: local.name, filename: 'raw.txt', size: 43, contentType: 'text/plain', thumbnailUrl: null };
function hook(options = { folderPath: 'conversation attachments', max: 2 }) { const render = harness(() => ui.useAttachmentUploads(options)); return { render, value: render() }; }
(async () => {
  const langs = ['en','fr','ar'], catalogs = langs.map(lang => load(`@/i18n/${lang}`)[lang]);
  assert.ok(Object.keys(catalogs[0]).length >= 1388);
  const slots = value => [...new Set(JSON.stringify(value).match(/\{\w+\}/g) ?? [])].sort();
  for (const catalog of catalogs.slice(1)) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(catalogs[0]).sort());
    for (const key of Object.keys(catalog)) assert.deepEqual(slots(catalog[key]), slots(catalogs[0][key]), key);
  }
  if (process.env.ATTACHMENT_CONTROLS_BASELINE) for (const [i, lang] of langs.entries()) {
    const module = { exports: {} };
    new Function('exports', ts.transpileModule(fs.readFileSync(path.join(process.env.ATTACHMENT_CONTROLS_BASELINE, `${lang}.ts`), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(module.exports);
    assert.equal(Object.keys(module.exports[lang]).length, 1359);
    for (const [key, value] of Object.entries(module.exports[lang])) assert.deepEqual(catalogs[i][key], value, `baseline ${lang}/${key}`);
  }
  const generic = p.uploadError(new Error('quota'), local.name), quota = p.uploadError(new CanvasError('QUOTA exceeded', 400, '/raw'), local.name);
  assert.equal(generic.error, `Couldn’t upload ${local.name}. Check your connection and try again.`);
  assert.deepEqual(generic.errorOrigin, { kind: 'attachment-upload', name: local.name });
  assert.deepEqual(quota, { error: 'Your Canvas file storage is full. Delete files in Canvas, then try again.', errorOrigin: { kind: 'attachment-quota' } });
  assert.deepEqual(JSON.parse(JSON.stringify(generic)), generic);
  assert.deepEqual(p.uploadError(new CanvasError('other', 500, '/raw'), local.name), generic);
  const list = harness(ui.PendingAttachmentList), status = harness(ui.AttachmentStatus);
  const item = { key: 'preserved', local, status: 'uploading', fraction: .125, file: null, error: null };
  const callbackCalls = [];
  const uploads = { items: [item], uploading: true, failed: false, full: false, pick: source => callbackCalls.push(['pick', source]), add: files => callbackCalls.push(['add', files]), retry: key => callbackCalls.push(['retry', key]), remove: key => callbackCalls.push(['remove', key]) };
  for (const locale of langs) {
    const t = view(locale);
    for (const fraction of [0, null, .125, .999, 1]) {
      item.fraction = fraction;
      const before = JSON.stringify(uploads), effects = calls.length, tree = list({ uploads }), row = find(tree, 'ListItem');
      const progress = fraction == null ? t('attachment.uploading') : t('attachment.uploadingPercent', { percent: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(Math.round(fraction * 100) / 100) });
      assert.equal(row.title, local.name); assert.equal(row.subtitle, undefined);
      assert.equal(row.accessibilityLabel, t('attachment.nameStatus', { name: local.name, status: progress }));
      assert.equal(find(row.trailing, 'ProgressBar').value, fraction ?? 0);
      assert.equal(JSON.stringify(uploads), before); assert.equal(calls.length, effects);
    }
    assert.equal(text(status({ uploads })), t('attachment.wait'));
    assert.equal(ui.attachmentStatusLine(uploads), 'Wait for attachments to finish uploading.');
    assert.equal(ui.attachmentStatusLine(uploads, locale), t('attachment.wait'));
    for (const err of [generic, quota, { error: generic.error }, { error: '' }, { error: 'Server detail' }, { error: 'Upload failed', errorOrigin: { kind: 'future' } }, { error: 'Malformed', errorOrigin: { kind: 'attachment-upload' } }, { error: null }]) {
      const errorItem = { ...item, status: 'error', ...err }, u = { ...uploads, items: [errorItem], uploading: false, failed: true };
      const row = find(list({ uploads: u }), 'ListItem');
      const expected = err === generic ? t('attachment.uploadError', { name: local.name }) : err === quota ? t('attachment.storageFull') : err.error ?? t('attachment.failed');
      assert.equal(row.subtitle, expected);
      const retry = find(row.trailing, 'IconButton', b => b.icon === 'RotateCw'), remove = find(row.trailing, 'IconButton', b => b.icon === 'X');
      assert.equal(retry.accessibilityLabel, t('attachment.retry', { name: local.name }));
      assert.equal(remove.accessibilityLabel, t('attachment.remove', { name: local.name }));
      retry.onPress(); remove.onPress();
      assert.deepEqual(callbackCalls.splice(0), [['retry', item.key], ['remove', item.key]]);
      assert.equal(text(status({ uploads: u })), t('attachment.retryOrRemove'));
    }
    assert.equal(find(list({ uploads: { ...uploads, items: [{ ...item, status: 'done', file }] } }), 'ListItem').subtitle, fileSummary(file, locale));
    assert.equal(find(list({ uploads: { ...uploads, items: [{ ...item, status: 'done' }] } }), 'ListItem').subtitle, '');
    assert.equal(list({ uploads: { ...uploads, items: [] } }), null);
    assert.equal(status({ uploads: { uploading: false, failed: false } }), null);
  }
  // Same hook state across locales: async progress/failure, explicit target and compatibility error.
  view('en'); const h = hook(); h.value.add([local]); let u = h.render(), job = jobs.at(-1);
  assert.deepEqual(job.args.slice(0, 3), [client, '/api/v1/users/self/files', local]);
  assert.deepEqual(job.args[3].params, { parent_folder_path: 'conversation attachments', on_duplicate: 'rename' });
  const initialKey = u.items[0].key;
  job.args[3].onProgress(.316); u = h.render(); const sameItems = u.items;
  for (const locale of langs) { view(locale); const before = calls.length; u = h.render(); list({ uploads: u }); assert.equal(u.items, sameItems); assert.equal(u.items[0].local, local); assert.equal(calls.length, before); }
  job.reject(new Error('raw network failure')); await flush(); u = h.render();
  assert.equal(u.items[0].key, initialKey); assert.equal(u.items[0].fraction, .316);
  assert.equal(u.items[0].error, generic.error); assert.deepEqual(u.items[0].errorOrigin, generic.errorOrigin);
  assert.equal(find(list({ uploads: u }), 'ListItem').subtitle, view('ar')('attachment.uploadError', { name: local.name }));
  const failedItems = u.items;
  for (const locale of langs) { const t = view(locale), before = calls.length; u = h.render(); assert.equal(u.items, failedItems); assert.equal(find(list({ uploads: u }), 'ListItem').subtitle, t('attachment.uploadError', { name: local.name })); assert.equal(calls.length, before); }
  u.retry(initialKey); u = h.render(); job = jobs.at(-1);
  assert.equal(u.items[0].error, null); assert.equal(u.items[0].errorOrigin, undefined); assert.equal(u.items[0].fraction, 0); assert.equal(u.items[0].status, 'uploading'); assert.equal(job.args[2], local);
  job.reject(new CanvasError('quota exceeded', 400, '/raw')); await flush(); u = h.render(); assert.deepEqual(u.items[0].errorOrigin, quota.errorOrigin);
  u.retry(initialKey); job = jobs.at(-1); job.resolve(file); await flush(); u = h.render();
  assert.equal(u.items[0].file, file); assert.equal(u.files[0], file); assert.equal(u.items[0].fraction, 1); assert.equal(u.uploading, false); assert.equal(u.failed, false);
  const doneItems = u.items; for (const locale of langs) { view(locale); const before = calls.length; u = h.render(); assert.equal(find(list({ uploads: u }), 'ListItem').subtitle, fileSummary(file, locale)); assert.equal(u.items, doneItems); assert.equal(u.files[0], file); assert.equal(calls.length, before); }
  u.remove(initialKey); assert.deepEqual(h.render().items, []);
  const beforeUnknown = jobs.length; h.render().retry('missing'); assert.equal(jobs.length, beforeUnknown);
  // Reset/seed ignore old progress, success and errors; remove cannot be resurrected.
  for (const action of ['reset', 'seed', 'remove']) for (const outcome of ['success', 'error']) {
    const h = hook({ folderPath: 'unfiled', max: 1 }); h.value.add([local]); let u = h.render(); const old = jobs.at(-1);
    assert.deepEqual(old.args[3].params, { parent_folder_path: 'unfiled', on_duplicate: 'rename' });
    if (action === 'seed') u.seed([file]); else if (action === 'remove') u.remove(u.items[0].key); else u.reset();
    u = h.render(); const preserved = JSON.stringify(u.items);
    old.args[3].onProgress(.9);
    if (outcome === 'success') old.resolve(file); else old.reject(new Error('late'));
    await flush(); u = h.render();
    assert.equal(JSON.stringify(u.items), preserved);
    if (action === 'seed') { assert.equal(u.files[0], file); assert.deepEqual(u.items[0].local, { uri: '', name: file.name, size: file.size, mimeType: file.contentType }); assert.equal(u.full, true); }
  }
  // Capacity, exact document inputs, cancel, late permission Alerts retain invoking language.
  for (const locale of langs) {
    const t = view(locale), h = hook({ folderPath: 'unfiled', max: 1 });
    state.document = { canceled: true, assets: null }; let before = jobs.length; await h.value.pick('files'); assert.equal(jobs.length, before); assert.deepEqual(h.render().items, []); assert.deepEqual(calls.at(-1), ['document', { copyToCacheDirectory: true, multiple: false }]);
    state.document = { canceled: false, assets: [local, { ...local, name: 'excess' }] }; await h.render().pick('files'); assert.equal(jobs.length, before + 1); assert.deepEqual(jobs.at(-1).args[2], local); assert.equal(h.render().full, true);
    before = calls.length; await h.render().pick('photos'); assert.equal(calls.length, before);
    for (const source of ['photos', 'camera', 'video']) {
      view(locale); const denied = hook(), wait = deferred(); state.permission = wait.promise;
      const effects = calls.length, jobCount = jobs.length;
      const pending = denied.value.pick(source); view(locale === 'ar' ? 'en' : 'ar'); wait.resolve({ granted: false }); await pending;
      assert.deepEqual(calls.slice(effects), [[source === 'photos' ? 'photosPermission' : 'cameraPermission']]); assert.equal(jobs.length, jobCount);
      const alert = alerts.at(-1); assert.equal(alert[0], t(source === 'photos' ? 'attachment.photosOff' : 'attachment.cameraOff'));
      assert.equal(alert[1], t(source === 'photos' ? 'attachment.photosPermission' : source === 'video' ? 'attachment.videoPermission' : 'attachment.cameraPermission'));
      assert.equal(alert[2][0].text, t('attachment.notNow')); assert.equal(alert[2][0].style, 'cancel'); assert.equal(alert[2][0].onPress, undefined);
      assert.equal(alert[2][1].text, t('attachment.openSettings')); alert[2][1].onPress(); assert.deepEqual(calls.at(-1), ['settings']); assert.deepEqual(denied.render().items, []);
    }
  }
  state.permission = { granted: true };
  for (const locale of langs) for (const source of ['files','photos','camera','video']) for (const max of [1, 2, Infinity]) {
    view(locale); const h = hook({ folderPath: 'unfiled', max });
    state.document = state.image = { canceled: true, assets: null }; let before = jobs.length; await h.value.pick(source); assert.equal(jobs.length, before); assert.deepEqual(h.render().items, []);
    const expectedOptions = source === 'files' ? { copyToCacheDirectory: true, multiple: max > 1 } : { mediaTypes: source === 'video' ? ['videos'] : ['images', 'videos'], quality: .85, allowsMultipleSelection: source === 'photos' && max > 1, selectionLimit: Number.isFinite(max) ? max : 0, ...(source === 'video' && { videoMaxDuration: 600 }) };
    assert.deepEqual(calls.at(-1), [source === 'video' ? 'camera' : source === 'files' ? 'document' : source, expectedOptions]);
    if (source !== 'files') assert.deepEqual(calls.at(-2), [source === 'photos' ? 'photosPermission' : 'cameraPermission']);
    state.document = { canceled: false, assets: [local] };
    state.image = { canceled: false, assets: [{ uri: 'synthetic://image', fileName: 'raw العربية.mov', fileSize: 12, mimeType: 'video/quicktime', type: 'video' }] };
    await h.render().pick(source); const picked = h.render().items[0].local;
    if (source === 'files') assert.deepEqual(picked, local);
    else { assert.equal(picked.uri, 'synthetic://image'); assert.equal(picked.mimeType, 'video/quicktime'); assert.equal(picked.size, 12); if (source === 'video') assert.match(picked.name, /^Video message .+ at \d{2}\.\d{2}\.\d{2}\.mov$/); else assert.equal(picked.name, 'raw العربية.mov'); }
    assert.equal(jobs.at(-1).args[2], picked);
  }
  // Filename fallbacks remain payload data, including existing missing-MIME behavior.
  for (const asset of [{ type: 'image', mimeType: 'image/jpeg' }, { type: 'video' }, { type: 'image' }]) {
    const h = hook(); state.image = { canceled: false, assets: [{ uri: 'synthetic://fallback', ...asset }] }; await h.value.pick('photos');
    assert.deepEqual(h.render().items[0].local, { uri: 'synthetic://fallback', name: `${asset.type === 'video' ? 'Video' : 'Photo'} 1.jpg`, size: null, mimeType: asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg') });
  }
  // Attach menu stays open through locale changes; explicit/empty labels are never defaults.
  for (const media of [false, true]) {
    const render = harness(ui.AttachButton); view('en'); let tree = render({ uploads, media });
    const ref = find(tree, 'Button').ref; find(tree, 'Button').onPress();
    for (const locale of langs) {
      find(render({ uploads, media }), 'Button').onPress();
      const t = view(locale), before = calls.length; tree = render({ uploads, media });
      const button = find(tree, 'Button'), menu = find(tree, sheet.OptionsSheet);
      assert.equal(text(button.children), t('attachment.attach')); assert.equal(button.accessibilityHint, t('attachment.chooseHint')); assert.equal(button.ref, ref);
      assert.equal(menu.visible, true); assert.equal(menu.returnFocusRef, ref); assert.equal(menu.title, t('attachment.attach'));
      assert.deepEqual(menu.options.map(o => o.key), media ? ['files','photos','camera','video','audio'] : ['files','photos','camera']);
      assert.equal(calls.length, before); assert.equal(callbackCalls.length, 0);
      // Each choice consumes one opening; reopen before exercising the next choice.
      // Retained dismissed/replaced actions are covered by attachment-lifetime.
      for (const option of menu.options) {
        assert.equal(option.label, t(`attachment.${option.key}`));
        find(render({ uploads, media }), 'Button').onPress();
        find(render({ uploads, media }), sheet.OptionsSheet).options.find(o => o.key === option.key).onPress();
      }
      assert.deepEqual(callbackCalls.splice(0), (media ? ['files','photos','camera','video'] : ['files','photos','camera']).map(s => ['pick', s]));
      if (media) { tree = render({ uploads, media }); assert.equal(find(tree, 'AudioRecorderSheet').visible, true); }
      for (const label of ['', 'Attach', 'Raw العربية']) assert.equal(text(find(render({ uploads, media, label }), 'Button').children), label);
    }
    if (media) {
      let recorder = find(render({ uploads, media }), 'AudioRecorderSheet');
      assert.deepEqual(Object.keys(recorder).sort(), ['visible','onClose','onAttach'].sort());
      recorder.onAttach({ ...local, name: 'Voice comment raw.m4a' });
      assert.deepEqual(callbackCalls.splice(0), [['add', [{ ...local, name: 'Voice message raw.m4a' }]]]);
      assert.equal(find(render({ uploads, media }), 'AudioRecorderSheet').visible, false);
      // A second accepted recording needs a new entry; duplicate old adoption is now rejected.
      find(render({ uploads, media }), 'Button').onPress();
      find(render({ uploads, media }), sheet.OptionsSheet).options.find(o => o.key === 'audio').onPress();
      recorder = find(render({ uploads, media }), 'AudioRecorderSheet');
      recorder.onAttach(local); assert.deepEqual(callbackCalls.splice(0), [['add', [local]]]);
      recorder.onClose();
    } else assert.equal(find(tree, 'AudioRecorderSheet'), undefined);
    find(render({ uploads, media }), sheet.OptionsSheet).onClose(); assert.equal(find(render({ uploads, media }), sheet.OptionsSheet).visible, false);
    assert.equal(find(render({ uploads: { ...uploads, full: true }, media }), 'Button').disabled, true);
    assert.equal(find(render({ uploads, disabled: true, media }), 'Button').disabled, true);
  }
  // Production sheet: pending callback ownership, focus refs/props and all dismissal paths.
  for (const platform of ['ios', 'android']) for (const reduced of [false, true]) {
    native.Platform.OS = platform; state.reduced = reduced;
    const render = harness(sheet.OptionsSheet), returnFocusRef = { current: { trigger: true } };
    const options = [{ key: 'one', label: 'Options', subtitle: 'Server subtitle', selected: true, destructive: true, icon: 'Delete', onPress: () => calls.push(['original']) }, { key: 'empty', label: '', selected: false, onPress: () => calls.push(['empty']) }];
    const closeReasons = [];
    const originalOptions = options.slice(), props = { visible: true, options, onClose: (selected) => { closeReasons.push(selected); calls.push(['close']); }, returnFocusRef };
    let headingRef;
    for (const locale of langs) {
      const t = view(locale), before = calls.length, tree = render(props), modal = find(tree, 'Modal');
      const heading = find(tree, 'View', p => p.accessibilityRole === 'header');
      assert.equal(heading.accessibilityLabel, t('attachment.options')); assert.equal(text(heading.children), t('attachment.options'));
      if (headingRef) assert.equal(heading.ref, headingRef); else headingRef = heading.ref;
      assert.equal(text(find(tree, 'Button').children), t('attachment.done')); assert.equal(modal.visible, true);
      assert.equal(modal.animationType, reduced ? 'none' : 'fade'); assert.equal(modal.transparent, true); assert.equal(modal.statusBarTranslucent, true); assert.equal(modal.navigationBarTranslucent, true);
      assert.equal(find(tree, 'AnimatedView').accessibilityViewIsModal, true); assert.deepEqual(find(tree, 'AnimatedView').entering, reduced ? undefined : { slide: 220 });
      const row = find(tree, 'Pressable', p => p.accessibilityRole === 'radio');
      assert.equal(row.accessibilityLabel, t('attachment.optionSubtitle', { label: 'Options', subtitle: 'Server subtitle' })); assert.deepEqual(row.accessibilityState, { checked: true });
      assert.equal(find(tree, 'Icon', p => p.icon === 'Delete').tone, 'danger');
      assert.equal(find(tree, 'Pressable', p => p.accessibilityLabel === '').accessibilityState.checked, false);
      assert.deepEqual(nodes(tree).filter(n => n.type === 'Pressable' && n.key).map(n => n.key), ['one','empty']);
      assert.deepEqual(options, originalOptions); assert.equal(calls.length, before);
      for (const title of ['', 'Options', 'Custom العربية']) assert.equal(find(render({ ...props, title }), 'View', p => p.accessibilityRole === 'header').accessibilityLabel, title);
    }
    let tree = render(props), modal = find(tree, 'Modal'); headingRef.current = { header: true };
    let before = calls.length; modal.onShow(); assert.deepEqual(calls.slice(before), [['focus', headingRef.current, 'focus']]);
    const backdrop = find(tree, 'Pressable', p => p.accessible === false);
    assert.equal(backdrop.focusable, false); assert.equal(backdrop.accessibilityElementsHidden, true); assert.equal(backdrop.importantForAccessibility, 'no-hide-descendants');
    for (const close of [backdrop.onPress, modal.onRequestClose, find(tree, 'Button').onPress, find(tree, 'AnimatedView').onAccessibilityEscape]) {
      before = calls.length; close(); assert.deepEqual(calls.slice(before), [['close']]);
      assert.equal(closeReasons.at(-1), undefined, 'plain dismissal does not claim a selection');
    }
    before = calls.length; modal.onDismiss(); assert.deepEqual(calls.slice(before), [['focus', returnFocusRef.current, 'focus']]);
    before = calls.length; find(tree, 'Pressable', p => p.accessibilityRole === 'radio').onPress();
    assert.deepEqual(calls.slice(before), platform === 'ios' ? [['haptic'], ['close']] : [['haptic'], ['close'], ['original']]);
    assert.equal(closeReasons.at(-1), true, 'selected close retains its dismissal handoff');
    // Locale and a replacement options array must not replace an already selected callback.
    view('fr'); before = calls.length; tree = render({ ...props, visible: false, options: [{ ...options[0], onPress: () => calls.push(['replacement']) }] });
    assert.equal(calls.length, before); modal = find(tree, 'Modal'); modal.onDismiss();
    assert.deepEqual(calls.slice(before), platform === 'ios' ? [['original']] : [['focus', returnFocusRef.current, 'focus']]);
    before = calls.length; modal.onDismiss(); assert.deepEqual(calls.slice(before), [['focus', returnFocusRef.current, 'focus']], 'pending callback clears');
  }
  const chip = harness(sheet.MenuChip), ref = { current: {} }, onPress = () => calls.push(['chip']);
  for (const locale of langs) for (const label of ['', 'Options', 'Server العربية']) {
    const t = view(locale), before = calls.length, tree = chip({ ref, label, accessibilityLabel: 'Course filter', onPress, active: true, color: 'custom-color' });
    const button = find(tree, 'PressableScale');
    assert.equal(text(find(tree, 'Text').children), label); assert.equal(button.ref, ref); assert.equal(button.onPress, onPress); assert.equal(button.haptic, 'selection'); assert.equal(find(tree, 'AccentScope').color, 'custom-color');
    assert.equal(button.accessibilityLabel, t('attachment.menuLabel', { label: 'Course filter', value: label })); assert.equal(button.accessibilityHint, t('attachment.menuHint'));
    assert.equal(calls.length, before); button.onPress(); assert.deepEqual(calls.at(-1), ['chip']);
  }
  // A canceled outstanding picker must not add after a locale change/reset/seed.
  for (const source of ['files', 'photos', 'camera', 'video']) {
    view('en'); const h = hook(), wait = deferred(); state.permission = { granted: true }; state.document = state.image = wait.promise;
    const pending = h.value.pick(source); await flush(); h.render().seed([file]);
    view('ar'); const seeded = h.render().items, count = jobs.length;
    wait.resolve({ canceled: true, assets: null }); await pending;
    assert.equal(h.render().items, seeded); assert.equal(jobs.length, count);
  }
  // Partial capacity and direct add truncation use the same existing limits.
  const partial = hook(); partial.value.seed([file]); state.document = { canceled: true, assets: null };
  await partial.render().pick('files'); assert.deepEqual(calls.at(-1), ['document', { copyToCacheDirectory: true, multiple: false }]);
  state.image = { canceled: true, assets: null }; await partial.render().pick('photos');
  assert.deepEqual(calls.at(-1), ['photos', { mediaTypes: ['images','videos'], quality: .85, allowsMultipleSelection: false, selectionLimit: 1 }]);
  const count = jobs.length; partial.render().add([local, { ...local, name: 'excess' }]); assert.equal(jobs.length, count + 1); assert.equal(partial.render().items.length, 2);
  const items = partial.render().items; partial.render().add([local]); assert.equal(partial.render().items, items); assert.equal(jobs.length, count + 1);
  // Reset invalidates outstanding picker results; additions reserve capacity synchronously.
  const delayed = hook({ folderPath: 'unfiled', max: 1 }), pendingPick = deferred(); state.document = pendingPick.promise;
  const picking = delayed.value.pick('files'); delayed.render().reset(); pendingPick.resolve({ canceled: false, assets: [local] }); await picking;
  assert.equal(delayed.render().items.length, 0, 'a picker started before reset must not add');
  const concurrent = hook({ folderPath: 'unfiled', max: 1 }); concurrent.value.add([local]); concurrent.value.add([local]);
  assert.equal(concurrent.render().items.length, 1, 'same-render add closures must respect max');
  // Successful stale selections are ignored for every picker, after reset or seeding an edit.
  for (const source of ['files', 'photos', 'camera', 'video']) for (const action of ['reset', 'seed']) {
    const h = hook(), wait = deferred(); state.permission = { granted: true }; state.document = state.image = wait.promise;
    const pending = h.value.pick(source); await flush();
    if (action === 'seed') h.render().seed([file]); else h.render().reset();
    const kept = h.render().items, before = jobs.length;
    view('fr'); wait.resolve({ canceled: false, assets: [local] }); await pending;
    assert.equal(h.render().items, kept); assert.equal(jobs.length, before);
  }
  // Permission prompts must not launch a picker or show an obsolete denial after invalidation.
  for (const source of ['photos', 'camera', 'video']) for (const action of ['reset', 'seed', 'fill']) for (const granted of [true, false]) {
    const h = hook({ folderPath: 'unfiled', max: 1 }), permission = deferred(); state.permission = permission.promise;
    const pending = h.value.pick(source);
    if (action === 'seed') h.render().seed([file]); else if (action === 'fill') h.value.add([local]); else h.render().reset();
    const before = calls.length, alertCount = alerts.length, kept = h.render().items;
    permission.resolve({ granted }); await pending;
    assert.equal(calls.length, before); assert.equal(alerts.length, alertCount); assert.equal(h.render().items, kept);
  }
  state.permission = { granted: true };
  // Overlapping picker entries now coalesce; the first native result owns the reservation.
  // Supersedes the old last-result-first winner, retaining the one-upload/capacity assertions.
  const competing = hook({ folderPath: 'unfiled', max: 1 }), first = deferred(), second = deferred();
  state.document = first.promise; const firstPick = competing.value.pick('files');
  state.document = second.promise; const secondPick = competing.value.pick('files');
  const beforeCompeting = jobs.length;
  second.resolve({ canceled: false, assets: [{ ...local, name: 'second' }] }); await secondPick;
  first.resolve({ canceled: false, assets: [local] }); await firstPick;
  assert.equal(jobs.length, beforeCompeting + 1); assert.equal(competing.render().items.length, 1); assert.equal(competing.render().items[0].local.name, local.name);
  const selected = competing.render().items[0]; competing.value.remove(selected.key); competing.value.add([local]);
  assert.equal(competing.render().items.length, 1); assert.equal(competing.render().items[0].local, local);
  // A stale retry callback cannot restart an in-flight, removed or completed upload.
  const retrying = hook({ folderPath: 'unfiled', max: 1 }); retrying.value.add([local]); jobs.at(-1).reject(new Error('first failure')); await flush();
  const failed = retrying.render(), key = failed.items[0].key, beforeRetry = jobs.length;
  failed.retry(key); failed.retry(key); assert.equal(jobs.length, beforeRetry + 1);
  jobs.at(-1).resolve(file); await flush(); failed.retry(key); assert.equal(jobs.length, beforeRetry + 1);
  failed.remove(key); failed.retry(key); assert.equal(jobs.length, beforeRetry + 1); assert.deepEqual(retrying.render().items, []);
  console.log(`attachment controls: PASS (${process.env.TZ || 'host TZ'}); catalogs >=1388; synthetic hooks/native/picker/upload boundaries only`);
})().catch(error => { console.error(error); process.exitCode = 1; });
