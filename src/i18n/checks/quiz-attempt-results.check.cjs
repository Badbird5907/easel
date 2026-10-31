const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
// Production quiz components/helpers; staged commit/discard React hooks and
// explicit native/query/browser/child boundaries. No HTTP or native UI operations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const h = require('./submission-form.check.cjs');
const { mocks, elements, boundary, calls, allow, all, deferred, flush, equal, setEnvironment } = h;
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
Object.assign(mocks.react, react);
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
  'canvas/api/cacheSeed',
  'features/planner/submissionCache',
  'i18n',
  'i18n/runtime',
  'i18n/en',
  'i18n/fr',
  'i18n/ar',
  'lib/dates',
  'canvas/api/quizzes',
  'canvas/client',
  'canvas/html',
  'features/course/format',
  'features/course/FactList',
  'features/grades/calculate',
  'features/grades/format',
  'features/quizzes/QuizHistory',
  'features/quizzes/quizPresentation',
  'features/quizzes/AttemptResults',
  'features/quizzes/quizAttemptResults',
  'app/(app)/course/[courseId]/quiz/[quizId]/attempt/[attempt]',
]);
function load(name, parent = path.join(root, 'entry.ts')) {
  if (isIntlPolyfills(name)) return intlPolyfills;
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mocks[key]) return mocks[key];
  assert.ok(key.startsWith('@/') && allowed.has(key.slice(2)), 'Unexpected import ' + key);
  const file = ['.ts', '.tsx', '/index.ts'].map((e) => path.join(root, key.slice(2)) + e).find(fs.existsSync);
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
Object.assign(mocks['@/design'], elements('Icon ProgressRing ListGroup ListItem Section Screen'));
mocks['lucide-react-native'] = elements(
  'Circle CircleCheck CircleDot CircleX EyeOff Globe Hourglass History',
);
mocks['@/features/course/CourseScope'] = elements('CourseScope');
let refreshKeys;
mocks['@/features/course/states'] = {
  ...elements('DetailSkeleton ListSkeleton LoadError'),
  useRefreshControl: (keys) => {
    refreshKeys = keys;
    return 'REFRESH';
  },
};
mocks['@/features/web/open'] = { openWebView: boundary('web') };
mocks['expo-crypto'] = { CryptoDigestAlgorithm: {}, digestStringAsync: boundary('crypto') };
for (const n of ['canvas/client', 'canvas/html', 'features/grades/calculate', 'features/grades/format'])
  delete mocks['@/' + n];
const api = load('@/canvas/api/quizzes');
let quiz, history, course, assignment, questions, params;
mocks['@/canvas/api/quizzes'] = {
  ...api,
  useQuiz: () => quiz,
  useQuizHistory: () => history,
  useAttemptQuestions: (...args) => {
    equal(args, [
      params.courseId,
      quiz.data.id,
      history.data.find((s) => s.attempt === params.attempt).id,
      params.attempt,
    ]);
    return questions;
  },
};
mocks['@/canvas/api/courses'] = { useCourse: () => course };
mocks['@/canvas/api/assignments'].useAssignment = () => assignment;
mocks['expo-router'].useLocalSearchParams = () => ({ ...params, attempt: String(params.attempt) });
const ui = load('@/features/quizzes/AttemptResults');
const route = load('@/app/(app)/course/[courseId]/quiz/[quizId]/attempt/[attempt]').default;
const presentation = load('@/features/quizzes/quizPresentation');
const legacy = load('@/features/quizzes/QuizHistory');
const runtime = load('@/i18n/runtime'),
  dates = load('@/lib/dates');
