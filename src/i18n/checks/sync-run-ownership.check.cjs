/* global __dirname */
// Actual runner, settings, LocalStore and lifecycle. Only engine, Canvas/session,
// connectivity, native hooks and durable storage boundaries are replaced.
// The strict module allowlist and VM globals deny network/native/timer effects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function createRunnerHarness() {
  const cache = new Map(), disk = new Map(), cleanups = [], effects = [], jobs = [];
  let store;
  const state = {
    now: 2_000_000_000_000, online: true, network: 'wifi', clients: [],
    dashboard: () => Promise.resolve([]), all: () => Promise.resolve([]),
    onEngine: null, onRead: null,
  };
  const denied = () => { throw Error('Unexpected external effect'); };
  const record = (kind) => (...args) => effects.push([kind, ...args]);
  const mocks = {
    react: {
      useEffect: denied,
      useSyncExternalStore(subscribe, get) { store = { subscribe, get }; return get(); },
    },
    'react-native': { AppState: { addEventListener: denied } },
    'expo-network': {
      NetworkStateType: { WIFI: 'wifi', ETHERNET: 'ethernet' },
      getNetworkStateAsync: async () => ({ type: state.network }),
    },
    '@/canvas/api/courses': { fetchDashboardCourses: (...args) => state.dashboard(...args) },
    '@/canvas/api/tabs': { fetchAllCourses: (...args) => state.all(...args) },
    '@/canvas/session': {
      registerAccountCleanup: (fn) => cleanups.push(fn),
      loadStoredClients: async () => state.clients,
      useSession: denied,
    },
    '@/features/offline/connectivity': { isOnline: () => state.online },
    '@/features/offline/kv': { offlineKv: {
      getItemSync(k) { state.onRead?.(k); return disk.get(k) ?? null; },
      setItemSync: (k, v) => disk.set(k, v), removeItemSync: (k) => disk.delete(k),
    } },
    '@/features/files/download': { removeDownload: record('download') },
    '@/features/sync/assets': {
      removeAccountAssets: record('account-assets'), removeCourseAssets: record('course-assets'),
    },
    '@/features/sync/snapshots': {
      removeAccountSnapshots: record('account-snapshots'), removeCourseSnapshot: record('course-snapshot'),
    },
    '@/features/sync/engine': { syncCourse(course, context) {
      const work = deferred();
      const lease = load('@/features/sync/lifecycle').beginCourseSync(context.account.id, course.id, context.signal);
      const job = { course, context, work, lease };
      jobs.push(job);
      state.onEngine?.(job);
      return work.promise.finally(lease.finish);
    } },
  };
  const allowed = new Set([
    '@/features/sync/runner', '@/features/sync/settings',
    '@/features/sync/lifecycle', '@/features/offline/store',
  ]);
  function load(name, from = path.join(root, 'entry.ts')) {
    const key = name.startsWith('.') ? '@/' + path.relative(root, path.resolve(path.dirname(from), name)) : name;
    if (Object.hasOwn(mocks, key)) return mocks[key];
    assert.ok(allowed.has(key), 'Unmocked import: ' + key);
    if (cache.has(key)) return cache.get(key).exports;
    const filename = path.join(root, key.slice(2) + '.ts');
    const source = key === '@/features/sync/runner' && process.env.SYNC_RUN_OWNERSHIP_BEFORE
      ? process.env.SYNC_RUN_OWNERSHIP_BEFORE : filename;
    const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} }; cache.set(key, module);
    vm.runInNewContext(code, {
      module, exports: module.exports, require: (n) => load(n, filename),
      AbortController, Map, Set, WeakMap, Promise,
      Date: class extends Date { static now() { return state.now; } },
      fetch: denied, WebSocket: denied, XMLHttpRequest: denied, setTimeout: denied, clearTimeout: denied,
    }, { filename });
    return module.exports;
  }
  const runner = load('@/features/sync/runner');
  const settings = load('@/features/sync/settings');
  runner.useSyncRun();
  const request = (id = 'a', extra = {}) => ({
    account: { id, user: { id: 'user-' + id }, baseUrl: 'https://school.invalid' },
    client: { synthetic: id }, names: new Map([['c', 'Course C'], ['d', 'Course D']]), ...extra,
  });
  const select = (id = 'a', courses = { c: ['pages', 'files'] }) => {
    settings.syncSettingsStore.update((s) => ({ ...s, courses: { ...s.courses, [id]: courses } }));
  };
  return {
    runner, settings, state, effects, jobs, request, select,
    snapshot: () => store.get(), subscribe: (fn) => store.subscribe(fn),
    cleanup: (id) => Promise.all(cleanups.map((fn) => fn(id))),
  };
}
// Used by the existing actual-card harness for the unseen-replacement regression.
module.exports = { createRunnerHarness };

