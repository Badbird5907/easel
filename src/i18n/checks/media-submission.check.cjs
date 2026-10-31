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
const baseline = require('./media-submission.baseline.json');
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
  if (!old || !deps || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
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
  ...elements('ActivityIndicator Modal Pressable View'),
};
let service;
let serial = 0;
const store = new Map();
const mocks = {
  react: strict('react', react),
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': strict('native', native),
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
  'lucide-react-native': strict(
    'icons',
    elements(
      'Clapperboard FileAudio RefreshCw Camera FileText Image Mic ScanLine Video File FileArchive FileCode FileHeadphone FileImage FileSpreadsheet FileType FileVideoCamera Globe Presentation',
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
  '@/canvas/api/submissions': {
    isNativeSubmissionType: () => fail('submission type'),
    submissionFilesPath: (course, assignment) =>
      `/courses/${course}/assignments/${assignment}/submissions/self/files`,
    useMediaService: () => service,
  },
  '@/features/grades/calculate': {},
  '@/features/grades/format': {},
  '@/features/submissions/uploadStore': {
    uploadsFor: (slot) => store.get(slot) ?? [],
    addUploads: (...args) => {
      boundary('addUploads')(...args);
      store.set(args[0], [{ id: 'accepted-' + ++serial, file: args[2][0] }]);
    },
    removeUpload: (slot, id) => {
      boundary('removeUpload')(slot, id);
      store.set(
        slot,
        (store.get(slot) ?? []).filter((i) => i.id !== id),
      );
    },
  },
  '@/features/submissions/AudioRecorderSheet': { AudioRecorderSheet: 'Recorder' },
  '@/features/submissions/MediaPlayer': { MediaPlayer: 'Player' },
  '@/features/submissions/UploadList': { UploadList: 'Uploads' },
  '@/design': strict('design', {
    ...elements('Button Callout Icon IconTile ListGroup ListItem Text'),
    useTheme: () => ({ colors: { fgMuted: 'muted' } }),
    haptics: { warning: boundary('warning') },
  }),
};
const allowed = new Set([
  'features/submissions/MediaSubmission',
  'features/submissions/mediaPanelPresentation',
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
const {
  MediaPanel,
  mediaTarget,
  useMediaMode: readMode,
} = load('@/features/submissions/MediaSubmission');
const upload = load('@/features/files/upload');
const rules = load('@/features/submissions/rules');
const langs = ['en', 'fr', 'ar'];
const view = (locale) => {
  i18n.setAccountLocale('view', locale);
  return i18n.createTranslator(locale);
};
const assignment = () => ({
  id: 'a',
  courseId: 'c',
  allowedExtensions: [],
  submissionTypes: ['media_recording', 'online_upload'],
  allowedAttempts: null,
  locked: false,
  canSubmit: true,
  lockAt: null,
  submission: { id: 'sub', attempt: 1, extraAttempts: 0 },
});
const props = (extra = {}) => ({
  a: assignment(),
  slot: 'slotA',
  items: [],
  mode: 'kaltura',
  onRetryCheck: boundary('retry'),
  ...extra,
});
const file = Object.freeze({
  uri: 'synthetic://raw',
  name: 'العربية RAW.m4a',
  mimeType: 'audio/mp4',
  size: 42,
});
const canceled = { canceled: true, assets: null };
const quiet = (fn) => {
  const n = calls.length;
  const out = fn();
  assert.equal(calls.length, n);
  return out;
};
const one = (tree, type) => all(tree, type)[0]?.props;
const row = (h, index = 3) => all(h.render(), 'ListItem')[index].props.onPress;
const notice = (h) =>
  all(h.render(), 'Callout').find((n) => n.props.action?.accessibilityLabel)?.props;
const documents = (value) =>
  allow('documents', (args) => {
    equal(args, { type: ['audio/*', 'video/*'], copyToCacheDirectory: true, multiple: false });
    return value;
  });
const expectAdd = (p, raw = file, c = client) =>
  allow('addUploads', (slot, target, files) => {
    assert.equal(slot, p.slot);
    assert.equal(target.client, c);
    equal(target, mediaTarget(p.a, p.mode, c));
    assert.equal(files.length, 1);
    assert.equal(files[0], raw);
  });
const openRecorder = (h) => {
  row(h, 0)();
  return one(h.render(), 'Recorder');
};
const clear = () => {
  store.clear();
  resetSession();
  view('en');
};
(async () => {
  const catalogs = Object.fromEntries(langs.map((l) => [l, load('@/i18n/' + l)[l]]));
  const keys = [
    'checking',
    'unknownTitle',
    'unknownBody',
    'retry',
    'unavailableTitle',
    'unavailableBody',
    'fileTitle',
    'fileBody',
    'noticeTitle',
    'dismiss',
    'dismissLabel',
    'audioSubtitle',
    'videoSubtitle',
    'replace',
    'footer',
    'audio',
    'video',
    'chooseVideo',
    'library',
    'chooseFile',
    'files',
    'rejected',
    'pickerFailure',
    'settingsFailure',
    'permissionTitle',
    'permissionBody',
    'cameraUnavailable',
    'notNow',
    'settings',
  ].map((k) => 'mediaSubmission.' + k);
  for (const l of langs) {
    assert.equal(Object.keys(baseline.catalogs[l]).length, 1764);
    for (const [k, v] of Object.entries(baseline.catalogs[l])) equal(catalogs[l][k], v);
    equal(Object.keys(catalogs[l]).sort(), Object.keys(catalogs.en).sort());
    equal(
      Object.keys(catalogs[l])
        .filter((k) => k.startsWith('mediaSubmission.'))
        .sort(),
      keys.sort(),
    );
    for (const k of keys) {
      assert.ok(!Object.hasOwn(baseline.catalogs[l], k));
      assert.ok(Object.hasOwn(catalogs[l], k));
    }
    for (const k of Object.keys(catalogs[l]))
      equal(
        [...new Set(JSON.stringify(catalogs[l][k]).match(/\{\w+\}/g) ?? [])].sort(),
        [...new Set(JSON.stringify(catalogs.en[k]).match(/\{\w+\}/g) ?? [])].sort(),
      );
  }
  // Exact original helpers protect options, generated filenames and mode/target logic.
  const old = require('./audio-media.baseline.json').sources['MediaSubmission.tsx'];
  const source = fs.readFileSync(
    path.join(root, 'features/submissions/MediaSubmission.tsx'),
    'utf8',
  );
  const helpers = (s) =>
    s.slice(
      s.indexOf('export function useMediaMode'),
      s.indexOf('/** Record audio or video, or pick a video,'),
    );
  assert.equal(helpers(source), helpers(old));
  for (const mode of ['checking', 'unknown', 'unavailable', 'file', 'kaltura']) {
    clear();
    const p = props({ mode }),
      h = mount(MediaPanel, p);
    for (const l of langs) {
      const t = view(l),
        out = quiet(() => h.render());
      if (mode === 'checking')
        assert.equal(one(out, 'Text').children, t('mediaSubmission.checking'));
      else if (mode === 'unknown' || mode === 'unavailable') {
        assert.equal(
          one(out, 'Callout').title,
          t('mediaSubmission.' + (mode === 'unknown' ? 'unknownTitle' : 'unavailableTitle')),
        );
        assert.equal(
          one(out, 'Callout').children,
          t('mediaSubmission.' + (mode === 'unknown' ? 'unknownBody' : 'unavailableBody')),
        );
      } else {
        equal(
          all(out, 'ListItem').map((n) => n.props.title),
          ['audio', 'video', 'chooseVideo', 'chooseFile'].map((k) => t('mediaSubmission.' + k)),
        );
        equal(
          all(out, 'ListItem')
            .map((n) => n.props.subtitle)
            .filter(Boolean),
          ['library', 'files'].map((k) => t('mediaSubmission.' + k)),
        );
        assert.equal(one(out, 'ListGroup').footer, t('mediaSubmission.footer'));
        const rec = one(out, 'Recorder');
        assert.equal(rec.fileName, 'Recording');
        assert.equal(rec.attachLabel, t('audioRecorder.useRecording'));
        assert.equal(rec.purpose, t('audioRecorder.submissionPurpose'));
        if (mode === 'file') {
          assert.equal(one(out, 'Callout').title, t('mediaSubmission.fileTitle'));
          assert.equal(one(out, 'Callout').children, t('mediaSubmission.fileBody'));
        }
      }
    }
    h.unmount();
    equal(
      mediaTarget(p.a, mode, client),
      mode === 'kaltura'
        ? { client, media: { contextCode: 'course_c' } }
        : mode === 'file'
          ? { client, preflightPath: '/courses/c/assignments/a/submissions/self/files' }
          : null,
    );
  }
  for (const wants of [true, false])
    for (const state of ['pending', 'error', 'enabled', 'disabled'])
      for (const files of [true, false]) {
        service = {
          isPending: state === 'pending',
          isError: state === 'error',
          data: { enabled: state === 'enabled' },
          refetch: boundary('retry'),
        };
        const a = {
          ...assignment(),
          submissionTypes: [
            ...(wants ? ['media_recording'] : []),
            ...(files ? ['online_upload'] : []),
          ],
        };
        const m = readMode(a);
        assert.equal(
          m.mode,
          !wants
            ? 'unavailable'
            : state === 'pending'
              ? 'checking'
              : state === 'error'
                ? 'unknown'
                : state === 'enabled'
                  ? 'kaltura'
                  : files
                    ? 'file'
                    : 'unavailable',
        );
        allow('retry');
        m.retry();
      }
  // Same instance player props and recording survive locale-only and unrelated data refreshes.
  clear();
  let p = props(),
    h = mount(MediaPanel, p);
  const rec = openRecorder(h);
  for (const l of langs) {
    view(l);
    p = {
      ...p,
      a: {
        ...p.a,
        name: 'new title',
        allowedExtensions: [],
        submissionTypes: [...p.a.submissionTypes],
        submission: { ...p.a.submission, score: 50 },
      },
    };
    assert.equal(
      one(
        quiet(() => h.render(p)),
        'Recorder',
      ).visible,
      true,
    );
  }
  expectAdd(p);
  rec.onAttach(file);
  quiet(() => rec.onAttach(file));
  h.unmount();
  for (const raw of ['', 'RAW العربية.m4a', 'Audio recording']) {
    clear();
    const item = { id: 'old', file: { ...file, name: raw } };
    store.set('slotA', [item]);
    h = mount(MediaPanel, props({ items: [item] }));
    for (const l of langs) {
      const t = view(l),
        out = quiet(() => h.render());
      assert.equal(one(out, 'Player').title, raw);
      assert.equal(one(out, 'Player').url, file.uri);
      assert.equal(one(out, 'Player').subtitle, t('mediaSubmission.audioSubtitle'));
      assert.equal(one(out, 'Button').children, t('mediaSubmission.replace'));
    }
    h.unmount();
  }
  // Raw object acceptance, extension rejection notices retranslate without another haptic.
  for (const mode of ['kaltura', 'file'])
    for (const name of ['', 'RAW العربية.m4a', 'x.txt']) {
      clear();
      p = props({ mode, a: { ...assignment(), allowedExtensions: ['m4a', 'mp3'] } });
      h = mount(MediaPanel, p);
      const raw = { ...file, name },
        rec = openRecorder(h);
      if (mode === 'file' && !name.endsWith('.m4a')) allow('warning');
      else expectAdd(p, raw);
      rec.onAttach(raw);
      if (mode === 'file' && !name.endsWith('.m4a'))
        for (const l of langs) {
          const t = view(l);
          quiet(() => h.render());
          assert.equal(
            notice(h).children,
            t('mediaSubmission.rejected', {
              extensions: rules.extensionList(p.a.allowedExtensions, l),
              name,
            }),
          );
          assert.equal(notice(h).action.accessibilityLabel, t('mediaSubmission.dismissLabel'));
        }
      h.unmount();
    }
  // Native picker payloads/cancellation; cancellation releases synchronous claims.
  clear();
  p = props();
  h = mount(MediaPanel, p);
  let pending = deferred();
  documents(pending.promise);
  const pick = row(h);
  const job = pick();
  quiet(() => pick());
  quiet(() => row(h, 0)());
  pending.resolve(canceled);
  await job;
  documents(canceled);
  await pick();
  allow('photos', (args) => {
    equal(args, {
      mediaTypes: ['videos'],
      allowsMultipleSelection: false,
      preferredAssetRepresentationMode: 'compatible',
    });
    return canceled;
  });
  await row(h, 2)();
  allow('permission', Promise.resolve({ granted: true }));
  allow('camera', (args) => {
    equal(args, {
      mediaTypes: ['videos'],
      quality: 1,
      videoMaxDuration: 600,
      videoQuality: 'medium',
    });
    return canceled;
  });
  await row(h, 1)();
  h.unmount();
  // Real document helper preserves all returned metadata; generated names tested by source freeze.
  clear();
  p = props();
  h = mount(MediaPanel, p);
  documents({ canceled: false, assets: [file] });
  allow('addUploads', (s, t, f) => {
    assert.equal(s, p.slot);
    assert.equal(t.client, client);
    equal(f, [file]);
  });
  await row(h)();
  h.unmount();
  // Raw, empty, same-English errors, unknown tags and fallback are distinct from authored origins.
  for (const error of [
    new Error(''),
    new Error('Something went wrong while getting the recording. Try again.'),
    'العربية',
    {},
    new upload.PickerUnavailableError(''),
    new upload.PickerUnavailableError('native'),
    new upload.PickerUnavailableError('native', { origin: 'unknown' }),
    new upload.PickerUnavailableError('native', { origin: 'camera-unavailable' }),
  ]) {
    clear();
    h = mount(MediaPanel, props());
    documents(Promise.reject(error));
    await row(h)();
    const dismiss = notice(h).action.onPress;
    for (const l of langs) {
      const t = view(l);
      quiet(() => h.render());
      const expected =
        error.origin === 'camera-unavailable'
          ? t('mediaSubmission.cameraUnavailable')
          : typeof error === 'string'
            ? error
            : typeof error.message === 'string'
              ? error.message
              : t('mediaSubmission.pickerFailure');
      assert.equal(notice(h).children, expected);
    }
    documents(Promise.reject(new Error('new')));
    await row(h)();
    quiet(() => dismiss());
    assert.equal(notice(h).children, 'new');
    notice(h).action.onPress();
    assert.equal(notice(h), undefined);
    documents(canceled);
    await row(h)();
    h.unmount();
  }
  // Alerts capture the INVOCATION language even when rejection arrives in another locale.
  for (const origin of [undefined, 'unknown', 'camera-permission'])
    for (const detail of ['', 'native العربية', 'Camera access is off']) {
      clear();
      h = mount(MediaPanel, props());
      pending = deferred();
      documents(pending.promise);
      const job = row(h)();
      view('ar');
      quiet(() => h.render());
      let settings;
      allow('alert', (title, body, buttons) => {
        const t = i18n.createTranslator('en');
        assert.equal(title, t('mediaSubmission.permissionTitle'));
        assert.equal(
          body,
          origin === 'camera-permission' ? t('mediaSubmission.permissionBody') : detail,
        );
        equal(
          buttons.map((b) => b.text),
          [t('mediaSubmission.notNow'), t('mediaSubmission.settings')],
        );
        settings = buttons[1].onPress;
      });
      pending.reject(new upload.PickerPermissionError(detail, { origin }));
      await job;
      allow('settings', Promise.reject(new Error('')));
      await settings();
      assert.equal(notice(h).children, '');
      quiet(() => settings());
      h.unmount();
      quiet(() => settings());
    }
  // Every relevant committed context transition suppresses pending success AND rejection,
  // retained recorder/replace/retry/dismiss/Settings, including away-and-back lifetimes.
  const transitions = [
    (p) => {
      account = { id: 'other' };
      return p;
    },
    (p) => {
      client = clientB;
      return p;
    },
    (p) => ({ ...p, slot: 'slotB' }),
    (p) => ({ ...p, a: { ...p.a, id: 'b' } }),
    (p) => ({ ...p, a: { ...p.a, courseId: 'd' } }),
    (p) => ({ ...p, a: { ...p.a, submission: { ...p.a.submission, id: 'other' } } }),
    (p) => ({ ...p, a: { ...p.a, submission: { ...p.a.submission, attempt: 2 } } }),
    (p) => ({ ...p, a: { ...p.a, allowedExtensions: ['txt'] } }),
    (p) => ({ ...p, a: { ...p.a, submissionTypes: ['online_upload'] } }),
    (p) => ({ ...p, a: { ...p.a, locked: true } }),
    (p) => ({ ...p, a: { ...p.a, canSubmit: false } }),
    (p) => ({ ...p, a: { ...p.a, allowedAttempts: 1 } }),
    (p) => ({ ...p, a: { ...p.a, submission: { ...p.a.submission, extraAttempts: 2 } } }),
    (p) => ({ ...p, a: { ...p.a, lockAt: new Date(0) } }),
    (p) => ({ ...p, mode: 'file' }),
    (p) => ({ ...p, disabled: true }),
    () => null,
  ];
  for (const transition of transitions)
    for (const rejects of [false, true]) {
      clear();
      p = props();
      h = mount(MediaPanel, p);
      pending = deferred();
      documents(pending.promise);
      const retained = row(h),
        job = retained();
      const next = transition(p);
      if (next) h.render(next);
      else h.unmount();
      quiet(() => retained());
      pending[rejects ? 'reject' : 'resolve'](
        rejects ? new upload.PickerPermissionError('late') : { canceled: false, assets: [file] },
      );
      await job;
      assert.equal(store.size, 0);
      if (next) h.unmount();
    }
  for (const transition of transitions) {
    clear();
    p = props();
    h = mount(MediaPanel, p);
    const old = openRecorder(h);
    const next = transition(p);
    if (next) h.render(next);
    else h.unmount();
    quiet(() => old.onAttach(file));
    quiet(() => old.onClose());
    if (next) h.unmount();
    clear();
    p = props({ mode: 'unknown' });
    h = mount(MediaPanel, p);
    const retry = one(h.render(), 'Callout').action.onPress;
    const n = transition(p);
    if (n) h.render({ ...n, mode: n.mode === 'file' ? 'file' : n.mode });
    else h.unmount();
    quiet(() => retry());
    if (n) h.unmount();
  }
  // Replacement context can launch immediately; old finally must not unlock its claim.
  clear();
  p = props();
  h = mount(MediaPanel, p);
  pending = deferred();
  documents(pending.promise);
  const oldJob = row(h)();
  const oldP = p;
  p = { ...p, slot: 'new' };
  h.render(p);
  const newer = deferred();
  documents(newer.promise);
  const newerPick = row(h),
    newJob = newerPick();
  pending.resolve(canceled);
  await oldJob;
  quiet(() => newerPick());
  newer.resolve(canceled);
  await newJob;
  h.render(oldP);
  documents(canceled);
  await row(h)();
  h.unmount();
  // Disabled false->true->false does not resurrect picker or recorder work.
  for (const kind of ['picker', 'recorder']) {
    clear();
    p = props();
    h = mount(MediaPanel, p);
    let old, job;
    if (kind === 'picker') {
      pending = deferred();
      documents(pending.promise);
      job = row(h)();
    } else old = openRecorder(h);
    h.render({ ...p, disabled: true });
    h.render(p);
    if (old) quiet(() => old.onAttach(file));
    else {
      pending.resolve({ canceled: false, assets: [file] });
      await job;
    }
    assert.equal(store.size, 0);
    h.unmount();
  }
  // A pending selection cannot erase OR append to newer uploads, even without a render.
  clear();
  p = props();
  h = mount(MediaPanel, p);
  pending = deferred();
  documents(pending.promise);
  const staleJob = row(h)();
  const newerItem = { id: 'newer', file };
  store.set(p.slot, [newerItem]);
  pending.resolve({ canceled: false, assets: [file] });
  await staleJob;
  assert.equal(store.get(p.slot)[0], newerItem);
  h.unmount();
  clear();
  const oldItem = { id: 'old', file };
  store.set('slotA', [oldItem]);
  p = props({ items: [oldItem] });
  h = mount(MediaPanel, p);
  const replace = one(h.render(), 'Button').onPress;
  store.set(p.slot, [newerItem]);
  quiet(() => replace());
  assert.equal(store.get(p.slot)[0], newerItem);
  store.set(p.slot, [oldItem]);
  h.render({ ...p, disabled: true });
  quiet(() => replace());
  h.render(p);
  allow('removeUpload', (slot, id) => {
    assert.equal(slot, p.slot);
    assert.equal(id, 'old');
  });
  replace();
  quiet(() => replace());
  h.unmount();
  quiet(() => replace());
  // New item created synchronously by removal listener is preserved.
  clear();
  store.set('slotA', [oldItem]);
  h = mount(MediaPanel, props({ items: [oldItem] }));
  allow('removeUpload', () => store.set('slotA', [oldItem, newerItem]));
  one(h.render(), 'Button').onPress();
  equal(store.get('slotA'), [newerItem]);
  h.unmount();
  // Retry claim, latest callback and disabled/unmount guards.
  clear();
  p = props({ mode: 'unknown' });
  h = mount(MediaPanel, p);
  const retry = one(h.render(), 'Callout').action.onPress;
  allow('retry');
  retry();
  quiet(() => retry());
  await flush();
  allow('retry');
  retry();
  await flush();
  h.unmount();
  quiet(() => retry());
  // Retained notice, replacement and Settings callbacks are scoped to their commit.
  for (const transition of transitions) {
    clear();
    p = props();
    h = mount(MediaPanel, p);
    documents(Promise.reject(new Error('old notice')));
    await row(h)();
    const dismiss = notice(h).action.onPress;
    let next = transition(p);
    if (next) h.render(next);
    else h.unmount();
    quiet(() => dismiss());
    if (next) h.unmount();

    clear();
    p = props();
    h = mount(MediaPanel, p);
    let settings;
    documents(Promise.reject(new upload.PickerPermissionError('permission')));
    allow('alert', (_title, _body, buttons) => {
      settings = buttons[1].onPress;
    });
    await row(h)();
    next = transition(p);
    if (next) h.render(next);
    else h.unmount();
    quiet(() => settings());
    if (next) h.unmount();

    clear();
    p = props();
    h = mount(MediaPanel, p);
    documents(Promise.reject(new upload.PickerPermissionError('permission')));
    allow('alert', (_title, _body, buttons) => {
      settings = buttons[1].onPress;
    });
    await row(h)();
    const waiting = deferred();
    allow('settings', waiting.promise);
    const work = settings();
    next = transition(p);
    if (next) h.render(next);
    else h.unmount();
    waiting.reject(new Error('late settings'));
    await work;
    if (next) {
      assert.equal(notice(h), undefined);
      h.unmount();
    }

    clear();
    const item = { id: 'offered', file };
    store.set('slotA', [item]);
    p = props({ items: [item] });
    h = mount(MediaPanel, p);
    const replace = one(h.render(), 'Button').onPress;
    next = transition(p);
    if (next) h.render(next);
    else h.unmount();
    quiet(() => replace());
    assert.equal(store.get('slotA')[0], item);
    if (next) h.unmount();
  }
  // A new picker invalidates an old Alert callback, without reopening on locale changes.
  clear();
  p = props();
  h = mount(MediaPanel, p);
  let settings;
  const retainedPick = row(h);
  view('fr');
  quiet(() => h.render());
  documents(Promise.reject(new upload.PickerPermissionError('raw')));
  allow('alert', (title, _body, buttons) => {
    assert.equal(title, i18n.createTranslator('fr')('mediaSubmission.permissionTitle'));
    settings = buttons[1].onPress;
  });
  await retainedPick();
  documents(canceled);
  await retainedPick();
  quiet(() => settings());
  h.unmount();
  // Locale-only pending success uses the captured raw target, without refetch or file reads.
  for (const mode of ['file', 'kaltura']) {
    clear();
    p = props({ mode });
    h = mount(MediaPanel, p);
    const waiting = deferred();
    documents(waiting.promise);
    const work = row(h)();
    for (const l of langs) {
      view(l);
      quiet(() => h.render({ ...p, a: { ...p.a, name: 'unrelated' } }));
    }
    allow('addUploads', (slot, target, files) => {
      assert.equal(slot, p.slot);
      equal(target, mediaTarget(p.a, mode, clientA));
      assert.equal(target.client, clientA);
      equal(files, [file]);
    });
    waiting.resolve({ canceled: false, assets: [file] });
    await work;
    h.unmount();
  }
  // Recorder close frees the claim; obsolete close/attach cannot affect a fresh take.
  clear();
  p = props();
  h = mount(MediaPanel, p);
  const firstTake = openRecorder(h);
  firstTake.onClose();
  const secondTake = openRecorder(h);
  quiet(() => firstTake.onClose());
  quiet(() => firstTake.onAttach(file));
  assert.equal(one(h.render(), 'Recorder').visible, true);
  expectAdd(p);
  secondTake.onAttach(file);
  h.unmount();
  // Render-only values never replace committed context. No native/UI work at render.
  clear();
  p = props();
  h = mount(MediaPanel, p);
  h.render();
  const waiting = deferred();
  documents(waiting.promise);
  const work = row(h)();
  quiet(() => h.renderOnly({ ...p, slot: 'not-committed', disabled: true }));
  allow('addUploads', (slot, target, files) => {
    assert.equal(slot, p.slot);
    assert.equal(target.client, clientA);
    equal(files, [file]);
  });
  waiting.resolve({ canceled: false, assets: [file] });
  await work;
  h.unmount();
  equal(unexpected, []);
  for (const [name, q] of queues) assert.equal(q.length, 0, 'unconsumed ' + name);
  console.log(
    'media-submission checks passed: 1764 frozen entries + 29 keys; production panel/helper, synthetic boundaries; TZ=' +
      process.env.TZ,
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
