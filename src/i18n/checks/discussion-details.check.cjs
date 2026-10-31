/* global __dirname */
/** Fresh production transpilation; hook/effect simulations, not React reconciliation or Compiler.
 * Native/query/session/Thread/Composer boundaries are explicit mocks; no real Canvas calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..'), cache = new Map();
let scope;
const calls = [], queries = [], alerts = [];
const success = data => ({ data, isPending: false, isError: false, refetch: async () => { calls.push(['refetch']); return { data }; } });
const state = { label: { name: null, code: null, color: null }, topic: success(null), thread: success(null), groups: success([]), permissions: success(null), mutations: {}, header: { action: null, host: () => {} } };
const react = {
  useState(initial) { const s = scope, i = s.cursor++; if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial; return [s.slots[i], v => { s.slots[i] = typeof v === 'function' ? v(s.slots[i]) : v; }]; },
  useRef(value) { return react.useState(() => ({ current: value }))[0]; },
  useMemo(fn, deps) { const r = react.useRef(); if (!r.current || deps.some((d, i) => !Object.is(d, r.current.deps[i]))) r.current = { deps, value: fn() }; return r.current.value; },
  useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
  useEffect(fn, deps) { const r = react.useRef(); if (!r.current || deps.some((d, i) => !Object.is(d, r.current[i]))) { scope.effects.push(fn); r.current = deps; } },
  useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
};
const jsx = (type, props, key) => ({ type, props, key });
const mutations = Object.fromEntries(['MarkTopicRead', 'MarkEntriesRead', 'MarkAllRead', 'MarkEntryUnread', 'PostEntry', 'UpdateEntry', 'DeleteEntry', 'RateEntry'].map(name => [name, {
  mutate: (variables, callbacks = {}) => calls.push([name, variables, callbacks]),
  reset: () => calls.push(['reset', name]),
}]));
const contextApi = { contextKey: c => `${c.type}:${c.id}`, courseContext: id => ({ type: 'course', id }), groupContext: id => ({ type: 'group', id }) };
const tracker = Object.fromEntries(['check', 'checkNow', 'register', 'markHandled'].map(name => [name, (...args) => calls.push([name, ...args])]));
tracker.seen = new Set();
const mock = {
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': new Proxy({ Alert: { alert: (...args) => alerts.push(args) } }, { get: (o, k) => o[k] ?? k }),
  'lucide-react-native': new Proxy({}, { get: (_o, k) => k }),
  'expo-router': { Stack: { Screen: 'Stack.Screen' }, router: Object.fromEntries(['push', 'replace'].map(name => [name, (...args) => calls.push([name, ...args])])), useLocalSearchParams: () => ({ courseId: 'c /', groupId: 'g /', topicId: 't /' }) },
  '@/design': new Proxy({ useTheme: () => ({ colors: { fgMuted: 'muted' }, scheme: 'light' }), deriveAccent: () => ({ accentFg: 'tint' }), useToast: () => ({ show: text => calls.push(['toast', text]), element: null }) }, { get: (o, k) => o[k] ?? k }),
  '@/canvas/session': { useCanvas: () => ({ account: { id: 'account', user: { id: 'self' } } }) },
  '@/canvas/api/discussions': {
    ...contextApi,
    useDiscussionTopic: (...args) => { queries.push(['topic', ...args]); return state.topic; },
    useDiscussionThread: (...args) => { queries.push(['thread', ...args]); return state.thread; },
    useOwnPostPermissions: (...args) => { queries.push(['permissions', ...args]); return state.permissions; },
    ...Object.fromEntries(Object.entries(mutations).map(([name, mutation]) => [`use${name}`, () => ({ ...mutation, ...state.mutations[name] })])),
  },
  '@/canvas/api/groups': { useMyCourseGroups: (...args) => { queries.push(['groups', ...args]); return state.groups; } },
  '@/features/groups/context': { useContextLabel: () => state.label },
  '@/features/content/RichContent': { RichContent: 'RichContent' },
  '@/features/files/AttachmentList': { AttachmentList: 'AttachmentList' },
  '@/features/discussions/useSeenTracker': { useSeenTracker: callback => { state.onSeen = callback; return tracker; } },
  '@/features/discussions/sortPreference': { useReplySort: (...args) => { queries.push(['sort', ...args]); const [value, set] = react.useState(args[2]); return [args[3] ? args[2] : value, next => { calls.push(['preference', next]); set(next); }]; } },
  '@/features/discussions/Thread': {
    ...Object.fromEntries(['Composer', 'ComposerActionProvider', 'ComposerHeaderButton', 'MentionHint', 'SearchResults', 'ThreadList', 'ThreadProvider'].map(k => [k, k])),
    useComposerActionHost: () => state.header,
    // Search algorithm is extracted verbatim below; rendering/editor internals stay mocked.
    searchEntries: (...args) => searchEntries(...args),
  },
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
  if (key === '@/features/discussions/TopicView') source += '\nexport { TopicHeader, GroupCopyNotice, Replies };';
  const js = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', js)(n => load(n, file), module, module.exports);
  return module.exports;
}
const threadSource = fs.readFileSync(path.join(root, 'features/discussions/Thread.tsx'), 'utf8');
const threadAst = ts.createSourceFile('Thread.tsx', threadSource, ts.ScriptTarget.Latest, true);
const searchSource = threadAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'searchEntries').getText(threadAst);
const searchModule = { exports: {} };
new Function('exports', 'projectHtml', ts.transpileModule(searchSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(searchModule.exports, load('@/features/discussions/mentions').projectHtml);
const searchEntries = searchModule.exports.searchEntries;
function harness(fn) { const s = { slots: [], cursor: 0, effects: [] }; return props => { scope = s; s.cursor = 0; s.effects = []; try { const tree = fn(props); s.effects.forEach(effect => effect()); return tree; } finally { scope = null; } }; }
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, type, test = () => true) => nodes(tree).find(n => n.type === type && test(n.props))?.props;
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const i18n = load('@/i18n/runtime'), dates = load('@/lib/dates');
const view = (locale, zone = 'UTC') => { i18n.setAccountLocale('account', locale); dates.setDisplayTimeZone(zone); return i18n.createTranslator(locale); };
const ui = load('@/features/discussions/TopicView'), cp = load('@/features/discussions/CheckpointCard');
const presentation = load('@/features/discussions/presentation').discussionPresentation;
const now = new Date('2026-01-01T08:15:00Z'), due = new Date('2026-01-01T00:30:00Z');
const context = Object.freeze({ type: 'course', id: 'c /' });
const topic = Object.freeze({ id: 't /', context, courseId: context.id, title: 'Discussion', html: '<p>Anonymous</p>', author: { name: 'Unknown author', avatarUrl: 'raw-avatar' }, postedAt: due, assignment: { dueAt: due, points: 3.9999 }, checkpoints: [], attachments: [{ id: 'file /', displayName: 'Attachments' }], unread: true, replyCount: 3, anonymity: null, isAnnouncement: false, isGroupDiscussion: false, canSeePosts: true, canReply: true, canAttach: true, allowRating: true, onlyGradersCanRate: false, threaded: true, sortOrder: 'desc', sortOrderLocked: false, groupChildren: [] });
const entry = (id, props = {}) => ({ id, mine: false, deleted: false, unread: true, html: 'needle', author: { name: 'Anonymous' }, createdAt: new Date(`2026-01-0${id.length + 1}`), replies: [], ...props });
const entries = [entry('a', { mine: true, replies: [entry('aa', { mine: true }), entry('aaa', { deleted: true, mine: true, replies: [entry('aaaa', { mine: true })] })] }), entry('bb'), entry('ccc', { mine: true, deleted: true })];
const visible = { status: 'visible', entries, count: 6 };
const replyProps = { context, topic, thread: success(visible), target: null, setTarget: value => calls.push(['target', value]), submitting: false, error: null, now, scrollViewRef: { current: null }, seen: new Set(), registerUnread: tracker.register, onLayoutChange: tracker.checkNow, markingAll: false, ...Object.fromEntries(['MarkAllRead', 'MarkUnread', 'Reply', 'Edit', 'Delete', 'Like'].map(k => [`on${k}`, (...args) => calls.push([k, ...args])])) };
(async () => {
  const catalog = load('@/i18n/en').en;
  assert.ok(Object.keys(catalog).length >= 1321);
  for (const lang of ['fr', 'ar']) assert.deepEqual(Object.keys(load(`@/i18n/${lang}`)[lang]).sort(), Object.keys(catalog).sort());
  const header = harness(ui.TopicHeader), card = harness(cp.CheckpointCard), replies = harness(ui.Replies);
  const checkpointTopic = { ...topic, checkpoints: [{ kind: 'reply_to_topic', required: 1, dueAt: due, points: 3.9999 }, { kind: 'reply_to_entry', required: 3, dueAt: due, points: 1e-21 }] };
  for (const locale of ['en', 'fr', 'ar']) for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const t = view(locale, zone), p = presentation(locale, zone), before = calls.length;
    let tree = header({ topic, meta: 'Announcement', now });
    assert.equal(find(tree, 'Avatar').name, topic.author.name); assert.equal(find(tree, 'Avatar').uri, 'raw-avatar');
    assert.ok(text(tree).includes(topic.title));
    const expectedDay = t(zone === 'America/Los_Angeles' ? 'date.yesterday' : 'date.today');
    // Compare the scoped formatter to host Intl, including the cross-midnight Canvas-zone case.
    const expectedTime = new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(due);
    assert.equal(p.dates.formatDueDate(due, now), t('date.at', { day: expectedDay, time: expectedTime }));
    assert.ok(text(tree).includes(p.dates.formatDueDate(due, now)));
    assert.ok(text(tree).includes(p.number(3.9999))); assert.notEqual(p.number(3.9999), p.number(4)); assert.notEqual(p.number(1e-21), p.number(0));
    for (const author of [null, { name: '' }, { name: 'Anonymous' }, { name: 'Unknown author' }]) for (const anonymity of [null, 'full', 'partial']) {
      tree = header({ topic: { ...topic, author, anonymity }, meta: null, now });
      assert.equal(find(tree, 'Avatar').name, author?.name ?? t(anonymity ? 'discussionDetail.anonymous' : 'discussionDetail.unknownAuthor'));
      if (!author) assert.equal(find(tree, 'Avatar').uri, undefined);
    }
    tree = header({ topic: { ...topic, checkpoints: checkpointTopic.checkpoints }, meta: null, now });
    assert.equal(find(tree, 'Badge'), undefined);
    tree = card({ topic: checkpointTopic, entries, gated: false, now });
    assert.ok(text(tree).includes(t('discussionDetail.done')));
    assert.ok(text(tree).includes(t('discussionDetail.progress', { done: p.number(2), required: p.number(3) })));
    const accessible = nodes(tree).filter(n => n.props?.accessible);
    assert.ok(!accessible[0].props.accessibilityLabel.includes(t('discussionDetail.pastDue')));
    assert.ok(accessible[1].props.accessibilityLabel.includes(t('discussionDetail.pastDue')));
    assert.ok(text(tree).includes(p.number(1e-21)));
    for (const required of [0, 1, 2, 3, 11, 100]) {
      const c = { kind: 'reply_to_entry', required, dueAt: null, points: null };
      tree = card({ topic: { ...topic, checkpoints: [c] }, entries: null, gated: false, now });
      assert.equal(nodes(tree).filter(n => n.props?.tabular).length, 0);
      assert.ok(text(tree).includes(t('discussionDetail.classmates', { count: required, number: p.number(required) })));
      assert.ok(text(tree).includes(t('discussionDetail.noDueDate')));
      tree = card({ topic: { ...topic, checkpoints: [c] }, entries: null, gated: true, now });
      assert.ok(text(tree).includes(required === 0 ? t('discussionDetail.done') : required === 1 ? t('discussionDetail.notDone') : t('discussionDetail.progress', { done: p.number(0), required: p.number(required) })));
    }
    tree = replies(replyProps);
    assert.equal(find(tree, 'Section').title, t('discussionDetail.repliesCount', { number: p.number(6) }));
    assert.equal(find(tree, 'SegmentedControl').options[0].label, t('discussionDetail.newest'));
    assert.deepEqual(find(tree, 'SegmentedControl').options.map(o => o.value), ['desc', 'asc']);
    assert.deepEqual(find(tree, 'ThreadList').entries.map(e => e.id), ['ccc', 'bb', 'a']);
    assert.ok(text(tree).includes(t('discussionDetail.unread', { count: 4, number: p.number(4) })));
    const provider = find(tree, 'ThreadProvider').value;
    assert.equal(provider.target, null); assert.equal(provider.registerUnread, tracker.register); assert.equal(provider.onLayoutChange, tracker.checkNow);
    assert.equal(calls.length, before, 'presentation does not write, navigate, refetch or mark read');
  }
  assert.deepEqual(cp.checkpointProgress(entries, { kind: 'reply_to_topic', required: 4 }), { done: 1, required: 4 });
  assert.deepEqual(cp.checkpointProgress(entries, { kind: 'reply_to_entry', required: 4 }), { done: 2, required: 4 });
  assert.deepEqual(cp.checkpointProgress(entries, { kind: 'reply_to_entry', required: 1 }), { done: 1, required: 1 });
  assert.deepEqual(cp.checkpointProgress([], { kind: 'reply_to_entry', required: 2 }), { done: 0, required: 2 });
  // Numeric grammar must follow numeric counts, including Arabic's six cardinal categories.
  for (const locale of ['en', 'fr', 'ar']) for (const count of [0, 1, 2, 3, 11, 100]) {
    const t = view(locale), p = presentation(locale, 'UTC');
    assert.equal(p.number(3.9999), new Intl.NumberFormat(locale, { maximumSignificantDigits: 21 }).format(3.9999));
    assert.equal(p.number(1e-21), new Intl.NumberFormat(locale, { maximumSignificantDigits: 21 }).format(1e-21));
    const list = Array.from({ length: count }, (_, i) => entry(String(i)));
    const thread = success({ status: 'visible', entries: list, count });
    let tree = replies({ ...replyProps, thread });
    if (count) {
      assert.ok(text(tree).includes(t('discussionDetail.unread', { count, number: p.number(count) })));
      tree = replies({ ...replyProps, thread, seen: new Set(list.map(e => e.id)) });
      assert.ok(text(tree).includes(t('discussionDetail.newSince', { count, number: p.number(count) })));
    } else assert.equal(find(tree, 'Section').action, undefined);
    tree = replies({ ...replyProps, topic: { ...topic, canSeePosts: false, replyCount: count }, thread: success({ status: 'gated' }) });
    assert.equal(find(tree, 'Callout').children, t('discussionDetail.gateBody', { status: count ? t('discussionDetail.waiting', { count, number: p.number(count) }) : t('discussionDetail.noOneReplied') }));
  }
  // Same component instance, same topic/entries: preserve search, sort, target and callback boundaries.
  view('en'); let tree = replies(replyProps);
  find(tree, 'SegmentedControl').onChange('asc'); tree = replies(replyProps);
  assert.deepEqual(find(tree, 'ThreadList').entries.map(e => e.id), ['a', 'bb', 'ccc']);
  find(tree, 'SearchField').onChangeText(' needle ');
  const target = { kind: 'edit', entryId: 'aa' };
  for (const locale of ['fr', 'ar', 'en']) {
    const before = calls.length; view(locale); tree = replies({ ...replyProps, target });
    assert.equal(find(tree, 'SearchField').value, ' needle '); assert.equal(find(tree, 'SegmentedControl'), undefined);
    assert.deepEqual(find(tree, 'SearchResults').results, searchEntries(entries, ' needle '));
    assert.equal(find(tree, 'ThreadProvider').value.target, target); assert.equal(calls.length, before);
  }
  find(tree, 'SearchField').onChangeText(''); tree = replies(replyProps);
  assert.equal(find(tree, 'SegmentedControl').value, 'asc');
  tree = replies({ ...replyProps, topic: { ...topic, sortOrderLocked: true } });
  assert.equal(find(tree, 'SegmentedControl'), undefined);
  assert.deepEqual(find(tree, 'ThreadList').entries.map(e => e.id), ['ccc', 'bb', 'a']);
  // The owning screen passes the viewing translator into author search without changing the query.
  const generated = entry('p', { author: { name: 'Anonymous 4f' }, authorNameOrigin: { kind: 'anonymous', token: '4f' } });
  const generatedProps = { ...replyProps, thread: success({ status: 'visible', entries: [generated], count: 3 }) };
  for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale), before = calls.length;
    tree = replies(generatedProps);
    const query = t('discussionThread.anonymousToken', { token: '4f' }).replace(/[\u2068\u2069]/g, '');
    find(tree, 'SearchField').onChangeText(query); tree = replies(generatedProps);
    assert.deepEqual(find(tree, 'SearchResults').results.map(r => r.entry.id), ['p']);
    view('en'); tree = replies(generatedProps);
    assert.equal(find(tree, 'SearchField').value, query);
    assert.deepEqual(find(tree, 'SearchResults').results.map(r => r.entry.id), locale === 'en' ? ['p'] : []);
    assert.equal(calls.length, before);
  }
  find(tree, 'SearchField').onChangeText('');
  for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale);
    for (const canReply of [false, true]) for (const anonymity of [null, 'partial', 'full']) {
      state.permissions = success({ manageable: ['a'], locked: ['bb'], canReplyAnonymously: true });
      tree = replies({ ...replyProps, topic: { ...topic, canReply, anonymity, canSeePosts: false } });
      assert.equal(find(tree, 'ThreadProvider'), undefined); assert.equal(find(tree, 'SearchField'), undefined); assert.equal(find(tree, 'Section').action, undefined);
      assert.equal(find(tree, 'Section').title, t('discussionDetail.replies'));
      assert.equal(queries.at(-1)[3], anonymity === 'partial', 'cached replies do not enable own-post lookups while gated');
      assert.equal(find(tree, 'Callout').children, t('discussionDetail.gateBody', { status: t('discussionDetail.waiting', { count: topic.replyCount, number: presentation(locale, 'UTC').number(topic.replyCount) }) }), 'gate uses the permitted topic summary, not cached reply count');
      const checkpoints = replies({ ...replyProps, topic: { ...checkpointTopic, canReply, anonymity, canSeePosts: false } });
      assert.equal(find(checkpoints, cp.CheckpointCard).entries, null, 'gated checkpoints never consume cached entries');
      const composer = find(tree, 'Composer'); assert.equal(!!composer, canReply);
      if (composer) {
        assert.equal(composer.label, t('discussionDetail.yourReply')); assert.equal(composer.autoFocus, false); assert.equal(composer.onCancel, undefined);
        assert.equal(composer.fullyAnonymous, anonymity === 'full'); assert.equal(composer.canPostAnonymously, anonymity === 'partial');
      }
    }
    tree = replies({ ...replyProps, thread: success({ status: 'gated' }) }); assert.equal(find(tree, 'ThreadProvider'), undefined);
    tree = replies({ ...replyProps, topic: { ...topic, canReply: false, isAnnouncement: true }, thread: success({ status: 'visible', entries: [], count: 0 }) }); assert.equal(tree, null);
    tree = replies({ ...replyProps, thread: success({ status: 'visible', entries: [], count: 0 }) }); assert.equal(find(tree, 'EmptyState').title, t('discussionDetail.empty'));
    tree = replies({ ...replyProps, thread: { isPending: true } }); assert.ok(find(tree, 'Skeleton'));
    tree = replies({ ...replyProps, thread: { isError: true, error: new Error('Couldn’t load replies') } }); assert.equal(find(tree, 'Callout').children, 'Couldn’t load replies');
    tree = replies({ ...replyProps, markingAll: true }); assert.equal(find(tree, 'Section').action, undefined);
    tree = replies({ ...replyProps, topic: { ...topic, locked: true } }); assert.equal(find(tree, 'Callout').children, t('discussionDetail.closed'));
  }
  for (const permissions of [null, { manageable: ['a'], locked: ['bb'] }, { manageable: [], locked: ['bb'] }]) {
    state.permissions = success(permissions); tree = replies(replyProps); const value = find(tree, 'ThreadProvider').value;
    assert.equal(value.canManage('a'), !permissions || permissions.manageable.includes('a'));
    assert.equal(value.canManage('bb'), !permissions); assert.equal(value.canManage('new'), !permissions || permissions.manageable.length > 0);
    assert.equal(value.canLike, true);
  }
  tree = replies({ ...replyProps, topic: { ...topic, onlyGradersCanRate: true, canReply: false, canAttach: false } });
  assert.equal(find(tree, 'ThreadProvider').value.canLike, false); assert.equal(find(tree, 'Composer'), undefined); assert.equal(find(tree, 'Pressable'), undefined);
  // Full TopicView effect dependencies: stable inputs across locale/zone changes cause no effects.
  state.topic = success(topic); state.thread = success(visible); state.permissions = success(null);
  const screen = harness(ui.TopicView), props = { context, topicId: topic.id };
  view('en'); tree = screen(props);
  assert.equal(calls.filter(c => c[0] === 'MarkTopicRead').length, 1); assert.equal(calls.filter(c => c[0] === 'checkNow').length, 1);
  state.topic = success({ ...topic, unread: false });
  const readCount = calls.filter(c => c[0] === 'MarkTopicRead').length;
  const alreadyRead = harness(ui.TopicView); alreadyRead(props);
  assert.equal(calls.filter(c => c[0] === 'MarkTopicRead').length, readCount);
  state.topic = success(topic);
  tree = screen(props);
  const onSeen = state.onSeen;
  let rp = find(tree, ui.Replies); rp.setTarget({ kind: 'reply', parentId: null }); tree = screen(props);
  const host = { label: 'Child label', submit: () => {}, disabled: false, loading: false }; state.header.action = host;
  for (const locale of ['fr', 'ar', 'en']) {
    const t = view(locale, 'Asia/Tokyo'), before = calls.length, q = queries.length; tree = screen(props); rp = find(tree, ui.Replies);
    assert.deepEqual(rp.target, { kind: 'reply', parentId: null }); assert.equal(state.onSeen, onSeen);
    assert.deepEqual(queries.slice(q), [['topic', context, topic.id], ['groups', context.id, { enabled: false }], ['thread', context, topic.id, { enabled: true, anonymous: false }]]);
    assert.equal(find(tree, 'Stack.Screen').options.title, t('discussionDetail.discussion'));
    assert.equal(find(find(tree, 'Stack.Screen').options.headerRight(), 'ComposerHeaderButton').action, host);
    assert.equal(find(tree, 'RichContent').html, topic.html); assert.equal(find(tree, 'AttachmentList').attachments, topic.attachments);
    assert.equal(calls.length, before);
  }
  state.onSeen(['a', 'aa']); assert.deepEqual(calls.at(-1).slice(0, 2), ['MarkEntriesRead', { context, topicId: topic.id, entryIds: ['a', 'aa'] }]);
  const draft = { html: '<p>Unknown author</p>', fileId: 'f /', anonymous: true, removeAttachment: true, attachments: [{ id: 'f /' }] };
  for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale); tree = screen(props); rp = find(tree, ui.Replies);
    rp.onReply('aa', draft); assert.deepEqual(calls.at(-1).slice(0, 2), ['PostEntry', { context, topicId: topic.id, parentId: 'aa', html: draft.html, fileId: draft.fileId, anonymous: true }]);
    const posted = calls.at(-1)[2]; view('en'); posted.onSuccess(); assert.deepEqual(calls.at(-1), ['toast', t('discussionDetail.posted')]);
    assert.equal(find(screen(props), ui.Replies).target, null);
    rp.onEdit('aa', draft); assert.deepEqual(calls.at(-1).slice(0, 2), ['UpdateEntry', { context, topicId: topic.id, entryId: 'aa', html: draft.html, fileId: draft.fileId, removeAttachment: true, attachments: draft.attachments }]); calls.at(-1)[2].onSuccess();
    for (const [callback, mutation, args, variables, key] of [
      ['onDelete', 'DeleteEntry', ['aa'], { entryId: 'aa' }, 'deleteError'],
      ['onLike', 'RateEntry', ['aa', false], { entryId: 'aa', liked: false }, 'likeError'],
      ['onMarkUnread', 'MarkEntryUnread', ['aa'], { entryId: 'aa' }, 'markUnreadError'],
      ['onMarkAllRead', 'MarkAllRead', [['a', 'aa']], {}, 'markReadError'],
    ]) {
      rp[callback](...args); const call = calls.at(-1); assert.deepEqual(call.slice(0, 2), [mutation, { context, topicId: topic.id, ...variables }]);
      call[2].onError(new Error('Canvas didn’t answer. Try again.')); assert.deepEqual(alerts.at(-1), [t(`discussionDetail.${key}`), 'Canvas didn’t answer. Try again.']);
      const { CanvasError } = load('@/canvas/client');
      const localError = Object.assign(new CanvasError('Canvas didn’t answer. Try again.', 400, '/api/graphql'), { reason: 'discussion-no-response' });
      call[2].onError(localError); assert.deepEqual(alerts.at(-1), [t(`discussionDetail.${key}`), t('discussionThread.noResponse')]);
      call[2].onError(new CanvasError(localError.message, 400, '/api/graphql')); assert.deepEqual(alerts.at(-1), [t(`discussionDetail.${key}`), localError.message]);
      if (mutation === 'DeleteEntry') { call[2].onSuccess(); assert.deepEqual(calls.at(-1), ['toast', t('discussionDetail.deleted')]); }
      if (mutation === 'MarkAllRead') assert.deepEqual(calls.at(-2), ['markHandled', ['a', 'aa']]);
    }
  }
  // Error objects stay in mutation/query state; only presentation is translated.
  for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale), { CanvasError } = load('@/canvas/client');
    for (const reason of ['discussion-no-response', 'future', undefined]) {
      const error = Object.assign(new CanvasError('Canvas didn’t answer. Try again.', 400, '/api/graphql'), { reason });
      const expected = reason === 'discussion-no-response' ? t('discussionThread.noResponse') : error.message;
      for (const mutation of ['PostEntry', 'UpdateEntry']) {
        state.mutations[mutation] = { error };
        assert.equal(find(screen(props), ui.Replies).error, expected);
        assert.equal(state.mutations[mutation].error, error);
        state.mutations[mutation] = {};
      }
      const failed = { isError: true, error };
      assert.equal(find(replies({ ...replyProps, thread: failed }), 'Callout').children, expected);
      state.topic = failed; assert.equal(find(screen(props), 'Callout').children, expected); state.topic = success(topic);
    }
  }
  // Open Composer props and callbacks remain compatible across locale changes; draft internals mocked.
  const open = { ...replyProps, target: { kind: 'reply', parentId: null }, submitting: true, error: 'Write a reply' };
  for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale); const composer = find(replies(open), 'Composer');
    assert.equal(composer.submitLabel, t('discussionDetail.postReply')); assert.equal(composer.error, open.error); assert.equal(composer.submitting, true); assert.equal(composer.autoFocus, true);
    composer.onSubmit(draft); assert.deepEqual(calls.at(-1), ['Reply', null, draft]); composer.onCancel(); assert.deepEqual(calls.at(-1), ['target', null]);
  }
  // Group copy queries, replacement routes, and missing/pending UI; locale does not repeat navigation.
  for (const status of ['pending', 'found', 'missing']) {
    const groupTopic = { ...topic, isGroupDiscussion: true, groupChildren: [{ groupId: 'private-other', topicId: 'private-topic' }, { groupId: 'g /', topicId: 'child /' }] };
    state.topic = success(groupTopic); state.groups = status === 'pending' ? { isPending: true } : success(status === 'found' ? [{ id: 'g /' }] : []);
    const grouped = harness(ui.TopicView); tree = grouped(props);
    assert.equal(queries.at(-1)[3].enabled, false); assert.equal(find(tree, ui.Replies), undefined);
    if (status === 'found') assert.deepEqual(calls.at(-2)[0] === 'replace' ? calls.at(-2) : calls.at(-1), ['replace', { pathname: '/group/[groupId]/discussion/[topicId]', params: { groupId: 'g /', topicId: 'child /' } }]);
    const notice = harness(ui.GroupCopyNotice);
    for (const locale of ['en', 'fr', 'ar']) {
      const t = view(locale), before = calls.length; tree = grouped(props);
      const rendered = notice(find(tree, ui.GroupCopyNotice)); assert.ok(!text(rendered).includes('private-other')); assert.equal(calls.length, before);
      if (status === 'missing') { assert.equal(find(rendered, 'Callout').title, t('discussionDetail.groupMissing')); find(rendered, 'Button').onPress(); assert.deepEqual(calls.at(-1), ['push', { pathname: '/course/[courseId]/people', params: { courseId: context.id, show: 'groups' } }]); }
      else assert.ok(find(rendered, 'Skeleton'));
    }
  }
  assert.equal(find(harness(ui.GroupCopyNotice)({ status: 'missing', courseId: '' }), 'Button'), undefined);
  for (const data of [undefined, [], [{ id: 'g /' }]]) {
    state.topic = success({ ...topic, isGroupDiscussion: true, groupChildren: [{ groupId: 'g /', topicId: 'child /' }] });
    state.groups = { data, isPending: false, isError: true, error: new Error('Raw Canvas detail'), refetch: () => calls.push(['retryGroups']) };
    const grouped = harness(ui.TopicView), notice = harness(ui.GroupCopyNotice);
    for (const locale of ['en', 'fr', 'ar']) {
      const t = view(locale), before = calls.length;
      tree = grouped(props);
      assert.equal(calls.slice(before).some(c => ['replace', 'checkNow', 'MarkEntriesRead'].includes(c[0])), false, 'failed membership never redirects or checks cached replies');
      const rendered = notice(find(tree, ui.GroupCopyNotice));
      assert.equal(find(rendered, 'Callout').title, t('groups.mineError'));
      assert.equal(find(rendered, 'Callout').children, 'Raw Canvas detail');
      assert.equal(find(rendered, 'Button'), undefined);
      assert.equal(find(rendered, 'Callout').action.label, t('common.retry'));
      find(rendered, 'Callout').action.onPress(); assert.deepEqual(calls.at(-1), ['retryGroups']);
    }
  }
  for (const type of ['course', 'group']) {
    const wrapper = harness(load(`@/app/(app)/${type}/[${type}Id]/discussion/[topicId]`).default);
    let previous;
    for (const locale of ['en', 'fr', 'ar']) { view(locale); tree = wrapper(); assert.equal(tree.type, ui.TopicView); assert.equal(tree.key, undefined); assert.equal(tree.props.topicId, 't /'); if (previous) assert.equal(tree.props.context, previous); previous = tree.props.context; }
    assert.deepEqual(ui.topicRoute(previous, 't /'), { pathname: `/${type}/[${type}Id]/discussion/[topicId]`, params: { [`${type}Id`]: previous.id, topicId: 't /' } });
  }
  for (const anonymity of [null, 'partial', 'full']) {
    state.topic = success({ ...topic, anonymity }); state.thread = success({ status: 'gated' });
    tree = screen(props); assert.equal(queries.at(-1)[3].anonymous, !!anonymity);
    replies(find(tree, ui.Replies)); assert.equal(queries.at(-1)[0], 'permissions');
    assert.equal(queries.at(-1)[3], anonymity === 'partial');
  }
  state.thread = success(visible);
  state.groups = success([]);
  state.topic = success({ ...topic, canSeePosts: false }); tree = screen(props);
  assert.equal(queries.at(-1)[3].enabled, false);
  for (const blocked of [
    { topic: success({ ...topic, canSeePosts: false }), thread: success(visible) },
    { topic: { ...success(topic), isError: true, error: new Error('Denied') }, thread: success(visible) },
    { topic: success(topic), thread: success({ status: 'gated' }) },
    { topic: success(topic), thread: { ...success(visible), isError: true, error: new Error('Denied') } },
  ]) {
    state.topic = blocked.topic; state.thread = blocked.thread;
    const blockedScreen = harness(ui.TopicView), before = calls.length;
    tree = blockedScreen(props);
    assert.equal(calls.slice(before).some(c => c[0] === 'checkNow'), false);
    const count = calls.length;
    state.onSeen(['a', 'aa']); assert.equal(calls.length, count, 'delayed seen reports cannot mark hidden replies read');
    for (const prop of ['onScroll', 'onMomentumScrollEnd', 'onScrollEndDrag', 'onContentSizeChange']) assert.equal(find(tree, 'Screen')[prop], undefined);
  }
  state.topic = success({ ...topic, canSeePosts: false }); state.thread = success(visible);
  view('fr'); rp = find(screen(props), ui.Replies); rp.onReply(null, draft); calls.at(-1)[2].onSuccess(); assert.deepEqual(calls.at(-1), ['toast', i18n.createTranslator('fr')('discussionDetail.postedGated')]);
  for (const canSeePosts of [true, false]) {
    let resolve, settled = false, topicCalls = 0, threadCalls = 0;
    state.topic = { ...success({ ...topic, canSeePosts }), refetch: () => { topicCalls++; return Promise.reject(new Error('refresh failed')); } };
    state.thread = { ...success(visible), refetch: () => { threadCalls++; return new Promise(r => { resolve = r; }); } };
    tree = screen(props); const refreshing = find(tree, 'Screen').refreshControl.props.onRefresh().then(() => { settled = true; });
    assert.equal(find(screen(props), 'Screen').refreshControl.props.refreshing, true);
    await Promise.resolve(); await Promise.resolve();
    if (canSeePosts) { assert.equal(settled, false); assert.equal(find(screen(props), 'Screen').refreshControl.props.refreshing, true); resolve(); }
    await refreshing;
    assert.equal(find(screen(props), 'Screen').refreshControl.props.refreshing, false); assert.equal(topicCalls, 1); assert.equal(threadCalls, canSeePosts ? 1 : 0);
  }
  // Both existing requests may reject; allSettled still completes and clears the spinner.
  state.topic = { ...success(topic), refetch: () => Promise.reject(new Error('topic rejected')) };
  state.thread = { ...success(visible), refetch: () => Promise.reject(new Error('thread rejected')) };
  await find(screen(props), 'Screen').refreshControl.props.onRefresh();
  assert.equal(find(screen(props), 'Screen').refreshControl.props.refreshing, false);
  for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale);
    state.topic = { isPending: true }; tree = screen(props); assert.ok(nodes(tree).some(n => n.type?.name === 'TopicSkeleton'));
    state.topic = { isError: true, error: new Error('Couldn’t load this post'), refetch: () => calls.push(['retryTopic']) }; tree = screen(props);
    assert.equal(find(tree, 'Callout').title, t('discussionDetail.loadError')); assert.equal(find(tree, 'Callout').children, 'Couldn’t load this post'); find(tree, 'Callout').action.onPress(); assert.deepEqual(calls.at(-1), ['retryTopic']);
    state.topic = success({ ...topic, isAnnouncement: true }); tree = screen(props); assert.equal(find(tree, 'Stack.Screen').options.title, t('discussionDetail.announcement'));
    state.label.name = 'Discussion'; assert.equal(find(screen(props), 'Stack.Screen').options.title, 'Discussion'); state.label.name = null;
    state.mutations.PostEntry = { isPending: true, error: new Error('Reply posted') }; rp = find(screen(props), ui.Replies); assert.equal(rp.submitting, true); assert.equal(rp.error, 'Reply posted'); state.mutations.PostEntry = {};
  }
  console.log(`Discussion details checks passed (${process.env.TZ ?? 'host TZ'}; en/fr/ar, explicit Canvas zones; mocked boundaries).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
