/* global __dirname */
// Run: node src/features/offline/checks/cache.check.cjs. No network or native storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../../..');
const disk = new Map();
let writes = 0;
const appListeners = new Map();
let placeholderClient;
let placeholderAccount = 'account-a';
const storage = {
  getAllKeys: async () => [...disk.keys()],
  getItem: async key => disk.get(key) ?? null,
  setItem: async (key, value) => { writes++; disk.set(key, value); },
  removeItem: async key => { disk.delete(key); },
};
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText + (file.endsWith('query.tsx') ? '\nmodule.exports.makeQueryClient = makeQueryClient;' : '');
  new Function('require', 'module', 'exports', source)(id => {
    if (id === 'expo-constants') return { expoConfig: { version: 'test' }, nativeBuildVersion: '1' };
    if (id === '@/features/sync/snapshots') return { isSyncOwned: hash => hash === 'synced' };
    if (id === '../query') return { useAccountKey: () => placeholderAccount };
    if (id === '@tanstack/react-query' && file.endsWith('cacheSeed.ts')) return { useQueryClient: () => placeholderClient };
    if (id === '@tanstack/react-query' || id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === '@tanstack/react-query-persist-client' || id === './session') return {};
    if (id === 'react-native') return { Platform: { OS: 'android' }, AppState: {
      addEventListener: (name, listener) => { appListeners.set(name, listener); return { remove() {} }; },
    } };
    if (id === 'expo-network') return { NetworkStateType: { UNKNOWN: 'unknown', NONE: 'none' },
      getNetworkStateAsync: async () => ({ type: 'wifi', isConnected: true }), addNetworkStateListener() {} };
    if (id === '@/canvas/client') return load('src/canvas/client.ts');
    if (id === '@/features/offline/connectivity') return {};
    if (id === '@/features/offline/persist') return load('src/features/offline/persist.ts');
    if (id === './client') return load('src/canvas/client.ts');
    if (id === './cacheStorage') return { cacheStorage: storage };
    if (id === './json') return load('src/features/offline/json.ts');
    throw Error('Unexpected import ' + id);
  }, module, module.exports);
  return module.exports;
}
(async () => {
  const { encodeJson, decodeJson } = load('src/features/offline/json.ts');
  const sample = { date: new Date(123), invalid: new Date(NaN), map: new Map([['a', new Date(456)]]),
    set: new Set([new Date(789)]), array: [null, true, 1, 'raw'] };
  assert.deepEqual(decodeJson(encodeJson(sample)), sample);
  const { cachePersister: p, cacheBuster, CACHE_MAX_AGE, shouldPersistQuery } = load('src/features/offline/persist.ts');
  const query = (id, time = Date.now()) => ({ queryHash: id, queryKey: [id, 'courses'],
    state: { data: sample, dataUpdatedAt: time, status: 'success' } });
  const a = query('account-a'), b = query('account-b');
  const client = queries => ({ buster: cacheBuster, timestamp: Date.now(), clientState: { mutations: [], queries } });
  disk.set('easel.query-cache', encodeJson(client([a, b])));
  disk.set('easel.query.v2:account-a', encodeJson(client([a])));
  assert.equal((await p.restoreClient()).clientState.queries.length, 2, 'interrupted legacy migration retains all queries');
  await p.persistClient(client([a, b]));
  assert(!disk.has('easel.query-cache'));
  assert.equal(writes, 2);
  await p.persistClient(client([a, b]));
  assert.equal(writes, 2, 'unchanged data must not be serialized/written');
  await Promise.all([p.persistClient(client([a, b])), p.persistClient(client([b]))]);
  assert.deepEqual((await p.restoreClient()).clientState.queries.map(q => q.queryHash), ['account-b']);
  assert(!disk.has('easel.query.v2:account-a'), 'sign-out removes account data');
  disk.set('easel.query.v2:corrupt', '{');
  disk.set('easel.query.v2:expired', encodeJson(client([query('expired', Date.now() - CACHE_MAX_AGE - 1)])));
  disk.set('easel.query.v2:busted', encodeJson({ ...client([a]), buster: 'old' }));
  assert.equal((await p.restoreClient()).clientState.queries.length, 1, 'one bad row cannot drop good data');
  assert.equal(disk.size, 1);
  assert(!shouldPersistQuery({ ...query('synced'), meta: {} }));
  assert(!shouldPersistQuery({ ...a, meta: { persist: false } }));
  await p.removeClient(); assert.equal(disk.size, 0);
  const { makeQueryClient } = load('src/canvas/query.tsx');
  const { CanvasError, CanvasNetworkError, CanvasAuthError, CanvasClient } = load('src/canvas/client.ts');
  const options = makeQueryClient().getDefaultOptions();
  const { retry, retryDelay } = options.queries;
  assert.equal(options.mutations.retry, false);
  for (const error of [new CanvasNetworkError(), ...[408, 429, 500, 503].map(status => new CanvasError('x', status, '/'))]) {
    assert(retry(0, error)); assert(retry(2, error)); assert(!retry(3, error));
  }
  for (const error of [new CanvasAuthError('/'), new Error('bug'), Object.assign(new Error(), { name: 'AbortError' }),
    ...[400, 401, 403, 404, 422].map(status => new CanvasError('x', status, '/'))]) assert(!retry(0, error));
  const originalRandom = Math.random; Math.random = () => 0.5;
  assert.equal(retryDelay(0, new CanvasNetworkError()), 400);
  assert.equal(retryDelay(2, new CanvasNetworkError()), 1600);
  assert.equal(retryDelay(20, new CanvasNetworkError()), 8000);
  assert.equal(retryDelay(0, new CanvasError('rate limited', 429, '/', 12000)), 12000);
  Math.random = originalRandom;
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('{}', { status: 429, headers: { 'Retry-After': '12' } });
  await assert.rejects(new CanvasClient('https://canvas.test', 'fake').get('/api/v1/test'), error => error.retryAfterMs === 12000);
  global.fetch = originalFetch;
  const oldTimeout = global.setTimeout, oldClearTimeout = global.clearTimeout;
  const timers = new Map(); let timerId = 0;
  global.setTimeout = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; };
  global.clearTimeout = id => timers.delete(id);
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  global.fetch = async () => { throw new CanvasNetworkError(); };
  const connectivity = load('src/features/offline/connectivity.ts');
  connectivity.startConnectivity(); await flush();
  connectivity.setProbeTarget('https://canvas.test'); connectivity.reportUnreachable('https://canvas.test');
  for (const expected of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const entry = [...timers].find(([, value]) => value.ms !== 6000);
    assert(entry); assert.equal(entry[1].ms, expected);
    timers.delete(entry[0]); entry[1].fn(); await flush();
  }
  appListeners.get('change')('active'); await flush();
  assert([...timers.values()].some(timer => timer.ms === 1000), 'foreground resets backoff');
  connectivity.reportReachable(); assert.equal(timers.size, 0);
  global.setTimeout = oldTimeout; global.clearTimeout = oldClearTimeout; global.fetch = originalFetch;
  placeholderClient = makeQueryClient();
  placeholderClient.setQueryData(['account-a', 'list', 1], [{ id: 'item', title: 'cached' }]);
  placeholderClient.setQueryData(['account-b', 'list', 1], [{ id: 'item', title: 'other account' }]);
  const { useListPlaceholder } = load('src/canvas/api/cacheSeed.ts');
  assert.equal(useListPlaceholder(['list'], list => list.find(item => item.id === 'item'))().title, 'cached');
  placeholderAccount = 'account-c';
  assert.equal(useListPlaceholder(['list'], list => list[0])(), undefined);
  placeholderClient.clear();
  console.log('PASS list placeholder selection and account isolation');
  console.log('PASS reconnect delays 1/2/4/8/16/30 seconds and foreground reset');
  console.log('PASS retry eligibility, four total attempts, jitter midpoint, cap, Retry-After and unretried mutations');
  console.log('PASS Dates/Maps/Sets, legacy migration, unchanged saves, account removal, corrupt/expired/busted rows, sync exclusion');
})();