async function main() {
  let passed = 0, failed = 0;
  async function check(name, fn) {
    try { await fn(createRunnerHarness()); passed++; }
    catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
  }
  await check('synchronous first publication reserves exact duplicate promise', async (h) => {
    h.select(); h.select('b');
    let nested, entered = false;
    const off = h.subscribe(() => {
      if (h.snapshot() && !entered) { entered = true; nested = h.runner.startSync(h.request('b')); }
    });
    const promise = h.runner.startSync(h.request());
    off();
    assert.equal(nested, promise);
    assert.equal(h.jobs.length, 1);
    assert.equal(h.jobs[0].context.account.id, 'a');
    assert.equal(h.runner.startSync(h.request()), promise);
    h.jobs[0].work.resolve({ ok: true }); await promise;
    assert.equal(h.snapshot(), null);
  });
  await check('admission precedes synchronous storage/name/engine boundaries', async (h) => {
    h.select(); h.settings.syncSettingsStore.reload();
    const duplicates = [];
    h.state.onRead = () => { h.state.onRead = null; duplicates.push(h.runner.startSync(h.request())); };
    h.state.dashboard = () => { duplicates.push(h.runner.startSync(h.request())); return Promise.resolve([]); };
    h.state.onEngine = () => { h.state.onEngine = null; duplicates.push(h.runner.startSync(h.request())); };
    const p = h.runner.startSync(h.request('a', { names: undefined }));
    await flush();
    assert.equal(duplicates.length, 3);
    for (const duplicate of duplicates) assert.equal(duplicate, p);
    h.jobs[0].work.resolve({ ok: true }); await p;
  });
  await check('opaque identity rejects clones, forged values, equal times and A→B→A', async (h) => {
    h.select(); h.select('b');
    const a = h.runner.startSync(h.request());
    const old = h.snapshot();
    for (const fake of [{ ...old }, JSON.parse(JSON.stringify(old)), Object.create(old), null, undefined]) {
      assert.equal(h.runner.cancelSyncRun(fake), false);
      assert.equal(h.jobs[0].context.signal.aborted, false);
    }
    h.jobs[0].work.resolve({ ok: true }); await a;
    for (const account of ['b', 'a']) {
      const p = h.runner.startSync(h.request(account));
      const next = h.snapshot();
      assert.equal(next.startedAt, old.startedAt);
      assert.equal(h.runner.cancelSyncRun(old), false);
      assert.equal(h.jobs.at(-1).context.signal.aborted, false);
      assert.equal(h.runner.cancelSyncRun(next), true);
      assert.equal(h.runner.cancelSyncRun(next), false);
      h.jobs.at(-1).work.resolve({ ok: true }); await p;
    }
  });
  await check('same-run earlier progress snapshot remains a valid capability', async (h) => {
    h.select();
    const p = h.runner.startSync(h.request());
    const first = h.snapshot(), job = h.jobs[0];
    const progress = { step: 'raw', done: 1, total: 4, bytes: 0 };
    job.context.onProgress(progress);
    assert.notEqual(h.snapshot(), first);
    assert.equal(h.snapshot().progress, progress);
    assert.equal(h.runner.cancelSyncRun(first), true);
    const cancelled = h.snapshot();
    job.context.onProgress({ ...progress, done: 2 });
    assert.equal(h.snapshot(), cancelled, 'cancelled callbacks must not publish');
    job.work.resolve({ ok: true }); await p;
  });
  await check('global cancellation before first publication keeps admission until settlement', async (h) => {
    h.select();
    const names = deferred(); let signal;
    h.state.dashboard = (_, s) => { signal = s; return names.promise; };
    const p = h.runner.startSync(h.request('a', { names: undefined }));
    assert.equal(h.snapshot(), null);
    h.runner.cancelSync();
    assert.equal(signal.aborted, true);
    assert.equal(h.runner.startSync(h.request('b')), p);
    names.resolve([]); await p;
    assert.equal(h.jobs.length, 0);
    assert.equal(h.snapshot(), null);
  });
  await check('cancellation synchronously from first publication prevents engine entry', async (h) => {
    h.select();
    let accepted;
    h.subscribe(() => { if (h.snapshot()) accepted = h.runner.cancelSyncRun(h.snapshot()); });
    await h.runner.startSync(h.request());
    assert.equal(accepted, true);
    assert.equal(h.jobs.length, 0);
    assert.equal(h.snapshot(), null);
  });
  await check('unpublished replacement rejects old capability and original-account cleanup', async (h) => {
    h.select(); h.select('b');
    const p = h.runner.startSync(h.request());
    const old = h.snapshot();
    h.jobs[0].work.resolve({ ok: true }); await p;
    const names = deferred(); let signal;
    h.state.dashboard = (_, s) => { signal = s; return names.promise; };
    const next = h.runner.startSync(h.request('b', { names: undefined }));
    assert.equal(h.snapshot(), null);
    assert.equal(h.runner.cancelSyncRun(old), false);
    await h.cleanup('a');
    assert.equal(signal.aborted, false);
    await h.cleanup('b');
    assert.equal(signal.aborted, true, 'cleanup owns admission before metadata is published');
    names.resolve([]); await next;
    assert.equal(h.jobs.length, 1);
    assert.equal(h.snapshot(), null);
  });
  await check('finalization can admit replacement without erasing its promise/controller/current', async (h) => {
    h.select(); h.select('b');
    const firstPromise = h.runner.startSync(h.request());
    const firstRun = h.snapshot(), old = h.jobs[0];
    let nextPromise;
    const off = h.subscribe(() => {
      if (!h.snapshot() && !nextPromise) nextPromise = h.runner.startSync(h.request('b'));
    });
    old.work.resolve({ ok: true }); await firstPromise;
    off();
    const nextRun = h.snapshot(), nextJob = h.jobs[1];
    assert.equal(nextRun.accountId, 'b');
    assert.equal(h.runner.startSync(h.request()), nextPromise);
    old.context.onProgress({ step: 'late old callback', done: 9, total: 10 });
    assert.equal(h.snapshot(), nextRun);
    assert.equal(h.runner.cancelSyncRun(firstRun), false);
    assert.equal(nextJob.context.signal.aborted, false);
    h.runner.cancelSync();
    assert.equal(nextJob.context.signal.aborted, true);
    nextJob.work.resolve({ ok: true }); await nextPromise;
    old.context.onProgress({ step: 'after all finalizers' });
    assert.equal(h.snapshot(), null);
  });
  await check('exact selection, ordering, request objects, names, default reason and no-op', async (h) => {
    let notifications = 0;
    h.subscribe(() => notifications++);
    const noop = h.runner.startSync(h.request());
    assert.equal(notifications, 0); assert.equal(h.jobs.length, 0);
    h.select('a', { c: ['files', 'pages'], d: ['grades'], empty: [] });
    const req = h.request('a', { courseIds: ['empty', 'd', 'missing', 'c'] });
    const p = h.runner.startSync(req);
    assert.notEqual(p, noop, 'a no-selection request releases admission before returning');
    await noop;
    assert.equal(h.snapshot().reason, 'manual');
    assert.equal(JSON.stringify(h.snapshot().courses), JSON.stringify([{ id: 'd', name: 'Course D' }, { id: 'c', name: 'Course C' }]));
    assert.equal(h.jobs[0].context.account, req.account);
    assert.equal(h.jobs[0].context.client, req.client);
    assert.equal(h.jobs[0].context.queryClient, null);
    assert.equal(JSON.stringify(h.jobs[0].course), JSON.stringify({ id: 'd', name: 'Course D', content: ['grades'] }));
    h.jobs[0].work.resolve({ ok: true }); await flush();
    assert.equal(JSON.stringify(h.jobs[1].course.content), JSON.stringify(['files', 'pages']));
    h.jobs[1].work.resolve({ ok: true }); await p;
    h.state.all = async () => [{ id: 'c', name: 'All C' }, { id: 'd', name: 'All D' }];
    h.state.dashboard = async () => [{ id: 'c', name: 'Dashboard C' }];
    const named = h.runner.startSync(h.request('a', { names: undefined, courseIds: ['c', 'd'] }));
    await flush();
    assert.equal(h.jobs[2].course.name, 'Dashboard C');
    h.jobs[2].work.resolve({ ok: false, error: 'school couldn’t be reached' }); await named;
    assert.equal(h.jobs.length, 3, 'network stop skips later courses');
  });
  await check('course removal preserves original IDs, immediate/deferred clearing and skip', async (h) => {
    h.select('a', { c: ['pages'], d: ['files'] }); h.select('b');
    const status = { fileIds: ['old'], syncedAt: 1, bytes: 0, skipped: 0, error: null };
    h.settings.setCourseStatus('a', 'c', status);
    const p = h.runner.startSync(h.request());
    const remove = h.runner.removeCourseSync('a', 'c');
    assert.equal(h.jobs[0].lease.removed, true);
    assert.equal(h.jobs[0].context.signal.aborted, false, 'removal is course-scoped');
    assert.equal(h.settings.courseStatus('a', 'c'), null);
    assert.deepEqual(h.effects, [['course-assets', 'a', 'c'], ['course-snapshot', 'a', 'c']]);
    h.settings.setCourseStatus('a', 'c', { ...status, fileIds: ['late'] });
    await h.runner.removeCourseSync('a', 'd');
    h.jobs[0].work.reject(Error('removed')); await Promise.all([p, remove]);
    assert.equal(h.jobs.length, 1, 'pending removed course must be skipped');
    assert.ok(h.effects.some((e) => JSON.stringify(e) === JSON.stringify(['download', 'a', 'old', 'kept'])));
    assert.ok(h.effects.some((e) => JSON.stringify(e) === JSON.stringify(['download', 'a', 'late', 'kept'])));
    assert.equal(h.settings.courseStatus('a', 'c'), null);
    assert.ok(h.effects.every((e) => e[1] === 'a'));
  });
  await check('original-account cleanup cannot abort replacement; legacy global cancel can', async (h) => {
    h.select(); h.select('b');
    const p = h.runner.startSync(h.request());
    let replacement;
    const off = h.subscribe(() => {
      if (!h.snapshot() && !replacement) replacement = h.runner.startSync(h.request('b'));
    });
    const cleanup = h.cleanup('a');
    assert.equal(h.jobs[0].context.signal.aborted, true);
    h.jobs[0].work.resolve({ ok: true }); await Promise.all([p, cleanup]); off();
    assert.equal(h.snapshot().accountId, 'b');
    assert.equal(h.jobs[1].context.signal.aborted, false);
    await h.cleanup('a');
    assert.equal(h.jobs[1].context.signal.aborted, false);
    assert.ok(h.effects.every((e) => e[1] === 'a'));
    assert.equal(h.settings.syncedCourses('a').c, undefined);
    assert.ok(h.settings.syncedCourses('b').c);
    h.runner.cancelSync(); assert.equal(h.jobs[1].context.signal.aborted, true);
    h.jobs[1].work.resolve({ ok: true }); await replacement;
  });
  await check('automatic scheduling, partial coverage success and manual exclusion preserved', async (h) => {
    h.select(); h.state.clients = [h.request()];
    assert.equal((await h.runner.runAutoSync()).synced, 0);
    h.settings.syncSettingsStore.update((s) => ({ ...s, schedule: 'daily' }));
    h.state.network = 'cellular'; assert.equal((await h.runner.runAutoSync()).synced, 0);
    h.state.network = 'wifi';
    const manual = h.runner.startSync(h.request());
    assert.equal((await h.runner.runAutoSync()).synced, 0);
    h.jobs[0].work.resolve({ ok: true }); await manual;
    const auto = h.runner.runAutoSync(); await flush();
    assert.equal(h.snapshot().reason, 'auto');
    h.settings.setCourseStatus('a', 'c', { syncedAt: h.state.now, bytes: 0, fileIds: [], skipped: 2, unsupportedEmbeds: 2, error: null });
    h.jobs[1].work.resolve({ ok: true });
    assert.equal((await auto).synced, 1);
    assert.equal(h.settings.syncStatusStore.get().autoSyncedAt.a, h.state.now);
    assert.equal((await h.runner.runAutoSync()).synced, 0);
    h.state.now += 24 * 60 * 60_000;
    const failed = h.runner.runAutoSync(); await flush();
    h.jobs[2].work.resolve({ ok: false, error: 'failed' });
    assert.equal((await failed).synced, 0, 'old status cannot count as a new success');
  });
  console.log(`Sync runner ownership: ${passed} passed, ${failed} failed (${process.env.TZ ?? 'default TZ'})`);
  if (failed) process.exitCode = 1;
}
if (require.main === module) {
  let completed = false;
  process.once('beforeExit', () => {
    if (!completed) { console.error('FAIL suite exited with an unsettled test'); process.exitCode = 1; }
  });
  main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { completed = true; });
}
