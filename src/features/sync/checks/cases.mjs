import assert from 'node:assert/strict';
import { CanvasClient } from '@/canvas/client';
import { fetchOfflineAsset } from '@/canvas/api/offlineAssets';
import { discoverAssets, rewriteAssetHtml, resolveAssetUrl } from '../assetHtml';
import { syncEmbeddedAssets, offlineAssetHtml, courseAssetBytes, removeCourseAssets } from '../assets';
import { syncCourse } from '../engine';
import { startSync, removeCourseSync, runAutoSync } from '../runner';
import { courseStatus, setCourseContent, setSyncSchedule, syncStatusStore } from '../settings';
import { courseSnapshotEntries, snapshotSize } from '../snapshots';
import { cleanupAccount, gateDownloads, onSnapshotWrite, diskPaths, setStoredClients } from './native.mjs';
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  assert.equal(new URL(url).origin, 'http://localhost:3030', 'Tests must never access remote data');
  return originalFetch(url, options);
};
const base = 'http://localhost:3030';
const client = new CanvasClient(base, 'dev');
const signal = () => new AbortController().signal;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const sample =
  '<img alt="Keep > this" src="fake/offline-media/image.png?x=1&amp;y=2" srcset="/fake/offline-media/image.png 1x, //localhost:3030/fake/offline-media/redirect 2x"><video poster="/fake/offline-media/image.png"><source src="/fake/offline-media/video.mp4"><track src="/fake/offline-media/captions.vtt"></video><audio src="/fake/offline-media/audio.m4a"></audio>';
assert.equal(resolveAssetUrl('../image.png?x=1&#38;y=2', base), base + '/image.png?x=1&y=2');
assert.equal(resolveAssetUrl('file:///secret', base), null);
assert.equal(resolveAssetUrl('https://user:secret@remote.test/img', base), null);
const discovered = discoverAssets(sample, base, true);
assert.equal(discovered.resources.length, 6);
assert(discoverAssets(sample, base, false).resources.every((r) => r.kind === 'image'));
assert.equal(
  discoverAssets('<script>"<img src="/bad">"</script><!-- <img src="/bad"> -->', base, true).resources.length,
  0,
);
assert.equal(
  discoverAssets('<iframe src="/tool"></iframe><source src="https://remote.test/live.m3u8">', base, true)
    .unsupported,
  2,
);
assert(
  rewriteAssetHtml(
    '<a href="/same"><img src="/same"></a>',
    base,
    () => 'data:image/png;base64,AA==',
  ).includes('href="/same"'),
);
console.log(
  'PASS discovery, entities/relative URLs, media selection, attribute-only rewrites and unsupported streams/iframes',
);

// In-memory HTTP responses only: no requests to these remote hosts.
const calls = [];
await fetchOfflineAsset(client, base + '/start', signal(), 20, async (url, options) => {
  calls.push({ url, options });
  return calls.length === 1
    ? new Response(null, { status: 302, headers: { location: 'https://cdn.invalid/image' } })
    : calls.length === 2
      ? new Response(null, { status: 302, headers: { location: base + '/back' } })
      : new Response('png', { headers: { 'content-type': 'image/png' } });
});
assert.equal(calls[0].options.headers.Authorization, 'Bearer dev');
assert.deepEqual(
  calls.slice(1).map((c) => c.options.headers),
  [{}, {}],
);
assert(calls.every((c) => c.options.redirect === 'manual' && c.options.credentials === 'omit'));
await fetchOfflineAsset(client, 'https://cdn.invalid/direct', signal(), 20, async (_url, o) => {
  assert.deepEqual(o.headers, {});
  return new Response('png', { headers: { 'content-type': 'image/png' } });
});
await assert.rejects(() =>
  fetchOfflineAsset(
    client,
    base + '/bad',
    signal(),
    2,
    async () => new Response('oversized', { headers: { 'content-type': 'image/png' } }),
  ),
);
await assert.rejects(() =>
  fetchOfflineAsset(
    client,
    base + '/login',
    signal(),
    50,
    async () => new Response('<html>login', { headers: { 'content-type': 'text/html' } }),
  ),
);
await assert.rejects(() =>
  fetchOfflineAsset(
    client,
    base + '/loop',
    signal(),
    20,
    async () => new Response(null, { status: 302, headers: { location: '/loop' } }),
  ),
);
console.log(
  'PASS credential isolation across redirects (including return to Canvas), remote initial requests, size/MIME/redirect limits',
);

