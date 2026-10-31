/* global __dirname */
// Production FolderPicker, owner, content store, formatting and translators.
// Synthetic hooks/query/session/router/native boundaries; no HTTP or native effects.
// The reconciler models commits, abandoned renders and effect replay, not React Compiler.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
let scope;
const depsEqual = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const effect = (kind) => (fn, deps) => {
  const s = scope,
    i = s.cursor++,
    old = s.slots[i];
  if (!old || !depsEqual(old.deps, deps)) {
    const slot = { deps, fn, kind, cleanup: null };
    s.slots[i] = slot;
    s.jobs[kind].push(() => {
      old?.cleanup?.();
      slot.cleanup = fn();
    });
  }
};
const react = {
  useState(initial) {
    const s = scope,
      i = s.cursor++;
    if (!s.slots[i]) {
      const slot = { value: typeof initial === 'function' ? initial() : initial };
      slot.set = (value) => {
        // React ignores updates to unmounted components (including retained Expo event callbacks).
        assert.ok(s.mounted, 'update after unmount');
        const next = typeof value === 'function' ? value(slot.value) : value;
        if (!Object.is(next, slot.value)) {
          slot.value = next;
          s.host.dirty = true;
        }
      };
      s.slots[i] = slot;
    }
    return [s.slots[i].value, s.slots[i].set];
  },
  useRef(value) {
    const s = scope,
      i = s.cursor++;
    return (s.slots[i] ??= { current: value });
  },
  useMemo(fn, deps) {
    const s = scope,
      i = s.cursor++,
      old = s.slots[i];
    if (!old || !depsEqual(old.deps, deps)) s.slots[i] = { value: fn(), deps };
    return s.slots[i].value;
  },
  useCallback(fn, deps) {
    return react.useMemo(() => fn, deps);
  },
  useLayoutEffect: effect('layout'),
  useEffect: effect('passive'),
};
const jsx = (type, props, key) => ({ type, props, key });
function mount(fn) {
  const h = { nodes: new Map(), dirty: false, tree: null };
  let draft, saved, stateValues;
  function retire(s) {
    for (const slot of s.slots) slot?.cleanup?.();
    s.mounted = false;
  }
  function visit(node, at) {
    if (Array.isArray(node)) return node.map((v, i) => visit(v, `${at}.${i}`));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      let s = h.nodes.get(at);
      if (!s || s.type !== node.type || s.key !== node.key)
        s = { type: node.type, key: node.key, slots: [], host: h, mounted: true };
      saved.set(s, s.slots.slice());
      for (const slot of s.slots) if (slot?.set) stateValues.set(slot, slot.value);
      s.cursor = 0;
      s.jobs = { layout: [], passive: [] };
      draft.set(at, s);
      const old = scope;
      scope = s;
      let result;
      try {
        result = node.type(node.props);
      } finally {
        scope = old;
      }
      return visit(result, at + '.child');
    }
    return {
      ...node,
      props: { ...node.props, children: visit(node.props.children, at + '.children') },
    };
  }
  h.renderOnly = () => {
    draft = new Map();
    saved = new Map();
    stateValues = new Map();
    h.dirty = false;
    return visit(fn(), 'root');
  };
  h.abandon = () => {
    for (const [slot, value] of stateValues) slot.value = value;
    for (const [s, slots] of saved) s.slots = slots;
    draft = saved = null;
  };
  h.commit = () => {
    for (const [at, s] of h.nodes) if (draft.get(at) !== s) retire(s);
    h.nodes = draft;
    for (const kind of ['layout', 'passive'])
      for (const s of [...draft.values()].reverse()) for (const job of s.jobs[kind]) job();
    draft = saved = null;
  };
  h.render = () => {
    let limit = 20;
    do {
      assert.ok(limit--, 'render loop');
      h.tree = h.renderOnly();
      h.commit();
    } while (h.dirty);
    return h.tree;
  };
  h.replay = () => {
    for (const s of h.nodes.values()) for (const slot of s.slots) slot?.cleanup?.();
    for (const kind of ['layout', 'passive'])
      for (const s of [...h.nodes.values()].reverse())
        for (const slot of s.slots) if (slot?.kind === kind) slot.cleanup = slot.fn();
  };
  h.unmount = () => {
    for (const s of h.nodes.values()) retire(s);
    h.nodes.clear();
  };
  return h;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
