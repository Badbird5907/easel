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
  'i18n',
  'i18n/runtime',
  'i18n/en',
  'i18n/fr',
  'i18n/ar',
  'lib/dates',
  'features/course/format',
  'features/course/FactList',
  'features/grades/calculate',
  'features/grades/format',
  'features/course/QuizDetails',
  'features/quizzes/QuizHistory',
  'features/quizzes/QuizResult',
  'features/quizzes/quizPresentation',
  'app/(app)/course/[courseId]/quizzes',
  'app/(app)/course/[courseId]/quiz/[quizId]',
  'app/(app)/course/[courseId]/quiz/[quizId]/history',
  'app/(app)/course/[courseId]/quiz/[quizId]/result',
]);
function load(name, parent = path.join(root, 'entry.ts')) {
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
Object.assign(
  mocks['@/design'],
  elements('Badge Section EmptyState Screen Icon ProgressRing ListGroup ListItem'),
);
mocks['lucide-react-native'] = elements(
  'CircleCheck Hourglass ListChecks History KeyRound Lock ShieldAlert Wifi ClipboardCheck EyeOff Flag',
);
mocks['@/features/course/CourseScope'] = elements('CourseScope');
mocks['@/features/course/states'] = {
  ...elements('DetailSkeleton ListSkeleton LoadError'),
  useRefreshControl: () => null,
};
mocks['@/features/content/RichContent'] = elements('RichContent');
mocks['@/features/quizzes/TakeQuiz'] = elements('TakeQuiz');
mocks['@/features/course/navigation'] = { pushRoute: boundary('push') };
let gate = 'visible',
  params,
  qq,
  history,
  result,
  attempts,
  classic,
  fresh,
  course,
  assignment;
mocks['@/features/course/TabGate'] = { ...elements('TabDisabled'), useTabGate: () => gate };
mocks['expo-router'].useLocalSearchParams = () => params;
mocks['@/canvas/api/quizzes'] = {
  useQuiz: () => qq,
  useQuizHistory: () => history,
  useQuizSubmission: () => result,
  useQuizAttempts: () => attempts,
  useQuizzes: () => classic,
  useNewQuizzes: () => fresh,
};
mocks['@/canvas/api/courses'] = { useCourse: () => course };
mocks['@/canvas/api/assignments'].useAssignment = () => assignment;
delete mocks['@/features/grades/calculate'];
delete mocks['@/features/grades/format'];
const ui = load('@/features/course/QuizDetails');
const hi = load('@/features/quizzes/QuizHistory');
const res = load('@/features/quizzes/QuizResult');
const helper = load('@/features/quizzes/quizPresentation');
const listing = load('@/app/(app)/course/[courseId]/quizzes').default;
const routes = ['', '/history', '/result'].map(
  (s) => load('@/app/(app)/course/[courseId]/quiz/[quizId]' + s).default,
);
const runtime = load('@/i18n/runtime'),
  dates = load('@/lib/dates');
const locale = (lang) => {
  runtime.setAccountLocale('quiz-test', lang);
  return runtime.createTranslator(lang);
};
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const baseline = require('./quiz-presentation.baseline.json');
const query = (data) => ({
  data,
  isPending: false,
  isError: false,
  error: null,
  refetch: boundary('refetch'),
});
const rawQuiz = () => ({
  id: 'q/raw',
  title: 'RAW quiz العربية',
  html: '<p>RAW HTML</p>',
  type: 'assignment',
  points: 25,
  allowedAttempts: 3,
  questionCount: 2,
  timeLimitMinutes: 65,
  assignmentId: 'a',
  dueAt: new Date('2027-01-01T00:30:00Z'),
  unlockAt: null,
  lockAt: null,
  locked: false,
  lockExplanation: null,
  scoringPolicy: 'keep_highest',
  results: { hide: 'always' },
});
const rawSubmission = () => ({
  id: 'sub/raw',
  attempt: 2,
  score: 22.345,
  keptScore: 23.125,
  pointsPossible: 25,
  finishedAt: new Date('2027-01-01T00:30:00Z'),
  timeSpent: 3900,
  attemptsLeft: 0,
  workflowState: 'complete',
});
function setup() {
  setEnvironment({ account: { id: 'A', user: { id: 'u' } }, client: {}, online: true });
  locale('en');
  dates.setDisplayTimeZone('America/Los_Angeles');
  params = { courseId: 'c/raw', quizId: 'q/raw', submissionId: 'sub/raw' };
  gate = 'visible';
  qq = query(rawQuiz());
  result = query(rawSubmission());
  history = query([result.data]);
  attempts = query({
    used: 2,
    left: 1,
    keptScore: 23.125,
    latestScore: 22.345,
    inProgress: false,
    pendingReview: false,
  });
  classic = query([qq.data]);
  fresh = query([]);
  course = query({ restricted: false });
  assignment = query({ restricted: false });
}
const count = (name) => calls.filter((c) => c[0] === name).length;
const visible = (tree) =>
  JSON.stringify(tree, (key, value) =>
    key === 'error' ? value?.message : typeof value === 'function' ? undefined : value,
  );
const body = () => ui.QuizBody({ quiz: qq.data, attempts: attempts.data, courseId: params.courseId });
const renderResult = () => res.QuizResult(params);
const renderHistory = () => hi.QuizHistory(params);
const renderDetails = () => ui.QuizDetails(params);
// Evaluate real local Result child with its own staged hooks. Native/TakeQuiz remain opaque boundaries.
function summary(tree) {
  const node = h.nodes(tree).find((n) => typeof n.type === 'function' && n.type.name === 'Result');
  const m = mount(() => node.type(node.props));
  const rendered = m.render();
  m.unmount();
  return rendered;
}
async function run() {
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2207);
    for (const [k, digest] of Object.entries(baseline.catalogs[lang]))
      assert.equal(hash(catalog[k]), digest, k);
    assert.equal(Object.keys(catalog).filter((k) => k.startsWith('quizPresentation.')).length, 85);
  }
  // TakeQuiz's historical hash stays intact. Its intentional quiz-entry migration
  // supersedes only this freeze with executable legacy/protocol/lifetime coverage
  // in quiz-entry.check.cjs; every other source and catalog assertion remains.
  for (const [f, digest] of Object.entries(baseline.sources)) {
    // Historical hashes retained. The named migrations replace only their UI freezes.
    // AttemptResults is now exercised by quiz-attempt-results.check.cjs.
    if (['features/quizzes/TakeQuiz.tsx', 'features/quizzes/NewQuizLaunch.tsx',
      'features/quizzes/AttemptResults.tsx'].includes(f)) continue;
    let source = fs.readFileSync(path.join(root, f), 'utf8');
    if (f === 'canvas/api/quizzes.ts') {
      // Remove ONLY the two authorized additive provenance lines. The historical
      // hash still proves every other byte (requests, policies, mappers) unchanged.
      for (const addition of [
        '  /** Present only for an Easel-generated fallback; absent in older caches/raw names. */\n  generatedNameOrdinal?: number;\n',
        '        ...(!q.question_name ? { generatedNameOrdinal: index + 1 } : {}),\n',
      ]) {
        assert.equal(source.split(addition).length, 2, 'one exact authorized metadata addition');
        source = source.replace(addition, '');
      }
    }
    assert.equal(hash(source), digest, f);
  }
  setup();
  equal(ui.quizTypeLabels, {
    assignment: 'Graded quiz',
    practice_quiz: 'Practice quiz',
    graded_survey: 'Graded survey',
    survey: 'Survey',
  });
  for (const [sec, expected] of [
    [0, 'Under a minute'],
    [29, 'Under a minute'],
    [30, '1 minute'],
    [90, '2 minutes'],
    [3599, '1 hr'],
    [3900, '1 hr 5 min'],
  ])
    assert.equal(hi.formatDuration(sec), expected);
  assert.equal(hi.attemptScore(22.345, 25, false), '22.34/25');
  assert.equal(hi.attemptScore(null, 0, false), null);
  assert.equal(hi.attemptScore(0, 0, false), '0/0');
  assert.equal(hi.attemptScore(23, 25, true), 'A−');
  assert.equal(hi.isSurvey(undefined), false);
  assert.equal(hi.isSurvey({ type: 'graded_survey' }), true);
  equal(hi.historyRoute('c/raw', 'q/raw'), {
    pathname: '/course/[courseId]/quiz/[quizId]/history',
    params: { courseId: 'c/raw', quizId: 'q/raw' },
  });
  equal(hi.attemptResultsRoute('c/raw', 'q/raw', 2), {
    pathname: '/course/[courseId]/quiz/[quizId]/attempt/[attempt]',
    params: { courseId: 'c/raw', quizId: 'q/raw', attempt: '2' },
  });
  for (const [limit, used, left, want] of [
    [3, 1, undefined, 2],
    [null, 5, undefined, null],
    [3, 1, 0, 0],
    [3, 1, null, null],
    [1, 4, undefined, 0],
  ])
    assert.equal(ui.quizAttemptsLeft({ ...rawQuiz(), allowedAttempts: limit }, { used, left }), want);
  // Same mounted component sees locale changes; exact engine identity/props and raw strings stay intact.
  setup();
  const bm = mount(body),
    lm = mount(listing),
    rm = mount(renderResult),
    hm = mount(renderHistory),
    pm = mount(helper.useQuizPresentation);
  const initial = all(bm.render(), 'TakeQuiz')[0];
  const operationStart = calls.length;
  for (const lang of ['en', 'fr', 'ar']) {
    const t = locale(lang),
      p = pm.render(),
      bt = bm.render();
    const child = all(bt, 'TakeQuiz')[0];
    assert.equal(child.type, initial.type);
    assert.equal(child.key, initial.key);
    assert.equal(child.props.quiz, initial.props.quiz);
    assert.equal(child.props.attempts, initial.props.attempts);
    equal(child.props, initial.props);
    assert.equal(all(bt, 'RichContent')[0].props.html, qq.data.html);
    assert.ok(visible(bt).includes(qq.data.title));
    assert.ok(visible(bt).includes(t('quizPresentation.instructions')));
    assert.ok(visible(lm.render()).includes(t('quizPresentation.graded')));
    assert.ok(visible(rm.render()).includes(t('quizPresentation.yourScore')));
    assert.ok(visible(hm.render()).includes(t('quizPresentation.kept')));
    const d = new Date('2027-01-01T00:30:00Z'),
      now = new Date('2026-12-31T23:00:00Z');
    const month = new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'America/Los_Angeles' }).format(
      d,
    );
    assert.ok(p.date(d, now).includes(month));
    assert.ok(!p.date(d, now).includes(new Intl.NumberFormat(lang, { useGrouping: false }).format(2027)));
    const number = (n) =>
      new Intl.NumberFormat(lang, { useGrouping: false, maximumFractionDigits: 20 }).format(n);
    assert.equal(p.score(22.345, 25.123456, false), number(22.34) + '/' + number(25.123456));
    assert.equal(p.score(0, 0, false), number(0) + '/' + number(0));
    assert.equal(p.score(null, 25, false), null);
    assert.equal(p.score(22, 25, undefined), null);
    assert.equal(p.score(23, 25, true), 'A−');
    assert.equal(p.points(null), null);
    assert.ok(p.points(0).includes(number(0)));
    assert.equal(p.duration(29), t('quizPresentation.underMinute'));
    assert.equal(p.duration(30), t('quizPresentation.minutes', { count: 1 }));
    assert.equal(p.duration(3599), t('quizPresentation.hours', { count: 1 }));
    assert.equal(
      p.duration(3900),
      t('quizPresentation.hoursMinutes', {
        hours: t('quizPresentation.hours', { count: 1 }),
        minutes: t('quizPresentation.minutes', { count: 5 }),
      }),
    );
    for (const n of [0, 1, 2, 3, 11, 100]) {
      classic.data = [{ ...qq.data, questionCount: n }];
      assert.ok(visible(lm.render()).includes(t('quizPresentation.questionCount', { count: n })));
    }
    for (const route of routes) {
      const m = mount(route),
        tree = m.render();
      assert.ok(all(tree, 'CourseScope')[0].props.title);
      m.unmount();
    }
  }
  assert.equal(calls.length, operationStart, 'locale causes no quiz operations');
  [bm, lm, rm, hm, pm].forEach((m) => m.unmount());
  // Grade gate matrix, including accessibility and survey/unknown metadata. Answer hiding is independent.
  for (const mode of [
    'normal',
    'coursePending',
    'assignmentPending',
    'courseError',
    'assignmentError',
    'restricted',
    'survey',
    'graded_survey',
    'unknown',
    'quizError',
    'quizMissing',
  ]) {
    setup();
    if (mode === 'coursePending') course = { ...course, isPending: true, data: undefined };
    if (mode === 'assignmentPending') assignment = { ...assignment, isPending: true, data: undefined };
    if (mode === 'courseError') course = { ...course, isError: true, error: Error('RAW permissions') };
    if (mode === 'assignmentError')
      assignment = { ...assignment, isError: true, error: Error('RAW permissions') };
    if (mode === 'restricted') assignment.data.restricted = true;
    if (['survey', 'graded_survey', 'unknown'].includes(mode)) qq.data.type = mode;
    if (mode === 'quizError') qq = { ...qq, isError: true, error: Error('RAW quiz error') };
    if (mode === 'quizMissing') qq = query(undefined);
    const m = mount(renderResult),
      tree = m.render(),
      text = visible(tree);
    const numeric = mode === 'normal';
    assert.equal(all(tree, 'ProgressRing').length, numeric ? 1 : 0, mode);
    assert.equal(text.includes('22.34/25'), numeric, mode);
    assert.equal(text.includes('89%'), numeric, mode);
    if (mode === 'quizError') assert.ok(text.includes('RAW quiz error'));
    if (mode === 'quizMissing') assert.ok(all(tree, 'Callout').length);
    m.unmount();
    if (qq.data) {
      const b = mount(() =>
        ui.QuizBody({
          quiz: qq.data,
          attempts: attempts.data,
          courseId: params.courseId,
          resultsReady: !qq.isError,
        }),
      );
      assert.equal(visible(summary(b.render())).includes('23.13/25'), numeric, mode);
      b.unmount();
      const historyMount = mount(renderHistory);
      assert.equal(visible(historyMount.render()).includes('22.34/25'), numeric, mode);
      historyMount.unmount();
    }
  }
  setup();
  result.data.workflowState = 'pending_review';
  let m = mount(renderResult);
  assert.ok(visible(m.render()).includes('22.34/25 so far'));
  m.unmount();
  setup();
  qq.data.locked = true;
  qq.data.lockExplanation = '';
  m = mount(body);
  assert.equal(all(m.render(), 'Callout')[0].props.children, '');
  qq.data.lockExplanation = 'RAW Locked';
  assert.equal(all(m.render(), 'Callout')[0].props.children, 'RAW Locked');
  m.unmount();
  // Classic/New grouping, ordering, stable section keys across locale and partial loading/failure.
  setup();
  classic.data = [
    { ...rawQuiz(), id: 'b', title: 'B', dueAt: null },
    { ...rawQuiz(), id: 'a', title: 'A', dueAt: null },
    { ...rawQuiz(), id: 'p', type: 'practice_quiz' },
    { ...rawQuiz(), id: 's', type: 'survey' },
  ];
  fresh.data = [{ assignmentId: 'new/raw', title: 'New raw', points: 0, dueAt: null }];
  m = mount(listing);
  let tree = m.render();
  equal(
    all(tree, 'Section').map((n) => n.key),
    ['graded', 'practice', 'surveys'],
  );
  equal(
    all(tree, 'ListItem')
      .slice(0, 3)
      .map((n) => n.props.title),
    ['New raw', 'A', 'B'],
  );
  const newRow = all(tree, 'ListItem')[0].props,
    classicRow = all(tree, 'ListItem')[1].props;
  allow('push');
  newRow.onPress();
  equal(calls.at(-1)[1], {
    pathname: '/course/[courseId]/quiz/new/[assignmentId]',
    params: { courseId: 'c/raw', assignmentId: 'new/raw' },
  });
  allow('push');
  classicRow.onPress();
  equal(calls.at(-1)[1], {
    pathname: '/course/[courseId]/quiz/[quizId]',
    params: { courseId: 'c/raw', quizId: 'a' },
  });
  locale('ar');
  equal(
    all(m.render(), 'Section').map((n) => n.key),
    ['graded', 'practice', 'surveys'],
  );
  fresh.data = [];
  classic.data = [];
  fresh.isPending = true;
  assert.equal(all(m.render(), 'EmptyState').length, 0);
  assert.equal(all(m.render(), 'ListSkeleton').length, 1);
  fresh.isPending = false;
  fresh.error = Error('RAW new failure');
  fresh.isError = true;
  assert.equal(all(m.render(), 'EmptyState').length, 0);
  assert.equal(all(m.render(), 'LoadError').length, 1);
  classic.data = [rawQuiz()];
  assert.equal(all(m.render(), 'ListItem').length, 1);
  assert.equal(all(m.render(), 'LoadError').length, 1);
  fresh = query([]);
  classic.data = [];
  assert.equal(all(m.render(), 'EmptyState').length, 1);
  m.unmount();
  // Current membership/policy and resource lifetime checks; offline local navigation stays available.
  for (const kind of ['list', 'history', 'result'])
    for (const change of [
      'account',
      'client',
      'course',
      'quiz',
      'submission',
      'membership',
      'eligibility',
      'unmount',
      'discard',
    ]) {
      if (kind === 'list' && ['quiz', 'submission'].includes(change)) continue;
      if (kind === 'history' && change === 'submission') continue;
      setup();
      const render = kind === 'list' ? listing : kind === 'history' ? renderHistory : renderResult;
      m = mount(render);
      tree = m.render();
      const cb =
        kind === 'result' ? all(tree, 'Button')[1].props.onPress : all(tree, 'ListItem')[0].props.onPress;
      const prior = count('push');
      if (change === 'account') setEnvironment({ account: { id: 'B', user: { id: 'u' } } });
      if (change === 'client') setEnvironment({ client: {} });
      if (change === 'course') params = { ...params, courseId: 'other' };
      if (change === 'quiz') params = { ...params, quizId: 'other' };
      if (change === 'submission') params = { ...params, submissionId: 'other' };
      if (change === 'membership') {
        classic.data = [];
        history.data = [];
        result.data = { ...result.data, id: 'replacement' };
      }
      if (change === 'eligibility') {
        gate = 'hidden';
        qq.isError = true;
        qq.error = Error('RAW');
      }
      if (change === 'unmount') m.unmount();
      else if (change === 'discard') {
        const original = params;
        params = { ...params, courseId: 'discarded' };
        m.renderOnly();
        m.abandon();
        params = original;
      } else m.render();
      if (change === 'discard') {
        setEnvironment({ online: false });
        allow('push');
      }
      cb();
      assert.equal(count('push'), prior + (change === 'discard' ? 1 : 0), kind + ' ' + change);
      if (change !== 'unmount') m.unmount();
    }
  // Staged first render cannot publish navigation; committed locale-only snapshots can.
  setup();
  m = mount(renderHistory);
  let cb = all(m.renderOnly(), 'ListItem')[0].props.onPress;
  let before = count('push');
  cb();
  assert.equal(count('push'), before);
  m.commit();
  allow('push');
  cb();
  m.unmount();
  // Every owned paired retry holds until both settle; stale callbacks cannot enter a replacement observer.
  for (const render of [listing, renderDetails, renderHistory, renderResult]) {
    setup();
    qq = { ...qq, data: undefined, isError: true, error: Error('RAW') };
    classic = { ...classic, isError: true, error: Error('RAW') };
    m = mount(render);
    const retry = all(m.render(), 'LoadError')[0].props.onRetry;
    const d = deferred();
    const start = count('refetch');
    allow('refetch', () => Promise.reject(Error('early')));
    allow('refetch', d.promise);
    const work = retry();
    await retry();
    await flush();
    await retry();
    assert.equal(count('refetch'), start + 2);
    d.reject(Error('late'));
    await work;
    params = { ...params, courseId: 'replacement' };
    m.render();
    await retry();
    assert.equal(count('refetch'), start + 2);
    m.unmount();
  }
  // Replacement before the microtasks run cancels the entire batch, including observer retargeting.
  setup();
  qq = { ...qq, data: undefined, isError: true, error: Error('RAW') };
  m = mount(renderDetails);
  let retry = all(m.render(), 'LoadError')[0].props.onRetry;
  before = count('refetch');
  let work = retry();
  setEnvironment({ client: {} });
  m.render();
  await work;
  assert.equal(count('refetch'), before);
  m.unmount();
  // Cached details keep their child at the same position through refresh failure, no taking-state blanking.
  setup();
  m = mount(renderDetails);
  const first = h.nodes(m.render()).find((n) => n.type === ui.QuizBody);
  qq.isError = true;
  qq.error = Error('RAW refresh');
  const next = h.nodes(m.render()).find((n) => n.type === ui.QuizBody);
  assert.equal(first.type, next.type);
  assert.equal(first.key, next.key);
  assert.equal(first.props.quiz, next.props.quiz);
  m.unmount();
  // Fail closed on unavailable permission data, but do not require an assignment for practice quizzes.
  setup();
  let restrictionMount = mount(() => hi.useQuizRestricted(params.courseId, qq.data));
  course.data = undefined;
  assert.equal(restrictionMount.render(), undefined);
  course = query({ restricted: false });
  assignment.data = undefined;
  assert.equal(restrictionMount.render(), undefined);
  qq.data.assignmentId = null;
  assert.equal(restrictionMount.render(), false);
  qq.data = undefined;
  assert.equal(restrictionMount.render(), undefined);
  restrictionMount.unmount();
  setup();
  const precision = mount(helper.useQuizPresentation);
  let p = precision.render();
  assert.equal(p.score(-0.001, null, false), '-0');
  assert.equal(p.score(-0, null, false), '0');
  assert.equal(p.type('RAW custom type'), 'RAW custom type');
  assert.equal(p.scoring(''), '');
  precision.unmount();
  // Zero/null facts retain the legacy omission policy; the ring still clamps extra-credit scores.
  setup();
  result.data = { ...result.data, score: 0, pointsPossible: 0, timeSpent: 0 };
  m = mount(renderResult);
  tree = m.render();
  assert.equal(all(tree, 'ProgressRing').length, 0);
  assert.ok(visible(tree).includes('0/0'));
  const facts = h
    .nodes(tree)
    .find((n) => n.props?.facts)
    ?.props.facts.filter(Boolean);
  assert.ok(!facts.some((f) => f.label === 'Time'));
  assert.ok(facts.some((f) => f.label === 'Attempts left' && f.value === '0'));
  result.data = { ...result.data, score: 50, pointsPossible: 25 };
  assert.equal(all(m.render(), 'ProgressRing')[0].props.value, 1);
  result.data = { ...result.data, score: -10 };
  assert.equal(all(m.render(), 'ProgressRing')[0].props.value, 0);
  m.unmount();
  // Both query directions keep the other query's cached rows while pending/failed.
  setup();
  fresh.data = [{ assignmentId: 'new', title: 'RAW new', points: 1, dueAt: null }];
  classic.data = undefined;
  classic.isPending = true;
  m = mount(listing);
  assert.equal(all(m.render(), 'ListItem').length, 1);
  assert.equal(all(m.render(), 'EmptyState').length, 0);
  classic.isPending = false;
  classic.isError = true;
  classic.error = Error('RAW classic');
  assert.equal(all(m.render(), 'LoadError').length, 1);
  assert.equal(all(m.render(), 'ListItem').length, 1);
  m.unmount();
  // Retained retries for each identity dimension never call even a refetch function retargeted by a query observer.
  for (const change of ['account', 'client', 'course', 'quiz', 'submission', 'unmount']) {
    setup();
    qq = { ...qq, data: undefined, isError: true, error: Error('RAW') };
    m = mount(renderResult);
    const retained = all(m.render(), 'LoadError')[0].props.onRetry;
    const n = count('refetch');
    if (change === 'account') setEnvironment({ account: { id: 'B', user: { id: 'u' } } });
    if (change === 'client') setEnvironment({ client: {} });
    if (change === 'course') params = { ...params, courseId: 'other' };
    if (change === 'quiz') params = { ...params, quizId: 'other' };
    if (change === 'submission') params = { ...params, submissionId: 'other' };
    if (change === 'unmount') m.unmount();
    else m.render();
    await retained();
    assert.equal(count('refetch'), n);
    if (change !== 'unmount') m.unmount();
  }
  // Back navigation also belongs to the submission, but ordinary offline navigation works.
  setup();
  m = mount(renderResult);
  let back = all(m.render(), 'Button')[0].props.onPress;
  setEnvironment({ online: false });
  allow('back');
  back();
  result.data = { ...result.data, id: 'other' };
  m.render();
  const backs = count('back');
  back();
  assert.equal(count('back'), backs);
  m.unmount();
  // Replay of effects does not release an old in-flight retry into a new claim.
  setup();
  qq = { ...qq, data: undefined, isError: true, error: Error('RAW') };
  m = mount(renderDetails);
  retry = all(m.render(), 'LoadError')[0].props.onRetry;
  const lateA = deferred(),
    lateB = deferred();
  allow('refetch', lateA.promise);
  allow('refetch', lateB.promise);
  work = retry();
  await flush();
  m.replayEffects();
  const nextA = deferred(),
    nextB = deferred();
  allow('refetch', nextA.promise);
  allow('refetch', nextB.promise);
  const nextWork = retry();
  await flush();
  const claimed = count('refetch');
  lateA.resolve();
  lateB.reject(Error('old'));
  await work;
  await retry();
  assert.equal(count('refetch'), claimed);
  nextA.reject(Error('new'));
  nextB.resolve();
  await nextWork;
  m.unmount();
  setup();
  classic = { ...classic, isError: true, error: Error('RAW') };
  m = mount(listing);
  retry = all(m.render(), 'LoadError')[0].props.onRetry;
  gate = 'hidden';
  m.render();
  before = count('refetch');
  await retry();
  assert.equal(count('refetch'), before);
  m.unmount();
  // Hiding and reopening the tab before request entry cannot revive a queued retry.
  setup();
  classic = { ...classic, isError: true, error: Error('RAW') };
  m = mount(listing);
  retry = all(m.render(), 'LoadError')[0].props.onRetry;
  before = count('refetch');
  work = retry();
  gate = 'hidden';
  m.render();
  gate = 'visible';
  const reopenedRetry = all(m.render(), 'LoadError')[0].props.onRetry;
  await work;
  assert.equal(count('refetch'), before, 'hidden-tab transition revokes the queued batch');
  await retry();
  assert.equal(count('refetch'), before, 'the old retry remains revoked after reopening');
  allow('refetch');
  allow('refetch');
  await reopenedRetry();
  assert.equal(count('refetch'), before + 2, 'reopened tab can start a fresh batch');
  m.unmount();
  h.verifyBoundaries();
  console.log(
    'quiz-presentation: actual owned UI/helpers, staged lifetimes; 2207 preserved + 85 owned keys passed (' +
      process.env.TZ +
      ')',
  );
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
