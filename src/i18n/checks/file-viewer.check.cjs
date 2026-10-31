const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
/** Executes freshly transpiled production viewer/bar/modal/route/helpers/catalogs and
 * file query hook. Native, previews/player, query/cache/download/action/browser boundaries
 * are explicit synthetic mocks. Persistent hook slots model dependency identity and state;
 * this is not native rendering, React Compiler, media position, WebView or zoom validation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..'),
  cache = new Map();
let scope;
const calls = [],
  queries = [],
  timers = [];
let subscriptions = 0;
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
    subscriptions++;
    return snapshot();
  },
};
react.useLayoutEffect = react.useEffect;
const navigation = { isFocused: () => true, addListener: () => () => {} };
const routeIdentity = { key: 'file', name: 'file' };
const jsx = (type, props, key) => ({ type, props, key });

const native = { Platform: { OS: 'android' }, useWindowDimensions: () => ({ width: 390, height: 844 }) };
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
const account = { id: 'account', baseUrl: 'https://school.invalid', host: 'school.invalid' };
const client = { authHeaders: { Authorization: 'synthetic-token' } };
const local = {
  uri: 'file:///synthetic/raw.txt',
  parentDirectory: { uri: 'file:///synthetic/' },
  base64: () => {
    calls.push(['read']);
    throw Error('Must not read');
  },
};
const result = (data) => ({
  data,
  isPending: false,
  isError: false,
  isPlaceholderData: false,
  refetch: () => {
    calls.push(['refetch']);
    return Promise.resolve();
  },
});
const state = {
  query: result(undefined),
  seed: undefined,
  cached: undefined,
  params: { fileId: 'f' },
  scheme: 'light',
  courses: [
    { id: 'c', color: 'course-tint' },
    { id: 'other', color: 'other-tint' },
  ],
};
const actionNames = ['share', 'save', 'openIn', 'print', 'shareLink'];
const actions = {
  busy: null,
  canPrint: true,
  elements: jsx('ActionElements', {}),
  ...Object.fromEntries(actionNames.map((k) => [k, (...a) => calls.push([k, ...a])])),
  download: {
    status: 'ready',
    local,
    progress: { fraction: null, bytes: 0 },
    ensure: (...a) => {
      calls.push(['ensure', ...a]);
      return Promise.reject(new Error('synthetic'));
    },
    cancel: (...a) => calls.push(['cancel', ...a]),
  },
};
const options = [];
const mocks = {
  '@tanstack/react-query': { useQueryClient: () => ({ getQueryCache: () => ({ findAll: () => [] }) }) },
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': new Proxy(native, { get: (o, k) => o[k] ?? k }),
  'lucide-react-native': new Proxy({}, { get: (_o, k) => k }),
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 20, top: 44 }) },
  'expo-router/react-navigation': { useHeaderHeight: () => 88 },
  'expo-router': {
    useIsFocused: () => true,
    useNavigation: () => navigation,
    useRoute: () => routeIdentity,
    Stack: { Screen: 'Stack.Screen' },
    useLocalSearchParams: () => state.params,
  },
  '@/canvas/client': { CanvasError, CanvasAuthError, CanvasNetworkError },
  '@/canvas/session': { isStoredAccountClient: () => true, useCanvas: () => ({ account, client }) },
  '@/canvas/api/files': {
    useFile: (...a) => {
      queries.push(a);
      return state.query;
    },
  },
  '@/canvas/api/courses': { useDashboardCourses: () => ({ data: state.courses }) },
  '@/design': new Proxy(
    {
      useTheme: () => ({
        colors: { accentFg: 'accent' },
        scheme: state.scheme,
        shadows: { raised: 'shadow' },
      }),
    },
    { get: (o, k) => o[k] ?? k },
  ),
  '@/features/content/browser': {
    openSignedIn: (_client, url, mayOpen) => {
      if (!mayOpen || mayOpen()) calls.push(['browser', url]);
      return Promise.resolve();
    },
    useOpenSignedIn:
      () =>
      (...a) =>
        calls.push(['browser', ...a]),
  },
  '@/features/files/FileCard': { FileCard: 'FileCard', FileHero: 'FileHero' },
  '@/features/files/open': {
    seededFile: (...a) => {
      calls.push(['seed', ...a]);
      return state.seed;
    },
  },
  '@/features/files/download': {
    FileDownloadError,
    cachedMeta: (...a) => {
      calls.push(['cache', ...a]);
      return state.cached;
    },
  },
  '@/features/files/actions': {
    fileWebUrl: (base, file, url) => {
      options.push(['url', base, file, url]);
      return (
        url ||
        (file.context?.type === 'course'
          ? `${base}/courses/${file.context.id}/files/${file.id}`
          : file.context?.type === 'group'
            ? `${base}/groups/${file.context.id}/files/${file.id}`
            : `${base}/files/${file.id}`)
      );
    },
  },
  '@/features/files/useFileActions': {
    useFileActions: (...a) => {
      options.push(['actions', ...a]);
      return actions;
    },
  },
  '@/features/files/previews/ImagePreview': { ImagePreview: 'ImagePreview' },
  '@/features/files/previews/MediaPreviews': { AudioPreview: 'AudioPreview', VideoPreview: 'VideoPreview' },
  '@/features/files/previews/TextPreviews': {
    TextPreview: 'TextPreview',
    CsvPreview: 'CsvPreview',
    MarkdownPreview: 'MarkdownPreview',
  },
  '@/features/files/previews/WebPreviews': {
    ANDROID_PDF_LIMIT: 30000000,
    LocalDocumentPreview: 'LocalDocumentPreview',
    PdfJsPreview: 'PdfJsPreview',
    DocViewerPreview: 'DocViewerPreview',
    HtmlPreview: 'HtmlPreview',
  },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  if (isIntlPolyfills(name)) return intlPolyfills;
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mocks[key]) return mocks[key];
  if (!key.startsWith('@/')) return require(key);
  const file = ['.ts', '.tsx', '/index.ts'].map((e) => path.join(root, key.slice(2)) + e).find(fs.existsSync);
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
  new Function('require', 'module', 'exports', 'setTimeout', js)(
    (n) => load(n, file),
    module,
    module.exports,
    (fn, ms) => timers.push({ fn, ms }),
  );
  return module.exports;
}
function harness(fn) {
  const s = { slots: [], cursor: 0 };
  return (props) => {
    const prev = scope;
    scope = s;
    s.cursor = 0;
    try {
      return fn(props);
    } finally {
      scope = prev;
    }
  };
}
const nodes = (t) =>
  !t || typeof t !== 'object' ? [] : Array.isArray(t) ? t.flatMap(nodes) : [t, ...nodes(t.props?.children)];
const all = (t, type) => nodes(t).filter((n) => n.type === type);
const find = (t, type, test = () => true) => all(t, type).find((n) => test(n.props))?.props;
const text = (t) =>
  t == null || typeof t === 'boolean'
    ? ''
    : typeof t !== 'object'
      ? String(t)
      : Array.isArray(t)
        ? t.map(text).join(' ')
        : text(t.props?.children);
const child = (t, name) => nodes(t).find((n) => typeof n.type === 'function' && n.type.name === name);
const renderChild = (n) => harness(n.type)(n.props);

const i18n = load('@/i18n/runtime'),
  k = load('@/features/files/kinds');
const ui = load('@/features/files/FileViewer'),
  bar = load('@/features/files/FileActionBar'),
  sheet = load('@/features/files/FileDetailsSheet'),
  route = load('@/app/(app)/file/[fileId]').default;
const p = load('@/features/files/viewerPresentation');
const langs = ['en', 'fr', 'ar'];
const view = (l) => {
  i18n.setAccountLocale('synthetic', l);
  return i18n.createTranslator(l);
};
const file = (ext = 'txt', extra = {}) => ({
  id: 'f',
  name: 'File',
  filename: 'raw.' + ext,
  contentType: 'application/octet-stream',
  size: 1234,
  url: 'https://school.invalid/files/f/download?verifier=raw',
  lockedForUser: false,
  ...extra,
});
const props = {
  fileId: 'f',
  courseId: 'c',
  canvasUrl: 'https://school.invalid/courses/c/files/f',
  onFile: (f) => calls.push(['onFile', f]),
  onZoomChange: (v) => calls.push(['zoom', v]),
  position: '2 of 5',
};
const actionOption = () => options.filter((o) => o[0] === 'actions').at(-1);
const previewNames = [
  'ImagePreview',
  'LocalDocumentPreview',
  'PdfJsPreview',
  'TextPreview',
  'CsvPreview',
  'MarkdownPreview',
  'HtmlPreview',
  'DocViewerPreview',
  'VideoPreview',
  'AudioPreview',
];
const preview = (t) => nodes(t).find((n) => previewNames.includes(n.type));
const reset = (f) => {
  state.query = result(f);
  state.seed = undefined;
  state.cached = undefined;
  actions.download.status = 'ready';
  actions.download.local = local;
  actions.busy = null;
  actions.canPrint = true;
};
(async () => {
  const baseline = require('./file-viewer.baseline.json'),
    cats = langs.map((l) => load('@/i18n/' + l)[l]);
  assert.equal(baseline.catalogKeys.length, 1558);
  assert.ok(Object.keys(cats[0]).length >= 1594);
  const slots = (v) => [...new Set(JSON.stringify(v).match(/\{\w+\}/g) ?? [])].sort();
  for (const [i, l] of langs.entries()) {
    assert.equal(
      createHash('sha256')
        .update(JSON.stringify(baseline.catalogKeys.map((key) => [key, cats[i][key]])))
        .digest('hex'),
      baseline.catalogHashes[l],
    );
    assert.deepEqual(Object.keys(cats[i]).sort(), Object.keys(cats[0]).sort());
    for (const key of Object.keys(cats[0])) assert.deepEqual(slots(cats[i][key]), slots(cats[0][key]), key);
  }
  // Every mode on both platforms, thresholds exactly equal/one above, unknown MIME/ext,
  // doc preview URL truthiness and raw names. Same objects and mounted viewer per locale loop.
  const cases = [
    ['pdf', 'pdf'],
    ['png', 'image'],
    ['mp4', 'video'],
    ['mp3', 'audio'],
    ['txt', 'text'],
    ['js', 'code'],
    ['csv', 'csv'],
    ['tsv', 'csv'],
    ['md', 'markdown'],
    ['html', 'html'],
    ['docx', 'office'],
    ['xlsx', 'office'],
    ['pptx', 'office'],
    ['zip', 'card'],
    ['xyz', 'card'],
    ['', 'card'],
  ];
  for (const os of ['ios', 'android'])
    for (const [ext, baseMode] of cases)
      for (const size of [null, 0, 5000000, 5000001, 30000000, 30000001])
        for (const url of [undefined, '', 'https://signed.invalid/preview?token=raw']) {
          native.Platform.OS = os;
          const f = file(ext, { size, previewUrl: url });
          reset(f);
          const render = harness(ui.FileViewer);
          const mode =
            baseMode === 'office'
              ? url
                ? 'docviewer'
                : os === 'ios'
                  ? 'local-document'
                  : 'card'
              : baseMode === 'pdf' && os === 'android' && size > 30000000
                ? 'card'
                : ['text', 'code', 'csv', 'markdown'].includes(baseMode) && size > 5000000
                  ? 'card'
                  : baseMode;
          const expected = {
            pdf: os === 'ios' ? 'LocalDocumentPreview' : 'PdfJsPreview',
            image: 'ImagePreview',
            text: 'TextPreview',
            code: 'TextPreview',
            csv: 'CsvPreview',
            markdown: 'MarkdownPreview',
            html: 'HtmlPreview',
            docviewer: 'DocViewerPreview',
            'local-document': 'LocalDocumentPreview',
            video: 'VideoPreview',
            audio: 'AudioPreview',
          }[mode];
          let identity;
          for (const l of langs) {
            const t = view(l),
              before = calls.length;
            const tree = render(props);
            assert.equal(ui.previewModeFor(f), mode);
            assert.deepEqual(queries.at(-1), ['f', { courseId: 'c', seed: undefined }]);
            assert.deepEqual(actionOption(), [
              'actions',
              f,
              {
                canvasUrl: props.canvasUrl,
                autoDownload: !['video', 'audio', 'docviewer', 'card'].includes(mode),
                toastOffset: mode === 'card' ? 24 : 96,
              },
            ]);
            if (l !== 'en') assert.equal(calls.length, before, 'no locale-only side effects');
            if (mode === 'card') {
              assert.equal(find(tree, 'FileCard').file, f);
              assert.ok(find(tree, 'FileCard').note);
              assert.equal(child(tree, 'PositionPill').props.bottom, 28);
            } else {
              const n = preview(tree);
              assert.equal(n.type, expected);
              if (n.props.local) assert.equal(n.props.local, local);
              const { onError, title, accessibilityLabel, ...stable } = n.props;
              if (identity) assert.deepEqual(stable, identity);
              identity = stable;
              if (['ImagePreview', 'LocalDocumentPreview', 'PdfJsPreview', 'HtmlPreview'].includes(expected))
                assert.equal(
                  accessibilityLabel ?? title,
                  t('file.rowLabel', { name: f.name, summary: k.describeFile(f, l).label }),
                );
              if (expected === 'TextPreview') assert.equal(n.props.code, mode === 'code');
              if (expected === 'CsvPreview') assert.equal(n.props.delimiter, ext === 'tsv' ? '\t' : ',');
              if (expected === 'DocViewerPreview') {
                assert.equal(n.props.url, url);
                assert.equal(n.props.title, f.name);
              }
              const pad = all(tree, 'View').find((n) => n.props.style?.paddingTop !== undefined).props.style
                .paddingTop;
              assert.equal(
                pad,
                os === 'ios' &&
                  !['pdf', 'local-document', 'html', 'docviewer', 'text', 'code', 'markdown'].includes(mode)
                  ? 88
                  : 0,
              );
              assert.equal(child(tree, 'PositionPill').props.bottom, 12);
            }
            assert.equal(
              renderChild(child(tree, 'PositionPill')).props.children.props.children.props.children,
              props.position,
            );
            assert.ok(nodes(tree).includes(actions.elements));
          }
        }
  // Locks and failedId stick to the same file across language changes, never trigger a preview.
  for (const ext of ['pdf', 'png', 'mp4', 'docx', 'zip']) {
    reset(file(ext, { lockedForUser: true }));
    const r = harness(ui.FileViewer);
    for (const l of langs) {
      view(l);
      const tree = r(props);
      assert.equal(find(tree, 'FileCard').note, undefined);
      assert.equal(actionOption()[2].autoDownload, false);
      assert.equal(preview(tree), undefined);
    }
  }
  reset(file('png'));
  const failed = harness(ui.FileViewer);
  preview(failed(props)).props.onError();
  for (const l of langs) {
    const t = view(l),
      tree = failed(props);
    assert.equal(find(tree, 'FileCard').note, t('files.viewer.note.failed'));
    assert.equal(actionOption()[2].autoDownload, false);
  }
  state.query = result(file('png', { id: 'other' }));
  assert.equal(preview(failed({ ...props, fileId: 'other' })).type, 'ImagePreview');
  // Card notes by stable kind (including oversize descriptions without case conversion).
  for (const [ext, key] of [
    ['zip', 'archive'],
    ['docx', 'document'],
    ['xlsx', 'spreadsheet'],
    ['pptx', 'presentation'],
    ['xyz', 'unknown'],
    ['pdf', 'pdf'],
    ['txt', 'large'],
    ['js', 'large'],
    ['csv', 'large'],
    ['md', 'large'],
  ]) {
    native.Platform.OS = 'android';
    const f = file(ext, { size: 30000001 });
    reset(f);
    const r = harness(ui.FileViewer);
    for (const l of langs) {
      const t = view(l);
      assert.equal(
        find(r(props), 'FileCard').note,
        t('files.viewer.note.' + key, key === 'large' ? { type: k.describeFile(f, l).label } : undefined),
      );
    }
  }
  // Media source and credentials: local wins, same host only, no locale in metadata/source.
  for (const ext of ['mp4', 'mp3'])
    for (const url of [
      'https://school.invalid/files/f',
      'https://school.invalid:8443/f',
      'https://cdn.invalid/f',
      'malformed',
      '',
      undefined,
    ])
      for (const downloaded of [true, false]) {
        const f = file(ext, { url, name: 'File' });
        reset(f);
        actions.download.local = downloaded ? local : undefined;
        const r = harness(ui.FileViewer);
        let first;
        for (const l of langs) {
          view(l);
          const before = calls.length,
            tree = r(props),
            n = preview(tree);
          if (!downloaded && !url) {
            assert.ok(find(tree, 'FileCard'));
            continue;
          }
          const source = downloaded
            ? { uri: local.uri, metadata: { title: 'File' } }
            : {
                uri: url,
                headers: url === 'https://school.invalid/files/f' ? client.authHeaders : undefined,
                metadata: { title: 'File' },
              };
          assert.deepEqual(n.props.source, source);
          if (first) assert.deepEqual(n.props.source, first);
          first = n.props.source;
          assert.equal(n.props.title ?? n.props.file.name, 'File');
          if (l !== 'en') assert.equal(calls.length, before);
        }
        const before = calls.length,
          off = r({ ...props, active: false });
        assert.equal(preview(off), undefined);
        assert.equal(actionOption()[2].autoDownload, false);
        assert.equal(calls.length, before);
      }
  // Pending, placeholder and settled metadata; active/offscreen transitions only change gates.
  for (const ext of ['png', 'mp4', 'docx'])
    for (const placeholder of [true, false])
      for (const error of [true, false]) {
        reset(file(ext, { previewUrl: ext === 'docx' ? 'https://signed.invalid/raw' : undefined }));
        state.query.isPlaceholderData = placeholder;
        state.query.isError = error;
        state.query.error = new CanvasNetworkError();
        const r = harness(ui.FileViewer);
        for (const active of [false, true, false, true]) {
          let last;
          for (const l of langs) {
            view(l);
            const before = calls.length,
              tree = r({ ...props, active });
            assert.equal(actionOption()[2].autoDownload, active && (!placeholder || error) && ext === 'png');
            if (ext === 'png') assert.equal(!!child(tree, 'DownloadingState'), placeholder && !error);
            if (ext === 'mp4') assert.equal(!!preview(tree), active);
            if (last) assert.equal(calls.length, before);
            last = true;
          }
        }
      }
  reset(undefined);
  state.query.isPending = true;
  const loading = harness(ui.FileViewer);
  for (const l of langs) {
    const t = view(l);
    assert.equal(
      find(renderChild(child(loading(props), 'LoadingState')), 'View').accessibilityLabel,
      t('files.viewer.loading'),
    );
  }
  // Metadata errors use exact status/class precedence and existing retry/browser policy.
  const errors = [
    [new CanvasNetworkError(), 'offline'],
    [new CanvasAuthError(401), 'signed_out'],
    [new CanvasError(404), 'not_found'],
    [new CanvasError(403), 'forbidden'],
    [new CanvasError(401), 'forbidden'],
    [new CanvasError(500), 'server'],
    [new CanvasError(599), 'server'],
    [new CanvasError(400), 'unknown'],
    [new Error('File not found'), 'unknown'],
    [null, 'unknown'],
  ];
  function checkError(tree, kind, t, retryCall, url) {
    const n = child(tree, 'ErrorState');
    assert.equal(n.props.kind, kind);
    const e = renderChild(n),
      empty = find(e, 'EmptyState');
    const display = [
      'not_found',
      'forbidden',
      'locked',
      'signed_out',
      'offline',
      'server',
      'storage',
      'unknown',
    ].includes(kind)
      ? kind
      : 'unknown';
    assert.equal(empty.title, t('files.viewer.error.' + display + '.title'));
    assert.equal(empty.description, t('files.viewer.error.' + display + '.body'));
    const retry = !['not_found', 'forbidden'].includes(kind),
      browser = !!url && ['forbidden', 'signed_out', 'server', 'unknown'].includes(kind);
    assert.equal(!!empty.action, retry);
    assert.equal(!!find(e, 'Button'), browser);
    if (retry) {
      assert.equal(empty.action.label, t('common.retry'));
      empty.action.onPress();
      assert.deepEqual(calls.pop(), [retryCall]);
    }
    if (browser) {
      assert.equal(text(find(e, 'Button').children), t('files.viewer.browser'));
      find(e, 'Button').onPress();
      assert.deepEqual(calls.pop(), ['browser', url]);
    }
  }
  for (const [error, kind] of errors)
    for (const url of [undefined, '', 'https://school.invalid/courses/c/files/f?wrap=1']) {
      reset(undefined);
      state.query.isError = !!error;
      state.query.error = error;
      const r = harness(ui.FileViewer);
      for (const l of langs) {
        const t = view(l),
          before = calls.length,
          tree = r({ ...props, canvasUrl: url });
        if (l !== 'en') assert.equal(calls.length, before);
        checkError(tree, kind, t, 'refetch', url ?? account.baseUrl + '/files/f');
      }
    }
  // Offline cache never falls back to supplied seed; forbidden/not-found seed URL does.
  for (const [error, kind] of errors.slice(0, 7))
    for (const cached of [undefined, file('png', { id: 'cached' })])
      for (const seed of [undefined, file('txt'), file('txt', { url: '' })])
        for (const data of [undefined, file('md', { id: 'query' })]) {
          reset(data);
          state.query.isError = true;
          state.query.error = error;
          state.cached = cached;
          state.seed = seed;
          const r = harness(ui.FileViewer);
          const expected =
            data ??
            (kind === 'offline'
              ? cached
              : ['forbidden', 'not_found'].includes(kind) && seed?.url
                ? seed
                : undefined);
          for (const l of langs) {
            view(l);
            const before = calls.length;
            r(props);
            assert.equal(actionOption()[1], expected);
            assert.equal(queries.at(-1)[1].seed, seed);
            if (l !== 'en') assert.equal(calls.length, before);
          }
        }
  // Download states, progress boundaries and explicit callbacks, no locale-only read/ensure.
  for (const status of ['idle', 'downloading', 'ready', 'error'])
    for (const fraction of [null, 0, 0.005, 0.3749, 1])
      for (const bytes of [0, 1, 1234]) {
        reset(file('png'));
        actions.download.status = status;
        actions.download.progress = { fraction, bytes };
        actions.download.error = new FileDownloadError('storage');
        const r = harness(ui.FileViewer);
        for (const l of langs) {
          const t = view(l),
            before = calls.length,
            tree = r(props);
          if (l !== 'en') assert.equal(calls.length, before);
          if (status === 'error') {
            checkError(tree, 'storage', t, 'ensure', props.canvasUrl);
            continue;
          }
          if (status === 'ready') {
            assert.equal(preview(tree).props.uri, local.uri);
            continue;
          }
          const d = renderChild(child(tree, 'DownloadingState'));
          if (status === 'idle') {
            assert.equal(text(find(d, 'Button').children), t('files.viewer.downloadPreview'));
            find(d, 'Button').onPress();
            assert.deepEqual(calls.pop(), ['ensure']);
          } else {
            const pct = new Intl.NumberFormat(l, { style: 'percent', maximumFractionDigits: 0 }).format(
              Math.round(fraction * 100) / 100,
            );
            const label =
              fraction === null ? t('files.downloading') : t('files.downloadLabelPercent', { percent: pct });
            assert.equal(find(d, 'ProgressBar').value, fraction ?? 0);
            assert.equal(find(d, 'ProgressBar').accessibilityLabel, label);
            assert.equal(
              find(d, 'Text').children,
              fraction === null
                ? t('files.downloadBytes', { size: k.formatSize(bytes, l) ?? '' })
                : t('files.downloadPercent', { percent: pct }),
            );
            assert.equal(find(d, 'Button').onPress, actions.download.cancel);
            find(d, 'Button').onPress();
            assert.deepEqual(calls.pop(), ['cancel']);
            assert.equal(p.downloadPresentation(fraction, bytes, l).label, label);
          }
        }
      }
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
    'toString',
    '__proto__',
  ]) {
    reset(file('pdf'));
    actions.download.status = 'error';
    actions.download.error = new FileDownloadError(kind);
    const r = harness(ui.FileViewer);
    for (const l of langs) checkError(r(props), kind, view(l), 'ensure', props.canvasUrl);
  }
  reset(file('pdf'));
  actions.download.status = 'error';
  actions.download.error = new Error('Forbidden');
  checkError(harness(ui.FileViewer)(props), 'unknown', view('en'), 'ensure', props.canvasUrl);
  // Existing file/name/position props remain raw, including empty and English-looking content.
  for (const name of ['File', 'Details', 'Open in…', '', 'ملف خام'])
    for (const position of ['2 of 5', 'Details', '', undefined]) {
      reset(file('png', { name }));
      const r = harness(ui.FileViewer);
      for (const l of langs) {
        const t = view(l),
          tree = r({ ...props, position });
        assert.equal(
          preview(tree).props.accessibilityLabel,
          t('file.rowLabel', { name, summary: k.describeFile(state.query.data, l).label }),
        );
        const pill = renderChild(child(tree, 'PositionPill'));
        assert.equal(pill ? text(pill) : null, position || null);
        assert.equal(state.query.data.name, name);
      }
    }
  // Bar IDs/order/callbacks and busy/locked/canPrint policies, same mounted component.
  for (const canPrint of [false, true])
    for (const locked of [false, true])
      for (const busy of [null, 'share', 'save', 'open', 'print', 'link'])
        for (const status of ['idle', 'downloading', 'ready', 'error'])
          for (const fraction of [null, 0, 0.345, 1]) {
            actions.canPrint = canPrint;
            actions.busy = busy;
            actions.download.status = status;
            actions.download.progress = { fraction, bytes: 1234 };
            const r = harness(bar.FileActionBar);
            for (const l of langs) {
              const t = view(l),
                before = calls.length,
                tree = r({ actions, locked }),
                items = all(tree, 'PressableScale');
              assert.equal(calls.length, before);
              const ids = ['share', 'save', 'open', ...(canPrint ? ['print'] : []), 'link'];
              assert.deepEqual(
                items.map((n) => n.key),
                ids,
              );
              items.forEach((n) => {
                const id = n.key,
                  callback = { open: 'openIn', link: 'shareLink' }[id] ?? id,
                  key = { open: 'openIn', link: 'shareLink' }[id] ?? id;
                const isBusy = busy === id,
                  disabled = (locked && id !== 'link') || (!!busy && !isBusy);
                assert.deepEqual(n.props.accessibilityState, { disabled, busy: isBusy });
                assert.equal(n.props.disabled, disabled);
                assert.equal(n.props.onPress, actions[callback]);
                assert.equal(
                  n.props.accessibilityLabel,
                  t(id === 'open' ? 'files.viewer.openLabel' : 'files.' + key),
                );
                assert.equal(n.props.accessibilityHint, t('files.viewer.hint.' + id));
                assert.equal(find(n, 'Text').children, t('files.' + key));
                if (!disabled) {
                  n.props.onPress();
                  assert.deepEqual(calls.pop(), [callback]);
                }
              });
              assert.equal(!!find(tree, 'ProgressBar'), status === 'downloading' && !!busy);
              if (find(tree, 'ProgressBar')) {
                assert.equal(find(tree, 'ProgressBar').value, fraction ?? 0);
                assert.equal(
                  find(tree, 'ProgressBar').accessibilityLabel,
                  p.downloadPresentation(fraction, 0, l).label,
                );
              }
            }
          }
  // Details Modal stays mounted by scheme; locale changes do not close or invoke an action.
  reset(file());
  for (const os of ['ios', 'android'])
    for (const visible of [true, false])
      for (const f of [state.query.data, undefined]) {
        native.Platform.OS = os;
        const r = harness(sheet.FileDetailsSheet),
          onClose = () => calls.push(['close']);
        for (const l of langs) {
          const t = view(l),
            before = calls.length,
            tree = r({ file: f, courseId: 'c', canvasUrl: props.canvasUrl, visible, onClose });
          assert.equal(calls.length, before);
          assert.deepEqual(actionOption(), ['actions', f, { canvasUrl: props.canvasUrl, toastOffset: 24 }]);
          assert.equal(tree.type, 'Modal');
          assert.equal(tree.props.visible, visible && !!f);
          assert.equal(tree.props.onRequestClose, onClose);
          assert.equal(tree.props.presentationStyle, os === 'ios' ? 'pageSheet' : 'fullScreen');
          assert.equal(tree.props.children.key, 'light');
          assert.equal(tree.props.children.props.style.paddingTop, os === 'android' ? 44 : 0);
          assert.equal(find(tree, 'IconButton').accessibilityLabel, t('files.viewer.closeDetails'));
          assert.equal(find(tree, 'IconButton').onPress, onClose);
          assert.equal(find(tree, 'Text').children, t('files.viewer.details'));
          assert.ok(nodes(tree).includes(actions.elements));
        }
      }
  // Route state persists: current page, remembered metadata, zoom, open details and callback identity.
  state.params = { fileId: 'b', ids: ',a,b,c,', courseId: 'c', canvasUrl: props.canvasUrl };
  const r = harness(route);
  view('en');
  let tree = r(),
    list = find(tree, 'FlatList');
  const ids = list.data,
    onViewable = list.onViewableItemsChanged;
  assert.deepEqual(ids, ['a', 'b', 'c']);
  assert.equal(list.initialScrollIndex, 1);
  assert.equal(find(tree, 'Stack.Screen').options.title, 'File');
  onViewable({ viewableItems: [{ index: 2 }] });
  tree = r();
  list = find(tree, 'FlatList');
  let page = find(list.renderItem({ item: 'c', index: 2 }), ui.FileViewer);
  const remembered = file('png', { id: 'c', name: 'Details', context: { type: 'course', id: 'other' } });
  page.onFile(remembered);
  page.onZoomChange(true);
  tree = r();
  find(tree, 'Stack.Screen').options.headerRight().props.onPress();
  tree = r();
  for (const l of langs) {
    const t = view(l),
      before = calls.length;
    tree = r();
    list = find(tree, 'FlatList');
    assert.equal(calls.length, before);
    assert.equal(list.data, ids);
    assert.equal(list.onViewableItemsChanged, onViewable);
    assert.equal(list.initialScrollIndex, 2);
    assert.equal(list.scrollEnabled, false);
    assert.equal(find(tree, 'AccentScope').color, 'other-tint');
    assert.equal(find(tree, 'Stack.Screen').options.title, 'Details');
    assert.equal(
      find(tree, 'Stack.Screen').options.headerRight().props.accessibilityLabel,
      t('files.viewer.details'),
    );
    assert.equal(find(tree, 'Stack.Screen').options.headerRight().props.iconColor, 'accent');
    const modal = find(tree, sheet.FileDetailsSheet);
    assert.equal(modal.file, remembered);
    assert.equal(modal.visible, true);
    assert.equal(modal.canvasUrl, undefined);
    assert.equal(modal.courseId, 'c');
    ids.forEach((id, i) => {
      const item = list.renderItem({ item: id, index: i }),
        p = find(item, ui.FileViewer);
      assert.equal(p.fileId, id);
      assert.equal(p.active, i === 2);
      assert.equal(p.canvasUrl, undefined);
      assert.equal(p.courseId, 'c');
      assert.equal(
        p.position,
        t('files.viewer.position', {
          current: new Intl.NumberFormat(l).format(i + 1),
          total: new Intl.NumberFormat(l).format(3),
        }),
      );
      assert.equal(item.props.style.width, 390);
      assert.equal(list.keyExtractor(id), id);
      assert.deepEqual(list.getItemLayout(undefined, i), { length: 390, offset: 390 * i, index: i });
    });
    assert.equal(list.windowSize, 3);
    assert.equal(list.initialNumToRender, 1);
    assert.equal(list.maxToRenderPerBatch, 1);
    assert.deepEqual(list.viewabilityConfig, { itemVisiblePercentThreshold: 60 });
  }
  find(tree, sheet.FileDetailsSheet).onClose();
  assert.equal(find(r(), sheet.FileDetailsSheet).visible, false);
  onViewable({ viewableItems: [{ index: null }] });
  assert.equal(find(r(), 'FlatList').initialScrollIndex, 2);
  onViewable({ viewableItems: [] });
  assert.equal(find(r(), 'FlatList').initialScrollIndex, 2);
  for (const listIds of [undefined, '', 'x,y', 'f', 'f,f'])
    for (const name of [undefined, '', 'File']) {
      state.params = { fileId: 'f', ids: listIds, courseId: 'c', canvasUrl: props.canvasUrl };
      const rr = harness(route);
      let out = rr();
      if (!find(out, 'FlatList') && name !== undefined)
        find(out, ui.FileViewer).onFile(file('txt', { name }));
      for (const l of langs) {
        const t = view(l);
        out = rr();
        if (listIds === 'f,f') {
          assert.deepEqual(find(out, 'FlatList').data, ['f', 'f']);
          continue;
        }
        assert.equal(find(out, 'FlatList'), undefined);
        const p = find(out, ui.FileViewer);
        assert.equal(p.fileId, 'f');
        assert.equal(p.canvasUrl, props.canvasUrl);
        assert.equal(find(out, sheet.FileDetailsSheet).canvasUrl, props.canvasUrl);
        assert.equal(find(out, 'Stack.Screen').options.title, name ?? t('file.generic.file'));
      }
    }
  // Same viewer instance under route callbacks: new remember closures must not replay onFile.
  state.params = { fileId: 'f' };
  const rr = harness(route),
    vr = harness(ui.FileViewer);
  reset(file('png'));
  let fileCalls = 0;
  for (const l of langs) {
    view(l);
    const o = rr(),
      p = find(o, ui.FileViewer),
      before = fileCalls;
    vr({
      ...p,
      onFile: (f) => {
        fileCalls++;
        p.onFile(f);
      },
    });
    if (l !== 'en') assert.equal(fileCalls, before);
  }
  assert.equal(fileCalls, 1);
  // Independently mounted memoized consumers must directly subscribe and relabel
  // with the exact same props, without relying on a parent to allocate new objects.
  reset(file('png'));
  actions.download.status = 'downloading';
  actions.download.progress = { fraction: 0.125, bytes: 1234 };
  const downloadNode = child(harness(ui.FileViewer)(props), 'DownloadingState');
  reset(undefined);
  state.query.isPending = true;
  const loadingNode = child(harness(ui.FileViewer)(props), 'LoadingState');
  state.query.isPending = false;
  const errorNode = child(harness(ui.FileViewer)(props), 'ErrorState');
  const presentations = [
    [
      downloadNode.type,
      downloadNode.props,
      (tree, t, l) =>
        assert.equal(
          find(tree, 'ProgressBar').accessibilityLabel,
          p.downloadPresentation(0.125, 1234, l).label,
        ),
    ],
    [
      loadingNode.type,
      loadingNode.props,
      (tree, t) => assert.equal(find(tree, 'View').accessibilityLabel, t('files.viewer.loading')),
    ],
    [
      errorNode.type,
      errorNode.props,
      (tree, t) => assert.equal(find(tree, 'EmptyState').title, t('files.viewer.error.unknown.title')),
    ],
    [
      bar.FileActionBar,
      { actions, locked: false },
      (tree, t) => assert.equal(find(tree, 'PressableScale').accessibilityLabel, t('files.share')),
    ],
    [
      sheet.FileDetailsSheet,
      { file: file(), visible: true, onClose: () => calls.push(['close']) },
      (tree, t) => assert.equal(find(tree, 'Text').children, t('files.viewer.details')),
    ],
  ];
  actions.download.status = 'downloading';
  for (const [component, sameProps, check] of presentations) {
    const mounted = harness(component);
    for (const l of langs) {
      const t = view(l),
        before = calls.length,
        beforeSubscriptions = subscriptions;
      check(mounted(sameProps), t, l);
      assert.ok(subscriptions > beforeSubscriptions, component.name + ' subscribes directly');
      assert.equal(calls.length, before);
    }
  }
  // onFile payload/active policy and onZoomChange pass-through retain exact semantics.
  reset(file('png'));
  const activeViewer = harness(ui.FileViewer);
  let out = activeViewer({ ...props, active: false });
  const beforeActivate = calls.length;
  out = activeViewer(props);
  assert.deepEqual(calls.slice(beforeActivate), [['onFile', state.query.data]]);
  assert.equal(preview(out).props.onZoomChange, props.onZoomChange);
  for (const l of langs) {
    view(l);
    const before = calls.length;
    activeViewer(props);
    assert.equal(calls.length, before);
  }
  preview(out).props.onZoomChange(true);
  assert.deepEqual(calls.pop(), ['zoom', true]);
  const beforeDeactivate = calls.length;
  activeViewer({ ...props, active: false });
  assert.equal(calls.length, beforeDeactivate);
  // Signed-in URL selection is passed through the action boundary with raw file/context/URL.
  for (const type of ['course', 'group', 'user'])
    for (const url of [undefined, '', 'https://school.invalid/raw?wrap=1']) {
      const f = file('pdf', { context: { type, id: 'context-id' } });
      reset(f);
      actions.download.status = 'error';
      actions.download.error = new FileDownloadError('signed_out');
      const mounted = harness(ui.FileViewer);
      for (const l of langs) {
        const t = view(l),
          tree = mounted({ ...props, canvasUrl: url });
        assert.deepEqual(options.filter((x) => x[0] === 'url').at(-1), ['url', account.baseUrl, f, url]);
        const expected =
          url ||
          account.baseUrl +
            (type === 'course' ? '/courses/context-id' : type === 'group' ? '/groups/context-id' : '') +
            '/files/f';
        checkError(tree, 'signed_out', t, 'ensure', expected);
      }
    }
  // Production query hook: exact keys, seed placeholder and inherited retry policy independent of locale.
  delete mocks['@/canvas/api/files'];
  const specs = [];
  mocks['@/canvas/query'] = {
    useAccountKey: () => 'accountA',
    useCanvasQuery: (...a) => {
      specs.push(a);
      return {};
    },
  };
  const api = load('@/canvas/api/files'),
    seed = file();
  for (const l of langs) {
    view(l);
    api.useFile('f', { courseId: 'c', seed });
    const [key, , opts] = specs.at(-1);
    assert.deepEqual(key, ['files', 'file', 'f']);
    assert.equal(opts.placeholderData(), seed);
    // Retry policy now belongs to query.tsx; cache.check.cjs executes its
    // production defaults for auth, permission, network and server errors.
    assert.equal(opts.retry, undefined, 'file queries inherit the centralized retry policy');
  }
  assert.equal(
    calls.some((c) => ['read', 'navigation', 'player'].includes(c[0])),
    false,
  );
  await Promise.resolve();
  console.log(
    `file-viewer: ${Object.keys(cats[0]).length} keys; matrix, errors/cache, download/action props, source/auth, modal and same-instance route checks passed (${process.env.TZ ?? 'host'})`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
