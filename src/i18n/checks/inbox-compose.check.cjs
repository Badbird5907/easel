/* global __dirname */
// Production controls and locale runtime. Synthetic staged hooks/native/animation
// boundaries only: no React reconciliation, native acceptance, HTTP or storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
    get dirty() {
      return s.dirty;
    },
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
const cache = new Map(),
  timers = new Map(),
  children = [];
const allowed = new Set([
  'i18n',
  'i18n/runtime',
  'i18n/en',
  'i18n/fr',
  'i18n/ar',
  'features/inbox/composeOwnership',
  'features/inbox/composePresentation',
  'features/inbox/RecipientPicker',
  'app/(app)/compose',
]);
const jsx = (type, props, key) => ({ type, props, key });
const elements = (names) => Object.fromEntries(names.split(' ').map((n) => [n, n]));
let account, client, params, focused, courses, conversation, contexts, people, signature, uploads, prevention;
let createMutation, addMutation;
const calls = [],
  alerts = [],
  announcements = [],
  queryInputs = [];
let uploadMounts = 0;
const mocks = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': {
    ...elements('View Pressable'),
    Platform: { OS: 'ios' },
    useWindowDimensions: () => ({ fontScale: 1 }),
    Alert: { alert: (...args) => alerts.push(args) },
    AccessibilityInfo: { announceForAccessibility: (text) => announcements.push(text) },
  },
  'lucide-react-native': elements('Plus Check ChevronLeft Layers Users UsersRound X'),
  '@/design': elements(
    'AccentScope Button Callout Chip ListGroup ListItem Screen Skeleton Switch Text TextField Avatar Icon IconTile PressableScale SearchField',
  ),
  '@/canvas/session': { useCanvas: () => ({ account, client }) },
  'expo-router': {
    Stack: { Screen: 'Stack.Screen' },
    useLocalSearchParams: () => params,
    useIsFocused: () => focused,
    router: { back: () => calls.push(['back']) },
    usePreventRemove: (enabled, callback) => {
      react.useLayoutEffect(() => {
        prevention = { enabled, callback };
      });
      return () => calls.push(['allowLeave']);
    },
  },
  '@/canvas/api/courses': { useDashboardCourses: () => courses },
  '@/canvas/api/conversations': {
    useConversation: (id) => {
      queryInputs.push(['conversation', id]);
      return conversation;
    },
    useCreateConversation: () => createMutation,
    useAddMessage: () => addMutation,
    useInboxSignature: () => ({ data: signature }),
    useRecipientContexts: (...args) => {
      queryInputs.push(['contexts', ...args]);
      return contexts;
    },
    useRecipientPeople: (...args) => {
      queryInputs.push(['people', ...args]);
      return people;
    },
  },
  '@/features/inbox/attachments': {
    ...elements('AttachButton AttachmentStatus PendingAttachmentList'),
    useAttachmentUploads: (options) => {
      react.useState(() => {
        uploadMounts++;
        const { owner, ...legacy } = options;
        equal(legacy, { folderPath: 'conversation attachments' });
        assert.equal(typeof owner.resource, 'string');
        assert.equal(owner.focused, focused);
        assert.equal(typeof owner.eligible, 'boolean');
      });
      return uploads;
    },
  },
  '@/features/inbox/MessageCard': { MessageCard: 'MessageCard' },
  '@/features/inbox/OptionsSheet': { OptionsSheet: 'OptionsSheet' },
};
// Execute the real API adapters against an explicitly synthetic transport and hook boundary.
const mutations = [],
  invalidations = [],
  transport = [];
const apiModule = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(path.join(root, 'canvas/api/conversations.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  {
    module: apiModule,
    exports: apiModule.exports,
    Date,
    Map,
    Set,
    require: (name) => {
      if (name === 'react') return react;
      if (name === '../session') return mocks['@/canvas/session'];
      if (name === './discussions')
        return {
          graphql: () => {
            throw Error('Unexpected GraphQL');
          },
        };
      if (name === '@tanstack/react-query')
        return {
          useQueryClient: () => ({
            invalidateQueries: (x) => {
              invalidations.push(x);
              return Promise.resolve();
            },
          }),
        };
      if (name === '../query')
        return {
          useAccountKey: () => account.id,
          useCanvasMutation: (fn, options) => {
            const originClient = client;
            const mutation = {
              isPending: false,
              mutateAsync: async (args) => {
                const data = await fn(originClient, args);
                await options?.onSuccess?.(data, args);
                return data;
              },
            };
            mutations.push(mutation);
            return mutation;
          },
        };
      // Detail placeholders from list caches; mutations here don't exercise them.
      if (name === './cacheSeed') return { useListPlaceholder: () => () => undefined };
      throw Error('Unexpected API import ' + name);
    },
  },
);
const api = apiModule.exports;
mocks['@/canvas/api/conversations'].signatureBlock = api.signatureBlock;
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
    setTimeout: (fn) => {
      const id = {};
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  return module.exports;
}

