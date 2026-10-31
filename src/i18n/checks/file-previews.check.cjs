const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
/** Production TSX, synthetic hooks/native/player/filesystem/WebView/timers and PDF DOM.
 * No actual media, file, fetch or native operation. Not React Compiler/WebView acceptance. */
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const baseline = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'file-previews.baseline.json'), 'utf8'),
);
const cache = new Map(),
  unexpected = [],
  operations = [],
  timers = new Map();
let timerId = 0,
  scope;
const fail = (name) => {
  unexpected.push(name);
  throw Error(`Unexpected boundary: ${name}`);
};
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
    const ref = react.useRef();
    if (!ref.current || deps.some((v, i) => !Object.is(v, ref.current.deps[i])))
      ref.current = { deps, value: fn() };
    return ref.current.value;
  },
  useEffect(fn, deps) {
    const r = react.useRef();
    if (!r.current || deps.some((v, i) => !Object.is(v, r.current.deps[i]))) {
      const old = r.current;
      r.current = { deps };
      scope.effects.push(() => {
        old?.cleanup?.();
        r.current.cleanup = fn();
      });
    }
  },
  useSyncExternalStore(_subscribe, snapshot) {
    return snapshot();
  },
};
function mount(fn, props) {
  const s = { cursor: 0, slots: [], effects: [], tree: null };
  return {
    render(next = props) {
      props = next;
      const previous = scope;
      scope = s;
      s.cursor = 0;
      try {
        s.tree = fn(props);
      } finally {
        scope = previous;
      }
      for (const effect of s.effects.splice(0)) effect();
      return s.tree;
    },
    unmount() {
      for (const r of s.slots) r?.current?.cleanup?.();
    },
  };
}
const jsx = (type, props, key) => {
  assert.ok(type, 'unmocked JSX type');
  return { type, props, key };
};
const colors = { bg: '#fafafa', fgMuted: '#666666' };
const account = { host: 'school.invalid', baseUrl: 'https://school.invalid' };
const client = { authHeaders: { Authorization: 'synthetic-only' } };
const native = Object.fromEntries(
  ['ActivityIndicator', 'FlatList', 'ScrollView', 'View', 'Pressable'].map((k) => [k, k]),
);
native.Platform = { OS: 'android', select: (v) => v.android ?? v.default };
native.StyleSheet = { absoluteFill: { position: 'absolute' } };
const events = {};
let playerDefaults = {};
function newPlayer(source, setup) {
  operations.push(['createPlayer', source]);
  const data = {
    status: 'readyToPlay',
    duration: 4000,
    playing: false,
    currentTime: 0,
    subtitleTrack: null,
    availableSubtitleTracks: [{ id: 'raw-track', label: 'Captions' }],
    ...playerDefaults,
  };
  const player = new Proxy(data, {
    get(o, k) {
      if (k in o) return o[k];
      return fail(`player.get.${String(k)}`);
    },
    set(o, k, v) {
      assert.ok(
        [
          'currentTime',
          'playbackRate',
          'subtitleTrack',
          'timeUpdateEventInterval',
          'staysActiveInBackground',
          'showNowPlayingNotification',
        ].includes(k),
      );
      operations.push(['player.set', k, v]);
      o[k] = v;
      return true;
    },
  });
  data.play = () => {
    operations.push(['play']);
    data.playing = true;
  };
  data.pause = () => {
    operations.push(['pause']);
    data.playing = false;
  };
  setup(player);
  return player;
}
const mocks = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': native,
  expo: { useEvent: (p, key, fallback) => (Object.hasOwn(events, key) ? events[key] : fallback) },
  'expo-video': {
    VideoView: 'VideoView',
    useVideoPlayer(source, setup) {
      return react.useMemo(() => newPlayer(source, setup), [JSON.stringify(source)]);
    },
  },
  'expo-file-system': {
    File: class {
      constructor() {
        fail('File constructor');
      }
    },
    FileMode: { ReadOnly: 'ReadOnly' },
  },
  'react-native-webview': { WebView: 'WebView' },
  'expo-image': { Image: 'Image' },
  'lucide-react-native': Object.fromEntries(
    ['Captions', 'CaptionsOff', 'Pause', 'Play', 'RotateCcw', 'RotateCw'].map((k) => [k, k]),
  ),
  '@/canvas/session': { useCanvas: () => ({ account, client }) },
  '@/design': {
    ...Object.fromEntries(
      ['Chip', 'IconButton', 'ProgressBar', 'Text', 'Callout', 'Screen'].map((k) => [k, k]),
    ),
    useTheme: () => ({ colors }),
  },
  '@/design/interop': { AnimatedView: 'AnimatedView' },
  '@/features/files/FileCard': { FileHero: 'FileHero' },
  '@/features/content/links': { openCanvasLink: (...args) => operations.push(['link', ...args]) },
  '@/lib/cn': { cn: (...args) => args.filter(Boolean).join(' ') },
  'react-native-gesture-handler': {
    GestureDetector: 'GestureDetector',
    ...Object.fromEntries(
      ['usePanGesture', 'usePinchGesture', 'useTapGesture'].map((k) => [
        k,
        (config) => ({ kind: k, config }),
      ]),
    ),
    useSimultaneousGestures: (...gestures) => gestures,
  },
  'react-native-reanimated': {
    useReducedMotion: () => false,
    useSharedValue: (value) =>
      react.useState(() => ({
        value,
        get() {
          return this.value;
        },
        set(v) {
          this.value = v;
          operations.push(['shared.set', v]);
        },
      }))[0],
    useAnimatedStyle: (fn) => fn(),
    runOnJS: (fn) => fn,
    withSpring: (v, options) => {
      operations.push(['spring', v, options]);
      return v;
    },
    withTiming: (v, options) => {
      operations.push(['timing', v, options]);
      return v;
    },
  },
};
for (const [name, mock] of Object.entries(mocks))
  mocks[name] = new Proxy(mock, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === '__esModule') return false;
      return fail(`${name}.${String(key)}`);
    },
  });
