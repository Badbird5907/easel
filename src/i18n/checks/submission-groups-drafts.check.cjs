/* global __dirname */
/** Production UI/hook/fetcher/client/draft-state/queue with synthetic React/native,
 * query, HTTP and in-memory filesystem/kv boundaries. No network or native operations. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient, QueryObserver } = require('@tanstack/query-core');
const baseline = require('./submission-groups-drafts.baseline.json');
const root = path.resolve(__dirname, '../..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const equal = (a, b) => assert.deepEqual(plain(a), plain(b));
const unexpected = [];
const fail = (name) => {
  unexpected.push(name);
  throw Error('Unexpected boundary: ' + name);
};
const strict = (name, values) =>
  new Proxy(values, {
    get(o, k) {
      if (k === '__esModule') return false;
      if (k in o) return o[k];
      return fail(name + '.' + String(k));
    },
  });
let scope;
const react = {
  useMemo(fn, deps) {
    const i = scope.cursor++,
      old = scope.slots[i];
    if (!old || deps.some((v, j) => !Object.is(v, old.deps[j])))
      scope.slots[i] = { deps, value: fn() };
    return scope.slots[i].value;
  },
  useEffect(fn, deps) {
    const i = scope.cursor++,
      old = scope.slots[i];
    if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
      scope.slots[i] = { deps };
      scope.effects.push(fn);
    }
  },
  useSyncExternalStore(subscribe, snapshot) {
    const s = scope,
      i = s.cursor++;
    if (!s.slots[i])
      s.slots[i] = {
        unsubscribe: subscribe(() => {
          s.dirty = true;
        }),
      };
    return snapshot();
  },
};
function mount(fn, initial) {
  let props = initial;
  const s = { cursor: 0, slots: [], effects: [], dirty: false };
  return {
    render(next = props) {
      props = next;
      let value,
        limit = 10;
      do {
        assert.ok(limit--);
        scope = s;
        s.cursor = 0;
        s.dirty = false;
        value = fn(props);
        scope = null;
        if (s.hooks !== undefined) assert.equal(s.cursor, s.hooks, 'stable hook order');
        s.hooks = s.cursor;
        while (s.effects.length) s.effects.shift()();
      } while (s.dirty);
      return value;
    },
    get dirty() {
      return s.dirty;
    },
    unmount() {
      for (const slot of s.slots) slot?.unsubscribe?.();
    },
  };
}
const jsx = (type, props, key) => ({ type, props, key });
const elements = (names) => Object.fromEntries(names.split(' ').map((n) => [n, n]));
const nodes = (t) =>
  !t || typeof t !== 'object'
    ? []
    : Array.isArray(t)
      ? t.flatMap(nodes)
      : [t, ...nodes(t.props?.children)];
const all = (t, type) => nodes(t).filter((n) => n.type === type);
const textContent = (t) =>
  t == null
    ? ''
    : typeof t !== 'object'
      ? String(t)
      : Array.isArray(t)
        ? t.map(textContent).join('')
        : textContent(t.props?.children);
const disk = new Map(),
  dirs = new Set(),
  kv = new Map(),
  writes = [];
let storageFailure = false,
  uuid = 0;
const uri = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
class Directory {
  constructor(...parts) {
    this.uri = uri(parts);
    assert.ok(this.uri.startsWith('synthetic://'));
  }
  get exists() {
    return dirs.has(this.uri);
  }
  create() {
    writes.push(['mkdir', this.uri]);
    dirs.add(this.uri);
  }
  delete() {
    fail('deleteDirectory');
  }
}
class File {
  constructor(...parts) {
    this.uri = uri(parts);
    assert.ok(this.uri.startsWith('synthetic://'));
  }
  get exists() {
    return disk.has(this.uri);
  }
  textSync() {
    return disk.get(this.uri);
  }
  writeSync(v) {
    writes.push(['file', this.uri, v]);
    if (storageFailure) throw Error('full disk');
    disk.set(this.uri, v);
  }
}
let observeQuery = null;
let query = { data: null },
  queryCall;
const queries = [],
  account = { id: 'account', user: { id: 'self' } };
const mocks = {
  react: strict('react', react),
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': strict('native', elements('View')),
  'lucide-react-native': strict('icons', elements('Users')),
  '@/design': strict('design', elements('Avatar Callout Card IconTile Skeleton Text')),
  '@tanstack/react-query': strict('tanstack', { useQueryClient: () => fail('useQueryClient') }),
  '@/canvas/session': strict('session', {
    useCanvas: () => ({ account }),
    registerAccountCleanup: () => {},
  }),
  '@/canvas/query': strict('query', {
    useCanvasQuery: (key, fn, options) => {
      queryCall = { key, fn, options };
      queries.push([key, options]);
      return observeQuery ? observeQuery(key, fn, options) : query;
    },
  }),
  '@/canvas/html': strict('html', {}),
  '@/canvas/uploads': strict('uploads', {}),
  '@/canvas/api/assignments': strict('assignments', {}),
  '@/canvas/api/submissionDrafts': strict('draftAPI', {}),
  'expo-file-system': { Directory, File, Paths: { document: 'synthetic://documents' } },
  'expo-crypto': { randomUUID: () => `uuid-${++uuid}` },
  '@/features/offline/connectivity': strict('connectivity', { isOnline: () => false }),
  '@/features/offline/kv': {
    offlineKv: {
      getItemSync: (k) => kv.get(k) ?? null,
      setItemSync: (k, v) => {
        writes.push(['kv', k, v]);
        kv.set(k, v);
      },
      removeItemSync: () => fail('removeKv'),
    },
  },
};
let http = () => fail('HTTP');
const cache = new Map();
const allowed = new Set([
  'canvas/api/submissions',
  'canvas/client',
  'features/submissions/GroupCard',
  'features/submissions/useUploadedDraft',
  'features/submissions/draftPresentation',
  'features/submissions/draftState',
  'features/offline/submissionDrafts',
  'features/offline/queue',
  'features/offline/store',
  'i18n',
  'i18n/runtime',
  'i18n/en',
  'i18n/fr',
  'i18n/ar',
]);
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mocks[key]) return mocks[key];
  if (!key.startsWith('@/') || !allowed.has(key.slice(2))) return fail('import ' + key);
  const file = ['.ts', '.tsx', '/index.ts']
    .map((e) => path.join(root, key.slice(2)) + e)
    .find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
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
    Error,
    console,
    fetch: (...args) => http(...args),
    setTimeout: () => fail('timer'),
    clearTimeout: () => fail('clearTimer'),
  });
  return module.exports;
}
const i18n = load('@/i18n/runtime');
const api = load('@/canvas/api/submissions');
const { GroupCard, groupPhrase, groupMembersLabel } = load('@/features/submissions/GroupCard');
const { useUploadedDraft } = load('@/features/submissions/useUploadedDraft');
const state = load('@/features/submissions/draftState'),
  queue = load('@/features/offline/queue');
const { CanvasClient, CanvasError, CanvasAuthError } = load('@/canvas/client');
const locales = ['en', 'fr', 'ar'];
const translate = (locale) => {
  i18n.setAccountLocale('account', locale);
  return i18n.createTranslator(locale);
};
function frozenSourcesAndCatalogs() {
  const catalogs = Object.fromEntries(locales.map((l) => [l, load(`@/i18n/${l}`)[l]]));
  const keys = [
    'loading',
    'title',
    'error',
    'noGroup',
    'you',
    'members',
    'membersEmpty',
    'membersUnavailable',
    'compact',
    'full',
    'accessibility',
    'phrase',
  ].map((k) => 'submissionGroup.' + k);
  for (const l of locales) {
    assert.equal(Object.keys(baseline.catalogs[l]).length, 1793);
    for (const [k, v] of Object.entries(baseline.catalogs[l])) equal(catalogs[l][k], v);
    for (const k of keys) assert.ok(Object.hasOwn(catalogs[l], k));
    equal(Object.keys(catalogs[l]).sort(), Object.keys(catalogs.en).sort());
    for (const k of Object.keys(catalogs.en))
      equal(
        [...new Set(JSON.stringify(catalogs[l][k]).match(/\{\w+\}/g) ?? [])].sort(),
        [...new Set(JSON.stringify(catalogs.en[k]).match(/\{\w+\}/g) ?? [])].sort(),
      );
  }
  // Exact bytes outside the owned type/fetcher; includes query keys, selection models,
  // submission decisions, mutation bodies and every other API function/import.
  const apiOutside = (s) =>
    s.replace(
      /export type SubmissionGroup = \{[\s\S]*?(?=export function useSubmissionGroup)/,
      '<owned>\n',
    );
  equal(
    apiOutside(source('canvas/api/submissions.ts')),
    apiOutside(baseline.sources['canvas/api/submissions.ts']),
  );
  // Entire persistence/effect algorithm and dependency array are byte-for-byte unchanged.
  const uploadedAlgorithm = (s) =>
    s.slice(s.indexOf('  const { accountId'), s.indexOf('  return '));
  equal(
    uploadedAlgorithm(source('features/submissions/useUploadedDraft.ts')),
    uploadedAlgorithm(baseline.sources['features/submissions/useUploadedDraft.ts']),
  );
  for (const f of [
    'features/submissions/draftState.ts',
    'features/submissions/draftPresentation.ts',
    'features/offline/submissionDrafts.ts',
  ])
    assert.equal(source(f), baseline.sources[f]);
}
function checkGroupUI() {
  const a = { courseId: 'course', groupCategoryId: 'category' };
  const h = mount(GroupCard, { a });
  const member = (id, name, avatarUrl = null) => ({ id, name, avatarUrl });
  const self = member('self', 'RAW self العربية', 'https://avatar.invalid/self');
  const raw = [
    member('empty', '', ''),
    member('english', 'You', 'https://avatar.invalid/you'),
    member('rtl', 'ليلى', null),
  ];
  const scenarios = [
    ['self', [self], 'loaded'],
    ['multiple', [raw[0], self, raw[1], raw[2]], 'loaded'],
    ['empty', [], 'loaded'],
    ['omitted', raw, 'loaded'],
    ['unavailable', [], 'unavailable'],
    ['unavailable stale', raw, 'unavailable'],
    ['legacy empty', [], undefined],
    ['legacy self', [self], undefined],
    ['legacy nonempty', raw, undefined],
  ];
  for (const [label, members, status] of scenarios) {
    for (const name of ['', 'Group assignment', 'مجموعة']) {
      const group = { id: 'g', name, members, ...(status && { membersStatus: status }) };
      const original = JSON.stringify(group);
      query = { data: group };
      for (const locale of locales) {
        const t = translate(locale);
        for (const compact of [true, false]) {
          const tree = h.render({ a, compact });
          assert.strictEqual(query.data, group);
          assert.equal(JSON.stringify(group), original);
          equal(queryCall.key, ['courses', 'course', 'submission_group', 'category']);
          equal(queryCall.options, { enabled: true });
          const unavailable = status === 'unavailable' || (!status && !members.length);
          const names = members.map((m) => (m.id === 'self' ? t('submissionGroup.you') : m.name));
          const expected = unavailable
            ? t('submissionGroup.membersUnavailable')
            : !members.length
              ? t('submissionGroup.membersEmpty')
              : t('submissionGroup.members', {
                  names: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
                    names,
                  ),
                });
          const accessible = nodes(tree).find((n) => n.props?.accessible);
          assert.equal(
            accessible.props.accessibilityLabel,
            t('submissionGroup.accessibility', { name, members: expected }),
            label,
          );
          assert.equal(groupMembersLabel(group, 'self', t, locale), expected);
          const texts = all(tree, 'Text').map((n) => n.props.children);
          assert.equal(texts[0], name);
          assert.equal(texts[1], t(compact ? 'submissionGroup.compact' : 'submissionGroup.full'));
          equal(
            all(tree, 'Avatar').map((n) => [n.props.name, n.props.uri]),
            unavailable ? [] : members.map((m) => [m.name, m.avatarUrl]),
          );
          if (!unavailable && members.length) equal(texts.slice(2), names);
          const compatibility =
            status !== 'unavailable' && members.length > 1
              ? `${name} (${members.length} people)`
              : name;
          assert.equal(groupPhrase(group), compatibility);
          assert.equal(
            groupPhrase(group, t),
            status === 'loaded' && members.length > 1
              ? t('submissionGroup.phrase', { name, count: members.length })
              : name,
          );
        }
      }
    }
  }
  // Legacy counts preserve ungrouped ASCII digits even under an Arabic foreground.
  const huge = { id: 'g', name: 'RAW', members: Array.from({ length: 1234 }, () => self) };
  assert.equal(groupPhrase(huge), 'RAW (1234 people)');
  assert.equal(groupPhrase(huge, i18n.createTranslator('fr')), 'RAW');
  assert.match(
    groupPhrase({ ...huge, membersStatus: 'loaded' }, i18n.createTranslator('fr')),
    /1\s234/,
  );
  for (const locale of locales) {
    const t = translate(locale);
    query = { isPending: true };
    let tree = h.render({ a });
    assert.equal(tree.props.accessibilityLabel, t('submissionGroup.loading'));
    equal(tree.props.accessibilityState, { busy: true });
    assert.equal(all(tree, 'Skeleton').length, 1);
    query = { isError: true, data: { id: 'stale', name: 'HIDDEN stale group', members: raw } };
    tree = h.render();
    assert.equal(tree.props.title, t('submissionGroup.title'));
    assert.equal(textContent(tree), t('submissionGroup.error'));
    query = { data: null };
    tree = h.render();
    assert.equal(textContent(tree), t('submissionGroup.noGroup'));
    assert.equal(h.render({ a: { ...a, groupCategoryId: null } }), null);
    equal(queryCall.key, ['courses', 'course', 'submission_group', '']);
    equal(queryCall.options, { enabled: false });
  }
  query = { data: { id: 'g', name: 'group', members: raw, membersStatus: 'loaded' } };
  translate('en');
  h.render({ a });
  translate('fr');
  assert.ok(h.dirty, 'real locale subscription');
  h.render();
  assert.ok(queries.length);
  h.unmount();
}
async function checkFetcher() {
  const client = new CanvasClient('https://synthetic.invalid', 'synthetic-token');
  const controller = new AbortController(),
    signal = controller.signal;
  const group = { id: 77, name: '', course_id: 2, group_category_id: 3 };
  const calls = [];
  let responses = [];
  http = async (url, options) => {
    calls.push([url, options]);
    assert.ok(url.startsWith('https://synthetic.invalid/'));
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Accept, 'application/json+canvas-string-ids');
    assert.equal(options.signal, signal);
    assert.ok(responses.length, 'unexpected request');
    return responses.shift()(url, options);
  };
  const response =
    (body, status = 200, headers = {}) =>
    () =>
      new Response(JSON.stringify(body), { status, headers });
  const selfGroups = () => response([group, { ...group, id: 88 }]);
  const run = () => api.fetchSubmissionGroup(client, '2', '3', signal);
  responses = [
    response(
      [
        { ...group, id: 1, course_id: 4 },
        { ...group, id: 2, group_category_id: 4 },
      ],
      200,
      { Link: '<https://synthetic.invalid/groups-page-2>; rel="next"' },
    ),
    selfGroups(),
    response([{ id: 1, name: '', avatar_url: '' }], 200, {
      Link: '<https://synthetic.invalid/members-page-2>; rel="next"',
    }),
    response([
      { id: 'self', name: 'You', avatar_url: 'raw://avatar' },
      { id: 3, name: 'ليلى' },
    ]),
  ];
  equal(await run(), {
    id: '77',
    name: '',
    membersStatus: 'loaded',
    members: [
      { id: '1', name: '', avatarUrl: '' },
      { id: 'self', name: 'You', avatarUrl: 'raw://avatar' },
      { id: '3', name: 'ليلى', avatarUrl: null },
    ],
  });
  assert.equal(
    calls[0][0],
    'https://synthetic.invalid/api/v1/users/self/groups?per_page=100&context_type=Course',
  );
  assert.equal(
    calls[2][0],
    'https://synthetic.invalid/api/v1/groups/77/users?per_page=100&include%5B%5D=avatar_url',
  );
  responses = [response([])];
  assert.equal(await run(), null);
  responses = [selfGroups(), response([])];
  equal(await run(), { id: '77', name: '', membersStatus: 'loaded', members: [] });
  for (const failure of [
    response({ message: 'roster restricted' }, 403),
    response({ message: 'not permitted' }, 401),
    response({}, 500),
    () => {
      throw Error('offline');
    },
  ]) {
    responses = [
      selfGroups(),
      response([{ id: 'partial', name: 'partial' }], 200, {
        Link: '<https://synthetic.invalid/members-page-2>; rel="next"',
      }),
      failure,
    ];
    equal(await run(), { id: '77', name: '', membersStatus: 'unavailable', members: [] });
  }
  responses = [response({}, 500)];
  await assert.rejects(run, (e) => e instanceof CanvasError && e.status === 500);
  responses = [
    selfGroups(),
    response([], 200, { Link: '<https://synthetic.invalid/members-page-2>; rel="next"' }),
    response({ message: 'token expired' }, 401, { 'WWW-Authenticate': 'Bearer' }),
  ];
  await assert.rejects(run, (e) => e instanceof CanvasAuthError);
  responses = [selfGroups(), response({ message: 'invalid access token' }, 401)];
  await assert.rejects(run, (e) => e instanceof CanvasAuthError);
  const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
  responses = [
    selfGroups(),
    () => {
      throw aborted;
    },
  ];
  await assert.rejects(run, (e) => e === aborted);
  const abortObject = { name: 'AbortError' };
  responses = [
    selfGroups(),
    () => {
      throw abortObject;
    },
  ];
  await assert.rejects(run, (e) => e === abortObject);
  // A non-AbortError failure after cancellation must not become successful data.
  responses = [
    selfGroups(),
    () => {
      controller.abort();
      throw Error('late transport failure');
    },
  ];
  await assert.rejects(run);
  assert.equal(responses.length, 0);
  // Hook forwards the same course/category/signal through its stable account-scoped query boundary.
  const h = mount(() => api.useSubmissionGroup('2', '3'));
  h.render();
  const recorded = [];
  await queryCall.fn(
    {
      getAll: async (...args) => {
        recorded.push(args);
        return [];
      },
    },
    signal,
  );
  equal(recorded, [['/api/v1/users/self/groups', { context_type: 'Course' }, { signal: {} }]]);
  assert.strictEqual(recorded[0][2].signal, signal);
  h.unmount();
  const completed = new AbortController();
  await assert.rejects(
    () =>
      api.fetchSubmissionGroup(
        {
          getAll: async (path) => {
            if (path.includes('/users/self/')) return [group];
            completed.abort('cancelled after roster response');
            return [];
          },
        },
        '2',
        '3',
        completed.signal,
      ),
    (e) => e === 'cancelled after roster response',
  );
  http = () => fail('HTTP');
}
async function checkObservedLocaleSwitches() {
  // Installed TanStack observer plus synthetic useCanvasQuery/session boundary.
  // Mirror the production account prefix/staleTime; execute the real group fetcher.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, gcTime: Infinity, retry: false } },
  });
  const requests = [];
  const client = {
    getAll: async (...args) => {
      requests.push(args);
      if (args[0] === '/api/v1/users/self/groups')
        return [{ id: 'group', name: 'RAW', course_id: 'course', group_category_id: 'category' }];
      assert.equal(args[0], '/api/v1/groups/group/users');
      return [
        { id: 'self', name: 'RAW viewer', avatar_url: '' },
        { id: 'other', name: 'You' },
      ];
    },
  };
  observeQuery = (key, fn, extra) => {
    const options = {
      queryKey: [account.id, ...key],
      queryFn: ({ signal }) => fn(client, signal),
      ...extra,
    };
    const observer = react.useMemo(() => new QueryObserver(queryClient, options), []);
    const result = react.useSyncExternalStore(
      (listener) => observer.subscribe(listener),
      () => observer.getCurrentResult(),
    );
    react.useEffect(() => {
      observer.setOptions(options);
    }, [observer, options]);
    return result;
  };
  const h = mount(GroupCard, { a: { courseId: 'course', groupCategoryId: 'category' } });
  translate('en');
  h.render();
  // Drain only already-created promises; no timer, HTTP, or network waiting.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const key = ['account', 'courses', 'course', 'submission_group', 'category'];
  const group = queryClient.getQueryData(key);
  assert.equal(group?.id, 'group');
  assert.equal(requests.length, 2);
  for (const locale of ['en', 'fr', 'ar', 'fr', 'en']) {
    const t = translate(locale),
      tree = h.render();
    assert.strictEqual(queryClient.getQueryData(key), group);
    assert.equal(requests.length, 2, 'locale must not refetch');
    assert.equal(all(tree, 'Text')[2].props.children, t('submissionGroup.you'));
    assert.equal(queryClient.getQueryCache().getAll().length, 1);
  }
  h.unmount();
  queryClient.clear();
  observeQuery = null;
}
function checkUploadedDraft() {
  let number = 0;
  const target = () => ({
    accountId: 'account',
    courseId: 'course',
    assignmentId: `assignment-${++number}`,
    attempt: 2,
    submissionId: 'submission',
  });
  const upload = {
    activeSubmissionType: 'online_upload',
    fileIds: ['9007199254740993', 'العربية', ''],
  };
  const media = {
    activeSubmissionType: 'media_recording',
    mediaId: 'RAW-media',
    mediaType: 'audio',
  };
  const hook = (t, c, enabled = true) =>
    mount((p) => useUploadedDraft(p.target, p.content, p.enabled), {
      target: t,
      content: c,
      enabled,
    });
  const snapshot = () =>
    JSON.stringify({ writes, disk: [...disk], kv: [...kv], queue: queue.pendingWrites() });
  for (const content of [upload, media]) {
    const t = target(),
      kind = content.activeSubmissionType,
      h = hook(t, content);
    translate('en');
    assert.equal(h.render(), i18n.t('submissionDraft.waiting'));
    let doc = state.readDraftDocument(t),
      record = doc.records[kind];
    equal(record.content, content);
    assert.equal(record.value, JSON.stringify(content));
    assert.equal(record.revision, 1);
    const w = queue.pendingWrites().find((w) => w.payload.target.assignmentId === t.assignmentId);
    assert.equal(w.key, `${state.draftKey(t)}:${doc.generation}:${kind}`);
    equal(w.payload, { target: t, generation: doc.generation, action: 'save', kind, revision: 1 });
    for (const [status, key] of [
      ['device', 'device'],
      ['waiting', 'waiting'],
      ['synced', 'synced'],
      ['unavailable', 'unavailable'],
      ['stale', 'stale'],
      ['storage-error', 'storageError'],
    ]) {
      state.setDraftStatus(t, kind, 1, status);
      const before = snapshot();
      for (const locale of locales) {
        const tr = translate(locale);
        assert.ok(h.dirty);
        assert.equal(h.render(), tr('submissionDraft.' + key));
        assert.equal(snapshot(), before, 'locale-only must not edit/queue');
      }
    }
    const next = content === upload ? { ...content, fileIds: [] } : { ...content, mediaId: '' };
    h.render({ target: t, content: next, enabled: true });
    record = state.readDraftDocument(t).records[kind];
    equal(record.content, next);
    assert.equal(record.revision, 2);
    assert.equal(
      queue.pendingWrites().filter((w) => w.payload.target.assignmentId === t.assignmentId).length,
      1,
      'coalesced',
    );
    assert.equal(
      queue.pendingWrites().find((w) => w.payload.target.assignmentId === t.assignmentId).payload
        .revision,
      2,
    );
    const before = snapshot();
    h.render({ target: { ...t }, content: { ...next }, enabled: true });
    assert.equal(snapshot(), before);
    state.consumeDraft(t);
    const consumed = snapshot();
    h.render({ target: t, content, enabled: true });
    assert.equal(snapshot(), consumed);
    assert.equal(h.render(), null);
    h.unmount();
  }
  // No initial record or queue for missing/empty content, disabled, or missing submission ID.
  for (const [content, enabled, submissionId] of [
    [null, true, 's'],
    [{ ...upload, fileIds: [] }, true, 's'],
    [{ ...media, mediaId: '' }, true, 's'],
    [upload, false, 's'],
    [media, true, undefined],
  ]) {
    const t = { ...target(), submissionId },
      before = snapshot(),
      h = hook(t, content, enabled);
    assert.equal(h.render(), null);
    assert.equal(snapshot(), before);
    h.unmount();
  }
  // Same instance transitions from disabled/no content; exact target/IDs retained.
  const t = target(),
    h = hook(t, null, false);
  h.render();
  h.render({ target: t, content: upload, enabled: true });
  assert.equal(state.readDraftDocument(t).records.online_upload.revision, 1);
  const t2 = { ...t, attempt: 3 };
  h.render({ target: t2, content: media, enabled: true });
  equal(state.readDraftDocument(t2).records.media_recording.content, media);
  assert.equal(state.readDraftDocument(t).records.online_upload.revision, 1);
  h.unmount();
  // Real state storage failure: keep memory feedback; queue refuses the failed write.
  const failed = target(),
    bad = hook(failed, upload);
  storageFailure = true;
  assert.equal(bad.render(), i18n.t('submissionDraft.storageError'));
  storageFailure = false;
  assert.ok(
    !queue.pendingWrites().some((w) => w.payload.target.assignmentId === failed.assignmentId),
  );
  bad.unmount();
}
(async () => {
  frozenSourcesAndCatalogs();
  checkGroupUI();
  await checkFetcher();
  await checkObservedLocaleSwitches();
  checkUploadedDraft();
  assert.deepEqual(unexpected, []);
  console.log(
    `PASS submission groups/drafts: ${Object.keys(load('@/i18n/en').en).length} keys; production UI/client/pagination/auth/cancellation/state/queue, locale-only purity, frozen algorithms (${process.env.TZ ?? 'default TZ'}).`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
