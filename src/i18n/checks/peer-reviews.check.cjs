/* global __dirname */
// Production peer-review components/helpers; staged commit/discard React hooks and
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
  'features/submissions/PeerReviews',
  'features/submissions/peerReviewPresentation',
  'features/submissions/feedbackPresentation',
  'features/submissions/formPresentation',
  'features/submissions/rules',
  'features/course/assignmentPresentation',
  'features/course/format',
  'canvas/api/peerReviews',
  'app/(app)/peer-review/[courseId]/[assignmentId]/index',
  'app/(app)/peer-review/[courseId]/[assignmentId]/[reviewee]',
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
Object.assign(mocks['@/design'], elements('Badge Divider Section EmptyState Screen'));
Object.assign(native, elements('Pressable'));
mocks['@/design'].haptics.selection = h.log('selection');
mocks['lucide-react-native'] = elements(
  'CircleCheck Clock Eye EyeOff Lock MessageSquare UserRound Users UserRoundX',
);
mocks['@/features/course/SubmissionParts'] = elements('AttemptContent CommentList');
mocks['@/features/course/CourseScope'] = elements('CourseScope');
mocks['@/features/course/states'] = {
  ...elements('DetailSkeleton LoadError'),
  useRefreshControl: () => null,
};
let params;
mocks['expo-router'].useLocalSearchParams = () => params;
let a, set, review, work, aq, sq;
const query = (data) => ({
  data,
  isPending: false,
  isError: false,
  error: null,
  refetch: boundary('refetch'),
});
mocks['@/canvas/api/assignments'].useAssignment = () => aq;
mocks['@/canvas/query'].useCanvasQuery = (key) => (key.length === 5 ? sq : work);
mocks['expo-web-browser'] = { openBrowserAsync: boundary('browser') };
mocks['@/features/submissions/GroupCard'] = { groupPhrase: boundary('groupPhrase') };
mocks['@/features/submissions/rules'] = h.load('@/features/submissions/rules');
const api = load('@/canvas/api/peerReviews');
const ui = load('@/features/submissions/PeerReviews');
const helper = load('@/features/submissions/peerReviewPresentation');
const index = load('@/app/(app)/peer-review/[courseId]/[assignmentId]/index').default;
const route = load('@/app/(app)/peer-review/[courseId]/[assignmentId]/[reviewee]').default;
const i18n = load('@/i18n/runtime'),
  dates = load('@/lib/dates');
const locale = (lang) => {
  i18n.setAccountLocale('peer-test', lang);
  return i18n.createTranslator(lang);
};
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const baseline = require('./peer-reviews.baseline.json');
const rubric = () => [
  {
    id: 'criterion',
    description: 'RAW Criterion العربية',
    longDescription: '',
    points: 1.005,
    ignoreForScoring: false,
    ratings: [{ id: 'rating', description: 'RAW Rating', longDescription: 'RAW Detail', points: 1.005 }],
  },
  {
    id: 'ignored',
    description: 'RAW ignored',
    longDescription: '',
    points: 100,
    ignoreForScoring: true,
    ratings: [{ id: 'ignored-rating', description: '', longDescription: '', points: 100 }],
  },
];
function setup() {
  locale('en');
  setEnvironment({
    account: { id: 'A', user: { id: 'self' } },
    client: { request: boundary('request'), post: boundary('post') },
    online: true,
  });
  a = {
    ...h.assignment(),
    id: 'assignment',
    courseId: 'course',
    peerReviews: true,
    rubric: rubric(),
    restricted: false,
    submission: { id: 'reviewer-sub', attempt: 1 },
    name: 'RAW Assignment',
  };
  review = {
    id: 'review',
    key: 'user-USER',
    reviewee: { kind: 'user', id: 'USER' },
    name: 'RAW Name',
    label: 'RAW Name',
    available: true,
    completed: false,
    peerSubmissionId: 'peer-sub',
    assessment: null,
    submittedAt: new Date('2027-01-01T00:30:00Z'),
  };
  set = {
    assignmentId: a.id,
    anonymous: false,
    dueAt: new Date('2027-01-01T00:30:00Z'),
    rubricAssociationId: 'association',
    hidePoints: false,
    hideTotal: false,
    reviews: [review],
  };
  work = query({
    submissionId: 'peer-sub',
    attempt: { submittedAt: review.submittedAt, body: 'RAW work' },
    comments: [],
  });
  aq = query(a);
  sq = query(set);
  params = { courseId: a.courseId, assignmentId: a.id, reviewee: review.key };
}
const body = () => ui.PeerReviewBody({ a, set, review, ready: !aq.isError && !sq.isError });
const field = (tree) => all(tree, 'TextField')[0].props;
const button = (tree) => all(tree, 'Button')[0].props;
const rubricNode = (tree) =>
  h.nodes(tree).find((n) => typeof n.type === 'function' && n.type.name === 'RubricForm');
