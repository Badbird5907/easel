/* global __dirname */
/** Production modules, fail-closed synthetic native/storage/query/router/picker/upload
 * boundaries. Hook effects commit after rendering; no React Compiler/native acceptance.
 * Already-started requests cannot be rolled back by these UI lifetime guards. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const baseline = require('./downloads-upload.baseline.json');
const unexpected = [],
  calls = [],
  queues = new Map(),
  cache = new Map();
const fail = (name) => {
  unexpected.push(name);
  throw Error('Unexpected boundary: ' + name);
};
const boundary =
  (name) =>
  (...args) => {
    calls.push([name, ...args]);
    const queue = queues.get(name);
    if (!queue?.length) return fail(name);
    return queue.shift()(...args);
  };
const allow = (name, value) => {
  if (!queues.has(name)) queues.set(name, []);
  queues.get(name).push(typeof value === 'function' ? value : () => value);
};
const strict = (name, values) =>
  new Proxy(values, {
    get(o, k) {
      if (k === '__esModule') return false;
      if (k in o) return o[k];
      return fail(name + '.' + String(k));
    },
  });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
let scope;
const effect = (kind) => (fn, deps) => {
  const s = scope,
    i = s.cursor++,
    old = s.slots[i];
  if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
    const next = { deps, cleanup: null };
    s.slots[i] = next;
    s[kind].push(() => {
      old?.cleanup?.();
      next.cleanup = fn();
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
        if (!s.mounted) return fail('setState after unmount');
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
    if (!(i in s.slots)) s.slots[i] = { current: initial };
    return s.slots[i];
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
  useEffect: effect('effects'),
  useLayoutEffect: effect('layouts'),
  useSyncExternalStore(_subscribe, snapshot) {
    return snapshot();
  },
};
function mount(fn, initial) {
  let props = initial;
  const s = { cursor: 0, slots: [], layouts: [], effects: [], mounted: true, dirty: false };
  const h = {
    renderOnly(...args) {
      if (args.length) props = args[0];
      const old = scope;
      scope = s;
      s.cursor = 0;
      s.dirty = false;
      try {
        return fn(props);
      } finally {
        scope = old;
      }
    },
    commit() {
      for (const key of ['layouts', 'effects']) while (s[key].length) s[key].shift()();
    },
    render(...args) {
      let tree = h.renderOnly(...args);
      h.commit();
      let limit = 15;
      while (s.dirty) {
        assert.ok(limit--);
        tree = h.renderOnly();
        h.commit();
      }
      return tree;
    },
    unmount() {
      for (const slot of s.slots) slot?.cleanup?.();
      s.mounted = false;
    },
  };
  return h;
}
const jsx = (type, props, key) => ({ type, props, key });
const elements = (names) => Object.fromEntries(names.split(' ').map((n) => [n, n]));
const accountA = { id: 'account-A' },
  accountB = { id: 'account-B' },
  clientA = { id: 'client-A' },
  clientB = { id: 'client-B' };
let account = accountA,
  client = clientA,
  accountKey = 'key-A';
const session = (other = false) => {
  account = other ? accountB : accountA;
  client = other ? clientB : clientA;
  accountKey = other ? 'key-B' : 'key-A';
};
class CanvasError extends Error {}
const queryClient = { invalidateQueries: boundary('invalidate') };
const queryResult = (data) => ({ data, isPending: false, isFetching: false, error: null });
let folder = { id: 'folder-A', canUpload: true },
  browserUpload;
const mocks = {
  react: strict('react', react),
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': strict('native', {
    Alert: { alert: boundary('alert') },
    ...elements('RefreshControl View'),
  }),
  'lucide-react-native': strict(
    'icons',
    elements(
      'HardDriveDownload X ArrowUpDown Check EyeOff Folder FolderLock FolderOpen Lock SearchX Upload File FileArchive FileCode FileHeadphone FileImage FileSpreadsheet FileText FileType FileVideoCamera Globe Presentation',
    ),
  ),
  'expo-router': strict('router', {
    Stack: { Screen: 'Stack.Screen' },
    router: strict('navigation', {}),
    useFocusEffect: (fn) => react.useEffect(fn, [fn]),
  }),
  'expo-document-picker': strict('picker', { getDocumentAsync: boundary('pick') }),
  'expo-image-picker': strict('image picker', {}),
  '@tanstack/react-query': { useQueryClient: () => queryClient },
  '@/canvas/session': { useCanvas: () => ({ account, client }) },
  '@/canvas/query': { useAccountKey: () => accountKey },
  '@/canvas/client': { CanvasError },
  '@/canvas/uploads': { uploadToCanvas: boundary('upload') },
  '@/canvas/api/files': {
    MIN_SEARCH_LENGTH: 2,
    useRootFolder: () => queryResult(folder),
    useFolder: () => queryResult(folder),
    useFolderContents: () => queryResult({ folders: [], files: [] }),
    useFileSearch: () => queryResult({ folders: [], files: [] }),
  },
  '@/design': strict('design', {
    ...elements(
      'Button Callout Card EmptyState IconButton ListGroup ListItem Screen Skeleton Text Badge Icon IconTile PressableScale ProgressBar SearchField',
    ),
    useTheme: () => ({ colors: { fgMuted: 'muted' } }),
  }),
  '@/features/files/download': {
    listDownloads: boundary('list'),
    removeDownload: boundary('remove'),
  },
  '@/features/files/open': { openFile: boundary('open') },
  '@/features/files/FileThumbnail': { FileThumbnail: 'FileThumbnail' },
  '@/features/files/ActionSheet': {
    useActionSheet: () => ({ show: () => fail('sheet'), sheet: null }),
  },
};
const allowed = new Set([
  'app/(app)/files/downloads',
  'features/files/upload',
  'features/files/uploadPresentation',
  'features/files/useFileLifetime',
  'features/files/FolderBrowser',
  'features/files/browserPresentation',
  'features/files/AttachmentList',
  'features/files/kinds',
  'lib/dates',
  'i18n',
  'i18n/runtime',
  'i18n/en',
  'i18n/fr',
  'i18n/ar',
]);
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mocks[key]) return mocks[key];
  if (!key.startsWith('@/') || !allowed.has(key.slice(2))) return fail('import ' + key);
  const file = ['.ts', '.tsx', '/index.ts']
    .map((e) => path.join(root, key.slice(2)) + e)
    .find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: (n) => load(n, file),
    Intl,
    Date,
    console,
    fetch: () => fail('fetch'),
    setTimeout: () => fail('timer'),
  });
  new vm.Script(js, { filename: file }).runInContext(context);
  return module.exports;
}
// Normalize realm prototypes only; leaves production object identity available to strict tests.
const plain = (value) => JSON.parse(JSON.stringify(value));
const equal = (actual, expected) => assert.deepEqual(plain(actual), plain(expected));
const nodes = (t) =>
  !t || typeof t !== 'object'
    ? []
    : Array.isArray(t)
      ? t.flatMap(nodes)
      : [t, ...nodes(t.props?.children)];
const all = (t, type) => nodes(t).filter((n) => n.type === type);
const find = (t, type) => all(t, type)[0]?.props;
const text = (t) =>
  t == null || typeof t === 'boolean'
    ? ''
    : typeof t !== 'object'
      ? String(t)
      : Array.isArray(t)
        ? t.map(text).join(' ')
        : text(t.props?.children);
const i18n = load('@/i18n/runtime'),
  kinds = load('@/features/files/kinds');
const view = (locale) => {
  i18n.setAccountLocale('view', locale);
  return i18n.createTranslator(locale);
};
const langs = ['en', 'fr', 'ar'];
const Screen = load('@/app/(app)/files/downloads').default;
const upload = load('@/features/files/upload');
const presentation = load('@/features/files/uploadPresentation');
// The browser consumes the actual hook result without invoking a second hook instance.
mocks['@/features/files/upload'] = {
  useUploadToFolder: (id) => {
    assert.equal(id, folder?.canUpload === false ? undefined : folder?.id);
    return browserUpload;
  },
};
const Browser = load('@/features/files/FolderBrowser').FolderBrowser;
const browserProps = {
  context: { type: 'users', id: 'self' },
  rootTitle: 'My Files',
  onOpenFolder: () => fail('openFolder'),
};
const rawFile = Object.freeze({
  id: 'raw-id',
  name: 'Synced course العربية.txt',
  filename: 'RAW.DOCX',
  contentType: 'application/octet-stream',
  url: 'https://raw.invalid/x?token=raw',
  thumbnailUrl: 'raw-thumb',
});
const downloads = Object.freeze([
  { file: rawFile, size: 1250, kept: true, local: { raw: 'unchanged' } },
  { file: { ...rawFile, id: 'second', name: '' }, size: 0, kept: false, local: { raw: 2 } },
]);
const asset = Object.freeze({
  uri: 'file:///synthetic/raw%20asset',
  name: 'Couldn’t upload العربية.txt',
  size: 4321,
  mimeType: 'text/plain',
});
const picked = { canceled: false, assets: [asset] };
const hook = () => mount(upload.useUploadToFolder, 'folder-A');
const expectPicker = (job) =>
  allow('pick', (args) => {
    equal(args, { copyToCacheDirectory: true, multiple: false });
    return job.promise;
  });
const expectUpload = (job, expectedClient = clientA, expectedFolder = 'folder-A') => {
  const captured = {};
  allow('upload', (c, endpoint, raw, options) => {
    assert.equal(c, expectedClient);
    assert.equal(endpoint, '/api/v1/users/self/files');
    equal(raw, asset);
    equal(options.params, { parent_folder_id: expectedFolder, on_duplicate: 'rename' });
    captured.progress = options.onProgress;
    return job.promise;
  });
  return captured;
};
const invalidate = (key) =>
  allow('invalidate', (spec) => {
    equal(spec, { queryKey: [key, 'files'] });
    return Promise.resolve();
  });
(async () => {
  // Snapshot every original value, additive scope, key and placeholder parity.
  const catalogs = langs.map((l) => load('@/i18n/' + l)[l]);
  for (const [i, lang] of langs.entries()) {
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 1656);
    for (const [key, value] of Object.entries(baseline.catalogs[lang]))
      equal(catalogs[i][key], value);
    assert.ok(Object.keys(catalogs[i]).length >= 1670);
    equal(Object.keys(catalogs[i]).sort(), Object.keys(catalogs[0]).sort());
    for (const key of Object.keys(catalogs[0]))
      equal(
        [...new Set(JSON.stringify(catalogs[i][key]).match(/\{\w+\}/g) ?? [])].sort(),
        [...new Set(JSON.stringify(catalogs[0][key]).match(/\{\w+\}/g) ?? [])].sort(),
      );
  }
  // Later submission-picker slice: reverse only its exact additive camera origins.
  // Keep the original frozen baseline and all other source assertions intact.
  const withoutCameraOrigins = (source) => {
    for (const [name, origin] of [
      ['PickerPermissionError', 'camera-permission'],
      ['PickerUnavailableError', 'camera-unavailable'],
    ]) {
      source = source.replace(
        `export class ${name} extends Error {\n  constructor(message?: string, options?: ErrorOptions & { origin?: '${origin}' }) {\n    super(message, options);\n    this.origin = options?.origin;\n  }\n\n  readonly origin?: '${origin}';\n}`,
        `export class ${name} extends Error {}`,
      );
      source = source.replace(`, { origin: '${origin}' })`, ')');
    }
    return source;
  };
  const sources = withoutCameraOrigins(fs
    .readFileSync(path.join(root, 'features/files/upload.ts'), 'utf8')
    .split('// --- My Files')[0]
    .replace(
      "import { useLayoutEffect, useMemo, useRef, useState } from 'react';",
      "import { useState } from 'react';",
    )
    .replace("\nimport type { FolderUploadOrigin } from './uploadPresentation';", ''));
  assert.equal(
    createHash('sha256').update(sources).digest('hex'),
    baseline.uploadSourcesHash,
    'all picker helpers/filenames/options remain byte-identical',
  );
  const originalBrowser = fs
    .readFileSync(path.join(root, 'features/files/FolderBrowser.tsx'), 'utf8')
    .replace("\nimport { folderUploadError } from './uploadPresentation';", '')
    .replace('{folderUploadError(upload.state, t)}', '{upload.state.message}');
  assert.equal(
    createHash('sha256').update(originalBrowser).digest('hex'),
    baseline.folderBrowserHash,
    'FolderBrowser changes only error presentation and its import',
  );
  // Explicit-locale plural selection, including all Arabic cardinal categories.
  for (const locale of langs)
    for (const count of [0, 1, 2, 3, 11, 100, 102, 1000]) {
      view(locale === 'en' ? 'ar' : 'en');
      const t = i18n.createTranslator(locale),
        message = load('@/i18n/' + locale)[locale]['files.downloads.summary'];
      const template = message[new Intl.PluralRules(locale).select(count)] ?? message.other;
      const isolate = (v) => (locale === 'ar' ? '\u2068' + v + '\u2069' : v);
      const size = kinds.formatSize(count * 1250, locale);
      assert.equal(
        t('files.downloads.summary', { count, size }),
        template
          .replace('{count}', new Intl.NumberFormat(locale).format(count))
          .replace('{size}', isolate(size)),
      );
    }
  session();
  allow('list', (id) => {
    assert.equal(id, 'account-A');
    return downloads;
  });
  const screen = mount(Screen);
  let tree = screen.render();
  const initialCalls = calls.length;
  for (const locale of langs) {
    const t = view(locale);
    tree = screen.render();
    assert.equal(calls.length, initialCalls);
    assert.equal(find(tree, 'Stack.Screen').options.title, t('files.downloaded'));
    assert.equal(
      text(find(tree, 'Text').children),
      t('files.downloads.summary', { count: 2, size: kinds.formatSize(1250, locale) }),
    );
    const rows = all(tree, 'ListItem');
    equal(
      rows.map((n) => n.key),
      ['raw-id', 'second'],
    );
    rows.forEach((row, i) => {
      const d = downloads[i],
        p = row.props;
      assert.equal(p.title, d.file.name);
      const summary = [
        kinds.describeFile(d.file, locale).label,
        kinds.formatSize(d.size, locale),
        d.kept ? t('files.downloads.synced') : null,
      ]
        .filter(Boolean)
        .join(' · ');
      assert.equal(p.subtitle, summary);
      assert.equal(p.accessibilityLabel, t('file.rowLabel', { name: d.file.name, summary }));
      assert.equal(
        p.trailing.props.accessibilityLabel,
        t('files.downloads.remove', { name: d.file.name }),
      );
      equal(p.leading.props.file, { ...d.file, thumbnailUrl: null });
    });
  }
  allow('open', (id) => assert.equal(id, 'raw-id'));
  find(tree, 'ListItem').onPress();
  allow('remove', (...args) => equal(args, ['account-A', 'raw-id']));
  allow('list', downloads);
  find(tree, 'ListItem').trailing.props.onPress();
  tree = screen.render();
  let alert;
  allow('alert', (...args) => {
    alert = args;
  });
  view('fr');
  tree = screen.render();
  find(tree, 'Button').onPress();
  const tfr = i18n.createTranslator('fr');
  assert.equal(alert[0], tfr('files.downloads.confirmTitle'));
  assert.equal(alert[1], tfr('files.downloads.confirmBody'));
  equal(
    alert[2].map((x) => ({ text: x.text, style: x.style })),
    [
      { text: tfr('common.cancel'), style: 'cancel' },
      { text: tfr('files.downloads.confirmRemove'), style: 'destructive' },
    ],
  );
  const beforeCancel = calls.length;
  alert[2][0].onPress?.();
  assert.equal(calls.length, beforeCancel);
  for (const l of langs) {
    view(l);
    screen.render();
    assert.equal(calls.length, beforeCancel);
    assert.equal(alert[0], tfr('files.downloads.confirmTitle'));
  }
  allow('remove', (...args) => equal(args, ['account-A', 'raw-id']));
  allow('remove', (...args) => equal(args, ['account-A', 'second']));
  allow('list', []);
  alert[2][1].onPress();
  tree = screen.render();
  for (const l of langs) {
    const t = view(l);
    tree = screen.render();
    assert.equal(find(tree, 'EmptyState').title, t('files.downloads.empty'));
    assert.equal(find(tree, 'EmptyState').description, t('files.downloads.emptyDetail'));
  }
  // Locale switching during the synchronous read does not clear an active refresh
  // or trigger another read; the reload finally owns refreshing cleanup.
  allow('list', () => {
    const before = calls.length;
    for (const locale of langs) {
      view(locale);
      assert.equal(find(screen.render(), 'Screen').refreshControl.props.refreshing, true);
      assert.equal(calls.length, before);
    }
    return downloads;
  });
  find(tree, 'Screen').refreshControl.props.onRefresh();
  tree = screen.render();
  assert.equal(find(tree, 'Screen').refreshControl.props.refreshing, false);
  // Refresh failures clear spinner, remove stale successful data and allow retry.
  allow('list', downloads);
  find(tree, 'Screen').refreshControl.props.onRefresh();
  tree = screen.render();
  allow('list', () => {
    throw Error('raw filesystem detail');
  });
  find(tree, 'Screen').refreshControl.props.onRefresh();
  tree = screen.render();
  assert.equal(find(tree, 'Screen').refreshControl.props.refreshing, false);
  assert.equal(all(tree, 'ListItem').length, 0);
  assert.equal(find(tree, 'EmptyState'), undefined);
  const failureCalls = calls.length;
  for (const l of langs) {
    const t = view(l);
    tree = screen.render();
    assert.equal(find(tree, 'Callout').title, t('files.downloads.loadError'));
    assert.equal(text(find(tree, 'Callout').children), t('files.downloads.loadErrorDetail'));
    assert.equal(find(tree, 'Callout').action.label, t('common.retry'));
    assert.equal(calls.length, failureCalls);
  }
  allow('list', downloads);
  find(tree, 'Callout').action.onPress();
  tree = screen.render();
  // Captured alert/row/refresh callbacks cannot act after A->B->A or unmount/client replacement.
  for (const change of ['account', 'client', 'unmount']) {
    const oldRow = find(tree, 'ListItem'),
      oldAll = find(tree, 'Button').onPress,
      oldRefresh = find(tree, 'Screen').refreshControl.props.onRefresh;
    allow('alert', (...args) => {
      alert = args;
    });
    oldAll();
    if (change === 'unmount') screen.unmount();
    else {
      if (change === 'account') session(true);
      else client = { replacement: true };
      const first = screen.renderOnly();
      assert.equal(all(first, 'ListItem').length, 0, 'old items hidden before commit');
      assert.equal(find(first, 'EmptyState'), undefined);
      allow('list', []);
      screen.commit();
      tree = screen.render();
    }
    const before = calls.length;
    oldRow.onPress();
    oldRow.trailing.props.onPress();
    oldAll();
    oldRefresh();
    alert[2][1].onPress();
    assert.equal(calls.length, before);
    if (change !== 'unmount') {
      session();
      allow('list', downloads);
      tree = screen.render();
      const n = calls.length;
      oldRow.trailing.props.onPress();
      alert[2][1].onPress();
      assert.equal(calls.length, n);
    }
  }
  // Initialization throws in focus effect, not render; retry and post-delete reload throw.
  session();
  allow('list', () => {
    throw Error('metadata');
  });
  const init = mount(Screen);
  let it = init.render();
  assert.ok(find(it, 'Callout'));
  assert.equal(find(it, 'EmptyState'), undefined);
  allow('list', downloads);
  find(it, 'Callout').action.onPress();
  it = init.render();
  allow('remove', undefined);
  allow('list', () => {
    throw Error('reload');
  });
  find(it, 'ListItem').trailing.props.onPress();
  it = init.render();
  assert.ok(find(it, 'Callout'));
  assert.equal(find(it, 'Screen').refreshControl.props.refreshing, false);
  const staleRetry = find(it, 'Callout').action.onPress;
  init.unmount();
  const n = calls.length;
  staleRetry();
  assert.equal(calls.length, n);
  // Duplicate callbacks, cancellation, rejection, raw payload/progress and original invalidation.
  session();
  const h = hook();
  let value = h.render();
  const browser = mount(Browser, browserProps);
  for (const outcome of ['cancel', 'picker-error', 'success', 'quota', 'general']) {
    const pick = deferred(),
      send = deferred();
    expectPicker(pick);
    const captured = outcome === 'cancel' || outcome === 'picker-error' ? null : expectUpload(send);
    const task = value.pickAndUpload(),
      before = calls.length;
    await value.pickAndUpload();
    await h.render().pickAndUpload();
    assert.equal(calls.length, before, 'same-render/pending-picker duplicate blocked');
    for (const l of langs) {
      view(l);
      const snapshot = h.render().state;
      browserUpload = h.render();
      browser.render();
      equal(h.render().state, snapshot);
      assert.equal(calls.length, before);
    }
    if (outcome === 'cancel') pick.resolve({ canceled: true, assets: null });
    else if (outcome === 'picker-error') pick.reject(Error('native detail'));
    else pick.resolve(picked);
    await flush();
    if (captured) {
      assert.equal(h.render().state.status, 'uploading');
      captured.progress(0.45);
      assert.equal(h.render().state.fraction, 0.45);
      const n = calls.length;
      await value.pickAndUpload();
      assert.equal(calls.length, n);
      for (const l of langs) {
        view(l);
        const previous = h.render().state;
        browserUpload = h.render();
        const bt = browser.render();
        assert.equal(find(bt, 'ProgressBar').value, 0.45);
        assert.equal(h.render().state, previous);
        assert.equal(calls.length, n);
      }
      if (outcome === 'success') {
        invalidate('key-A');
        send.resolve(rawFile);
      } else
        send.reject(
          outcome === 'quota' ? new CanvasError('Server QUOTA raw') : Error('raw server detail'),
        );
    }
    await task;
    value = h.render();
    if (outcome === 'success') {
      assert.equal(value.state.status, 'done');
      assert.equal(value.state.file, rawFile);
    } else if (outcome !== 'cancel') {
      assert.equal(value.state.status, 'error');
      const reason =
        outcome === 'picker-error' ? 'picker' : outcome === 'quota' ? 'quota' : 'upload';
      assert.equal(value.state.origin.reason, reason);
      assert.equal(
        value.state.message,
        reason === 'picker'
          ? 'Couldn’t choose a file. Try again.'
          : reason === 'quota'
            ? 'Your My Files storage is full. Delete something in Canvas and try again.'
            : `Couldn’t upload ${asset.name}. Check your connection and try again.`,
      );
      const original = value.state,
        n = calls.length;
      for (const l of langs) {
        const t = view(l);
        browserUpload = h.render();
        const bt = browser.render();
        assert.equal(browserUpload.state, original);
        assert.equal(
          text(find(bt, 'Callout').children),
          t('files.uploadError.' + reason, reason === 'upload' ? { name: asset.name } : undefined),
        );
        assert.equal(calls.length, n);
      }
    }
    if (captured) {
      const settled = value.state;
      captured.progress(0.99);
      assert.equal(h.render().state, settled, 'late progress cannot overwrite settled state');
    }
    // Settlement itself releases the claim; retry must work without reset.
    const retry = deferred();
    expectPicker(retry);
    const retained = value.state;
    const retryTask = value.pickAndUpload();
    retry.resolve({ canceled: true, assets: null });
    await retryTask;
    equal(h.render().state, retained);
    value.reset();
    value = h.render();
    assert.equal(value.state.status, 'idle');
  }
  h.unmount();
  browser.unmount();
  // Legacy, unknown-origin and same-text server data remain raw even when equal to local messages.
  for (const l of langs) {
    const t = view(l);
    for (const message of [
      '',
      'Couldn’t choose a file. Try again.',
      'Your My Files storage is full. Delete something in Canvas and try again.',
      `Couldn’t upload ${asset.name}. Check your connection and try again.`,
    ])
      for (const origin of [undefined, { reason: 'server' }, { reason: 'unknown' }])
        assert.equal(presentation.folderUploadError({ message, origin }, t), message);
  }
  // Each obsolete context while picking AND uploading; old completion vs a new claim.
  for (const phase of ['picker', 'upload'])
    for (const change of ['reset', 'unmount', 'account', 'client', 'folder', 'permission'])
      for (const outcome of ['resolve', 'reject']) {
        session();
        const h = hook();
        const old = h.render(),
          p = deferred(),
          u = deferred();
        expectPicker(p);
        let captured;
        if (phase === 'upload') captured = expectUpload(u);
        const task = old.pickAndUpload();
        if (phase === 'upload') {
          p.resolve(picked);
          await flush();
          assert.equal(h.render().state.status, 'uploading');
        }
        let nextFolder = 'folder-A';
        if (change === 'reset') old.reset();
        else if (change === 'unmount') h.unmount();
        else if (change === 'account') session(true);
        else if (change === 'client') client = { replacement: true };
        else if (change === 'folder') nextFolder = 'folder-B';
        else nextFolder = undefined;
        let next;
        if (change !== 'unmount') {
          next = h.render(nextFolder);
          assert.equal(next.state.status, 'idle');
        }
        if (change !== 'reset') {
          const n = calls.length;
          await old.pickAndUpload();
          old.reset();
          assert.equal(calls.length, n, 'retained obsolete callbacks');
        }
        // A newer operation holds its own claim while the obsolete one settles.
        let newer, newPick, newSend, newProgress;
        if (change !== 'unmount' && change !== 'permission') {
          newPick = deferred();
          newSend = deferred();
          expectPicker(newPick);
          newProgress = expectUpload(newSend, client, nextFolder);
          newer = next.pickAndUpload();
          newPick.resolve(picked);
          await flush();
          newProgress.progress(0.71);
          assert.equal(h.render(nextFolder).state.fraction, 0.71);
        }
        const countBefore = calls.length;
        if (phase === 'picker')
          p[outcome](outcome === 'resolve' ? picked : Error('obsolete picker'));
        else {
          captured.progress(0.99);
          if (outcome === 'resolve') {
            invalidate('key-A');
            u.resolve(rawFile);
          } else u.reject(new CanvasError('quota'));
        }
        await task;
        assert.equal(
          calls.length,
          countBefore + (phase === 'upload' && outcome === 'resolve' ? 1 : 0),
          'no upload from obsolete picker; only original-account invalidation after started request',
        );
        if (change !== 'unmount') {
          const state = h.render(nextFolder).state;
          assert.equal(state.status, newer ? 'uploading' : 'idle');
          if (newer) assert.equal(state.fraction, 0.71);
          const n = calls.length;
          await h.render(nextFolder).pickAndUpload();
          assert.equal(
            calls.length,
            n,
            'old finally cannot release newer claim, permission stays blocked',
          );
        }
        if (newer) {
          invalidate(accountKey);
          newSend.resolve(rawFile);
          await newer;
          assert.equal(h.render(nextFolder).state.status, 'done');
        }
        if (change !== 'unmount') h.unmount();
      }
  // Invalidation can remain pending after bytes finish. Switching context while
  // it settles must not publish success/error or unlock the replacement operation.
  for (const outcome of ['resolve', 'reject']) {
    session();
    const h = hook(),
      p = deferred(),
      u = deferred(),
      q = deferred();
    expectPicker(p);
    expectUpload(u);
    const task = h.render().pickAndUpload();
    p.resolve(picked);
    await flush();
    allow('invalidate', (spec) => {
      equal(spec, { queryKey: ['key-A', 'files'] });
      return q.promise;
    });
    u.resolve(rawFile);
    await flush();
    session(true);
    assert.equal(h.render().state.status, 'idle');
    const newerPick = deferred();
    expectPicker(newerPick);
    const newer = h.render().pickAndUpload();
    for (const locale of langs) {
      view(locale);
      assert.equal(h.render().state.status, 'idle');
    }
    q[outcome](outcome === 'reject' ? Error('old query failed') : undefined);
    await task;
    const before = calls.length;
    await h.render().pickAndUpload();
    assert.equal(calls.length, before);
    newerPick.resolve({ canceled: true, assets: null });
    await newer;
    h.unmount();
  }
  // Display-time translator is explicit, even if foreground locale differs. The
  // browser itself also preserves same-text untagged/unknown-origin errors raw.
  folder = { id: 'folder-A', canUpload: true };
  const rawBrowser = mount(Browser, browserProps);
  for (const locale of langs) {
    const t = i18n.createTranslator(locale);
    view(locale === 'en' ? 'ar' : 'en');
    assert.equal(
      presentation.folderUploadError(
        { message: 'raw', origin: { reason: 'upload', name: asset.name } },
        t,
      ),
      t('files.uploadError.upload', { name: asset.name }),
    );
    view(locale);
    for (const origin of [undefined, { reason: 'server' }]) {
      const message = 'Couldn’t choose a file. Try again.';
      browserUpload = {
        state: { status: 'error', message, origin },
        pickAndUpload: () => fail('raw retry'),
      };
      assert.equal(text(find(rawBrowser.render(), 'Callout').children), message);
    }
  }
  rawBrowser.unmount();
  // Browser permission integration: disabled upload target plus raw/translated error rendering.
  folder = { id: 'folder-A', canUpload: false };
  browserUpload = { state: { status: 'idle' }, pickAndUpload: () => fail('disabled upload') };
  const disabled = mount(Browser, browserProps);
  assert.equal(find(disabled.render(), 'Button'), undefined);
  disabled.unmount();
  for (const [name, queue] of queues)
    assert.equal(queue.length, 0, 'unused expected boundary ' + name);
  assert.deepEqual(unexpected, []);
  console.log(
    `downloads-upload: ${Object.keys(catalogs[0]).length} keys, 1656 preserved values per locale; downloads/errors/lifetimes and 48 picker/upload transition cases passed (${process.env.TZ ?? 'host'})`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