const options = (accountId = 'assets', courseId = '201', html = sample) => ({
  accountId,
  courseId,
  client,
  html: new Set([html]),
  media: true,
  signal: signal(),
  canSave: () => true,
  preservePrevious: false,
  onProgress() {},
});
const cached = await syncEmbeddedAssets(options());
assert.deepEqual(cached, { skipped: 0, unsupported: 0 });
assert(courseAssetBytes('assets', '201') > 0);
const offline = offlineAssetHtml('assets', base, sample);
for (const mime of ['image/png', 'audio/mp4', 'video/mp4', 'text/vtt'])
  assert(offline.includes('data:' + mime + ';base64,'), mime);
assert(!offlineAssetHtml('other', base, sample).includes('data:image/png'));
const bytes = courseAssetBytes('assets', '201');
const partial = await syncEmbeddedAssets(options('assets', '201', '<img src="/missing-asset.png">'));
assert.equal(partial.skipped, 1);
assert.equal(courseAssetBytes('assets', '201'), bytes);
const cancel = new AbortController();
await assert.rejects(
  () =>
    syncEmbeddedAssets({
      ...options('cancel-assets'),
      signal: cancel.signal,
      onProgress() {
        cancel.abort();
      },
    }),
  { name: 'AbortError' },
);
assert(courseAssetBytes('cancel-assets', '201') > 0);
removeCourseAssets('assets', '201');
assert.equal(courseAssetBytes('assets', '201'), 0);
assert(!offlineAssetHtml('assets', base, sample).includes('data:image/png'));
console.log(
  'PASS real fake-Canvas image/audio/video/caption bytes, offline render data, account isolation, failure retention, cancellation retention and removal (native disk mocked)',
);

const account = { id: 'sync-check', baseUrl: base, user: { id: '1' } };
const all = [
  'pages',
  'files',
  'modules',
  'assignments',
  'grades',
  'syllabus',
  'announcements',
  'discussions',
  'media',
];
const result = await syncCourse(
  { id: '201', name: 'BIO', content: all },
  { account, client, queryClient: null, signal: signal(), onProgress() {} },
);
assert(result.ok);
assert(courseStatus(account.id, '201').unsupportedEmbeds >= 5);
assert(courseStatus(account.id, '201').skipped >= 5);
assert(
  courseStatus(account.id, '201').bytes >=
    snapshotSize(account.id, '201') + courseAssetBytes(account.id, '201'),
);
assert(offlineAssetHtml(account.id, base, sample).includes('data:video/mp4;base64,'));
assert(courseSnapshotEntries(account.id, '201').some((e) => e.queryKey.includes('pages')));
console.log(
  'PASS full BIO201 sync, truthful partial status for online embeds, snapshot/cache hit data and asset storage accounting',
);
const localFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  assert(!new URL(url).pathname.startsWith('/files/6004/download'), 'Reuse must not redownload bytes');
  return localFetch(url, opts);
};
const reused = await syncEmbeddedAssets(
  options(account.id, '201', '<img src="/courses/201/files/6004/preview">'),
);
assert.equal(reused.skipped, 0);
assert(
  offlineAssetHtml(account.id, base, '<img src="/courses/201/files/6004/preview">').includes(
    'data:image/jpeg;base64,',
  ),
);
globalThis.fetch = localFetch;
console.log(
  'PASS previously downloaded Canvas file reuse (course metadata reauthorized, no byte redownload)',
);

// Account removal before progress metadata: the name request is still pending.
const namesGate = deferred();
const slowClient = new CanvasClient(base, 'dev');
const realGetAll = slowClient.getAll.bind(slowClient);
slowClient.getAll = async (...args) => {
  await namesGate.promise;
  return realGetAll(...args);
};
setCourseContent('early', '201', ['pages']);
const early = startSync({ account: { ...account, id: 'early' }, client: slowClient });
await cleanupAccount('early');
namesGate.resolve();
await early;
assert.equal(courseStatus('early', '201'), null);
assert.equal(snapshotSize('early', '201'), 0);
console.log('PASS account removal before run metadata is published');