const allowed = new Set([
  'i18n/index.ts',
  'i18n/runtime.ts',
  'i18n/en.ts',
  'i18n/fr.ts',
  'i18n/ar.ts',
  'features/content/presentation.ts',
  'features/files/previews/presentation.ts',
  ...['MediaPreviews', 'TextPreviews', 'WebPreviews', 'ImagePreview'].map(
    (n) => `features/files/previews/${n}.tsx`,
  ),
]);
function resolve(id, from) {
  const base = id.startsWith('@/')
    ? path.join(root, id.slice(2))
    : path.resolve(path.dirname(from), id);
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(
    (p) => fs.existsSync(p) && fs.statSync(p).isFile(),
  );
}
function compile(source, filename, overrides = {}) {
  const m = { exports: {} };
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  }).outputText;
  const context = {
    exports: m.exports,
    require(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (!id.startsWith('.') && !id.startsWith('@/')) return fail(`module ${id}`);
      const p = resolve(id, filename);
      const canonical = p && '@/' + path.relative(root, p).replace(/\.(tsx?|js)$/, '');
      if (canonical && Object.hasOwn(mocks, canonical)) return mocks[canonical];
      return load(p);
    },
    TextDecoder,
    Uint8Array,
    Intl,
    URL,
    console,
    setTimeout(fn, delay) {
      assert.equal(delay, 0);
      const id = ++timerId;
      timers.set(id, fn);
      operations.push(['timer', delay]);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    fetch: () => fail('fetch'),
    ...overrides,
  };
  vm.runInNewContext(code, context, { filename });
  return m.exports;
}
function load(file) {
  if (isIntlPolyfills(file)) return intlPolyfills;
  if (!file || !allowed.has(path.relative(root, file))) return fail(`production import ${file}`);
  if (!cache.has(file)) cache.set(file, compile(fs.readFileSync(file, 'utf8'), file));
  return cache.get(file);
}
const moduleAt = (name) => load(path.join(root, name));
const runtime = moduleAt('i18n/runtime.ts');
const presentation = moduleAt('features/files/previews/presentation.ts');
const media = moduleAt('features/files/previews/MediaPreviews.tsx');
const text = moduleAt('features/files/previews/TextPreviews.tsx');
const web = moduleAt('features/files/previews/WebPreviews.tsx');
const image = moduleAt('features/files/previews/ImagePreview.tsx');
const clean = (value) => JSON.parse(JSON.stringify(value));
const same = (a, b) => assert.deepEqual(clean(a), clean(b));
const plain = (value) => String(value).replace(/[\u2068\u2069]/g, '');
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree.type === 'function') return nodes(mount(tree.type, tree.props).render());
  return [tree, ...nodes(tree.props?.children)];
}
const of = (tree, type) => nodes(tree).filter((n) => n.type === type);
const one = (tree, type) => {
  const result = of(tree, type);
  assert.equal(result.length, 1, type);
  return result[0].props;
};
function flushTimers() {
  for (const [id, fn] of [...timers]) {
    timers.delete(id);
    fn();
  }
}
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const locale = (l) => {
  runtime.setAccountLocale('test', l);
  return runtime.createTranslator(l);
};
function sourceNode(source, name) {
  const file = ts.createSourceFile(
    'x.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const node = file.statements.find((n) => n.name?.text === name);
  assert.ok(node, name);
  return ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, node, file);
}
// Frozen catalogs, duplicate keys, complete plural/placeholder parity, additive-only scope.
const en = moduleAt('i18n/en.ts').en;
const slots = (v) =>
  [
    ...new Set((typeof v === 'string' ? v : Object.values(v).join(' ')).match(/\{\w+\}/g) ?? []),
  ].sort();
for (const l of ['en', 'fr', 'ar']) {
  const catalog = moduleAt(`i18n/${l}.ts`)[l];
  assert.equal(Object.keys(baseline.catalogs[l]).length, 1625);
  for (const [key, value] of Object.entries(baseline.catalogs[l])) same(catalog[key], value);
  assert.ok(Object.keys(catalog).length >= 1655);
  same(Object.keys(catalog).sort(), Object.keys(en).sort());
  for (const k of Object.keys(catalog)) same(slots(catalog[k]), slots(en[k]));
  const src = fs.readFileSync(path.join(root, `i18n/${l}.ts`), 'utf8');
  const keys = [...src.matchAll(/^\s*['"]([^'"]+)['"]\s*:/gm)].map((m) => m[1]);
  assert.equal(keys.length, new Set(keys).size, 'duplicate catalog key');
}
for (const name of [
  'decodeUtf8',
  'readText',
  'useText',
  'parseDelimited',
  'parseMarkdown',
  'parseInline',
])
  assert.equal(
    sourceNode(
      fs.readFileSync(path.join(root, 'features/files/previews/TextPreviews.tsx'), 'utf8'),
      name,
    ),
    sourceNode(baseline.sources.TextPreviews, name),
  );
