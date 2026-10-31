/* global __dirname */
/** Fresh production transpilation, synthetic Canvas clients, and simulated hook/native boundaries.
 * This is not React reconciliation, Compiler execution, native focus/selection/undo, browser auth,
 * or actual Canvas writes. Hook slots and element identity inputs are checked, not native remounts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..'), cache = new Map();
let scope;
const calls = [], requests = [], queries = [], mutations = [], alerts = [];
const state = { queries: {}, gate: 'visible', params: {}, pending: false };
const react = {
  useState(initial) {
    const s = scope, i = s.cursor++;
    if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [s.slots[i], value => { s.slots[i] = typeof value === 'function' ? value(s.slots[i]) : value; }];
  },
  useRef(value) { return react.useState(() => ({ current: value }))[0]; },
  useMemo(fn, deps) {
    const r = react.useRef();
    if (!r.current || deps.some((d, i) => !Object.is(d, r.current.deps[i]))) r.current = { deps, value: fn() };
    return r.current.value;
  },
  useEffect(fn, deps) { react.useMemo(() => { scope.effects.push(fn); }, deps); },
  useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
};
const jsx = (type, props, key) => ({ type, props, key });
const qc = {
  setQueryData: (...args) => calls.push(['cache', ...args]),
  invalidateQueries: x => calls.push(['invalidate', x]),
  refetchQueries: x => calls.push(['refresh', x]),
};
const client = {
  async get(url, params, signal) {
    requests.push(['get', url, params, signal]);
    if (url.endsWith('/revisions/latest')) {
      calls.push('revision');
      if (state.revisionWait) return state.revisionWait;
      if (state.revisionError) throw new Error('revisions unavailable');
      return state.revision;
    }
    return state.rawPage;
  },
  async put(url, payload) { requests.push(['put', url, payload]); return { ...state.rawPage, body: payload.wiki_page.body }; },
};
const mock = {
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': new Proxy({ Alert: { alert: (...args) => alerts.push(args) } }, { get: (o, k) => o[k] ?? k }),
  'lucide-react-native': new Proxy({}, { get: (_o, k) => k }),
  'expo-router': {
    Stack: { Screen: 'Stack.Screen' }, useLocalSearchParams: () => state.params,
    router: { push: x => calls.push(['push', x]), back: () => calls.push('back') },
    usePreventRemove: (dirty, callback) => { state.prevent = { dirty, callback }; return () => calls.push('allowLeave'); },
  },
  '@tanstack/react-query': { useQueryClient: () => qc },
  '@/design': new Proxy({
    useTheme: () => ({ colors: {} }),
    haptics: { success: () => calls.push('success'), error: () => calls.push('error') },
  }, { get: (o, k) => o[k] ?? k }),
  '@/canvas/session': { useCanvas: () => ({ client }) },
  '@/canvas/query': {
    useAccountKey: () => 'account',
    useCanvasQuery: (key, fn, options) => {
      queries.push({ key, fn, options });
      return state.queries[key.join('/')] ?? { isPending: true };
    },
    useCanvasMutation: (fn, options) => ({ isPending: state.pending, mutate: (value, callbacks) => {
      calls.push('mutate'); mutations.push({ fn, options, value, callbacks });
    } }),
  },
  '@/features/content/RichContent': { RichContent: 'RichContent' },
  '@/features/editor/RichEditor': { RichEditor: 'RichEditor' },
  '@/features/groups/context': { useContextLabel: () => ({ color: 'raw-color' }) },
  '@/features/course/CourseScope': { CourseScope: 'CourseScope' },
  '@/features/groups/GroupScope': { GroupScope: 'GroupScope' },
  '@/features/course/TabGate': { TabDisabled: 'TabDisabled', useTabGate: (...args) => { state.gateArgs = args; return state.gate; } },
  '@/features/course/AssignmentDetails': { assignmentKindIcon: { assignment: 'Assignment', quiz: 'Quiz', discussion: 'Discussion' } },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.') ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name)) : name;
  if (mock[key]) return mock[key];
  assert.ok(key.startsWith('@/'), `Unmocked dependency: ${key}`);
  const file = ['.ts', '.tsx', '/index.ts'].map(ext => path.join(root, key.slice(2)) + ext).find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  let source = fs.readFileSync(file, 'utf8');
  if (key === '@/app/(app)/course/[courseId]/syllabus') source += '\nexport { SummaryRow };';
  const js = ts.transpileModule(source, { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function('require', 'module', 'exports', js)(n => load(n, file), module, module.exports);
  return module.exports;
}
function harness(fn) {
  const s = { slots: [], effects: [], cursor: 0 };
  return props => { scope = s; s.cursor = 0; const tree = fn(props); scope = null;
    for (const effect of s.effects.splice(0)) effect(); return tree; };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, type, test = () => true) => nodes(tree).find(n => n.type === type && test(n.props))?.props;
const text = tree => JSON.stringify(tree, (_k, v) => typeof v === 'function' ? undefined : v);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const frozen = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(frozen); } return value; };
const success = data => ({ data, isPending: false, isError: false, refetch: async () => { calls.push('refetch'); return state.refetchWait ?? { data: state.fresh ?? data }; } });
const i18n = load('@/i18n/runtime'), dates = load('@/lib/dates');
const view = (locale, zone = 'UTC') => { i18n.setAccountLocale('account', locale); dates.setDisplayTimeZone(zone); return i18n.createTranslator(locale); };
const api = load('@/canvas/api/pages'), syllabusAPI = load('@/canvas/api/syllabus');
const ui = load('@/features/course/PageContent'), presentation = load('@/features/course/pagePresentation');
const syllabusUI = load('@/app/(app)/course/[courseId]/syllabus');
const statesUI = load('@/features/course/states');
const raw = frozen({ page_id: 'p', url: 'raw / slug', title: 'Front page', body: '<p>This page is empty.</p>',
  created_at: '2024-01-01T00:30:00Z', updated_at: '2025-01-01T00:30:00Z', front_page: true,
  html_url: 'https://school.invalid/raw', last_edited_by: { display_name: 'Someone' }, editing_roles: 'students' });
state.rawPage = raw;
const revision = (id, name = 'Someone') => ({ revision_id: id, updated_at: '2025-01-01T00:30:00Z', edited_by: name === null ? undefined : { display_name: name } });
const headerButton = tree => find(find(tree, 'Stack.Screen').options.headerRight(), 'Button');
async function settleMutation(m) {
  const saved = await m.fn(client, m.value); await m.options.onSuccess(saved, m.value); m.callbacks.onSuccess(saved); return saved;
}
(async () => {
  const catalogs = ['en', 'fr', 'ar'].map(l => load(`@/i18n/${l}`)[l]);
  assert.deepEqual(Object.keys(catalogs[0]).sort(), Object.keys(catalogs[1]).sort());
  assert.deepEqual(Object.keys(catalogs[0]).sort(), Object.keys(catalogs[2]).sort());
  const course = frozen({ type: 'course', id: '42' }), group = frozen({ type: 'group', id: 'g' });
  const page = frozen(await api.fetchContextPage(client, course, api.FRONT_PAGE));
  assert.equal(requests.at(-1)[1], '/api/v1/courses/42/front_page');
  assert.equal(page.title, raw.title); assert.equal(page.html, raw.body); assert.equal(page.editedBy, 'Someone');
  for (const context of [course, group]) {
    await api.fetchContextPage(client, context, raw.url);
    const plural = context.type === 'course' ? 'courses' : 'groups';
    assert.equal(requests.at(-1)[1], `/api/v1/${plural}/${context.id}/pages/raw%20%2F%20slug`);
    state.revision = revision(7);
    const r = await api.fetchLatestRevision(client, context, raw.url);
    assert.deepEqual(r, { id: '7', updatedAt: new Date('2025-01-01T00:30:00Z'), editedBy: 'Someone' });
    assert.deepEqual(requests.at(-1).slice(1, 3), [`/api/v1/${plural}/${context.id}/pages/raw%20%2F%20slug/revisions/latest`, { summary: true }]);
    let args;
    const list = await api.fetchContextPages({ getAll: async (...a) => { args = a; return [{ ...raw, page_id: 'other', front_page: false }, raw]; } }, context);
    assert.equal(list[0].id, 'p'); assert.equal(args[0], `/api/v1/${plural}/${context.id}/pages`);
    assert.deepEqual(args[1], { sort: 'title', order: 'asc' });
    for (const [roles, locked, expected] of [['students', false, true], ['members', false, true], ['public', false, true], ['teachers', false, false], ['students', true, false]]) {
      const p = await api.fetchContextPage({ get: async () => ({ ...raw, editing_roles: roles, locked_for_user: locked, lock_explanation: 'This page is locked.' }) }, context, raw.url);
      assert.equal(p.editable, expected); assert.equal(p.locked, locked); assert.equal(p.lockExplanation, 'This page is locked.');
    }
  }
  const pageBody = harness(ui.PageBody), row = harness(syllabusUI.SummaryRow), listRender = harness(ui.PageList);
  const timestamp = new Date('2025-01-01T00:30:00Z'), now = new Date('2025-06-01T12:00:00Z');
  const assignment = frozen({ id: 'a', courseId: '42', kind: 'assignment', name: 'No due date', dueAt: timestamp, points: 1.125 });
  const item = frozen({ kind: 'assignment', id: 'assignment:a', title: assignment.name, date: timestamp, assignment });
  const event = frozen({ kind: 'event', id: 'event:e', eventId: 'e', title: 'No date', date: timestamp, allDay: true });
  state.queries['courses/42/pages'] = success([page]);
  const before = [requests.length, mutations.length, calls.length];
  for (const locale of ['en', 'fr', 'ar']) for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const t = view(locale, zone), dc = dates.createDateContext(locale, zone), p = presentation.createSyllabusPresentation(locale, zone);
    const tree = pageBody({ page, onEdit() {} });
    assert.equal(find(tree, 'RichContent').html, raw.body);
    assert.equal(find(tree, 'Text', p => p.variant === 'title2').children, raw.title);
    assert.equal(find(tree, 'Text', p => p.variant === 'footnote').children, t('pages.updatedBy', { date: dc.formatShortDate(timestamp), name: 'Someone' }));
    assert.equal(find(tree, 'Button').accessibilityHint, t('pages.editHint'));
    assert.equal(find(tree, 'Badge').children, t('pages.frontPage'));
    const list = listRender({ context: course });
    assert.equal(find(list, 'ListItem').title, 'Front page');
    assert.ok(find(list, 'ListItem').subtitle.includes(t('pages.updated', { date: dc.formatShortDate(timestamp) })));
    assert.ok(find(list, 'ListItem').subtitle.includes(t('pages.canEdit')));
    // Cross-year selection uses the Canvas zone, including the midnight crossing in Los Angeles.
    const fmt = options => new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, ...options });
    const sameYear = fmt({ year: 'numeric' }).format(timestamp) === fmt({ year: 'numeric' }).format(now);
    const expectedDay = fmt({ weekday: 'short', month: 'short', day: 'numeric', ...(!sameYear && { year: 'numeric' }) }).format(timestamp);
    assert.equal(p.day(timestamp, now), expectedDay);
    assert.equal(p.dateTime(timestamp, now), t('date.at', { day: expectedDay, time: dc.formatTime(timestamp) }));
    for (const value of [0, 1, 2, 3, 11, 100, 1.125, 1.005, 2.5, 1234.567, 1.0001]) {
      const category = new Intl.PluralRules(locale).select(value), catalog = catalogs[['en','fr','ar'].indexOf(locale)]['syllabus.points'];
      const number = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 2 }).format(Number.isInteger(value) ? value : Number(value.toFixed(2)));
      const isolated = locale === 'ar' ? `\u2068${number}\u2069` : number;
      assert.equal(p.points(value), (catalog[category] ?? catalog.other).replace('{value}', isolated));
    }
    assert.equal(p.points(null), null); assert.equal(p.points(undefined), null);
    const aRow = row({ item }); assert.equal(find(aRow, 'ListItem').title, assignment.name);
    assert.equal(find(aRow, 'ListItem').subtitle, `${t('syllabus.due', { date: p.dateTime(timestamp) })} · ${p.points(1.125)}`);
    const eRow = row({ item: event });
    assert.equal(find(eRow, 'ListItem').subtitle, p.day(timestamp));
    assert.equal(find(eRow, 'ListItem').accessibilityLabel, t('syllabus.eventLabel', { title: 'No date', date: p.day(timestamp) }));
    for (const age of [0, 5, 90, 1500, 8 * 24 * 60]) {
      const at = new Date(now.getTime() - age * 60000);
      const expected = age < 1 ? t('date.now') : age >= 10080 ? dc.formatShortDate(at, now) : new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(age < 60 ? -age : age < 1440 ? -Math.floor(age / 60) : -Math.floor(age / 1440), age < 60 ? 'minute' : age < 1440 ? 'hour' : 'day');
      assert.equal(presentation.pageRevisionAge(at, locale, zone, now), expected);
    }
  }
  assert.deepEqual([requests.length, mutations.length, calls.length], before, 'presentation changes cause no requests or writes');
  for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale);
    for (const explanation of [null, '', 'This page is locked.']) {
      const tree = pageBody({ page: { ...page, locked: true, editable: false, lockExplanation: explanation }, onEdit() {} });
      assert.equal(find(tree, 'Callout').children, explanation ?? t('pages.lockExplanation'));
      assert.equal(find(tree, 'Callout').title, t('pages.locked')); assert.equal(find(tree, 'Button'), undefined); assert.equal(find(tree, 'RichContent'), undefined);
    }
    assert.ok(text(pageBody({ page: { ...page, html: '   ', editedBy: null, isFrontPage: false } })).includes(t('pages.emptyBody')));
    for (const context of [course, group]) {
      const prefix = `${context.type === 'course' ? 'courses' : 'groups'}/${context.id}/pages`;
      state.queries[prefix] = success([]);
      assert.equal(find(listRender({ context }), 'EmptyState').description, t(context.type === 'course' ? 'pages.emptyCourse' : 'pages.emptyGroup'));
      state.queries[prefix] = success([{ ...page, locked: true, editable: false }]);
      const lockedList = listRender({ context });
      assert.ok(find(lockedList, 'ListItem').accessibilityLabel.endsWith(t('pages.locked')));
      find(lockedList, 'ListItem').onPress(); assert.deepEqual(calls.at(-1), ['push', ui.pageRoute(context, raw.url)]);
      const route = ui.pageEditRoute(context, raw.url);
      assert.deepEqual(route, { pathname: `/${context.type}/[${context.type}Id]/page/[pageUrl]/edit`, params: { [`${context.type}Id`]: context.id, pageUrl: raw.url } });
      const error = new Error('Couldn’t load this page');
      state.queries[prefix] = { isError: true, error, refetch() { calls.push('retry'); } };
      const err = find(listRender({ context }), statesUI.LoadError);
      assert.equal(err.error, error); assert.equal(err.title, t('pages.loadError'));
      assert.equal(find(harness(statesUI.LoadError)(err), 'Callout').children, error.message);
      err.onRetry(); assert.equal(calls.at(-1), 'retry');
      state.queries[prefix] = { isPending: true }; assert.ok(find(listRender({ context }), statesUI.ListSkeleton));
    }
    assert.equal(find(row({ item: { ...event, date: null } }), 'ListItem').subtitle, t('syllabus.noDate'));
    assert.equal(find(row({ item: { ...event, allDay: false } }), 'ListItem').subtitle, presentation.createSyllabusPresentation(locale, 'UTC').dateTime(timestamp));
    assert.equal(find(row({ item: { ...item, assignment: { ...assignment, dueAt: null, points: null } } }), 'ListItem').subtitle, t('syllabus.noDueDate'));
  }
  // Search text survives locale changes; it is raw input, including fallback-looking phrases.
  state.queries['courses/42/pages'] = success(Array.from({ length: 9 }, (_, i) => ({ ...page, url: String(i) })));
  const search = harness(ui.PageList); view('en');
  find(search({ context: course }), 'SearchField').onChangeText('  No pages yet  ');
  for (const locale of ['fr', 'ar', 'en']) {
    const t = view(locale), tree = search({ context: course });
    assert.equal(find(tree, 'SearchField').value, '  No pages yet  ');
    assert.ok(text(tree).includes(t('pages.noMatch', { search: 'No pages yet' })));
  }
  // Real routing helper, including assignment/quiz/discussion and event targets.
  for (const [kind, extra, target, param] of [['assignment', {}, 'assignment', 'assignmentId'], ['quiz', { quizId: 'q' }, 'quiz', 'quizId'], ['discussion', { discussionTopicId: 'd', htmlUrl: 'raw-url' }, 'discussion', 'topicId']]) {
    find(row({ item: { ...item, assignment: { ...assignment, kind, ...extra } } }), 'ListItem').onPress();
    assert.equal(calls.at(-1)[1].pathname, `/course/[courseId]/${target}/[${param}]`);
    assert.equal(calls.at(-1)[1].params.courseId, '42');
  }
  find(row({ item: event }), 'ListItem').onPress();
  assert.deepEqual(calls.at(-1), ['push', { pathname: '/event/[eventId]', params: { eventId: 'e' } }]);
  // Production summary fetch/mapping/order, with synthetic raw assignments/events (no HTTP).
  const syllabusCalls = [], signal = new AbortController().signal;
  const rawAssignment = { id: 'a', course_id: '42', assignment_group_id: 'ag', name: 'No due date',
    points_possible: 1.125, grading_type: 'points', due_at: timestamp.toISOString(), submission_types: ['online_upload'], html_url: 'raw' };
  const syllabusClient = {
    async get(...args) { syllabusCalls.push(args); return { syllabus_body: '<p>Nothing is scheduled yet.</p>' }; },
    async getAll(...args) { syllabusCalls.push(args); return args[0].endsWith('/assignments')
      ? [{ ...rawAssignment, id: 'z', name: 'Z undated', due_at: null }, rawAssignment, { ...rawAssignment, id: 'b', name: 'A undated', due_at: null }]
      : [{ id: 'e', title: 'No date', start_at: '2024-12-31T23:30:00Z', all_day: true }]; },
  };
  const syllabus = frozen(await syllabusAPI.fetchSyllabus(syllabusClient, '42', signal));
  assert.equal(syllabus.html, '<p>Nothing is scheduled yet.</p>');
  assert.deepEqual(syllabus.summary.map(x => x.id), ['event:e', 'assignment:a', 'assignment:b', 'assignment:z']);
  assert.equal(syllabus.summary[0].allDay, true); assert.equal(syllabus.summary[1].assignment.points, 1.125);
  assert.deepEqual(syllabusCalls[0], ['/api/v1/courses/42', { include: ['syllabus_body'] }, signal]);
  assert.deepEqual(syllabusCalls[1], ['/api/v1/courses/42/assignments', { order_by: 'due_at', exclude_response_fields: ['description', 'rubric'] }, { signal }]);
  assert.equal(syllabusCalls[2][0], '/api/v1/calendar_events');
  assert.deepEqual(syllabusCalls[2][1].context_codes, ['course_42']); assert.equal(syllabusCalls[2][1].type, 'event');
  assert.deepEqual(syllabusCalls[2][2], { signal, maxPages: 5 });
  assert.ok(Date.parse(syllabusCalls[2][1].start_date) < Date.now()); assert.ok(Date.parse(syllabusCalls[2][1].end_date) > Date.now());
  const noEvents = await syllabusAPI.fetchSyllabus({ ...syllabusClient, getAll: async (...args) => {
    if (args[0] === '/api/v1/calendar_events') throw new Error('raw'); return syllabusClient.getAll(...args);
  } }, '42');
  assert.equal(noEvents.summary.length, 3);
  state.params = { courseId: '42', groupId: 'g', pageUrl: api.FRONT_PAGE, fromHome: '1' };
  state.queries['courses/42/syllabus'] = success(syllabus);
  const syllabusScreen = harness(syllabusUI.default);
  const routeScreens = [
    ['course/[courseId]/pages', 'CourseScope', 'pages.title', ui.PageList],
    ['group/[groupId]/pages', 'GroupScope', 'pages.title', ui.PageList],
    ['course/[courseId]/page/[pageUrl]', 'CourseScope', 'pages.frontPage', ui.PageContent],
    ['group/[groupId]/page/[pageUrl]', 'GroupScope', 'pages.frontPage', ui.PageContent],
    ['course/[courseId]/page/[pageUrl]/edit', 'CourseScope', 'pages.edit', ui.PageEditor],
    ['group/[groupId]/page/[pageUrl]/edit', 'GroupScope', 'pages.edit', ui.PageEditor],
  ].map(([path, ...rest]) => [harness(load(`@/app/(app)/${path}`).default), path, ...rest]);
  const previousContexts = new Map();
  for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale), before = [requests.length, mutations.length, calls.length];
    const tree = syllabusScreen();
    assert.equal(find(tree, 'CourseScope').title, t('syllabus.title'));
    assert.equal(find(tree, 'RichContent').html, syllabus.html);
    assert.deepEqual(nodes(tree).filter(n => n.type === syllabusUI.SummaryRow).map(n => n.props.item), syllabus.summary);
    assert.deepEqual(nodes(tree).filter(n => n.type === syllabusUI.SummaryRow).map(n => n.key), syllabus.summary.map(x => x.id));
    assert.deepEqual(queries.at(-1).key, ['courses', '42', 'syllabus']);
    assert.deepEqual(state.gateArgs, ['42', 'syllabus', true]);
    for (const [render, path, scopeType, title, child] of routeScreens) {
      const tree = render(); assert.equal(find(tree, scopeType).title, t(title));
      const props = find(tree, child), groupRoute = path.startsWith('group');
      if (props.context) {
        assert.deepEqual(props.context, groupRoute ? group : course);
        if (previousContexts.has(path)) assert.equal(props.context, previousContexts.get(path), 'context stays stable across locale changes');
        previousContexts.set(path, props.context);
      } else assert.equal(props.courseId, '42');
      if (path.includes('/page/')) assert.equal(props.pageUrl, api.FRONT_PAGE);
    }
    assert.deepEqual([requests.length, mutations.length, calls.length], before);
    state.queries['courses/42/syllabus'] = success({ html: '', summary: [] });
    const empty = syllabusScreen(); assert.ok(text(empty).includes(t('syllabus.empty'))); assert.ok(text(empty).includes(t('syllabus.emptySummary')));
    state.queries['courses/42/syllabus'] = { isError: true, error: new Error('Couldn’t load the syllabus') };
    const err = find(syllabusScreen(), statesUI.LoadError); assert.equal(err.title, t('syllabus.loadError')); assert.equal(err.error.message, 'Couldn’t load the syllabus');
    state.queries['courses/42/syllabus'] = { isPending: true }; assert.ok(find(syllabusScreen(), statesUI.DetailSkeleton));
    state.gate = 'hidden'; assert.equal(find(syllabusScreen(), 'TabDisabled').label, t('syllabus.title'));
    state.gate = 'visible'; state.queries['courses/42/syllabus'] = success(syllabus);
  }
  // PageContent preserves optional courseId shorthand and PageBody props for outside consumers.
  for (const context of [course, group]) {
    const key = `${context.type === 'course' ? 'courses' : 'groups'}/${context.id}/pages/${api.FRONT_PAGE}`;
    state.queries[key] = success(page);
    const content = harness(ui.PageContent)(context.type === 'course' ? { courseId: '42', pageUrl: api.FRONT_PAGE } : { context, pageUrl: api.FRONT_PAGE });
    assert.equal(find(content, ui.PageBody).page, page);
    find(content, ui.PageBody).onEdit(); assert.deepEqual(calls.at(-1), ['push', ui.pageEditRoute(context, raw.url)]);
  }
  // Exact synthetic editor flows in both contexts and each language.
  for (const context of [course, group]) for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale), prefix = context.type === 'course' ? 'courses' : 'groups';
    const key = `${prefix}/${context.id}/pages/${api.FRONT_PAGE}`;
    state.queries[key] = success(page); state.revision = revision(1); state.revisionError = false;
    const props = { context, pageUrl: api.FRONT_PAGE }, render = harness(ui.PageEditor);
    render(props); await flush(); let tree = render(props);
    assert.equal(headerButton(tree).disabled, true); assert.equal(state.prevent.dirty, false);
    const editor = find(tree, 'RichEditor'), scrollRef = editor.scrollViewRef;
    assert.equal(editor.value, raw.body); assert.equal(editor.label, t('pages.page'));
    assert.ok(text(tree).includes(t('pages.editFrontDescription')));
    const draft = '<p dir="auto">Front page / نص / brouillon &amp; raw</p>';
    editor.onChange(draft); tree = render(props); assert.equal(state.prevent.dirty, true);
    const counts = [requests.length, mutations.length, calls.length];
    for (const language of ['ar', 'fr', 'en', locale]) {
      view(language, 'Asia/Tokyo'); tree = render(props); await flush();
      assert.equal(find(tree, 'RichEditor').value, draft); assert.equal(find(tree, 'RichEditor').scrollViewRef, scrollRef);
      assert.equal(nodes(tree).find(n => n.type === 'RichEditor').key, undefined);
      assert.equal(headerButton(tree).disabled, false); assert.equal(state.prevent.dirty, true);
      assert.deepEqual(queries.at(-1).key, [prefix, context.id, 'pages', api.FRONT_PAGE]);
    }
    assert.deepEqual([requests.length, mutations.length, calls.length], counts, 'locale+zone changes do not rerun revision effect or write');
    // Cancel discard has no callback; confirm runs repeat only, with the current draft intact.
    state.prevent.callback({ repeat: () => calls.push('repeat') });
    let alert = alerts.at(-1); assert.equal(alert[0], t('pages.discardTitle')); assert.equal(alert[2][0].style, 'cancel'); assert.equal(alert[2][0].onPress, undefined);
    assert.equal(find(render(props), 'RichEditor').value, draft);
    // Pending revision check locks editor/save; language change retains the invocation's Alert language.
    let resolve; state.revisionWait = new Promise(r => { resolve = r; });
    const start = calls.length; headerButton(render(props)).onPress(); tree = render(props);
    assert.equal(find(tree, 'RichEditor').editable, false); assert.equal(headerButton(tree).loading, true);
    view(locale === 'ar' ? 'fr' : 'ar'); render(props);
    resolve(revision(2)); await flush(); state.revisionWait = null; tree = render(props);
    assert.deepEqual(calls.slice(start), ['revision']); assert.equal(find(tree, 'RichEditor').value, draft);
    alert = alerts.at(-1); assert.equal(alert[0], t('pages.conflictTitle')); assert.ok(alert[1].includes('Someone'));
    assert.equal(alert[2][0].text, t('pages.keepEditing')); assert.equal(alert[2][0].onPress, undefined);
    assert.equal(find(tree, 'RichEditor').editable, true); assert.equal(state.prevent.dirty, true);
    // Save mine sends only the original draft body to the loaded slug (never front_page).
    alert[2][2].onPress(); const m = mutations.at(-1);
    assert.deepEqual(m.value, { context, pageUrl: raw.url, html: draft });
    m.callbacks.onError(new Error('Couldn’t save the page'));
    for (const language of ['fr', 'ar', 'en']) {
      const currentT = view(language); tree = render(props);
      assert.equal(find(tree, 'Callout').title, currentT('pages.saveError'));
      assert.equal(find(tree, 'Callout').children, 'Couldn’t save the page');
      assert.equal(find(tree, 'RichEditor').value, draft); assert.equal(state.prevent.dirty, true);
    }
    // Use theirs refetches before replacing body, then adopts the latest revision and clears dirty.
    view(locale); state.revision = revision(2, null); headerButton(render(props)).onPress(); await flush();
    alert = alerts.at(-1); assert.ok(alert[1].includes(t('pages.someone')));
    state.fresh = { ...page, html: '<p>newer raw HTML</p>' };
    let finishRefetch; state.refetchWait = new Promise(resolve => { finishRefetch = resolve; });
    const from = calls.length; const adopting = alert[2][1].onPress(); tree = render(props);
    assert.equal(find(tree, 'RichEditor').value, draft); assert.equal(state.prevent.dirty, true);
    view('ar', 'America/Los_Angeles'); tree = render(props);
    assert.equal(find(tree, 'RichEditor').value, draft);
    finishRefetch({ data: state.fresh }); await adopting; state.refetchWait = null;
    view(locale); tree = render(props);
    assert.deepEqual(calls.slice(from), ['refetch']); assert.equal(find(tree, 'RichEditor').value, state.fresh.html);
    assert.equal(headerButton(tree).disabled, true); assert.equal(state.prevent.dirty, false);
    // Unchanged adopted revision skips the conflict Alert and preserves normal completion ordering.
    find(tree, 'RichEditor').onChange(draft); const nAlerts = alerts.length;
    headerButton(render(props)).onPress(); await flush(); assert.equal(alerts.length, nAlerts);
    const normal = mutations.at(-1); const completionStart = calls.length;
    const saved = await settleMutation(normal); tree = render(props);
    assert.deepEqual(requests.at(-1), ['put', `/api/v1/${prefix}/${context.id}/pages/raw%20%2F%20slug`, { wiki_page: { body: draft } }]);
    assert.deepEqual(calls.slice(completionStart), [
      ['cache', ['account', prefix, context.id, 'pages', raw.url], saved],
      ['cache', ['account', prefix, context.id, 'pages', api.FRONT_PAGE], saved],
      ['invalidate', { queryKey: ['account', prefix, context.id, 'pages'] }], 'success', 'allowLeave', 'back',
    ]);
    assert.equal(state.prevent.dirty, false);
    // Existing base + unavailable latest still permits save, without adding a conflict.
    const latestUnavailable = harness(ui.PageEditor); state.revision = revision(3);
    latestUnavailable(props); await flush(); find(latestUnavailable(props), 'RichEditor').onChange(draft);
    state.revisionError = true; const alertsBeforeUnavailable = alerts.length;
    headerButton(latestUnavailable(props)).onPress(); await flush();
    assert.equal(alerts.length, alertsBeforeUnavailable);
    assert.deepEqual(mutations.at(-1).value, { context, pageUrl: raw.url, html: draft });
    // New editor: unavailable base still permits save even if latest later becomes available.
    const baseUnavailable = harness(ui.PageEditor); baseUnavailable(props); await flush();
    find(baseUnavailable(props), 'RichEditor').onChange(draft); state.revisionError = false;
    headerButton(baseUnavailable(props)).onPress(); await flush();
    assert.equal(alerts.length, alertsBeforeUnavailable);
    assert.deepEqual(mutations.at(-1).value, { context, pageUrl: raw.url, html: draft });
    // New editor: unavailable revisions still save; discard does not mutate or refetch.
    state.revisionError = true; const noRevision = harness(ui.PageEditor); noRevision(props); await flush();
    find(noRevision(props), 'RichEditor').onChange(draft); const previousAlerts = alerts.length;
    headerButton(noRevision(props)).onPress(); await flush(); assert.equal(alerts.length, previousAlerts);
    assert.deepEqual(mutations.at(-1).value, { context, pageUrl: raw.url, html: draft });
    tree = noRevision(props); state.pending = true; assert.equal(find(noRevision(props), 'RichEditor').editable, false); state.pending = false;
    const discardCounts = [requests.length, mutations.length];
    noRevision(props); state.prevent.callback({ repeat: () => calls.push('repeat') }); alerts.at(-1)[2][1].onPress();
    tree = noRevision(props); assert.equal(state.prevent.dirty, false); assert.equal(calls.at(-1), 'repeat');
    assert.equal(find(tree, 'RichEditor').value, draft); assert.deepEqual([requests.length, mutations.length], discardCounts);
    state.revisionError = false;
    // Failed adoption must keep both the draft and unsaved-change guard, even with stale cached data.
    async function conflictEditor() {
      state.queries[key] = success(page); state.revision = revision(1);
      const render = harness(ui.PageEditor); render(props); await flush();
      find(render(props), 'RichEditor').onChange(draft);
      state.revision = revision(2); headerButton(render(props)).onPress(); await flush();
      return { render, alert: alerts.at(-1) };
    }
    for (const failure of ['empty', 'stale', 'rejected']) {
      const conflict = await conflictEditor();
      let reject, resolve; state.refetchWait = new Promise((yes, no) => { resolve = yes; reject = no; });
      const adopting = conflict.alert[2][1].onPress();
      tree = conflict.render(props);
      const loadingDuringAdoption = headerButton(tree).loading;
      const editableDuringAdoption = find(tree, 'RichEditor').editable;
      if (failure === 'rejected') reject(new Error('Raw refresh failure'));
      else resolve(failure === 'empty' ? {} : { data: page, isError: true, error: new Error('Raw refresh failure') });
      await adopting; state.refetchWait = null;
      for (const language of ['en', 'fr', 'ar']) {
        const currentT = view(language); tree = conflict.render(props);
        assert.equal(find(tree, 'RichEditor').value, draft); assert.equal(state.prevent.dirty, true);
        assert.equal(headerButton(tree).loading, false);
        assert.equal(find(tree, 'Callout').title, currentT('pages.pageLoadError'));
        assert.equal(find(tree, 'Callout').children, failure === 'empty' ? currentT('pages.reloadFailed') : 'Raw refresh failure');
      }
      assert.equal(loadingDuringAdoption, true); assert.equal(editableDuringAdoption, false);
      // Failed adoption did not silently advance the baseline revision.
      const count = alerts.length; headerButton(conflict.render(props)).onPress(); await flush();
      assert.equal(alerts.length, count + 1);
    }
    view(locale);
    // Permission changes invalidate both the current Save button and callbacks held by an open Alert.
    const lostPermission = await conflictEditor();
    const staleSave = headerButton(lostPermission.render(props)).onPress;
    const lostCounts = [requests.length, mutations.length, alerts.length];
    state.queries[key] = success({ ...page, editable: false }); tree = lostPermission.render(props);
    assert.equal(headerButton(tree).disabled, true); assert.equal(state.prevent.dirty, true);
    staleSave(); lostPermission.alert[2][2].onPress(); await flush();
    assert.deepEqual([requests.length, mutations.length, alerts.length], lostCounts);
    state.queries[key] = success(page); tree = lostPermission.render(props);
    assert.equal(find(tree, 'RichEditor').value, draft);
    // Loss during the async revision check also cannot publish a conflict or start a save.
    let finishRevision; state.revisionWait = new Promise(resolve => { finishRevision = resolve; });
    headerButton(tree).onPress(); state.queries[key] = success({ ...page, editable: false }); lostPermission.render(props);
    const pendingCounts = [mutations.length, alerts.length];
    finishRevision(revision(3)); await flush(); state.revisionWait = null;
    assert.deepEqual([mutations.length, alerts.length], pendingCounts);
    // Fresh noneditable screen retains existing permission enforcement and no editor.
    state.queries[key] = success({ ...page, editable: false }); const denied = harness(ui.PageEditor);
    denied(props); await flush(); tree = denied(props);
    assert.equal(find(tree, 'RichEditor'), undefined); assert.equal(headerButton(tree).disabled, true);
    assert.equal(find(tree, 'Callout').title, t('pages.noPermission'));
    state.fresh = undefined;
  }
  console.log(`pages/syllabus checks passed (${Object.keys(catalogs[0]).length} keys; TZ=${process.env.TZ ?? 'device'}; synthetic hooks/clients only)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
