/* global __dirname */
// Activity production screens/row/mappers; all effect boundaries denied unless explicitly mocked.
// Synthetic commit/discard/replay hooks, native calls, query, preferences and transport only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
const baseline = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'activity-presentation.baseline.json'), 'utf8'),
);
const before = process.env.ACTIVITY_PRESENTATION_BEFORE === '1';
const jsx = (type, props, key) => ({ type, props, key });
let env, query, focused, browser, resolved;
const calls = [],
  alerts = [],
  listeners = { blur: new Set(), focus: new Set() };
const navigation = {
  isFocused: () => focused,
  addListener: (event, fn) => {
    listeners[event].add(fn);
    return () => listeners[event].delete(fn);
  },
};
const focus = (value) => {
  focused = value;
  for (const fn of listeners[value ? 'focus' : 'blur']) fn();
};
const denied = (name) => () => {
  throw Error(`Denied effect: ${name}`);
};
const mocks = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': {
    View: 'View',
    ScrollView: 'ScrollView',
    RefreshControl: 'RefreshControl',
    Alert: { alert: (...args) => alerts.push(args) },
  },
  'lucide-react-native': Object.fromEntries(
    ['Bell', 'ClipboardCheck', 'Mail', 'Megaphone', 'MessageSquare', 'Sparkles', 'Video'].map(
      (k) => [k, k],
    ),
  ),
  '@/design': Object.fromEntries(
    [
      'IconTile',
      'ListItem',
      'Text',
      'Callout',
      'Chip',
      'EmptyState',
      'ListGroup',
      'Screen',
      'Skeleton',
    ].map((k) => [k, k]),
  ),
  'expo-router': {
    Stack: { Screen: 'StackScreen' },
    router: { push: (route) => calls.push(['push', route]) },
    useNavigation: () => navigation,
  },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/query': { useCanvasQuery: denied('query fetch') },
  '@/canvas/api/courses': {
    useDashboardCourses: () => ({ data: [{ id: 'c', code: 'Raw Course' }] }),
  },
  '@/features/content/browser': {
    useOpenSignedIn: () => (url, mayOpen) => {
      calls.push(['browser', url]);
      return browser(url, mayOpen);
    },
  },
  'expo-web-browser': {
    openBrowserAsync: async (url) => {
      calls.push(['native-browser', url]);
    },
  },
  '@/features/content/links': {
    resolveCanvasLink: (...args) => {
      calls.push(['resolve', ...args]);
      return resolved;
    },
  },
};
mocks['@/design'].useTheme = () => ({ colors: { fgMuted: 'semantic-muted' } });
const cache = new Map();
function load(name, parent = path.join(root, 'entry.ts'), legacy = false) {
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (Object.hasOwn(mocks, key)) return mocks[key];
  assert.match(
    key,
    /^@\/(i18n($|\/)|lib\/dates$|canvas\/(api\/activity|html)$|features\/activity\/(ActivityRow|activityPresentation|activityPresentationOwner|activityVisibility)$|features\/content\/browser$|app\/\(app\)\/activity$)/,
    `Denied dependency ${key}`,
  );
  const file = ['.ts', '.tsx', '/index.ts']
    .map((ext) => path.join(root, key.slice(2)) + ext)
    .find(fs.existsSync);
  assert.ok(file, key);
  const id = file + legacy;
  if (cache.has(id)) return cache.get(id).exports;
  const m = { exports: {} };
  cache.set(id, m);
  let source = fs.readFileSync(file, 'utf8');
  if (legacy && Object.hasOwn(baseline.legacy, path.basename(file)))
    source = baseline.legacy[path.basename(file)];
  const js = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function('require', 'module', 'exports', js)((n) => load(n, file, legacy), m, m.exports);
  return m.exports;
}
// No network global may be used, even accidentally by an admitted pure module.
global.fetch = denied('fetch');
const api = load('@/canvas/api/activity');
const oldApi = load('@/canvas/api/activity', undefined, true);
mocks['@/canvas/api/activity'] = { ...api, useActivity: () => query };
const Screen = load('@/app/(app)/activity', undefined, before).default;
const Row = load('@/features/activity/ActivityRow').ActivityRow;
const presentation = load('@/features/activity/activityPresentation');
const i18n = load('@/i18n');
const dates = load('@/lib/dates');
const browserBoundary = mocks['@/features/content/browser'];
delete mocks['@/features/content/browser'];
const actualBrowser = load('@/features/content/browser');
mocks['@/features/content/browser'] = browserBoundary;
const nodes = (tree) =>
  !tree || typeof tree !== 'object'
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(nodes)
      : [tree, ...nodes(tree.props?.children)];