assert.equal(
  sourceNode(
    fs.readFileSync(path.join(root, 'features/files/previews/MediaPreviews.tsx'), 'utf8'),
    'usePlayerStatus',
  ),
  sourceNode(baseline.sources.MediaPreviews, 'usePlayerStatus'),
);
// Removing only the presentation bridge recovers the frozen PDF engine exactly.
const webSource = fs.readFileSync(
  path.join(root, 'features/files/previews/WebPreviews.tsx'),
  'utf8',
);
const engineOnly = webSource
  .replace(/  \/\/ Presentation only:[\s\S]*?  window.renderPdf =/, '  window.renderPdf =')
  .replace('      labelHolders = holders;\n      labelTotal = pdf.numPages;\n', '')
  .replace(
    '        labelPage(div);',
    "        div.setAttribute('aria-label', 'Page ' + n + ' of ' + pdf.numPages);",
  );
assert.equal(
  sourceNode(engineOnly, 'pdfJsDocument'),
  sourceNode(baseline.sources.WebPreviews, 'pdfJsDocument'),
);
const imageSource = fs.readFileSync(
  path.join(root, 'features/files/previews/ImagePreview.tsx'),
  'utf8',
);
assert.equal(
  imageSource
    .replace("import { useTranslation } from '@/i18n';\n", '')
    .replace('  const { t } = useTranslation();\n', '')
    .replace(
      "accessibilityHint={t('files.previews.zoomHint')}",
      'accessibilityHint="Pinch or double-tap to zoom"',
    ),
  baseline.sources.ImagePreview,
);

async function checkMedia() {
  const source = {
    uri: 'https://media.invalid/Play',
    headers: { Authorization: 'synthetic' },
    metadata: { title: 'Captions' },
  };
  const file = { name: 'Play', filename: 'Captions', id: 'f' };
  let errors = 0;
  events.timeUpdate = { currentTime: 3661.9 };
  events.sourceLoad = { duration: 4000.8 };
  locale('en');
  const audio = mount(media.AudioPreview, { source, file, onError: () => errors++ });
  let tree = audio.render();
  one(tree, 'Pressable').onLayout({ nativeEvent: { layout: { width: 200 } } });
  const playerCreates = operations.filter((o) => o[0] === 'createPlayer').length;
  for (const l of ['en', 'fr', 'ar', 'en']) {
    const t = locale(l),
      before = operations.length;
    tree = audio.render();
    assert.equal(operations.length, before);
    assert.equal(one(tree, 'FileHero').file, file);
    const bar = one(tree, 'Pressable');
    assert.equal(bar.accessibilityLabel, t('files.previews.position'));
    assert.equal(
      bar.accessibilityValue.text,
      t('files.previews.positionValue', {
        current: presentation.previewSpokenTime(3661.9, l),
        total: presentation.previewSpokenTime(4000.8, l),
      }),
    );
    const labels = of(tree, 'Text').map((n) => n.props);
    assert.equal(labels[0].children, presentation.previewClock(3661.9, l));
    assert.equal(labels[0].accessibilityLabel, presentation.previewSpokenTime(3661.9, l));
    assert.equal(
      labels[1].accessibilityLabel,
      t('files.previews.remaining', { time: presentation.previewSpokenTime(338.9, l) }),
    );
    assert.equal(
      labels[1].children,
      t('files.previews.remainingClock', { time: presentation.previewClock(338.9, l) }),
    );
    assert.equal(
      of(tree, 'IconButton')[0].props.accessibilityLabel,
      t('files.previews.back', { count: 15 }),
    );
    assert.equal(
      of(tree, 'IconButton')[2].props.accessibilityLabel,
      t('files.previews.forward', { count: 15 }),
    );
  }
  for (const rate of [1.25, 1.5, 2, 0.75, 1]) {
    one(tree, 'Chip').onPress();
    tree = audio.render();
    same(operations.at(-1), ['player.set', 'playbackRate', rate]);
    for (const l of ['en', 'fr', 'ar']) {
      const t = locale(l),
        before = operations.length;
      tree = audio.render();
      assert.equal(operations.length, before);
      assert.equal(one(tree, 'Chip').children, t('files.previews.speedDisplay', { rate }));
      assert.equal(one(tree, 'Chip').accessibilityLabel, t('files.previews.speed', { rate }));
    }
  }
  one(tree, 'Pressable').onPress({ nativeEvent: { locationX: 100 } });
  same(operations.at(-1), ['player.set', 'currentTime', 2000.4]);
  for (const [current, action, want] of [
    [2, 'decrement', 0],
    [3999, 'increment', 4000.8],
    [10, 'increment', 25],
  ]) {
    events.timeUpdate = { currentTime: current };
    tree = audio.render();
    one(tree, 'Pressable').onAccessibilityAction({ nativeEvent: { actionName: action } });
    same(operations.at(-1), ['player.set', 'currentTime', want]);
  }
  of(tree, 'IconButton')[0].props.onPress();
  same(operations.at(-1), ['player.set', 'currentTime', 0]);
  of(tree, 'IconButton')[2].props.onPress();
  same(operations.at(-1), ['player.set', 'currentTime', 25]);
  of(tree, 'IconButton')[1].props.onPress();
  same(operations.at(-1), ['play']);
  tree = audio.render();
  of(tree, 'IconButton')[1].props.onPress();
  same(operations.at(-1), ['pause']);
  events.statusChange = { status: 'error' };
  tree = audio.render();
  assert.equal(errors, 1);
  assert.equal(of(tree, 'IconButton')[1].props.disabled, true);
  for (const l of ['en', 'fr', 'ar']) {
    locale(l);
    audio.render();
    assert.equal(errors, 1);
  }
  assert.equal(operations.filter((o) => o[0] === 'createPlayer').length, playerCreates);
  events.statusChange = { status: 'loading' };
  events.sourceLoad = { duration: 0 };
  playerDefaults = { duration: 0 };
  const loading = mount(media.AudioPreview, {
    source: { uri: 'file:///zero' },
    file,
    onError: () => errors++,
  });
  for (const l of ['en', 'fr', 'ar']) {
    const t = locale(l),
      tree = loading.render(),
      label = of(tree, 'Text')[1].props;
    assert.equal(label.children, t('files.previews.loading'));
    assert.equal(label.accessibilityLabel, t('files.previews.loading'));
  }
  loading.unmount();
  playerDefaults = {};
  delete events.statusChange;
  delete events.sourceLoad;
  const video = mount(media.VideoPreview, { source, title: 'Captions', onError: () => errors++ });
  tree = video.render();
  const p = one(tree, 'VideoView').player,
    track = p.availableSubtitleTracks[0];
  assert.equal(one(tree, 'VideoView').accessibilityLabel, 'Captions');
  one(tree, 'Chip').onPress();
  same(operations.at(-1), ['player.set', 'subtitleTrack', track]);
  for (const l of ['en', 'fr', 'ar']) {
    const t = locale(l),
      before = operations.length;
    tree = video.render();
    assert.equal(operations.length, before);
    assert.equal(one(tree, 'Chip').selected, true);
    assert.equal(one(tree, 'Chip').children, t('files.previews.captions'));
    assert.equal(one(tree, 'Chip').accessibilityLabel, t('files.previews.captionsOn'));
    assert.equal(one(tree, 'VideoView').player, p);
  }
  one(tree, 'Chip').onPress();
  tree = video.render();
  assert.equal(one(tree, 'Chip').selected, false);
  events.availableSubtitleTracksChange = { availableSubtitleTracks: [] };
  assert.equal(of(video.render(), 'Chip').length, 0);
  delete events.availableSubtitleTracksChange;
  for (const l of ['en', 'fr', 'ar'])
    for (const secs of [0, 0.9, 59.99, 60, 61.9, 3599.9, 3600, 3661.9, 360000, -1, NaN, Infinity]) {
      const n = (v, pad = 1) =>
        new Intl.NumberFormat(l, { useGrouping: false, minimumIntegerDigits: pad }).format(v);
      const s = Number.isFinite(secs) && secs >= 0 ? secs : 0;
      const h = Math.floor(s / 3600),
        m = Math.floor(s / 60) % 60,
        rest = Math.floor(s % 60);
      assert.equal(
        plain(presentation.previewClock(secs, l)),
        h ? `${n(h)}:${n(m, 2)}:${n(rest, 2)}` : `${n(m)}:${n(rest, 2)}`,
      );
      if (Number.isFinite(secs) && secs >= 0) {
        const t = runtime.createTranslator(l),
          minutes = Math.floor(secs / 60),
          seconds = t('files.previews.seconds', { count: Math.floor(secs % 60) });
        assert.equal(
          presentation.previewSpokenTime(secs, l),
          minutes
            ? t('files.previews.minuteSeconds', {
                minutes: t('files.previews.minutes', { count: minutes }),
                seconds,
              })
            : seconds,
        );
      }
    }
  audio.unmount();
  video.unmount();
}