const runtime = load('@/i18n/runtime');
const Compose = load('@/app/(app)/compose').default;
const { RecipientPicker, RecipientPill, peopleCount } = load('@/features/inbox/RecipientPicker');
const { composeRecipientName } = load('@/features/inbox/composePresentation');
const locale = (lang) => {
  runtime.setAccountLocale(account.id, lang);
  return runtime.createTranslator(lang);
};
function mountTree(fn) {
  let committed = new Map(),
    staged,
    seen,
    tree;
  function expand(node, address = 'root') {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n, i) => expand(n, address + '/' + (n?.key ?? i)));
    if (typeof node.type === 'function') {
      const key = address + ':' + node.type.name + ':' + (node.key ?? '');
      children.push(node);
      let entry = committed.get(key);
      if (!entry) {
        entry = { node };
        entry.mount = mount(() => entry.node.type(entry.node.props));
      }
      entry.node = node;
      staged.set(key, entry);
      seen.push(entry.mount);
      return expand(entry.mount.renderOnly(), key);
    }
    return {
      ...node,
      props: { ...node.props, children: expand(node.props?.children, address + '/children') },
    };
  }
  const api = {
    renderOnly() {
      staged = new Map();
      seen = [];
      tree = expand(jsx(fn, {}));
      return tree;
    },
    commit() {
      for (const [k, e] of committed) if (!staged.has(k)) e.mount.unmount();
      seen.forEach((m) => m.commit());
      committed = staged;
    },
    abandon() {
      seen.forEach((m) => m.abandon());
    },
    render() {
      let limit = 15;
      do {
        assert.ok(limit--);
        api.renderOnly();
        api.commit();
      } while (seen.some((m) => m.dirty));
      return tree;
    },
    replayEffects() {
      for (const e of committed.values()) e.mount.replayEffects();
    },
    unmount() {
      for (const e of committed.values()) e.mount.unmount();
      committed.clear();
    },
  };
  return api;
}
const nodes = (tree) =>
  !tree || typeof tree !== 'object'
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(nodes)
      : [tree, ...nodes(tree.props?.children)];
const all = (tree, type) => nodes(tree).filter((n) => n.type === type);
const one = (tree, type) => {
  const ns = all(tree, type);
  assert.equal(ns.length, 1, type);
  return ns[0].props;
};
const texts = (tree) =>
  typeof tree === 'string' || typeof tree === 'number'
    ? [String(tree)]
    : !tree
      ? []
      : Array.isArray(tree)
        ? tree.flatMap(texts)
        : texts(tree.props?.children);
const equal = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const hash = (v) =>
  crypto
    .createHash('sha256')
    .update(typeof v === 'string' ? v : JSON.stringify(v))
    .digest('hex');
