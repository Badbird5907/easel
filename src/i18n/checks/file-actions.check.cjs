const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
/** Fresh production transpilation with fail-closed synthetic native/filesystem/storage/
 * fetch/session/timer/download boundaries. No real operation, React Compiler or OS UI. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const unexpected = [];
const calls = [],
  sheets = [],
  timers = [],
  handlers = new Map(),
  entries = new Map();
const record = (name, ...args) => {
  calls.push([name, ...args]);
  if (!handlers.has(name)) unexpected.push(name);
  assert.ok(handlers.has(name), `Unexpected synthetic operation: ${name}`);
  return handlers.get(name)(...args);
};
const allow = (name, fn = () => undefined) => handlers.set(name, fn);
const reset = () => {
  calls.length = 0;
  timers.length = 0;
  sheets.length = 0;
  handlers.clear();
  entries.clear();
};
const of = (name) => calls.filter((c) => c[0] === name);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
let scope;
const react = {
  useState(initial) {
    const s = scope,
      i = s.cursor++;
    if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [
      s.slots[i],
      (v) => {
        s.slots[i] = typeof v === 'function' ? v(s.slots[i]) : v;
      },
    ];
  },
  useRef(v) {
    return react.useState(() => ({ current: v }))[0];
  },
  useMemo(fn, deps) {
    const r = react.useRef();
    if (!r.current || deps.some((v, i) => !Object.is(v, r.current.deps[i])))
      r.current = { deps, value: fn() };
    return r.current.value;
  },
  useCallback(fn, deps) {
    return react.useMemo(() => fn, deps);
  },
  useEffect(fn, deps) {
    const r = react.useRef();
    if (!r.current || deps.some((v, i) => !Object.is(v, r.current.deps[i]))) {
      r.current?.cleanup?.();
      r.current = { deps, cleanup: fn() };
    }
  },
  useSyncExternalStore(_s, snapshot) {
    return snapshot();
  },
};
const harness = (fn) => {
  const s = { slots: [], cursor: 0 };
  return (...args) => {
    const old = scope;
    scope = s;
    s.cursor = 0;
    try {
      return fn(...args);
    } finally {
      scope = old;
    }
  };
};
const jsx = (type, props, key) => ({ type, props, key });
const native = {
  Platform: { OS: 'android', isPad: false },
  Share: { share: (...a) => record('shareLink', ...a) },
  ActionSheetIOS: {
    showActionSheetWithOptions: (...a) => {
      sheets.push(a);
    },
  },
};
const uriOf = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
class File {
  constructor(...parts) {
    this.uri = uriOf(parts);
    this.name = this.uri.split('/').at(-1);
  }
  get exists() {
    return entries.get(this.uri)?.exists ?? false;
  }
  get parentDirectory() {
    return new Directory(this.uri.slice(0, this.uri.lastIndexOf('/')));
  }
  copy(...a) {
    return record('copy', this, ...a);
  }
  bytes() {
    return record('bytes', this);
  }
  write(...a) {
    return record('write', this, ...a);
  }
  writeSync(...a) {
    return record('writeSync', this, ...a);
  }
  base64() {
    return record('base64', this);
  }
  text() {
    return record('text', this);
  }
  canPreview(...a) {
    return record('canPreview', this, ...a);
  }
  preview(...a) {
    return record('preview', this, ...a);
  }
  delete() {
    return record('delete', this);
  }
  moveSync(...a) {
    return record('move', this, ...a);
  }
  open(...a) {
    return record('open', this, ...a);
  }
  static downloadFileAsync(...a) {
    return record('pdfDownload', ...a);
  }
  static createDownloadTask(...a) {
    return record('downloadTask', ...a);
  }
}
class Directory {
  constructor(...parts) {
    this.uri = uriOf(parts);
  }
  get name() {
    const entry = entries.get(this.uri);
    return entry && Object.hasOwn(entry, 'name') ? entry.name : this.uri.split('/').at(-1);
  }
  get exists() {
    return entries.get(this.uri)?.exists ?? false;
  }
  createFile(...a) {
    return record('createFile', this, ...a);
  }
  create(...a) {
    return record('mkdir', this, ...a);
  }
  list() {
    return record('list', this);
  }
  static pickDirectoryAsync(...a) {
    return record('pick', ...a);
  }
}
const account = { id: 'synthetic-account', baseUrl: 'https://school.invalid' };
const client = { baseUrl: account.baseUrl, authHeaders: { Authorization: 'synthetic-token' } };
const mocks = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': { ...native, Modal: 'Modal', View: 'View', Pressable: 'Pressable' },
  'lucide-react-native': new Proxy({}, { get: (_o, k) => k }),
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 12 }) },
  'expo-file-system': {
    File,
    Directory,
    Paths: { cache: 'file:///cache', document: 'file:///documents' },
    FileMode: { ReadOnly: 'ReadOnly' },
  },
  '@react-native-async-storage/async-storage': {
    getItem: (...a) => record('get', ...a),
    setItem: (...a) => record('set', ...a),
    removeItem: (...a) => record('remove', ...a),
  },
  'expo-sharing': {
    isAvailableAsync: () => record('sharingAvailable'),
    shareAsync: (...a) => record('share', ...a),
  },
  'expo-clipboard': { setStringAsync: (...a) => record('clipboard', ...a) },
  'expo-media-library': {
    requestPermissionsAsync: (...a) => record('permission', ...a),
    Asset: { create: (...a) => record('asset', ...a) },
  },
  'expo-print': { printAsync: (...a) => record('print', ...a) },
  '@/canvas/session': {
    useCanvas: () => ({ account, client }),
    registerAccountCleanup: (fn) => {
      assert.equal(typeof fn, 'function');
    },
  },
  '@/features/content/browser': { sessionUrl: (...a) => record('session', ...a) },
  '@/design': {
    haptics: { success: () => record('success'), error: () => record('error') },
    useTheme: () => ({ scheme: 'light' }),
    Button: 'Button',
    Icon: 'Icon',
    ListGroup: 'ListGroup',
    ListItem: 'ListItem',
    Text: 'Text',
  },
  '@/features/files/Toast': {
    useToast: (offset) => {
      assert.equal(offset, 42);
      return { show: (...a) => record('toast', ...a), toast: null };
    },
  },
};
function loader(overrides = {}) {
  const cache = new Map();
  function load(name, parent = path.join(root, 'entry.ts')) {
  if (isIntlPolyfills(name)) return intlPolyfills;
    const key = name.startsWith('.')
      ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
      : name;
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (Object.hasOwn(mocks, key)) return mocks[key];
    assert.ok(key.startsWith('@/'), `Unmocked import ${key}`);
    const file = ['.ts', '.tsx', '/index.ts']
      .map((e) => path.join(root, key.slice(2)) + e)
      .find(fs.existsSync);
    assert.ok(file, key);
    if (cache.has(file)) return cache.get(file).exports;
    const m = { exports: {} };
    cache.set(file, m);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    new Function('require', 'module', 'exports', 'fetch', 'setTimeout', 'clearTimeout', js)(
      (n) => load(n, file),
      m,
      m.exports,
      (...a) => record('fetch', ...a),
      (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      () => assert.fail('Unexpected timer clearing'),
    );
    return m.exports;
  }
  return load;
}
const load = loader(),
  a = load('@/features/files/actions'),
  d = load('@/features/files/download'),
  print = load('@/features/files/print'),
  p = load('@/features/files/actionPresentation'),
  k = load('@/features/files/kinds'),
  i18n = load('@/i18n/runtime');
const langs = ['en', 'fr', 'ar'];
const view = (l) => {
  i18n.setAccountLocale('synthetic', l);
  return i18n.createTranslator(l);
};
const file = {
  id: 'f',
  name: 'Raw <title>&.pdf',
  filename: 'raw.pdf',
  contentType: 'application/pdf',
  url: 'https://school.invalid/raw?verifier=raw',
  lockedForUser: false,
};
const image = { ...file, name: 'Raw photo.jpg', filename: 'photo.jpg', contentType: 'image/jpeg' };
const local = new File('file:///synthetic/raw.pdf');
const dir = new Directory('content://synthetic/picked');
const setName = (name) => entries.set(dir.uri, { name });
const failure = (message) => () => {
  throw new Error(message);
};
const rejection = async (run) => {
  try {
    await run();
    assert.fail('Expected rejection');
  } catch (e) {
    if (e.code === 'ERR_ASSERTION') throw e;
    return e;
  }
};
function catalogs() {
  const baseline = require('./file-actions.baseline.json');
  const slots = (v) => [...new Set(JSON.stringify(v).match(/\{\w+\}/g) ?? [])].sort();
  const cats = langs.map((l) => load('@/i18n/' + l)[l]);
  assert.ok(Object.keys(cats[0]).length >= 1625);
  for (const [i, l] of langs.entries()) {
    assert.equal(Object.keys(baseline.catalogs[l]).length, 1594);
    for (const [key, value] of Object.entries(baseline.catalogs[l]))
      assert.deepEqual(cats[i][key], value, key);
    assert.deepEqual(Object.keys(cats[i]).sort(), Object.keys(cats[0]).sort());
    for (const key of Object.keys(cats[0]))
      assert.deepEqual(slots(cats[i][key]), slots(cats[0][key]), key);
  }
  // Reversing ONLY allowed metadata edits must recover the exact pre-task bytes.
  for (const name of ['print.ts', 'download.ts']) {
    let s = fs.readFileSync(path.join(root, 'features/files', name), 'utf8');
    if (name === 'print.ts')
      s = s.replace(/      \{ reason: 'print-(?:open|rendition|unsupported)' \},\n/g, '');
    else
      s = s
        .replace('    readonly origin?: { reason: DownloadErrorKind },\n', '')
        .replace(
          'new FileDownloadError(kind, messages[kind], status, { reason: kind });',
          'new FileDownloadError(kind, messages[kind], status);',
        )
        .replace(
          "  if (file.lockedForUser) throw new FileDownloadError(\n    'locked', file.lockExplanation ?? messages.locked, undefined,\n    file.lockExplanation == null ? { reason: 'locked' } : undefined,\n  );",
          "  if (file.lockedForUser) throw new FileDownloadError('locked', file.lockExplanation ?? messages.locked);",
        );
    assert.equal(
      createHash('sha256').update(s).digest('hex'),
      baseline.sourceHashes[name],
      name + ' tag-only boundary',
    );
  }
}
async function operations() {
  for (const os of ['ios', 'android']) {
    native.Platform.OS = os;
    reset();
    allow('sharingAvailable', () => true);
    allow('share');
    for (const f of [
      file,
      image,
      { ...file, filename: 'photo.jpeg', name: 'photo.jpeg', contentType: 'image/jpeg' },
      { ...file, name: 'Untitled', filename: '', contentType: 'application/pdf' },
    ]) {
      await a.shareFile(local, f);
      const type = k.describeFile(f);
      const options =
        os === 'android'
          ? { mimeType: type.mimeType, dialogTitle: f.name }
          : type.uti && type.utiMatchesExtension
            ? { UTI: type.uti, mimeType: type.mimeType }
            : type.extension
              ? {}
              : { mimeType: type.mimeType };
      assert.deepEqual(of('share').at(-1), ['share', local.uri, options]);
    }
    allow('sharingAvailable', () => false);
    const e = await rejection(() => a.shareFile(local, file));
    assert.equal(e.message, 'Sharing isn’t available on this device.');
    assert.equal(e.name, 'Error');
    assert.ok(e instanceof a.FileActionError);
    assert.equal(e.origin.reason, 'sharing-unavailable');
    reset();
    allow('shareLink');
    allow('clipboard');
    await a.shareLink('raw-url', file);
    await a.copyLink('raw-url');
    assert.deepEqual(calls, [
      ['shareLink', os === 'ios' ? { url: 'raw-url' } : { message: 'raw-url', title: file.name }],
      ['clipboard', 'raw-url'],
    ]);
    reset();
    allow('permission', () => ({ granted: true }));
    allow('asset');
    await a.saveToPhotos(local);
    assert.deepEqual(calls, [
      ['permission', true],
      ['asset', local.uri],
    ]);
    allow('permission', () => ({ granted: false }));
    const denied = await rejection(() => a.saveToPhotos(local));
    assert.equal(denied.origin.reason, os === 'ios' ? 'photos-permission' : 'gallery-permission');
    assert.equal(of('asset').length, 1);
    assert.equal(a.canSaveToPhotos(image), true);
    assert.equal(
      a.canSaveToPhotos({ ...image, filename: 'x.mp4', contentType: 'video/mp4' }),
      true,
    );
    assert.equal(a.canSaveToPhotos(file), false);
  }
  native.Platform.OS = 'android';
  reset();
  allow('canPreview', () => true);
  allow('preview');
  assert.equal(await a.openInApp(local, file), true);
  assert.deepEqual(calls, [
    ['canPreview', local, { mimeType: 'application/pdf' }],
    ['preview', local, { mimeType: 'application/pdf', title: file.name }],
  ]);
  allow('canPreview', () => false);
  assert.equal(await a.openInApp(local, file), false);
  allow('canPreview', failure('Native cancelled'));
  assert.equal(await a.openInApp(local, file), true);
  allow('canPreview', failure('Native no-app'));
  assert.equal(await a.openInApp(local, file), false);
  native.Platform.OS = 'ios';
  reset();
  allow('sharingAvailable', () => true);
  allow('share');
  assert.equal(await a.openInApp(local, file), true);
  assert.equal(of('share').length, 1);
  for (const os of ['ios', 'android'])
    for (const name of [
      undefined,
      null,
      '',
      'Downloads',
      'Photos',
      'On My iPhone',
      'On My iPad',
      'the folder',
      'that folder',
      'File Provider Storage',
      'Raw مدرسة',
    ]) {
      native.Platform.OS = os;
      reset();
      setName(name);
      allow('pick', () => dir);
      allow('copy');
      allow('createFile', (directory, n, mime) => {
        assert.equal(directory, dir);
        assert.equal(n, local.name);
        assert.equal(mime, 'application/pdf');
        return new File(dir, n);
      });
      const expected = !name
        ? { label: 'the folder', origin: 'folder' }
        : os === 'ios' && name === 'File Provider Storage'
          ? { label: 'On My iPhone', origin: 'iphone' }
          : { label: name };
      assert.deepEqual(await a.saveToFolderResult(local, file, 'initial-uri'), expected);
      assert.equal(of('copy').length, 1);
      assert.deepEqual(of('pick'), [['pick', 'initial-uri']]);
      assert.equal(await a.saveToFolder(local, file), expected.label);
      assert.equal(of('copy').length, 2);
    }
  native.Platform.OS = 'ios';
  native.Platform.isPad = true;
  reset();
  setName('fIlE pRoViDeR sToRaGe');
  allow('pick', () => dir);
  allow('copy');
  assert.deepEqual(await a.saveToFolderResult(local, file), {
    label: 'On My iPad',
    origin: 'ipad',
  });
  native.Platform.isPad = false;
  reset();
  setName('Raw');
  allow('pick', () => dir);
  allow('copy');
  entries.set(new File(dir, local.name).uri, { exists: true });
  await a.saveToFolder(local, file);
  assert.equal(of('copy')[0][2].name, 'raw 2.pdf');
  assert.equal(of('copy')[0].length, 3);
  for (const os of ['android', 'ios']) {
    native.Platform.OS = os;
    reset();
    allow('pick', failure('User CANCELLED'));
    assert.equal(await a.saveToFolderResult(local, file), null);
    assert.equal(await a.saveToFolder(local, file), null);
    assert.equal(of('copy').length, 0);
    allow('pick', failure('Raw picker failure'));
    const e = await rejection(() => a.saveToFolder(local, file));
    assert.equal(e.message, 'Couldn’t open the folder picker.');
    assert.equal(e.origin.reason, 'folder-picker');
    allow('pick', () => dir);
    setName('Downloads');
    allow('copy', failure('disk'));
    allow('createFile', (directory, n) => new File(directory, n));
    allow('bytes', () => Uint8Array.of(1, 2));
    allow('write', failure('disk'));
    const copy = await rejection(() => a.saveToFolderResult(local, file));
    assert.equal(copy.message, 'Couldn’t save to Downloads. Pick another folder.');
    assert.deepEqual(copy.origin, { reason: 'folder-copy', destination: { label: 'Downloads' } });
  }
  native.Platform.OS = 'android';
  reset();
  allow('pick', () => dir);
  allow('createFile', (directory, n) => new File(directory, n));
  allow('copy', failure('SAF copy'));
  const bytes = Uint8Array.of(10, 20);
  allow('bytes', () => bytes);
  allow('write');
  await a.saveToFolder(local, file);
  assert.equal(of('copy').length, 1);
  assert.deepEqual(of('copy')[0].slice(3), [{ overwrite: true }]);
  assert.equal(of('bytes').length, 1);
  assert.equal(of('write')[0][2], bytes);
  const pref = 'easel.files.downloadsFolder',
    initial = 'content://com.android.externalstorage.documents/document/primary%3ADownload';
  for (const name of [undefined, null, '', 'Downloads', 'Photos', 'On My iPhone']) {
    reset();
    setName(name);
    allow('get', () => null);
    allow('pick', () => dir);
    allow('createFile', (directory, n) => new File(directory, n));
    allow('copy');
    allow('set');
    const result = await a.saveToDownloadsResult(local, file);
    assert.deepEqual(result, name ? { label: name } : { label: 'Downloads', origin: 'downloads' });
    assert.deepEqual(of('get'), [['get', pref]]);
    assert.deepEqual(of('pick'), [['pick', initial]]);
    assert.deepEqual(of('set'), [['set', pref, dir.uri]]);
    assert.equal(of('copy').length, 1);
    allow('get', () => dir.uri);
    assert.equal(await a.saveToDownloads(local, file), result.label);
    assert.equal(of('pick').length, 1);
    assert.equal(of('set').length, 1);
    assert.equal(of('copy').length, 2);
  }
  reset();
  allow('get', () => dir.uri);
  allow('createFile', (directory, n) => new File(directory, n));
  let tries = 0;
  allow('copy', () => {
    if (!tries++) throw Error('revoked');
  });
  allow('bytes', failure('revoked'));
  allow('remove');
  allow('pick', () => dir);
  allow('set');
  await a.saveToDownloadsResult(local, file);
  assert.deepEqual(of('remove'), [['remove', pref]]);
  assert.equal(of('copy').length, 2);
  assert.deepEqual(of('pick'), [['pick', initial]]);
  reset();
  allow('get', () => null);
  allow('pick', failure('cancel'));
  assert.equal(await a.saveToDownloads(local, file), null);
  assert.equal(await a.saveToDownloadsResult(local, file), null);
  assert.equal(of('set').length, 0);
  // Generated failure destinations are tagged at their existing policy branches.
  for (const os of ['ios', 'android'])
    for (const name of ['', 'File Provider Storage']) {
      reset();
      native.Platform.OS = os;
      setName(name);
      allow('pick', () => dir);
      allow('copy', failure('disk'));
      allow('get', () => null);
      allow('createFile', (directory, n) => new File(directory, n));
      allow('bytes', failure('disk'));
      const destination = !name
        ? { label: 'that folder', origin: 'that-folder' }
        : os === 'ios'
          ? { label: 'On My iPhone', origin: 'iphone' }
          : { label: name };
      for (const save of [a.saveToFolderResult, a.saveToDownloadsResult]) {
        const error = await rejection(() => save(local, file));
        assert.deepEqual(error.origin, { reason: 'folder-copy', destination });
        assert.equal(error.message, `Couldn’t save to ${destination.label}. Pick another folder.`);
      }
      assert.equal(of('set').length, 0);
    }
  reset();
  allow('get', () => null);
  allow('pick', failure('Unavailable'));
  const pickerError = await rejection(() => a.saveToDownloadsResult(local, file));
  assert.equal(pickerError.origin.reason, 'folder-picker');
  for (const context of [undefined, { type: 'course', id: 'c' }, { type: 'group', id: 'g' }]) {
    const f = { ...file, context };
    assert.equal(a.fileWebUrl(client.baseUrl, f, 'explicit'), 'explicit');
    assert.equal(
      a.fileWebUrl(client.baseUrl, f),
      client.baseUrl + (context ? `/${context.type}s/${context.id}` : '') + '/files/f',
    );
  }
}
async function printing() {
  reset();
  allow('print');
  allow('base64', () => 'AQID');
  allow('text', () => '<body>& raw');
  let ensured = 0;
  const ensure = async () => {
    ensured++;
    return local;
  };
  assert.equal(print.printKind(file), 'pdf');
  assert.equal(print.printKind(image), 'image');
  assert.equal(
    print.printKind({ ...image, filename: 'x.svg', contentType: 'image/svg+xml' }),
    null,
  );
  assert.equal(print.printKind({ ...file, lockedForUser: true }), null);
  await print.printFile(client, file, ensure);
  assert.deepEqual(of('print'), [['print', { uri: local.uri }]]);
  const page = (
    title,
    body,
  ) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>@page{margin:0.6in}body{margin:0;font:11pt -apple-system,Roboto,sans-serif;color:#000}
img{display:block;max-width:100%;max-height:9.5in;margin:0 auto;object-fit:contain}
pre{white-space:pre-wrap;word-wrap:break-word;font:10pt ui-monospace,Menlo,monospace}</style></head>
<body>${body}</body></html>`;
  await print.printFile(client, image, ensure);
  assert.deepEqual(of('print').at(-1), [
    'print',
    { html: page(image.name, '<img src="data:image/jpeg;base64,AQID" alt="">') },
  ]);
  await print.printFile(client, { ...image, contentType: '' }, ensure);
  assert.deepEqual(of('print').at(-1), [
    'print',
    { html: page(image.name, '<img src="data:image/jpeg image;base64,AQID" alt="">') },
  ]);
  for (const ext of ['txt', 'js', 'md', 'csv']) {
    const f = {
      ...file,
      name: 'Raw <title>&.' + ext,
      filename: 'raw.' + ext,
      contentType: 'text/plain',
    };
    assert.equal(print.printKind(f), 'text');
    await print.printFile(client, f, ensure);
    assert.deepEqual(of('print').at(-1), [
      'print',
      { html: page('Raw &lt;title&gt;&amp;.' + ext, '<pre>&lt;body&gt;&amp; raw</pre>') },
    ]);
  }
  assert.equal(ensured, 7);
  const n = of('print').length;
  await print.printFile(client, file, async () => null);
  assert.equal(of('print').length, n);
  allow('print', failure('Print cancelled'));
  await print.printFile(client, file, ensure);
  allow('print', failure('native failure'));
  const e = await rejection(() => print.printFile(client, file, ensure));
  assert.equal(e.origin.reason, 'print-open');
  const unsupported = await rejection(() =>
    print.printFile(client, { ...file, lockedForUser: true }, ensure),
  );
  assert.equal(unsupported.origin.reason, 'print-unsupported');
  for (const ext of ['docx', 'xlsx', 'pptx'])
    for (const sameHost of [true, false]) {
      reset();
      const f = {
        ...file,
        name: 'raw.' + ext,
        filename: 'raw.' + ext,
        contentType: 'application/octet-stream',
        previewUrl: (sameHost ? client.baseUrl : 'https://viewer.invalid') + '/preview',
      };
      assert.equal(print.printKind(f), 'rendition');
      let requests = 0;
      allow('fetch', (url, options) => {
        requests++;
        if (requests === 1) {
          assert.equal(url, f.previewUrl);
          assert.deepEqual(options, { headers: sameHost ? client.authHeaders : undefined });
          return { ok: true, url: 'https://doc.invalid/session/view?token=raw' };
        }
        assert.equal(url, 'https://doc.invalid/session');
        assert.deepEqual(options, { headers: { Accept: 'application/json' } });
        return {
          ok: true,
          status: 200,
          json: async () => ({ urls: { pdf_download: '/pdf/raw' } }),
        };
      });
      const pdf = new File('file:///synthetic/rendition.pdf');
      allow('pdfDownload', (url, target, options) => {
        assert.equal(url, 'https://doc.invalid/pdf/raw');
        assert.match(target.uri, /^file:\/\/\/cache\/print-f-\d+\.pdf$/);
        assert.deepEqual(options, { idempotent: true });
        return pdf;
      });
      allow('print');
      allow('delete');
      await print.printFile(client, f, () => assert.fail('Rendition must not ensure local'));
      assert.deepEqual(of('print'), [['print', { uri: pdf.uri }]]);
      assert.deepEqual(of('delete'), [['delete', pdf]]);
      assert.equal(requests, 2);
    }
  const f = {
    ...file,
    name: 'raw.docx',
    filename: 'raw.docx',
    contentType: 'application/octet-stream',
    previewUrl: client.baseUrl + '/preview',
  };
  for (const mode of ['viewer', 'metadata', 'missing', 'download', 'pending']) {
    reset();
    let requests = 0;
    allow('fetch', () => {
      if (++requests === 1)
        return { ok: mode !== 'viewer', url: 'https://doc.invalid/session/view' };
      return {
        ok: mode !== 'metadata',
        status: mode === 'pending' ? 202 : 200,
        json: async () => ({ urls: mode === 'missing' ? {} : { pdf_download: '/pdf' } }),
      };
    });
    allow('pdfDownload', failure('Download failure'));
    const job = rejection(() => print.printFile(client, f, () => assert.fail('ensure')));
    if (mode === 'pending') {
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 8; j++) await Promise.resolve();
        assert.equal(timers[i]?.ms, 2000);
        timers[i].fn();
      }
    }
    const e = await job;
    assert.equal(e.origin.reason, 'print-rendition');
    assert.equal(of('print').length, 0);
  }
}
async function downloads() {
  reset();
  for (const raw of [undefined, null, '', 'This file is locked.', 'Canvas raw explanation']) {
    const e = await rejection(() =>
      d.downloadFile(client, account.id, { ...file, lockedForUser: true, lockExplanation: raw }),
    );
    assert.ok(e instanceof d.FileDownloadError);
    assert.equal(e.name, 'FileDownloadError');
    assert.equal(e.kind, 'locked');
    assert.equal(e.status, undefined);
    assert.equal(e.message, raw ?? 'This file is locked.');
    assert.deepEqual(e.origin, raw == null ? { reason: 'locked' } : undefined);
  }
  assert.equal(calls.length, 0);
  for (const [nativeError, kind, status] of [
    ['HTTP 404', 'not_found', 404],
    ['status: 410', 'not_found', 410],
    ['HTTP 503', 'server', 503],
    ['disk full', 'storage', undefined],
    ['network gone', 'offline', undefined],
    ['HTTP 403', 'forbidden', 403],
  ]) {
    reset();
    allow('mkdir');
    allow('downloadTask', () => ({
      downloadAsync: async () => {
        throw Error(nativeError);
      },
    }));
    allow('session', () => 'https://session.invalid/raw');
    const e = await rejection(() => d.downloadFile(client, account.id, file));
    assert.equal(e.kind, kind);
    assert.equal(e.status, status);
    assert.deepEqual(e.origin, { reason: kind });
    const attempts = of('downloadTask');
    assert.equal(attempts.length, kind === 'forbidden' ? 3 : 1);
    assert.equal(attempts[0][1], file.url);
    assert.equal(attempts[0][3].headers, client.authHeaders);
    assert.equal(attempts[0][3].sessionType, 'foreground');
    if (kind === 'forbidden') {
      assert.equal(attempts[1][1], file.url);
      assert.equal(attempts[1][3].headers, undefined);
      assert.equal(attempts[2][1], 'https://session.invalid/raw');
      assert.deepEqual(of('session'), [['session', client, file.url]]);
    }
  }
  reset();
  allow('mkdir', failure('denied'));
  const storage = await rejection(() => d.downloadFile(client, account.id, file));
  assert.equal(storage.kind, 'storage');
  assert.deepEqual(storage.origin, { reason: 'storage' });
  assert.equal(of('downloadTask').length, 0);
  reset();
  allow('mkdir');
  allow('open', () => ({
    readBytesSync: (n) => {
      assert.equal(n, 2048);
      return new TextEncoder().encode('<html>login</html>');
    },
    close: () => {},
  }));
  allow('downloadTask', (_u, partial) => ({ downloadAsync: async () => partial }));
  allow('delete');
  allow('session', () => 'https://session.invalid/raw');
  const signed = await rejection(() => d.downloadFile(client, account.id, file));
  assert.equal(signed.kind, 'signed_out');
  assert.equal(of('downloadTask').length, 3);
  assert.equal(of('delete').length, 3);
  reset();
  const progress = [];
  allow('mkdir');
  allow('downloadTask', (_u, partial, opts) => ({
    downloadAsync: async () => {
      opts.onProgress({ bytesWritten: 2n, totalBytes: 4n });
      return partial;
    },
  }));
  allow('open', () => ({ readBytesSync: () => new Uint8Array([1, 2]), close: () => {} }));
  allow('move');
  allow('list', () => []);
  allow('writeSync');
  const result = await d.downloadFile(client, account.id, file, {
    onProgress: (v) => progress.push(v),
  });
  assert.deepEqual(progress, [{ fraction: 0.5, bytes: 2 }]);
  assert.equal(of('move')[0][2], result);
  assert.deepEqual(of('move')[0][3], { overwrite: true });
  assert.equal(of('writeSync')[0][2], JSON.stringify(file));
  const legacy = new d.FileDownloadError('locked', 'This file is locked.', 423);
  assert.equal(legacy.status, 423);
  assert.equal(legacy.origin, undefined);
  assert.equal(new a.FileActionError().message, '');
  assert.equal(new a.FileActionError('old').name, 'Error');
  const cause = new Error('native cause');
  const caused = new a.FileActionError('old', { cause });
  assert.equal(caused.cause, cause);
  assert.equal(caused.origin, undefined);
}
function presentation() {
  for (const locale of langs) {
    const t = i18n.createTranslator(locale),
      display = p.createActionPresentation(locale);
    view(locale === 'ar' ? 'fr' : 'ar');
    assert.equal(display.copied(), t('files.actions.copied'));
    for (const [origin, key] of [
      ['folder', 'folder'],
      ['that-folder', 'thatFolder'],
      ['downloads', 'downloads'],
      ['iphone', 'iphone'],
      ['ipad', 'ipad'],
      ['photos', 'photos'],
      ['gallery', 'gallery'],
    ]) {
      const where = { label: 'Never use this fallback', origin };
      assert.equal(p.destinationLabel(where, t), t('files.actions.destination.' + key));
      assert.equal(
        display.saved(where),
        t('files.actions.saved', { destination: t('files.actions.destination.' + key) }),
      );
    }
    for (const label of [
      'Downloads',
      'Photos',
      'On My iPhone',
      'On My iPad',
      'the folder',
      'that folder',
      'your gallery',
      '',
    ])
      for (const origin of [undefined, 'future', 'toString']) {
        assert.equal(p.destinationLabel({ label, origin }, t), label);
        assert.equal(
          display.saved({ label, origin }),
          t('files.actions.saved', { destination: label }),
        );
      }
    const reasons = {
      'sharing-unavailable': 'sharing',
      'folder-picker': 'picker',
      'photos-permission': 'photos',
      'gallery-permission': 'gallery',
      'print-open': 'print',
      'print-rendition': 'rendition',
      'print-unsupported': 'unsupported',
    };
    for (const [reason, key] of Object.entries(reasons)) {
      const english = i18n.createTranslator('en')('files.actions.error.' + key);
      assert.equal(
        display.error(new a.FileActionError(english, { reason })),
        t('files.actions.error.' + key),
      );
      for (const origin of [undefined, { reason: 'future' }, { reason: 'toString' }])
        assert.equal(display.error(new a.FileActionError(english, origin)), english);
      assert.equal(display.error(new Error(english)), t('files.actions.error.unexpected'));
    }
    assert.equal(
      display.error(new a.FileActionError('raw', { reason: 'no-app', file })),
      t('files.actions.error.noApp', { type: k.describeFile(file, locale).label }),
    );
    assert.equal(
      display.error(
        new a.FileActionError('raw', {
          reason: 'folder-copy',
          destination: { label: 'Downloads' },
        }),
      ),
      t('files.actions.error.copy', { destination: 'Downloads' }),
    );
    for (const [reason, key] of [
      ['locked', 'locked'],
      ['not_found', 'notFound'],
      ['signed_out', 'signedOut'],
      ['forbidden', 'forbidden'],
      ['offline', 'offline'],
      ['server', 'server'],
      ['storage', 'storage'],
    ]) {
      const english = i18n.createTranslator('en')('files.actions.error.download.' + key);
      assert.equal(
        display.error(new d.FileDownloadError(reason, english, 403, { reason })),
        t('files.actions.error.download.' + key),
      );
      for (const origin of [undefined, { reason: 'future' }, { reason: 'toString' }])
        for (const raw of [english, '', 'Raw school message'])
          assert.equal(display.error(new d.FileDownloadError(reason, raw, 403, origin)), raw);
    }
    assert.equal(
      display.error({ message: 'raw', origin: { reason: 'locked' } }),
      t('files.actions.error.unexpected'),
    );
  }
}
const hookedActions = { ...a };
for (const name of [
  'shareFile',
  'openInApp',
  'saveToFolderResult',
  'saveToDownloadsResult',
  'saveToPhotos',
  'shareLink',
  'copyLink',
])
  hookedActions[name] = (...args) => record(name, ...args);
const hookDownload = { status: 'idle', ensure: (...args) => record('ensure', ...args) };
const hookLoad = loader({
  '@/i18n': load('@/i18n'),
  '@/i18n/runtime': i18n,
  '@/features/files/actions': hookedActions,
  '@/features/files/download': {
    FileDownloadError: d.FileDownloadError,
    useFileDownload: (...args) => {
      assert.equal(args[1].auto, false);
      return hookDownload;
    },
  },
  '@/features/files/print': {
    printKind: print.printKind,
    printFile: (...args) => record('printFile', ...args),
  },
});
const hook = hookLoad('@/features/files/useFileActions').useFileActions;
const nodes = (t) =>
  !t || typeof t !== 'object'
    ? []
    : Array.isArray(t)
      ? t.flatMap(nodes)
      : [t, ...nodes(t.props?.children)];
const sheetRequest = (actions) =>
  nodes(actions.elements).find(
    (n) => typeof n.type === 'function' && n.type.name === 'AndroidSheet',
  ).props.request;
const hookFor = (f) => {
  const render = harness(() =>
    hook(f, { toastOffset: 42, autoDownload: false, canvasUrl: 'https://explicit.invalid/raw' }),
  );
  return render;
};
const feedback = () => {
  allow('success');
  allow('error');
  allow('toast');
};
async function hooks() {
  native.Platform.OS = 'android';
  // Same instance, same file; only labels change. No operation or sheet side effects.
  for (const media of [false, true]) {
    reset();
    const f = media ? image : file,
      render = hookFor(f);
    view('en');
    render().save();
    const first = sheetRequest(render());
    assert.equal(first.title, f.name);
    assert.deepEqual(
      first.options.map((o) => o.key),
      media ? ['downloads', 'folder', 'photos'] : ['downloads', 'folder'],
    );
    const callbacks = first.options.map((o) => o.onPress),
      icons = first.options.map((o) => o.icon);
    for (const locale of langs) {
      const t = view(locale),
        current = render(),
        request = sheetRequest(current);
      assert.equal(current.busy, null);
      assert.equal(current.canPrint, true);
      assert.equal(current.link, 'https://explicit.invalid/raw');
      assert.equal(current.download, hookDownload);
      assert.deepEqual(
        request.options.map((o) => o.onPress),
        callbacks,
      );
      assert.deepEqual(
        request.options.map((o) => o.icon),
        icons,
      );
      assert.deepEqual(
        request.options.map((o) => o.key),
        first.options.map((o) => o.key),
      );
      assert.deepEqual(
        request.options.map((o) => o.label),
        first.options.map((o) => p.saveOptionLabel(o.key, false, t)),
      );
      assert.equal(calls.length, 0);
      assert.equal(timers.length, 0);
      assert.equal(sheets.length, 0);
    }
    // A preserved Android callback captures the language when chosen, not when opened.
    feedback();
    allow('ensure', () => local);
    allow('saveToDownloadsResult', () => ({ label: 'Downloads', origin: 'downloads' }));
    const t = view('fr');
    render();
    await callbacks[0]();
    assert.deepEqual(of('ensure'), [['ensure']]);
    assert.deepEqual(of('saveToDownloadsResult'), [['saveToDownloadsResult', local, f]]);
    assert.deepEqual(of('toast'), [
      [
        'toast',
        t('files.actions.saved', { destination: t('files.actions.destination.downloads') }),
      ],
    ]);
  }
  // Real ActionSheet delayed choose is unchanged and locale rendering cannot schedule it.
  reset();
  feedback();
  allow('ensure', () => local);
  allow('saveToFolderResult', () => null);
  view('en');
  const delayed = hookFor(file);
  delayed().save();
  const node = nodes(delayed().elements).find(
    (n) => typeof n.type === 'function' && n.type.name === 'AndroidSheet',
  );
  node.props.onChoose(node.props.request.options[1]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 250);
  assert.equal(sheetRequest(delayed()), null);
  const pending = timers[0].fn();
  await pending;
  assert.deepEqual(of('saveToFolderResult'), [['saveToFolderResult', local, file]]);
  assert.equal(of('toast').length, 0);
  native.Platform.OS = 'ios';
  for (const locale of langs) {
    reset();
    view(locale);
    const render = hookFor(image);
    render().save();
    assert.equal(sheets.length, 1);
    const [opts, choose] = sheets[0],
      t = i18n.createTranslator(locale);
    assert.deepEqual(opts, {
      title: image.name,
      message: undefined,
      options: [t('files.actions.saveFiles'), t('files.actions.savePhotos'), t('common.cancel')],
      cancelButtonIndex: 2,
      userInterfaceStyle: 'light',
    });
    view(locale === 'en' ? 'ar' : 'en');
    render();
    assert.equal(sheets.length, 1);
    assert.equal(opts.options[0], t('files.actions.saveFiles'));
    choose(2);
    assert.equal(calls.length, 0);
    feedback();
    allow('ensure', () => local);
    allow('saveToPhotos');
    await choose(1);
    assert.deepEqual(of('saveToPhotos'), [['saveToPhotos', local]]);
  }
  reset();
  feedback();
  allow('ensure', () => local);
  allow('saveToFolderResult', () => null);
  const single = hookFor(file);
  single().save();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(sheets.length, 0);
  assert.deepEqual(of('ensure'), [['ensure']]);
  assert.deepEqual(of('saveToFolderResult'), [['saveToFolderResult', local, file]]);
  assert.equal(of('success').length, 0);
  native.Platform.OS = 'android';
  // All same-render pairs share one lock. Duplicate callbacks must not release it.
  for (const firstName of ['share', 'print'])
    for (const secondName of ['share', 'print', 'openIn'])
      for (const outcome of ['success', 'error', 'cancel']) {
        reset();
        feedback();
        view('fr');
        const gate = deferred(),
          render = hookFor(file);
        allow('ensure', () => gate.promise);
        allow('shareFile');
        allow('openInApp', () => true);
        allow('printFile', async (c, f, ensure) => {
          assert.equal(c, client);
          assert.equal(f, file);
          await ensure();
        });
        const callbacks = render(),
          running = callbacks[firstName]();
        await callbacks[secondName]();
        assert.equal(of('ensure').length, 1);
        assert.equal(render().busy, firstName === 'print' ? 'print' : 'share');
        await callbacks[secondName]();
        assert.equal(render().busy, firstName === 'print' ? 'print' : 'share');
        assert.equal(of('ensure').length, 1);
        const before = calls.length;
        view('ar');
        render();
        assert.equal(calls.length, before);
        if (outcome === 'error')
          gate.reject(new a.FileActionError('original', { reason: 'sharing-unavailable' }));
        else gate.resolve(outcome === 'cancel' ? null : local);
        await running;
        assert.equal(render().busy, null);
        if (outcome === 'error')
          assert.deepEqual(of('toast'), [
            ['toast', i18n.createTranslator('fr')('files.actions.error.sharing'), 'danger'],
          ]);
        else assert.equal(of('toast').length, 0);
        if (firstName === 'share')
          assert.deepEqual(
            of('shareFile'),
            outcome === 'success' ? [['shareFile', local, file]] : [],
          );
        allow('ensure', () => local);
        await render().share();
        assert.equal(of('ensure').length, 2);
        assert.deepEqual(of('shareFile').at(-1), ['shareFile', local, file]);
        assert.equal(render().busy, null);
      }
  // Async save/copy/open feedback keeps the invocation locale across unrelated foreground changes.
  for (const locale of langs) {
    reset();
    feedback();
    view(locale);
    const render = hookFor(file),
      gate = deferred();
    allow('ensure', () => local);
    allow('saveToFolderResult', () => gate.promise);
    render().save();
    const job = sheetRequest(render()).options[1].onPress();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    view(locale === 'ar' ? 'fr' : 'ar');
    render();
    gate.resolve({ label: 'Photos' });
    await job;
    assert.deepEqual(of('toast'), [
      ['toast', i18n.createTranslator(locale)('files.actions.saved', { destination: 'Photos' })],
    ]);
    const count = calls.length;
    for (const l of langs) {
      view(l);
      render();
    }
    assert.equal(calls.length, count);
    reset();
    feedback();
    view(locale);
    const copyGate = deferred();
    allow('copyLink', () => copyGate.promise);
    const copying = render().copyLink();
    view('en');
    render();
    copyGate.resolve();
    await copying;
    assert.deepEqual(of('copyLink'), [['copyLink', 'https://explicit.invalid/raw']]);
    assert.deepEqual(of('toast'), [
      ['toast', i18n.createTranslator(locale)('files.actions.copied')],
    ]);
    assert.equal(of('success').length, 1);
    reset();
    feedback();
    view(locale);
    allow('copyLink', failure('clipboard native error'));
    await render().copyLink();
    assert.deepEqual(of('toast'), [
      ['toast', i18n.createTranslator(locale)('files.actions.error.unexpected'), 'danger'],
    ]);
    assert.equal(of('error').length, 1);
    assert.equal(of('success').length, 0);
    reset();
    feedback();
    view(locale);
    allow('ensure', () => local);
    allow('openInApp', () => false);
    await render().openIn();
    assert.deepEqual(of('openInApp'), [['openInApp', local, file]]);
    assert.deepEqual(of('toast'), [
      [
        'toast',
        i18n.createTranslator(locale)('files.actions.error.noApp', {
          type: k.describeFile(file, locale).label,
        }),
        'danger',
      ],
    ]);
  }
  for (const os of ['ios', 'android']) {
    reset();
    native.Platform.OS = os;
    feedback();
    const t = view('fr');
    allow('ensure', () => local);
    allow('saveToPhotos');
    const render = hookFor(image);
    render().save();
    if (os === 'ios') await sheets[0][1](1);
    else await sheetRequest(render()).options[2].onPress();
    assert.deepEqual(of('toast'), [
      [
        'toast',
        t('files.actions.saved', {
          destination: t(
            os === 'ios' ? 'files.actions.destination.photos' : 'files.actions.destination.gallery',
          ),
        }),
      ],
    ]);
  }
  native.Platform.OS = 'android';
  reset();
  feedback();
  view('fr');
  const failedCopy = hookFor(file),
    copyGate = deferred();
  allow('copyLink', () => copyGate.promise);
  const copyJob = failedCopy().copyLink();
  view('ar');
  failedCopy();
  copyGate.reject(new Error('native'));
  await copyJob;
  assert.equal(of('success').length, 0);
  assert.deepEqual(of('toast'), [
    ['toast', i18n.createTranslator('fr')('files.actions.error.unexpected'), 'danger'],
  ]);
  // Links remain independent while local work is busy; raw known errors retain existing policy.
  reset();
  feedback();
  view('fr');
  const render = hookFor(file),
    gate = deferred();
  allow('ensure', () => gate.promise);
  allow('shareFile');
  allow('copyLink');
  allow('shareLink', failure('native'));
  const busy = render().share();
  await render().copyLink();
  await render().shareLink();
  assert.deepEqual(of('shareLink'), [['shareLink', 'https://explicit.invalid/raw', file]]);
  assert.equal(render().busy, 'share');
  assert.equal(of('ensure').length, 1);
  gate.resolve(local);
  await busy;
  for (const error of [
    new a.FileActionError('Sharing isn’t available on this device.'),
    new d.FileDownloadError('locked', ''),
    new a.FileActionError('Raw server', { reason: 'future' }),
  ]) {
    reset();
    feedback();
    allow('ensure', () => {
      throw error;
    });
    await render().share();
    assert.deepEqual(of('toast'), [['toast', error.message, 'danger']]);
    assert.equal(render().busy, null);
  }
  reset();
  const absent = hookFor(undefined)();
  await absent.share();
  await absent.print();
  await absent.copyLink();
  await absent.shareLink();
  absent.save();
  assert.equal(calls.length, 0);
  assert.equal(absent.canPrint, false);
  assert.equal(absent.link, null);
}
(async () => {
  catalogs();
  await operations();
  await printing();
  await downloads();
  presentation();
  await hooks();
  assert.deepEqual(unexpected, []);
  console.log(
    'File action catalogs, origins, native payloads, print/download metadata, locale sheets and callback races passed (' +
      (process.env.TZ ?? 'device') +
      ')',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