// Native worker completes despite abort. No promoted files, metadata, assets or snapshot may survive.
for (const removal of ['account', 'course']) {
  const id = 'late-' + removal;
  const gate = deferred();
  const started = deferred();
  gateDownloads(async () => {
    started.resolve();
    await gate.promise;
  });
  setCourseContent(id, '201', ['files']);
  const run = startSync({ account: { ...account, id }, client, names: new Map([['201', 'BIO']]) });
  await started.promise;
  const clean = removal === 'account' ? cleanupAccount(id) : removeCourseSync(id, '201');
  gate.resolve();
  await Promise.all([run, clean]);
  gateDownloads(null);
  assert.equal(courseStatus(id, '201'), null);
  assert.equal(snapshotSize(id, '201'), 0);
  assert.equal(courseAssetBytes(id, '201'), 0);
  assert(!diskPaths().some((p) => p.includes('/' + id + '/')));
}
console.log(
  'PASS account/course removal during four late native file workers; no file or snapshot resurrection',
);
const assetGate = deferred();
const assetStarted = deferred();
globalThis.fetch = async (url, opts) => {
  if (new URL(url).pathname === '/fake/offline-media/image.png') {
    assetStarted.resolve();
    await assetGate.promise;
    // Ignore abort to model a late networking response; commit guards must still hold.
    return localFetch(url, { ...opts, signal: undefined });
  }
  return localFetch(url, opts);
};
setCourseContent('asset-race', '201', ['pages', 'media']);
const assetRun = startSync({
  account: { ...account, id: 'asset-race' },
  client,
  names: new Map([['201', 'BIO']]),
});
await assetStarted.promise;
const assetCleanup = cleanupAccount('asset-race');
assetGate.resolve();
await Promise.all([assetRun, assetCleanup]);
globalThis.fetch = localFetch;
assert.equal(courseAssetBytes('asset-race', '201'), 0);
assert.equal(snapshotSize('asset-race', '201'), 0);
assert.equal(courseStatus('asset-race', '201'), null);
console.log(
  'PASS account removal during in-flight embedded asset response; no asset or snapshot resurrection',
);

// Removal at the synchronous snapshot boundary, including reentrant storage callbacks.
let cleaning;
onSnapshotWrite(() => {
  onSnapshotWrite(null);
  cleaning = cleanupAccount('snapshot-race');
});
await assert.rejects(
  () =>
    syncCourse(
      { id: '306', name: 'STAT', content: ['pages'] },
      {
        account: { ...account, id: 'snapshot-race' },
        client,
        queryClient: null,
        signal: signal(),
        onProgress() {},
      },
    ),
  { name: 'AbortError' },
);
await cleaning;
assert.equal(courseStatus('snapshot-race', '306'), null);
assert.equal(snapshotSize('snapshot-race', '306'), 0);
console.log('PASS removal at snapshot publication boundary');

// Removing another account must not abort this run.
setCourseContent('unrelated', '306', ['pages']);
const unaffected = startSync({
  account: { ...account, id: 'unrelated' },
  client,
  names: new Map([['306', 'STAT']]),
});
await cleanupAccount('someone-else');
await unaffected;
assert(courseStatus('unrelated', '306').syncedAt);
console.log('PASS unrelated-account cleanup leaves active sync intact');

// Online-only embeds cannot improve on immediate retries; honor the normal schedule.
const autoAccount = { ...account, id: 'auto-online-embeds' };
setCourseContent(autoAccount.id, '201', ['pages']);
setSyncSchedule('daily');
setStoredClients([{ account: autoAccount, client }]);
assert.deepEqual(await runAutoSync(), { synced: 1 });
const autoStatus = courseStatus(autoAccount.id, '201');
assert(autoStatus.unsupportedEmbeds > 0);
assert.equal(autoStatus.skipped, autoStatus.unsupportedEmbeds);
assert(syncStatusStore.get().autoSyncedAt[autoAccount.id]);
assert.deepEqual(await runAutoSync(), { synced: 0 });

// A request failure is different: it must not be recorded as a completed schedule.
const failedAccount = { ...account, id: 'auto-request-failure' };
const failedClient = new CanvasClient(base, 'dev');
const successfulGetAll = failedClient.getAll.bind(failedClient);
failedClient.getAll = (path, ...args) => {
  if (path === '/api/v1/courses/201/pages') throw Error('Simulated page-list failure');
  return successfulGetAll(path, ...args);
};
setCourseContent(failedAccount.id, '201', ['pages']);
setStoredClients([{ account: failedAccount, client: failedClient }]);
assert.deepEqual(await runAutoSync(), { synced: 0 });
assert(!syncStatusStore.get().autoSyncedAt[failedAccount.id]);
assert(courseStatus(failedAccount.id, '201').skipped >
  (courseStatus(failedAccount.id, '201').unsupportedEmbeds ?? 0));
setStoredClients([]);
setSyncSchedule('off');
console.log('PASS online-only embeds keep partial status without triggering repeated automatic sync');
console.log(
  'All OFF-3 checks passed. Filesystem/KV/session/native networking adapters mocked; HTTP bytes real only on localhost:3030. No UI/device coverage.',
);