for (const lang of ['en', 'fr', 'ar']) {
  const catalog = load('@/i18n/' + lang)[lang];
  for (const [key, digest] of Object.entries(
    require('./inbox-compose-historical.baseline.json').catalogs[lang],
  ))
    assert.equal(hash(JSON.stringify(catalog[key])), digest, key);
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const recipient = (id, extra = {}) => ({
  id,
  name: 'RAW ' + id,
  kind: 'user',
  roles: [],
  userCount: null,
  avatarUrl: null,
  ...extra,
});
const query = (data) => ({
  data,
  isPending: false,
  isError: false,
  isPlaceholderData: false,
  isFetching: false,
  fetchStatus: 'idle',
  refetch: async () => ({ data }),
});
function reset(mode = 'new') {
  account = { id: 'A', user: { id: 'self' } };
  client = {};
  focused = true;
  params = {
    mode,
    courseId: 'c',
    recipientIds: 'u,v',
    recipientNames: 'RAW U,RAW V',
    subject: ' RAW Subject ',
  };
  if (mode !== 'new') params = { mode, conversationId: 'conv', messageId: 'm' };
  courses = query([
    { id: 'c', name: 'RAW course', code: 'RAW code' },
    { id: 'd', name: 'Other', code: 'OTHER' },
  ]);
  const participants = ['self', 'u', 'v'].map((id) => ({ id, name: 'RAW ' + id, avatarUrl: null }));
  conversation = query({
    id: 'conv',
    courseId: 'c',
    canReply: true,
    subject: 'RAW subject',
    participants,
    audience: participants.slice(1),
    messages: [
      {
        id: 'm',
        authorId: 'u',
        participantIds: ['self', 'u', 'v'],
        body: '<p>RAW body</p>',
        createdAt: new Date('2025-01-01T00:30Z'),
        generated: false,
      },
      { id: 'n', authorId: 'v', participantIds: ['self', 'v'], body: 'OTHER' },
    ],
  });
  contexts = query({
    contexts: [recipient('section_1', { kind: 'context', name: 'Teachers', userCount: 12 })],
    folders: [{ id: 'course_c_groups', kind: 'groups', name: 'RAW groups', count: 2 }],
  });
  people = query([
    recipient('self'),
    recipient('u', { roles: ['TeacherEnrollment'] }),
    recipient('v', { roles: ['CustomRole'] }),
  ]);
  signature = { available: true, enabled: true, text: ' signature bytes \n' };
  uploads = {
    items: [{ id: 'local', name: 'RAW file' }],
    reset: () => calls.push(['resetUploads']),
    pick: async (source) => calls.push(['pick', source]),
    add: (files) => calls.push(['files', files]),
    remove: () => {},
    retry: () => {},
    seed: () => {},
    files: [{ id: 'file' }],
    uploading: false,
    failed: false,
  };
  createMutation = {
    isPending: false,
    mutateAsync: async (args) => {
      calls.push(['create', args]);
    },
  };
  addMutation = {
    isPending: false,
    mutateAsync: async (args) => {
      calls.push(['add', args]);
    },
  };
  calls.length = alerts.length = announcements.length = queryInputs.length = 0;
  locale('en');
}
const field = (tree, key) =>
  all(tree, 'TextField').find((n) => n.props.label === runtime.t('inboxCompose.' + key)).props;
const send = (tree) => one(one(tree, 'Stack.Screen').options.headerRight(), 'Button');
const row = (tree, title) => all(tree, 'ListItem').find((n) => n.props.title === title)?.props;
const count = (kind) => calls.filter((x) => x[0] === kind).length;
async function main() {
  reset();
  const mounted = mountTree(() => Compose());
  let tree = mounted.render();
  const initialUpload = uploadMounts;
  field(tree, 'message').onChangeText('  RAW draft\n\n ');
  tree = mounted.render();
  row(tree, 'Send individually').trailing.props.onValueChange(true);
  tree = mounted.render();
  const retainedSend = send(tree).onPress;
  for (const lang of ['fr', 'ar', 'en']) {
    locale(lang);
    tree = mounted.render();
    assert.equal(field(tree, 'message').value, '  RAW draft\n\n ');
    assert.equal(field(tree, 'subject').value, ' RAW Subject ');
    assert.equal(one(tree, 'Stack.Screen').options.title, runtime.t('inboxCompose.new'));
    assert.equal(uploadMounts, initialUpload);
  }
  const d = deferred();
  createMutation.mutateAsync = (args) => {
    calls.push(['create', args]);
    return d.promise;
  };
  tree = mounted.render();
  const task = retainedSend();
  retainedSend();
  assert.equal(count('create'), 1);
  equal(calls[0][1], {
    courseId: 'c',
    subject: 'RAW Subject',
    body: 'RAW draft' + api.signatureBlock(signature),
    recipients: ['u', 'v'],
    attachmentIds: ['file'],
    individually: true,
  });
  field(tree, 'message').onChangeText('edited while sending');
  mounted.render();
  d.reject(new Error('RAW send failure'));
  await task;
  tree = mounted.render();
  assert.equal(field(tree, 'message').value, 'edited while sending');
  assert.ok(texts(tree).includes('RAW send failure'));
  locale('fr');
  tree = mounted.render();
  assert.ok(texts(tree).includes('RAW send failure'));
  assert.equal(one(tree, 'Callout').title, runtime.t('inboxCompose.sendError'));
  mounted.unmount();
  retainedSend();
  assert.equal(count('create'), 1);
  // Success invokes navigation once; replay and duplicate presses cannot send again.
  reset();
  const success = mountTree(() => Compose());
  tree = success.render();
  field(tree, 'message').onChangeText('body');
  tree = success.render();
  const press = send(tree).onPress;
  await Promise.all([press(), press()]);
  await press();
  assert.equal(count('create'), 1);
  assert.equal(count('back'), 1);
  success.unmount();
  // Exact reply, reply-all, forward selection and file/signature behavior.
  for (const mode of ['reply', 'replyAll', 'forward']) {
    reset(mode);
    const m = mountTree(() => Compose());
    tree = m.render();
    field(tree, 'message').onChangeText(' Reply ');
    tree = m.render();
    if (mode === 'forward') {
      one(tree, 'Chip').onPress();
      tree = m.render();
      row(tree, 'RAW v').onPress();
      tree = m.render();
      assert.equal(one(tree, 'MessageCard').message.body, '<p>RAW body</p>');
      assert.equal(one(tree, 'MessageCard').message.createdAt.toISOString(), '2025-01-01T00:30:00.000Z');
    }
    await send(tree).onPress();
    equal(calls.find((c) => c[0] === 'add')[1], {
      id: 'conv',
      body: 'Reply' + api.signatureBlock(signature),
      recipients: mode === 'reply' ? ['u'] : mode === 'replyAll' ? ['u', 'v'] : ['v'],
      attachmentIds: ['file'],
      ...(mode === 'forward' ? { includedMessages: ['m'] } : {}),
    });
    m.unmount();
  }
  // Every ownership replacement retires entered success/error and old input/send/discard callbacks.
  for (const change of [
    'account',
    'client',
    'courseRoute',
    'mode',
    'conversationRoute',
    'messageRoute',
    'focus',
    'permission',
    'queryError',
    'missing',
    'courseChoice',
    'unmount',
  ])
    for (const outcome of ['resolve', 'reject']) {
      reset(change === 'permission' || change === 'queryError' || change === 'missing' ? 'reply' : 'new');
      const d = deferred();
      const mutation = params.mode === 'new' ? createMutation : addMutation;
      mutation.mutateAsync = (args) => {
        calls.push(['entered', args]);
        return d.promise;
      };
      const m = mountTree(() => Compose());
      tree = m.render();
      field(tree, 'message').onChangeText('body');
      tree = m.render();
      const staleUploads = one(tree, 'AttachButton').uploads;
      const oldField = field(tree, 'message'),
        oldSend = send(tree).onPress;
      prevention.callback({ repeat: () => calls.push(['repeat']) });
      const discard = alerts.at(-1)[2][1].onPress;
      const pending = oldSend();
      if (change === 'account') account = { ...account, id: 'B' };
      if (change === 'client') client = {};
      if (change === 'courseRoute') params = { ...params, courseId: 'd' };
      if (change === 'mode') params = { ...params, mode: 'reply', conversationId: 'conv' };
      if (change === 'conversationRoute') params = { ...params, conversationId: 'other' };
      if (change === 'messageRoute') params = { ...params, messageId: 'other' };
      if (change === 'focus') focused = false;
      if (change === 'permission') conversation = query({ ...conversation.data, canReply: false });
      if (change === 'queryError')
        conversation = { ...conversation, isError: true, error: new Error('RAW load') };
      if (change === 'missing') conversation = query(undefined);
      if (change === 'courseChoice') one(tree, 'OptionsSheet').options[1].onPress();
      if (change === 'unmount') m.unmount();
      else tree = m.render();
      staleUploads.add([{ name: 'retired' }]);
      await staleUploads.pick('files');
      assert.equal(count('pick'), 0, change);
      assert.equal(count('files'), 0, change);
      oldField.onChangeText('retired');
      oldSend();
      discard();
      d[outcome](outcome === 'reject' ? new Error('retired failure') : {});
      await pending;
      assert.equal(count('entered'), 1, change);
      assert.equal(count('back'), 0, change);
      assert.equal(count('repeat'), 0, change);
      if (change !== 'unmount') {
        tree = m.render();
        assert.ok(!texts(tree).includes('retired failure'));
        m.unmount();
      }
    }
  // Old authority cannot revive through failed queries and recovery, or missing message targets.
  for (const failure of ['error', 'pending', 'placeholder', 'id', 'target', 'permission']) {
    reset('reply');
    const m = mountTree(() => Compose());
    tree = m.render();
    field(tree, 'message').onChangeText('body');
    tree = m.render();
    const old = send(tree).onPress;
    const saved = conversation;
    if (failure === 'error') conversation = { ...conversation, isError: true, error: new Error('failure') };
    if (failure === 'pending') conversation = { ...conversation, isPending: true };
    if (failure === 'placeholder') conversation = { ...conversation, isPlaceholderData: true };
    if (failure === 'id') conversation = query({ ...conversation.data, id: 'wrong' });
    if (failure === 'target') conversation = query({ ...conversation.data, messages: [] });
    if (failure === 'permission') conversation = query({ ...conversation.data, canReply: false });
    tree = m.render();
    await old();
    await send(tree).onPress();
    assert.equal(count('add'), 0, failure);
    conversation = saved;
    tree = m.render();
    await old();
    assert.equal(count('add'), 0);
    await send(tree).onPress();
    assert.equal(count('add'), 1);
    m.unmount();
  }
  // Draft edit invalidates an open discard; locale alone does not. Answer is single-use.
  reset();
  const discardMount = mountTree(() => Compose());
  tree = discardMount.render();
  field(tree, 'message').onChangeText('body');
  tree = discardMount.render();
  prevention.callback({ repeat: () => calls.push(['repeat']) });
  const oldDiscard = alerts.at(-1)[2][1].onPress;
  field(tree, 'message').onChangeText('new body');
  tree = discardMount.render();
  oldDiscard();
  assert.equal(count('repeat'), 0);
  prevention.callback({ repeat: () => calls.push(['repeat']) });
  const freshDiscard = alerts.at(-1)[2][1].onPress;
  locale('ar');
  discardMount.render();
  freshDiscard();
  freshDiscard();
  assert.equal(count('repeat'), 1);
  discardMount.unmount();
  // Prototype keys are not valid modes. Generated fallback is explicit; legacy text stays raw.
  for (const mode of ['constructor', 'toString', '__proto__']) {
    reset();
    params = { ...params, mode, recipientNames: '' };
    const m = mountTree(() => Compose());
    tree = m.render();
    assert.equal(one(tree, 'Stack.Screen').options.title, 'New message');
    locale('fr');
    tree = m.render();
    assert.ok(texts(tree).includes('Inconnu'));
    m.unmount();
  }
  reset();
  const t = locale('ar');
  assert.equal(peopleCount(2), '2 people');
  assert.equal(peopleCount(1), '1 person');
  assert.equal(peopleCount(2, t), t('inboxCompose.peopleCount', { count: 2 }));
  assert.equal(composeRecipientName(recipient('x', { name: 'Unknown' }), t), 'Unknown');
  assert.equal(
    composeRecipientName(recipient('x', { name: 'Unknown', composeNameOrigin: 'other' }), t),
    'Unknown',
  );
  const pill = mountTree(() =>
    RecipientPill({ recipient: recipient('x', { kind: 'context', name: 'RAW label', userCount: 1234 }) }),
  );
  tree = pill.render();
  assert.ok(texts(tree).includes(new Intl.NumberFormat('ar').format(1234)));
  assert.ok(texts(tree).includes('RAW label'));
  pill.unmount();
  // Picker current selection, rapid merges, locale-stable search, custom/server labels and stale query rows.
  reset();
  let props = {
    courseId: 'c',
    courseCode: 'RAW course',
    userId: 'self',
    selected: [],
    onChange: (next) => {
      props = { ...props, selected: next };
      calls.push(['selection', next]);
    },
  };
  const picker = mountTree(() => RecipientPicker(props));
  tree = picker.render();
  assert.equal(row(tree, 'RAW self'), undefined);
  const oldU = row(tree, 'RAW u').onPress;
  oldU();
  row(tree, 'RAW v').onPress();
  equal(
    props.selected.map((x) => x.id),
    ['u', 'v'],
  );
  tree = picker.render();
  props = { ...props, selected: [recipient('v')] };
  picker.render();
  oldU();
  equal(
    props.selected.map((x) => x.id),
    ['v', 'u'],
  );
  for (const lang of ['fr', 'ar']) {
    locale(lang);
    tree = picker.render();
    assert.equal(row(tree, 'RAW u').subtitle, runtime.t('inboxCompose.TeacherEnrollment'));
    assert.equal(row(tree, 'RAW v').subtitle, undefined);
    assert.ok(row(tree, 'Teachers'));
    assert.ok(row(tree, 'RAW groups'));
  }
  one(tree, 'SearchField').onChangeText('RAW');
  tree = picker.render();
  const before = count('selection');
  oldU();
  row(tree, 'RAW u').onPress();
  assert.equal(count('selection'), before);
  for (const [id, fn] of timers) {
    timers.delete(id);
    fn();
  }
  contexts = { ...contexts, isPlaceholderData: true };
  tree = picker.render();
  row(tree, 'RAW u').onPress();
  assert.equal(count('selection'), before);
  contexts = { ...contexts, isPlaceholderData: false };
  tree = picker.render();
  const result = row(tree, 'RAW u').onPress;
  people = { ...people, isError: true, error: new Error('RAW people failure') };
  tree = picker.render();
  result();
  assert.equal(count('selection'), before);
  assert.equal(one(tree, 'Callout').children, 'RAW people failure');
  people = query([recipient('v')]);
  tree = picker.render();
  result();
  assert.equal(count('selection'), before);
  locale('en');
  tree = picker.render();
  assert.equal(one(tree, 'SearchField').value, 'RAW');
  const staleSearch = one(tree, 'SearchField').onChangeText;
  props = { ...props, courseId: 'd' };
  tree = picker.render();
  assert.equal(one(tree, 'SearchField').value, '');
  staleSearch('retired');
  tree = picker.render();
  assert.equal(one(tree, 'SearchField').value, '');
  picker.unmount();
  // Abandoned renders cannot publish replacement client/draft/query authority.
  reset();
  const staged = mountTree(() => Compose());
  tree = staged.render();
  field(tree, 'message').onChangeText('committed');
  tree = staged.render();
  const currentSend = send(tree).onPress;
  const originalClient = client;
  client = {};
  staged.renderOnly();
  staged.abandon();
  client = originalClient;
  await currentSend();
  assert.equal(count('create'), 1);
  staged.unmount();
  // New-message authority, attachment status and signature opt-out keep legacy payload semantics.
  for (const blocked of [
    'coursesError',
    'coursesMissing',
    'uploadsPending',
    'uploadsFailed',
    'mutationPending',
  ]) {
    reset();
    const m = mountTree(() => Compose());
    tree = m.render();
    field(tree, 'message').onChangeText('body');
    tree = m.render();
    const old = send(tree).onPress;
    if (blocked === 'coursesError') courses = { ...courses, isError: true };
    if (blocked === 'coursesMissing') courses = query(undefined);
    if (blocked === 'uploadsPending') uploads = { ...uploads, uploading: true };
    if (blocked === 'uploadsFailed') uploads = { ...uploads, failed: true };
    if (blocked === 'mutationPending') createMutation = { ...createMutation, isPending: true };
    tree = m.render();
    await old();
    await send(tree).onPress();
    assert.equal(count('create'), 0, blocked);
    m.unmount();
  }
  reset();
  const optOut = mountTree(() => Compose());
  tree = optOut.render();
  field(tree, 'message').onChangeText('  RAW body  ');
  row(tree, 'Add my signature').onPress();
  tree = optOut.render();
  const attachmentsBefore = count('resetUploads');
  locale('fr');
  tree = optOut.render();
  assert.equal(count('resetUploads'), attachmentsBefore);
  await send(tree).onPress();
  assert.equal(calls.find((x) => x[0] === 'create')[1].body, 'RAW body');
  optOut.unmount();
  assert.equal(count('resetUploads'), attachmentsBefore + 1);
  // Temporary focus loss must not erase completed attachments on return from a viewer.
  reset();
  const focusMount = mountTree(() => Compose());
  tree = focusMount.render();
  focused = false;
  focusMount.render();
  focused = true;
  tree = focusMount.render();
  assert.equal(count('resetUploads'), 0);
  equal(one(tree, 'AttachButton').uploads.files, [{ id: 'file' }]);
  focusMount.unmount();
  // Route/account/client/mode replacement remounts the entire draft/upload boundary.
  for (const replacement of ['account', 'client', 'course', 'mode', 'conversation', 'recipient']) {
    reset();
    const m = mountTree(() => Compose());
    tree = m.render();
    field(tree, 'message').onChangeText('private draft');
    tree = m.render();
    const mounts = uploadMounts;
    if (replacement === 'account') account = { ...account, id: 'new-account' };
    if (replacement === 'client') client = {};
    if (replacement === 'course') params = { ...params, courseId: 'd' };
    if (replacement === 'mode') params = { ...params, mode: 'reply', conversationId: 'conv' };
    if (replacement === 'conversation') params = { ...params, conversationId: 'replacement' };
    if (replacement === 'recipient') params = { ...params, recipientIds: 'other', recipientNames: 'Other' };
    tree = m.render();
    assert.equal(field(tree, 'message').value, '');
    assert.equal(uploadMounts, mounts + 1);
    assert.equal(count('resetUploads'), 1);
    m.unmount();
  }
  // Picker identity, removed folder membership, and failed refetch promises stay within synthetic boundaries.
  for (const replacement of ['account', 'client', 'course', 'user', 'focus', 'unmount']) {
    reset();
    let p = {
      courseId: 'c',
      courseCode: 'RAW',
      userId: 'self',
      selected: [],
      onChange: () => calls.push(['selected']),
    };
    const m = mountTree(() => RecipientPicker(p));
    tree = m.render();
    const stale = row(tree, 'RAW u').onPress,
      staleFolder = row(tree, 'RAW groups').onPress;
    if (replacement === 'account') account = { ...account, id: 'B' };
    if (replacement === 'client') client = {};
    if (replacement === 'course') p = { ...p, courseId: 'd' };
    if (replacement === 'user') p = { ...p, userId: 'other' };
    if (replacement === 'focus') focused = false;
    if (replacement === 'unmount') m.unmount();
    else m.render();
    stale();
    staleFolder();
    assert.equal(count('selected'), 0, replacement);
    if (replacement !== 'unmount') m.unmount();
  }
  reset();
  const retryPicker = mountTree(() =>
    RecipientPicker({ courseId: 'c', courseCode: 'RAW', userId: 'self', selected: [], onChange: () => {} }),
  );
  contexts = {
    ...contexts,
    isError: true,
    error: new Error('RAW context'),
    refetch: () => Promise.reject(new Error('RAW refetch')),
  };
  tree = retryPicker.render();
  one(tree, 'Callout').action.onPress();
  await Promise.resolve();
  retryPicker.unmount();

  // Actual API serializer/signature and original-account invalidation with a synthetic client only.
  reset();
  const remote = deferred();
  client = {
    post: (url, payload) => {
      transport.push([url, payload]);
      return remote.promise;
    },
  };
  const create = api.useCreateConversation();
  const added = api.useAddMessage();
  const creation = create.mutateAsync({
    courseId: 'c',
    subject: ' S ',
    body: ' B ',
    recipients: ['u'],
    attachmentIds: ['f'],
    individually: true,
  });
  account = { ...account, id: 'B' };
  client = {
    post: () => {
      throw Error('Replacement client must not be used');
    },
  };
  remote.resolve([]);
  await creation;
  equal(transport.at(-1), [
    '/api/v1/conversations',
    {
      recipients: ['u'],
      subject: ' S ',
      body: ' B ',
      context_code: 'course_c',
      attachment_ids: ['f'],
      group_conversation: true,
      bulk_message: true,
      mode: 'sync',
    },
  ]);
  equal(invalidations.at(-1), { queryKey: ['A', 'conversations'] });
  await added.mutateAsync({
    id: 'conv',
    body: 'RAW',
    recipients: ['v'],
    attachmentIds: ['f'],
    includedMessages: ['m'],
  });
  equal(transport.at(-1), [
    '/api/v1/conversations/conv/add_message',
    { body: 'RAW', recipients: ['v'], included_messages: ['m'], attachment_ids: ['f'] },
  ]);
  equal(invalidations.slice(-2), [
    { queryKey: ['A', 'conversation', 'conv'] },
    { queryKey: ['A', 'conversations'] },
  ]);
  assert.equal(api.signatureBlock({ available: true, enabled: true, text: ' raw \n' }), '\n\n---\nraw');
  console.log(
    'Inbox compose: production route/picker/helpers/API; synthetic hooks/query/native/transport; historical catalog hashes preserved; TZ=' +
      process.env.TZ,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
