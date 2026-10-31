/* global __dirname */
// Production controls and locale runtime. Synthetic staged hooks/native/animation
// boundaries only: no React reconciliation, native acceptance, HTTP or storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
let scope;
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

const root = path.resolve(__dirname, '../..');
const cache = new Map();
const allowed = new Set([
  'i18n',
  'i18n/runtime',
  'i18n/en',
  'i18n/fr',
  'i18n/ar',
  'canvas/html',
  'features/quizzes/answers',
  'features/quizzes/quizControls',
  'features/quizzes/QuizTimer',
  'features/quizzes/QuestionNavigator',
  'features/quizzes/ReviewPanel',
]);
const events = [],
  animations = [];
let reduced = false;
const session = { account: { id: 'A' }, client: {} };
let account = session.account,
  client = session.client;
const elements = (names) => Object.fromEntries(names.split(' ').map((n) => [n, n]));
const jsx = (type, props, key) => ({ type, props, key });
const mocks = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': {
    ...elements('Pressable View'),
    AccessibilityInfo: { announceForAccessibility: (text) => events.push(['announce', text]) },
  },
  'lucide-react-native': elements('Clock EyeOff Flag Info CircleCheck'),
  '@/design': {
    ...elements('Icon Text Button Sheet Callout Card ListGroup ListItem ProgressBar Section'),
    useReduceMotion: () => reduced,
    haptics: { selection: () => events.push(['selection']), warning: () => events.push(['warning']) },
  },
  '@/design/interop': elements('AnimatedView'),
  '@/lib/cn': { cn: (...args) => args.filter(Boolean).join(' ') },
  '@/canvas/session': { useCanvas: () => ({ account, client }) },
  'react-native-reanimated': {
    useSharedValue: (initial) =>
      react.useState(() => ({
        value: initial,
        get() {
          return this.value;
        },
        set(value) {
          this.value = value;
          animations.push(['set', value]);
        },
      }))[0],
    useAnimatedStyle: (fn) => fn(),
    cancelAnimation: () => animations.push(['cancel']),
    withTiming: (value, options) => ({ value, options }),
    withSequence: (...sequence) => ({ sequence }),
    withRepeat: (animation, count) => ({ animation, count }),
  },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mocks[key]) return mocks[key];
  // Node provides the Intl APIs installed conditionally on Hermes.
  if (key === '@/i18n/polyfills') return {};
  assert.ok(key.startsWith('@/') && allowed.has(key.slice(2)), 'Unexpected import ' + key);
  const file = ['.ts', '.tsx', '/index.ts']
    .map((e) => path.join(root, key.slice(2)) + e)
    .find(fs.existsSync);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  new vm.Script(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    { filename: file },
  ).runInNewContext({
    module,
    exports: module.exports,
    require: (n) => load(n, file),
    Intl,
    Date,
    Error,
    URL,
    console,
  });
  return module.exports;
}
const runtime = load('@/i18n/runtime');
const timer = load('@/features/quizzes/QuizTimer');
const { QuestionNavigator } = load('@/features/quizzes/QuestionNavigator');
const { ReviewPanel } = load('@/features/quizzes/ReviewPanel');
const { answerState, questionNumbers } = load('@/features/quizzes/answers');
const locale = (lang) => {
  runtime.setAccountLocale(account.id, lang);
  return runtime.createTranslator(lang);
};
const nodes = (tree) => {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree.type === 'function') return nodes(tree.type(tree.props)); // local Legend only
  return [tree, ...nodes(tree.props?.children)];
};
const all = (tree, type) => nodes(tree).filter((n) => n.type === type);
const one = (tree, type) => {
  const found = all(tree, type);
  assert.equal(found.length, 1, type);
  return found[0].props;
};
const texts = (tree) => {
  if (typeof tree === 'string' || typeof tree === 'number') return [String(tree)];
  if (!tree) return [];
  if (Array.isArray(tree)) return tree.flatMap(texts);
  if (typeof tree.type === 'function') return texts(tree.type(tree.props));
  return texts(tree.props?.children);
};
const equal = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const hashRaw = (v) =>
  crypto
    .createHash('sha256')
    .update(typeof v === 'string' ? v : JSON.stringify(v))
    .digest('hex');
