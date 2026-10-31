/* global __dirname */
// Inbox production screens/actions/presentation with explicit synthetic boundaries.
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

const root = path.resolve(__dirname, '../..'),
  cache = new Map();
const jsx = (type, props, key) => ({ type, props, key });
const calls = [],
  alerts = [],
  mutations = [];
let env = { account: { id: 'a', user: { id: 'me' } }, client: {} };
let params = { conversationId: 'c' },
  threads,
  conversations,
  conversation;
const message = {
  id: 'm',
  authorId: 'other',
  author: { id: 'other', name: 'Unknown' },
  body: 'Raw <body> français العربية',
  createdAt: new Date('2026-10-30T00:30:00Z'),
  generated: false,
  attachments: [],
  media: null,
  forwarded: [],
  participantIds: ['me', 'other'],
};
const data = {
  id: 'c',
  subject: 'No subject',
  unread: false,
  archived: false,
  starred: false,
  lastMessage: 'Raw preview',
  lastMessageAt: message.createdAt,
  lastAuthoredMessage: 'My text',
  lastAuthoredMessageAt: message.createdAt,
  messageCount: 1,
  hasAttachments: true,
  hasMedia: false,
  participants: [message.author],
  audience: [message.author],
  courseId: 'course',
  contextName: null,
  canReply: true,
  messages: [message],
};
const makeQuery = (value) => ({
  data: value,
  isPending: false,
  isError: false,
  refetch: async () => {
    calls.push(['refresh']);
  },
});
const reset = () => {
  env = { account: { id: 'a', user: { id: 'me' } }, client: {} };
  params = { conversationId: 'c' };
  conversations = makeQuery([data]);
  conversation = makeQuery(data);
  threads = makeQuery([]);
  calls.length = alerts.length = mutations.length = 0;
};
reset();
const mutate = (kind) => ({ mutate: (value, options) => mutations.push({ kind, value, options }) });
const native = {
  View: 'View',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  StyleSheet: { hairlineWidth: 1 },
  useWindowDimensions: () => ({ fontScale: 1, width: 400, height: 800 }),
  Alert: { alert: (...args) => alerts.push(args) },
  AccessibilityInfo: { sendAccessibilityEvent: (...args) => calls.push(['focus', ...args]) },
};
const mock = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': native,
  'lucide-react-native': new Proxy({}, { get: (_o, k) => k }),
  'react-native-reanimated': { SlideInDown: { duration: () => ({}) } },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
  '@/design/interop': { AnimatedView: 'AnimatedView' },
  '@/design': new Proxy(
    {
      useTheme: () => ({ colors: { fgMuted: 'muted' }, scheme: 'light' }),
      useReduceMotion: () => false,
      withAlpha: (x) => x,
      deriveAccent: () => ({ accent: 'accent' }),
      haptics: { selection: () => {} },
    },
    { get: (o, k) => o[k] ?? k },
  ),
  '@/lib/cn': { cn: (...xs) => xs.filter(Boolean).join(' ') },
  'expo-router': {
    router: { push: (value) => calls.push(['push', value]), back: () => calls.push(['back']) },
    Stack: { Screen: 'StackScreen' },
    useLocalSearchParams: () => params,
  },
  '@tanstack/react-query': {
    useQueryClient: () => ({
      refetchQueries: async () => {
        calls.push(['commentsRefresh']);
      },
    }),
  },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/query': { useAccountKey: () => env.account.id },
  '@/canvas/api/conversations': {
    useConversations: () => conversations,
    useConversation: () => conversation,
    useSubmissionThreads: () => threads,
    useUpdateConversation: () => mutate('update'),
    useDeleteConversation: () => mutate('delete'),
    useRemoveMessages: () => mutate('messages'),
    useMarkSubmissionRead: () => mutate('readSubmission'),
  },
  '@/canvas/api/courses': {
    useDashboardCourses: () => makeQuery([{ id: 'course', code: 'Raw Course', name: 'Raw name' }]),
  },
  '@/features/notifications/seen': { raiseMark: (...args) => calls.push(['mark', ...args]) },
  '@/features/inbox/OptionsSheet': { MenuChip: 'MenuChip' },
  '@/features/files/AttachmentList': { AttachmentList: 'AttachmentList' },
  '@/features/inbox/MediaMessage': { MediaMessage: 'MediaMessage' },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mock[key]) return mock[key];
  assert.ok(
    key.startsWith('@/') &&
      /^(i18n($|\/)|lib\/dates$|features\/inbox\/(browsing|actions|ConversationRow|MessageCard|SubmissionComments)|app\/\(app\)\/)/.test(
        key.slice(2),
      ),
    `unexpected dependency: ${key}`,
  );
  const file = ['.ts', '.tsx', '/index.ts']
    .map((ext) => path.join(root, key.slice(2)) + ext)
    .find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const m = { exports: {} };
  cache.set(file, m);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function('require', 'module', 'exports', js)((n) => load(n, file), m, m.exports);
  return m.exports;
}
const nodes = (tree) => {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [
    tree,
    ...nodes(tree.props?.children),
    ...nodes(tree.props?.titleAccessory),
    ...nodes(tree.props?.refreshControl),
  ];
};
const find = (tree, type) => nodes(tree).find((n) => n.type === type);
const text = (tree) => JSON.stringify(tree, (_k, v) => (typeof v === 'function' ? undefined : v));
const defer = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const i18n = load('@/i18n'),
  dates = load('@/lib/dates');
