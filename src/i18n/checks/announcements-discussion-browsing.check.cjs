/* global __dirname */
/** Fresh production transpilation with synthetic hooks/query/native/attachment boundaries.
 * No Canvas writes, native rendering, React scheduling or Compiler acceptance claim. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..'), cache = new Map();
let scope;
const calls = [], queries = [], alerts = [], jobs = [];
const state = { queries: {}, label: { name: null, code: null, color: null }, uploads: { items: [], files: [], uploading: false, failed: false }, pending: false, error: null };
const react = {
  useState(initial) { const s = scope, i = s.cursor++; if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial; return [s.slots[i], v => { s.slots[i] = typeof v === 'function' ? v(s.slots[i]) : v; }]; },
  useRef(value) { return react.useState(() => ({ current: value }))[0]; },
  useMemo(fn, deps) { const r = react.useRef(); if (!r.current || deps.some((d, i) => !Object.is(d, r.current.deps[i]))) r.current = { deps, value: fn() }; return r.current.value; },
  useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
};
const jsx = (type, props, key) => ({ type, props, key });
const queryClient = {
  invalidateQueries: x => calls.push(['invalidate', x]),
  cancelQueries: async x => calls.push(['cancelQueries', x]),
  getQueryData: () => state.notices,
  setQueryData: (key, value) => { calls.push(['setQueryData', key]); state.notices = typeof value === 'function' ? value(state.notices) : value; },
};
const client = {
  async request(...args) { calls.push(['request', ...args]); if (state.fail) throw new Error('Raw server error'); return { data: { createDiscussionTopic: { discussionTopic: { _id: 'new /' } } } }; },
  async delete(...args) { calls.push(['delete', ...args]); },
  async get(url, ...args) { calls.push(['get', url, ...args]); return state.responses[url]; },
  async getAll(...args) { calls.push(['getAll', ...args]); return state.rawTopics ?? []; },
};
const mock = {
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': new Proxy({ Alert: { alert: (...args) => alerts.push(args) } }, { get: (o, k) => o[k] ?? k }),
  'lucide-react-native': new Proxy({}, { get: (_o, k) => k }),
  'expo-router': {
    useIsFocused: () => true,
    Stack: { Screen: 'Stack.Screen' },
    router: Object.fromEntries(['push', 'replace', 'back'].map(k => [k, (...args) => calls.push([k, ...args])])),
    useLocalSearchParams: () => ({ courseId: 'c /', groupId: 'g /' }),
    usePreventRemove: (dirty, callback) => { state.guard = { dirty, callback }; return () => calls.push(['allowLeave']); },
  },
  '@tanstack/react-query': { useQueryClient: () => queryClient },
  '@/design': new Proxy({ useTheme: () => ({ colors: { fgMuted: 'muted', accentFg: 'accent' }, scheme: 'light' }), deriveAccent: () => ({ accentFg: 'tint' }), haptics: { error: () => calls.push(['hapticError']), success: () => calls.push(['hapticSuccess']) } }, { get: (o, k) => o[k] ?? k }),
  '@/canvas/session': { useCanvas: () => ({ client, account: { user: { id: 'self' } } }) },
  '@/canvas/query': {
    useAccountKey: () => 'account',
    useCanvasQuery: (key, fn, options) => { queries.push({ key, fn, options }); return state.queries[key.join('/')] ?? { isPending: true }; },
    useCanvasMutation: (fn, options = {}) => ({ isPending: state.pending, error: state.error, mutate: (variables, callbacks = {}) => {
      calls.push(['mutate', variables]);
      const job = (async () => { const ctx = await options.onMutate?.(variables); try { const result = await fn(client, variables); await options.onSuccess?.(result, variables, ctx); callbacks.onSuccess?.(result); } catch (error) { await options.onError?.(error, variables, ctx); callbacks.onError?.(error); } })(); jobs.push(job);
    } }),
  },
  '@/canvas/api/courses': { useDashboardCourses: () => state.courses },
  '@/features/groups/context': { useContextLabel: () => state.label },
  '@/features/course/states': { DetailSkeleton: 'DetailSkeleton' },
  '@/features/inbox/attachments': { AttachButton: 'AttachButton', AttachmentStatus: 'AttachmentStatus', PendingAttachmentList: 'PendingAttachmentList', useAttachmentUploads: opts => { const { owner, ...legacy } = opts; assert.deepEqual(legacy, { folderPath: 'unfiled', max: 1 }); assert.equal(typeof owner.resource, 'string'); assert.equal(owner.focused, true); assert.equal(typeof owner.eligible, 'boolean'); return state.uploads; } },
  '@/features/content/RichContent': { RichContent: 'RichContent' },
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
  // Fresh exact production declarations; editor/TopicView internals are outside this slice.
  const selected = { '@/features/discussions/TopicView': 'topicRoute', '@/features/editor/RichEditor': 'isBlankHtml' }[key];
  if (selected) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    source = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === selected).getText(ast);
    if (selected === 'isBlankHtml') source += '\nexport const RichEditor = "RichEditor";';
  }
  const js = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', js)(n => load(n, file), module, module.exports);
  return module.exports;
}
function harness(fn) { const s = { slots: [], cursor: 0 }; return props => { scope = s; s.cursor = 0; try { return fn(props); } finally { scope = null; } }; }
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, type, test = () => true) => nodes(tree).find(n => n.type === type && test(n.props))?.props;
const header = tree => find(tree, 'Stack.Screen').options;
const post = tree => find(header(tree).headerRight(), 'Button');
const success = data => ({ data, isPending: false, isError: false, refetch: async () => { calls.push(['refetch']); return { data }; } });
const flush = async () => { await Promise.all(jobs.splice(0)); };
const i18n = load('@/i18n/runtime'), dates = load('@/lib/dates');
const view = (locale, zone = 'UTC') => { i18n.setAccountLocale('account', locale); dates.setDisplayTimeZone(zone); return i18n.createTranslator(locale); };
const api = load('@/canvas/api/discussions'), announcements = load('@/canvas/api/announcements');
const rows = load('@/features/discussions/rows'), lists = load('@/features/discussions/ContextLists');
const form = load('@/features/discussions/NewTopicForm'), feed = load('@/app/(app)/announcements');
const noticeUI = load('@/features/discussions/GlobalNotice');
const present = load('@/features/discussions/presentation').discussionPresentation;
const now = new Date('2026-01-10T00:15:00Z'), due = new Date('2026-01-01T00:30:00Z');
const raw = { id: 'a /', title: 'Unknown', message: '<p>Unread</p>', posted_at: due.toISOString(), context_code: 'course_c /', read_state: 'unread' };
const a = Object.freeze(announcements.toAnnouncement(raw));
const topic = Object.freeze({ id: 't /', context: api.courseContext('c /'), title: 'Pinned', pinned: true, locked: true, unread: true, unreadCount: 11, replyCount: 2, assignment: { dueAt: due, points: 1.00001 }, checkpoints: [], postedAt: due, lastReplyAt: due });
(async () => {
  const ar = harness(rows.AnnouncementRow), dr = harness(rows.DiscussionRow), dl = harness(lists.DiscussionListScreen), al = harness(lists.AnnouncementListScreen);
  const count = Object.keys(load('@/i18n/en').en).length;
  assert.ok(count >= 1275, 'preserve the integrated catalog while allowing later additive slices');
  for (const l of ['fr', 'ar']) assert.deepEqual(Object.keys(load(`@/i18n/${l}`)[l]).sort(), Object.keys(load('@/i18n/en').en).sort());
  for (const locale of ['en', 'fr', 'ar']) for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const t = view(locale, zone), p = present(locale, zone), before = calls.length;
    const rendered = dr({ topic, now }), announcement = ar({ announcement: a, now });
    assert.equal(rendered.props.title, 'Pinned'); assert.equal(announcement.props.title, 'Unknown');
    assert.equal(announcement.props.subtitle, 'Unread'); assert.equal(a.author.name, 'Unknown');
    assert.equal(announcement.props.leading.props.name, t('discussions.unknownAuthor'));
    assert.ok(announcement.props.accessibilityLabel.includes(p.ageLabel(due, now)));
    const expectedDate = new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, month: 'short', day: 'numeric', ...(zone === 'America/Los_Angeles' ? { year: 'numeric' } : {}) }).format(due);
    assert.equal(p.ageLabel(due, now), expectedDate);
    assert.equal(rendered.props.subtitle, p.meta(topic, now));
    assert.ok(rendered.props.subtitle.includes(new Intl.NumberFormat(locale, { maximumSignificantDigits: 21 }).format(1.00001)));
    assert.equal(rendered.props.trailing.props.children, p.number(11));
    for (const n of [0, 1, 2, 3, 11, 100, 101, 1.00001, 1e-21]) {
      for (const unread of [false, true]) {
        const key = unread ? 'discussions.unreadReplies' : 'discussions.replies';
        const catalog = load(`@/i18n/${locale}`)[locale], rule = new Intl.PluralRules(locale).select(n);
        const template = catalog[key][rule] ?? catalog[key].other;
        const num = p.number(n), expected = template.replace('{number}', locale === 'ar' ? `\u2068${num}\u2069` : num);
        assert.equal(p.replies(n, unread), expected);
      }
    }
    for (const name of ['Unknown', '', 'Pinned']) {
      const supplied = announcements.toAnnouncement({ ...raw, author: { display_name: name } });
      assert.equal(supplied.authorNameFallback, undefined); assert.equal(p.author(supplied), name);
      assert.equal(p.author({ ...a, author: { name }, authorNameFallback: undefined }), name);
      assert.equal(p.author({ ...a, author: { name }, authorNameFallback: 'future' }), name);
    }
    assert.equal(p.author(announcements.toAnnouncement({ ...raw, user_name: 'Unknown' })), 'Unknown');
    for (const minutes of [0, 5, 90, 1500]) {
      const d = new Date(now.getTime() - minutes * 60000);
      assert.equal(p.ageLabel(d, now), minutes === 0 ? t('date.now') : new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-(minutes < 60 ? minutes : minutes < 1440 ? Math.floor(minutes / 60) : 1), minutes < 60 ? 'minute' : minutes < 1440 ? 'hour' : 'day'));
    }
    const midnight = new Date('2026-01-10T08:00:00Z');
    const midnightTopic = { ...topic, checkpoints: [{ kind: 'reply_to_topic', dueAt: midnight }] };
    const day = t(zone === 'America/Los_Angeles' ? 'date.tomorrow' : 'date.today');
    const time = new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(midnight);
    assert.ok(dr({ topic: midnightTopic, now }).props.subtitle.startsWith(t('discussions.replyDue', { date: t('date.at', { day, time }) })));
    for (const points of [0, 3.9999, 4.00001, 0.000001, 1e-21, 1000000.123456]) {
      assert.ok(dr({ topic: { ...topic, assignment: { ...topic.assignment, points } }, now }).props.subtitle.includes(p.number(points)));
    }
    const future = new Date('2026-01-10T01:00:00Z');
    for (const [checkpoints, key, target] of [
      [[{ kind: 'reply_to_topic', dueAt: due }, { kind: 'reply_to_entry', dueAt: future }], 'discussions.repliesDue', future],
      [[{ kind: 'reply_to_topic', dueAt: due }], 'discussions.replyDue', due],
      [[{ kind: 'reply_to_topic', dueAt: null }], 'discussions.due', due],
    ]) assert.ok(p.meta({ ...topic, checkpoints }, now).startsWith(t(key, { date: dates.createDateContext(locale, zone).formatDueDate(target, now) })));
    assert.ok(p.meta({ ...topic, assignment: null }, now).includes(t('discussions.lastReply', { age: p.dates.relativeAge(due, now) })));
    assert.ok(p.meta({ ...topic, isGroupDiscussion: true }, now).includes(t('discussions.group')));
    assert.equal(calls.length, before, 'locale/zone-only rows have no side effects');
    for (const type of ['course', 'group']) {
      const context = { type, id: 'context /' };
      // Production contextKey is the authority; preserve stable keys and instructor ordering.
      const ck = api.contextKey(context);
      state.queries[`discussions/${ck}/creation`] = success({ canCreate: true, canAttach: true });
      state.queries[`discussions/${ck}`] = success([
        { ...topic, id: 'p2', position: 2 }, { ...topic, id: 'o1', pinned: false, locked: false, lastReplyAt: due },
        { ...topic, id: 'p1', position: 1 }, { ...topic, id: 'o2', pinned: false, locked: false, lastReplyAt: now },
        { ...topic, id: 'closed', pinned: false },
      ]);
      const b = calls.length, tree = dl({ context });
      assert.deepEqual(nodes(tree).filter(n => n.type === 'ListGroup').map(n => n.props.header), [t('discussions.pinned'), t('discussions.title'), t('discussions.closed')]);
      assert.deepEqual(nodes(tree).filter(n => n.type === 'ListGroup').map(n => [n.key, nodes(n).filter(x => x.type === rows.DiscussionRow).map(x => x.props.topic.id)]), [['pinned', ['p1', 'p2']], ['open', ['o2', 'o1']], ['closed', ['closed']]]);
      assert.equal(calls.length, b);
      find(header(tree).headerRight(), 'IconButton').onPress(); assert.deepEqual(calls.at(-1), ['push', lists.newTopicRoute(context)]);
      rows.openTopic(context, 't /'); assert.deepEqual(calls.at(-1), ['push', { pathname: `/${type}/[${type}Id]/discussion/[topicId]`, params: { [`${type}Id`]: context.id, topicId: 't /' } }]);
      state.queries[`discussions/${ck}`] = success([]);
      assert.equal(find(dl({ context }), 'EmptyState').description, t('discussions.emptyCreate', { context: t(type === 'course' ? 'discussions.thisCourse' : 'discussions.thisGroup') }));
      state.queries[`discussions/${ck}/creation`] = success({ canCreate: false });
      assert.equal(header(dl({ context })).headerRight, undefined);
      state.queries[`announcements/${type}/${context.id}`] = success([]);
      assert.equal(find(al({ context }), 'EmptyState').description, t('announcements.emptyContext', { context: t(type === 'course' ? 'discussions.thisCourse' : 'discussions.thisGroup') }));
      state.label = { name: 'this group', code: 'this course', color: '#123456' };
      assert.ok(find(al({ context }), 'EmptyState').description.includes(type === 'course' ? 'this course' : 'this group'));
      state.label = { name: null, code: null, color: null };
      state.queries[`announcements/${type}/${context.id}`] = { ...success(null), isError: true, error: new Error('Raw announcements error') };
      assert.equal(find(al({ context }), 'Callout').children, 'Raw announcements error');
      state.queries[`discussions/${ck}`] = { ...success(null), isError: true, error: new Error('Raw discussions error') };
      assert.equal(find(dl({ context }), 'Callout').children, 'Raw discussions error');
      state.queries[`discussions/${ck}`] = { isPending: true };
      assert.ok(find(dl({ context }), 'Skeleton'));
    }
  }
  // Wrappers preserve the exact course/group route parameters, without remount keys.
  for (const type of ['course', 'group']) for (const suffix of ['announcements', 'discussions', 'discussion/new']) {
    const tree = harness(load(`@/app/(app)/${type}/[${type}Id]/${suffix}`).default)();
    assert.deepEqual(tree.props.context, { type, id: type === 'course' ? 'c /' : 'g /' }); assert.equal(tree.key, undefined);
  }
  // Stateful feed filter and school notice callbacks survive locale changes.
  const f = harness(feed.default), n = { id: 'n /', subject: 'Unknown', html: '<p>Announcements</p>', kind: 'information' };
  state.courses = success([{ id: 'c /', code: 'Discussions', name: 'Unknown' }, { id: 'other', code: 'Other', name: 'Other' }]);
  state.queries['announcements/180/c //other'] = success([a, { ...a, id: 'other', courseId: 'other' }]);
  state.queries['account-notifications'] = success([n]);
  view('en'); let tree = f();
  find(tree, 'Chip', x => x.accessibilityLabel === 'Unknown').onPress(); tree = f();
  for (const locale of ['fr', 'ar', 'en']) {
    const before = calls.length, startQuery = queries.length; view(locale); tree = f();
    assert.deepEqual(queries.slice(startQuery).map(q => q.key), [['announcements', 180, 'c /', 'other'], ['account-notifications']]);
    assert.equal(find(tree, 'Chip', x => x.accessibilityLabel === 'Unknown').selected, true);
    assert.deepEqual(nodes(tree).filter(x => x.type === rows.AnnouncementRow).map(x => x.key), ['a /']);
    const np = find(tree, noticeUI.GlobalNotice), rendered = harness(noticeUI.GlobalNotice)(np);
    assert.equal(rendered.props.title, n.subject); assert.equal(find(rendered, 'RichContent').html, n.html);
    assert.equal(calls.length, before); assert.equal(queries.at(-2).key[1], 180);
  }
  state.notices = [n]; find(tree, noticeUI.GlobalNotice).onDismiss(); await flush();
  assert.ok(calls.some(c => c[0] === 'delete' && c[1] === '/api/v1/accounts/self/account_notifications/n /')); assert.deepEqual(state.notices, []);
  const beforeRefresh = calls.filter(c => c[0] === 'refetch').length;
  await find(tree, 'Screen').refreshControl.props.onRefresh();
  assert.equal(calls.filter(c => c[0] === 'refetch').length - beforeRefresh, 3);
  // A rejected refresh must not strand the spinner; sibling requests still get to finish.
  for (const kind of ['feed', 'discussions', 'announcements']) {
    let finish;
    const waiting = { ...success([]), refetch: () => new Promise(resolve => { finish = resolve; }) };
    const failed = { ...success([]), refetch: async () => { throw new Error('Raw refresh failure'); } };
    const context = { type: 'course', id: 'refresh' }, ck = api.contextKey(context);
    let render, props;
    if (kind === 'feed') {
      state.courses = failed; state.queries['announcements/180'] = waiting;
      state.queries['account-notifications'] = success([]); render = harness(feed.default);
    } else if (kind === 'discussions') {
      state.queries[`discussions/${ck}`] = failed; state.queries[`discussions/${ck}/creation`] = waiting;
      render = harness(lists.DiscussionListScreen); props = { context };
    } else {
      state.queries['announcements/course/refresh'] = failed;
      render = harness(lists.AnnouncementListScreen); props = { context };
    }
    const refreshing = find(render(props), 'Screen').refreshControl.props.onRefresh();
    assert.equal(find(render(props), 'Screen').refreshControl.props.refreshing, true);
    await Promise.resolve(); await Promise.resolve();
    if (finish) {
      assert.equal(find(render(props), 'Screen').refreshControl.props.refreshing, true);
      finish({ data: [] });
    }
    await refreshing;
    assert.equal(find(render(props), 'Screen').refreshControl.props.refreshing, false, kind);
  }
  // Production form, persistent hooks: title validation, all draft values, uploads and options.
  for (const type of ['course', 'group']) {
    const context = { type, id: 'draft /' }, ck = api.contextKey(context), render = harness(form.NewTopicForm);
    state.queries[`discussions/${ck}/creation`] = success({ canCreate: true, canAttach: true });
    state.uploads = { items: [], files: [], uploading: false, failed: false }; state.pending = false; state.error = null;
    view('en'); let tree = render({ context }); assert.equal(state.guard.dirty, false); post(tree).onPress();
    for (const locale of ['fr', 'ar', 'en']) {
      const before = calls.length, t = view(locale); tree = render({ context });
      assert.equal(find(tree, 'TextField').error, t('discussions.titleRequired')); assert.equal(find(tree, 'TextField').value, ''); assert.equal(calls.length, before);
    }
    find(tree, 'TextField').onChangeText('  Unknown  '); find(tree, 'RichEditor').onChange('<p>Raw body</p>');
    const switches = nodes(tree).filter(n => n.type === 'ListItem').map(n => n.props.trailing.props);
    switches[0].onValueChange(false); switches[1].onValueChange(true); switches[2].onValueChange(true);
    state.uploads.items = [{ name: 'Attach a file', id: 'local' }]; state.uploads.files = [{ id: 'file /', name: 'Unknown' }];
    for (const locale of ['fr', 'ar', 'en']) {
      const before = calls.length; view(locale); tree = render({ context });
      assert.equal(state.guard.dirty, true); assert.equal(find(tree, 'TextField').value, '  Unknown  '); assert.equal(find(tree, 'TextField').error, null);
      assert.equal(find(tree, 'TextField').maxLength, 255); assert.equal(find(tree, 'TextField').autoFocus, true);
      assert.equal(find(tree, 'RichEditor').value, '<p>Raw body</p>'); assert.equal(find(tree, 'PendingAttachmentList').uploads, state.uploads);
      assert.deepEqual(nodes(tree).filter(n => n.type === 'ListItem').map(n => n.props.trailing.props.value), [false, true, true]);
      assert.equal(calls.length, before);
    }
    for (const block of ['uploading', 'failed', 'pending']) {
      if (block === 'pending') state.pending = true; else state.uploads[block] = true;
      tree = render({ context }); assert.equal(post(tree).disabled, true); const before = calls.length; post(tree).onPress(); assert.equal(calls.length, before);
      if (block === 'pending') { assert.equal(find(tree, 'TextField').editable, false); assert.equal(find(tree, 'RichEditor').editable, false); assert.equal(find(tree, 'AttachButton').disabled, true); state.pending = false; } else state.uploads[block] = false;
    }
    state.error = new Error('Raw server error'); tree = render({ context }); assert.equal(find(tree, 'Callout').children, 'Raw server error'); state.error = null;
    state.fail = true; post(render({ context })).onPress(); await flush(); assert.equal(state.guard.dirty, true); assert.equal(find(render({ context }), 'TextField').value, '  Unknown  '); state.fail = false;
    post(render({ context })).onPress(); await flush();
    const request = calls.filter(c => c[0] === 'request').at(-1);
    assert.equal(request[1], '/api/graphql'); assert.equal(request[2].method, 'POST'); assert.equal(request[2].body.operationName, 'EaselCreateDiscussionTopic');
    assert.deepEqual(request[2].body.variables, { contextId: context.id, contextType: type === 'course' ? 'Course' : 'Group', title: 'Unknown', message: '<p>Raw body</p>', fileId: 'file /', discussionType: 'not_threaded', requireInitialPost: true, allowRating: true });
    assert.ok(request[2].body.query.includes('published: true'));
    assert.ok(calls.some(c => c[0] === 'invalidate' && JSON.stringify(c[1].queryKey) === JSON.stringify(['account', 'discussions', ck])));
    assert.deepEqual(calls.at(-1), ['replace', load('@/features/discussions/TopicView').topicRoute(context, 'new /')]);
    render({ context }); assert.equal(state.guard.dirty, false);
    // Denied/pending/error gates preserve draft state and existing back/refetch actions.
    state.queries[`discussions/${ck}/creation`] = success({ canCreate: false, canAttach: false }); tree = render({ context }); assert.equal(header(tree).headerRight, undefined); find(tree, 'EmptyState').action.onPress(); assert.deepEqual(calls.at(-1), ['back']);
    state.queries[`discussions/${ck}/creation`] = { isPending: true }; assert.ok(find(render({ context }), 'DetailSkeleton'));
    state.queries[`discussions/${ck}/creation`] = { ...success(null), isError: true, error: new Error('Permission raw') }; tree = render({ context }); assert.equal(find(tree, 'Callout').children, 'Permission raw'); await find(tree, 'Callout').action.onPress();
    state.queries[`discussions/${ck}/creation`] = success({ canCreate: true, canAttach: false }); tree = render({ context }); assert.equal(find(tree, 'TextField').value, '  Unknown  '); assert.equal(find(tree, 'AttachButton'), undefined);
    for (const locale of ['en', 'fr', 'ar']) {
      const t = view(locale), { CanvasError } = load('@/canvas/client');
      for (const reason of ['discussion-no-response', 'future', undefined]) {
        const error = Object.assign(new CanvasError('Canvas didn’t answer. Try again.', 400, '/api/graphql'), { reason });
        const expected = reason === 'discussion-no-response' ? t('discussionThread.noResponse') : error.message;
        state.error = error; assert.equal(find(render({ context }), 'Callout').children, expected); assert.equal(state.error, error); state.error = null;
        state.queries[`discussions/${ck}/creation`] = { isError: true, error };
        assert.equal(find(render({ context }), 'Callout').children, expected);
        state.queries[`discussions/${ck}/creation`] = success({ canCreate: true, canAttach: false });
      }
    }
    // Fresh blank-HTML form preserves empty message and null file exactly.
    state.uploads = { items: [], files: [], uploading: false, failed: false };
    const blank = harness(form.NewTopicForm); tree = blank({ context }); find(tree, 'TextField').onChangeText('Blank'); find(tree, 'RichEditor').onChange('<p>&nbsp;</p>'); post(blank({ context })).onPress(); await flush();
    assert.deepEqual(calls.filter(c => c[0] === 'request').at(-1)[2].body.variables, { contextId: context.id, contextType: type === 'course' ? 'Course' : 'Group', title: 'Blank', message: '', fileId: null, discussionType: 'threaded', requireInitialPost: false, allowRating: false });
    // Discard Alert captures invoking translator and invokes repeat exactly once per tap.
    const discard = harness(form.NewTopicForm); view('fr'); tree = discard({ context }); find(tree, 'RichEditor').onChange('<p>Draft</p>'); discard({ context });
    let repeats = 0; state.guard.callback({ repeat: () => repeats++ }); const alert = alerts.at(-1); assert.equal(alert[0], i18n.createTranslator('fr')('discussions.discardTitle')); assert.equal(alert[2][0].style, 'cancel'); assert.equal(alert[2][0].onPress, undefined);
    view('ar'); discard({ context }); assert.equal(state.guard.dirty, true); assert.equal(alert[0], i18n.createTranslator('fr')('discussions.discardTitle'));
    alert[2][1].onPress(); discard({ context }); assert.equal(repeats, 1); assert.equal(state.guard.dirty, false);
  }
  // Production adapter permission decisions and feed range remain unchanged.
  state.responses = { '/api/v1/courses/c': { permissions: { create_discussion_topic: true } }, '/api/v1/courses/c/settings': { allow_student_forum_attachments: false }, '/api/v1/groups/g': { course_id: 'c', permissions: { create_discussion_topic: false } } };
  assert.deepEqual(await api.fetchTopicCreation(client, api.courseContext('c')), { canCreate: true, canAttach: false });
  assert.deepEqual(await api.fetchTopicCreation(client, api.groupContext('g')), { canCreate: false, canAttach: false });
  state.rawTopics = [raw]; const start = Date.now(); await announcements.fetchAnnouncements(client, ['c /'], { days: announcements.FEED_DAYS });
  const request = calls.at(-1); assert.equal(request[1], '/api/v1/announcements'); assert.deepEqual(request[2].context_codes, ['course_c /']);
  const expected = new Date(start); expected.setDate(expected.getDate() - 180); assert.ok(Math.abs(new Date(request[2].start_date).getTime() - expected.getTime()) < 1000);
  assert.equal(calls.filter(c => ['upload', 'read', 'fetch'].includes(c[0])).length, 0);
  console.log(`announcements/discussion browsing: ${count} keys, en/fr/ar × 3 Canvas zones; host TZ=${process.env.TZ}; production state/routes/payload checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