const hashHistorical = (v) => hashRaw(JSON.stringify(v));
const baseline = require('./quiz-controls.baseline.json');
for (const lang of ['en', 'fr', 'ar']) {
  const catalog = load('@/i18n/' + lang)[lang];
  const historical = require('./tool-launch-consumers.baseline.json').catalogs[lang];
  assert.equal(Object.keys(historical).length, 2330);
  assert.equal(Object.keys(baseline.catalogs[lang]).length, 35);
  for (const [key, hash] of Object.entries(historical))
    assert.equal(hashHistorical(catalog[key]), hash, key);
  for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
    assert.equal(hashRaw(catalog[key]), hash, key);
  assert.equal(Object.keys(catalog).filter((k) => k.startsWith('quizPresentation.')).length, 85);
}
for (const [file, hash] of Object.entries(baseline.sources)) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  // Authorized full parent migration: quiz-attempt-screen.check.cjs executes the actual
  // screen/route interface, protocols and lifetimes. Historical digest remains in baseline.
  if (file.endsWith('QuizAttemptScreen.tsx')) continue;
  // QUIZ-2/4 explicitly supersedes engine/storage freezes with real protocol/race
  // checks in quiz-engine.check.cjs. Original historical hashes remain untouched.
  if (file.endsWith('useQuizAttempt.ts') || file.endsWith('storage.ts')) continue;

  assert.equal(hashRaw(source), hash, file);
}
// Pre-slice legacy algorithms, independently retained for parity over all seconds
// through two hours and fractional/negative/non-finite legacy inputs.
function legacyClock(seconds) {
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = seconds % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
for (const [seconds, expected] of [[86400, '1d 0h'], [183600, '2d 3h'], [7946280, '91d 23h']]) {
  assert.equal(timer.formatClock(seconds), expected);
}
function legacySpoken(seconds) {
  if (seconds <= 0) return 'Time is up';
  if (seconds < 60) return 'Less than a minute left';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`;
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return `${h} ${h === 1 ? 'hour' : 'hours'}${m ? ` ${m} ${m === 1 ? 'minute' : 'minutes'}` : ''} left`;
}
for (const seconds of [
  ...Array.from({ length: 7202 }, (_, i) => i),
  -1,
  0.5,
  59.9,
  60.1,
  3599.5,
  Infinity,
  NaN,
]) {
  assert.equal(timer.formatClock(seconds), legacyClock(seconds));
  assert.equal(timer.spokenTimeLeft(seconds), legacySpoken(seconds));
  if (Number.isFinite(seconds))
    assert.equal(
      timer.localizedTimeLeft(seconds, runtime.createTranslator('en')),
      legacySpoken(seconds),
    );
  for (const lang of ['en', 'fr', 'ar']) {
    const digits = new Intl.NumberFormat(lang, { useGrouping: false });
    assert.equal(
      timer.localizedClock(seconds, lang),
      legacyClock(seconds).replace(/[0-9]/g, (d) => digits.format(Number(d))),
    );
  }
}
function reset() {
  account = session.account;
  client = session.client;
  locale('en');
  events.length = 0;
  animations.length = 0;
  reduced = false;
}
// Mounted timer: one-time windows, retained toggle, live motion, no tick restarts.
reset();
let tp = { seconds: 601, attemptKey: 'course/quiz/attempt' };
let tm = mount(() => timer.QuizTimer(tp));
let tree = tm.render();
assert.equal(one(tree, 'Pressable').accessibilityRole, 'timer');
for (const seconds of [600, 599, 596, 595, 600, 301, 300, 299, 61, 60, 59, 31, 30, 29, 0]) {
  tp = { ...tp, seconds };
  tree = tm.render();
  const tone = one(tree, 'Icon').tone;
  assert.equal(tone, seconds <= 60 ? 'danger' : seconds <= 300 ? 'warning' : 'default');
}
equal(
  events.filter((e) => e[0] === 'announce').map((e) => e[1]),
  ['10 minutes left', '5 minutes left', '1 minute left', 'Less than a minute left'],
);
assert.equal(events.filter((e) => e[0] === 'warning').length, 2);
assert.equal(animations.filter((e) => e[0] === 'set' && typeof e[1] === 'object').length, 1);
tp = { ...tp, seconds: 60 };
tree = tm.render();
const toggle = one(tree, 'Pressable').onPress;
toggle();
tree = tm.render();
assert.equal(one(tree, 'Pressable').accessibilityLabel, 'Timer hidden');
for (const lang of ['fr', 'ar', 'en']) {
  const t = locale(lang);
  tree = tm.render();
  assert.equal(one(tree, 'Pressable').accessibilityLabel, t('quizControls.timerHidden'));
  assert.equal(one(tree, 'Pressable').accessibilityHint, t('quizControls.showHint'));
  assert.ok(texts(tree).includes(t('quizControls.showTime')));
}
assert.equal(events.filter((e) => e[0] === 'announce').length, 4);
toggle();
tree = tm.render();
assert.equal(one(tree, 'Pressable').accessibilityLabel, '1 minute left');
const pulseCount = () => animations.filter((e) => e[0] === 'set' && typeof e[1] === 'object').length;
let count = pulseCount();
for (const seconds of [59, 58, 57]) {
  tp = { ...tp, seconds };
  tm.render();
}
assert.equal(pulseCount(), count);
reduced = true;
tm.render();
assert.equal(animations.at(-1)[1], 1);
reduced = false;
tm.render();
assert.equal(pulseCount(), ++count);
// Discarded resource render neither retires committed callbacks nor publishes state.
const old = tp;
tp = { ...tp, attemptKey: 'discard' };
const discardedToggle = one(tm.renderOnly(), 'Pressable').onPress;
tm.abandon();
tp = old;
discardedToggle();
toggle();
tree = tm.render();
assert.equal(one(tree, 'Pressable').accessibilityLabel, 'Timer hidden');
tm.replayEffects();
tree = tm.render();
assert.equal(events.filter((e) => e[0] === 'announce').length, 4);
tm.unmount();
const eventCount = events.length;
toggle();
assert.equal(events.length, eventCount);
assert.equal(animations.at(-1)[1], 1);
// Localized visible clock, spoken boundaries and native announcements consume
// explicit subscribed inputs; these checks do not depend on host Arabic digits.
for (const lang of ['en', 'fr', 'ar']) {
  reset();
  const t = locale(lang);
  for (const seconds of [0, 1, 59, 60, 61, 300, 600, 3540, 3541, 3599, 3600, 3601, 7200]) {
    const m = mount(() => timer.QuizTimer({ seconds }));
    const tree = m.render();
    assert.ok(texts(tree).includes(timer.localizedClock(seconds, lang)));
    assert.equal(one(tree, 'Pressable').accessibilityLabel, timer.localizedTimeLeft(seconds, t));
    assert.equal(one(tree, 'Pressable').accessibilityHint, t('quizControls.hideHint'));
    if ([60, 300, 600].includes(seconds))
      assert.equal(
        events.filter((e) => e[0] === 'announce').at(-1)[1],
        timer.localizedTimeLeft(seconds, t),
      );
    m.unmount();
  }
  assert.equal(
    timer.localizedTimeLeft(3541, t),
    t('quizControls.hoursLeft', { hours: t('quizPresentation.hours', { count: 1 }) }),
  );
  assert.equal(
    timer.localizedTimeLeft(3601, t),
    t('quizControls.hoursMinutesLeft', {
      hours: t('quizPresentation.hours', { count: 1 }),
      minutes: t('quizPresentation.minutes', { count: 1 }),
    }),
  );
}
// A remounted attempt starts fresh; its predecessor's toggle remains retired.
reset();
tp = { seconds: 60, attemptKey: 'same' };
tm = mount(() => timer.QuizTimer(tp));
const retiredToggle = one(tm.render(), 'Pressable').onPress;
retiredToggle();
tm.render();
tm.unmount();
tm = mount(() => timer.QuizTimer(tp));
retiredToggle();
assert.equal(one(tm.render(), 'Pressable').accessibilityLabel, '1 minute left');
assert.equal(events.filter((e) => e[0] === 'announce').length, 2);
tm.unmount();
// Every semantic identity replacement resets hidden state/marks and retires toggles.
for (const mode of ['attempt', 'account', 'client']) {
  reset();
  tp = { seconds: 60, attemptKey: 'a' };
  tm = mount(() => timer.QuizTimer(tp));
  tree = tm.render();
  const stale = one(tree, 'Pressable').onPress;
  stale();
  tm.render();
  if (mode === 'attempt') tp = { ...tp, attemptKey: 'b' };
  if (mode === 'account') account = { id: 'B' };
  if (mode === 'client') client = {};
  tree = tm.render();
  stale();
  tree = tm.render();
  assert.equal(one(tree, 'Pressable').accessibilityLabel, '1 minute left');
  assert.equal(events.filter((e) => e[0] === 'announce').length, 2);
  tp = { seconds: 60, attemptKey: 'a' };
  account = session.account;
  client = session.client;
  tree = tm.render();
  stale();
  tree = tm.render();
  assert.equal(one(tree, 'Pressable').accessibilityLabel, '1 minute left');
  tm.unmount();
}
// Threshold lower edge is exclusive; below it no catch-up announcement.
for (const mark of [600, 300, 60, 30])
  for (const offset of [0, 4, 5, 6]) {
    reset();
    tm = mount(() => timer.QuizTimer({ seconds: mark - offset }));
    tm.render();
    assert.equal(events.filter((e) => e[0] === 'announce').length, offset < 5 ? 1 : 0);
    tm.unmount();
  }
const question = (id, type, answer, extra = {}) => ({
  id,
  type,
  answer,
  html: '<p>RAW &amp; العربية</p>',
  answers: [],
  blanks: [],
  ...extra,
});
const fixtures = [
  question('info', 'text_only_question', { kind: 'none' }),
  question('empty', 'multiple_choice_question', { kind: 'choice', id: null }),
  question(
    'partial',
    'fill_in_multiple_blanks_question',
    { kind: 'blanks', values: { a: 'raw', b: '' } },
    {
      blanks: [{ id: 'a' }, { id: 'b' }],
      html:
        '<p>RAW \\(x\\) <span class="easel-blank" data-id="b">2</span> $$ &amp; العربية ' +
        'long '.repeat(30) +
        '</p>',
    },
  ),
  question('done', 'multiple_choice_question', { kind: 'choice', id: 'raw-id' }),
  question(
    'match',
    'matching_question',
    { kind: 'matching', pairs: [{ answerId: 'a', matchId: 'm' }] },
    { answers: [{ id: 'a' }, { id: 'b' }] },
  ),
];
function props() {
  return {
    attemptKey: 'a',
    questions: fixtures,
    answers: {},
    flags: { info: true, partial: true, done: true },
    numbers: questionNumbers(fixtures),
    current: 2,
    visible: true,
    onGo: (i) => events.push(['go', i]),
    onClose: () => events.push(['close']),
    onReview: () => events.push(['review']),
  };
}
reset();
let np = props(),
  rp = np;
const nav = mount(() => QuestionNavigator(np)),
  review = mount(() => ReviewPanel(rp));
let nt = nav.render(),
  rt = review.render();
const retained = all(nt, 'Pressable')[2].props.onPress;
const retainedReview = all(rt, 'ListItem')[1].props.onPress;
let rowKey;
for (const lang of ['en', 'fr', 'ar']) {
  const t = locale(lang),
    digits = new Intl.NumberFormat(lang, { useGrouping: false });
  nt = nav.render();
  rt = review.render();
  events.length = 0;
  retainedReview();
  equal(events, [['go', 2]]);
  assert.equal(one(nt, 'Sheet').title, t('quizPresentation.questions'));
  assert.ok(texts(nt).includes(t('quizControls.reviewSubmit')));
  for (const key of ['answered', 'partial', 'unanswered', 'flagged'])
    assert.ok(texts(nt).includes(t('quizControls.' + key)));
  const buttons = all(nt, 'Pressable');
  assert.equal(buttons.length, 5);
  assert.equal(buttons[0].props.accessibilityLabel, t('quizControls.information'));
  assert.equal(
    buttons[2].props.accessibilityLabel,
    [
      t('quizControls.question', { number: digits.format(2) }),
      t('quizControls.partial'),
      t('quizControls.flagged'),
      t('quizControls.current'),
    ].join(', '),
  );
  equal(
    buttons.map((b) => b.props.accessibilityState.selected),
    [false, false, true, false, false],
  );
  for (let i = 0; i < buttons.length; i++) {
    events.length = 0;
    buttons[i].props.onPress();
    equal(events, [['selection'], ['go', i]]);
  }
  assert.equal(one(rt, 'ProgressBar').value, 3 / 4); // partial counts as answered
  assert.ok(texts(rt).includes(t('quizControls.progress', { answered: 3, total: 4 })));
  assert.ok(
    all(rt, 'View').some(
      (v) => v.props.accessibilityLabel === t('quizControls.progressLabel', { answered: 3, total: 4 }),
    ),
  );
  const rows = all(rt, 'ListItem');
  equal(
    rows.map((r) => r.key),
    ['empty', 'partial', 'match', 'partial', 'done'],
  );
  assert.equal(rows[1].props.subtitle, ('RAW x ___ & العربية ' + 'long '.repeat(30)).slice(0, 90));
  assert.equal(rows[1].props.accessibilityHint, t('quizControls.goHint'));
  assert.equal(rows[1].props.title, t('quizControls.question', { number: digits.format(2) }));
  assert.ok(rows[1].props.accessibilityLabel.includes(rows[1].props.subtitle));
  rowKey ??= rows[1].key;
  assert.equal(rows[1].key, rowKey);
  for (const [i, row] of rows.entries()) {
    events.length = 0;
    row.props.onPress();
    equal(events, [['go', [1, 2, 4, 2, 3][i]]]);
  }
  assert.equal(all(rt, 'Callout').length, 0);
}
// Same membership/new objects/answer/flag/current/title-like raw text changes preserve callbacks.
np = {
  ...np,
  questions: fixtures.map((q) => ({ ...q, html: 'new raw title' })),
  current: 0,
  flags: {},
  answers: { empty: { kind: 'choice', id: 'x' } },
  onGo: (i) => events.push(['new-go', i]),
};
nt = nav.render();
events.length = 0;
retained();
equal(events, [['selection'], ['new-go', 2]]);
assert.ok(
  all(nt, 'Pressable')[0].props.accessibilityLabel.endsWith(
    runtime.createTranslator('ar')('quizControls.current'),
  ),
);
// Explicit custom number mapping doesn't change indices; absent info mapping retained.
np = {
  ...np,
  numbers: new Map([
    ['empty', 42],
    ['partial', 7],
    ['done', 10],
    ['match', 11],
  ]),
};
nt = nav.render();
assert.ok(
  all(nt, 'Pressable')[1].props.accessibilityLabel.includes(new Intl.NumberFormat('ar').format(42)),
);
nav.unmount();
review.unmount();
// All answer forms execute actual answerState through both production components.
const cases = [
  ['multiple_choice_question', { kind: 'choice', id: 'x' }, 'answered'],
  ['multiple_answers_question', { kind: 'choices', ids: [] }, 'unanswered'],
  ['multiple_answers_question', { kind: 'choices', ids: ['x'] }, 'answered'],
  ['matching_question', { kind: 'matching', pairs: [] }, 'unanswered', { answers: [{ id: 'a' }] }],
  [
    'matching_question',
    { kind: 'matching', pairs: [{ answerId: 'a', matchId: 'm' }] },
    'answered',
    { answers: [{ id: 'a' }] },
  ],
  [
    'fill_in_multiple_blanks_question',
    { kind: 'blanks', values: { a: ' ' } },
    'unanswered',
    { blanks: [{ id: 'a' }] },
  ],
  ['fill_in_multiple_blanks_question', { kind: 'blanks', values: { a: 'raw' } }, 'answered'],
  ['essay_question', { kind: 'text', value: '<p> </p>' }, 'unanswered'],
  ['essay_question', { kind: 'text', value: '<p>RAW</p>' }, 'answered'],
  ['numerical_question', { kind: 'text', value: '-1,5e2' }, 'answered'],
  ['calculated_question', { kind: 'text', value: 'invalid' }, 'unanswered'],
  ['short_answer_question', { kind: 'text', value: 'RAW' }, 'answered'],
  ['file_upload_question', { kind: 'file', attachmentId: null }, 'unanswered'],
  ['file_upload_question', { kind: 'file', attachmentId: 'f' }, 'answered'],
  ['unknown', { kind: 'none' }, 'unanswered'],
];
for (const [type, answer, state, extra] of cases) {
  reset();
  const q = question('q', type, answer, extra);
  assert.equal(answerState(q, answer), state);
  const p = { ...props(), questions: [q], numbers: new Map([['q', 1]]), flags: {}, current: 0 };
  const n = mount(() => QuestionNavigator(p)),
    r = mount(() => ReviewPanel(p));
  assert.ok(
    one(n.render(), 'Pressable').accessibilityLabel.includes(
      runtime.createTranslator('en')('quizControls.' + state),
    ),
  );
  assert.equal(one(r.render(), 'ProgressBar').value, state === 'unanswered' ? 0 : 1);
  n.unmount();
  r.unmount();
}
// Empty quiz and information-only quiz retain complete progress (1) and success callout.
for (const questions of [[], [fixtures[0]]]) {
  reset();
  const r = mount(() => ReviewPanel({ ...props(), questions }));
  const tree = r.render();
  assert.equal(one(tree, 'ProgressBar').value, 1);
  assert.equal(all(tree, 'ListItem').length, 0);
  assert.equal(one(tree, 'Callout').title, 'Every question has an answer');
  r.unmount();
}
// Committed publication vs speculative render, all retirement modes and away/back.
for (const component of ['nav', 'review'])
  for (const mode of ['attempt', 'account', 'client', 'order', 'membership', 'hidden', 'unmount']) {
    if (component === 'review' && mode === 'hidden') continue;
    reset();
    let p = props();
    const m = mount(() => (component === 'nav' ? QuestionNavigator(p) : ReviewPanel(p)));
    const actions = (tree) =>
      component === 'nav'
        ? [
            all(tree, 'Pressable')[1].props.onPress,
            one(tree, 'Sheet').onClose,
            one(tree, 'Button').onPress,
          ]
        : all(tree, 'ListItem').map((n) => n.props.onPress);
    let tree = m.render();
    const stale = actions(tree),
      saved = p;
    p = { ...p, attemptKey: 'discard', onGo: (i) => events.push(['discard-go', i]) };
    const discarded = actions(m.renderOnly());
    m.abandon();
    p = saved;
    events.length = 0;
    discarded.forEach((fn) => fn());
    assert.equal(events.length, 0);
    stale.forEach((fn) => fn());
    assert.ok(events.some((e) => e[0] === 'go'));
    // Same-owner discarded callback publication must not replace committed go.
    p = { ...p, onGo: (i) => events.push(['discard-go', i]) };
    m.renderOnly();
    m.abandon();
    p = saved;
    events.length = 0;
    stale[0]();
    assert.ok(events.some((e) => e[0] === 'go'));
    if (mode === 'attempt') p = { ...p, attemptKey: 'b' };
    if (mode === 'account') account = { id: 'B' };
    if (mode === 'client') client = {};
    if (mode === 'order') p = { ...p, questions: [...p.questions].reverse() };
    if (mode === 'membership') p = { ...p, questions: p.questions.slice(1) };
    if (mode === 'hidden') p = { ...p, visible: false };
    if (mode === 'unmount') m.unmount();
    else tree = m.render();
    events.length = 0;
    stale.forEach((fn) => fn());
    assert.equal(events.length, 0, component + ' ' + mode);
    if (mode === 'unmount') continue;
    if (mode === 'hidden') {
      actions(tree).forEach((fn) => fn());
      assert.equal(events.length, 0);
    }
    p = saved;
    account = session.account;
    client = session.client;
    tree = m.render();
    events.length = 0;
    stale.forEach((fn) => fn());
    assert.equal(events.length, 0, 'away/back');
    actions(tree)[0]();
    assert.ok(events.some((e) => e[0] === 'go'));
    m.unmount();
  }
console.log(
  'quiz-controls: production presentation, legacy parity, committed lifetimes, timer/motion and 2365 historical values preserved (' +
    process.env.TZ +
    ')',
);