const P = load('@/features/inbox/browsingPresentation');
const Row = load('@/features/inbox/ConversationRow');
const { MessageCard } = load('@/features/inbox/MessageCard');
const { SubmissionCommentList } = load('@/features/inbox/SubmissionComments');
const { useConversationActions } = load('@/features/inbox/actions');
const { BrowsingOptionsSheet } = load('@/features/inbox/browsingOptionsSheet');
const Inbox = load('@/app/(app)/(tabs)/inbox/index').default;
const Detail = load('@/app/(app)/conversation/[conversationId]').default;
const life = load('@/features/inbox/browsingLifetime');
function locale(l) {
  i18n.setAccountLocale(env.account.id, l);
}
const option = (tree, key) => find(tree, BrowsingOptionsSheet).props.options.find((o) => o.key === key);
async function main() {
  const baseline = require('./inbox-browsing.baseline.json');
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
      assert.equal(crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'), hash, key);
  }
  const now = new Date('2026-10-30T06:00:00Z');
  dates.setDisplayTimeZone('America/Los_Angeles');
  assert.equal(Row.peopleLabel([]), 'Only you');
  assert.equal(Row.peopleLabel([{ name: 'A' }, { name: 'B' }, { name: 'C' }]), 'A, B +1');
  const row = mount(() => Row.ConversationRow({ conversation: data, now, onPress() {}, onLongPress() {} }));
  const card = mount(() =>
    MessageCard({
      message,
      people: new Map([['other', message.author]]),
      userId: 'me',
      courseId: null,
      now,
      canReply: true,
    }),
  );
  for (const lang of ['en', 'fr', 'ar']) {
    locale(lang);
    const p = P.createBrowsingPresentation(lang, 'America/Los_Angeles');
    const tree = row.render();
    assert.ok(tree.props.accessibilityLabel.includes('No subject'));
    assert.ok(tree.props.accessibilityLabel.includes(p.messageDate(message.createdAt, now)));
    assert.ok(tree.props.accessibilityLabel.includes(p.t('inboxBrowse.attachments')));
    const ct = card.render();
    assert.ok(text(ct).includes(message.body));
    assert.ok(text(ct).includes('Unknown'));
    assert.ok(text(ct).includes(p.dates.formatDueDate(message.createdAt, now)));
    assert.ok(text(ct).includes(p.t('inboxBrowse.toYou')));
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      const presentation = P.createBrowsingPresentation(lang, zone);
      const expected = dates.createDateContext(lang, zone);
      assert.equal(
        presentation.messageDate(message.createdAt, now),
        expected.daysFrom(message.createdAt, now) === 0
          ? expected.formatTime(message.createdAt)
          : expected.dayLabel(message.createdAt, now),
      );
    }
  }
  row.unmount();
  card.unmount();
  const generated = mount(() =>
    MessageCard({
      message: { ...message, generated: true },
      people: new Map(),
      userId: 'me',
      now,
      canReply: false,
    }),
  );
  assert.ok(text(generated.render()).includes(message.body));
  generated.unmount();
  // Same mounted list relabels, retains search/filter, and rejects/owns refresh.
  reset();
  locale('en');
  const inbox = mount(Inbox);
  let tree = inbox.render();
  find(tree, 'SearchField').props.onChangeText('Raw');
  tree = inbox.render();
  locale('fr');
  tree = inbox.render();
  assert.equal(find(tree, 'SearchField').props.value, 'Raw');
  assert.equal(tree.props.title, i18n.t('inboxBrowse.inbox'));
  const d = defer();
  conversations = {
    ...conversations,
    refetch: () => {
      calls.push(['deferred']);
      return d.promise;
    },
  };
  tree = inbox.render();
  const refresh = find(tree, 'RefreshControl').props.onRefresh;
  const pending = refresh();
  refresh();
  assert.equal(calls.filter((c) => c[0] === 'deferred').length, 1);
  assert.equal(find(inbox.render(), 'RefreshControl').props.refreshing, true);
  d.reject(Error('synthetic'));
  await pending;
  assert.equal(find(inbox.render(), 'RefreshControl').props.refreshing, false);
  const oldRow = find(tree, Row.ConversationRow);
  oldRow.props.onLongPress({ current: 'row' });
  tree = inbox.render();
  let sheets = nodes(tree).filter((n) => n.type === BrowsingOptionsSheet);
  const menu = sheets[1];
  const oldDelete = menu.props.options.find((o) => o.key === 'delete').onPress;
  menu.props.onClose();
  inbox.render();
  oldDelete();
  assert.equal(alerts.length, 0);
  oldRow.props.onLongPress();
  tree = inbox.render();
  sheets = nodes(tree).filter((n) => n.type === BrowsingOptionsSheet);
  const deleteOption = sheets[1].props.options.find((o) => o.key === 'delete');
  sheets[1].props.onClose(true);
  inbox.render();
  deleteOption.onPress();
  assert.equal(alerts.length, 1);
  const confirm = alerts.at(-1)[2][1].onPress;
  confirm();
  confirm();
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].value, 'c');
  env = { ...env, client: {} };
  inbox.render();
  mutations[0].options.onError(Error('late'));
  assert.equal(alerts.length, 1);
  oldRow.props.onPress();
  assert.equal(calls.filter((c) => c[0] === 'push').length, 0);
  inbox.unmount();
  // Real action factory: eligibility changes, account/client replacement, duplicate prompts and current errors.
  reset();
  let latest = data;
  const actions = mount(() => useConversationActions()(data, { getCurrent: () => latest }));
  let opts = actions.render();
  latest = { ...data, starred: true };
  opts[0].onPress();
  assert.equal(mutations.length, 0);
  latest = data;
  opts = actions.render();
  opts[3].onPress();
  actions.render()[3].onPress();
  assert.equal(alerts.length, 1);
  alerts[0][2][0].onPress();
  alerts[0][2][1].onPress();
  assert.equal(mutations.length, 0);
  opts = actions.render();
  opts[0].onPress();
  assert.equal(mutations.length, 1);
  locale('ar');
  actions.render();
  mutations[0].options.onError(Error('RAW error'));
  assert.equal(alerts.at(-1)[0], i18n.t('inboxBrowse.updateError'));
  assert.equal(alerts.at(-1)[1], 'RAW error');
  const stale = actions.render()[3].onPress;
  env = { ...env, account: { ...env.account, id: 'b' } };
  actions.render();
  stale();
  assert.equal(alerts.length, 2);
  actions.unmount();
  // Actual detail message menus, confirms and compose payloads.
  reset();
  const detail = mount(Detail);
  tree = detail.render();
  let mcard = find(tree, MessageCard);
  mcard.props.onMore({ current: 'message-trigger' });
  tree = detail.render();
  let del = option(tree, 'delete').onPress;
  find(tree, BrowsingOptionsSheet).props.onClose(true);
  detail.render();
  del();
  let answer = alerts[0][2][1].onPress;
  conversation = { ...conversation, data: { ...data, messages: [] } };
  detail.render();
  answer();
  assert.equal(mutations.length, 0);
  conversation = makeQuery(data);
  tree = detail.render();
  mcard = find(tree, MessageCard);
  mcard.props.onMore();
  tree = detail.render();
  del = option(tree, 'delete').onPress;
  find(tree, BrowsingOptionsSheet).props.onClose(true);
  detail.render();
  del();
  answer = alerts.at(-1)[2][1].onPress;
  answer();
  answer();
  assert.deepEqual(mutations[0].value, { id: 'c', messageIds: ['m'] });
  params = { conversationId: 'replacement' };
  conversation = makeQuery({ ...data, id: 'replacement' });
  detail.render();
  mutations[0].options.onSuccess();
  mutations[0].options.onError(Error('late'));
  assert.equal(calls.filter((c) => c[0] === 'back').length, 0);
  assert.equal(alerts.length, 2);
  mcard.props.onReply();
  assert.equal(calls.filter((c) => c[0] === 'push').length, 0);
  detail.unmount();
  reset();
  const detail2 = mount(Detail);
  tree = detail2.render();
  const reply = find(tree, MessageCard).props.onReply;
  reply();
  assert.deepEqual(calls.at(-1)[1].params, { mode: 'reply', conversationId: 'c', messageId: 'm' });
  const retry = defer();
  conversation = { ...conversation, refetch: () => retry.promise };
  tree = detail2.render();
  const rp = find(tree, 'RefreshControl').props.onRefresh();
  retry.reject(Error('synthetic'));
  await rp;
  assert.equal(find(detail2.render(), 'RefreshControl').props.refreshing, false);
  detail2.unmount();
  // Submission raw fallback names and committed ownership.
  reset();
  const thread = {
    id: 's',
    courseId: 'course',
    assignmentId: 'a',
    assignmentName: 'Assignment',
    courseName: 'Raw course',
    unread: true,
    latest: { authorId: 'other', author: 'Someone', text: 'Raw comment', at: message.createdAt },
  };
  threads = makeQuery([thread]);
  let search = '';
  const submissions = mount(() =>
    SubmissionCommentList({ courseId: null, courseFor: () => undefined, query: search, now }),
  );
  tree = submissions.render();
  const item = find(tree, 'ListItem');
  assert.equal(item.props.title, 'Assignment');
  assert.ok(item.props.subtitle.includes('Someone'));
  locale('fr');
  tree = submissions.render();
  assert.equal(find(tree, 'ListItem').props.accessibilityHint, i18n.t('inboxBrowse.openSubmission'));
  search = 'different';
  submissions.render();
  item.props.onPress();
  assert.equal(mutations.length, 0);
  submissions.unmount();
  // Abandoned render cannot revoke committed owner; replacement commit does.
  reset();
  let resource = 'a',
    value = 1;
  const owned = mount(() => life.useBrowsingOwner(resource, value));
  const first = owned.render();
  resource = 'b';
  owned.renderOnly();
  owned.abandon();
  assert.equal(first.live, true);
  resource = 'a';
  value = 2;
  owned.renderOnly();
  assert.equal(first.value, 1);
  owned.commit();
  assert.equal(first.value, 2);
  resource = 'b';
  owned.render();
  assert.equal(first.live, false);
  owned.unmount();
  // Selection-aware native boundary keeps deferred action and preserves trigger focus restoration.
  let chosen = 0,
    closeReason;
  const focus = { current: 'trigger' };
  const sheet = mount(() =>
    BrowsingOptionsSheet({
      visible: true,
      onClose: (v) => {
        closeReason = v;
      },
      options: [{ key: 'x', label: 'Raw', onPress: () => chosen++ }],
      returnFocusRef: focus,
    }),
  );
  tree = sheet.render();
  nodes(tree)
    .find((n) => n.props?.accessibilityRole === 'button')
    .props.onPress();
  assert.equal(closeReason, true);
  assert.equal(chosen, 0);
  find(tree, 'Modal').props.onDismiss();
  assert.equal(chosen, 1);
  find(tree, 'Modal').props.onDismiss();
  assert.ok(calls.some((c) => c[0] === 'focus' && c[1] === 'trigger'));
  sheet.unmount();
  // Each action preserves the existing mutation payload, including unarchive's read state.
  for (const [key, changed, expected] of [
    ['star', {}, { id: 'c', starred: true }],
    ['read', {}, { id: 'c', state: 'unread' }],
    ['read', { unread: true }, { id: 'c', state: 'read' }],
    ['archive', {}, { id: 'c', state: 'archived' }],
    ['archive', { archived: true }, { id: 'c', state: 'read' }],
  ]) {
    reset();
    const a = mount(() => useConversationActions()({ ...data, ...changed }));
    a.render()
      .find((o) => o.key === key)
      .onPress();
    assert.deepEqual(mutations[0].value, expected);
    mutations[0].options.onSettled();
    a.unmount();
  }
  // An already-open delete confirmation cannot mutate a replacement client.
  reset();
  const confirms = mount(() => useConversationActions()(data));
  confirms.render()[3].onPress();
  const oldConfirm = alerts[0][2][1].onPress;
  env = { ...env, client: {} };
  confirms.render();
  oldConfirm();
  assert.equal(mutations.length, 0);
  confirms.unmount();
  // Locale relabeling retains the menu and its trigger; reopening retires the former session.
  reset();
  locale('en');
  const menuScreen = mount(Inbox);
  tree = menuScreen.render();
  const rowTrigger = { current: 'focus-row' };
  find(tree, Row.ConversationRow).props.onLongPress(rowTrigger);
  tree = menuScreen.render();
  const menuBefore = nodes(tree).filter((n) => n.type === BrowsingOptionsSheet)[1];
  const retainedStar = menuBefore.props.options[0].onPress;
  locale('ar');
  tree = menuScreen.render();
  const menuAfter = nodes(tree).filter((n) => n.type === BrowsingOptionsSheet)[1];
  assert.equal(menuAfter.props.visible, true);
  assert.equal(menuAfter.props.returnFocusRef, rowTrigger);
  assert.equal(menuAfter.props.options[0].label, i18n.t('inboxBrowse.star'));
  menuAfter.props.onClose();
  tree = menuScreen.render();
  find(tree, Row.ConversationRow).props.onLongPress(rowTrigger);
  tree = menuScreen.render();
  retainedStar();
  assert.equal(mutations.length, 0);
  const currentMenu = nodes(tree).filter((n) => n.type === BrowsingOptionsSheet)[1];
  menuBefore.props.onClose();
  assert.equal(
    nodes(menuScreen.render()).filter((n) => n.type === BrowsingOptionsSheet)[1].props.visible,
    true,
  );
  currentMenu.props.options[0].onPress();
  assert.equal(mutations.length, 1);
  menuScreen.unmount();
  // Older refresh completion cannot clear a replacement scope's pending refresh.
  reset();
  const pendingA = defer(),
    pendingB = defer();
  conversations = { ...conversations, refetch: () => pendingA.promise };
  const refreshScreen = mount(Inbox);
  tree = refreshScreen.render();
  const workA = find(tree, 'RefreshControl').props.onRefresh();
  const staleNavigation = find(tree, Row.ConversationRow).props.onPress;
  nodes(tree)
    .find((n) => n.type === 'Chip' && n.props.children === i18n.t('inboxBrowse.unread'))
    .props.onPress();
  conversations = { ...conversations, refetch: () => pendingB.promise };
  tree = refreshScreen.render();
  staleNavigation();
  assert.equal(calls.length, 0);
  const workB = find(tree, 'RefreshControl').props.onRefresh();
  pendingA.reject(Error('old scope'));
  await workA;
  assert.equal(find(refreshScreen.render(), 'RefreshControl').props.refreshing, true);
  pendingB.reject(Error('new scope'));
  await workB;
  assert.equal(find(refreshScreen.render(), 'RefreshControl').props.refreshing, false);
  refreshScreen.unmount();
  // Observed reply permission and membership are rechecked, and a successful final-message deletion navigates back.
  reset();
  const permissions = mount(Detail);
  tree = permissions.render();
  const offeredReply = find(tree, MessageCard).props.onReply;
  conversation = makeQuery({ ...data, canReply: false });
  permissions.render();
  offeredReply();
  assert.equal(calls.length, 0);
  conversation = makeQuery(data);
  tree = permissions.render();
  find(tree, MessageCard).props.onMore();
  tree = permissions.render();
  const deleteLast = option(tree, 'delete').onPress;
  find(tree, BrowsingOptionsSheet).props.onClose(true);
  permissions.render();
  deleteLast();
  alerts[0][2][1].onPress();
  conversation = makeQuery({ ...data, messages: [] });
  permissions.render();
  mutations[0].options.onSuccess();
  assert.equal(calls.at(-1)[0], 'back');
  permissions.unmount();
  // Actual forwarded children translate only authored wrappers, even for English-looking raw names.
  const forwarded = { ...message, forwarded: [{ ...message, id: 'forwarded', body: 'Forwarded raw body' }] };
  const quoted = mount(() =>
    MessageCard({ message: forwarded, people: new Map(), userId: 'me', now, canReply: false }),
  );
  const forwardedNode = nodes(quoted.render()).find(
    (n) => typeof n.type === 'function' && n.props.message?.id === 'forwarded',
  );
  const nested = mount(() => forwardedNode.type(forwardedNode.props));
  for (const language of ['en', 'fr', 'ar']) {
    locale(language);
    const rendered = nested.render();
    assert.ok(text(rendered).includes('Unknown'));
    assert.ok(text(rendered).includes('Forwarded raw body'));
    assert.ok(
      text(rendered).includes(
        i18n.t('inboxBrowse.forwarded', {
          name: 'Unknown',
          date: dates
            .createDateContext(language, 'America/Los_Angeles')
            .formatDueDate(message.createdAt, now),
        }),
      ),
    );
  }
  nested.unmount();
  quoted.unmount();
  console.log('Inbox browsing production checks passed', process.env.TZ);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
