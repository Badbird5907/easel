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
const { mocks, elements, deferred, flush, equal } = h;
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
let account = { id: 'account-a', user: { id: 'user' } },
  client = {},
  courseId = 'c',
  saving = false;
const events = [],
  queries = {};
let queueResult = () => Promise.resolve();
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
mocks['react/jsx-runtime'] = { jsx, jsxs: jsx, Fragment: 'Fragment' };
mocks['react-native'] = {
  ...elements('View Pressable ScrollView Modal KeyboardAvoidingView RefreshControl'),
  Platform: { OS: 'ios' },
};
mocks['lucide-react-native'] = elements(
  'EyeOff Flag Layers Lock BookOpen GraduationCap ClipboardList',
);
mocks['@/design'] = {
  ...elements(
    'Badge Button Callout Card Chip EmptyState Icon IconTile ListGroup ListItem Screen Skeleton Switch Text TextField ProgressRing AccentScope',
  ),
  useTheme: () => ({ colors: {}, shadows: {}, scheme: 'light' }),
  deriveAccent: () => ({}),
};
mocks['@/design/tokens/colors'] = { courseColors: [{ light: 'color' }, { light: 'other' }] };
mocks['@/lib/cn'] = { cn: (...args) => args.join(' ') };
mocks['@/components/AssignmentRow'] = { kindIcon: { assignment: 'Assignment' } };
mocks['@/canvas/session'] = { useCanvas: () => ({ account, client }) };
mocks['@/canvas/api/courses'] = { useDashboardCourses: () => ({ data: [] }) };
mocks['expo-router'] = {
  Stack: { Screen: 'StackScreen' },
  useLocalSearchParams: () => ({ courseId }),
  router: { push: (...args) => events.push(['push', ...args]) },
};
mocks['@tanstack/react-query'] = {
  useQueryClient: () => ({
    invalidateQueries: (...args) => {
      events.push(['invalidate', ...args]);
      return Promise.resolve();
    },
  }),
};
mocks['@/canvas/query'] = {
  useCanvasQuery: (key) => {
    const query = queries[key[2] ?? key[1]];
    assert.ok(query, 'Unexpected query ' + key);
    return query;
  },
};
mocks['@/features/grades/whatIfSaving'] = {
  useSaveWhatIf: () => saving,
  setSaveWhatIf: (on) => {
    saving = on;
    events.push(['preference', on]);
  },
};
mocks['@/features/offline/requests'] = {
  sendOrQueue: (...args) => {
    events.push(['queue', ...args]);
    return queueResult();
  },
};
mocks['@/features/offline/queue'] = { addNotice: (...args) => events.push(['notice', ...args]) };
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mocks[key]) return mocks[key];
  assert.ok(
    key.startsWith('@/') &&
      /^(i18n($|\/)|lib\/dates$|features\/grades\/|features\/offline\/presentation$|canvas\/api\/grades$|app\/\(app\)\/(grades|course\/\[courseId\]\/grades)$)/.test(
        key.slice(2),
      ),
    'Unexpected import ' + key,
  );
  const file = ['.ts', '.tsx', '/index.ts']
    .map((e) => path.join(root, key.slice(2)) + e)
    .find(fs.existsSync);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const source = fs.readFileSync(file, 'utf8');
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
    queueMicrotask,
    fetch: () => {
      throw Error('HTTP forbidden');
    },
  });
  return module.exports;
}
for (const key of Object.keys(mocks))
  if (key.startsWith('@/features/grades/') && !key.endsWith('/whatIfSaving')) delete mocks[key];
