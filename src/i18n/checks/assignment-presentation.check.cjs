/* global __dirname */
// Production assignment components/helpers; staged commit/discard React hooks and
// explicit native/query/browser/child boundaries. No HTTP or native UI operations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const h = require('./submission-form.check.cjs');
const { mocks, native, elements, boundary, calls, allow, all, deferred, flush, equal, setEnvironment } = h;
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
  'features/course/AssignmentDetails',
  'features/course/AssignmentListRow',
  'features/course/assignmentPresentation',
  'features/course/format',
  'features/course/navigation',
  'features/grades/format',
  'features/grades/calculate',
  'features/submissions/useSubmissionCommentsViewed',
  'features/submissions/rules',
  'features/submissions/formPresentation',
  'app/(app)/course/[courseId]/assignments',
  'app/(app)/course/[courseId]/assignment/[assignmentId]',
  'app/(app)/course/[courseId]/assignment/[assignmentId]/submission',
]);
const timers = new Map();
let timerId = 0;
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
  const source =
    process.env.ASSIGNMENT_BEFORE && key.endsWith('/submission')
      ? fs.readFileSync('/tmp/easel-scratch/localization/assignment-before/submission.tsx', 'utf8')
      : fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(source, {
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
    setTimeout: (fn) => {
      const id = ++timerId;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  return module.exports;
}
Object.assign(
  mocks['@/design'],
  elements(
    'Badge Button Callout Card Icon IconTile ListGroup ListItem Section Text EmptyState Screen SegmentedControl',
  ),
);
mocks['lucide-react-native'] = elements(
  'ChevronRight CircleCheck ClipboardCheck ExternalLink FileText Lock MessageSquare PenLine Puzzle Upload ListFilter EyeOff Flag',
);
for (const [file, names] of Object.entries({
  'course/FactList': 'FactList',
  'course/CourseScope': 'CourseScope',
  'course/Pickers': 'ChipRow ExpandingPicker',
  'course/SubmissionParts': 'AttemptContent CommentList RubricView',
  'content/RichContent': 'RichContent',
  'submissions/GroupCard': 'GroupCard',
  'submissions/PeerReviews': 'PeerReviewList',
  'submissions/CommentComposer': 'CommentComposer',
  'reminders/ReminderControl': 'ReminderControl',
}))
  mocks['@/features/' + file] = elements(names);
delete mocks['@/features/submissions/useSubmissionCommentsViewed'];
const markRead = (id) => marks.push(['markRead', id]);
mocks['@/canvas/api/conversations'] = { useMarkSubmissionRead: () => ({ mutate: markRead }) };
mocks['@/features/notifications/seen'] = { raiseMark: (...args) => marks.push(['raiseMark', ...args]) };
mocks['expo-router'].useFocusEffect = (callback) => react.useEffect(callback, [callback]);
mocks['@/features/course/states'] = {
  ...elements('DetailSkeleton LoadError ListSkeleton'),
  useRefreshControl: () => null,
};
let gate = 'visible';
mocks['@/features/course/TabGate'] = {
  TabDisabled: 'TabDisabled',
  useTabGate: () => gate,
};
mocks['@/features/content/browser'] = {
  sessionUrl: boundary('session'),
  useOpenSignedIn: () => boundary('browser'),
};
mocks['expo-web-browser'] = { openBrowserAsync: boundary('browser') };
mocks['@/features/lti/launch'] = { useLaunchTool: () => boundary('tool') };
mocks['@/canvas/api/pages'] = { FRONT_PAGE: 'front_page' };
delete mocks['@/features/course/format'];
delete mocks['@/features/course/navigation'];
delete mocks['@/features/grades/format'];
delete mocks['@/features/grades/calculate'];
let params = { courseId: 'c', assignmentId: 'a' };
mocks['expo-router'].useLocalSearchParams = () => params;
let keyboard = null,
  removed = 0,
  marks = [];
native.Keyboard = {
  addListener: (event, fn) => {
    assert.equal(event, 'keyboardDidShow');
    keyboard = fn;
    return {
      remove() {
        removed++;
      },
    };
  },
};
let uploads = [];
mocks['@/features/submissions/uploadStore'] = {
  ...h.slots,
  useUploads: () => uploads,
};
let a, s, periods, list;
const query = (data) => ({
  data,
  isPending: false,
  isError: false,
  error: null,
  refetch: boundary('refetch'),
});
// Use the actual small pure API selector while query hooks stay synthetic.
const apiText = fs.readFileSync(path.join(root, 'canvas/api/assignments.ts'), 'utf8');
const ast = ts.createSourceFile('assignments.ts', apiText, ts.ScriptTarget.Latest, true);
const selector = ast.statements.find(
  (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'currentGradingPeriod',
);
const selectorModule = { exports: {} };
new vm.Script(
  ts.transpileModule(selector.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } })
    .outputText,
).runInNewContext({ exports: selectorModule.exports, Date });
const productionCurrentPeriod = selectorModule.exports.currentGradingPeriod;
Object.assign(mocks['@/canvas/api/assignments'], {
  useAssignment: () => a,
  useSubmission: () => s,
  useGradingPeriods: () => periods,
  useAssignmentGroups: (_course, period) => {
    requestedPeriods.push(period);
    return list;
  },
  currentGradingPeriod: productionCurrentPeriod,
});
let requestedPeriods = [];
mocks['@/canvas/api/submissions'] = h.load('@/canvas/api/submissions');
mocks['@/features/files/kinds'] = h.load('@/features/files/kinds');
const i18n = load('@/i18n/runtime'),
  dates = load('@/lib/dates');
const view = (locale) => {
  i18n.setAccountLocale('test', locale);
  return i18n.createTranslator(locale);
};
const presentation = load('@/features/course/assignmentPresentation');
const details = load('@/features/course/AssignmentDetails');
const Row = load('@/features/course/AssignmentListRow').AssignmentListRow;
const Listing = load('@/app/(app)/course/[courseId]/assignments').default;
const Screen = load('@/app/(app)/course/[courseId]/assignment/[assignmentId]/submission').default;
const DetailScreen = load('@/app/(app)/course/[courseId]/assignment/[assignmentId]').default;
const legacy = load('@/features/course/format');
const base = () => ({
  ...h.assignment(),
  status: 'open',
  points: 50,
  gradingType: 'points',
  restricted: false,
  groupId: 'g',
  html: '<p>RAW عربية</p>',
  unlockAt: null,
  submission: {
    attempt: 0,
    extraAttempts: 0,
    submittedAt: null,
    score: null,
    grade: null,
  },
});
function reset() {
  setEnvironment({
    account: { id: 'accountA', user: { id: 'self' } },
    client: clientA,
    online: true,
  });
  a = query(base());
  s = query({ attempts: [], comments: [], score: null, grade: null });
  periods = query([]);
  list = query({ assignments: [], groups: [] });
  params = { courseId: 'c', assignmentId: 'a' };
  uploads = [];
  gate = 'visible';
  marks = [];
  requestedPeriods = [];
  view('en');
}
const clientA = { id: 'A' },
  clientB = { id: 'B' };
const text = (tree) => h.textOf(tree);
const find = (tree, name) => h.nodes(tree).find((n) => typeof n.type === 'function' && n.type.name === name);
const child = (tree, name) => {
  const n = find(tree, name);
  assert.ok(n, name);
  return mount(() => n.type(n.props));
};
function render(fn) {
  const m = mount(fn);
  const tree = m.render();
  m.unmount();
  return tree;
}
const hashes = (c) =>
  Object.fromEntries(
    Object.entries(c).map(([k, v]) => [
      k,
      crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'),
    ]),
  );
async function run() {
  reset();
  // Before/after evidence: empty raw lock text must not enable a submission route.
  a.data = { ...base(), locked: true, lockExplanation: '' };
  let m = mount(Screen),
    tree = m.render();
  assert.equal(
    all(tree, 'EmptyState')[0].props.action,
    undefined,
    'empty lock explanation must block submission',
  );
  m.unmount();
  if (process.env.ASSIGNMENT_BEFORE) return;
  const baseline = require('./assignment-presentation.baseline.json');
  for (const lang of ['en', 'fr', 'ar']) {
    const c = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(c).filter((k) => k.startsWith('assignmentPresentation.')).length, 101);
    const currentHashes = hashes(c);
    for (const [k, v] of Object.entries(baseline.catalogs[lang]))
      assert.equal(currentHashes[k], v, lang + ' historical ' + k);
  }
  // Actual legacy grade algorithm and unchanged defaults, including map call convention.
  equal([null, 1, 1.005, 1.999, 0].map(legacy.formatPoints), [null, '1 pt', '1 pts', '2 pts', '0 pts']);
  equal(['online_upload', 'none', 'unknown_raw'].map(legacy.submissionTypeLabel), [
    'File upload',
    'No submission',
    'unknown raw',
  ]);
  for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale);
    dates.setDisplayTimeZone('America/Los_Angeles');
    const p = render(presentation.useAssignmentPresentation);
    const now = new Date('2025-01-01T00:30:00Z'),
      future = new Date('2025-01-01T08:30:00Z');
    assert.ok(!p.date(now, now).includes('2024'));
    assert.ok(p.date(future, now).includes(p.number(2025)));
    assert.equal(p.points(1.005), t('assignmentPresentation.pointCount', { value: p.number(1) }));
    for (const restricted of [false, true])
      for (const gradingType of ['points', 'pass_fail', 'letter_grade', 'gpa_scale', 'percent', 'not_graded'])
        for (const score of [null, 0, 1.005, 46])
          for (const grade of [null, '', 'A-', 'complete', 'incomplete', '92%']) {
            const data = { ...base(), restricted, gradingType };
            const actual = p.grade(score, grade, data);
            const old = legacy.formatGrade(score, grade, data);
            if (gradingType === 'pass_fail' && grade)
              assert.equal(
                actual,
                t(
                  grade === 'complete'
                    ? 'assignmentPresentation.complete'
                    : 'assignmentPresentation.incomplete',
                ),
              );
            else if (
              restricted ||
              score === null ||
              (['letter_grade', 'gpa_scale', 'percent'].includes(gradingType) && grade)
            )
              assert.equal(actual, old);
            else assert.equal(actual, `${p.number(Number(score.toFixed(2)))}/${p.number(50)}`);
          }
    for (const kind of ['assignment', 'quiz', 'discussion', 'external_tool', 'offline'])
      for (const status of ['open', 'missing', 'submitted', 'graded', 'none']) {
        const data = {
          ...base(),
          kind,
          status,
          name: '',
          allowedExtensions: ['pdf', 'RAW'],
          submission: { ...base().submission, score: 46, grade: 'A-' },
        };
        const body = render(() => details.AssignmentBody({ a: data }));
        assert.equal(all(body, 'RichContent')[0].props.html, data.html);
        assert.strictEqual(all(body, 'GroupCard')[0].props.a, data);
        assert.strictEqual(all(body, 'PeerReviewList')[0].props.a, data);
        const facts = all(body, 'FactList')[0].props.facts.filter(Boolean);
        assert.equal(
          facts.find((f) => f.label === t('assignmentPresentation.fileTypes')).value,
          p.list(['pdf', 'RAW']),
        );
        const row = render(() => Row({ a: data, now }));
        assert.equal(row.props.title, '');
        if (status === 'graded') assert.ok(row.props.accessibilityLabel.includes('A-') === false); // points type shows score
        const badge = details.assignmentBadge(data);
        const translated = details.assignmentBadge(data, p);
        if (badge) assert.equal(badge.tone, translated.tone);
      }
  }
  reset();
  // Same mounted row updates locale and equivalent data without losing retained navigation.
  let data = base();
  m = mount(() => Row({ a: data }));
  tree = m.render();
  const oldRow = tree.props.onPress;
  const enSubtitle = tree.props.subtitle;
  view('fr');
  data = { ...data, name: 'Updated' };
  tree = m.render();
  assert.notEqual(tree.props.subtitle, enSubtitle);
  setEnvironment({ online: false });
  allow('push', undefined);
  oldRow();
  data = { ...data, id: 'other' };
  m.render();
  const count = calls.length;
  oldRow();
  assert.equal(calls.length, count);
  m.unmount();
  // All local submit routes, resubmit/group/upload states and frozen child payloads.
  for (const kind of ['assignment', 'quiz', 'discussion', 'external_tool', 'offline']) {
    reset();
    data = { ...base(), kind, quizId: 'q', discussionTopicId: 'd' };
    tree = render(() => details.AssignmentBody({ a: data }));
    m = child(tree, 'SubmitAction');
    let actionTree = m.render();
    if (['assignment', 'quiz', 'discussion'].includes(kind)) {
      setEnvironment({ online: false });
      allow('push', undefined);
      all(actionTree, 'Button')[0].props.onPress();
    }
    if (kind === 'external_tool') {
      const tool = child(actionTree, 'OpenToolButton');
      const b = all(tool.render(), 'Button')[0];
      const d = deferred();
      allow('tool', d.promise);
      b.props.onPress();
      b.props.onPress();
      d.reject(Error('failed'));
      await flush();
      assert.ok(text(tool.render()).includes('Couldn’t open'));
      tool.unmount();
    }
    if (kind === 'offline') assert.ok(text(actionTree).includes('nothing to turn in'));
    m.unmount();
  }
  for (const group of [null, 'group'])
    for (const attempt of [0, 1]) {
      reset();
      data = {
        ...base(),
        groupCategoryId: group,
        submission: { ...base().submission, attempt },
      };
      const body = render(() => details.AssignmentBody({ a: data }));
      m = child(body, 'SubmitAction');
      tree = m.render();
      const t = i18n.createTranslator('en');
      assert.equal(
        all(tree, 'Button')[0].props.children,
        t(
          'assignmentPresentation.' +
            (attempt ? (group ? 'resubmitGroup' : 'resubmit') : group ? 'submitGroup' : 'submit'),
        ),
      );
      uploads = [{ id: 'u', status: 'uploading', progress: 0 }];
      tree = m.render();
      assert.equal(all(tree, 'Button')[0].props.children, t('assignmentPresentation.continue'));
      m.unmount();
    }
  // Browser claim, delayed session, presentation stability, stale completion/discarded renders.
  for (const change of [
    'locale',
    'title',
    'account',
    'client',
    'assignment',
    'attempt',
    'locked',
    'unmount',
    'discard',
  ]) {
    reset();
    data = { ...base(), submissionTypes: [] };
    let body = render(() => details.AssignmentBody({ a: data }));
    const action = child(body, 'SubmitAction');
    let actionTree = action.render();
    const node = find(actionTree, 'SignedInButton');
    assert.ok(node);
    let props = node.props;
    m = mount(() => node.type(props));
    tree = m.render();
    const press = all(tree, 'Button')[0].props.onPress;
    const d = deferred();
    allow('session', d.promise);
    press();
    press();
    if (change === 'locale') view('ar');
    if (change === 'title')
      props = {
        ...props,
        a: { ...data, name: 'New', submission: { ...data.submission } },
      };
    if (change === 'account') setEnvironment({ account: { id: 'B', user: { id: 'self' } } });
    if (change === 'client') setEnvironment({ client: clientB });
    if (change === 'assignment') props = { ...props, a: { ...data, id: 'B' } };
    if (change === 'attempt')
      props = {
        ...props,
        a: { ...data, submission: { ...data.submission, attempt: 1 } },
      };
    if (change === 'locked') props = { ...props, a: { ...data, locked: true, lockExplanation: '' } };
    if (change === 'discard') {
      props = { ...props, a: { ...data, id: 'discard' } };
      m.renderOnly();
      m.abandon();
      props = node.props;
    } else if (change === 'unmount') m.unmount();
    else m.render();
    const opens = ['locale', 'title', 'discard'].includes(change);
    if (opens) allow('browser', undefined);
    d.resolve('https://signed.invalid/raw');
    await flush();
    if (change !== 'unmount') {
      tree = m.render();
      m.unmount();
    }
    action.unmount();
  }
  // Attempt state survives locale/equivalent data; resource changes reset and invalidate focus.
  reset();
  s.data.attempts = [
    { attempt: 2, submittedAt: null },
    { attempt: 1, submittedAt: new Date('2025-01-01T00:30Z'), late: true },
  ];
  m = mount(Screen);
  tree = m.render();
  all(tree, 'ChipRow')[0].props.onChange('1');
  tree = m.render();
  const focus = all(tree, 'CommentComposer')[0].props.onFocus;
  focus();
  assert.equal(timers.size, 1);
  view('ar');
  a = { ...a, data: { ...a.data, name: 'Updated' } };
  s = { ...s, data: { ...s.data, attempts: [...s.data.attempts] } };
  tree = m.render();
  assert.equal(all(tree, 'ChipRow')[0].props.value, '1');
  assert.equal(timers.size, 1);
  params = { courseId: 'other', assignmentId: 'a' };
  tree = m.render();
  assert.equal(all(tree, 'ChipRow')[0].props.value, '2');
  assert.equal(timers.size, 0);
  focus();
  assert.equal(timers.size, 0);
  all(tree, 'CommentComposer')[0].props.onFocus();
  keyboard();
  assert.equal(timers.size, 0);
  m.unmount();
  assert.ok(removed > 0);
  // Paired retries retain their claim until both settle, and stale retained retries do nothing.
  reset();
  a.error = Error('RAW');
  m = mount(Screen);
  tree = m.render();
  const retry = all(tree, 'LoadError')[0].props.onRetry;
  const r1 = deferred(),
    r2 = deferred();
  allow('refetch', r1.promise);
  allow('refetch', r2.promise);
  retry();
  retry();
  await flush();
  r1.reject(Error('one'));
  await flush();
  retry();
  r2.reject(Error('two'));
  await flush();
  params = { courseId: 'replacement', assignmentId: 'a' };
  m.render();
  const before = calls.length;
  retry();
  await flush();
  assert.equal(calls.length, before);
  m.unmount();
  // Peer resolver precedence/destination; presentation-only commits never redirect again.
  for (const [extra, peer] of [
    [{ canvasUrl: 'https://c/assignments/a/submissions/42' }, '42'],
    [{ canvasUrl: 'https://c/submissions/42', submissionUserId: '43' }, '43'],
    [{ submissionUserId: 'self' }, null],
    [{ submissionUserId: '' }, null],
  ]) {
    reset();
    params = { ...params, ...extra };
    m = mount(Screen);
    if (peer) allow('replace', undefined);
    m.render();
    view('fr');
    m.render();
    m.unmount();
    if (peer)
      equal(calls.filter((c) => c[0] === 'replace').at(-1)[1], {
        pathname: '/peer-review/[courseId]/[assignmentId]/[reviewee]',
        params: { courseId: 'c', assignmentId: 'a', reviewee: 'user-' + peer },
      });
  }
  // Group/filter/period memberships and sort order remain machine decisions.
  reset();
  const now = Date.now();
  list.data = {
    groups: [{ id: 'g', name: '' }],
    assignments: [
      { ...base(), id: 'past', dueAt: new Date(now - 2000), status: 'graded' },
      {
        ...base(),
        id: 'overdue',
        dueAt: new Date(now - 1000),
        status: 'missing',
      },
      {
        ...base(),
        id: 'upcoming',
        dueAt: new Date(now + 100000),
        kind: 'quiz',
      },
      { ...base(), id: 'undated', dueAt: null },
    ],
  };
  periods.data = [{ id: 'period', title: '', startAt: null, endAt: null }];
  m = mount(Listing);
  tree = m.render();
  assert.equal(requestedPeriods.at(-1), 'period');
  equal(
    all(tree, 'Section').map((n) => n.props.title),
    ['Overdue', 'Upcoming', 'No due date', 'Past'],
  );
  all(tree, 'ExpandingPicker')[0].props.onChange('all');
  all(tree, 'SegmentedControl')[0].props.onChange('group');
  tree = m.render();
  assert.equal(all(tree, 'Section')[0].props.title, '');
  all(tree, 'ChipRow')[0].props.onChange('graded');
  view('fr');
  tree = m.render();
  assert.equal(all(tree, 'ChipRow')[0].props.value, 'graded');
  assert.equal(all(tree, 'SegmentedControl')[0].props.value, 'group');
  assert.equal(requestedPeriods.at(-1), null);
  all(tree, 'SegmentedControl')[0].props.onChange('type');
  tree = m.render();
  assert.equal(all(tree, 'Section').length, 1);
  for (const filter of ['all', 'not_submitted', 'to_be_graded', 'graded']) {
    all(tree, 'ChipRow')[0].props.onChange(filter);
    tree = m.render();
  }
  gate = 'hidden';
  tree = m.render();
  assert.equal(all(tree, 'TabDisabled').length, 1);
  gate = 'visible';
  list = query({ assignments: [], groups: [] });
  tree = m.render();
  assert.equal(all(tree, 'EmptyState').length, 1);
  list.isPending = true;
  tree = m.render();
  assert.equal(all(tree, 'ListSkeleton').length, 1);
  list.isPending = false;
  list.isError = true;
  list.error = Error('raw');
  tree = m.render();
  assert.equal(all(tree, 'LoadError')[0].props.error, list.error);
  m.unmount();
  reset();
  tree = render(DetailScreen);
  assert.equal(all(tree, 'CourseScope')[0].props.title, 'Assignment');
  equal([base(), { ...base(), status: 'missing' }].map(details.assignmentBadge), [
    null,
    { label: 'Missing', tone: 'danger' },
  ]);
  // Frozen badge compatibility, raw lock text, restrictions and status children.
  reset();
  for (const [status, label, tone] of [
    ['missing', 'Missing', 'danger'],
    ['graded', 'Graded', 'success'],
    ['submitted', 'Submitted', 'neutral'],
    ['open', null, null],
  ]) {
    const data = { ...base(), status };
    equal(details.assignmentBadge(data), label ? { label, tone } : null);
    equal(details.assignmentBadge({ ...data, submission: { ...data.submission, excused: true } }), {
      label: 'Excused',
      tone: 'neutral',
    });
  }
  equal(
    details.assignmentBadge({
      ...base(),
      status: 'submitted',
      submission: { ...base().submission, late: true },
    }),
    { label: 'Submitted late', tone: 'warning' },
  );
  equal(details.assignmentBadge({ ...base(), locked: true }), { label: 'Locked', tone: 'neutral' });
  for (const raw of ['', null, '<p>RAW lock</p>']) {
    const tree = render(() =>
      details.AssignmentBody({ a: { ...base(), locked: true, lockExplanation: raw } }),
    );
    assert.equal(all(tree, 'Callout')[0].props.children, raw ?? 'This assignment is locked.');
  }
  for (const status of ['open', 'missing', 'submitted', 'graded', 'none'])
    for (const excused of [false, true]) {
      const data = {
        ...base(),
        status,
        restricted: true,
        submission: { ...base().submission, excused, late: true, score: 46, grade: 'A-' },
      };
      const row = render(() => Row({ a: data }));
      assert.ok(!row.props.accessibilityLabel.includes('46'));
      assert.ok(!row.props.accessibilityLabel.includes('50'));
      const statusNode = row.props.trailing;
      render(() => statusNode.type(statusNode.props));
      const body = render(() => details.AssignmentBody({ a: data }));
      const card = child(body, 'SubmissionCard');
      const cardTree = card.render();
      for (const node of all(cardTree, 'Card')) assert.ok(!node.props.accessibilityLabel.includes('46'));
      card.unmount();
    }
  // Attempt selection account/assignment/client replacement, raw child props, shell grade branches.
  for (const change of ['account', 'client', 'assignment']) {
    reset();
    s.data.attempts = [
      { attempt: 7, submittedAt: null },
      { attempt: 3, submittedAt: null },
    ];
    m = mount(Screen);
    tree = m.render();
    all(tree, 'ChipRow')[0].props.onChange('3');
    tree = m.render();
    assert.strictEqual(all(tree, 'AttemptContent')[0].props.attempt, s.data.attempts[1]);
    assert.strictEqual(all(tree, 'AttemptContent')[0].props.assignment, a.data);
    if (change === 'account') setEnvironment({ account: { id: 'replacement', user: { id: 'self' } } });
    if (change === 'client') setEnvironment({ client: clientB });
    if (change === 'assignment') params = { ...params, assignmentId: 'replacement' };
    tree = m.render();
    assert.equal(all(tree, 'ChipRow')[0].props.value, '7');
    m.unmount();
  }
  for (const status of ['open', 'missing', 'submitted', 'graded'])
    for (const score of [null, 0, 42.125])
      for (const excused of [false, true]) {
        reset();
        a.data = {
          ...a.data,
          status,
          rubric: [{ id: 'r', description: '' }],
          rubricHidesPoints: true,
          rubricHidesTotal: true,
        };
        s.data = {
          ...s.data,
          score,
          excused,
          comments: [{ id: 'comment', text: '', createdAt: new Date('2025-01-01') }],
          rubricAssessment: { r: { points: 0 } },
        };
        tree = render(Screen);
        assert.strictEqual(all(tree, 'RubricView')[0].props.criteria, a.data.rubric);
        assert.strictEqual(all(tree, 'RubricView')[0].props.assessment, s.data.rubricAssessment);
        assert.equal(all(tree, 'RubricView')[0].props.hidePoints, true);
        assert.equal(all(tree, 'RubricView')[0].props.hideTotal, true);
        assert.strictEqual(all(tree, 'CommentList')[0].props.comments, s.data.comments);
        assert.equal(all(tree, 'CommentComposer')[0].props.attempt, null);
        if (excused) assert.ok(text(tree).includes('Excused'));
        else if (status === 'missing') assert.ok(text(tree).includes('Missing'));
        else if (status === 'graded' && score !== null) assert.ok(text(tree).includes('Grade:'));
      }
  // Native submit/resubmit remains available offline, and retained eligibility is revoked.
  for (const hasAttempt of [false, true]) {
    reset();
    if (hasAttempt) s.data.attempts = [{ attempt: 1, submittedAt: null }];
    m = mount(Screen);
    tree = m.render();
    setEnvironment({ online: false });
    const press = hasAttempt
      ? all(tree, 'Button')[0].props.onPress
      : all(tree, 'EmptyState')[0].props.action.onPress;
    allow('push', undefined);
    press();
    equal(calls.at(-1)[1], {
      pathname: '/course/[courseId]/assignment/[assignmentId]/submit',
      params: { courseId: 'c', assignmentId: 'a' },
    });
    a = { ...a, data: { ...a.data, canSubmit: false } };
    m.render();
    const count = calls.length;
    press();
    assert.equal(calls.length, count);
    m.unmount();
  }
  // Actual installed native types include all online types, so shell browser is currently
  // unreachable. Exercise its retained branch with an explicit future-type capability mock.
  const nativePredicate = mocks['@/canvas/api/submissions'].isNativeSubmissionType;
  mocks['@/canvas/api/submissions'].isNativeSubmissionType = () => false;
  for (const hasAttempt of [false, true]) {
    reset();
    if (hasAttempt) s.data.attempts = [{ attempt: 1, submittedAt: null }];
    m = mount(Screen);
    tree = m.render();
    const press = hasAttempt
      ? all(tree, 'Button')[0].props.onPress
      : all(tree, 'EmptyState')[0].props.action.onPress;
    const d = deferred();
    allow('session', d.promise);
    press();
    press();
    view('fr');
    m.render();
    allow('browser', undefined);
    d.resolve('signed');
    await flush();
    m.unmount();
  }
  mocks['@/canvas/api/submissions'].isNativeSubmissionType = nativePredicate;
  // Obsolete work queued before a commit must not enter either refetch afterward.
  reset();
  a.error = Error('RAW');
  m = mount(Screen);
  tree = m.render();
  all(tree, 'LoadError')[0].props.onRetry();
  params = { ...params, courseId: 'replacement' };
  m.render();
  await flush();
  m.unmount();
  // Detail retry is coalesced, stale retained callbacks cannot refetch, rejections are handled.
  reset();
  a.isError = true;
  a.error = Error('RAW');
  let detailProps = { courseId: 'c', assignmentId: 'a' };
  m = mount(() => details.AssignmentDetails(detailProps));
  tree = m.render();
  let retryDetail = all(tree, 'LoadError')[0].props.onRetry;
  const detailWait = deferred();
  allow('refetch', detailWait.promise);
  retryDetail();
  retryDetail();
  detailProps = { ...detailProps, assignmentId: 'B' };
  m.render();
  retryDetail();
  detailWait.reject(Error('obsolete'));
  await flush();
  m.unmount();
  reset();
  a.isPending = true;
  tree = render(() => details.AssignmentDetails({ courseId: 'c', assignmentId: 'a' }));
  assert.equal(all(tree, 'DetailSkeleton').length, 1);
  reset();
  a.isPending = true;
  tree = render(Screen);
  assert.equal(all(tree, 'DetailSkeleton').length, 1);
  a.error = Error('raw');
  tree = render(Screen);
  assert.equal(all(tree, 'LoadError')[0].props.error, a.error);
  // A removed or timed-out keyboard callback cannot scroll even in the same resource.
  reset();
  m = mount(Screen);
  tree = m.render();
  let scrolls = 0;
  all(tree, 'Screen')[0].props.ref.current = { scrollToEnd: () => scrolls++ };
  all(tree, 'CommentComposer')[0].props.onFocus();
  const oldKeyboard = keyboard;
  const expire = [...timers.values()][0];
  expire();
  oldKeyboard();
  assert.equal(scrolls, 0);
  all(tree, 'CommentComposer')[0].props.onFocus();
  keyboard();
  assert.equal(scrolls, 1);
  keyboard();
  assert.equal(scrolls, 1);
  m.unmount();
  // Browser resolution followed by a delayed native rejection cannot set obsolete error state.
  reset();
  let actionKey = 'A';
  m = mount(() => presentation.useAssignmentAction(actionKey));
  let handle = m.render();
  const browserWait = deferred();
  allow('session', 'signed');
  allow('browser', browserWait.promise);
  handle.browser('raw');
  await flush();
  actionKey = 'B';
  m.render();
  browserWait.reject(Error('obsolete browser'));
  await flush();
  assert.equal(m.render().failed, false);
  m.unmount();
  // Initial speculative work is never authorized; abandoning an update leaves live work intact.
  reset();
  m = mount(() => presentation.useAssignmentAction('A'));
  handle = m.renderOnly();
  await handle.browser('raw');
  m.abandon();
  m.render();
  m.unmount();

  // Focus/mark-read dependencies use resource data, never locale or object identity.
  reset();
  s.data = { ...s.data, id: 'submission', comments: [{ createdAt: new Date('2025-01-01') }] };
  m = mount(Screen);
  m.render();
  const markCount = marks.length;
  assert.equal(markCount, 2);
  view('fr');
  m.render();
  view('ar');
  s = { ...s, data: { ...s.data, comments: [...s.data.comments] } };
  m.render();
  assert.equal(marks.length, markCount);
  m.unmount();
  const periodNow = new Date('2025-01-01T00:00:00Z');
  assert.equal(
    productionCurrentPeriod([{ id: 'closed', startAt: null, endAt: new Date('2024-12-31') }], periodNow),
    null,
  );
  assert.equal(
    productionCurrentPeriod([{ id: 'edge', startAt: periodNow, endAt: periodNow }], periodNow).id,
    'edge',
  );
  reset();
  list.data.assignments = ['assignment', 'quiz', 'discussion', 'external_tool', 'offline'].map((kind, i) => ({
    ...base(),
    kind,
    id: String(i),
  }));
  m = mount(Listing);
  tree = m.render();
  all(tree, 'SegmentedControl')[0].props.onChange('type');
  tree = m.render();
  equal(
    all(tree, 'Section').map((n) => n.props.title),
    ['Assignments', 'Quizzes', 'Discussions', 'External tools', 'Nothing to turn in online'],
  );
  list.isError = true;
  list.error = Error('raw');
  tree = m.render();
  const listRetry = all(tree, 'LoadError')[0].props.onRetry;
  const listWait = deferred();
  allow('refetch', listWait.promise);
  listRetry();
  listRetry();
  params = { courseId: 'replacement' };
  m.render();
  listRetry();
  listWait.reject(Error('stale'));
  await flush();
  m.unmount();

  // A period ID belongs to its account/client/course, not the reused list screen.
  for (const change of ['course', 'account', 'client']) {
    reset();
    periods.data = [
      { id: 'current', title: 'Current', startAt: null, endAt: null },
      { id: 'selected', title: 'Selected', startAt: null, endAt: null },
    ];
    m = mount(Listing);
    tree = m.render();
    all(tree, 'ExpandingPicker')[0].props.onChange('selected');
    tree = m.render();
    const oldPicker = all(tree, 'ExpandingPicker')[0].props.onChange;
    view('ar');
    tree = m.render();
    assert.equal(requestedPeriods.at(-1), 'selected', 'locale updates preserve the chosen period');
    if (change === 'course') params = { ...params, courseId: 'other' };
    if (change === 'account') setEnvironment({ account: { id: 'accountB', user: { id: 'other' } } });
    if (change === 'client') setEnvironment({ client: clientB });
    periods.data = [{ id: 'replacement-current', title: '', startAt: null, endAt: null }];
    tree = m.render();
    assert.equal(
      requestedPeriods.at(-1),
      'replacement-current',
      `the former ${change} must not supply the replacement period ID`,
    );
    oldPicker('selected');
    tree = m.render();
    assert.equal(all(tree, 'ExpandingPicker')[0].props.value, 'replacement-current');
    m.unmount();
  }
  h.verifyBoundaries();
  assert.equal(timers.size, 0);
  console.log(
    'assignment-presentation: catalogs, production presentation/routes and staged lifetime checks passed (' +
      process.env.TZ +
      ')',
  );
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