react.useSyncExternalStore = (subscribe, snapshot) => {
  const [, update] = react.useState(0);
  react.useLayoutEffect(() => subscribe(() => update((n) => n + 1)), [subscribe]);
  const value = snapshot();
  react.useLayoutEffect(() => {
    if (!Object.is(value, snapshot())) update((n) => n + 1);
  });
  return value;
};
let env, locale, focused, online, folder, contents, queryClient, props, cached;
let uploadResult, invalidateResult, refreshResult;
const calls = {
  uploads: [],
  invalidate: [],
  refresh: [],
  router: [],
  clear: [],
  success: [],
  error: [],
  announce: [],
  leave: [],
};
const navigation = { isFocused: () => focused };
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': {
    View: 'View',
    RefreshControl: 'RefreshControl',
    AccessibilityInfo: { announceForAccessibility: (v) => calls.announce.push(v) },
  },
  'lucide-react-native': {},
  'expo-router': {
    Stack: { Screen: 'StackScreen' },
    useIsFocused: () => focused,
    useNavigation: () => navigation,
    router: { push: (v) => calls.router.push(v), dismissAll: () => calls.router.push('dismissAll') },
  },
  'expo-sharing': { clearSharedPayloads: (...args) => calls.clear.push(args) },
  '@tanstack/react-query': { useQueryClient: () => queryClient },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/query': { useAccountKey: () => env.account.id },
  '@/canvas/api/files': {
    useRootFolder: () => folder,
    useFolder: () => folder,
    useFolderContents: () => contents,
  },
  '@/canvas/uploads': {
    uploadToCanvas: (...args) => {
      calls.uploads.push(args);
      return uploadResult(...args);
    },
  },
  '@/features/offline/useOnline': { useOnline: () => online },
  '@/features/files/FileThumbnail': { FileThumbnail: 'FileThumbnail' },
  '@/features/course/states': {
    ListSkeleton: 'ListSkeleton',
    LoadError: 'LoadError',
    useRefreshControl: () => null,
  },
  '@/features/share/ShareScreen': { leaveShare: () => calls.leave.push(true) },
  '@/design': {
    ...Object.fromEntries(
      [
        'Button',
        'Callout',
        'Card',
        'EmptyState',
        'Icon',
        'IconButton',
        'IconTile',
        'ListGroup',
        'ListItem',
        'ProgressBar',
        'Screen',
        'Text',
      ].map((x) => [x, x]),
    ),
    haptics: { success: () => calls.success.push(true), error: () => calls.error.push(true) },
    useTheme: () => ({ colors: { fgMuted: 'synthetic-muted' } }),
  },
  '@/i18n': {
    useTranslation: () => ({ locale, t: runtime.createTranslator(locale) }),
    createTranslator: (...args) => runtime.createTranslator(...args),
    getLocaleState: () => ({ locale }),
  },
};
function load(file, from = root) {
  if (Object.hasOwn(stubs, file)) return stubs[file];
  assert.ok(file.startsWith('@/') || file.startsWith('.'), 'Unmocked boundary: ' + file);
  let p = file.startsWith('@/') ? path.join(root, file.slice(2)) : path.resolve(from, file);
  if (!path.extname(p)) p += fs.existsSync(p + '.ts') ? '.ts' : '.tsx';
  const alias = '@/' + path.relative(root, p).replace(/\.tsx?$/, '');
  if (Object.hasOwn(stubs, alias)) return stubs[alias];
  assert.ok(p.startsWith(root + '/'), 'Unmocked import: ' + file);
  if (cache.has(p)) return cache.get(p);
  const source =
    process.env.SHARE_FOLDERS_BEFORE && p.endsWith('/share/FolderPicker.tsx')
      ? process.env.SHARE_FOLDERS_BEFORE
      : p;
  const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    fileName: p,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  cache.set(p, module.exports);
  new Function('require', 'module', 'exports', code)(
    (name) => load(name, path.dirname(p)),
    module,
    module.exports,
  );
  return module.exports;
}
const runtime = load('@/i18n/runtime');
const content = load('@/features/share/content');
const { CanvasError, CanvasNetworkError } = load('@/canvas/client');
const { FolderPicker } = load('@/features/share/FolderPicker');
const { ShareFoldersOwner } = load('@/features/share/shareFoldersOwner');
const nodes = (tree, type) => {
  if (Array.isArray(tree)) return tree.flatMap((v) => nodes(v, type));
  if (!tree || typeof tree !== 'object') return [];
  return [
    ...(tree.type === type ? [tree.props] : []),
    ...nodes(tree.props.children, type),
    ...nodes(tree.props.refreshControl, type),
  ];
};
const first = (h, type) => nodes(h.tree, type)[0];
const tr = (key, args) => runtime.createTranslator(locale)('shareFolders.' + key, args);
const file = (n = 1) => ({
  name: `RAW الملف {count} ${n}.pdf`,
  uri: `content://raw/${n}?q=%20`,
  size: 1543,
  mimeType: 'application/custom',
  isImage: false,
});
const payload = (n = 2) => ({ files: Array.from({ length: n }, (_, i) => file(i)), url: null, text: null });
const data = () => ({
  id: 'root-A',
  name: 'RAW مجلد',
  canUpload: true,
  lockedForUser: false,
  forSubmissions: false,
});
const syncCache = () => {
  cached = { data: folder.data, status: folder.isError ? 'error' : folder.isPending ? 'pending' : 'success' };
};
function reset(n = 2) {
  for (const list of Object.values(calls)) list.length = 0;
  env = { account: { id: 'A', user: { id: 'user-A' }, baseUrl: 'https://example.invalid' }, client: {} };
  locale = 'en';
  focused = true;
  online = true;
  props = {};
  folder = { data: data(), isError: false, isPending: false, refetch: () => refreshResult() };
  contents = {
    data: { folders: [{ ...data(), id: 'child', name: 'RAW Child', foldersCount: 2 }] },
    isError: false,
    isPending: false,
    refetch: () => refreshResult(),
  };
  syncCache();
  uploadResult = async () => ({ id: 'accepted' });
  invalidateResult = async () => {};
  refreshResult = async () => {};
  queryClient = {
    getQueryState: () => cached,
    invalidateQueries: (v) => {
      calls.invalidate.push(v);
      return invalidateResult();
    },
    refetchQueries: (v) => {
      calls.refresh.push(v);
      return refreshResult();
    },
  };
  content.setSharedContent(payload(n));
  const h = mount(() => jsx(FolderPicker, props));
  h.render();
  return h;
}
const start = (h) => first(h, 'Button').onPress;
const retry = (h) => first(h, 'IconButton').onPress;
const refresh = (h) => first(h, 'RefreshControl');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('before: permission errors with cached upload permission cannot enter', async () => {
  const h = reset();
  folder.isError = true;
  syncCache();
  h.render();
  await start(h)();
  assert.equal(calls.uploads.length, 0);
  h.unmount();
});
test('before: publication before commit rejects retained batch', async () => {
  const h = reset();
  const go = start(h);
  content.setSharedContent(payload());
  await go();
  assert.equal(calls.uploads.length, 0);
  h.unmount();
});
test('before: old-account completion cannot clear native payloads', async () => {
  const h = reset(1),
    d = deferred();
  uploadResult = () => d.promise;
  const pending = start(h)();
  env = { ...env, account: { ...env.account, id: 'B' }, client: {} };
  h.render();
  d.resolve({ id: 'accepted' });
  await pending;
  assert.equal(calls.clear.length, 0);
  assert.deepEqual(calls.invalidate, [{ queryKey: ['A', 'files'] }]);
  h.unmount();
});
test('before: duplicate entry stays claimed through invalidation', async () => {
  const h = reset(1),
    d = deferred();
  invalidateResult = () => d.promise;
  const go = start(h),
    pending = go();
  await flush();
  const duplicate = go();
  await flush();
  assert.equal(calls.uploads.length, 1);
  d.resolve();
  await Promise.all([pending, duplicate]);
  h.unmount();
});
test('sequential batch preserves endpoint, invocation fields, progress and accepted completion', async () => {
  const h = reset(),
    a = deferred(),
    b = deferred();
  uploadResult = () => (calls.uploads.length === 1 ? a.promise : b.promise);
  const original = payload().files;
  const pending = start(h)();
  assert.equal(calls.uploads.length, 1);
  const [client, endpoint, f, opts] = calls.uploads[0];
  assert.equal(client, env.client);
  assert.equal(endpoint, '/api/v1/users/self/files');
  assert.deepEqual(f, original[0]);
  assert.deepEqual(opts.params, { parent_folder_id: 'root-A', on_duplicate: 'rename' });
  opts.onProgress(0.375);
  h.render();
  assert.equal(first(h, 'ProgressBar').value, 0.375);
  assert.ok(JSON.stringify(h.tree).includes('38%'));
  a.resolve({ id: 'a' });
  await flush();
  assert.equal(calls.uploads.length, 2);
  b.resolve({ id: 'b' });
  await pending;
  h.render();
  assert.equal(calls.clear.length, 1);
  assert.deepEqual(calls.clear[0], []);
  assert.equal(calls.success.length, 1);
  assert.equal(calls.announce[0], tr('completed', { folder: tr('myFiles') }));
  assert.equal(nodes(h.tree, 'IconButton').length, 0);
  opts.onProgress(0.1);
  h.render();
  assert.equal(nodes(h.tree, 'ProgressBar').length, 0);
  h.unmount();
});
test('partial success retry is synchronous, excludes accepted files and completes once', async () => {
  const h = reset();
  uploadResult = async () => {
    if (calls.uploads.length === 2) throw new CanvasNetworkError();
  };
  const go = start(h);
  await go();
  h.render();
  assert.equal(calls.error.length, 1);
  assert.equal(calls.clear.length, 0);
  const d = deferred();
  uploadResult = () => d.promise;
  const again = retry(h),
    pending = again();
  const duplicate = again();
  await go();
  assert.equal(calls.uploads.length, 3);
  assert.equal(calls.uploads[2][2].name, file(1).name);
  d.resolve({ id: 'accepted' });
  await Promise.all([pending, duplicate]);
  h.render();
  await again();
  assert.equal(calls.uploads.length, 3);
  assert.equal(calls.clear.length, 1);
  h.unmount();
});
test('all failed remains retryable; localized typed errors do not expose raw exception', async () => {
  for (const error of [
    new CanvasNetworkError(),
    new CanvasError('quota raw', 400, 'raw'),
    new CanvasError('raw', 403, 'raw'),
    new Error('secret raw'),
  ]) {
    const h = reset(1);
    uploadResult = async () => {
      throw error;
    };
    await start(h)();
    h.render();
    assert.equal(nodes(h.tree, 'IconButton').length, 1);
    assert.equal(calls.clear.length, 0);
    const english = JSON.stringify(h.tree);
    locale = 'ar';
    h.render();
    assert.notEqual(JSON.stringify(h.tree), english);
    assert.ok(!JSON.stringify(h.tree).includes('secret raw'));
    h.unmount();
  }
});
test('empty payload never reports success, including helper entry', async () => {
  const h = reset(0);
  assert.equal(nodes(h.tree, 'Button').length, 0);
  const o = new ShareFoldersOwner(
    {},
    'id',
    [],
    () => true,
    async () => calls.invalidate.push(true),
  );
  o.activate(() => true, true);
  await o.run(o.getSnapshot().epoch, () => calls.clear.push(true));
  assert.equal(calls.clear.length, 0);
  assert.equal(calls.invalidate.length, 0);
  h.unmount();
});
test('unknown, failed, locked, submission and offline permissions refuse retained handlers', async () => {
  for (const kind of ['missing', 'error', 'pending', 'unknown', 'locked', 'submission', 'offline']) {
    const h = reset();
    const go = start(h);
    if (kind === 'missing') folder.data = undefined;
    if (kind === 'error') folder.isError = true;
    if (kind === 'pending') folder.isPending = true;
    if (kind === 'unknown') folder.data.canUpload = undefined;
    if (kind === 'locked') folder.data.lockedForUser = true;
    if (kind === 'submission') folder.data.forSubmissions = true;
    if (kind === 'offline') online = false;
    syncCache();
    h.render();
    await go();
    await start(h)();
    assert.equal(calls.uploads.length, 0, kind);
    h.unmount();
  }
});
test('cache permission replacement before commit refuses start and pending continuation', async () => {
  for (const kind of ['error', 'missing', 'changed']) {
    const h = reset();
    const go = start(h);
    cached =
      kind === 'missing'
        ? undefined
        : kind === 'error'
          ? { data: folder.data, status: 'error' }
          : { data: { ...folder.data, canUpload: false }, status: 'success' };
    await go();
    assert.equal(calls.uploads.length, 0, kind);
    h.unmount();
  }
  const h = reset(),
    d = deferred();
  uploadResult = () => d.promise;
  const pending = start(h)();
  cached = { data: { ...folder.data, canUpload: false }, status: 'success' };
  d.resolve({ id: 'accepted' });
  await pending;
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.clear.length, 0);
  h.unmount();
});
test('source/account/client/folder/focus replacement suppresses old progress, next file and feedback', async () => {
  for (const kind of [
    'account',
    'client',
    'folder',
    'share',
    'same-reference',
    'mutate',
    'blur',
    'unmount',
    'permission',
  ]) {
    const h = reset(),
      d = deferred();
    uploadResult = () => d.promise;
    const pending = start(h)();
    const progress = calls.uploads[0][3].onProgress;
    if (kind === 'account') env = { ...env, account: { ...env.account, id: 'B' } };
    if (kind === 'client') env = { ...env, client: {} };
    if (kind === 'folder') {
      props = { folderId: 'other' };
      folder.data = { ...folder.data, id: 'other' };
      syncCache();
    }
    if (kind === 'share') content.setSharedContent(payload(1));
    if (kind === 'same-reference') content.setSharedContent(content.getSharedContentSnapshot().content);
    if (kind === 'mutate') content.getSharedContentSnapshot().content.files[0].uri = 'content://replacement';
    if (kind === 'blur') focused = false;
    if (kind === 'permission') {
      folder.data.canUpload = false;
      syncCache();
    }
    if (kind === 'unmount') h.unmount();
    else h.render();
    const tree = JSON.stringify(h.tree);
    progress(0.9);
    if (kind !== 'unmount') h.render();
    assert.equal(JSON.stringify(h.tree), tree, kind);
    d.resolve({ id: 'accepted' });
    await pending;
    assert.equal(calls.uploads.length, 1, kind);
    assert.equal(calls.clear.length, 0, kind);
    assert.equal(calls.announce.length, 0, kind);
    assert.deepEqual(calls.invalidate, [{ queryKey: ['A', 'files'] }], kind);
    if (kind !== 'unmount') h.unmount();
  }
});
test('publication and in-place source changes reject navigation and refresh before commit', async () => {
  for (const kind of ['new', 'same', 'aba', 'mutate']) {
    const h = reset(),
      old = content.getSharedContentSnapshot().content;
    const row = first(h, 'ListItem').onPress,
      pull = refresh(h).onRefresh;
    if (kind === 'mutate') old.files[0].name = 'different';
    else {
      content.setSharedContent(kind === 'same' ? old : payload());
      if (kind === 'aba') content.setSharedContent(old);
    }
    row();
    await pull();
    assert.equal(calls.router.length, 0);
    assert.equal(calls.refresh.length, 0);
    h.render();
    first(h, 'ListItem').onPress();
    assert.equal(calls.router.length, 1);
    h.unmount();
  }
});
test('permission restoration preserves accepted files and only retries unentered files', async () => {
  const h = reset(),
    d = deferred();
  uploadResult = () => d.promise;
  const pending = start(h)();
  folder.data = { ...folder.data, canUpload: false };
  syncCache();
  h.render();
  d.resolve({ id: 'accepted' });
  await pending;
  h.render();
  assert.equal(calls.uploads.length, 1);
  assert.equal(nodes(h.tree, 'IconButton').length, 1);
  folder.data = { ...folder.data, canUpload: true };
  syncCache();
  h.render();
  uploadResult = async () => ({ id: 'accepted2' });
  await retry(h)();
  h.render();
  assert.equal(calls.uploads.length, 2);
  assert.equal(calls.uploads[1][2].name, file(1).name);
  assert.equal(calls.clear.length, 1);
  h.unmount();
});
test('locale change relabels progress and success without restarting accepted work', async () => {
  const h = reset(1),
    d = deferred();
  uploadResult = () => d.promise;
  const pending = start(h)();
  calls.uploads[0][3].onProgress(0.4);
  locale = 'ar';
  folder = { ...folder, data: { ...folder.data } };
  syncCache();
  h.render();
  assert.equal(calls.uploads.length, 1);
  assert.ok(JSON.stringify(h.tree).includes(new Intl.NumberFormat('ar', { style: 'percent' }).format(0.4)));
  d.resolve({ id: 'accepted' });
  await pending;
  h.render();
  assert.equal(calls.clear.length, 1);
  assert.equal(calls.announce[0], tr('completed', { folder: tr('myFiles') }));
  assert.ok(JSON.stringify(h.tree).includes(load('@/features/files/kinds').formatSize(1543, 'ar')));
  h.unmount();
});
test('rejected invalidation retains success, releases gate and shows refresh issue', async () => {
  const h = reset(1);
  invalidateResult = async () => {
    throw Error('refresh raw');
  };
  await start(h)();
  h.render();
  assert.equal(calls.clear.length, 1);
  assert.equal(nodes(h.tree, 'IconButton').length, 0);
  assert.ok(JSON.stringify(h.tree).includes(tr('refreshError')));
  await refresh(h).onRefresh();
  assert.equal(calls.refresh.length, 1);
  h.unmount();
});
test('refresh rejection coalesces, releases and has no unhandled rejection', async () => {
  const h = reset(),
    d = deferred();
  refreshResult = () => d.promise;
  const pull = refresh(h).onRefresh,
    pending = pull();
  await pull();
  h.render();
  assert.equal(calls.refresh.length, 1);
  assert.equal(refresh(h).refreshing, true);
  await start(h)();
  assert.equal(calls.uploads.length, 0);
  d.reject(Error('raw refresh'));
  await pending;
  h.render();
  assert.equal(refresh(h).refreshing, false);
  assert.ok(JSON.stringify(h.tree).includes(tr('refreshError')));
  refreshResult = async () => {};
  await refresh(h).onRefresh();
  assert.equal(calls.refresh.length, 2);
  h.unmount();
});
test('completion controls are source scoped and one shot; exact routes preserved', async () => {
  const h = reset(1);
  await start(h)();
  h.render();
  const buttons = nodes(h.tree, 'Button');
  buttons[0].onPress();
  buttons[0].onPress();
  buttons[1].onPress();
  assert.deepEqual(calls.router, [
    'dismissAll',
    { pathname: '/files/folder/[folderId]', params: { folderId: 'root-A' } },
  ]);
  assert.equal(calls.leave.length, 0);
  h.unmount();
  const h2 = reset(1);
  await start(h2)();
  h2.render();
  const done = nodes(h2.tree, 'Button')[1].onPress;
  content.setSharedContent(payload());
  done();
  assert.equal(calls.leave.length, 0);
  h2.unmount();
});
test('stale error retry and completion feedback while invalidating are refused', async () => {
  const h = reset(1);
  uploadResult = async () => {
    throw Error('failure');
  };
  await start(h)();
  h.render();
  const again = retry(h);
  content.setSharedContent(payload());
  await again();
  assert.equal(calls.uploads.length, 1);
  h.unmount();
  const h2 = reset(1),
    d = deferred();
  invalidateResult = () => d.promise;
  const pending = start(h2)();
  await flush();
  content.setSharedContent(payload());
  d.resolve();
  await pending;
  assert.equal(calls.clear.length, 0);
  assert.equal(calls.success.length, 0);
  h2.unmount();
});
test('reentrant source publication at state notification refuses upload entry', async () => {
  const o = new ShareFoldersOwner(
    {},
    'id',
    [file()],
    () => current,
    async () => {},
  );
  let current = true;
  let count = 0;
  o.activate(() => true, true);
  const epoch = o.getSnapshot().epoch;
  const unsubscribe = o.subscribe(() => {
    if (o.getSnapshot().busy) current = false;
  });
  await o.run(epoch, () => count++);
  assert.equal(count, 0);
  assert.equal(o.getSnapshot().uploads[0].status, 'error');
  unsubscribe();
});
test('abandoned renders do not own actions; committed account controls remain valid', async () => {
  const h = reset(1),
    go = start(h),
    original = env;
  env = { ...env, client: {} };
  const abandoned = h.renderOnly();
  const abandonedStart = nodes(abandoned, 'Button')[0].onPress;
  h.abandon();
  env = original;
  await abandonedStart();
  assert.equal(calls.uploads.length, 0);
  await go();
  assert.equal(calls.uploads.length, 1);
  h.unmount();
});
test('effect replay and unmount retire retained controls', async () => {
  for (const kind of ['replay', 'unmount', 'blur']) {
    const h = reset(),
      go = start(h),
      row = first(h, 'ListItem').onPress,
      pull = refresh(h).onRefresh;
    if (kind === 'replay') h.replay();
    if (kind === 'unmount') h.unmount();
    if (kind === 'blur') focused = false;
    await go();
    row();
    await pull();
    assert.equal(calls.uploads.length, 0);
    assert.equal(calls.router.length, 0);
    assert.equal(calls.refresh.length, 0);
    if (kind !== 'unmount') h.unmount();
  }
});
test('old refresh rejection cannot release replacement refresh', async () => {
  const h = reset(),
    a = deferred(),
    b = deferred();
  refreshResult = () => a.promise;
  const old = refresh(h).onRefresh();
  h.render();
  env = { ...env, client: {} };
  h.render();
  refreshResult = () => b.promise;
  const current = refresh(h).onRefresh();
  h.render();
  a.reject(Error('old'));
  await old;
  h.render();
  assert.equal(refresh(h).refreshing, true);
  assert.ok(!JSON.stringify(h.tree).includes(tr('refreshError')));
  b.resolve();
  await current;
  h.render();
  assert.equal(refresh(h).refreshing, false);
  h.unmount();
});
test('late progress from a failed attempt cannot overwrite a retry', async () => {
  const h = reset(1);
  uploadResult = async () => {
    throw Error('failed');
  };
  await start(h)();
  h.render();
  const staleProgress = calls.uploads[0][3].onProgress,
    d = deferred();
  uploadResult = () => d.promise;
  const pending = retry(h)();
  calls.uploads[1][3].onProgress(0.6);
  staleProgress(0.2);
  h.render();
  assert.equal(first(h, 'ProgressBar').value, 0.6);
  d.resolve({ id: 'accepted' });
  await pending;
  h.unmount();
});
test('raw names remain raw, localized fallback titles and folder counts render in all locales', () => {
  for (const language of ['en', 'fr', 'ar']) {
    const h = reset(1);
    locale = language;
    h.render();
    assert.equal(first(h, 'StackScreen').options.title, tr('myFiles'));
    assert.equal(first(h, 'ListItem').title, 'RAW Child');
    assert.equal(first(h, 'ListItem').subtitle, tr('folders', { count: 2 }));
    assert.ok(JSON.stringify(h.tree).includes(file(0).name));
    props = { folderId: 'root-A' };
    folder.data.name = undefined;
    h.render();
    assert.equal(first(h, 'StackScreen').options.title, tr('folder'));
    h.unmount();
  }
});
test('offline paused permission reads refuse uploads but permit the adapter retry', async () => {
  const h = reset();
  folder = { ...folder, data: undefined, isError: true, isPending: false, error: Error('offline') };
  cached = { data: undefined, status: 'pending', fetchStatus: 'paused' };
  online = false;
  h.render();
  await start(h)();
  assert.equal(calls.uploads.length, 0);
  let count = 0;
  refreshResult = async () => {
    count++;
  };
  await first(h, 'LoadError').onRetry();
  assert.equal(count, 1);
  h.unmount();
});
test('reviewed catalogs preserve every baseline value and namespace additions', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'share-folders.baseline.json'), 'utf8'));
  for (const language of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + language)[language];
    for (const [key, hash] of Object.entries(baseline.catalogs[language]))
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
        hash,
        language + '/' + key,
      );
    for (const [key, value] of Object.entries(baseline.additions[language]))
      assert.deepEqual(catalog[key], value);
    locale = language;
    for (const n of [0, 1, 2, 3, 11, 102])
      for (const key of ['folders', 'prompt', 'allComplete'])
        assert.ok(!tr(key, { count: n }).includes('{count}'));
  }
});
(async () => {
  let failed = 0;
  const selected = process.env.SHARE_FOLDERS_BEFORE
    ? tests.filter(([name]) => name.startsWith('before:'))
    : tests;
  for (const [name, run] of selected) {
    try {
      await run();
    } catch (error) {
      failed++;
      console.error('FAIL ' + name + ': ' + error.stack);
    }
  }
  console.log(
    `share-folders: ${selected.length - failed}/${selected.length} groups passed (${process.env.TZ ?? 'default TZ'}); synthetic boundaries only`,
  );
  if (failed) process.exitCode = 1;
})();