const api = load('@/canvas/api/grades');
const format = load('@/features/grades/format');
const runtime = load('@/i18n/runtime');
const hook = load('@/features/grades/useCourseGrades').useCourseGrades;
const components = Object.fromEntries(
  ['GradeRow', 'GroupHeader', 'TotalCard', 'PeriodPicker', 'WhatIfSheet'].map((n) => [
    n,
    load('@/features/grades/components/' + n)[n],
  ]),
);
const sheetModule = load('@/features/grades/components/WhatIfSheet');
const query = (data) => ({ data, isPending: false, isError: false, refetch: async () => {} });
const raw = {
  id: 'a',
  name: 'Raw عربي {name}',
  assignment_group_id: 'g',
  points_possible: 50,
  submission: {
    id: 'sub',
    score: 40,
    grade: '40',
    posted_at: '2026-10-01',
    workflow_state: 'graded',
  },
};
let assignment, group;
function reset() {
  account = { id: 'account-a', user: { id: 'user' } };
  client = {};
  courseId = 'c';
  saving = false;
  events.length = 0;
  queueResult = () => Promise.resolve();
  assignment = api.toGradeAssignment(raw);
  group = api.toGradeGroup({ id: 'g', name: 'Group raw', group_weight: 30, assignments: [raw] });
  // Keep assignment identity exactly as the query exposes it.
  assignment = group.assignments[0];
  Object.assign(queries, {
    course: query(
      api.toGradesCourse({ id: 'c', name: 'Raw course', course_code: 'CODE', enrollments: [] }),
    ),
    periods: query([]),
    groups: query([group]),
    enrollment: query({ currentScore: 80, currentGrade: null, finalScore: 80, finalGrade: null }),
    'custom-statuses': query({}),
    'what-if': query({}),
    overview: query([]),
  });
}
const text = (tree) =>
  typeof tree === 'string' || typeof tree === 'number'
    ? String(tree)
    : !tree
      ? ''
      : Array.isArray(tree)
        ? tree.map(text).join(' ')
        : text(tree.props?.children);
const all = (tree) =>
  !tree || typeof tree !== 'object'
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(all)
      : [tree, ...all(tree.props?.children)];
