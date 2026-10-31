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
const baseline = require('./audio-media.baseline.json');
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
  for (let i = 0; i < 30; i++) await Promise.resolve();
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
const timers = new Map();
let timerId = 0;
const setIntervalMock = (fn, ms) => {
  boundary('timer.start')(ms);
  timers.set(++timerId, fn);
  return timerId;
};
const clearIntervalMock = (id) => {
  boundary('timer.clear')(id);
  assert.ok(timers.delete(id));
};
const account = { host: 'school.invalid:444' },
  client = { authHeaders: { Authorization: 'synthetic' } };
let nativeRecorder, audioStatus;
// Approximate Expo's microtask disposal; this does not execute Expo/React itself.
function ownedHook(name, factory, deps) {
  const value = react.useMemo(factory, deps);
  react.useEffect(
    () => () => {
      Promise.resolve().then(() => boundary(name + '.release')(value));
    },
    [value],
  );
  return value;
}
const mocks = {
  react: strict('react', react),
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': strict('native', {
    ...elements('View Pressable ActivityIndicator'),
    AccessibilityInfo: { announceForAccessibility: boundary('announce') },
    Linking: { openSettings: boundary('settings') },
    Alert: strict('Alert', {}),
  }),
  'lucide-react-native': strict(
    'icons',
    elements('Mic RotateCcw AudioLines Pause Play Clapperboard FileAudio RefreshCw Video'),
  ),
  'expo-audio': strict('audio', {
    RecordingPresets: { HIGH_QUALITY: { preset: 'HIGH_QUALITY' } },
    requestRecordingPermissionsAsync: boundary('permission'),
    setAudioModeAsync: boundary('mode'),
    useAudioRecorder: (options) =>
      ownedHook(
        'recorder',
        () => {
          boundary('recorder.setup')(options);
          return nativeRecorder;
        },
        [JSON.stringify(options)],
      ),
    useAudioPlayer: (source, options) =>
      ownedHook('audio', () => boundary('audio.setup')(source, options), [source]),
    useAudioPlayerStatus: () => audioStatus,
  }),
  'expo-video': strict('video', {
    VideoView: 'VideoView',
    useVideoPlayer: (source, setup) =>
      ownedHook(
        'video',
        () => {
          const p = boundary('video.setup')(source);
          setup(p);
          return p;
        },
        [source],
      ),
  }),
  'expo-file-system': strict('filesystem', {
    File: function (uri) {
      return boundary('file')(uri);
    },
  }),
  'expo-document-picker': strict('document-picker', {}),
  'expo-image-picker': strict('image-picker', {}),
  '@/canvas/session': { useCanvas: () => ({ account, client }) },
  '@/canvas/api/submissions': {
    submissionFilesPath: boundary('submission.path'),
    useMediaService: boundary('service'),
  },
  '@/features/files/upload': { timestampName: boundary('name') },
  '@/features/files/kinds': strict('kinds', {}),
  '@/features/submissions/rules': strict('rules', {}),
  '@/features/submissions/UploadList': { UploadList: 'UploadList' },
  '@/features/submissions/uploadStore': strict('uploadStore', {}),
  '@/design': strict('design', {
    ...elements('Button Callout Icon Sheet Text IconButton IconTile ListGroup ListItem'),
    useTheme: () => ({ colors: { danger: 'danger', borderStrong: 'border' } }),
    haptics: { light: boundary('haptic.light'), success: boundary('haptic.success') },
  }),
};
const allowed = new Set([
  'features/submissions/AudioRecorderSheet',
  'features/submissions/MediaPlayer',
  'features/submissions/MediaSubmission',
  'features/submissions/mediaPanelPresentation',
  'features/submissions/recorderLifetime',
  'features/submissions/mediaPresentation',
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
  new vm.Script(js, { filename: file }).runInNewContext({
    module,
    exports: module.exports,
    require: (n) => load(n, file),
    Intl,
    Date,
    URL,
    console,
    setInterval: setIntervalMock,
    clearInterval: clearIntervalMock,
    setTimeout: () => fail('timeout'),
    fetch: () => fail('fetch'),
  });
  return module.exports;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const equal = (a, b) => assert.deepEqual(plain(a), plain(b));
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
const i18n = load('@/i18n/runtime');
const view = (locale) => {
  i18n.setAccountLocale('view', locale);
  return i18n.createTranslator(locale);
};
const langs = ['en', 'fr', 'ar'];
const { createRecorderLifetime } = load('@/features/submissions/recorderLifetime');
const { mediaClock, mediaSpoken } = load('@/features/submissions/mediaPresentation');
const { AudioRecorderSheet } = load('@/features/submissions/AudioRecorderSheet');
const { MediaPlayer } = load('@/features/submissions/MediaPlayer');
const { MediaPanel } = load('@/features/submissions/MediaSubmission');
const modeOn = (job) =>
  allow('mode', (args) => {
    equal(args, { allowsRecording: true, playsInSilentMode: true });
    return job?.promise ?? Promise.resolve();
  });
const modeOff = (job) =>
  allow('mode', (args) => {
    equal(args, { allowsRecording: false });
    return job?.promise ?? Promise.resolve();
  });
function makeRecorder(id) {
  return strict('recorder', {
    prepareToRecordAsync: boundary(id + '.prepare'),
    record: boundary(id + '.record'),
    stop: boundary(id + '.stop'),
    getStatus: boundary(id + '.status'),
    get uri() {
      return boundary(id + '.uri')();
    },
  });
}
let serial = 0;
function session() {
  const id = 'r' + ++serial,
    recorder = makeRecorder(id);
  let state,
    events = [];
  const life = createRecorderLifetime(
    recorder,
    (v) => {
      state = v;
    },
    (a, d) => {
      events.push([a, d]);
    },
  );
  return {
    id,
    life,
    recorder,
    events,
    get state() {
      return state;
    },
  };
}
function expectStart(s, stage) {
  allow('permission', stage === 'permission' ? undefined : Promise.resolve({ granted: true }));
  modeOn();
  allow(s.id + '.prepare', Promise.resolve());
  allow(s.id + '.record');
  allow('timer.start', (ms) => assert.equal(ms, 100));
}
async function start(s) {
  expectStart(s);
  await s.life.start();
  assert.equal(s.state.phase, 'recording');
}
function expectStop(s, duration = 61999, uri = 'file:///synthetic/take.m4a', job) {
  allow('timer.clear');
  allow(s.id + '.status', { durationMillis: duration });
  allow(s.id + '.stop', job?.promise ?? Promise.resolve());
  allow(s.id + '.uri', uri);
  modeOff();
}
function quiet(fn) {
  const n = calls.length;
  const result = fn();
  assert.equal(calls.length, n, 'presentation/stale callback did native work');
  return result;
}
function assertQueues() {
  for (const [n, q] of queues) assert.equal(q.length, 0, 'unused ' + n);
  assert.deepEqual(unexpected, []);
}
(async () => {
  // All old values, additive keys, and raw caller/lifecycle source guards.
  for (const l of langs) {
    const cat = load('@/i18n/' + l)[l];
    assert.equal(Object.keys(baseline.catalogs[l]).length, 1670);
    for (const [k, v] of Object.entries(baseline.catalogs[l])) equal(cat[k], v);
    assert.ok(Object.keys(cat).length >= 1705);
    assert.equal(
      Object.keys(cat).filter((k) => k.startsWith('audioRecorder.') || k.startsWith('inlineMedia.'))
        .length,
      35,
    );
  }
  const source = (n) => fs.readFileSync(path.join(root, 'features/submissions', n), 'utf8');
  // Panel presentation/lifetime now has its own production-module regression suite.
  // Freeze every unchanged mode/target/picker/classification helper against the
  // ORIGINAL baseline; no baseline regeneration or recorder/player relaxation.
  const helpers = (s) => s.slice(s.indexOf('export function useMediaMode'),
    s.indexOf('/** Record audio or video, or pick a video,'));
  assert.equal(helpers(source('MediaSubmission.tsx')), helpers(baseline.sources['MediaSubmission.tsx']));
  const playerSource = source('MediaPlayer.tsx');
  for (const [start, end] of [
    ['function useMediaSource', 'export type MediaPlayerProps'],
    ['function ActiveAudio', 'function VideoPoster'],
    ['function ActiveVideo', null],
  ]) {
    const cut = (s) => s.slice(s.indexOf(start), end ? s.indexOf(end) : undefined);
    assert.equal(cut(playerSource), cut(baseline.sources['MediaPlayer.tsx']));
  }
  assert.ok(
    source('AudioRecorderSheet.tsx').includes(
      'useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true })',
    ),
  );
  for (const l of langs) {
    const t = view(l);
    for (const seconds of [0, 1, 59.999, 60, 61.999, 3600, 3661, -1, Infinity, NaN]) {
      const total = Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : 0;
      const num = (v, d = 1) =>
        new Intl.NumberFormat(l, { useGrouping: false, minimumIntegerDigits: d }).format(v);
      assert.equal(mediaClock(seconds, l), num(Math.floor(total / 60)) + ':' + num(total % 60, 2));
      assert.ok(!mediaSpoken(seconds, t).includes('NaN'));
    }
  }
  // One mounted recorder, all five presentation states and live errors.
  const sheet = mount(AudioRecorderSheet, {
    visible: true,
    onClose: boundary('close'),
    onAttach: boundary('attach'),
  });
  let tree = sheet.render(),
    child = find(tree, 'Sheet').children;
  const id = 'component';
  nativeRecorder = makeRecorder(id);
  allow('recorder.setup', (o) => equal(o, { preset: 'HIGH_QUALITY', isMeteringEnabled: true }));
  const recorder = mount(child.type, child.props);
  let r = recorder.render();
  const render = () => {
    tree = sheet.render();
    child = find(tree, 'Sheet').children;
    return recorder.render(child.props);
  };
  for (const l of langs) {
    const t = view(l);
    quiet(() => {
      r = render();
    });
    assert.equal(find(tree, 'Sheet').title, t('audioRecorder.title'));
    assert.equal(find(tree, 'Sheet').doneLabel, t('audioRecorder.cancel'));
    assert.equal(child.props.fileName, 'Voice comment');
    assert.equal(child.props.attachLabel, t('audioRecorder.attach'));
    assert.equal(child.props.purpose, t('audioRecorder.purpose'));
    assert.equal(find(r, 'Pressable').accessibilityLabel, t('audioRecorder.start'));
  }
  allow('permission', Promise.resolve({ granted: false }));
  await find(r, 'Pressable').onPress();
  for (const l of langs) {
    const t = view(l);
    quiet(() => {
      r = render();
    });
    assert.equal(find(r, 'Callout').title, t('audioRecorder.permissionTitle'));
    assert.equal(
      text(find(r, 'Callout').children),
      t('audioRecorder.permissionBody', { purpose: t('audioRecorder.purpose') }),
    );
  }
  allow('settings', Promise.reject(Error('native error raw')));
  await find(r, 'Callout').action.onPress();
  await flush();
  for (const l of langs) {
    const t = view(l);
    quiet(() => {
      r = render();
    });
    assert.equal(text(all(r, 'Callout')[1].props.children), t('audioRecorder.error.settings'));
  }
  allow('permission', Promise.resolve({ granted: true }));
  modeOn();
  allow(id + '.prepare', Promise.resolve());
  allow(id + '.record');
  allow('timer.start');
  allow('haptic.light');
  allow('announce', (msg) =>
    assert.equal(msg, i18n.createTranslator('ar')('audioRecorder.recording')),
  );
  await find(r, 'Button').onPress();
  r = render();
  const timer = [...timers.values()][0];
  allow(id + '.status', { durationMillis: 61999, metering: -30 });
  timer();
  for (const l of langs) {
    const t = view(l);
    quiet(() => {
      r = render();
    });
    assert.equal(text(find(r, 'Text').children), mediaClock(61.999, l));
    assert.equal(
      find(r, 'Text').accessibilityLabel,
      t('audioRecorder.timer', { duration: mediaSpoken(61.999, t) }),
    );
    assert.equal(all(r, 'View').filter((n) => n.props.style?.height !== undefined).length, 36);
  }
  const stopJob = deferred();
  allow('timer.clear');
  allow(id + '.status', { durationMillis: 61999 });
  allow(id + '.stop', stopJob.promise);
  const stopping = find(r, 'Pressable').onPress();
  quiet(() => find(r, 'Pressable').onPress());
  view('fr');
  quiet(render);
  allow(id + '.uri', 'file:///synthetic/take.m4a');
  modeOff();
  allow('haptic.success');
  allow('announce', (msg) =>
    assert.equal(
      msg,
      i18n.createTranslator('fr')('audioRecorder.recorded', {
        duration: mediaSpoken(61.999, i18n.createTranslator('fr')),
      }),
    ),
  );
  stopJob.resolve();
  await stopping;
  for (const l of langs) {
    const t = view(l);
    quiet(() => {
      r = render();
    });
    const media = nodes(r).find((n) => n.type === MediaPlayer).props;
    assert.equal(media.title, t('audioRecorder.reviewTitle'));
    assert.equal(media.subtitle, mediaClock(61.999, l));
    assert.equal(text(all(r, 'Button')[1]), t('audioRecorder.attach'));
  }
  const retainedAttach = all(r, 'Button')[1].props.onPress;
  allow('file', () => {
    throw Error('metadata');
  });
  retainedAttach();
  for (const l of langs) {
    const t = view(l);
    quiet(() => {
      r = render();
    });
    assert.equal(text(find(r, 'Callout').children), t('audioRecorder.error.attach'));
  }
  allow('file', (uri) => {
    assert.equal(uri, 'file:///synthetic/take.m4a');
    return { exists: true, size: 123 };
  });
  allow('name', (prefix, ext) => {
    assert.equal(prefix, 'Voice comment');
    assert.equal(ext, 'm4a');
    return 'raw.m4a';
  });
  allow('attach', (file) =>
    equal(file, {
      uri: 'file:///synthetic/take.m4a',
      name: 'raw.m4a',
      size: 123,
      mimeType: 'audio/mp4',
    }),
  );
  retainedAttach();
  quiet(retainedAttach);
  allow('recorder.release');
  recorder.unmount();
  sheet.unmount();
  await flush();
  quiet(retainedAttach);
  // Explicit custom/default/empty values never enter translations or filename payloads.
  for (const raw of ['RAW العربية', '']) {
    const h = mount(AudioRecorderSheet, {
      visible: true,
      onClose: () => {},
      onAttach: () => {},
      attachLabel: raw,
      purpose: raw,
      fileName: raw,
    });
    for (const l of langs) {
      view(l);
      const c = find(h.render(), 'Sheet').children.props;
      assert.equal(c.attachLabel, raw);
      assert.equal(c.purpose, raw);
      assert.equal(c.fileName, raw);
    }
    h.unmount();
  }
  const panel = mount(MediaPanel, {
    a: { id: 'a', courseId: 'c', allowedExtensions: [] },
    slot: 's',
    items: [],
    mode: 'kaltura',
    onRetryCheck: () => {},
  });
  for (const l of langs) {
    const t = view(l);
    const c = nodes(quiet(() => panel.render())).find((n) => n.type === AudioRecorderSheet).props;
    assert.equal(c.fileName, 'Recording');
    assert.equal(c.attachLabel, t('audioRecorder.useRecording'));
    assert.equal(c.purpose, t('audioRecorder.submissionPurpose'));
  }
  panel.unmount();
  // Duplicate start/stop, cap/manual races, level math and re-record stale callbacks.
  const s = session();
  await start(s);
  quiet(() => s.life.start());
  const tick = [...timers.values()][0];
  for (const [db, want] of [
    [undefined, 0],
    [-160, 0],
    [-55, 0],
    [-30, 0.5],
    [-5, 1],
    [0, 1],
  ]) {
    allow(s.id + '.status', { durationMillis: 1000, metering: db });
    tick();
    assert.equal(s.state.levels.at(-1), want);
    assert.equal(s.state.levels.length, 36);
  }
  const stopped = deferred();
  allow(s.id + '.status', { durationMillis: 600000, metering: 0 });
  expectStop(s, 600000, 'file:///same', stopped);
  tick();
  quiet(() => s.life.stop());
  stopped.resolve();
  await flush();
  assert.equal(s.state.phase, 'review');
  equal(s.events, [
    ['recording', 0],
    ['recorded', 600000],
  ]);
  const oldUri = s.state.uri,
    oldTake = s.state.take;
  s.life.discard(oldUri, oldTake);
  quiet(() => s.life.attach(oldUri, oldTake, 'Recording', boundary('attach')));
  await start(s);
  quiet(tick); // cleared ticker from the previous take cannot touch this one
  expectStop(s, 5000, 'file:///same');
  await s.life.stop();
  quiet(() => s.life.attach(oldUri, oldTake, 'Recording', boundary('attach')));
  allow('file', { exists: false });
  allow('name', (p, e) => {
    assert.equal(p, 'Recording');
    assert.equal(e, 'm4a');
    return 'Recording stamp.m4a';
  });
  allow('attach', (f) =>
    equal(f, {
      uri: 'file:///same',
      name: 'Recording stamp.m4a',
      size: null,
      mimeType: 'audio/mp4',
    }),
  );
  s.life.attach(s.state.uri, s.state.take, 'Recording', boundary('attach'));
  quiet(() => s.life.attach(s.state.uri, s.state.take, 'Recording', boundary('attach')));
  s.life.close();
  await flush();
  assertQueues();
  // Close/unmount at each await, settle both ways, and reopen before the obsolete
  // result. New preparation waits for old cleanup; old permission doesn't block it.
  for (const phase of ['permission', 'mode', 'prepare', 'stop'])
    for (const outcome of ['resolve', 'reject']) {
      const old = session(),
        job = deferred();
      let task;
      if (phase === 'stop') {
        await start(old);
        allow('timer.clear');
        allow(old.id + '.status', { durationMillis: 1234 });
        allow(old.id + '.stop', job.promise);
        task = old.life.stop();
      } else {
        allow(
          'permission',
          phase === 'permission' ? job.promise : Promise.resolve({ granted: true }),
        );
        if (phase !== 'permission') modeOn(phase === 'mode' ? job : undefined);
        if (phase === 'prepare') allow(old.id + '.prepare', job.promise);
        task = old.life.start();
        await flush();
      }
      old.life.close();
      quiet(() => old.life.start());
      quiet(() => old.life.stop());
      const newer = session();
      allow('permission', Promise.resolve({ granted: true }));
      // Older mode release must run before newer mode setup, including rejection.
      if (phase !== 'permission') {
        if (phase === 'prepare') allow(old.id + '.stop', Promise.resolve());
        modeOff();
      }
      modeOn();
      allow(newer.id + '.prepare', Promise.resolve());
      allow(newer.id + '.record');
      allow('timer.start');
      const newTask = newer.life.start();
      await flush();
      if (phase === 'permission') assert.equal(newer.state.phase, 'recording');
      else assert.equal(newer.state.phase, 'starting');
      job[outcome](
        outcome === 'resolve'
          ? phase === 'permission'
            ? { granted: true }
            : undefined
          : Error('obsolete'),
      );
      await task;
      await newTask;
      assert.equal(newer.state.phase, 'recording');
      assert.equal(old.events.filter((e) => e[0] === 'recorded').length, 0);
      expectStop(newer);
      await newer.life.stop();
      newer.life.close();
      await flush();
      assertQueues();
    }
  // Failure/retry: no false review, timer or success; all rejection paths handled.
  for (const stage of [
    'permission',
    'mode',
    'prepare',
    'record',
    'status',
    'stop',
    'uri',
    'release',
  ]) {
    const s = session();
    if (['permission', 'mode', 'prepare', 'record'].includes(stage)) {
      allow(
        'permission',
        stage === 'permission'
          ? Promise.reject(Error('permission'))
          : Promise.resolve({ granted: true }),
      );
      if (stage !== 'permission')
        modeOn(stage === 'mode' ? { promise: Promise.reject(Error('mode')) } : undefined);
      if (['prepare', 'record'].includes(stage))
        allow(
          s.id + '.prepare',
          stage === 'prepare' ? Promise.reject(Error('prepare')) : Promise.resolve(),
        );
      if (stage === 'record')
        allow(s.id + '.record', () => {
          throw Error('record');
        });
      if (['prepare', 'record'].includes(stage)) allow(s.id + '.stop', Promise.resolve());
      if (stage !== 'permission') modeOff();
      await s.life.start();
      assert.equal(s.state.error, 'start');
      assert.equal(s.events.length, 0);
    } else {
      await start(s);
      allow('timer.clear');
      allow(
        s.id + '.status',
        stage === 'status'
          ? () => {
              throw Error('status');
            }
          : { durationMillis: 1000 },
      );
      allow(s.id + '.stop', stage === 'stop' ? Promise.reject(Error('stop')) : Promise.resolve());
      if (stage !== 'stop') allow(s.id + '.uri', stage === 'uri' ? null : 'file:///synthetic/take');
      modeOff(stage === 'release' ? { promise: Promise.reject(Error('release')) } : undefined);
      await s.life.stop();
      assert.equal(s.state.error, 'stop');
      assert.equal(s.events.length, 1);
    }
    assert.equal(s.state.phase, 'idle');
    assert.equal(timers.size, 0);
    await start(s);
    expectStop(s);
    await s.life.stop();
    assert.equal(s.state.phase, 'review');
    s.life.close();
    await flush();
    assertQueues();
  }
  // Close directly from recording: owned ticker clears synchronously, native stop
  // and mode release complete before a new recorder's mode. Cleanup stop rejection
  // is consumed, and it never reads a URI or announces successful review.
  for (const outcome of ['resolve', 'reject']) {
    const old = session();
    await start(old);
    const job = deferred();
    allow('timer.clear');
    allow(old.id + '.stop', job.promise);
    old.life.close();
    const newer = session();
    allow('permission', Promise.resolve({ granted: true }));
    modeOff();
    modeOn();
    allow(newer.id + '.prepare', Promise.resolve());
    allow(newer.id + '.record');
    allow('timer.start');
    const task = newer.life.start();
    await flush();
    assert.equal(newer.state.phase, 'starting');
    job[outcome](outcome === 'reject' ? Error('cleanup') : undefined);
    await task;
    expectStop(newer);
    await newer.life.stop();
    newer.life.close();
    await flush();
    assert.equal(old.events.length, 1);
    assertQueues();
  }
  // Actual component close callback invalidates before parent rerender/unmount.
  for (const outcome of ['resolve', 'reject']) {
    const h = mount(AudioRecorderSheet, {
      visible: true,
      onClose: boundary('close'),
      onAttach: boundary('attach'),
    });
    const sh = find(h.render(), 'Sheet');
    nativeRecorder = makeRecorder('closed');
    allow('recorder.setup');
    const c = mount(sh.children.type, sh.children.props);
    const cr = c.render();
    const job = deferred();
    allow('permission', job.promise);
    const task = find(cr, 'Pressable').onPress();
    allow('close');
    sh.onClose();
    allow('recorder.release');
    c.unmount();
    h.unmount();
    job[outcome](outcome === 'resolve' ? { granted: true } : Error('closed'));
    await task;
    assertQueues();
  }
  // Start/stop error reasons relabel on the same component; a future timer cap
  // uses the latest committed locale, without locale in any lifecycle dependency.
  {
    const id = 'cap-component';
    view('en');
    const sheet = mount(AudioRecorderSheet, {
      visible: true,
      onClose: boundary('close'),
      onAttach: boundary('attach'),
    });
    const sh = find(sheet.render(), 'Sheet');
    nativeRecorder = makeRecorder(id);
    allow('recorder.setup');
    const h = mount(sh.children.type, sh.children.props);
    let tree = h.render();
    allow('permission', Promise.reject(Error('raw permission failure')));
    await find(tree, 'Pressable').onPress();
    for (const l of langs) {
      const t = view(l);
      tree = quiet(() => h.render());
      assert.equal(text(find(tree, 'Callout').children), t('audioRecorder.error.start'));
    }
    const permission = deferred();
    allow('permission', permission.promise);
    const task = find(tree, 'Pressable').onPress();
    view('fr');
    quiet(() => h.render());
    modeOn();
    allow(id + '.prepare', Promise.resolve());
    allow(id + '.record');
    allow('timer.start');
    allow('haptic.light');
    allow('announce', (m) =>
      assert.equal(m, i18n.createTranslator('fr')('audioRecorder.recording')),
    );
    permission.resolve({ granted: true });
    await task;
    view('ar');
    quiet(() => h.render());
    allow(id + '.status', { durationMillis: 600000, metering: -30 });
    allow('timer.clear');
    allow(id + '.status', { durationMillis: 600000 });
    allow(id + '.stop', Promise.reject(Error('stop failed')));
    modeOff();
    [...timers.values()][0]();
    await flush();
    for (const l of langs) {
      const t = view(l);
      tree = quiet(() => h.render());
      assert.equal(text(find(tree, 'Callout').children), t('audioRecorder.error.stop'));
    }
    allow('permission', Promise.resolve({ granted: true }));
    modeOn();
    allow(id + '.prepare', Promise.resolve());
    allow(id + '.record');
    allow('timer.start');
    allow('haptic.light');
    allow('announce');
    await find(tree, 'Pressable').onPress();
    const cap = deferred();
    view('fr');
    quiet(() => h.render());
    allow(id + '.status', { durationMillis: 600000, metering: -30 });
    allow('timer.clear');
    allow(id + '.status', { durationMillis: 600000 });
    allow(id + '.stop', cap.promise);
    [...timers.values()][0]();
    const t = view('ar');
    quiet(() => h.render());
    allow(id + '.uri', 'file:///cap');
    modeOff();
    allow('haptic.success');
    allow('announce', (m) =>
      assert.equal(m, t('audioRecorder.recorded', { duration: mediaSpoken(600, t) })),
    );
    cap.resolve();
    await flush();
    tree = h.render();
    assert.equal(nodes(tree).find((n) => n.type === MediaPlayer).props.url, 'file:///cap');
    allow('recorder.release');
    h.unmount();
    sheet.unmount();
    await flush();
    assertQueues();
  }
  // Real component unmount at native awaits, including a hook-disposed recorder.
  for (const stage of ['mode', 'prepare', 'stop'])
    for (const outcome of ['resolve', 'reject']) {
      const id = 'unmount-' + stage + outcome;
      const sheet = mount(AudioRecorderSheet, {
        visible: true,
        onClose: boundary('close'),
        onAttach: boundary('attach'),
      });
      const sh = find(sheet.render(), 'Sheet');
      nativeRecorder = makeRecorder(id);
      allow('recorder.setup');
      const h = mount(sh.children.type, sh.children.props);
      let tree = h.render();
      const job = deferred();
      allow('permission', Promise.resolve({ granted: true }));
      modeOn(stage === 'mode' ? job : undefined);
      if (stage !== 'mode')
        allow(id + '.prepare', stage === 'prepare' ? job.promise : Promise.resolve());
      if (stage === 'stop') {
        allow(id + '.record');
        allow('timer.start');
        allow('haptic.light');
        allow('announce');
      }
      let task = find(tree, 'Pressable').onPress();
      await flush();
      if (stage === 'stop') {
        await task;
        tree = h.render();
        allow('timer.clear');
        allow(id + '.status', { durationMillis: 1000 });
        allow(id + '.stop', job.promise);
        task = find(tree, 'Pressable').onPress();
      }
      allow('recorder.release');
      h.unmount();
      sheet.unmount();
      await flush();
      // Once the hook has released its shared object, stop may reject. No invented
      // disposal method is called; mode still releases and no stale state publishes.
      if (stage === 'prepare')
        allow(id + '.stop', () => {
          throw Error('released shared object');
        });
      modeOff();
      job[outcome](outcome === 'reject' ? Error('late native rejection') : undefined);
      await task;
      assertQueues();
      assert.equal(timers.size, 0);
    }
  // A pending mode release also holds the lease across close/reopen.
  for (const outcome of ['resolve', 'reject']) {
    const old = session();
    await start(old);
    const release = deferred();
    allow('timer.clear');
    allow(old.id + '.status', { durationMillis: 1000 });
    allow(old.id + '.stop', Promise.resolve());
    allow(old.id + '.uri', 'file:///old');
    modeOff(release);
    const task = old.life.stop();
    await flush();
    old.life.close();
    const newer = session();
    allow('permission', Promise.resolve({ granted: true }));
    modeOn();
    allow(newer.id + '.prepare', Promise.resolve());
    allow(newer.id + '.record');
    allow('timer.start');
    const next = newer.life.start();
    await flush();
    assert.equal(newer.state.phase, 'starting');
    release[outcome](outcome === 'reject' ? Error('mode release') : undefined);
    await task;
    await next;
    assert.equal(old.events.length, 1);
    expectStop(newer);
    await newer.life.stop();
    newer.life.close();
    await flush();
    assertQueues();
  }
  // Duplicate pending permission plus metadata/throwing-caller retries. A caller
  // that throws is never invoked twice for that take; recording again is allowed.
  {
    const s = session(),
      permission = deferred();
    allow('permission', permission.promise);
    const task = s.life.start();
    quiet(() => s.life.start());
    modeOn();
    allow(s.id + '.prepare', Promise.resolve());
    allow(s.id + '.record');
    allow('timer.start');
    permission.resolve({ granted: true });
    await task;
    expectStop(s);
    await s.life.stop();
    const uri = s.state.uri,
      take = s.state.take;
    allow('file', {
      exists: true,
      get size() {
        throw Error('size');
      },
    });
    allow('name', 'raw.m4a');
    s.life.attach(uri, take, 'Recording', boundary('attach'));
    assert.equal(s.state.error, 'attach');
    allow('file', { exists: true, size: 42 });
    allow('name', 'raw.m4a');
    allow('attach', () => {
      throw Error('caller');
    });
    s.life.attach(uri, take, 'Recording', boundary('attach'));
    quiet(() => s.life.attach(uri, take, 'Recording', boundary('attach')));
    s.life.discard(uri, take);
    assert.equal(s.state.phase, 'idle');
    await start(s);
    expectStop(s, 1000, uri);
    await s.life.stop();
    quiet(() => s.life.discard(uri, take));
    assert.equal(s.state.phase, 'review');
    s.life.close();
    await flush();
    assertQueues();
  }
  // Polling failure stops the owned recording once and exposes a retryable reason.
  {
    const s = session();
    await start(s);
    allow(s.id + '.status', () => {
      throw Error('poll');
    });
    allow('timer.clear');
    allow(s.id + '.status', { durationMillis: 200 });
    allow(s.id + '.stop', Promise.resolve());
    allow(s.id + '.uri', 'file:///partial');
    modeOff();
    [...timers.values()][0]();
    await flush();
    assert.equal(s.state.error, 'stop');
    assert.equal(s.events.length, 1);
    s.life.close();
    await flush();
    assertQueues();
  }
  // Inline player mounts nothing native until activated; same-instance locale,
  // title and subtitle changes do not recreate source/player or replay effects.
  for (const kind of ['audio', 'video'])
    for (const url of [
      'https://school.invalid:444/media?raw=x',
      'https://school.invalid/media',
      'https://other.invalid/media',
      'file:///synthetic/raw',
      'relative',
    ]) {
      const props = { url, kind, title: 'RAW title العربية', subtitle: 'RAW subtitle' };
      const parent = mount(MediaPlayer, props);
      let p = parent.render();
      const lazy = mount(p.type, p.props);
      let shell = lazy.render();
      for (const l of langs) {
        const t = view(l);
        p = quiet(() => parent.render());
        shell = quiet(() => lazy.render(p.props));
        assert.equal(
          find(shell, kind === 'audio' ? 'IconButton' : 'Pressable').accessibilityLabel,
          t('inlineMedia.play', { title: props.title }),
        );
      }
      if (kind === 'audio') find(shell, 'IconButton').onPress();
      else find(shell, 'Pressable').onPress();
      lazy.unmount();
      p = parent.render();
      let source;
      const native = strict('player', {
        play: boundary('play'),
        pause: boundary('pause'),
        seekTo: boundary('seek'),
      });
      allow(kind + '.setup', (s, o) => {
        source = s;
        assert.equal(s.uri, url);
        assert.equal(
          s.headers,
          url === 'https://school.invalid:444/media?raw=x' ? client.authHeaders : undefined,
        );
        if (kind === 'audio') equal(o, { updateInterval: 250 });
        return native;
      });
      allow('play');
      audioStatus = {
        playing: true,
        isLoaded: true,
        isBuffering: false,
        currentTime: 61.9,
        duration: 3600,
        didJustFinish: false,
      };
      const active = mount(p.type, p.props);
      let a = active.render();
      const audio = kind === 'audio' ? mount(a.type, a.props) : null;
      for (const l of langs)
        for (const raw of ['RAW title العربية', '']) {
          const t = view(l);
          p = quiet(() => parent.render({ ...props, title: raw, subtitle: raw }));
          a = quiet(() => active.render(p.props));
          if (audio) {
            shell = quiet(() => audio.render(a.props));
            assert.equal(
              find(shell, 'IconButton').accessibilityLabel,
              t('inlineMedia.pause', { title: raw }),
            );
            assert.equal(
              find(shell, 'Pressable').accessibilityLabel,
              t('inlineMedia.position', { title: raw }),
            );
            assert.equal(
              find(shell, 'Pressable').accessibilityValue.text,
              t('inlineMedia.elapsed', {
                position: mediaSpoken(61.9, t),
                duration: mediaSpoken(3600, t),
              }),
            );
            assert.ok(text(shell).includes(mediaClock(3600, l)));
          } else {
            const v = find(a, 'VideoView');
            assert.equal(v.player, native);
            assert.equal(v.accessibilityLabel, raw);
            assert.equal(v.nativeControls, true);
            assert.equal(v.contentFit, 'contain');
            equal(v.fullscreenOptions, { enable: true });
            assert.equal(v.allowsPictureInPicture, true);
          }
          assert.equal(source.uri, url);
        }
      if (audio) {
        allow('pause');
        find(shell, 'IconButton').onPress();
        allow('seek', (n) => {
          assert.equal(n, 71.9);
          return Promise.resolve();
        });
        find(shell, 'Pressable').onAccessibilityAction({
          nativeEvent: { actionName: 'increment' },
        });
        allow('seek', (n) => {
          assert.equal(n, 51.9);
          return Promise.resolve();
        });
        find(shell, 'Pressable').onAccessibilityAction({
          nativeEvent: { actionName: 'decrement' },
        });
        find(shell, 'Pressable').onLayout({ nativeEvent: { layout: { width: 100 } } });
        shell = audio.render(a.props);
        allow('seek', (n) => {
          assert.equal(n, 1800);
          return Promise.resolve();
        });
        find(shell, 'Pressable').onPress({ nativeEvent: { locationX: 50 } });
        allow('seek', (n) => {
          assert.equal(n, 3600);
          return Promise.reject(Error('seek'));
        });
        a.props.onSeek(9999);
        allow('seek', (n) => {
          assert.equal(n, 0);
          return Promise.resolve();
        });
        a.props.onSeek(-20);
        audioStatus = { ...audioStatus, playing: false, didJustFinish: true, currentTime: 3600 };
        allow('seek', (n) => {
          assert.equal(n, 0);
          return Promise.resolve();
        });
        a = active.render(p.props);
        shell = audio.render(a.props);
        allow('play');
        find(shell, 'IconButton').onPress();
        for (const l of langs) {
          view(l);
          quiet(() => active.render(p.props));
        }
        audio.unmount();
      }
      allow(kind + '.release');
      active.unmount();
      parent.unmount();
      await flush();
      assertQueues();
    }
  // Lazy video wrapper and audio not-started preserve raw and empty supplied text.
  for (const kind of ['audio', 'video'])
    for (const title of ['RAW', ''])
      for (const subtitle of [undefined, '', 'RAW subtitle']) {
        const parent = mount(MediaPlayer, { kind, url: 'raw', title, subtitle });
        const p = parent.render();
        const child = mount(p.type, p.props);
        for (const l of langs) {
          const t = view(l);
          const tree = quiet(() => child.render(p.props));
          if (kind === 'video')
            assert.equal(
              text(all(tree, 'Text')[0]),
              subtitle ? t('inlineMedia.poster', { title, subtitle }) : title,
            );
          else {
            assert.equal(
              find(tree, 'Pressable').accessibilityValue.text,
              t('inlineMedia.notStarted'),
            );
            assert.equal(text(all(tree, 'Text')[0]), title);
            assert.equal(text(all(tree, 'Text')[1]), subtitle ?? '');
          }
        }
        child.unmount();
        parent.unmount();
      }
  assert.equal(timers.size, 0);
  assertQueues();
  console.log(
    `audio-media: 1705 keys, all 1670 previous values preserved; production presentation/lifecycle/source checks passed (${process.env.TZ ?? 'host'}; simulated hooks/native boundaries)`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