const { CanvasError } = load('@/canvas/client');
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const query = (data) => ({
  data,
  isError: false,
  isPending: false,
  error: null,
  refetch: boundary('refetch'),
});
const locale = (lang) => {
  runtime.setAccountLocale('attempt-test', lang);
  return runtime.createTranslator(lang);
};
const session = { account: { id: 'A', baseUrl: 'https://raw.school' }, client: {} };
function setup() {
  setEnvironment(session);
  locale('en');
  dates.setDisplayTimeZone('America/Los_Angeles');
  params = { courseId: 'c/raw', quizId: 'q/raw', attempt: 2 };
  quiz = query({
    id: params.quizId,
    title: 'RAW quiz العربية',
    type: 'assignment',
    points: 25,
    assignmentId: 'a',
    allowedAttempts: 3,
    oneQuestionAtATime: false,
    results: {
      hide: null,
      oneTimeResults: false,
      showCorrectAnswers: true,
      showCorrectAnswersLastAttempt: false,
      showCorrectAnswersAt: null,
      hideCorrectAnswersAt: null,
      lockdownOnly: false,
    },
  });
  history = query([
    {
      id: 's/raw',
      attempt: 2,
      workflowState: 'complete',
      hasSeenResults: false,
      score: 22.345,
      pointsPossible: 25,
      attemptsLeft: 1,
      finishedAt: new Date('2027-01-01T00:30:00Z'),
      timeSpent: 3900,
      resultUrl: null,
    },
  ]);
  course = query({ restricted: false });
  assignment = query({ restricted: false });
  questions = query({
    status: 'ok',
    questions: [
      {
        id: '1',
        name: 'Question 1',
        generatedNameOrdinal: 1,
        text: 'RAW text العربية',
        points: 2.345,
        outcome: 'correct',
      },
      { id: '2', name: 'Question 1', text: 'RAW legacy', points: 0, outcome: 'incorrect' },
      { id: '3', name: 'RAW name', text: '', points: null, outcome: 'partial' },
      { id: '4', name: 'RAW pending', text: '', points: 4, outcome: 'pending' },
      { id: '5', name: 'RAW ungraded', text: '', points: null, outcome: null },
    ],
  });
}
const render = () => ui.AttemptResults(params);
const visible = (tree) =>
  JSON.stringify(tree, (k, v) => (k === 'error' ? v?.message : typeof v === 'function' ? undefined : v));
const child = (tree) =>
  h.nodes(tree).find((n) => typeof n.type === 'function' && n.type.name === 'QuestionResults');
const browser = (tree) => all(tree, 'Button')[0]?.props.onPress;
const retry = (tree) =>
  all(tree, 'LoadError')[0]?.props.onRetry ??
  all(tree, 'Callout').find((n) => n.props.action)?.props.action.onPress;