const find = (tree, type) => all(tree).filter((n) => n.type === type);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
async function run() {
  const baseline = require('./grades.baseline.json');
  for (const [file, digest] of Object.entries(baseline.sources))
    assert.equal(hash(fs.readFileSync(path.join(root, '..', file))), digest, file);
  const catalogs = ['en', 'fr', 'ar'].map((l) => load('@/i18n/' + l)[l]);
  equal(Object.keys(catalogs[0]).sort(), Object.keys(catalogs[1]).sort());
  equal(Object.keys(catalogs[0]).sort(), Object.keys(catalogs[2]).sort());
  for (const [i, l] of ['en', 'fr', 'ar'].entries())
    for (const [k, digest] of Object.entries(baseline.catalogs[l]))
      assert.equal(hash(JSON.stringify(catalogs[i][k])), digest, l + ':' + k);
  reset();
  const scheme = [{ name: 'Custom mastery', value: 0 }];
  for (const locale of ['en', 'fr', 'ar']) {
    const p = format.createGradePresentation(locale, 'America/Los_Angeles');
    for (const n of [-2.345, 0, 1, 18.255, 120.999])
      assert.equal(
        format.formatPoints(n, locale),
        new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n),
      );
    assert.equal(
      format.describeScore(assignment, { restricted: false, scheme, whatIf: 60 }, p).value,
      format.formatPoints(60, locale),
    );
    const restricted = format.describeScore(
      assignment,
      { restricted: true, scheme, whatIf: 60 },
      p,
    );
    assert.equal(restricted.value, 'Custom mastery');
    assert.equal(restricted.outOf, null);
    assert.ok(!restricted.spoken.includes('60'));
    for (const flag of ['hidden', 'excused']) {
      const a = { ...assignment, submission: { ...assignment.submission, [flag]: true } };
      assert.equal(
        format.describeScore(a, { restricted: false, scheme, whatIf: 60 }, p).value,
        null,
      );
    }
    assert.equal(
      format.describeScore(
        { ...assignment, submission: { ...assignment.submission, pendingReview: true } },
        { restricted: false, scheme },
        p,
      ).value,
      null,
    );
    assert.equal(
      format.describeStatus(
        { ...assignment, submission: { ...assignment.submission, customStatusId: 'x' } },
        { dropped: false, whatIf: false, customStatuses: { x: 'Missing' } },
        p,
      ).label,
      'Missing',
    );
    assert.equal(format.spokenLetter('Mastery+', p), 'Mastery+');
    // Unknown supplied grades are raw text, even when they name Object properties.
    for (const grade of ['constructor', '__proto__']) {
      const raw = format.describeScore(
        { ...assignment, gradingType: 'pass_fail', submission: { ...assignment.submission, grade } },
        { restricted: false, scheme },
        p,
      );
      assert.equal(raw.value, grade);
      assert.equal(raw.spoken, grade);
      assert.equal(
        format.describeStatus(
          { ...assignment, submission: { ...assignment.submission, customStatusId: grade } },
          { dropped: false, whatIf: false, customStatuses: {} },
          p,
        ).label,
        p.t('grades.instructorStatus'),
      );
    }
    const meta = format.describeMeta(
      { ...assignment, dueAt: new Date('2026-01-01T01:00:00Z') },
      false,
      new Date('2026-01-01'),
      p,
    );
    assert.ok(
      meta.includes(
        p.dates.formatShortDate(new Date('2026-01-01T01:00:00Z'), new Date('2026-01-01')),
      ),
    );
    runtime.setAccountLocale('test', locale);
    const total = mount(() =>
      components.TotalCard({
        total: {
          kind: 'grade',
          percent: 120.25,
          letter: 'A',
          actual: { percent: 80, letter: 'B' },
        },
        courseName: 'Raw course',
        mode: 'current',
        periodTitle: null,
        restricted: false,
      }),
    ).render();
    assert.ok(total.props.accessibilityLabel.includes(format.formatPercent(120.25, locale)));
    assert.ok(total.props.accessibilityLabel.includes(format.formatPercent(80, locale)));
    const customTotal = mount(() =>
      components.TotalCard({
        total: { kind: 'grade', percent: 90, letter: 'A', actual: { percent: 80, letter: 'Mastery-' } },
        courseName: 'Raw course', mode: 'current', periodTitle: null, restricted: false,
      }),
    ).render();
    assert.ok(customTotal.props.accessibilityLabel.includes('Mastery-'));
    const hidden = mount(() =>
      components.TotalCard({ total: { kind: 'hidden' }, restricted: true }),
    ).render();
    assert.ok(!JSON.stringify(hidden).includes('120'));
  }
  assert.equal(sheetModule.parseScore(' 42,5 ').score, 42.5);
  assert.equal(sheetModule.parseScore('60').score, 60);
  for (const invalid of ['', 'bad', '-1', 'Infinity'])
    assert.ok(sheetModule.parseScore(invalid).error);
  reset();
  const m = mount(() => hook(courseId));
  let g = m.render();
  g.setWhatIf(assignment, 60);
  g.selectPeriod(null);
  g = m.render();
  assert.equal(g.whatIf.a, 60);
  assert.equal(g.total.percent, 120);
  assert.equal(g.total.actual.percent, 80);
  const stable = g.actionOwner;
  for (const l of ['fr', 'ar', 'en']) {
    runtime.setAccountLocale('test', l);
    g = m.render();
    assert.equal(g.actionOwner, stable);
    assert.equal(g.whatIf.a, 60);
  }
  const old = g;
  courseId = 'other';
  g = m.render();
  assert.equal(g.whatIf.a, undefined);
  old.setWhatIf(assignment, 90);
  old.selectPeriod('retired');
  g = m.render();
  assert.notEqual(g.selectedPeriod, 'retired');
  assert.equal(g.whatIf.a, undefined);
  for (const transition of ['account', 'client', 'period', 'policy']) {
    const retired = g;
    if (transition === 'account') account = { ...account, id: 'new' };
    if (transition === 'client') client = {};
    if (transition === 'period') g.selectPeriod('p2');
    if (transition === 'policy') queries.course = { ...queries.course, isError: true };
    g = m.render();
    retired.setWhatIf(assignment, 99);
    assert.equal(m.render().whatIf.a, undefined);
  }
  assert.equal(g.restricted, true);
  assert.equal(g.whatIfAllowed, false);
  assert.equal(g.total.kind, 'loading');
  assert.equal(g.canWhatIf(assignment), false);
  queries.course = { ...queries.course, isError: false, isPending: true };
  g = m.render();
  assert.equal(g.restricted, true);
  queries.course = { ...queries.course, isPending: false };
  g = m.render();
  queries.course = { ...queries.course, isFetching: true };
  g = m.render(); assert.equal(g.restricted, true); assert.equal(g.whatIfAllowed, false);
  queries.course = { ...queries.course, isFetching: false, failureReason: new Error('cached retry failure') };
  g = m.render(); assert.equal(g.total.kind, 'loading');
  queries.course = { ...queries.course, failureReason: null }; g = m.render();
  // An abandoned render must not retire the committed callback.
  const committed = g;
  client = {};
  m.renderOnly();
  m.abandon();
  committed.setWhatIf(assignment, 61);
  assert.ok(committed.actionOwner.valid());
  g = m.render();
  assert.equal(g.whatIf.a, undefined);
  m.unmount();
  g.resetWhatIf();
  reset();
  saving = true;
  const saveMount = mount(() => hook(courseId));
  g = saveMount.render();
  const delayed = deferred();
  queueResult = () => delayed.promise;
  g.setWhatIf(assignment, 60);
  g.setWhatIf(assignment, 60);
  assert.equal(events.filter((e) => e[0] === 'queue').length, 1);
  const request = events.find((e) => e[0] === 'queue');
  assert.equal(request[1], 'account-a');
  assert.equal(request[2], client);
  equal(request[3].body, { student_entered_score: 60 });
  assert.equal(request[3].path, '/api/v1/submissions/sub/what_if_grades');
  assert.equal(request[3].labelDescriptor.kind, 'what-if-score');
  account = { ...account, id: 'replacement' };
  client = {};
  saveMount.render();
  delayed.resolve();
  await flush();
  assert.equal(events.find((e) => e[0] === 'invalidate')[1].queryKey[0], 'account-a');
  assert.equal(events.filter((e) => e[0] === 'notice').length, 0);
  saveMount.unmount();
  reset();
  saving = true;
  const failMount = mount(() => hook(courseId));
  g = failMount.render();
  const failed = deferred();
  queueResult = () => failed.promise;
  g.setWhatIf(assignment, 60);
  courseId = 'new';
  failMount.render();
  failed.reject(Error('raw refusal'));
  await flush();
  assert.equal(events.filter((e) => e[0] === 'notice').length, 0);
  failMount.unmount();
  // Refresh: synchronous duplicates, rejection settling, and old completion cannot clear replacement spinner.
  const life = load('@/features/grades/lifetime');
  let refreshKey = 'a';
  const jobs = [];
  const refreshMount = mount(() => {
    const owner = life.useGradeLifetime(refreshKey, client);
    return life.useGradesRefresh(owner, [
      () => {
        const d = deferred();
        jobs.push(d);
        return d.promise;
      },
    ]);
  });
  let r = refreshMount.render();
  const first = r.refresh();
  r.refresh();
  await flush();
  assert.equal(jobs.length, 1);
  assert.equal(refreshMount.render().refreshing, true);
  refreshKey = 'b';
  r = refreshMount.render();
  assert.equal(r.refreshing, false);
  const second = r.refresh();
  await flush();
  jobs[0].reject(Error('old'));
  await first;
  assert.equal(refreshMount.render().refreshing, true);
  jobs[1].reject(Error('new'));
  await second;
  assert.equal(refreshMount.render().refreshing, false);
  refreshMount.unmount();
  // Actual sheet Form keeps text/error over locale updates and retires every prior dialog token.
  reset();
  let props = {
    assignment,
    whatIf: undefined,
    lifetime: {},
    onApply: (v) => events.push(['apply', v]),
    onRemove: () => events.push(['remove']),
    onClose: () => events.push(['close']),
  };
  const sheetMount = mount(() => components.WhatIfSheet(props));
  let sheet = sheetMount.render();
  let form = find(sheet, all(sheet).find((n) => typeof n.type === 'function').type)[0];
  const Form = form.type;
  const formMount = mount(() => Form({ ...props, assignment }));
  let tree = formMount.render();
  let field = find(tree, 'TextField')[0];
  field.props.onChangeText('60,25');
  tree = formMount.render();
  const apply = find(tree, 'Button')[1].props.onPress;
  runtime.setAccountLocale('test', 'fr');
  tree = formMount.render();
  assert.equal(find(tree, 'TextField')[0].props.value, '60,25');
  apply();
  apply();
  assert.equal(events.filter((e) => e[0] === 'apply').length, 1);
  props = { ...props, lifetime: {} };
  tree = formMount.render();
  apply();
  assert.equal(events.filter((e) => e[0] === 'apply').length, 1);
  assert.equal(find(tree, 'TextField')[0].props.value, '40');
  find(tree, 'TextField')[0].props.onChangeText('');
  tree = formMount.render();
  find(tree, 'Button')[1].props.onPress();
  tree = formMount.render();
  assert.ok(find(tree, 'TextField')[0].props.error);
  runtime.setAccountLocale('test', 'ar');
  tree = formMount.render();
  assert.equal(
    find(tree, 'TextField')[0].props.error,
    runtime.createTranslator('ar')('grades.enterScore'),
  );
  formMount.unmount();
  sheetMount.unmount();
  // Legacy source is a historical fixture, not a replacement implementation.
  // Normal defaults retain byte-for-byte outputs; explicit privacy fixes are tested above.
  const legacySource = fs.readFileSync(
    path.join(__dirname, 'grades-legacy-format.fixture.txt'),
    'utf8',
  );
  assert.equal(
    hash(legacySource),
    'a199ffcd7af030d14507d48d4cc786ab3ea197ce221758ddc1809d0cc4c86844',
  );
  const legacyModule = { exports: {} };
  const legacyJs = ts.transpileModule(legacySource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new vm.Script(legacyJs).runInNewContext({
    module: legacyModule,
    exports: legacyModule.exports,
    require: (n) => load(n, path.join(root, 'features/grades/format.ts')),
    Intl,
    Date,
  });
  const legacy = legacyModule.exports;
  runtime.setAccountLocale('test', 'en');
  for (const gradingType of ['points', 'percent', 'letter_grade', 'gpa_scale', 'pass_fail'])
    for (const score of [null, -1, 0, 1, 40.555, 60])
      for (const grade of [null, 'A-', 'complete', 'incomplete', 'unknown']) {
        const a = {
          ...assignment,
          gradingType,
          submission: { ...assignment.submission, score, grade },
        };
        equal(
          format.describeScore(a, { restricted: false, scheme: [] }),
          legacy.describeScore(a, { restricted: false, scheme: [] }),
        );
      }
  for (const n of [0, 1, 2, 1000])
    equal(
      format.describeGroup(
        { ...group, dropLowest: n, dropHighest: n },
        { weighted: true, restricted: false },
      ),
      legacy.describeGroup(
        { ...group, dropLowest: n, dropHighest: n },
        { weighted: true, restricted: false },
      ),
    );
  // Real saved-score adapter with synthetic transport: signed/extra-credit values and
  // exact Canvas endpoint/include remain unchanged; no HTTP boundary is available.
  let fetchCall;
  const parsed = await api.fetchSavedWhatIf(
    {
      getAll: async (...args) => {
        fetchCall = args;
        return [
          { assignment_id: 'a', student_entered_score: '60.25' },
          { assignment_id: 'negative', student_entered_score: -2 },
          { assignment_id: 'invalid', student_entered_score: 'bad' },
        ];
      },
    },
    'c',
  );
  equal(parsed, { a: 60.25, negative: -2 });
  assert.equal(fetchCall[0], '/api/v1/courses/c/students/submissions');
  equal(fetchCall[1], { include: ['student_entered_score'] });
  // Production routes: locale-only re-renders retain the modal; old modal, row and
  // retry callbacks cannot affect replacement scopes. No router/network effects escape.
  reset();
  const CourseScreen = load('@/app/(app)/course/[courseId]/grades').default;
  const screenMount = mount(CourseScreen);
  let screen = screenMount.render();
  const row = find(screen, components.GradeRow)[0];
  assert.equal(row.props.assignment.name, assignment.name);
  row.props.onWhatIf();
  row.props.onWhatIf();
  screen = screenMount.render();
  let modal = find(screen, components.WhatIfSheet)[0];
  const token = modal.props.lifetime;
  const oldModal = modal;
  runtime.setAccountLocale('test', 'fr');
  screen = screenMount.render();
  modal = find(screen, components.WhatIfSheet)[0];
  assert.equal(modal.props.lifetime, token);
  assert.equal(modal.props.assignment, assignment);
  modal.props.onClose();
  screenMount.render();
  find(screenMount.render(), components.GradeRow)[0].props.onWhatIf();
  screen = screenMount.render();
  const fresh = find(screen, components.WhatIfSheet)[0];
  assert.notEqual(fresh.props.lifetime, token);
  oldModal.props.onApply(99);
  oldModal.props.onClose();
  assert.equal(
    find(screenMount.render(), components.WhatIfSheet)[0].props.lifetime,
    fresh.props.lifetime,
  );
  courseId = 'replacement';
  screen = screenMount.render();
  row.props.onPress();
  fresh.props.onApply(99);
  assert.equal(events.filter((e) => e[0] === 'push').length, 0);
  assert.equal(find(screen, components.WhatIfSheet)[0].props.assignment, null);
  queries.course = { ...queries.course, isError: true, error: new Error('Raw server error عربي') };
  screen = screenMount.render();
  assert.ok(text(screen).includes('Raw server error عربي'));
  assert.equal(find(screen, components.GradeRow).length, 0);
  screenMount.unmount();
  reset();
  queries.overview = query([
    api.toCourseGradeSummary(
      {
        id: 'c',
        name: 'Raw course',
        course_code: 'C',
        hide_final_grades: true,
        enrollments: [{ type: 'student', computed_current_score: 98 }],
      },
      'color',
    ),
  ]);
  const Overview = load('@/app/(app)/grades').default;
  const overviewMount = mount(Overview);
  let overviewTree = overviewMount.render();
  const courseRow = find(overviewTree, 'ListItem')[0];
  assert.ok(!courseRow.props.accessibilityLabel.includes('98'));
  account = { ...account, id: 'replacement' };
  overviewMount.render();
  courseRow.props.onPress();
  assert.equal(events.filter((e) => e[0] === 'push').length, 0);
  overviewMount.unmount();
  // Saved overrides from restricted, hidden, excused or out-of-view assignments are never active.
  reset();
  saving = true;
  queries['what-if'] = query({ a: 62, other: 123 });
  queries.groups = query([{ ...group, assignments: [{ ...assignment, restricted: true }] }]);
  const savedMount = mount(() => hook(courseId));
  let savedGrades = savedMount.render();
  assert.equal(savedGrades.whatIfCount, 0);
  queries.groups = query([group]);
  savedGrades = savedMount.render();
  assert.equal(savedGrades.whatIf.a, 62);
  savedGrades.setSaving(false);
  await flush();
  savedGrades = savedMount.render();
  assert.equal(saving, false);
  assert.equal(savedGrades.whatIf.a, 62);
  assert.ok(
    events.some((e) => e[0] === 'queue' && e[3].path === '/api/v1/courses/c/what_if_grades/reset'),
  );
  savedMount.unmount();
  // A refresh retired before its scheduled entry must not invoke a retargetable observer.
  let live = true,
    entries = 0;
  const skipped = life.settleGradesRefresh([() => entries++], () => live);
  live = false;
  await skipped;
  assert.equal(entries, 0);
  console.log(
    'grades: historical catalogs/protocols, production formatting/hook/components and committed lifetime checks passed (' +
      process.env.TZ +
      ')',
  );
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