const all = (tree, type) => nodes(tree).filter((n) => n.type === type);
const one = (tree, type) => {
  const found = all(tree, type);
  assert.equal(found.length, 1, type);
  return found[0].props;
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const raw = (extra = {}) => ({
  id: 'i',
  type: 'Message',
  title: 'Raw title',
  message: 'Raw body',
  created_at: '2026-01-01T00:30:00Z',
  updated_at: '2026-01-01T00:30:00Z',
  read_state: false,
  ...extra,
});
function reset(items = [api.toActivityItem(raw({ html_url: '/web' }))]) {
  assert.equal(listeners.focus.size, 0);
  assert.equal(listeners.blur.size, 0);
  env = { account: { id: 'A', baseUrl: 'https://canvas.example' }, client: {} };
  query = {
    data: items,
    isPending: false,
    isError: false,
    error: null,
    refetch: async () => {
      calls.push(['refresh']);
      return { isError: false };
    },
  };
  focused = true;
  browser = async () => {};
  resolved = null;
  calls.length = alerts.length = 0;
  i18n.setAccountLocale('A', 'en-US');
  dates.setDisplayTimeZone('UTC');
}
const refreshProps = (tree) => one(tree, 'Screen').refreshControl.props;
const rowProps = (tree) =>
  nodes(tree).filter((n) => n.type === Row || n.type?.name === 'ActivityRow')[0]?.props;
const strip = (item) => {
  if (!item) return item;
  const { generatedTitle, generatedPreview, ...rest } = item;
  void generatedTitle;
  void generatedPreview;
  return rest;
};
async function main() {
  if (before) {
    reset();
    const m = mount(Screen);
    if (process.env.ACTIVITY_PRESENTATION_CASE === 'duplicate') {
      const row = rowProps(m.render());
      const wait = deferred();
      browser = () => wait.promise;
      row.onPress();
      row.onPress();
      assert.equal(
        calls.filter((c) => c[0] === 'browser').length,
        1,
        'pre-fix duplicate browser entry',
      );
      return;
    }
    if (process.env.ACTIVITY_PRESENTATION_CASE === 'stale') {
      const row = rowProps(m.render());
      env = { ...env, account: { ...env.account, id: 'B' } };
      m.render();
      row.onPress();
      assert.equal(calls.length, 0, 'pre-fix retained row after account commit');
      return;
    }
    const p = refreshProps(m.render());
    const wait = deferred();
    query.refetch = () => wait.promise;
    // Render to capture current refetch, then reject the actual pre-fix screen callback.
    const refresh = refreshProps(m.render()).onRefresh;
    const task = refresh();
    wait.reject(Error('synthetic rejection'));
    const escaped = await task.then(
      () => false,
      () => true,
    );
    assert.equal(escaped, false, 'pre-fix refresh must handle rejection');
    assert.equal(refreshProps(m.render()).refreshing, false);
    void p;
    m.unmount();
    return;
  }
  // Reviewed historical hashes only: future namespaces and in-progress syncControls are not frozen.
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 3130);
    for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
        hash,
        lang + '/' + key,
      );
    assert.equal(
      Object.keys(catalog).filter((k) => k.startsWith('activityPresentation.')).length,
      38,
    );
  }
  const functionText = (source, name) => {
    const ast = ts.createSourceFile('activity.ts', source, ts.ScriptTarget.Latest, true);
    return ast.statements
      .find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name)
      ?.getText(ast);
  };
  const currentApiSource = fs.readFileSync(path.join(root, 'canvas/api/activity.ts'), 'utf8');
  for (const name of [
    'targetOf',
    'titleOf',
    'fetchRecentGrades',
    'fetchActivity',
  ]) {
    assert.equal(
      functionText(currentApiSource, name),
      functionText(baseline.legacy['activity.ts'], name),
      name + ' remains verbatim',
    );
  }
  const variants = [];
  for (const type of [
    'Announcement',
    'DiscussionTopic',
    'DiscussionEntry',
    'Conversation',
    'Message',
    'Submission',
    'WebConference',
    'Collaboration',
    'AssessmentRequest',
  ]) {
    for (const title of [null, '', '  ', 'Untitled', '  raw title  '])
      variants.push(raw({ type, title }));
  }
  for (const extra of [
    { assignment: { id: 'a', name: '  Assignment  ' } },
    { author_name: 'Raw name' },
    { submission_comments: [{ comment: '  raw\nbody  ' }] },
    {
      submission_comments: [{ author_name: 'Comment', comment: ' raw body ' }],
    },
    { submission_comments: [{ author_name: '', body: 'x'.repeat(250) }] },
    { score: 0, assignment: { id: 'a', points_possible: 0 } },
    { grade: 'Graded' },
    { workflow_state: 'graded' },
    { score: 12.345, assignment: { id: 'a', points_possible: 20 } },
    {
      conversation_id: 'conversation',
      discussion_topic_id: 'topic',
      course_id: 'c',
      html_url: '/raw',
    },
    { discussion_topic_id: 'topic', announcement_id: 'ann', course_id: 'c' },
    { announcement_id: 'ann', course_id: 'c' },
    { course_id: 'c', assignment: { id: 'a' } },
    { html_url: '', url: '/fallback' },
  ])
    for (const type of ['Submission', 'AssessmentRequest', 'DiscussionEntry', 'Conversation'])
      variants.push(raw({ type, title: null, ...extra }));
  for (const input of variants)
    assert.deepEqual(
      // Preserve every legacy mapper field under an explicit ordinary policy.
      // Missing/restricted policy is intentionally replaced and covered separately.
      strip(api.toActivityItem({ ...input, assignment: {
        ...input.assignment, restrict_quantitative_data: false,
      } })),
      oldApi.toActivityItem(input),
      'legacy fields ' + JSON.stringify(input),
    );
  const graded = [];
  for (const grading_type of [undefined, 'letter_grade', 'pass_fail', 'points'])
    for (const restrict_quantitative_data of [false, true])
      for (const extra of [
        { score: 0, grade: 'A' },
        { score: 8 },
        { grade: 'complete' },
        { excused: true },
        { workflow_state: 'graded' },
      ])
        graded.push({
          id: String(graded.length),
          assignment_id: String(graded.length),
          graded_at: new Date().toISOString(),
          assignment: {
            id: 'a',
            course_id: 'c',
            points_possible: 10,
            grading_type,
          },
          course: { id: 'c', restrict_quantitative_data },
          ...extra,
        });
  const transport = { getAll: async () => [], get: async () => graded };
  const currentGrades = (await api.fetchActivity(transport)).map(strip);
  const legacyGrades = await oldApi.fetchActivity(transport);
  assert.deepEqual(currentGrades.map(({ preview, ...item }) => item),
    legacyGrades.map(({ preview, ...item }) => item), 'grade membership/routing/dates remain unchanged');
  for (const item of currentGrades) {
    const rawGrade = graded.find((s) => `grade:${s.id}` === item.id);
    const legacy = legacyGrades.find((s) => s.id === item.id);
    const categorical = ['letter_grade', 'pass_fail'].includes(rawGrade.assignment.grading_type);
    assert.equal(item.preview,
      rawGrade.course.restrict_quantitative_data && !rawGrade.excused
        ? (categorical && rawGrade.grade ? `Graded: ${rawGrade.grade}` : 'Graded')
        : legacy.preview,
      'only explicit grade visibility policy changes preview');
  }
  for (const locale of ['en-US', 'fr-CA', 'ar-EG']) {
    const t = i18n.createTranslator(locale);
    const generated = api.toActivityItem(
      raw({ title: null, type: 'DiscussionEntry', author_name: 'Raw Author' }),
    );
    assert.equal(
      presentation.activityPresentationText(generated, t, locale).title,
      t('activityPresentation.mentionAuthor', { author: 'Raw Author' }),
    );
    const legacy = strip(generated);
    assert.equal(presentation.activityPresentationText(legacy, t, locale).title, legacy.title);
    for (const title of ['Untitled', 'Assignment', 'You were mentioned', 'Graded']) {
      const item = api.toActivityItem(raw({ title }));
      assert.equal(presentation.activityPresentationText(item, t, locale).title, title);
    }
    for (const extra of [
      { score: 0, assignment: { id: 'a', points_possible: 10 } },
      { grade: 'Graded' },
      { workflow_state: 'graded' },
      { submission_comments: [{ comment: 'Raw body' }] },
    ]) {
      const item = api.toActivityItem(raw({ type: 'Submission', ...extra }));
      assert.ok(item.generatedPreview);
      assert.notEqual(presentation.activityPresentationText(item, t, locale).preview, '');
      assert.equal(
        presentation.activityPresentationText(strip(item), t, locale).preview,
        item.preview,
      );
    }
    const rawComment = api.toActivityItem(
      raw({
        type: 'Submission',
        submission_comments: [{ author_name: 'Comment', comment: 'Scored 2 out of 3' }],
      }),
    );
    assert.equal(rawComment.generatedPreview, undefined);
    assert.equal(
      presentation.activityPresentationText(rawComment, t, locale).preview,
      rawComment.preview,
    );
    const restrictedItem = api.toActivityItem(raw({ type: 'Submission', score: 87,
      grade: '87', assignment: { id: 'a', points_possible: 100, grading_type: 'points',
        restrict_quantitative_data: true } }));
    i18n.setAccountLocale('A', locale);
    const restrictedRow = mount(() => Row({ item: restrictedItem, course: { code: 'Raw Course' } }));
    const restrictedProps = one(restrictedRow.render(), 'ListItem');
    assert.equal(restrictedProps.subtitle, `Raw Course · ${t('activityPresentation.graded')}`);
    assert.ok(restrictedProps.accessibilityLabel.includes(t('activityPresentation.graded')));
    assert.ok(!restrictedProps.accessibilityLabel.includes('87'));
    restrictedRow.unmount();
    const items = [
      api.toActivityItem(raw()),
      api.toActivityItem(raw({ id: 'late', updated_at: '2026-01-01T09:30:00Z' })),
    ];
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      const context = dates.createDateContext(locale, zone);
      const groups = presentation.activityPresentationDays(
        items,
        new Date('2026-01-01T10:00:00Z'),
        context,
      );
      assert.deepEqual(
        groups.map((g) => g.key),
        zone === 'America/Los_Angeles' ? ['2025-12-31', '2026-01-01'] : ['2026-01-01'],
      );
      for (const group of groups)
        assert.equal(
          group.title,
          context.dayLabel(group.items[0].updatedAt, new Date('2026-01-01T10:00:00Z')),
        );
      i18n.setAccountLocale('A', locale);
      dates.setDisplayTimeZone(zone);
      const m = mount(() => Row({ item: items[0], course: { code: 'Raw Course' } }));
      const row = one(m.render(), 'ListItem');
      assert.ok(row.accessibilityLabel.includes(context.formatTime(items[0].updatedAt)));
      assert.ok(row.accessibilityLabel.includes(t('activityPresentation.unread')));
      assert.equal(row.title, 'Raw title');
      m.unmount();
    }
  }
  // A mounted screen regroups the same source and keeps selected filters across zone/locale changes.
  reset([
    api.toActivityItem(raw()),
    api.toActivityItem(raw({ id: 'later', updated_at: '2026-01-01T09:30:00Z' })),
  ]);
  {
    const m = mount(Screen);
    let tree = m.render();
    assert.equal(all(tree, 'ListGroup').length, 1);
    const retainedRefresh = refreshProps(tree).onRefresh;
    dates.setDisplayTimeZone('America/Los_Angeles');
    i18n.setAccountLocale('A', 'ar-EG');
    tree = m.render();
    assert.equal(all(tree, 'ListGroup').length, 2);
    await retainedRefresh();
    assert.equal(calls.filter((c) => c[0] === 'refresh').length, 1);
    all(tree, 'Chip')[1].props.onPress();
    tree = m.render();
    i18n.setAccountLocale('A', 'fr-CA');
    dates.setDisplayTimeZone('Asia/Tokyo');
    tree = m.render();
    assert.equal(all(tree, 'Chip')[1].props.selected, true);
    m.unmount();
  }
  // Every route branch and exact arguments; duplicate entry is synchronously claimed.
  for (const [target, route] of [
    [
      { kind: 'conversation', conversationId: 'x' },
      {
        pathname: '/conversation/[conversationId]',
        params: { conversationId: 'x' },
      },
    ],
    [
      { kind: 'topic', courseId: 'c', topicId: 't' },
      {
        pathname: '/course/[courseId]/discussion/[topicId]',
        params: { courseId: 'c', topicId: 't' },
      },
    ],
    [
      { kind: 'assignment', courseId: 'c', assignmentId: 'a' },
      {
        pathname: '/course/[courseId]/assignment/[assignmentId]',
        params: { courseId: 'c', assignmentId: 'a' },
      },
    ],
    [
      { kind: 'course-discussions', courseId: 'c' },
      { pathname: '/course/[courseId]/discussions', params: { courseId: 'c' } },
    ],
    [
      { kind: 'url', url: '/internal' },
      { pathname: '/kept', params: { raw: 'unchanged' } },
    ],
  ]) {
    reset([{ ...api.toActivityItem(raw()), target }]);
    if (target.kind === 'url') resolved = route;
    const m = mount(Screen);
    const row = rowProps(m.render());
    row.onPress();
    row.onPress();
    assert.deepEqual(
      calls.filter((c) => c[0] === 'push'),
      [['push', route]],
    );
    if (target.kind === 'url')
      assert.deepEqual(calls[0], ['resolve', '/internal', 'https://canvas.example']);
    m.unmount();
  }
  reset([{ ...api.toActivityItem(raw()), target: null }]);
  {
    const m = mount(Screen);
    assert.equal(rowProps(m.render()).onPress, undefined);
    m.unmount();
  }
  // Refresh coalesces, catches both rejection and query-result failures, and recovers.
  reset();
  {
    const m = mount(Screen),
      wait = deferred();
    query.refetch = () => {
      calls.push(['refresh']);
      return wait.promise;
    };
    const refresh = refreshProps(m.render()).onRefresh;
    const task = refresh();
    await refresh();
    assert.equal(calls.length, 1);
    assert.equal(refreshProps(m.render()).refreshing, true);
    wait.reject(Error('Raw rejected error'));
    await task;
    assert.equal(refreshProps(m.render()).refreshing, false);
    assert.equal(one(m.render(), 'Callout').children, 'Raw rejected error');
    query.refetch = async () => ({
      isError: true,
      error: Error('Raw result error'),
    });
    await refreshProps(m.render()).onRefresh();
    assert.equal(one(m.render(), 'Callout').children, 'Raw result error');
    query.refetch = async () => ({ isError: false });
    await refreshProps(m.render()).onRefresh();
    assert.equal(all(m.render(), 'Callout').length, 0);
    m.unmount();
  }
  // Direct error-state retry uses the same guarded refresh path.
  reset();
  {
    query.isError = true;
    query.error = Error('Raw source error');
    const wait = deferred();
    query.refetch = () => {
      calls.push(['refresh']);
      return wait.promise;
    };
    const m = mount(Screen);
    const retry = one(m.render(), 'Callout').action.onPress;
    const task = retry();
    await retry();
    assert.equal(calls.length, 1);
    wait.reject(Error('Raw retry error'));
    await task;
    assert.equal(refreshProps(m.render()).refreshing, false);
    assert.equal(one(m.render(), 'Callout').children, 'Raw retry error');
    m.unmount();
  }
  reset();
  {
    query.refetch = async () => {
      throw null;
    };
    const m = mount(Screen);
    await refreshProps(m.render()).onRefresh();
    assert.equal(all(m.render(), 'Callout').length, 1, 'null rejection still exposes retry');
    assert.equal(refreshProps(m.render()).refreshing, false);
    m.unmount();
  }
  // Retained locale controls work; source/account/client/focus callbacks are revoked at commit.
  for (const change of ['account', 'client', 'source', 'focus', 'filter', 'unmount']) {
    reset();
    const m = mount(Screen);
    const tree = m.render(),
      oldRow = rowProps(tree),
      oldRefresh = refreshProps(tree).onRefresh,
      chip = all(tree, 'Chip')[1].props;
    const pending = deferred();
    browser = () => pending.promise;
    oldRow.onPress();
    oldRow.onPress();
    assert.equal(calls.filter((c) => c[0] === 'browser').length, 1);
    if (change === 'account') env = { ...env, account: { ...env.account, id: 'B' } };
    if (change === 'client') env = { ...env, client: {} };
    if (change === 'source') query = { ...query, data: [{ ...query.data[0] }] };
    if (change === 'focus') focus(false);
    if (change === 'filter') chip.onPress();
    if (change === 'unmount') m.unmount();
    else m.render();
    calls.length = 0;
    oldRow.onPress();
    await oldRefresh();
    chip.onPress();
    assert.equal(calls.length, 0, change + ' stale callbacks');
    pending.reject(Error('old browser error'));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(alerts.length, 0, change + ' stale feedback');
    if (change !== 'unmount') m.unmount();
  }
  reset();
  {
    const m = mount(Screen),
      wait = deferred();
    browser = () => wait.promise;
    let tree = m.render();
    const row = rowProps(tree),
      chip = all(tree, 'Chip')[1].props;
    row.onPress();
    i18n.setAccountLocale('A', 'fr-CA');
    dates.setDisplayTimeZone('Asia/Tokyo');
    tree = m.render();
    wait.reject(Error('Raw browser error'));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(alerts[0][0], i18n.createTranslator('fr-CA')('activityPresentation.openError'));
    assert.equal(alerts[0][1], 'Raw browser error');
    chip.onPress();
    tree = m.render();
    assert.equal(all(tree, 'Chip')[1].props.selected, true);
    assert.equal(
      one(tree, 'EmptyState').title,
      i18n.createTranslator('fr-CA')('activityPresentation.emptyAnnouncements'),
    );
    m.unmount();
  }
  reset();
  {
    const m = mount(Screen),
      tree = m.render(),
      row = rowProps(tree);
    const old = env;
    env = { ...env, client: {} };
    m.renderOnly();
    m.abandon();
    env = old;
    row.onPress();
    assert.equal(
      calls.filter((c) => c[0] === 'browser').length,
      1,
      'abandoned render must preserve owner',
    );
    await Promise.resolve();
    m.unmount();
  }
  reset();
  {
    const wait = deferred();
    query.refetch = () => wait.promise;
    const m = mount(Screen);
    const task = refreshProps(m.render()).onRefresh();
    env = { ...env, client: {} };
    assert.equal(refreshProps(m.render()).refreshing, false);
    wait.reject(Error('old refresh'));
    await task;
    assert.equal(all(m.render(), 'Callout').length, 0);
    m.unmount();
  }
  reset();
  {
    const m = mount(Screen);
    let tree = m.render();
    const old = rowProps(tree);
    focus(false);
    m.render();
    focus(true);
    tree = m.render();
    old.onPress();
    assert.equal(calls.length, 0);
    rowProps(tree).onPress();
    assert.equal(calls.filter((c) => c[0] === 'browser').length, 1);
    await Promise.resolve();
    m.unmount();
  }
  // Exercise the real session-URL await and native launch boundary together.
  for (const outcome of ['session', 'fallback']) {
    for (const change of ['account', 'source', 'focus', 'filter', 'unmount']) {
      reset();
      const pending = deferred();
      const requested = query.data[0].target.url;
      env.client = {
        baseUrl: env.account.baseUrl,
        get: (path, params) => {
          calls.push(['session-request', path, params]);
          return pending.promise;
        },
      };
      browser = actualBrowser.useOpenSignedIn();
      const m = mount(Screen),
        tree = m.render();
      rowProps(tree).onPress();
      assert.deepEqual(
        calls.find((c) => c[0] === 'session-request'),
        [
          'session-request',
          '/api/v1/login/session_token',
          { return_to: new URL(requested, env.client.baseUrl).toString() },
        ],
      );
      if (change === 'account') env = { ...env, account: { ...env.account, id: 'B' } };
      if (change === 'source') query = { ...query, data: [{ ...query.data[0] }] };
      if (change === 'focus') focus(false);
      if (change === 'filter') all(tree, 'Chip')[1].props.onPress();
      if (change === 'unmount') m.unmount();
      else m.render();
      if (outcome === 'session')
        pending.resolve({ session_url: 'https://school.invalid/session-once' });
      else pending.reject(Error('tokens disabled'));
      for (let i = 0; i < 6; i++) await Promise.resolve();
      assert.equal(
        calls.filter((c) => c[0] === 'native-browser').length,
        0,
        change + '/' + outcome + ' obsolete native launch',
      );
      assert.equal(alerts.length, 0);
      if (change !== 'unmount') m.unmount();
    }
  }
  reset();
  {
    const pending = deferred();
    env.client = { baseUrl: env.account.baseUrl, get: () => pending.promise };
    browser = actualBrowser.useOpenSignedIn();
    const m = mount(Screen);
    rowProps(m.render()).onPress();
    i18n.setAccountLocale('A', 'fr-CA');
    m.render();
    pending.resolve({ session_url: 'https://school.invalid/current-session' });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    assert.deepEqual(
      calls.filter((c) => c[0] === 'native-browser'),
      [['native-browser', 'https://school.invalid/current-session']],
    );
    m.unmount();
  }
  reset();
  {
    let gets = 0;
    const client = {
      baseUrl: 'https://school.invalid',
      get: async () => {
        gets++;
        return { session_url: 'https://school.invalid/session-once' };
      },
    };
    await actualBrowser.openSignedIn(client, '/courses/1', () => false);
    assert.equal(gets, 0, 'retired entry must not request a session');
    await actualBrowser.openSignedIn(client, '/courses/1', () => true);
    await actualBrowser.openSignedIn(client, '/courses/1');
    assert.equal(gets, 2);
    assert.deepEqual(calls, [
      ['native-browser', 'https://school.invalid/session-once'],
      ['native-browser', 'https://school.invalid/session-once'],
    ]);
    await actualBrowser.openSignedIn(
      {
        ...client,
        get: async () => {
          throw Error('tokens disabled');
        },
      },
      '/courses/2',
    );
    assert.deepEqual(calls.at(-1), ['native-browser', 'https://school.invalid/courses/2']);
  }
  console.log(
    'Activity presentation: actual screen/row/mappers, legacy parity, dates, locale, committed ownership, routing, refresh/browser races passed; synthetic effects only.',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