function textFile(raw, size = Buffer.byteLength(raw)) {
  return {
    uri: 'file:///synthetic/Loading',
    size,
    textSync() {
      operations.push(['textSync']);
      return raw;
    },
    open(mode) {
      assert.equal(mode, 'ReadOnly');
      operations.push(['open', mode]);
      return {
        readBytesSync(limit) {
          assert.equal(limit, 1_000_000);
          operations.push(['readBytes', limit]);
          return Uint8Array.from(Buffer.from(raw).subarray(0, limit));
        },
        close() {
          operations.push(['close']);
        },
      };
    },
  };
}
async function checkText() {
  const old = compile(
    baseline.sources.TextPreviews + '\nexport { readText, decodeUtf8 };',
    path.join(root, 'features/files/previews/TextPreviews.tsx'),
  );
  const current = compile(
    fs.readFileSync(path.join(root, 'features/files/previews/TextPreviews.tsx'), 'utf8') +
      '\nexport { readText, decodeUtf8 };',
    path.join(root, 'features/files/previews/TextPreviews.tsx'),
  );
  const fixtures = [
    '',
    'a,b\r\n"hello\nworld","x""y"\r\n',
    ',empty,Column 3\nx,,z,extra',
    'a\tb\n1\t2',
    'é,مرحبا\n😀,fin',
    'a\rb\nc\r\nd',
    '"unterminated,a',
  ];
  for (const l of ['en', 'fr', 'ar']) {
    locale(l);
    for (const raw of fixtures)
      for (const delimiter of [',', '\t', ';'])
        for (const cap of [1, 2, 5000])
          same(text.parseDelimited(raw, delimiter, cap), old.parseDelimited(raw, delimiter, cap));
  }
  const markdown =
    '# Loading\r\n\r\n3. Play\n4. Captions\n\n> quote\n\n```js\nconst x = "Loading…";\n```\n\n[empty](https://example.invalid) **bold** _italic_ `code`\n\n---';
  same(text.parseMarkdown(markdown), old.parseMarkdown(markdown));
  same(text.parseInline(markdown), old.parseInline(markdown));
  for (const tail of ['é', '😀', '中', 'a'])
    for (const offset of [1, 2, 3, 4]) {
      const local = textFile('a'.repeat(1_000_000 - offset) + tail + 'tail');
      same(current.readText(local), old.readText(local));
    }
  for (const raw of fixtures)
    assert.equal(
      current.decodeUtf8(Uint8Array.from(Buffer.from(raw))),
      old.decodeUtf8(Uint8Array.from(Buffer.from(raw))),
    );
  const fallbackSource =
    fs.readFileSync(path.join(root, 'features/files/previews/TextPreviews.tsx'), 'utf8') +
    '\nexport { decodeUtf8 };';
  const fallback = compile(
    fallbackSource,
    path.join(root, 'features/files/previews/TextPreviews.tsx'),
    { TextDecoder: undefined },
  );
  for (const raw of fixtures)
    assert.equal(fallback.decodeUtf8(Uint8Array.from(Buffer.from(raw))), raw);
  let errors = 0;
  for (const code of [false, true]) {
    const raw = Array.from({ length: 163 }, (_, i) => `Loading… ${i}`).join('\r\n');
    const preview = mount(text.TextPreview, {
      local: textFile(raw),
      code,
      onError: () => errors++,
    });
    for (const l of ['en', 'fr', 'ar']) {
      const t = locale(l);
      assert.equal(
        one(preview.render(), 'ActivityIndicator').accessibilityLabel,
        t('files.previews.loading'),
      );
    }
    flushTimers();
    let tree = preview.render(),
      chunks = one(tree, 'FlatList').data;
    same(
      chunks.map((c) => c.start),
      [1, 81, 161],
    );
    assert.equal(chunks[0].text.split('\n').length, 80);
    const before = operations.length;
    for (const l of ['en', 'fr', 'ar']) {
      locale(l);
      tree = preview.render();
      assert.equal(one(tree, 'FlatList').data, chunks);
      assert.equal(operations.length, before);
      assert.equal(
        one(one(tree, 'FlatList').renderItem({ item: chunks[0] }), 'Text').children,
        chunks[0].text,
      );
    }
    preview.unmount();
  }
  for (const Component of [text.TextPreview, text.CsvPreview]) {
    const preview = mount(Component, {
      local: textFile(''),
      code: false,
      delimiter: ',',
      onError: () => errors++,
    });
    preview.render();
    flushTimers();
    for (const l of ['en', 'fr', 'ar']) {
      const t = locale(l);
      assert.equal(one(preview.render(), 'Text').children, t('files.previews.emptyFile'));
    }
    preview.unmount();
  }
  const csv = mount(text.CsvPreview, {
    local: textFile(',empty,Column 3\nx,,z,extra'),
    delimiter: ',',
    onError: () => errors++,
  });
  csv.render();
  flushTimers();
  let previousRows;
  for (const l of ['en', 'fr', 'ar']) {
    const t = locale(l),
      before = operations.length,
      list = one(csv.render(), 'FlatList');
    assert.equal(operations.length, before);
    if (previousRows) same(list.data, previousRows);
    previousRows = list.data;
    const header = nodes(list.ListHeaderComponent).find((n) => n.props.accessible).props;
    assert.equal(
      header.accessibilityLabel,
      t('files.previews.columns', { columns: ', empty, Column 3' }),
    );
    const row = nodes(list.renderItem({ item: list.data[0], index: 0 })).find(
      (n) => n.props.accessible,
    ).props;
    assert.equal(
      row.accessibilityLabel,
      [
        ['', 'x'],
        ['empty', t('files.previews.emptyCell')],
        ['Column 3', 'z'],
        [t('files.previews.column', { number: 4 }), 'extra'],
      ]
        .map(([column, value]) => t('files.previews.cell', { column, value }))
        .join(', '),
    );
    same(
      of(list.ListHeaderComponent, 'Text').map((n) => n.props.children),
      ['', 'empty', 'Column 3', ''],
    );
  }
  csv.unmount();
  const md = mount(text.MarkdownPreview, { local: textFile(markdown), onError: () => errors++ });
  md.render();
  flushTimers();
  for (const l of ['en', 'fr', 'ar']) {
    const t = locale(l),
      before = operations.length,
      tree = md.render();
    assert.equal(operations.length, before);
    assert.ok(
      of(tree, 'Text').some(
        (n) => n.props.children === t('files.previews.orderedNumber', { number: 1 }),
      ),
    );
    assert.ok(of(tree, 'Text').some((n) => n.props.children === 'const x = "Loading…";'));
    const link = of(tree, 'Text').find((n) => n.props.accessibilityRole === 'link');
    assert.equal(link.props.children, 'empty');
    link.props.onPress();
    same(operations.at(-1), ['link', 'https://example.invalid', account.baseUrl]);
  }
  md.unmount();
  for (const [Component, raw, size, rowLimit] of [
    [text.TextPreview, 'a'.repeat(1_000_001), 1_000_001, false],
    [text.CsvPreview, 'a\n'.repeat(5000), 10000, true],
    [text.CsvPreview, 'a\n'.repeat(5001), 10002, true],
    [text.CsvPreview, 'a\n'.repeat(5001) + 'z'.repeat(1_000_001), 1_010_003, true],
    [text.CsvPreview, 'a'.repeat(1_000_001), 1_000_001, false],
  ]) {
    const preview = mount(Component, {
      local: textFile(raw, size),
      delimiter: ',',
      code: false,
      onError: () => errors++,
    });
    preview.render();
    flushTimers();
    for (const l of ['en', 'fr', 'ar']) {
      const t = locale(l),
        list = one(preview.render(), 'FlatList'),
        note = one(list.ListFooterComponent ?? list.ListHeaderComponent, 'Callout');
      if (rowLimit) {
        assert.notEqual(note.title, t('files.previews.truncatedTitle', { size: 1 }));
        assert.equal(note.title, t('files.previews.truncatedRows', { count: 5000 }));
        assert.equal(list.data.length, 4999, 'header plus 4,999 body rows');
      } else {
        assert.equal(note.title, t('files.previews.truncatedTitle', { size: 1 }));
      }
      assert.equal(note.children, t('files.previews.truncatedBody'));
    }
    preview.unmount();
  }
  const belowCap = mount(text.CsvPreview, {
    local: textFile('a\n'.repeat(4999)),
    delimiter: ',',
    onError: () => errors++,
  });
  belowCap.render();
  flushTimers();
  assert.equal(one(belowCap.render(), 'FlatList').ListFooterComponent, undefined);
  belowCap.unmount();
  const bad = mount(text.TextPreview, {
    local: {
      uri: 'file:///bad',
      size: 0,
      textSync() {
        throw Error('configured read failure');
      },
    },
    onError: () => errors++,
  });
  bad.render();
  flushTimers();
  assert.equal(errors, 1);
  for (const l of ['en', 'fr', 'ar']) {
    locale(l);
    bad.render();
    flushTimers();
    assert.equal(errors, 1);
  }
  bad.unmount();
  const cancel = mount(text.TextPreview, {
    local: { uri: 'file:///cancel', size: 0, textSync: () => fail('canceled read') },
    onError: () => errors++,
  });
  cancel.render();
  cancel.unmount();
  flushTimers();
  assert.equal(errors, 1);
  let closed = 0;
  assert.throws(
    () =>
      current.readText({
        size: 1_000_001,
        open() {
          return {
            readBytesSync() {
              throw Error('configured');
            },
            close() {
              closed++;
            },
          };
        },
      }),
    /configured/,
  );
  assert.equal(closed, 1);
}
function pdfDom(html, pendingDocument = false) {
  const calls = [],
    messages = [],
    listeners = {},
    observers = [];
  const holders = [];
  const container = {
    appendChild(div) {
      holders.push(div);
    },
  };
  function element(tag) {
    const attributes = {},
      children = [];
    return {
      tag,
      attributes,
      children,
      dataset: {},
      style: {},
      offsetTop: holders.length * 900,
      setAttribute(k, v) {
        assert.ok(['role', 'aria-label'].includes(k));
        attributes[k] = v;
      },
      appendChild(child) {
        children.push(child);
      },
      getContext(kind) {
        assert.equal(kind, '2d');
        return 'synthetic-context';
      },
    };
  }
  let resolveDoc;
  const pdf = {
    numPages: 3,
    getPage(n) {
      calls.push(['page', n]);
      return Promise.resolve({
        getViewport({ scale }) {
          return { width: 600 * scale, height: 900 * scale };
        },
        render(options) {
          calls.push(['render', options]);
          return { promise: Promise.resolve() };
        },
      });
    },
  };
  const pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument({ data }) {
      calls.push(['document', Array.from(data)]);
      return {
        promise: pendingDocument
          ? new Promise((resolve) => {
              resolveDoc = resolve;
            })
          : Promise.resolve(pdf),
      };
    },
  };
  const window = {
    pdfjsLib,
    devicePixelRatio: 2,
    scrollY: 0,
    innerHeight: 800,
    ReactNativeWebView: { postMessage: (msg) => messages.push(JSON.parse(msg)) },
    addEventListener(name, fn, options) {
      assert.equal(name, 'scroll');
      same(options, { passive: true });
      listeners[name] = fn;
    },
  };
  const context = vm.createContext({
    window,
    pdfjsLib,
    document: {
      documentElement: { clientWidth: 400 },
      getElementById(id) {
        assert.equal(id, 'pages');
        return container;
      },
      createElement: element,
    },
    Uint8Array,
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    IntersectionObserver: class {
      constructor(fn, options) {
        same(options, { rootMargin: '800px 0px' });
        this.fn = fn;
        this.targets = [];
        observers.push(this);
      }
      observe(d) {
        this.targets.push(d);
      }
    },
    fetch: () => fail('PDF fetch'),
  });
  const exec = (script) => vm.runInContext(script, context);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  return {
    window,
    holders,
    calls,
    messages,
    observers,
    listeners,
    exec,
    init: () => exec(scripts[0]),
    resolve: () => resolveDoc(pdf),
  };
}
async function checkWeb() {
  let errors = 0,
    reads = 0;
  const onError = () => errors++;
  const local = {
    uri: 'file:///synthetic/Loading…',
    parentDirectory: { uri: 'file:///synthetic/' },
    base64() {
      reads++;
      return Promise.resolve('JVBERg==');
    },
  };
  const old = compile(
    baseline.sources.WebPreviews,
    path.join(root, 'features/files/previews/WebPreviews.tsx'),
  );
  for (const name of ['LocalDocumentPreview', 'HtmlPreview', 'DocViewerPreview']) {
    for (const url of ['https://school.invalid/doc', 'https://outside.invalid/doc', 'not a url']) {
      const props = { local, title: 'Loading…', url, onError };
      const before = mount(old[name], props),
        after = mount(web[name], props);
      const original = one(before.render(), 'WebView');
      let tree = after.render(),
        view = one(tree, 'WebView'),
        source = view.source;
      for (const l of ['en', 'fr', 'ar']) {
        const t = locale(l),
          count = operations.length;
        tree = after.render();
        view = one(tree, 'WebView');
        assert.equal(view.source, source);
        assert.equal(operations.length, count);
        assert.equal(
          one(tree, 'ActivityIndicator').accessibilityLabel,
          t('files.previews.loading'),
        );
        for (const key of [
          'source',
          'allowingReadAccessToURL',
          'originWhitelist',
          'javaScriptEnabled',
          'domStorageEnabled',
          'incognito',
          'allowFileAccess',
          'sharedCookiesEnabled',
          'allowsInlineMediaPlayback',
          'setSupportMultipleWindows',
          'accessibilityLabel',
        ]) {
          if (original[key] === undefined) assert.equal(view[key], undefined);
          else same(view[key], original[key]);
        }
      }
      if (name === 'DocViewerPreview') {
        assert.equal(
          view.source.headers,
          url.startsWith('https://school.invalid/') ? client.authHeaders : undefined,
        );
        view.onHttpError({ nativeEvent: { statusCode: 399 } });
        const e = errors;
        view.onHttpError({ nativeEvent: { statusCode: 400 } });
        assert.equal(errors, e + 1);
      }
      if (view.onShouldStartLoadWithRequest) {
        for (const request of [
          { url: local.uri, isTopFrame: true },
          { url: 'file:///else', isTopFrame: true },
          { url: 'about:blank', isTopFrame: true },
          { url: 'about:else', isTopFrame: true },
          { url: 'https://school.invalid/raw', isTopFrame: true },
          { url: 'https://other.invalid', isTopFrame: false },
        ])
          assert.equal(
            view.onShouldStartLoadWithRequest(request),
            original.onShouldStartLoadWithRequest(request),
          );
        original.onLoadEnd();
        view.onLoadEnd();
        view = one(after.render(), 'WebView');
        for (const request of [
          { url: local.uri, isTopFrame: true },
          { url: 'file:///else', isTopFrame: true },
          { url: 'about:blank', isTopFrame: true },
        ])
          assert.equal(
            view.onShouldStartLoadWithRequest(request),
            original.onShouldStartLoadWithRequest(request),
          );
      } else view.onLoadEnd();
      assert.equal(of(after.render(), 'ActivityIndicator').length, 0);
      const e = errors;
      view.onError();
      assert.equal(errors, e + 1);
      if (view.onContentProcessDidTerminate) {
        view.onContentProcessDidTerminate();
        assert.equal(errors, e + 2);
      }
      before.unmount();
      after.unmount();
    }
  }
  locale('en');
  const instance = mount(web.PdfJsPreview, { local, title: 'Page 1 of 3', onError });
  instance.render();
  assert.equal(reads, 1);
  // Language update while the base64 promise is still pending.
  locale('fr');
  instance.render();
  assert.equal(reads, 1);
  await tick();
  let tree = instance.render(),
    view = one(tree, 'WebView');
  const source = view.source,
    renderScript = view.injectedJavaScript;
  assert.equal(view.accessibilityLabel, 'Page 1 of 3');
  assert.equal(view.javaScriptEnabled, true);
  same(view.originWhitelist, ['*']);
  assert.equal(source.baseUrl, 'https://cdnjs.cloudflare.com/');
  assert.ok(
    source.html.includes('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'),
  );
  assert.equal(web.ANDROID_PDF_LIMIT, 30_000_000);
  for (const [url, ok] of [
    ['https://cdnjs.cloudflare.com/x', true],
    ['about:blank', true],
    ['data:text/plain,x', true],
    ['https://cdnjs.cloudflare.com.evil/', false],
    ['file:///a', false],
    ['https://school.invalid/', false],
  ])
    assert.equal(view.onShouldStartLoadWithRequest({ url }), ok);
  const dom = pdfDom(source.html, true),
    injections = [];
  view.ref.current = {
    injectJavaScript(script) {
      injections.push(script);
      dom.exec(script);
    },
  };
  // onLoadEnd may precede the document bridge in this simulation: queue then consume it.
  view.onLoadEnd();
  assert.equal(injections.length, 1);
  dom.init();
  dom.exec(renderScript);
  assert.equal(dom.calls.filter((c) => c[0] === 'document').length, 1);
  same(dom.calls[0], ['document', [37, 80, 68, 70]]);
  locale('ar');
  tree = instance.render();
  view = one(tree, 'WebView');
  assert.equal(view.source, source);
  assert.equal(view.injectedJavaScript, renderScript);
  assert.equal(reads, 1);
  dom.resolve();
  await tick();
  assert.equal(dom.holders.length, 3);
  const checkLabels = (l) =>
    dom.holders.forEach((h, i) =>
      assert.equal(
        h.attributes['aria-label'],
        runtime.createTranslator(l)('files.previews.pageLabel', {
          current: runtime.formatNumber(i + 1, { useGrouping: false }, l),
          total: runtime.formatNumber(3, { useGrouping: false }, l),
        }),
      ),
    );
  checkLabels('ar');
  same(dom.messages[0], { type: 'loaded', pages: 3 });
  assert.equal(dom.observers.length, 1);
  same(dom.observers[0].targets, dom.holders);
  dom.observers[0].fn([{ isIntersecting: true, target: dom.holders[0] }]);
  await tick();
  assert.equal(dom.holders[0].children.length, 1);
  dom.window.scrollY = 1000;
  dom.listeners.scroll();
  same(dom.messages.at(-1), { type: 'page', page: 2 });
  view.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'loaded', pages: 3 }) } });
  view.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'page', page: 2 }) } });
  const first = dom.holders[0],
    canvas = first.children[0],
    callCount = dom.calls.length,
    observer = dom.observers[0];
  for (const l of ['en', 'fr', 'ar']) {
    const t = locale(l),
      before = operations.length;
    tree = instance.render();
    view = one(tree, 'WebView');
    assert.equal(view.source, source);
    assert.equal(view.injectedJavaScript, renderScript);
    assert.equal(reads, 1);
    assert.equal(operations.length, before);
    assert.equal(
      one(tree, 'Text').children,
      t('files.previews.pageBadge', { current: 2, total: 3 }),
    );
    assert.equal(of(tree, 'ActivityIndicator').length, 0);
    checkLabels(l);
    assert.equal(dom.holders[0], first);
    assert.equal(first.children[0], canvas);
    assert.equal(dom.window.scrollY, 1000);
    assert.equal(dom.calls.length, callCount);
    assert.equal(dom.observers[0], observer);
  }
  // Already drawn pages stay drawn; lazy future canvas uses the existing labeled holder.
  observer.fn([
    { isIntersecting: true, target: first },
    { isIntersecting: true, target: dom.holders[2] },
  ]);
  await tick();
  assert.equal(first.children.length, 1);
  assert.equal(dom.holders[2].children.length, 1);
  checkLabels('ar');
  const special = {
    page: '</script> " \\ \u2028 \u2029 {current} / {total}',
    digits: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
  };
  const script = presentation.pdfPresentationScript(special);
  assert.ok(!script.includes('</script>'));
  assert.ok(!script.includes('\u2028'));
  dom.exec(script);
  assert.equal(
    first.attributes['aria-label'],
    special.page.replace('{current}', '1').replace('{total}', '3'),
  );
  // A later WebView load uses the latest committed language, even via retained callback.
  const oldLoad = view.onLoadEnd;
  locale('fr');
  instance.render();
  const reload = pdfDom(source.html);
  reload.init();
  view.ref.current = { injectJavaScript: (s) => reload.exec(s) };
  oldLoad();
  reload.exec(renderScript);
  await tick();
  for (const h of reload.holders)
    assert.equal(
      h.attributes['aria-label'],
      runtime.createTranslator('fr')('files.previews.pageLabel', {
        current: Number(h.dataset.page),
        total: 3,
      }),
    );
  // Rendering before onLoadEnd must also relabel existing holders when the load finishes.
  const late = pdfDom(source.html);
  late.init();
  late.exec(renderScript);
  await tick();
  assert.equal(late.holders[0].attributes['aria-label'], undefined);
  view.ref.current = { injectJavaScript: (s) => late.exec(s) };
  oldLoad();
  assert.equal(late.holders[0].attributes['aria-label'], 'Page 1 sur 3');
  const e = errors;
  view.onMessage({ nativeEvent: { data: 'malformed' } });
  view.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'unknown' }) } });
  assert.equal(errors, e);
  view.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'error' }) } });
  assert.equal(errors, e + 1);
  for (const l of ['en', 'fr', 'ar']) {
    locale(l);
    instance.render();
    assert.equal(errors, e + 1);
  }
  instance.unmount();
  const broken = mount(web.PdfJsPreview, {
    local: { ...local, uri: 'file:///broken', base64: () => Promise.reject(Error('configured')) },
    title: 'raw',
    onError,
  });
  broken.render();
  await tick();
  assert.equal(errors, e + 2);
  locale('fr');
  broken.render();
  assert.equal(errors, e + 2);
  broken.unmount();
  let reject;
  const canceled = mount(web.PdfJsPreview, {
    local: {
      ...local,
      uri: 'file:///canceled',
      base64: () =>
        new Promise((_r, j) => {
          reject = j;
        }),
    },
    title: 'raw',
    onError,
  });
  canceled.render();
  canceled.unmount();
  reject(Error('configured'));
  await tick();
  assert.equal(errors, e + 2);
}
function checkImage() {
  const zoom = [],
    errors = [];
  locale('en');
  const preview = mount(image.ImagePreview, {
    uri: 'file:///Play',
    accessibilityLabel: 'Pinch or double-tap to zoom',
    onZoomChange: (v) => zoom.push(v),
    onError: () => errors.push(1),
  });
  let tree = preview.render();
  one(tree, 'View').onLayout({ nativeEvent: { layout: { width: 300, height: 400 } } });
  tree = preview.render();
  const gestures = one(tree, 'GestureDetector').gesture;
  gestures[2].config.onActivate({ x: 150, y: 200 });
  same(zoom, [true]);
  tree = preview.render();
  const transform = one(tree, 'AnimatedView').animatedStyle;
  for (const l of ['en', 'fr', 'ar']) {
    const t = locale(l),
      before = operations.length;
    tree = preview.render();
    assert.equal(operations.length, before);
    assert.equal(one(tree, 'AnimatedView').accessibilityHint, t('files.previews.zoomHint'));
    assert.equal(one(tree, 'AnimatedView').accessibilityLabel, 'Pinch or double-tap to zoom');
    same(one(tree, 'AnimatedView').animatedStyle, transform);
    same(one(tree, 'Image').source, { uri: 'file:///Play' });
    assert.equal(one(tree, 'Image').autoplay, true);
    same(zoom, [true]);
    same(errors, []);
  }
  one(tree, 'GestureDetector').gesture[2].config.onActivate({ x: 150, y: 200 });
  same(zoom, [true, false]);
  preview.unmount();
}
(async () => {
  await checkMedia();
  await checkText();
  await checkWeb();
  checkImage();
  assert.equal(timers.size, 0);
  same(unexpected, []);
  console.log(
    `file-previews: PASS (${process.env.TZ ?? 'host TZ'}; ${Object.keys(en).length} keys, 1625 frozen entries per catalog; synthetic boundaries only)`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
