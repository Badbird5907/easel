/** Production session/client regression; all native persistence and network are in-memory fakes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(`${root}/package.json`);
const { build } = require('esbuild');
const id = 'example.test_1';
const initialAccount = {
  id, host: 'example.test', baseUrl: 'https://example.test',
  user: { id: '1', name: 'Test', shortName: 'Test', avatarUrl: null },
  authMethod: 'oauth', addedAt: '2026-01-01',
};
const oldCredentials = {
  accessToken: 'synthetic-old', refreshToken: 'synthetic-refresh-old',
  expiresAt: null, issuedAt: null, clientId: 'test-key', clientSecret: null,
};

async function harness({ locked = false, unavailableIndex = false, empty = false } = {}) {
  const storage = new Map([['easel.accounts', JSON.stringify({ accounts: [initialAccount], activeId: id })]]);
  const secure = new Map([['easel.token.example.test_1', JSON.stringify(oldCredentials)]]);
  const kv = new Map();
  if (empty) { storage.set('easel.accounts', JSON.stringify({ accounts: [], activeId: null })); secure.clear(); }
  const control = { storage, secure, kv, locked, unavailableIndex, reads: [], sets: [], deletes: [], browser: [] };
  globalThis.__sessionReview = control;
  globalThis.fetch = async () => { throw Error('Unexpected synthetic transport'); };
  const stubs = {
    '@react-native-async-storage/async-storage': `export default {
      getItem: async k => {
        await globalThis.__sessionReview.beforeIndexRead?.();
        if (globalThis.__sessionReview.unavailableIndex) throw Error('Synthetic unavailable index');
        return globalThis.__sessionReview.storage.get(k) ?? null;
      },
      setItem: async (k,v) => { await globalThis.__sessionReview.beforeIndexWrite?.(k,v); globalThis.__sessionReview.storage.set(k,v); }
    };`,
    'expo-secure-store': `export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'test';
      export const getItemAsync = async k => {
        globalThis.__sessionReview.reads.push(k);
        if (globalThis.__sessionReview.readSecure) return globalThis.__sessionReview.readSecure(k);
        if (globalThis.__sessionReview.locked) throw Error('Synthetic locked keychain');
        return globalThis.__sessionReview.secure.get(k) ?? null;
      };
      export const setItemAsync = async(k,v,options) => {
        globalThis.__sessionReview.sets.push({ k,v,options });
        await globalThis.__sessionReview.beforeSecureWrite?.(k,v);
        globalThis.__sessionReview.secure.set(k,v);
      };
      export const deleteItemAsync = async k => { globalThis.__sessionReview.deletes.push(k); globalThis.__sessionReview.secure.delete(k); };`,
    'expo-web-browser': `export const openAuthSessionAsync = async (...args) => { globalThis.__sessionReview.browser.push(args); return { type: 'cancel' }; };`,
    '@/features/notifications/storage': `
      export const readJson = k => globalThis.__sessionReview.kv.get(k) ?? null;
      export const writeJson = (k,v) => { globalThis.__sessionReview.kv.set(k,v); };
      export const removeKey = k => { globalThis.__sessionReview.kv.delete(k); };`,
  };
  const result = await build({
    stdin: { contents: `export * from './src/canvas/session.tsx';`, resolveDir: root, sourcefile: 'review-entry.ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false, tsconfig: `${root}/tsconfig.json`,
    plugins: [{ name: 'controlled-native-boundaries', setup(b) {
      b.onResolve({ filter: /^(?:@react-native-async-storage\/async-storage|expo-secure-store|expo-web-browser|@\/features\/notifications\/storage)$/ }, a => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'js' }));
      b.onLoad({ filter: /src\/canvas\/session\.tsx$/ }, a => ({
        contents: readFileSync(a.path, 'utf8') + '\nexport const reviewInternals = { addAccount, signOutAccount, switchAccount, getSnapshot, subscribe, queueCredentialWrite, loadMissingCredentials, saveIntents, replacingCredentials, removalReservations, removingAccounts };',
        loader: 'tsx',
      }));
    }}],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return { session: module.exports, storage, secure, control };
}

async function oldRefreshAfterReauthentication(outcome) {
  const { session, storage, secure } = await harness();
  let beginRefresh;
  const refreshStarted = new Promise(resolve => { beginRefresh = resolve; });
  let endRefresh;
  let apiRequests = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/login/oauth2/token') && options.method === 'POST') {
      beginRefresh();
      return await new Promise(resolve => { endRefresh = resolve; });
    }
    if (options.method === 'DELETE') return new Response('{}', { status: 200 });
    if (apiRequests++ > 0) return new Response('{"ok":true}', { status: 200 });
    return new Response('{"errors":[{"message":"Invalid access token"}]}', {
      status: 401, headers: { 'WWW-Authenticate': 'Bearer' },
    });
  };
  const [{ client: oldClient }] = await session.loadStoredClients();
  const pending = oldClient.get('/api/test').catch(error => error.name);
  await refreshStarted;
  await session.markAccountExpired(id);
  await session.reviewInternals.addAccount({
    account: { ...initialAccount },
    credentials: { ...oldCredentials, accessToken: 'synthetic-new', refreshToken: 'synthetic-refresh-new' },
    client: oldClient,
  });
  const [{ client: newClient }] = await session.loadStoredClients();
  assert.equal(session.isStoredAccountClient(id, newClient), true, 'newly authenticated client must start valid');
  endRefresh(outcome === 'rejection'
    ? new Response('{"error":"invalid_grant"}', { status: 400 })
    : new Response('{"access_token":"synthetic-stale-rotated","refresh_token":"synthetic-stale-refresh","expires_in":3600}', { status: 200 }));
  await pending;
  const expired = !!JSON.parse(storage.get('easel.accounts')).accounts[0].expired;
  const persistedToken = JSON.parse(secure.get('easel.token.example.test_1')).accessToken;
  assert.equal(expired, false, `${outcome}: an obsolete client must not expire the new account lifetime`);
  assert.equal(session.isStoredAccountClient(id, newClient), true, `${outcome}: new client must stay valid`);
  assert.equal(persistedToken, 'synthetic-new', `${outcome}: obsolete refresh must not overwrite new credentials`);
  assert.equal(newClient.authHeaders.Authorization, 'Bearer synthetic-new', `${outcome}: in-memory token must stay new`);
  await session.markAccountExpired(id, oldClient);
  assert.equal(session.isStoredAccountClient(id, newClient), true, 'late caller auth failure cannot expire the new client');
  console.log(`PASS old OAuth refresh ${outcome} after reauthentication`);
}

let failures = 0;
for (const outcome of ['rejection', 'success']) {
  try { await oldRefreshAfterReauthentication(outcome); }
  catch (error) { failures++; console.error(`FAIL ${error.message}`); }
}
async function pendingCredentialWrite(action) {
  const { session, secure } = await harness();
  let reachedWrite, finishWrite;
  const writing = new Promise(resolve => { reachedWrite = resolve; });
  globalThis.__sessionReview.beforeSecureWrite = async (_key, value) => {
    if (JSON.parse(value).accessToken !== 'synthetic-stale-rotated') return;
    reachedWrite();
    await new Promise(resolve => { finishWrite = resolve; });
  };
  let apiRequests = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method === 'DELETE') return new Response('{}', { status: 200 });
    if (url.endsWith('/login/oauth2/token'))
      return new Response('{"access_token":"synthetic-stale-rotated","expires_in":3600}', { status: 200 });
    return apiRequests++ ? new Response('{}', { status: 200 })
      : new Response('{}', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
  };
  const [{ client }] = await session.loadStoredClients();
  const refresh = client.get('/api/test').catch(error => error.name);
  await writing;
  const change = action === 'signout'
    ? session.reviewInternals.signOutAccount(id)
    : session.reviewInternals.addAccount({
        account: { ...initialAccount },
        credentials: { ...oldCredentials, accessToken: 'synthetic-new' },
        client,
      });
  await new Promise(resolve => setTimeout(resolve, 0));
  finishWrite();
  await Promise.all([refresh, change]);
  if (action === 'signout') {
    assert.equal(secure.has('easel.token.example.test_1'), false, 'late persistence cannot resurrect a signed-out token');
    assert.deepEqual(await session.loadStoredClients(), []);
  } else {
    assert.equal(JSON.parse(secure.get('easel.token.example.test_1')).accessToken, 'synthetic-new');
    const [fresh] = await session.loadStoredClients();
    assert.equal(fresh.client.authHeaders.Authorization, 'Bearer synthetic-new');
  }
  console.log(`PASS in-flight credential persistence during ${action}`);
}

for (const action of ['reauthentication', 'signout']) {
  try { await pendingCredentialWrite(action); }
  catch (error) { failures++; console.error(`FAIL ${error.message}`); }
}

try {
  const { session } = await harness();
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  const [{ client: oldClient }] = await session.loadStoredClients();
  let reachedWrite;
  const writing = new Promise(resolve => { reachedWrite = resolve; });
  let finishWrite;
  globalThis.__sessionReview.beforeSecureWrite = async () => {
    reachedWrite();
    await new Promise(resolve => { finishWrite = resolve; });
  };
  const saving = session.reviewInternals.addAccount({
    account: { ...initialAccount },
    credentials: { ...oldCredentials, accessToken: 'synthetic-new', refreshToken: 'synthetic-refresh-new' },
    client: oldClient,
  });
  await writing;
  await session.markAccountExpired(id);
  finishWrite();
  await saving;
  const [{ client }] = await session.loadStoredClients();
  assert.equal(session.isStoredAccountClient(id, client), true, 'expiration during credential save must rebuild the invalidated client');
  console.log('PASS expiration during reauthentication credential save');
} catch (error) { failures++; console.error(`FAIL ${error.message}`); }
try {
  const { session } = await harness({ locked: true });
  assert.deepEqual(await session.loadStoredClients(), []);
  const lifetimes = await session.loadStoredAccountLifetimes();
  assert.equal(lifetimes.length, 1);
  assert.equal(session.isStoredAccountLifetime(lifetimes[0]), true, 'keychain lock does not erase saved membership');
  globalThis.__sessionReview.locked = false;
  assert.equal((await session.loadStoredClients()).length, 1);
  await session.markAccountExpired(id);
  assert.equal(session.isStoredAccountLifetime(lifetimes[0]), false, 'expiration invalidates even credential-independent lifetimes');
  const unknown = await harness({ unavailableIndex: true });
  assert.equal(await unknown.session.loadStoredAccountLifetimes(), null, 'unavailable index is not confirmed empty');
  console.log('PASS production session locked-keychain membership, expiration and unknown-index handling');
} catch (error) { failures++; console.error(`FAIL ${error.message}`); }
const gate = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const candidate = (label, account = initialAccount) => ({
  account: { ...account }, credentials: { ...oldCredentials, accessToken: label },
  client: { request: async () => ({}) },
});
const index = h => JSON.parse(h.storage.get('easel.accounts'));
const token = (h, accountId = id) => JSON.parse(h.secure.get('easel.token.' + accountId)).accessToken;
const cases = [];
const test = (name, run) => cases.push({ name, run });

test('retired during initial load has no save effects', async () => {
  const h = await harness({ empty: true }), entered = gate(), release = gate(); let current = true;
  h.control.beforeIndexRead = async () => { entered.resolve(); await release.promise; };
  const saving = h.session.reviewInternals.addAccount(candidate('retired'), { current: () => current });
  const rejected = assert.rejects(saving, e => e instanceof h.session.ObsoleteSignInError);
  await entered.promise; current = false; release.resolve(); await rejected;
  assert.equal(h.control.sets.length, 0); assert.deepEqual(index(h).accounts, []);
});
test('concurrent admitted same-ID saves publish one row and latest credentials', async () => {
  const h = await harness({ empty: true }), entered = gate(), release = gate();
  await h.session.loadStoredClients();
  h.control.beforeSecureWrite = async (_k,v) => { if (JSON.parse(v).accessToken === 'first') { entered.resolve(); await release.promise; } };
  const first = h.session.reviewInternals.addAccount(candidate('first')); await entered.promise;
  const second = h.session.reviewInternals.addAccount(candidate('second')); release.resolve();
  await Promise.all([first,second]); assert.equal(index(h).accounts.length, 1); assert.equal(token(h), 'second');
});
test('failed replacement never implicitly deletes previous OAuth grant', async () => {
  const h = await harness(); await h.session.loadStoredClients(); let deletes = 0;
  globalThis.fetch = async (_u,o) => { if (o.method === 'DELETE') deletes++; return new Response('{}'); };
  h.control.beforeSecureWrite = async () => { throw Error('synthetic write failure'); };
  await assert.rejects(h.session.reviewInternals.addAccount(candidate('failed')));
  assert.equal(deletes, 0); assert.equal(token(h), oldCredentials.accessToken);
});

test('retired at entry does not load or supersede a live waiting save', async () => {
  const h = await harness({ empty: true }), entered = gate(), release = gate(); let reads = 0;
  h.control.beforeIndexRead = async () => { reads++; entered.resolve(); await release.promise; };
  const live = h.session.reviewInternals.addAccount(candidate('live'));
  await entered.promise;
  await assert.rejects(h.session.reviewInternals.addAccount(candidate('retired'), { current: () => false }), h.session.ObsoleteSignInError);
  assert.equal(reads, 1); assert.equal(h.control.sets.length, 0);
  release.resolve(); await live; assert.equal(token(h), 'live');
});
test('retirement during initial credential read rejects before native set', async () => {
  const h = await harness(), entered = gate(), release = gate(); let current = true;
  h.control.readSecure = async k => { entered.resolve(); await release.promise; return h.secure.get(k); };
  const saving = h.session.reviewInternals.addAccount(candidate('retired'), { current: () => current });
  const rejected = assert.rejects(saving, h.session.ObsoleteSignInError);
  await entered.promise; current = false; release.resolve(); await rejected;
  assert.equal(h.control.sets.length, 0); assert.equal(token(h), oldCredentials.accessToken);
});
test('waiting saves check original predicate and newest same-ID intent inside queue', async () => {
  const h = await harness(); await h.session.loadStoredClients(); const entered = gate(), release = gate();
  const blocker = h.session.reviewInternals.queueCredentialWrite(id, async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  let current = true;
  const old = h.session.reviewInternals.addAccount(candidate('obsolete'));
  const oldRejected = assert.rejects(old, h.session.ObsoleteSignInError);
  const retired = h.session.reviewInternals.addAccount(candidate('retired'), { current: () => current });
  const retiredRejected = assert.rejects(retired, h.session.ObsoleteSignInError);
  // Let both calls pass initial loading and queue, then retire the newer one.
  await Promise.resolve(); current = false; release.resolve();
  await Promise.all([blocker,oldRejected,retiredRejected]);
  assert.equal(h.control.sets.length, 0); assert.equal(h.session.reviewInternals.saveIntents.size, 0);
});
test('admitted save survives retirement with protocol keys and preserved metadata', async () => {
  const h = await harness(), entered = gate(), release = gate(); let current = true;
  const [{client}] = await h.session.loadStoredClients();
  h.control.kv.set('unrelated-settings', 'retained'); let cleanups = 0;
  h.session.registerAccountCleanup(() => { cleanups++; });
  h.control.beforeSecureWrite = async () => { entered.resolve(); await release.promise; };
  const saving = h.session.reviewInternals.addAccount(candidate('accepted', { ...initialAccount, addedAt: 'later' }), { current: () => current });
  await entered.promise; assert.equal(h.session.isStoredAccountClient(id, client), false);
  current = false; release.resolve(); const saved = await saving;
  assert.equal(saved.addedAt, initialAccount.addedAt); assert.equal(index(h).accounts.length, 1);
  assert.equal(token(h), 'accepted'); assert.equal(cleanups, 0); assert.equal(h.control.kv.get('unrelated-settings'), 'retained');
  assert.deepEqual(h.control.sets.map(s => [s.k, s.options, JSON.parse(s.v).v]), [['easel.token.example.test_1', { keychainAccessible: 'test' }, 1]]);
  assert.equal(h.control.deletes.length, 0); assert.equal(h.control.browser.length, 0);
  assert.equal(h.session.reviewInternals.replacingCredentials.size, 0);
  assert.equal(h.session.isStoredAccountClient(id, (await h.session.loadStoredClients())[0].client), true);
});
test('older release cannot clear newer save/replacement ownership', async () => {
  const h = await harness(), firstEntered = gate(), firstDone = gate(), secondEntered = gate(), secondDone = gate();
  await h.session.loadStoredClients();
  h.control.beforeSecureWrite = async (_k,v) => {
    if (JSON.parse(v).accessToken === 'first') { firstEntered.resolve(); await firstDone.promise; }
    else { secondEntered.resolve(); await secondDone.promise; }
  };
  const first = h.session.reviewInternals.addAccount(candidate('first')); await firstEntered.promise;
  const second = h.session.reviewInternals.addAccount(candidate('second'));
  const owner = h.session.reviewInternals.saveIntents.get(id);
  firstDone.resolve(); await first; await secondEntered.promise;
  assert.equal(h.session.reviewInternals.saveIntents.get(id), owner);
  assert.equal(h.session.reviewInternals.replacingCredentials.get(id), owner);
  secondDone.resolve(); await second;
  assert.equal(h.session.reviewInternals.saveIntents.size, 0); assert.equal(h.session.reviewInternals.replacingCredentials.size, 0);
});
const otherAccount = { ...initialAccount, id: 'other.test_2', host: 'other.test', baseUrl: 'https://other.test', user: { ...initialAccount.user, id: '2' } };
test('distinct saves retain membership and newer explicit selection', async () => {
  const h = await harness(), entered = gate(), release = gate(); await h.session.loadStoredClients();
  const publications = []; h.session.reviewInternals.subscribe(() => publications.push(h.session.reviewInternals.getSnapshot()));
  h.control.beforeSecureWrite = async (k) => { if (k.endsWith(otherAccount.id)) { entered.resolve(); await release.promise; } };
  const other = h.session.reviewInternals.addAccount(candidate('other', otherAccount)); await entered.promise;
  await h.session.reviewInternals.addAccount(candidate('new'));
  await h.session.reviewInternals.switchAccount(id);
  release.resolve(); await other;
  assert.deepEqual(index(h).accounts.map(a => a.id), [id,otherAccount.id]); assert.equal(index(h).activeId, id);
  assert.equal(token(h), 'new'); assert.equal(token(h, otherAccount.id), 'other');
  for (const snapshot of publications) {
    assert.equal(new Set(snapshot.accounts.map(a => a.id)).size, snapshot.accounts.length);
    assert.ok(snapshot.activeId === null || snapshot.accounts.some(a => a.id === snapshot.activeId));
  }
});
test('latest save selection wins across different native completion order', async () => {
  const h = await harness(), entered = gate(), release = gate(); await h.session.loadStoredClients();
  h.control.beforeSecureWrite = async (k) => { if (k.endsWith(id)) { entered.resolve(); await release.promise; } };
  const first = h.session.reviewInternals.addAccount(candidate('first')); await entered.promise;
  await h.session.reviewInternals.addAccount(candidate('other', otherAccount)); release.resolve(); await first;
  assert.equal(index(h).activeId, otherAccount.id); assert.equal(index(h).accounts.length, 2);
});
test('removal reserves while initial load waits and invalidates waiting saves', async () => {
  const h = await harness(), entered = gate(), release = gate();
  h.control.beforeIndexRead = async () => { entered.resolve(); await release.promise; };
  globalThis.fetch = async () => new Response('{}');
  const saving = h.session.reviewInternals.addAccount(candidate('waiting'));
  const rejected = assert.rejects(saving, h.session.ObsoleteSignInError); await entered.promise;
  const removing = h.session.reviewInternals.signOutAccount(id);
  await assert.rejects(h.session.reviewInternals.addAccount(candidate('blocked')), h.session.ObsoleteSignInError);
  release.resolve(); await Promise.all([rejected,removing]);
  assert.equal(h.control.sets.length, 0); assert.deepEqual(index(h).accounts, []);
});
test('removal waits admitted save, revokes its accepted credentials and holds through cleanup', async () => {
  const h = await harness(), entered = gate(), release = gate(), cleaning = gate(), cleaned = gate();
  await h.session.loadStoredClients(); await h.session.reviewInternals.addAccount(candidate('other', otherAccount));
  const requests = []; globalThis.fetch = async (url,options) => { requests.push([url,options]); return new Response(JSON.stringify({ forward_url: 'https://sso.test/logout' })); };
  h.control.beforeSecureWrite = async () => { entered.resolve(); await release.promise; };
  const saving = h.session.reviewInternals.addAccount(candidate('accepted')); await entered.promise;
  h.session.registerAccountCleanup(async accountId => { assert.equal(accountId, id); cleaning.resolve(); await cleaned.promise; });
  const removing = h.session.reviewInternals.signOutAccount(id);
  assert.equal(h.session.reviewInternals.signOutAccount(id), removing, 'duplicate removal shares reservation');
  await assert.rejects(h.session.reviewInternals.addAccount(candidate('blocked')), h.session.ObsoleteSignInError);
  release.resolve(); await saving; await cleaning.promise;
  await assert.rejects(h.session.reviewInternals.addAccount(candidate('still-blocked')), h.session.ObsoleteSignInError);
  await h.session.reviewInternals.switchAccount(otherAccount.id); cleaned.resolve(); await removing;
  assert.equal(requests.length, 1); assert.equal(requests[0][0], 'https://example.test/login/oauth2/token?expire_sessions=1');
  assert.equal(requests[0][1].method, 'DELETE'); assert.equal(requests[0][1].headers.Authorization, 'Bearer accepted');
  assert.deepEqual(h.control.browser, [['https://sso.test/logout', 'easel://oauth/logout']]);
  assert.deepEqual(index(h).accounts.map(a => a.id), [otherAccount.id]); assert.equal(index(h).activeId, otherAccount.id);
  assert.equal(h.secure.has('easel.token.' + id), false); assert.equal(token(h, otherAccount.id), 'other');
  assert.equal(h.session.reviewInternals.removalReservations.size, 0); assert.equal(h.session.reviewInternals.removingAccounts.size, 0);
});
test('explicit revocation may refresh through credential queue without deadlock', async () => {
  const h = await harness(); await h.session.loadStoredClients(); const requests = [];
  globalThis.fetch = async (url,options) => {
    requests.push([url,options]);
    if (options.method === 'POST') return new Response(JSON.stringify({ access_token: 'refreshed', expires_in: 3600 }));
    return new Response('{}', { status: requests.length === 1 ? 401 : 200, headers: { 'WWW-Authenticate': 'Bearer' } });
  };
  await h.session.reviewInternals.signOutAccount(id);
  assert.deepEqual(requests.map(r => r[1].method), ['DELETE','POST','DELETE']);
  assert.equal(requests[2][1].headers.Authorization, 'Bearer refreshed');
  assert.equal(h.secure.has('easel.token.' + id), false);
});
for (const late of ['old', 'null']) test('late missing-credential read cannot adopt ' + late + ' after save', async () => {
  const h = await harness({ locked: true }); await h.session.loadStoredClients();
  const entered = gate(), release = gate();
  h.control.readSecure = async () => { entered.resolve(); await release.promise; return late === 'null' ? null : JSON.stringify(oldCredentials); };
  const reading = h.session.reviewInternals.loadMissingCredentials(); await entered.promise;
  await h.session.reviewInternals.addAccount(candidate('new'), { current: () => true });
  release.resolve(); await reading;
  const [{client}] = await h.session.loadStoredClients();
  assert.equal(client.authHeaders.Authorization, 'Bearer new'); assert.equal(index(h).accounts.length, 1);
});
test('expected account disappearance is obsolete, present wrong user still explicitly discarded', async () => {
  const h = await harness(); await h.session.loadStoredClients(); globalThis.fetch = async () => new Response('{}');
  let discards = 0; const wrong = candidate('wrong', otherAccount); wrong.client.request = async () => { discards++; return {}; };
  await assert.rejects(h.session.reviewInternals.addAccount(wrong, { expectedAccountId: id, current: () => true }), e => e instanceof h.session.SignInError && e.message === h.session.wrongAccountMessage(wrong.account, initialAccount));
  assert.equal(discards, 1);
  await h.session.reviewInternals.signOutAccount(id);
  await assert.rejects(h.session.reviewInternals.addAccount(wrong, { expectedAccountId: id, current: () => true }), h.session.ObsoleteSignInError);
  assert.equal(discards, 1); assert.equal(h.control.sets.length, 0);
});
test('unknown membership refuses guarded save; legacy unguarded caller remains supported', async () => {
  const h = await harness({ unavailableIndex: true });
  await assert.rejects(h.session.reviewInternals.addAccount(candidate('blocked'), { current: () => true }), h.session.ObsoleteSignInError);
  assert.equal(h.control.sets.length, 0); assert.equal(await h.session.loadStoredAccountLifetimes(), null);
  await h.session.reviewInternals.addAccount(candidate('legacy')); assert.equal(token(h), 'legacy');
});
test('pending getter is read at admission after queued rotation', async () => {
  const h = await harness(); await h.session.loadStoredClients(); const entered = gate(), release = gate();
  const blocking = h.session.reviewInternals.queueCredentialWrite(id, async () => { entered.resolve(); await release.promise; }); await entered.promise;
  let credentials = candidate('old').credentials, reads = 0;
  const p = { ...candidate('unused'), get credentials() { reads++; return credentials; } };
  const saving = h.session.reviewInternals.addAccount(p); await Promise.resolve();
  assert.equal(reads, 0); credentials = candidate('rotated').credentials; release.resolve(); await Promise.all([blocking,saving]);
  assert.equal(reads, 1); assert.equal(token(h), 'rotated');
});
test('index failure retains accepted memory and never deletes or rolls back', async () => {
  const h = await harness(); await h.session.loadStoredClients();
  h.control.beforeIndexWrite = async () => { throw Error('synthetic unavailable index write'); };
  await h.session.reviewInternals.addAccount(candidate('accepted'));
  assert.equal(token(h), 'accepted'); assert.equal(h.control.deletes.length, 0);
  assert.equal((await h.session.loadStoredClients())[0].client.authHeaders.Authorization, 'Bearer accepted');
});
test('PAT explicit discard/removal never revoke and preserve other memberships', async () => {
  const h = await harness({ empty: true }); const pat = candidate('pat', { ...initialAccount, authMethod: 'token' });
  pat.client.request = async () => { throw Error('PAT must never revoke'); };
  await h.session.reviewInternals.addAccount(pat); await h.session.discardSignIn(pat);
  await h.session.reviewInternals.signOutAccount(id); assert.deepEqual(index(h).accounts, []); assert.equal(h.control.browser.length, 0);
});

test('failed admitted save releases only its own ticket while a newer save waits', async () => {
  const h = await harness(), entered = gate(), release = gate(), nextEntered = gate(), nextDone = gate(); await h.session.loadStoredClients();
  h.control.beforeSecureWrite = async (_k,v) => {
    if (JSON.parse(v).accessToken === 'failing') { entered.resolve(); await release.promise; throw Error('synthetic failure'); }
    nextEntered.resolve(); await nextDone.promise;
  };
  const first = h.session.reviewInternals.addAccount(candidate('failing')); const failed = assert.rejects(first);
  await entered.promise; const next = h.session.reviewInternals.addAccount(candidate('newer'));
  const owner = h.session.reviewInternals.saveIntents.get(id); release.resolve(); await failed;
  await nextEntered.promise;
  assert.equal(h.session.reviewInternals.saveIntents.get(id), owner);
  assert.equal(h.session.reviewInternals.replacingCredentials.get(id), owner);
  nextDone.resolve(); await next; assert.equal(token(h), 'newer'); assert.equal(h.session.reviewInternals.replacingCredentials.size, 0);
});
test('late null read during admitted set cannot remove the reserved membership', async () => {
  const h = await harness({ locked: true }); await h.session.loadStoredClients();
  const readEntered = gate(), readDone = gate(), writeEntered = gate(), writeDone = gate();
  h.control.readSecure = async () => { readEntered.resolve(); await readDone.promise; return null; };
  const reading = h.session.reviewInternals.loadMissingCredentials(); await readEntered.promise;
  h.control.beforeSecureWrite = async () => { writeEntered.resolve(); await writeDone.promise; };
  const saving = h.session.reviewInternals.addAccount(candidate('new')); await writeEntered.promise;
  readDone.resolve(); await reading; assert.equal(h.session.reviewInternals.getSnapshot().accounts.length, 1);
  writeDone.resolve(); await saving; assert.equal(token(h), 'new');
});
test('ambiguous native failure never deletes, restores, or revokes credentials', async () => {
  const h = await harness(); await h.session.loadStoredClients(); let deletes = 0;
  globalThis.fetch = async (_u,o) => { if (o.method === 'DELETE') deletes++; return new Response('{}'); };
  h.control.beforeSecureWrite = async (k,v) => { h.secure.set(k,v); throw Error('synthetic failure after persistence'); };
  await assert.rejects(h.session.reviewInternals.addAccount(candidate('uncertain')));
  assert.equal(deletes, 0); assert.equal(h.control.deletes.length, 0); assert.equal(h.control.sets.length, 1);
  assert.equal(token(h), 'uncertain');
  assert.equal((await h.session.loadStoredClients())[0].client.authHeaders.Authorization, 'Bearer ' + oldCredentials.accessToken);
});
test('account identity and PAT verification retain original raw protocol', async () => {
  const h = await harness({ empty: true }), calls = [];
  globalThis.fetch = async (url,options) => { calls.push([url,options]); return new Response(JSON.stringify({ id: '7', name: 'Raw User' })); };
  const pending = await h.session.verifyToken('https://school.test/', '  synthetic-pat  ');
  assert.equal(pending.account.id, 'school.test_7');
  assert.equal(calls[0][0], 'https://school.test/api/v1/users/self');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer synthetic-pat');
  await h.session.reviewInternals.addAccount(pending);
  assert.ok(h.secure.has('easel.token.school.test_7')); assert.equal(index(h).activeId, 'school.test_7');
});

for (const {name, run} of cases) {
  try { await run(); console.log('PASS ' + name); }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + error.message); }
}
if (failures) process.exitCode = 1;
