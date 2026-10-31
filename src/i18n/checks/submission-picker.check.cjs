const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
/** Production modules, fail-closed synthetic native/storage/query/router/picker/upload
 * boundaries. Hook effects commit after rendering; no React Compiler/native acceptance.
 * Already-started requests cannot be rolled back by these UI lifetime guards. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const baseline = require('./submission-picker.baseline.json');
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

const clientA = { id: 'clientA' },
  clientB = { id: 'clientB' };
let account = { id: 'accountA' },
  client = clientA;
const resetSession = () => {
  account = { id: 'accountA' };
  client = clientA;
};
const native = {
  Alert: { alert: boundary('alert') },
  Linking: { openSettings: boundary('settings') },
  ActionSheetIOS: { showActionSheetWithOptions: boundary('iosSheet') },
  Platform: { OS: 'android' },
  ...elements('Modal Pressable View'),
};
const mocks = {
  react: strict('react', react),
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': strict('native', native),
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
  'lucide-react-native': strict(
    'icons',
    elements(
      'Camera FileText Image Mic ScanLine Video File FileArchive FileCode FileHeadphone FileImage FileSpreadsheet FileType FileVideoCamera Globe Presentation',
    ),
  ),
  'expo-document-picker': strict('documents', { getDocumentAsync: boundary('documents') }),
  'expo-image-picker': strict('images', {
    requestCameraPermissionsAsync: boundary('permission'),
    launchCameraAsync: boundary('camera'),
    launchImageLibraryAsync: boundary('photos'),
    UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
    UIImagePickerControllerQualityType: { Medium: 'medium' },
  }),
  '@tanstack/react-query': { useQueryClient: () => fail('query') },
  '@/canvas/session': { useCanvas: () => ({ account, client }) },
  '@/canvas/query': { useAccountKey: () => fail('accountKey') },
  '@/canvas/client': { CanvasError: class extends Error {} },
  '@/canvas/uploads': strict('uploads', { uploadToCanvas: () => fail('uploadToCanvas') }),
  '@/canvas/api/submissions': { isNativeSubmissionType: () => fail('submission type') },
  '@/features/grades/calculate': {},
  '@/features/grades/format': {},
  '@/features/submissions/uploadStore': { addUploads: boundary('addUploads') },
  '@/design': strict('design', {
    ...elements('Button Icon ListGroup ListItem Text'),
    useTheme: () => ({ scheme: 'light' }),
    haptics: { warning: boundary('warning') },
  }),
};
const allowed = new Set([
  'features/submissions/useAddFiles',
  'features/submissions/pickerPresentation',
  'features/submissions/rules',
  'features/files/upload',
  'features/files/ActionSheet',
  'features/files/kinds',
  'features/course/format',
  'lib/dates',
  'i18n',
  'i18n/runtime',
  'i18n/en',
  'i18n/fr',
  'i18n/ar',
]);
function load(name, parent = path.join(root, 'entry.ts')) {
  if (isIntlPolyfills(name)) return intlPolyfills;
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
    Error,
    console,
    fetch: () => fail('fetch'),
    setTimeout: boundary('timer'),
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
const i18n = load('@/i18n/runtime');
const upload = load('@/features/files/upload');
const rules = load('@/features/submissions/rules');
const presentation = load('@/features/submissions/pickerPresentation');
const { useAddFiles } = load('@/features/submissions/useAddFiles');
const langs = ['en', 'fr', 'ar'];
const view = (locale) => {
  i18n.setAccountLocale('view', locale);
  return i18n.createTranslator(locale);
};
const props = (extra = {}) => ({ slot: 'slotA', preflightPath: '/raw/preflight', ...extra });
const file = Object.freeze({
  uri: 'synthetic://a',
  name: 'RAW العربية.JPEG',
  mimeType: 'image/jpeg',
  size: 42,
});
const rejected = Object.freeze({ ...file, name: 'Camera access is off.txt' });
const canceled = { canceled: true, assets: null };
const picked = (...assets) => ({ canceled: false, assets });
const quiet = (fn) => {
  const n = calls.length;
  const r = fn();
  assert.equal(calls.length, n);
  return r;
};
const assertQueues = () => {
  equal(unexpected, []);
  for (const [name, q] of queues) assert.equal(q.length, 0, 'unconsumed ' + name);
};
const request = (result) => result.sheet.props.children.props.request;
const option = (h, key = 'file') => request(h.render()).options.find((o) => o.key === key).onPress;
const open = (h) => {
  h.render().open();
  return request(h.render());
};
const expectAdd = (assets, p = props(), c = client) =>
  allow('addUploads', (slot, args, actual) => {
    assert.equal(slot, p.slot);
    assert.equal(args.client, c);
    equal(Object.keys(args).sort(), ['client', 'preflightPath']);
    assert.equal(args.preflightPath, p.preflightPath);
    equal(actual, assets);
    actual.forEach((item, i) => assert.equal(item, assets[i]));
  });
const documents = (result) =>
  allow('documents', (args) => {
    equal(args, { copyToCacheDirectory: true, multiple: true });
    return result;
  });
const failPicker = async (h, error) => {
  open(h);
  documents(Promise.reject(error));
  await option(h)();
};
(async () => {
  const catalogs = Object.fromEntries(langs.map((l) => [l, load('@/i18n/' + l)[l]]));
  const introducedKeys = [
    'title',
    'accepts',
    'file',
    'photos',
    'photo',
    'video',
    'audio',
    'scan',
    'rejectedOne',
    'rejectedMany',
    'onlyAccepts',
    'permissionTitle',
    'permissionBody',
    'notNow',
    'settings',
    'unavailableTitle',
    'unavailableBody',
    'errorTitle',
    'errorBody',
    'settingsTitle',
    'settingsBody',
  ].map((key) => `submissionPicker.${key}`);
  for (const l of langs) {
    assert.equal(Object.keys(baseline.catalogs[l]).length, 1705);
    assert.ok(Object.keys(catalogs[l]).length >= 1705 + introducedKeys.length);
    for (const key of introducedKeys) {
      assert.ok(!Object.hasOwn(baseline.catalogs[l], key), `${key} is additive`);
      assert.ok(Object.hasOwn(catalogs[l], key), `${l} retains ${key}`);
    }
    for (const [key, value] of Object.entries(baseline.catalogs[l])) equal(catalogs[l][key], value);
    equal(Object.keys(catalogs[l]).sort(), Object.keys(catalogs.en).sort());
    for (const key of Object.keys(catalogs[l])) {
      equal(
        [...new Set(JSON.stringify(catalogs[l][key]).match(/\{\w+\}/g) ?? [])].sort(),
        [...new Set(JSON.stringify(catalogs.en[key]).match(/\{\w+\}/g) ?? [])].sort(),
      );
    }
  }
  // Frozen full sources: allow exactly the specified additive interfaces, no filename/options/job changes.
  let original = fs.readFileSync(path.join(root, 'features/files/upload.ts'), 'utf8');
  for (const [name, origin] of [
    ['PickerPermissionError', 'camera-permission'],
    ['PickerUnavailableError', 'camera-unavailable'],
  ]) {
    const addition = `export class ${name} extends Error {\n  constructor(message?: string, options?: ErrorOptions & { origin?: '${origin}' }) {\n    super(message, options);\n    this.origin = options?.origin;\n  }\n\n  readonly origin?: '${origin}';\n}`;
    assert.ok(original.includes(addition));
    original = original.replace(addition, `export class ${name} extends Error {}`);
    assert.equal(original.split(`, { origin: '${origin}' })`).length, 2);
    original = original.replace(`, { origin: '${origin}' })`, ')');
  }
  assert.equal(original, baseline.sources['features/files/upload.ts']);
  const rulesSource = fs.readFileSync(path.join(root, 'features/submissions/rules.ts'), 'utf8');
  assert.equal(
    rulesSource
      .replace(
        `/** Optional presentation only. Omitted callbacks retain the exact legacy English path. */
