/* global __dirname */
/* Run: node src/features/submissions/draftSync.check.cjs
 * Real TS client + draft handler + queue + localhost:3030 HTTP. Expo filesystem
 * and SQLite adapters use a temporary directory; React hooks/connectivity/timers
 * are controlled fakes. This is NOT device or OS-background coverage. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'easel-draft-check-'));
const disk = path.join(scratch, 'documents');
const kvfile = path.join(scratch, 'kv.json');
let online = false, effects = [], accountClients = [], cleanups = [], connectivityListeners = [];
let intercept = null;
const receipts = [];
const originalFetch = global.fetch;
global.fetch = async (url, opts) => {
  assert.ok(String(url).startsWith('http://localhost:3030/'), 'no real-school requests');
  if (opts?.method && opts.method !== 'GET') {
    assert.equal(new URL(url).pathname, '/api/graphql', 'autosync only uses GraphQL');
    const b = JSON.parse(opts.body); receipts.push(b);
    assert.ok(['EaselSubmissionDraft', 'EaselSaveSubmissionDraft', 'EaselDeleteSubmissionDraft'].includes(b.operationName));
    assert.doesNotMatch(b.query, /createSubmission\(|createSubmissionComment|sendMessage/);
    if (intercept) { const result = await intercept(b); if (result) return result; }
  }
  return originalFetch(url, opts);
};
const uri = (parts) => path.join(...parts.map((p) => typeof p === 'string' ? p : p.uri));
class Directory {
  constructor(...parts) { this.uri = uri(parts); }
  get exists() { return fs.existsSync(this.uri); }
  create() { fs.mkdirSync(this.uri, { recursive: true }); }
  delete() { fs.rmSync(this.uri, { recursive: true, force: true }); }
}
class File {
  constructor(...parts) { this.uri = uri(parts); }
  get exists() { return fs.existsSync(this.uri); }
  textSync() { return fs.readFileSync(this.uri, 'utf8'); }
  writeSync(v) { fs.writeFileSync(this.uri, v); }
  delete() { fs.rmSync(this.uri, { force: true }); }
}
const kv = {
  read: () => fs.existsSync(kvfile) ? JSON.parse(fs.readFileSync(kvfile, 'utf8')) : {},
  getItemSync(k) { return this.read()[k] ?? null; },
  setItemSync(k, v) { fs.writeFileSync(kvfile, JSON.stringify({ ...this.read(), [k]: v })); },
  removeItemSync(k) { const s = this.read(); delete s[k]; fs.writeFileSync(kvfile, JSON.stringify(s)); },
};
function runtime() {
  const modules = new Map(); cleanups = []; effects = []; connectivityListeners = [];
  const mocks = {
    // Presentation-only boundary; existing behavior assertions remain English.
    '@/i18n': { useTranslation: () => ({ t: load('@/i18n/runtime').createTranslator('en') }) },
    react: { useEffect: (fn) => effects.push(fn), useSyncExternalStore: (_, get) => get() },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-crypto': { randomUUID: crypto.randomUUID },
    'expo-file-system': { File, Directory, Paths: { document: disk } },
    '@/canvas/session': { registerAccountCleanup: fn => cleanups.push(fn), loadStoredClients: async () => accountClients },
    '@/features/offline/kv': { offlineKv: kv },
    '@/features/offline/connectivity': { isOnline: () => online, noteRequestError() {}, reportReachable() {}, connectivity: { subscribe: fn => { connectivityListeners.push(fn); return () => {}; } } },
    '@/features/offline/useOnline': { useOnline: () => online },
  };
  const load = (name, parent = root) => {
    let key = name;
    if (name.startsWith('.')) key = '@/' + path.relative(root, path.resolve(path.dirname(parent), name));
    if (key in mocks) return mocks[key];
    if (!key.startsWith('@/')) throw Error('Unmocked ' + key);
    const filename = path.join(root, key.slice(2)) + '.ts';
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', js)(n => load(n, filename), module, module.exports, () => 1, () => {});
    return module.exports;
  };
  const state = load('@/features/submissions/draftState');
  const sync = load('@/features/offline/submissionDrafts');
  const queue = load('@/features/offline/queue');
  const api = load('@/canvas/api/submissionDrafts');
  const clientModule = load('@/canvas/client');
  return { load, state, sync, queue, api, clientModule };
}
const tick = () => new Promise(r => setImmediate(r));
const response = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const settleEffects = async () => { effects.splice(0).forEach(fn => fn()); await tick(); };
async function flush(r) {
  r.queue.queueStore.update(list => list.map(w => ({ ...w, nextAttemptAt: 0 })));
  return r.queue.flushQueue();
}
(async () => {
  let r = runtime();
  const client = new r.clientModule.CanvasClient('http://localhost:3030', 'dev');
  accountClients = [{ account: { id: 'a' }, client }, { account: { id: 'b' }, client }];
  const assignments = await client.get('/api/v1/courses/201/assignments', { include: ['submission'], per_page: 100 });
  let selected;
  for (const a of assignments.filter(a => !a.locked_for_user && a.submission_types.includes('online_text_entry'))) {
    const draft = await r.api.fetchSubmissionDraft(client, a.submission.id);
    if (!draft.submissionDraft) { selected = a; break; }
  }
  assert.ok(selected, 'an unlocked fake assignment with no draft');
  const target = { accountId: 'a', courseId: '201', assignmentId: selected.id, submissionId: selected.submission.id, attempt: (selected.submission.attempt ?? 0) + 1 };
  const before = await client.get(`/api/v1/courses/201/assignments/${selected.id}/submissions/self`);
  const save = (t, text, kind = 'text') => {
    r.state.editDraft(t, kind, text, kind === 'text' ? { activeSubmissionType: 'online_text_entry', body: text } : { activeSubmissionType: 'online_url', url: text });
    r.sync.queueDraft(t, kind);
  };
  save(target, 'older'); save(target, 'offline latest');
  assert.equal(r.queue.pendingWrites().length, 1, 'coalesced');
  await flush(r); assert.equal(r.state.readDraftDocument(target).records.text.status, 'waiting');
  assert.equal((await r.api.fetchSubmissionDraft(client, target.submissionId)).submissionDraft, null);
  r.queue.queueStore.update(list => list.map(w => ({ ...w, status: 'running' })));
  r = runtime(); // Actual serialized queue + document reloaded, no in-memory carry-over.
  assert.equal(r.state.readDraftDocument(target).records.text.value, 'offline latest');
  assert.equal(r.queue.pendingWrites()[0].status, 'pending', 'interrupted queue entry recovered');
  online = true; await flush(r);
  assert.equal((await r.api.fetchSubmissionDraft(client, target.submissionId)).submissionDraft.body, 'offline latest');
  assert.equal(r.state.readDraftDocument(target).records.text.status, 'synced');
  console.log('PASS offline coalescing, restart durability, reconnect draft-only replay');
  save(target, 'https://example.test/draft', 'url'); await flush(r);
  assert.equal((await r.api.fetchSubmissionDraft(client, target.submissionId)).submissionDraft.url, 'https://example.test/draft');
  const after = await client.get(`/api/v1/courses/201/assignments/${selected.id}/submissions/self`);
  for (const key of ['attempt', 'workflow_state', 'submitted_at', 'body', 'url', 'submission_comments']) assert.deepEqual(after[key], before[key]);
  assert.ok(receipts.filter(r => r.operationName === 'EaselSaveSubmissionDraft').every(r => r.variables.input.attempt === target.attempt));
  console.log('PASS URL payload, explicit attempt, unchanged submission workflow/content/comments');
  const uploadContent = { activeSubmissionType: 'online_upload', fileIds: ['7990'] };
  r.state.editDraft(target, 'online_upload', 'uploaded file', uploadContent); r.sync.queueDraft(target, 'online_upload'); await flush(r);
  assert.equal(r.state.readDraftDocument(target).records.online_upload.status, 'synced');
  r.state.editDraft(target, 'media_recording', 'uploaded media', { activeSubmissionType: 'media_recording', mediaId: 'm-fake6009' });
  r.sync.queueDraft(target, 'media_recording'); await flush(r);
  assert.equal(r.state.readDraftDocument(target).records.media_recording.status, 'synced');
  console.log('PASS already-uploaded file/media ID draft payloads (no upload requests)');
  // Delayed remote restore cannot overwrite typing, empty edits, another account, or discard.
  const isolated = { ...target, accountId: 'restore' };
  const g = r.state.readDraftDocument(isolated).generation;
  r.state.editDraft(isolated, 'text', 'typing');
  assert.equal(r.state.restoreDraft(isolated, 'text', g, 'remote'), false);
  r.state.editDraft(isolated, 'url', '');
  assert.equal(r.state.restoreDraft(isolated, 'url', g, 'remote URL'), false);
  const other = { ...target, accountId: 'b' };
  assert.equal(r.state.readDraftDocument(other).records.text, undefined);
  assert.equal(r.state.restoreDraft(other, 'text', r.state.readDraftDocument(other).generation, 'remote b'), true);
  const otherAttempt = { ...target, attempt: target.attempt + 1 };
  assert.equal(r.state.readDraftDocument(otherAttempt).records.text, undefined);
  console.log('PASS restore compare-and-set, empty edits, account and attempt isolation');
  // Delay an in-flight save. Discard must be behind it, and a new edit behind discard.
  let release, entered;
  let gate = new Promise(resolve => { entered = resolve; });
  intercept = async b => { if (b.operationName === 'EaselSaveSubmissionDraft') { entered(); await new Promise(resolve => { release = resolve; }); } };
  save(target, 'in flight'); const running = flush(r); await gate;
  r.sync.discardSubmissionDraft(target);
  intercept = null; release(); await running; await flush(r);
  assert.equal((await r.api.fetchSubmissionDraft(client, target.submissionId)).submissionDraft, null);
  assert.equal(r.state.restoreDraft(target, 'text', g, 'late'), false);
  save(target, 'new after discard'); await flush(r);
  assert.equal((await r.api.fetchSubmissionDraft(client, target.submissionId)).submissionDraft.body, 'new after discard');
  console.log('PASS in-flight save/discard ordering and later new draft');
  gate = new Promise(resolve => { entered = resolve; });
  intercept = async b => { if (b.operationName === 'EaselSaveSubmissionDraft') { entered(); await new Promise(resolve => { release = resolve; }); } };
  save(target, 'older request'); const olderRun = flush(r); await gate;
  save(target, 'typing during request'); intercept = null; release(); await olderRun;
  assert.equal(r.state.readDraftDocument(target).records.text.status, 'waiting', 'old acknowledgement cannot mark newer text synced');
  await flush(r);
  assert.equal((await r.api.fetchSubmissionDraft(client, target.submissionId)).submissionDraft.body, 'typing during request');
  console.log('PASS older in-flight save versus newer typing');
  // Successful explicit submit consumes local generation while a save is in flight.
  gate = new Promise(resolve => { entered = resolve; });
  intercept = async b => { if (b.operationName === 'EaselSaveSubmissionDraft') { entered(); await new Promise(resolve => { release = resolve; }); } };
  save(target, 'consumed in flight'); const consumedRun = flush(r); await gate;
  r.state.consumeDraft(target); intercept = null; release(); await consumedRun;
  assert.equal(r.state.readDraftDocument(target).consumed, true);
  assert.deepEqual(r.state.readDraftDocument(target).records, {});
  save(target, 'must not recreate'); await flush(r);
  assert.deepEqual(r.state.readDraftDocument(target).records, {});
  console.log('PASS consumed draft suppresses late acknowledgement and later editor saves');
  await r.api.deleteSubmissionDraft(client, target.submissionId);
  await r.api.deleteSubmissionDraft(client, target.submissionId); // no drafts found is a no-op
  // Server attempt advanced: preflight must keep local text and send no create mutation.
  const stale = { ...target, accountId: 'b', attempt: target.attempt + 5 };
  save(stale, 'preserve earlier work'); await flush(r);
  assert.equal(r.state.readDraftDocument(stale).records.text.status, 'stale');
  assert.equal((await r.api.fetchSubmissionDraft(client, target.submissionId)).submissionDraft, null);
  // HTTP 200 GraphQL errors and validation payload errors preserve the local draft.
  for (const body of [{ data: null, errors: [{ message: 'GraphQL is unavailable' }] },
    { data: { createSubmissionDraft: { submissionDraft: null, errors: [{ message: 'not authorized' }] } } }]) {
    intercept = b => (b.operationName === 'EaselSaveSubmissionDraft' || body.errors) ? response(body) : null;
    save(other, 'denied but safe'); await flush(r);
    assert.equal(r.state.readDraftDocument(other).records.text.value, 'denied but safe');
    assert.equal(r.state.readDraftDocument(other).records.text.status, 'unavailable');
  }
  intercept = null;
  // Network errors retain a retry, and recovery sends only the latest revision.
  intercept = b => { if (b.operationName === 'EaselSubmissionDraft') throw new TypeError('offline'); };
  save(other, 'network retry'); await flush(r);
  assert.ok(r.queue.pendingWrites('b').some(w => w.status === 'retrying'));
  intercept = null; save(other, 'latest retry'); await flush(r);
  assert.equal((await r.api.fetchSubmissionDraft(client, target.submissionId)).submissionDraft.body, 'latest retry');
  await r.api.deleteSubmissionDraft(client, target.submissionId);
  // Local comments never enqueue; switching hook scope reads the correct document immediately.
  const drafts = r.load('@/features/submissions/drafts');
  const comment = drafts.useDraft('a', '201', selected.id, 'comment', undefined, { attempt: 77 });
  comment.setValue('unsent comment');
  assert.equal(r.queue.pendingWrites('a').length, 0);
  assert.equal(drafts.useDraft('b', '201', selected.id, 'comment', undefined, { attempt: 77 }).value, '');
  const again = drafts.useDraft('a', '201', selected.id, 'comment', undefined, { attempt: 77 });
  assert.equal(again.value, 'unsent comment'); assert.match(again.statusLabel, /Saved on device/);
  // Account removal while fetch is awaiting cannot recreate either local content or queue entries.
  gate = new Promise(resolve => { entered = resolve; });
  intercept = async b => { if (b.operationName === 'EaselSubmissionDraft') { entered(); await new Promise(resolve => { release = resolve; }); } };
  save(other, 'remove account'); const cleanupRun = flush(r); await gate;
  cleanups.forEach(fn => fn('b')); intercept = null; release(); await cleanupRun;
  assert.equal(r.queue.pendingWrites('b').length, 0);
  assert.deepEqual(r.state.readDraftDocument(other).records, {});
  assert.equal((await r.api.fetchSubmissionDraft(client, target.submissionId)).submissionDraft, null);
  console.log('PASS stale attempt, GraphQL refusal, retry, local-only comments, account switch and in-flight cleanup');
  // Hook recovery when assignment metadata arrived after the first local edit.
  const lateId = { ...target, accountId: 'a', attempt: target.attempt + 9, submissionId: undefined };
  save(lateId, 'metadata arrived later');
  assert.equal(r.state.readDraftDocument(lateId).records.text.status, 'device');
  drafts.useDraft('a', target.courseId, target.assignmentId, 'text', undefined, { attempt: lateId.attempt, submissionId: target.submissionId });
  await settleEffects();
  assert.ok(r.queue.pendingWrites('a').some(w => w.payload.target.attempt === lateId.attempt));
  // A real Canvas-compatible fake query hides drafts saved for already-consumed attempts.
  const submitted = assignments.find(a => a.submission?.attempt > 0 && !a.locked_for_user);
  assert.ok(submitted);
  const submittedRemote = await r.api.fetchSubmissionDraft(client, submitted.submission.id);
  if (!submittedRemote.submissionDraft) {
    await r.api.saveSubmissionDraft(client, submitted.submission.id, submitted.submission.attempt,
      { activeSubmissionType: 'online_text_entry', body: 'old consumed attempt' });
    assert.equal((await r.api.fetchSubmissionDraft(client, submitted.submission.id)).submissionDraft, null);
    await r.api.deleteSubmissionDraft(client, submitted.submission.id);
  }
  console.log('PASS late submission ID recovery and server query hiding an old explicit attempt');
  console.log('PASS all checks. Native storage, React scheduling and connectivity mocked; HTTP uses real local fake Canvas only.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; fs.rmSync(scratch, { recursive: true, force: true }); });