const renderRubric = (tree) => {
  const n = rubricNode(tree);
  return mount(() => n.type(n.props));
};
const rate = (m) => {
  const tree = m.render(),
    n = rubricNode(tree);
  n.props.onChange(() => ({ criterion: { ratingId: 'rating', points: 1.005, comments: ' RAW criterion ' } }));
  return m.render();
};
const confirm = (m) => {
  allow('alert');
  button(m.render()).onPress();
  return calls.filter((c) => c[0] === 'alert').at(-1);
};
const send = (alert) => alert[3][1].onPress();
const count = (name) => calls.filter((c) => c[0] === name).length;
const invalidations = () => {
  for (let i = 0; i < 3; i++) allow('invalidate');
};
const visible = (t) =>
  JSON.stringify(
    h.nodes(t).map((n) => ({
      type: typeof n.type === 'string' ? n.type : 'child',
      children: typeof n.props?.children === 'string' ? n.props.children : undefined,
      title: n.props?.title,
      label: n.props?.label,
      placeholder: n.props?.placeholder,
      accessibilityLabel: n.props?.accessibilityLabel,
    })),
  );
async function run() {
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2120);
    for (const [key, digest] of Object.entries(baseline.catalogs[lang]))
      assert.equal(hash(catalog[key]), digest, key);
    assert.equal(Object.keys(catalog).filter((k) => k.startsWith('peerReviews.')).length, 87);
  }
  // Freeze all API code except the deliberately additive presentation provenance.
  let apiSource = fs.readFileSync(path.join(root, 'canvas/api/peerReviews.ts'), 'utf8');
  apiSource = apiSource
    .replace(
      /  \/\*\* Additive presentation provenance; absent in legacy cached models\. \*\/\n  labelOrigin\?: 'raw' \| 'generated';\n  labelOrdinal\?: number;\n/,
      '',
    )
    .replace(
      /    labelOrigin: r\.anonymizedUser\?\.name != null \? 'raw' : 'generated',\n    \.\.\.\(r\.anonymizedUser\?\.name == null \? \{ labelOrdinal: index \+ 1 \} : \{\}\),\n/,
      '',
    );
  assert.equal(hash(apiSource), baseline.api);
  setup();
  const mapped = await api.fetchPeerReviews(
    {
      request: async () => ({
        data: {
          assignment: {
            _id: 'a',
            peerReviews: { anonymousReviews: true },
            assessmentRequestsForCurrentUser: [
              {
                _id: '1',
                anonymizedUser: { _id: 'u', name: '' },
                anonymousId: 'DO-NOT-SELECT',
                available: true,
              },
              { _id: '2', anonymizedUser: null, anonymousId: 'a/b', available: true },
            ],
          },
        },
      }),
    },
    'a',
  );
  equal(
    mapped.reviews.map((r) => [r.label, r.labelOrigin, r.labelOrdinal, r.reviewee]),
    [
      ['', 'raw', undefined, { kind: 'user', id: 'u' }],
      ['Classmate 2', 'generated', 2, { kind: 'anonymous', id: 'a/b' }],
    ],
  );
  for (const lang of ['en', 'fr', 'ar']) {
    const t = locale(lang);
    assert.equal(helper.peerLabel(mapped.reviews[0], false, t), '');
    assert.equal(helper.peerLabel({ ...review, label: 'Classmate 99' }, false, t), 'Classmate 99');
    assert.equal(helper.peerLabel({ ...review, label: 'MiXeD' }, false, t), 'MiXeD');
    assert.equal(helper.peerLabel(review, true, t), t('peerReviews.anonymousClassmate'));
    assert.equal(helper.peerLabel(mapped.reviews[1], true, t), t('peerReviews.classmate', { count: 2 }));
    const list = mount(() => ui.PeerReviewList({ a }));
    const row = all(list.render(), 'ListItem')[0];
    assert.ok(row.props.title.includes('RAW Name'));
    list.unmount();
    set.anonymous = true;
    const m = mount(body);
    assert.ok(!visible(m.render()).includes('RAW Name'));
    const r = renderRubric(rate(m));
    const rt = r.render();
    assert.ok(visible(rt).includes('RAW Criterion العربية'));
    const footer = all(rt, 'View').find((n) => n.props.accessible && !n.props.accessibilityRole);
    assert.ok(
      footer.props.accessibilityLabel.includes(
        new Intl.NumberFormat(lang, { useGrouping: false, maximumFractionDigits: 2 }).format(1),
      ),
    );
    r.unmount();
    m.unmount();
    set.anonymous = false;
  }
  setup();
  const equivalentMount = mount(body);
  rate(equivalentMount);
  field(equivalentMount.render()).onChangeText('stable');
  review = { ...review, reviewee: { id: review.reviewee.id, kind: review.reviewee.kind } };
  a = {
    ...a,
    name: 'new title',
    rubric: a.rubric.map((c) => Object.fromEntries(Object.entries(c).reverse())),
  };
  locale('fr');
  assert.equal(field(equivalentMount.render()).value, 'stable');
  assert.equal(rubricNode(equivalentMount.render()).props.value.criterion.ratingId, 'rating');
  equivalentMount.unmount();
  // Hidden totals independent of points, and restrictions hide both visible/AT quantities.
  for (const [hidePoints, hideTotal, restricted] of [
    [false, true, false],
    [true, false, false],
    [false, false, true],
    [false, false, false],
  ]) {
    setup();
    set.hidePoints = hidePoints;
    set.hideTotal = hideTotal;
    a.restricted = restricted;
    const m = mount(body);
    const n = rubricNode(rate(m));
    assert.equal(n.props.hidePoints, hidePoints || restricted);
    assert.equal(n.props.hideTotal, hideTotal);
    const r = renderRubric(m.render()),
      tree = r.render();
    const footer = all(tree, 'View').find((n) => n.props.accessible && !n.props.accessibilityRole);
    assert.equal(
      footer.props.accessibilityLabel.includes('points'),
      !hidePoints && !hideTotal && !restricted,
    );
    assert.equal(
      all(tree, 'Pressable')[0].props.accessibilityLabel.includes('pts'),
      !hidePoints && !restricted,
    );
    assert.ok(!footer.props.accessibilityLabel.includes('100'));
    r.unmount();
    m.unmount();
  }
  setup();
  let editMount = mount(body);
  rate(editMount);
  let rawField = field(editMount.render());
  rawField.onChangeText('first');
  rawField.onChangeText('second');
  assert.equal(field(editMount.render()).value, 'second');
  let rubricMount = renderRubric(editMount.render());
  let rubricTree = rubricMount.render();
  let criterionField = all(rubricTree, 'TextField')[0].props;
  criterionField.onChangeText('first criterion');
  criterionField.onChangeText('second criterion');
  assert.equal(rubricNode(editMount.render()).props.value.criterion.comments, 'second criterion');
  assert.equal(rubricNode(editMount.render()).props.value.criterion.ratingId, 'rating');
  rubricMount.unmount();
  editMount.unmount();
  // Confirmation captures raw payload; installed observer stays with original request and invalidations.
  setup();
  let m = mount(body);
  rate(m);
  field(m.render()).onChangeText('  RAW comment العربية  ');
  let alert = confirm(m);
  const alerts = count('alert');
  button(m.render()).onPress();
  assert.equal(count('alert'), alerts);
  assert.ok(alert[2].includes('Some criteria'));
  const pending = deferred();
  allow('post', pending.promise);
  allow('request', { data: { createSubmissionComment: { errors: null } } });
  invalidations();
  const before = count('post');
  const sent = send(alert);
  await send(alert);
  await flush();
  assert.equal(count('post'), before + 1);
  const post = calls.filter((c) => c[0] === 'post').at(-1);
  equal(post.slice(1), [
    '/api/v1/courses/course/rubric_associations/association/rubric_assessments',
    {
      rubric_assessment: {
        assessment_type: 'peer_review',
        user_id: 'USER',
        criterion_criterion: { rating_id: 'rating', points: 1.005, comments: ' RAW criterion ' },
      },
    },
  ]);
  const announces = count('announce');
  setEnvironment({
    account: { id: 'B', user: { id: 'other' } },
    client: {
      request: () => assert.fail('replacement request'),
      post: () => assert.fail('replacement post'),
    },
  });
  m.render();
  assert.equal(field(m.render()).value, '');
  pending.resolve();
  await sent;
  assert.equal(count('announce'), announces);
  assert.equal(field(m.render()).value, '');
  const req = calls.filter((c) => c[0] === 'request').at(-1);
  equal(req[2].body.variables, {
    submissionId: 'peer-sub',
    reviewerSubmissionId: 'reviewer-sub',
    comment: 'RAW comment العربية',
  });
  assert.ok(
    calls
      .filter((c) => c[0] === 'invalidate')
      .slice(-3)
      .every((c) => c[1].queryKey[0] === 'A'),
  );
  m.unmount();
  // Own completion refetch + locale change does not invalidate success; announcement uses event locale.
  setup();
  m = mount(body);
  rate(m);
  alert = confirm(m);
  const d = deferred();
  allow('post', d.promise);
  invalidations();
  const success = send(alert);
  await flush();
  review = {
    ...review,
    completed: true,
    assessment: { ratings: { ignored: { ratingId: 'ignored-rating', points: 100, comments: '' } } },
  };
  locale('fr');
  m.render();
  d.resolve();
  await success;
  assert.equal(calls.filter((c) => c[0] === 'announce').at(-1)[1], 'Review submitted');
  assert.ok(visible(m.render()).includes('Évaluation envoyée'));
  assert.equal(rubricNode(m.render()).props.value.criterion.ratingId, 'rating');
  m.unmount();
  // Every replacement/content/permission gate rejects retained confirmations; editing stays available.
  const changes = [
    () => {
      a = { ...a, id: 'other' };
    },
    () => {
      a = { ...a, courseId: 'other' };
    },
    () => {
      review = { ...review, id: 'other' };
    },
    () => {
      review = { ...review, reviewee: { kind: 'anonymous', id: 'other' } };
    },
    () => {
      set = { ...set, rubricAssociationId: 'other' };
    },
    () => {
      a = { ...a, rubric: [] };
    },
    () => {
      a = { ...a, restricted: true };
    },
    () => {
      review = { ...review, available: false };
    },
    () => {
      work = { ...work, isError: true, error: new Error('RAW') };
    },
    () => {
      work = query(null);
    },
    () => {
      sq = { ...sq, isError: true };
    },
    () => {
      setEnvironment({ online: false });
    },
    () => {
      setEnvironment({ client: {} });
    },
    () => {
      setEnvironment({ account: { id: 'B', user: { id: 'self' } } });
    },
  ];
  for (const change of changes) {
    setup();
    m = mount(body);
    rate(m);
    alert = confirm(m);
    const n = count('post');
    change();
    m.render();
    await send(alert);
    assert.equal(count('post'), n);
    m.unmount();
  }
  setup();
  m = mount(body);
  rate(m);
  alert = confirm(m);
  field(m.render()).onChangeText('new');
  await send(alert);
  m.render();
  assert.equal(field(m.render()).value, 'new');
  m.unmount();
  // Two edits and later failure/success cannot clear or report over newer work.
  for (const reject of [false, true]) {
    setup();
    m = mount(body);
    rate(m);
    alert = confirm(m);
    const d = deferred();
    allow('post', d.promise);
    if (!reject) invalidations();
    const p = send(alert);
    await flush();
    field(m.render()).onChangeText('later');
    m.render();
    const announcements = count('announce');
    if (reject) d.reject(new Error('RAW failure'));
    else d.resolve();
    await p;
    assert.equal(field(m.render()).value, 'later');
    assert.equal(count('announce'), announcements);
    assert.ok(!visible(m.render()).includes('RAW failure'));
    m.unmount();
  }
  // Persistent errors retranslate; compatibility classifier remains exact, preserving empty/unknown semantics.
  setup();
  m = mount(body);
  rate(m);
  alert = confirm(m);
  allow('post', () => Promise.reject(new Error('RAW failure.')));
  await send(alert);
  assert.ok(visible(m.render()).includes('RAW failure.'));
  locale('ar');
  assert.ok(visible(m.render()).includes('لم يقبل Canvas'));
  m.unmount();
  equal(helper.peerFailure(new Error('')), { reason: 'genericFailure' });
  equal(helper.peerFailure(new Error('unauthorized')), { reason: 'authorizedFailure' });
  equal(helper.peerFailure(new mocks['@/canvas/client'].CanvasNetworkError()), { reason: 'networkFailure' });
  equal(helper.peerFailure(new Error('RAW..')), { reason: 'detailFailure', detail: 'RAW.' });
  // No-rubric, offline, work errors/missing attempts; local input stays enabled.
  setup();
  a.rubric = [];
  set.rubricAssociationId = null;
  m = mount(body);
  assert.equal(button(m.render()).disabled, true);
  field(m.render()).onChangeText('feedback');
  assert.equal(button(m.render()).disabled, false);
  setEnvironment({ online: false });
  assert.equal(field(m.render()).editable, true);
  field(m.render()).onChangeText('offline draft');
  assert.equal(button(m.render()).disabled, true);
  setEnvironment({ online: true });
  work.isError = true;
  assert.equal(field(m.render()).value, 'offline draft');
  field(m.render()).onChangeText('error draft');
  assert.equal(button(m.render()).disabled, true);
  work.isError = false;
  work.data.attempt = null;
  assert.equal(button(m.render()).disabled, true);
  m.unmount();
  // Comment-only requests do not assess a rubric. Existing partial operation has no rollback.
  setup();
  a.rubric = [];
  set.rubricAssociationId = null;
  m = mount(body);
  field(m.render()).onChangeText('  raw only  ');
  alert = confirm(m);
  const posts = count('post');
  allow('request', { data: { createSubmissionComment: { errors: null } } });
  invalidations();
  await send(alert);
  assert.equal(count('post'), posts);
  assert.equal(field(m.render()).value, '');
  m.unmount();
  setup();
  m = mount(body);
  rate(m);
  field(m.render()).onChangeText('raw after rubric');
  alert = confirm(m);
  const invalidated = count('invalidate');
  allow('post');
  allow('request', () => Promise.reject(new Error('comment failed')));
  await send(alert);
  assert.equal(count('invalidate'), invalidated);
  assert.equal(field(m.render()).value, 'raw after rubric');
  assert.ok(visible(m.render()).includes('comment failed'));
  m.unmount();
  // Anonymous confirmation, summary and unavailable/completed/loading/error states in all catalogs.
  for (const lang of ['en', 'fr', 'ar']) {
    setup();
    const t = locale(lang);
    set.anonymous = true;
    m = mount(body);
    rate(m);
    alert = confirm(m);
    assert.ok(!JSON.stringify(alert).includes('RAW Name'));
    alert[3][0].onPress();
    review = { ...review, completed: true };
    assert.ok(visible(m.render()).includes(t('peerReviews.reviewDone')));
    review = { ...review, available: false };
    assert.ok(visible(m.render()).includes(t('peerReviews.waitAnonymous')));
    a.submission.attempt = 0;
    assert.ok(visible(m.render()).includes(t('peerReviews.submitOwn')));
    m.unmount();
    const summary = mount(() => ui.PeerReviewSummary({ set }));
    assert.ok(visible(summary.render()).includes(t('peerReviews.summary', { left: '1', total: '1' })));
    set = { ...set, reviews: [{ ...review, completed: true }], dueAt: null };
    assert.ok(visible(summary.render()).includes(t('peerReviews.allDone')));
    summary.unmount();
    sq = { ...sq, isPending: true };
    const list = mount(() => ui.PeerReviewList({ a }));
    assert.equal(all(list.render(), 'Skeleton').length, 1);
    sq = { ...sq, isPending: false, isError: true };
    assert.ok(visible(list.render()).includes(t('peerReviews.loadList')));
    list.unmount();
    aq = { ...aq, isPending: true };
    const routeMount = mount(route);
    assert.equal(all(routeMount.render(), 'DetailSkeleton').length, 1);
    routeMount.unmount();
  }
  // Committed effects reject unmounted work and discarded replacement renders do not revoke the live owner.
  setup();
  m = mount(body);
  rate(m);
  alert = confirm(m);
  const original = a;
  a = { ...a, id: 'discarded' };
  m.renderOnly();
  m.abandon();
  a = original;
  allow('post');
  invalidations();
  await send(alert);
  assert.ok(visible(m.render()).includes('Review sent'));
  m.unmount();
  setup();
  m = mount(body);
  rate(m);
  alert = confirm(m);
  m.unmount();
  await send(alert);
  setup();
  m = mount(body);
  rate(m);
  alert = confirm(m);
  const late = deferred();
  allow('post', late.promise);
  const lateResult = send(alert);
  await flush();
  m.unmount();
  late.reject(new Error('late'));
  await lateResult;
  // Paired retries: early reject stays claimed; stale route callbacks cannot launch work.
  setup();
  aq.error = new Error('RAW route');
  aq.isError = true;
  aq.data = null;
  let rm = mount(route);
  const retry = all(rm.render(), 'LoadError')[0].props.onRetry;
  const second = deferred();
  allow('refetch', () => Promise.reject(Error('failed')));
  allow('refetch', second.promise);
  const retrying = retry();
  await flush();
  await retry();
  assert.equal(count('refetch'), 2);
  second.resolve();
  await retrying;
  params = { ...params, assignmentId: 'replacement' };
  rm.render();
  await retry();
  assert.equal(count('refetch'), 2);
  rm.unmount();
  setup();
  const lm = mount(() => ui.PeerReviewList({ a }));
  let row = all(lm.render(), 'ListItem')[0].props;
  setEnvironment({ online: false });
  allow('push');
  row.onPress();
  equal(calls.filter((c) => c[0] === 'push').at(-1)[1], ui.peerReviewRoute(a.courseId, a.id, review));
  a = { ...a, id: 'replacement' };
  lm.render();
  row.onPress();
  lm.unmount();
  setup();
  sq.data = { ...set, reviews: [] };
  rm = mount(index);
  assert.ok(all(rm.render(), 'EmptyState').length);
  rm.unmount();
  setup();
  params.reviewee = 'invalid';
  rm = mount(route);
  assert.ok(all(rm.render(), 'EmptyState').length);
  rm.unmount();
  for (const surface of ['list', 'work']) {
    setup();
    sq.isError = surface === 'list';
    work.isError = surface === 'work';
    const mountRetry = mount(surface === 'list' ? () => ui.PeerReviewList({ a }) : body);
    const retry = all(mountRetry.render(), 'Callout').find((n) => n.props.action).props.action.onPress;
    const pending = deferred();
    const previous = count('refetch');
    allow('refetch', pending.promise);
    const task = retry();
    await flush();
    await retry();
    assert.equal(count('refetch'), previous + 1);
    a = { ...a, id: 'replacement' };
    mountRetry.render();
    pending.reject(new Error('raw retry'));
    await task;
    await retry();
    assert.equal(count('refetch'), previous + 1);
    mountRetry.unmount();
  }
  // Mapping preserves exact target kind and escaped anonymous endpoint; comments/ratings serialization stays legacy.
  for (const target of [
    { kind: 'user', id: 'u' },
    { kind: 'anonymous', id: 'a/b' },
  ]) {
    const seen = [];
    const raw = { id: 1, attempts: [], comments: [] };
    await api.fetchPeerWork(
      {
        get: async (...args) => {
          seen.push(args);
          return raw;
        },
      },
      'c',
      'a',
      target,
    );
    assert.equal(
      seen[0][0],
      target.kind === 'user'
        ? '/api/v1/courses/c/assignments/a/submissions/u'
        : '/api/v1/courses/c/assignments/a/anonymous_submissions/a%2Fb',
    );
    equal(api.parseReviewee(api.revieweeKey(target)), target);
    await api.submitPeerAssessment(
      {
        post: async (path, body) => {
          assert.ok(path.includes('/rubric_assessments'));
          equal(body.rubric_assessment, {
            assessment_type: 'peer_review',
            [target.kind === 'user' ? 'user_id' : 'anonymous_id']: target.id,
            criterion_c: { points: '', comments: '' },
          });
        },
      },
      'c',
      'r',
      target,
      { c: { ratingId: null, points: null, comments: '' } },
    );
  }
  // Explicit Canvas civil-year presentation, independent of process TZ.
  for (const lang of ['en', 'fr', 'ar']) {
    locale(lang);
    dates.setDisplayTimeZone('America/Los_Angeles');
    const pm = mount(() => load('@/features/course/assignmentPresentation').useAssignmentPresentation());
    const p = pm.render();
    const d = new Date('2027-01-01T00:30:00Z'),
      now = new Date('2026-12-31T23:00:00Z');
    assert.ok(!p.date(d, now).includes('2027'));
    assert.ok(
      p
        .date(d, now)
        .includes(
          new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'America/Los_Angeles' }).format(d),
        ),
    );
    pm.unmount();
  }
  h.verifyBoundaries();
  console.log(
    'peer-reviews: production UI/API, staged lifetimes, installed observer, 2120 preserved + 87 owned keys passed (' +
      process.env.TZ +
      ')',
  );
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