const count = (name) => calls.filter((c) => c[0] === name).length;
const failQuery = (q) => {
  q.isError = true;
  q.error = Error('RAW failure العربية');
};
async function run() {
  const historical = require('./tool-launch-consumers.baseline.json');
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    for (const [key, digest] of Object.entries(historical.catalogs[lang]))
      assert.equal(hash(catalog[key]), digest, key);
    assert.equal(Object.keys(catalog).filter((k) => k.startsWith('quizAttemptResults.')).length, 35);
  }
  // Full historical API provenance, with only the two additive metadata hunks removed.
  let source = fs.readFileSync(path.join(root, 'canvas/api/quizzes.ts'), 'utf8');
  for (const addition of [
    '  /** Present only for an Easel-generated fallback; absent in older caches/raw names. */\n  generatedNameOrdinal?: number;\n',
    '        ...(!q.question_name ? { generatedNameOrdinal: index + 1 } : {}),\n',
  ]) {
    assert.equal(source.split(addition).length, 2);
    source = source.replace(addition, '');
  }
  assert.equal(hash(source), require('./quiz-presentation.baseline.json').sources['canvas/api/quizzes.ts']);
  // Actual adapter with a strict synthetic in-memory transport. No network.
  const signal = {},
    transport = { get: boundary('get') };
  allow('get', {
    quiz_submission_questions: [
      { id: 5, position: 5, question_name: 'Question 1', correct: true, points_possible: 0 },
      {
        id: 2,
        position: 2,
        question_name: '',
        question_text: '<p>RAW \\(x\\)</p>',
        correct: 'partial',
        points_possible: 2.345,
      },
      { id: 1, position: 1, question_type: 'text_only_question' },
      { id: 3, position: 3, correct: 'undefined' },
      { id: 4, position: 4, question_name: 'RAW', correct: false },
      { id: 6, position: 6, question_name: ' ', correct: 'other' },
    ],
  });
  const mapped = await api.fetchAttemptQuestions(transport, 's/raw', 2, signal);
  equal(calls.at(-1).slice(1), [
    '/api/v1/quiz_submissions/s/raw/questions',
    { quiz_submission_attempt: 2 },
    signal,
  ]);
  equal(mapped, {
    status: 'ok',
    questions: [
      {
        id: '2',
        position: 2,
        name: 'Question 1',
        generatedNameOrdinal: 1,
        text: 'RAW x',
        points: 2.345,
        outcome: 'partial',
      },
      {
        id: '3',
        position: 3,
        name: 'Question 2',
        generatedNameOrdinal: 2,
        text: '',
        points: null,
        outcome: 'pending',
      },
      { id: '4', position: 4, name: 'RAW', text: '', points: null, outcome: 'incorrect' },
      { id: '5', position: 5, name: 'Question 1', text: '', points: 0, outcome: 'correct' },
      { id: '6', position: 6, name: ' ', text: '', points: null, outcome: null },
    ],
  });
  allow('get', {});
  equal(await api.fetchAttemptQuestions(transport, 's', 1), { status: 'ok', questions: [] });
  for (const [message, status] of [
    ['Quiz settings RAW', 'hidden'],
    ['One question at a time RAW', 'unavailable'],
  ]) {
    allow('get', () => {
      throw new CanvasError(message, 403);
    });
    equal(await api.fetchAttemptQuestions(transport, 's', 1), { status, message });
  }
  const rawError = Error('RAW transport');
  allow('get', () => {
    throw rawError;
  });
  await assert.rejects(api.fetchAttemptQuestions(transport, 's', 1), (e) => e === rawError);
  // Real subscribed presentation across locales and Canvas zones, without re-creating the mount.
  setup();
  let m = mount(render),
    tree = m.render();
  let node = child(tree);
  const cm = mount(() => node.type(node.props)),
    pm = mount(presentation.useQuizPresentation),
    rm = mount(route);
  const oldOpen = browser(tree),
    before = calls.length;
  for (const lang of ['en', 'fr', 'ar']) {
    const t = locale(lang);
    tree = m.render();
    node = child(tree);
    const qt = cm.render(),
      p = pm.render();
    assert.ok(visible(tree).includes(t('quizPresentation.attempt', { count: 2 })));
    assert.ok(visible(tree).includes(p.score(22.345, 25, false)));
    assert.equal(all(tree, 'ProgressRing')[0].props.value, 22.345 / 25);
    assert.ok(all(tree, 'Card')[0].props.accessibilityLabel.includes(p.percent(22.345 / 25)));
    const rows = all(qt, 'ListItem');
    assert.equal(rows[0].props.title, t('quizAttemptResults.question', { count: 1 }));
    assert.equal(rows[1].props.title, 'Question 1');
    assert.equal(rows[2].props.title, 'RAW name');
    assert.equal(rows[0].props.subtitle, 'RAW text العربية');
    assert.equal(rows[0].props.value, p.points(2.345));
    for (const [i, key] of ['correct', 'incorrect', 'partial', 'pending', 'notGraded'].entries())
      assert.ok(rows[i].props.accessibilityLabel.includes(t('quizAttemptResults.' + key)));
    for (const key of ['Correct', 'Incorrect', 'Partial', 'Pending'])
      assert.ok(visible(qt).includes(t('quizAttemptResults.tally' + key, { count: 1 })));
    assert.equal(all(rm.render(), 'CourseScope')[0].props.title, t('quizPresentation.attempt', { count: 2 }));
    equal(refreshKeys, [['courses', 'c/raw', 'quizzes', 'q/raw']]);
    equal(all(rm.render(), ui.AttemptResults)[0].props, params);
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      dates.setDisplayTimeZone(zone);
      tree = m.render();
      const facts = all(tree, load('@/features/course/FactList').FactList)[0].props.facts.filter(Boolean);
      const expectedTime = new Intl.DateTimeFormat(lang, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: zone,
      }).format(history.data[0].finishedAt);
      assert.ok(facts[0].value.includes(expectedTime), facts[0].value);
      assert.equal(facts[1].value, pm.render().duration(3900));
    }
  }
  assert.equal(calls.length, before, 'locale/date rerenders perform no actions');
  quiz.data.title = 'NEW raw title';
  m.render();
  allow('web');
  oldOpen();
  equal(calls.at(-1)[1], {
    url: 'https://raw.school/courses/c/raw/quizzes/q/raw/history?quiz_submission_id=s%2Fraw&version=2',
    title: runtime.createTranslator('ar')('quizAttemptResults.webTitle', {
      title: quiz.data.title,
      count: 2,
    }),
    courseId: 'c/raw',
  });
  [m, cm, pm, rm].forEach((x) => x.unmount());
  // Numeric/UI/AT gating is independent of answer visibility.
  for (const mode of [
    'normal',
    'hiddenAnswers',
    'restricted',
    'coursePending',
    'courseMissing',
    'assignmentPending',
    'assignmentMissing',
    'courseError',
    'assignmentError',
    'quizError',
    'historyError',
    'survey',
    'graded_survey',
    'unknown',
  ]) {
    setup();
    if (mode === 'hiddenAnswers') quiz.data.results.hide = 'always';
    if (mode === 'restricted') course.data.restricted = true;
    for (const [prefix, q] of [
      ['course', course],
      ['assignment', assignment],
      ['quiz', quiz],
      ['history', history],
    ]) {
      if (mode === prefix + 'Pending') {
        q.data = undefined;
        q.isPending = true;
      }
      if (mode === prefix + 'Missing') q.data = undefined;
      if (mode === prefix + 'Error') failQuery(q);
    }
    if (['survey', 'graded_survey', 'unknown'].includes(mode)) quiz.data.type = mode;
    m = mount(render);
    tree = m.render();
    const numeric = ['normal', 'hiddenAnswers'].includes(mode);
    assert.equal(all(tree, 'ProgressRing').length, numeric ? 1 : 0, mode);
    assert.equal(visible(tree).includes('22.34/25'), numeric, mode);
    assert.equal(visible(tree).includes('89%'), numeric, mode);
    assert.equal(visible(tree).includes('Points possible'), numeric, mode);
    if (mode === 'restricted') assert.ok(visible(tree).includes('B+'));
    if (mode.endsWith('Error')) {
      assert.ok(visible(tree).includes('RAW failure العربية'));
      assert.equal(browser(tree), undefined);
    }
    const n = child(tree);
    if (n) {
      const c = mount(() => n.type(n.props));
      const rows = all(c.render(), 'ListItem');
      assert.equal(rows[0].props.value !== undefined, numeric, mode);
      assert.equal(rows[0].props.accessibilityLabel.includes('2.35'), numeric, mode);
      c.unmount();
    }
    m.unmount();
  }
  // Rounding/null/zero/clamping/pending parity with the frozen legacy helpers.
  for (const [score, points, fraction] of [
    [22.345, 25.123456, 22.345 / 25.123456],
    [null, 25, null],
    [0, 0, null],
    [0, 25, 0],
    [-1, 25, 0],
    [50, 25, 1],
    [1.005, null, null],
  ]) {
    setup();
    history.data[0].score = score;
    history.data[0].pointsPossible = points;
    quiz.data.points = points;
    history.data[0].workflowState = 'pending_review';
    m = mount(render);
    tree = m.render();
    const rings = all(tree, 'ProgressRing');
    assert.equal(rings.length, fraction === null ? 0 : 1);
    if (rings.length) assert.equal(rings[0].props.value, fraction);
    const expected = legacy.attemptScore(score, points, false);
    if (expected !== null) assert.ok(visible(tree).includes(expected + ' so far'));
    assert.ok(visible(tree).includes('Some answers need grading'));
    m.unmount();
  }
  // Unchanged policy algorithms, exact date boundaries, and each localized reason.
  const now = new Date('2026-10-30T12:00:00Z');
  setup();
  const q = quiz.data,
    s = history.data[0];
  q.results.showCorrectAnswersAt = now;
  assert.equal(api.showsCorrectAnswers(q, s, 1, now), false);
  assert.equal(api.showsCorrectAnswers(q, s, 1, new Date(+now + 1)), true);
  q.results.showCorrectAnswersAt = null;
  q.results.hideCorrectAnswersAt = now;
  assert.equal(api.showsCorrectAnswers(q, s, 1, now), true);
  assert.equal(api.showsCorrectAnswers(q, s, 1, new Date(+now + 1)), false);
  q.results.oneTimeResults = true;
  assert.equal(api.showsCorrectAnswers(q, s, 1, new Date(+now + 1)), true);
  s.hasSeenResults = true;
  assert.equal(api.resultsVisible(q, s), false);
  q.results.oneTimeResults = false;
  q.results.showCorrectAnswersLastAttempt = true;
  assert.equal(api.showsCorrectAnswers(q, s, 1, now), false);
  assert.equal(api.showsCorrectAnswers(q, s, 0, now), true);
  s.workflowState = 'untaken';
  assert.equal(api.showsCorrectAnswers(q, s, 0, now), false);
  q.results.hide = 'until_after_last_attempt';
  q.allowedAttempts = 2;
  assert.equal(api.resultsVisible(q, s), false);
  s.workflowState = 'pending_review';
  assert.equal(api.resultsVisible(q, s), true);
  q.allowedAttempts = null;
  assert.equal(api.resultsVisible(q, s), true);
  for (const lang of ['en', 'fr', 'ar'])
    for (const [mode, key] of [
      ['always', 'noResults'],
      ['last', 'afterLast'],
      ['once', 'once'],
      ['noCorrect', 'noCorrect'],
      ['correctLast', 'correctLast'],
      ['stopped', 'correctStopped'],
      ['after', 'correctAfter'],
      ['lockdown', 'lockdownHelp'],
      ['oneQuestion', 'oneQuestion'],
    ]) {
      setup();
      const t = locale(lang),
        r = quiz.data.results;
      if (mode === 'always') r.hide = 'always';
      if (mode === 'last') r.hide = 'until_after_last_attempt';
      if (mode === 'once') {
        r.oneTimeResults = true;
        history.data[0].hasSeenResults = true;
      }
      if (mode === 'noCorrect') r.showCorrectAnswers = false;
      if (mode === 'correctLast') r.showCorrectAnswersLastAttempt = true;
      if (mode === 'stopped') r.hideCorrectAnswersAt = new Date('2000-01-01T00:30:00Z');
      if (mode === 'after') r.showCorrectAnswersAt = new Date('2100-01-01T00:30:00Z');
      if (mode === 'lockdown') r.lockdownOnly = true;
      if (mode === 'oneQuestion') quiz.data.oneQuestionAtATime = true;
      m = mount(render);
      tree = m.render();
      const p = mount(presentation.useQuizPresentation),
        pp = p.render();
      const date =
        mode === 'stopped'
          ? pp.date(r.hideCorrectAnswersAt)
          : mode === 'after'
            ? pp.date(r.showCorrectAnswersAt)
            : '';
      assert.ok(visible(tree).includes(t('quizAttemptResults.' + key, { date })), mode);
      assert.equal(child(tree), undefined);
      assert.equal(all(tree, 'ProgressRing').length, 1, 'answer hiding does not hide grades');
      assert.equal(!!browser(tree), !['always', 'last', 'once', 'lockdown'].includes(mode), mode);
      m.unmount();
      p.unmount();
    }
  for (const lang of ['en', 'fr', 'ar'])
    for (const status of ['hidden', 'unavailable', 'empty', 'missing', 'pending', 'error']) {
      setup();
      const t = locale(lang);
      m = mount(render);
      const n = child(m.render());
      if (['hidden', 'unavailable'].includes(status)) questions.data = { status, message: 'RAW policy' };
      if (status === 'empty') questions.data.questions = [];
      if (status === 'missing') questions.data = undefined;
      if (status === 'pending') questions.isPending = true;
      if (status === 'error') failQuery(questions);
      const c = mount(() => n.type(n.props)),
        tree = c.render();
      assert.equal(all(tree, 'ListItem').length, 0);
      if (status === 'pending') assert.equal(all(tree, 'ListSkeleton').length, 1);
      else
        assert.ok(
          visible(tree).includes(
            t(
              'quizAttemptResults.' +
                {
                  hidden: 'hidden',
                  unavailable: 'onCanvas',
                  empty: 'empty',
                  missing: 'loadQuestions',
                  error: 'loadQuestions',
                }[status],
            ),
          ),
        );
      if (status === 'error') {
        const cb = retry(tree);
        allow('refetch');
        await cb();
        c.unmount();
        await cb();
      } else c.unmount();
      m.unmount();
    }
  // Localized tallies use actual question rows for all cardinal/count boundaries.
  for (const lang of ['en', 'fr', 'ar'])
    for (const count of [0, 1, 2, 3, 11, 100]) {
      setup();
      const t = locale(lang);
      questions.data.questions = Array.from({ length: count }, (_, i) => ({
        id: String(i),
        name: 'RAW',
        text: '',
        points: null,
        outcome: 'correct',
      }));
      m = mount(render);
      const n = child(m.render());
      const c = mount(() => n.type(n.props));
      const tree = c.render();
      assert.ok(
        visible(tree).includes(
          t(count ? 'quizAttemptResults.tallyCorrect' : 'quizAttemptResults.empty', { count }),
        ),
      );
      c.unmount();
      m.unmount();
    }
  // No assignment lookup is needed for unassigned quizzes; zero-time facts stay omitted.
  setup();
  quiz.data.assignmentId = null;
  assignment.data = undefined;
  assignment.isPending = true;
  history.data[0].timeSpent = 0;
  m = mount(render);
  tree = m.render();
  assert.equal(all(tree, 'ProgressRing').length, 1);
  assert.equal(
    all(tree, load('@/features/course/FactList').FactList)[0].props.facts.filter(Boolean).length,
    2,
  );
  m.unmount();
  // Effect cleanup revokes queued retry tokens; replay never revives an old batch.
  setup();
  failQuery(history);
  m = mount(render);
  const cbReplay = retry(m.render());
  const beforeReplay = count('refetch'),
    replayWork = cbReplay();
  m.replayEffects();
  await replayWork;
  assert.equal(count('refetch'), beforeReplay);
  for (let i = 0; i < 4; i++) allow('refetch');
  await retry(m.render())();
  assert.equal(count('refetch'), beforeReplay + 4);
  m.unmount();
  // Query failure/missing cache leaves useful headings but no fresh web permission.
  for (const mode of [
    'missingQuiz',
    'pendingQuiz',
    'missingHistory',
    'pendingHistory',
    'missingAttempt',
    'failedNoCache',
  ]) {
    setup();
    if (mode.endsWith('Quiz')) {
      quiz.data = undefined;
      quiz.isPending = mode.startsWith('pending');
    }
    if (mode.endsWith('History')) {
      history.data = undefined;
      history.isPending = mode.startsWith('pending');
    }
    if (mode === 'missingAttempt') history.data = [];
    if (mode === 'failedNoCache') {
      quiz.data = undefined;
      failQuery(quiz);
    }
    m = mount(render);
    tree = m.render();
    assert.equal(browser(tree), undefined);
    assert.equal(all(tree, 'ProgressRing').length, 0);
    if (mode.startsWith('pending')) assert.equal(all(tree, 'DetailSkeleton').length, 1);
    else assert.ok(retry(tree));
    m.unmount();
  }
  // Raw URL precedence (including empty URL) and exact web options.
  for (const url of ['https://RAW.host/result?x=%2f&text=ع', '']) {
    setup();
    history.data[0].resultUrl = url;
    m = mount(render);
    allow('web');
    browser(m.render())();
    equal(calls.at(-1)[1], { url, title: 'RAW quiz العربية: attempt 2', courseId: 'c/raw' });
    m.unmount();
  }
  // Discarded renders publish neither new target nor new title/locale to old callbacks.
  setup();
  m = mount(render);
  let cb = browser(m.render());
  params = { ...params, courseId: 'replacement' };
  quiz.data = { ...quiz.data, title: 'Discarded' };
  const discarded = browser(m.renderOnly());
  discarded();
  m.abandon();
  allow('web');
  cb();
  assert.equal(calls.at(-1)[1].courseId, 'c/raw');
  assert.equal(calls.at(-1)[1].title, 'RAW quiz العربية: attempt 2');
  m.unmount();
  cb();
  discarded();
  // Committed identity/policy/query/observer transitions revoke even on an away-and-back.
  for (const mode of [
    'account',
    'client',
    'course',
    'quiz',
    'attempt',
    'submission',
    'type',
    'policy',
    'url',
    'quizError',
    'historyError',
    'courseError',
    'assignmentError',
    'restricted',
    'observer',
  ]) {
    setup();
    m = mount(render);
    cb = browser(m.render());
    const saved = {
      params,
      quiz: { ...quiz, data: { ...quiz.data, results: { ...quiz.data.results } } },
      history: { ...history, data: history.data.map((s) => ({ ...s })) },
      course: { ...course, data: { ...course.data } },
      assignment: { ...assignment },
    };
    if (mode === 'account') setEnvironment({ account: { ...session.account, id: 'B' } });
    if (mode === 'client') setEnvironment({ client: {} });
    if (mode === 'course') params = { ...params, courseId: 'other' };
    if (mode === 'quiz') params = { ...params, quizId: 'other' };
    if (mode === 'attempt') params = { ...params, attempt: 3 };
    if (mode === 'submission') history.data[0].id = 'other';
    if (mode === 'type') quiz.data.type = 'unknown';
    if (mode === 'policy') quiz.data.results.lockdownOnly = true;
    if (mode === 'url') history.data[0].resultUrl = 'https://other';
    if (mode === 'restricted') course.data.restricted = true;
    if (mode === 'observer') quiz.refetch = boundary('newObserver');
    if (mode === 'quizError') failQuery(quiz);
    if (mode === 'historyError') failQuery(history);
    if (mode === 'courseError') failQuery(course);
    if (mode === 'assignmentError') failQuery(assignment);
    m.render();
    cb();
    ({ params, quiz, history, course, assignment } = saved);
    setEnvironment(session);
    m.render();
    cb();
    const fresh = browser(m.render());
    allow('web');
    fresh();
    m.unmount();
    fresh();
  }
  // Duplicate retry batches coalesce until ALL requests settle, including rejection.
  setup();
  failQuery(history);
  m = mount(render);
  cb = retry(m.render());
  const a = deferred(),
    b = deferred();
  allow('refetch', a.promise);
  allow('refetch', b.promise);
  allow('refetch');
  allow('refetch');
  const n = count('refetch'),
    work = cb();
  await cb();
  await flush();
  assert.equal(count('refetch'), n + 4);
  a.reject(Error('RAW rejected'));
  await flush();
  await cb();
  assert.equal(count('refetch'), n + 4);
  // Locale/title changes preserve in-flight claim and render current presentation.
  locale('fr');
  quiz.data = { ...quiz.data, title: 'NEW raw' };
  const sameRetry = retry(m.render());
  await sameRetry();
  assert.equal(count('refetch'), n + 4);
  b.resolve();
  await work;
  for (let i = 0; i < 4; i++) allow('refetch');
  await sameRetry();
  assert.equal(count('refetch'), n + 8);
  m.unmount();
  await cb();
  await sameRetry();
  // Queued requests revoked by a committed replacement/policy/query transition before entry.
  for (const mode of [
    'unmount',
    'account',
    'client',
    'course',
    'attempt',
    'policy',
    'recovery',
    'observer',
  ]) {
    setup();
    failQuery(history);
    m = mount(render);
    cb = retry(m.render());
    const n = count('refetch'),
      work = cb();
    if (mode === 'unmount') m.unmount();
    else {
      if (mode === 'account') setEnvironment({ account: { ...session.account, id: 'B' } });
      if (mode === 'client') setEnvironment({ client: {} });
      if (mode === 'course') params = { ...params, courseId: 'new' };
      if (mode === 'attempt') params = { ...params, attempt: 3 };
      if (mode === 'policy') quiz.data.results.hide = 'always';
      if (mode === 'recovery') {
        history.isError = false;
        history.error = null;
      }
      if (mode === 'observer') quiz.refetch = boundary('newObserver');
      m.render();
    }
    await work;
    await cb();
    assert.equal(count('refetch'), n, mode);
    if (mode !== 'unmount') m.unmount();
  }
  // Child retries also retire with committed numeric policy or question-query changes.
  for (const mode of ['policy', 'query', 'observer', 'unmount']) {
    setup();
    failQuery(questions);
    m = mount(render);
    let n = child(m.render());
    const c = mount(() => n.type(n.props));
    cb = retry(c.render());
    const before = count('refetch'),
      work = cb();
    if (mode === 'unmount') c.unmount();
    else {
      if (mode === 'policy') {
        course.data.restricted = true;
        n = child(m.render());
      }
      if (mode === 'query') {
        questions.isError = false;
        questions.error = null;
      }
      if (mode === 'observer') questions.refetch = boundary('newObserver');
      c.render();
    }
    await work;
    await cb();
    assert.equal(count('refetch'), before);
    if (mode !== 'unmount') c.unmount();
    m.unmount();
  }
  h.verifyBoundaries();
  console.log(
    'quiz-attempt-results: production UI/route/helpers/API, 2330 historical values + 35 keys, synthetic staged lifetimes passed (' +
      process.env.TZ +
      ')',
  );
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