export type RulePresentation = {
  locked: () => string;
  attempts: (allowed: number) => string;
  closed: (date: Date, now: Date) => string;
  notAccepting: () => string;
  attempt: (next: number, allowed: number, last: boolean) => string;
};

`,
        '',
      )
      .replace('now = new Date(), presentation?: RulePresentation)', 'now = new Date())')
      .replace(
        "a.lockExplanation ?? (presentation ? presentation.locked() : 'This assignment is locked.')",
        "a.lockExplanation ?? 'This assignment is locked.'",
      )
      .replace('presentation ? presentation.attempts(allowed) : ', '')
      .replace('presentation ? presentation.closed(a.lockAt, now) : ', '')
      .replace('presentation ? presentation.notAccepting() : ', '')
      .replace(
        'attemptNote(a: Assignment, presentation?: RulePresentation)',
        'attemptNote(a: Assignment)',
      )
      .replace('presentation ? presentation.attempt(next, allowed, left === 0) : ', '')
      .replace(
        `extensionList(extensions: string[], locale?: string): string {\n  if (locale !== undefined)\n    return new Intl.ListFormat(locale, { style: 'long', type: 'disjunction' }).format(\n      extensions.map((e) => e.toUpperCase()),\n    );`,
        'extensionList(extensions: string[]): string {',
      ),
    baseline.sources['features/submissions/rules.ts'],
  );
  assert.equal(
    fs.readFileSync(path.join(root, 'i18n/runtime.ts'), 'utf8'),
    baseline.sources['i18n/runtime.ts'],
  );
  let sheetSource = fs.readFileSync(path.join(root, 'features/files/ActionSheet.tsx'), 'utf8');
  // Normalize only the authorized optional dismissal signal; the executable
  // platform cases below verify its ordering while the prior source freeze remains.
  sheetSource = sheetSource
    .replace('  /** Selection keeps its deferred handoff; cancellation has no pending action. */\n  onClose?: (selected: boolean) => void;\n', '')
    .replace('          (index) => {\n            const option = next.options[index];\n            next.onClose?.(!!option);\n            return option?.onPress();\n          },', '          (index) => next.options[index]?.onPress(),')
    .replace('    request?.onClose?.(true);\n', '')
    .replace('  const close = () => {\n    request?.onClose?.(false);\n    setRequest(null);\n  };\n\n', '')
    .replace('onRequestClose={close}', 'onRequestClose={() => setRequest(null)}')
    .replace('onClose={close}', 'onClose={() => setRequest(null)}');
  sheetSource = sheetSource
    .replace('(t: Translate, locale: string)', '(t: Translate)')
    .replace(
      'request: SheetRequest, t: Translate, locale: string',
      'request: SheetRequest, t: Translate',
    )
    .replace('request.presentation?.(t, locale)', 'request.presentation?.(t)')
    .replace('const { t, locale } = useTranslation();', 'const { t } = useTranslation();')
    .replace('present(next, t, locale)', 'present(next, t)')
    .replace('[scheme, t, locale]', '[scheme, t]')
    .replace('present(request, t, locale)', 'present(request, t)');
  assert.equal(sheetSource, baseline.sources['features/files/ActionSheet.tsx']);
  // Omitted-locale semantics, raw spelling, order and duplicate preservation.
  for (const list of [
    [],
    ['pdf'],
    ['.JpG', 'jpeg'],
    ['a', 'b', 'c'],
    ['pdf', 'pdf', 'DOCX', ''],
    [' and ', 'x,y'],
  ]) {
    const upper = list.map((e) => e.toUpperCase());
    const legacy =
      upper.length < 2
        ? (upper[0] ?? '')
        : upper.length === 2
          ? upper.join(' and ')
          : upper.slice(0, -1).join(', ') + ', and ' + upper.at(-1);
    assert.equal(
      rules.extensionList(list),
      legacy.replace(/, and /, ', or ').replace(/ and /, ' or '),
    );
    for (const l of langs)
      assert.equal(
        rules.extensionList(list, l),
        new Intl.ListFormat(l, { style: 'long', type: 'disjunction' }).format(upper),
      );
  }
  for (const ext of ['jpg', 'JPEG', '.JpG', '.jpeg']) {
    const result = rules.checkExtensions([file, rejected, { ...file, name: 'other.jpg' }], [ext]);
    equal(
      result.accepted.map((f) => f.name),
      [file.name, 'other.jpg'],
    );
    equal(result.rejected, [rejected]);
    assert.equal(result.accepted[0], file);
    assert.equal(rules.acceptsExtension([ext], 'jpg'), true);
  }
  assert.equal(rules.checkExtensions([file], []).accepted[0], file);
  // Error constructor behavior, legacy cause, defaults and unknown tags; no name override.
  for (const C of [upload.PickerPermissionError, upload.PickerUnavailableError]) {
    for (const message of [undefined, '', 'RAW native', 'Camera access is off']) {
      const cause = { raw: true };
      const e = new C(message, { cause });
      assert.ok(e instanceof C && e instanceof Error);
      assert.equal(e.name, 'Error');
      assert.equal(e.message, message ?? '');
      assert.equal(e.cause, cause);
      assert.equal(e.origin, undefined);
      assert.equal(Object.hasOwn(new C(message), 'cause'), false);
      assert.equal(new C(message, { origin: 'unknown' }).origin, 'unknown');
    }
  }
  // All combinations of image/PDF availability, video/audio/scan switches.
  for (const extensions of [[], ['jpg'], ['pdf'], ['jpg', 'pdf'], ['txt'], ['.JPEG']])
    for (const video of [false, true])
      for (const audio of [false, true])
        for (const scan of [false, true]) {
          const h = mount(
            useAddFiles,
            props({
              allowedExtensions: extensions,
              allowVideo: video,
              onRecordAudio: audio ? boundary('audio') : undefined,
              onScan: scan ? boundary('scan') : undefined,
            }),
          );
          const r = open(h);
          const expected = [
            'file',
            ...(!extensions.length || rules.acceptsExtension(extensions, 'jpg')
              ? ['photos', 'photo']
              : []),
            ...(video ? ['video'] : []),
            ...(audio ? ['audio'] : []),
            ...(scan && (!extensions.length || rules.acceptsExtension(extensions, 'pdf'))
              ? ['scan']
              : []),
          ];
          equal(
            r.options.map((o) => o.key),
            expected,
          );
          const callbacks = r.options.map((o) => o.onPress),
            icons = r.options.map((o) => o.icon);
          for (const l of langs) {
            const t = view(l),
              out = quiet(() => h.render()),
              live = request(out);
            assert.equal(live.title, t('submissionPicker.title'));
            assert.equal(
              live.message,
              extensions.length
                ? t('submissionPicker.accepts', { extensions: rules.extensionList(extensions, l) })
                : undefined,
            );
            equal(
              live.options.map((o) => o.key),
              expected,
            );
            live.options.forEach((o, i) => {
              assert.equal(o.onPress, callbacks[i]);
              assert.equal(o.icon, icons[i]);
              assert.equal(o.label, t(presentation.pickerLabels[o.key]));
            });
          }
          h.unmount();
        }
  // Production optional dismissal notification preserves selection ordering and
  // old no-callback consumers. All native sheets/timers remain synthetic.
  const { useActionSheet } = load('@/features/files/ActionSheet');
  for (const platform of ['ios', 'android']) for (const action of ['selected', 'cancel', 'back']) {
    native.Platform.OS = platform;
    const events = [];
    let nativeChoice, delayed;
    if (platform === 'ios') allow('iosSheet', (_spec, choose) => { nativeChoice = choose; });
    const sheetHook = mount(useActionSheet);
    sheetHook.render().show({
      options: [{ label: 'Raw option', onPress: () => events.push(['action']) }],
      onClose: (selected) => events.push(['close', selected]),
    });
    const displayed = sheetHook.render();
    if (platform === 'ios') {
      nativeChoice(action === 'selected' ? 0 : 1);
      equal(events, action === 'selected' ? [['close', true], ['action']] : [['close', false]]);
    } else if (action === 'selected') {
      allow('timer', (fn, delay) => { assert.equal(delay, 250); events.push(['timer']); delayed = fn; });
      const content = displayed.sheet.props.children.props;
      content.onChoose(content.request.options[0]);
      equal(events, [['close', true], ['timer']]);
      assert.equal(sheetHook.render().sheet.props.visible, false);
      delayed();
      equal(events, [['close', true], ['timer'], ['action']]);
    } else {
      if (action === 'back') displayed.sheet.props.onRequestClose();
      else displayed.sheet.props.children.props.onClose();
      equal(events, [['close', false]]);
      assert.equal(sheetHook.render().sheet.props.visible, false);
    }
    sheetHook.unmount();
  }
  native.Platform.OS = 'android';
  // Android actual delayed choose callback, same stable keys; iOS invocation snapshot.
  const android = mount(useAddFiles, props());
  open(android);
  const androidSheet = request(android.render());
  const rendered = mount(
    android.render().sheet.props.children.type,
    android.render().sheet.props.children.props,
  );
  equal(
    all(rendered.render(), 'ListItem').map((n) => n.key),
    androidSheet.options.map((o) => o.key),
  );
  allow('timer', (fn, delay) => {
    assert.equal(delay, 250);
    assert.equal(fn, androidSheet.options[0].onPress);
  });
  all(rendered.render(), 'ListItem')[0].props.onPress();
  assert.equal(android.render().sheet.props.visible, false);
  rendered.unmount();
  android.unmount();
  native.Platform.OS = 'ios';
  view('en');
  let ios;
  allow('iosSheet', (spec, choose) => {
    ios = { spec, choose };
  });
  const ih = mount(useAddFiles, props({ allowedExtensions: ['pdf', 'txt'] }));
  ih.render().open();
  const frozen = plain(ios.spec);
  for (const l of ['fr', 'ar']) {
    view(l);
    quiet(() => ih.render());
    equal(ios.spec, frozen);
  }
  documents(canceled);
  ios.choose(0);
  await flush();
  ih.unmount();
  native.Platform.OS = 'android';
  // A retained open callback in the same context snapshots the invocation locale on iOS.
  native.Platform.OS = 'ios';
  view('en');
  const retainedIOS = mount(useAddFiles, props());
  const retainedOpen = retainedIOS.render().open;
  view('ar');
  quiet(() => retainedIOS.render());
  allow('iosSheet', (spec) => {
    assert.equal(spec.title, i18n.createTranslator('ar')('submissionPicker.title'));
  });
  retainedOpen();
  retainedIOS.unmount();
  native.Platform.OS = 'android';
  // Direct add: identity/order/all fields/payload; live rejected notices and plural categories.
  const p = props({ allowedExtensions: ['jpg', 'pdf'] });
  const h = mount(useAddFiles, p);
  h.render();
  const pdf = Object.freeze({ ...file, name: 'a.pdf', extra: 'raw' });
  allow('warning');
  expectAdd([file, pdf], p);
  h.render().add([file, rejected, pdf]);
  for (const l of langs) {
    const t = view(l),
      n = quiet(() => h.render()).notice;
    assert.equal(n.title, t('submissionPicker.rejectedOne', { name: rejected.name }));
    assert.equal(
      n.body,
      t('submissionPicker.onlyAccepts', {
        extensions: rules.extensionList(p.allowedExtensions, l),
      }),
    );
    assert.equal(n.tone, 'warning');
  }
  for (const count of [2, 3, 11, 100, 102]) {
    allow('warning');
    h.render().add(Array(count).fill(rejected));
    for (const l of langs) {
      const t = view(l);
      assert.equal(
        quiet(() => h.render()).notice.title,
        t('submissionPicker.rejectedMany', { count }),
      );
    }
  }
  const keep = h.render().notice;
  h.render().add([]);
  equal(h.render().notice, keep);
  expectAdd([file], p);
  h.render().add([file]);
  assert.equal(h.render().notice, null);
  h.unmount();
  // Duplicate callbacks and locale/array/function-identity-only renders retain claims.
  const stable = mount(
    useAddFiles,
    props({ onScan: boundary('scan'), onRecordAudio: boundary('audio') }),
  );
  let r = open(stable),
    cb = r.options[0].onPress,
    job = deferred();
  documents(job.promise);
  const pending = cb();
  await quiet(() => cb());
  quiet(() => stable.render().open());
  quiet(() => r.options.find((o) => o.key === 'scan').onPress());
  quiet(() => r.options.find((o) => o.key === 'audio').onPress());
  for (const l of langs) {
    view(l);
    quiet(() =>
      stable.render(
        props({
          allowedExtensions: [],
          onScan: () => fail('old scan'),
          onRecordAudio: () => fail('old audio'),
        }),
      ),
    );
    await quiet(() => cb());
  }
  job.resolve(canceled);
  await pending;
  documents(canceled);
  await cb();
  // Retained extras use current committed callbacks without invalidating equivalent context.
  stable.render(props({ onScan: boundary('newScan'), onRecordAudio: boundary('newAudio') }));
  allow('newScan');
  r.options.find((o) => o.key === 'scan').onPress();
  allow('newAudio');
  r.options.find((o) => o.key === 'audio').onPress();
  stable.unmount();
  // Pending selection across every context transition and completion kind, including old/new isolation.
  let transitions = 0;
  for (const change of [
    'account',
    'client',
    'slot',
    'preflight',
    'extensions',
    'video',
    'audio',
    'scan',
    'unmount',
  ])
    for (const outcome of ['success', 'cancel', 'permission', 'unavailable', 'error']) {
      resetSession();
      view('en');
      const before = props({ onScan: boundary('scan'), onRecordAudio: boundary('audio') });
      const h = mount(useAddFiles, before),
        old = h.render();
      const r = open(h),
        cb = r.options[0].onPress;
      const job = deferred();
      documents(job.promise);
      const work = cb();
      const next = { ...before };
      if (change === 'account') account = { id: 'accountB' };
      if (change === 'client') client = clientB;
      if (change === 'slot') next.slot = 'slotB';
      if (change === 'preflight') next.preflightPath = '/new';
      if (change === 'extensions') next.allowedExtensions = ['txt'];
      if (change === 'video') next.allowVideo = true;
      if (change === 'audio') next.onRecordAudio = undefined;
      if (change === 'scan') next.onScan = undefined;
      if (change === 'unmount') h.unmount();
      else h.render(next);
      quiet(() => old.open());
      quiet(() => old.add([file, rejected]));
      quiet(() => old.dismiss());
      for (const o of r.options) await quiet(() => o.onPress());
      let newer, newJob, newCb;
      if (change !== 'unmount') {
        open(h);
        newCb = option(h);
        newJob = deferred();
        documents(newJob.promise);
        newer = newCb();
      }
      if (outcome === 'success') job.resolve(picked(file));
      else if (outcome === 'cancel') job.resolve(canceled);
      else
        job.reject(
          outcome === 'permission'
            ? new upload.PickerPermissionError('raw')
            : outcome === 'unavailable'
              ? new upload.PickerUnavailableError('raw')
              : Error('raw'),
        );
      await work;
      assertQueues();
      if (newer) {
        await quiet(() => newCb());
        assert.equal(h.render().notice, null);
        newJob.resolve(canceled);
        await newer;
        documents(canceled);
        await newCb();
        h.unmount();
      }
      transitions++;
    }
  resetSession();
  // Permission Alert is scoped to operation-start translator; persistent errors relabel, details don't.
  for (const C of [upload.PickerPermissionError, upload.PickerUnavailableError, Error])
    for (const origin of [
      undefined,
      'unknown',
      C === upload.PickerPermissionError ? 'camera-permission' : 'camera-unavailable',
    ])
      for (const detail of [
        '',
        'RAW server العربية',
        'This device doesn’t have a camera. Choose a photo or file instead.',
        'Easel can’t use the camera. Turn on camera access for Easel in Settings.',
      ]) {
        view('en');
        const h = mount(useAddFiles, props());
        open(h);
        const job = deferred();
        documents(job.promise);
        const work = option(h)();
        view('fr');
        quiet(() => h.render());
        let alert;
        if (C === upload.PickerPermissionError)
          allow('alert', (...args) => {
            alert = args;
          });
        job.reject(new C(detail, { origin }));
        await work;
        if (alert) {
          const t = i18n.createTranslator('en');
          assert.equal(alert[0], t('submissionPicker.permissionTitle'));
          assert.equal(
            alert[1],
            origin === 'camera-permission' ? t('submissionPicker.permissionBody') : detail,
          );
          equal(
            alert[2].map((b) => b.text),
            [t('submissionPicker.notNow'), t('submissionPicker.settings')],
          );
        } else
          for (const l of langs) {
            const t = view(l),
              n = quiet(() => h.render()).notice;
            assert.equal(
              n.title,
              t(
                C === upload.PickerUnavailableError
                  ? 'submissionPicker.unavailableTitle'
                  : 'submissionPicker.errorTitle',
              ),
            );
            assert.equal(
              n.body,
              C === upload.PickerUnavailableError && origin === 'camera-unavailable'
                ? t('submissionPicker.unavailableBody')
                : detail,
            );
          }
        h.unmount();
        if (alert) await quiet(() => alert[2][1].onPress());
      }
  for (const raw of [null, {}, 'raw thrown string', '', { message: '' }, { message: 'custom' }]) {
    const h = mount(useAddFiles, props());
    await failPicker(h, raw);
    for (const l of langs) {
      const t = view(l);
      assert.equal(
        h.render().notice.body,
        presentation.pickerErrorDetail(raw) ?? t('submissionPicker.errorBody'),
      );
    }
    h.render().dismiss();
    assert.equal(h.render().notice, null);
    documents(canceled);
    await option(h)();
    h.unmount();
  }
  // Settings rejection is caught, relabels locally, and stale outcomes/actions are inert.
  for (const change of [
    'none',
    'account',
    'client',
    'slot',
    'preflight',
    'extensions',
    'video',
    'audio',
    'scan',
    'unmount',
    'newPicker',
  ]) {
    resetSession();
    view('en');
    const p = props({ onScan: () => {}, onRecordAudio: () => {} }),
      h = mount(useAddFiles, p);
    let alert;
    allow('alert', (...args) => {
      alert = args;
    });
    await failPicker(h, new upload.PickerPermissionError('raw'));
    const settings = alert[2][1].onPress,
      job = deferred();
    allow('settings', () => job.promise);
    const work = settings();
    const next = { ...p };
    if (change === 'account') account = { id: 'accountB' };
    if (change === 'client') client = clientB;
    if (change === 'slot') next.slot = 'other';
    if (change === 'preflight') next.preflightPath = '/other';
    if (change === 'extensions') next.allowedExtensions = ['pdf'];
    if (change === 'video') next.allowVideo = true;
    if (change === 'audio') next.onRecordAudio = undefined;
    if (change === 'scan') next.onScan = undefined;
    if (change === 'unmount') h.unmount();
    else h.render(next);
    if (change === 'newPicker') {
      open(h);
      documents(canceled);
      await option(h)();
    }
    job.reject({ message: '' });
    await work;
    if (change === 'none') {
      for (const l of langs) {
        const t = view(l);
        assert.equal(h.render().notice.title, t('submissionPicker.settingsTitle'));
        assert.equal(h.render().notice.body, '');
      }
    } else {
      await quiet(() => settings());
      if (change !== 'unmount') assert.equal(h.render().notice, null);
    }
    if (change !== 'unmount') h.unmount();
  }
  resetSession();
  // Successful pending result survives locale changes and equivalent input identities.
  resetSession();
  view('en');
  const acceptedProps = props({ allowedExtensions: ['jpg'], onScan: () => {} });
  const successHook = mount(useAddFiles, acceptedProps);
  open(successHook);
  const successJob = deferred();
  documents(successJob.promise);
  const success = option(successHook)();
  view('ar');
  quiet(() =>
    successHook.render({ ...acceptedProps, allowedExtensions: ['jpg'], onScan: () => {} }),
  );
  allow('warning');
  allow('addUploads', (slot, args, files) => {
    assert.equal(slot, acceptedProps.slot);
    assert.equal(args.client, clientA);
    assert.equal(args.preflightPath, acceptedProps.preflightPath);
    equal(files, [file]);
  });
  successJob.resolve(picked(file, rejected));
  await success;
  assert.equal(
    successHook.render().notice.title,
    i18n.createTranslator('ar')('submissionPicker.rejectedOne', { name: rejected.name }),
  );
  // Cancel doesn't erase an existing notice; successful retry does.
  documents(canceled);
  await option(successHook)();
  assert.ok(successHook.render().notice);
  documents(picked(file));
  allow('addUploads');
  await option(successHook)();
  assert.equal(successHook.render().notice, null);
  successHook.unmount();
  // Settings non-message rejection uses authored fallback; native resolution has no side effects.
  for (const outcome of ['resolve', 'reject']) {
    const h = mount(useAddFiles, props());
    let alert;
    allow('alert', (...args) => {
      alert = args;
    });
    await failPicker(h, new upload.PickerPermissionError('raw'));
    allow('settings', () => (outcome === 'resolve' ? Promise.resolve() : Promise.reject(null)));
    await alert[2][1].onPress();
    for (const l of langs) {
      const t = view(l),
        n = quiet(() => h.render()).notice;
      if (outcome === 'resolve') assert.equal(n, null);
      else assert.equal(n.body, t('submissionPicker.settingsBody'));
    }
    h.unmount();
  }
  // Real production picker option and asset mapping paths, synthetic native returns only.
  allow('documents', (args) => {
    equal(args, { copyToCacheDirectory: true, multiple: false });
    return picked({ uri: 'raw', name: '', size: 0, mimeType: '' });
  });
  equal(await upload.pickDocuments({ multiple: false }), [
    { uri: 'raw', name: '', size: 0, mimeType: '' },
  ]);
  allow('documents', picked({ uri: 'raw', name: 'x' }));
  equal(await upload.pickDocuments(), [{ uri: 'raw', name: 'x', size: null, mimeType: null }]);
  for (const multiple of [true, false])
    for (const videos of [true, false]) {
      allow('photos', (args) => {
        equal(args, {
          mediaTypes: videos ? ['images', 'videos'] : ['images'],
          allowsMultipleSelection: multiple,
          selectionLimit: multiple ? 20 : 1,
          orderedSelection: true,
          quality: 0.85,
          preferredAssetRepresentationMode: 'compatible',
        });
        return picked(
          { uri: 'raw1', fileName: 'keep.jpeg', mimeType: 'image/jpeg', fileSize: 0 },
          { uri: 'raw2', fileName: 'raw.png', mimeType: 'image/heic', fileSize: 12 },
          { uri: 'raw3', fileName: 'v.mov', type: 'video' },
          { uri: 'raw4', fileName: 'X.RAW', mimeType: 'application/custom' },
        );
      });
      equal(await upload.pickPhotos({ multiple, videos }), [
        { uri: 'raw1', name: 'keep.jpeg', mimeType: 'image/jpeg', size: 0 },
        { uri: 'raw2', name: 'raw.heic', mimeType: 'image/heic', size: 12 },
        { uri: 'raw3', name: 'v.mp4', mimeType: 'video/mp4', size: null },
        { uri: 'raw4', name: 'X.RAW', mimeType: 'application/custom', size: null },
      ]);
    }
  const now = new Date('2026-10-29T15:42:07Z');
  const pad = (n) => String(n).padStart(2, '0');
  assert.equal(
    upload.timestampName('Photo', 'jpg', now),
    `Photo ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(now)} at ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}.jpg`,
  );
  for (const [method, args, options] of [
    ['takePhoto', undefined, { mediaTypes: ['images'], quality: 0.85 }],
    [
      'recordVideo',
      undefined,
      { mediaTypes: ['videos'], videoMaxDuration: 600, videoQuality: 'medium' },
    ],
    [
      'recordVideo',
      { maxSeconds: 20 },
      { mediaTypes: ['videos'], videoMaxDuration: 20, videoQuality: 'medium' },
    ],
  ]) {
    for (const response of [
      canceled,
      picked(),
      picked({ uri: 'cameraRaw', fileName: 'raw.jpg', mimeType: 'image/jpeg' }),
    ]) {
      allow('permission', { granted: true });
      allow('camera', (opts) => {
        equal(opts, options);
        return response;
      });
      equal(
        await upload[method](args),
        response.assets?.length
          ? { uri: 'cameraRaw', name: 'raw.jpg', size: null, mimeType: 'image/jpeg' }
          : null,
      );
    }
    allow('permission', { granted: false });
    await assert.rejects(
      upload[method](args),
      (e) =>
        e instanceof upload.PickerPermissionError &&
        e.origin === 'camera-permission' &&
        e.message === 'Easel can’t use the camera. Turn on camera access for Easel in Settings.',
    );
    allow('permission', { granted: true });
    allow('camera', () => Promise.reject(Error('simulator')));
    await assert.rejects(
      upload[method](args),
      (e) =>
        e instanceof upload.PickerUnavailableError &&
        e.origin === 'camera-unavailable' &&
        e.message === 'This device doesn’t have a camera. Choose a photo or file instead.',
    );
    const raw = Error('custom');
    allow('permission', { granted: true });
    allow('camera', () => Promise.reject(raw));
    await assert.rejects(upload[method](args), (e) => e === raw);
  }
  // Hook routes each included picker to its unchanged native options and uploads mapped output.
  for (const key of ['file', 'photos', 'photo', 'video']) {
    const h = mount(useAddFiles, props({ allowVideo: true }));
    open(h);
    if (key === 'file') documents(picked(file));
    else if (key === 'photos')
      allow('photos', (a) => {
        assert.equal(a.mediaTypes[1], 'videos');
        return canceled;
      });
    else {
      allow('permission', { granted: true });
      allow('camera', (a) => {
        equal(a.mediaTypes, [key === 'video' ? 'videos' : 'images']);
        return canceled;
      });
    }
    if (key === 'file')
      allow('addUploads', (slot, args, files) => {
        equal(files, [file]);
        assert.equal(slot, 'slotA');
        assert.equal(args.client, clientA);
      });
    await option(h, key)();
    h.unmount();
  }
  assertQueues();
  console.log(
    `submission-picker: ${Object.keys(catalogs.en).length} keys; 1705 full values preserved per locale; ${transitions} pending context cases, native snapshots/live presentation/raw origins/options/claims passed (${process.env.TZ ?? 'host'}; synthetic boundaries only)`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
