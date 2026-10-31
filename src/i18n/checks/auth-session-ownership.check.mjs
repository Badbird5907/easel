/** Production session/client regression; all native persistence and network are in-memory fakes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(`${root}/package.json`);
const { build } = require('esbuild');
const id = 'example.test_1';
const initialAccount = {
  id,
  host: 'example.test',
  baseUrl: 'https://example.test',
  user: { id: '1', name: 'Test', shortName: 'Test', avatarUrl: null },
  authMethod: 'oauth',
  addedAt: '2026-01-01',
};
const oldCredentials = {
  accessToken: 'synthetic-old',
  refreshToken: 'synthetic-refresh-old',
  expiresAt: null,
  issuedAt: null,
  clientId: 'test-key',
  clientSecret: null,
};

async function harness({ locked = false, unavailableIndex = false, empty = false } = {}) {
  const storage = new Map([['easel.accounts', JSON.stringify({ accounts: [initialAccount], activeId: id })]]);
  const secure = new Map([['easel.token.example.test_1', JSON.stringify(oldCredentials)]]);
  const kv = new Map();
  if (empty) {
    storage.set('easel.accounts', JSON.stringify({ accounts: [], activeId: null }));
    secure.clear();
  }
  const control = {
    storage,
    secure,
    kv,
    locked,
    unavailableIndex,
    reads: [],
    sets: [],
    deletes: [],
    browser: [],
  };
  globalThis.__sessionReview = control;
  globalThis.fetch = async () => {
    throw Error('Unexpected synthetic transport');
  };
  const stubs = {
    '../query': `export const useCanvasQuery = () => { throw Error('Unexpected query hook'); };`,
    '@tanstack/react-query': `export const useQuery = () => { throw Error('Unexpected query hook'); };`,
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
    stdin: {
      contents: `export * from './src/canvas/session.tsx'; export * as reviewLegal from './src/canvas/api/legal.ts';`,
      resolveDir: root,
      sourcefile: 'review-entry.ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    tsconfig: `${root}/tsconfig.json`,
    plugins: [
      {
        name: 'controlled-native-boundaries',
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(?:@react-native-async-storage\/async-storage|expo-secure-store|expo-web-browser|@\/features\/notifications\/storage|\.\.\/query|@tanstack\/react-query)$/,
            },
            (a) => ({ path: a.path, namespace: 'stub' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path], loader: 'js' }));
          b.onLoad({ filter: /src\/canvas\/session\.tsx$/ }, (a) => ({
            contents:
              readFileSync(a.path, 'utf8') +
              '\nexport const reviewInternals = { addAccount, signOutAccount, switchAccount, getSnapshot, subscribe, queueCredentialWrite, loadMissingCredentials, saveIntents, replacingCredentials, removalReservations, removingAccounts, oauthSources, pendingSources };',
            loader: 'tsx',
          }));
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return { session: module.exports, storage, secure, control };
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {},
  });
const host = { host: 'example.test', baseUrl: 'https://example.test' };
const key = { clientId: 'test-key' };
const response = { access_token: 'synthetic-pending', refresh_token: 'synthetic-refresh' };
async function admittedFreeze() {
  const { session, control, secure } = await harness({ empty: true });
  let refreshes = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/login/oauth2/token')) {
      refreshes++;
      return json({ access_token: 'synthetic-rotated', refresh_token: 'synthetic-rotated-refresh' });
    }
    return url.endsWith('/users/self') ? json({ id: '1', name: 'Test' }) : json({}, 401);
  };
  const pending = await session.verifyOAuth(host, response, key);
  const entered = deferred(),
    finish = deferred();
  control.beforeSecureWrite = () => {
    entered.resolve();
    return finish.promise;
  };
  const save = session.reviewInternals.addAccount(pending);
  await entered.promise;
  const request = await pending.client.get('/api/test').then(
    () => null,
    (error) => error,
  );
  finish.resolve();
  await save;
  assert.equal(refreshes, 0, 'pending refresh must not rotate after native save admission');
  assert.ok(request instanceof session.ObsoleteSignInError);
  assert.equal(
    JSON.parse(secure.get('easel.token.example.test_1')).accessToken,
    pending.credentials.accessToken,
  );
  console.log('PASS pending refresh refused during admitted save (before-fail regression)');
}
await admittedFreeze();

const tick = async () => {
  for (let i = 0; i < 150; i++) await Promise.resolve();
};
const rejectLocal = (promise, session) => assert.rejects(promise, session.ObsoleteSignInError);
async function verified(h, source) {
  return h.session.verifyOAuth(host, response, key, source ? { source } : undefined);
}
function simpleTransport() {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return json(url.endsWith('/users/self') ? { id: '1', name: 'Test' } : {});
  };
  return requests;
}

for (const retire of [false, true]) {
  const h = await harness({ empty: true });
  let current = true;
  const source = h.session.createOAuthSource(host, key, () => current);
  const started = deferred(),
    rotation = deferred();
  let refreshes = 0,
    api = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/login/oauth2/token')) {
      refreshes++;
      started.resolve();
      return rotation.promise;
    }
    if (url.endsWith('/users/self')) return json({ id: '1', name: 'Test' });
    api++;
    return json({}, 401);
  };
  const pending = await verified(h, source);
  const refreshing = pending.client.get('/api/refresh').catch((e) => e);
  await started.promise;
  const entered = deferred(),
    finish = deferred();
  h.control.beforeSecureWrite = () => {
    entered.resolve();
    return finish.promise;
  };
  const save = h.session.reviewInternals.addAccount(pending, { current: () => current }).catch((e) => e);
  await tick();
  assert.equal(h.control.sets.length, 0, 'native set must wait for pending rotation');
  await rejectLocal(pending.client.get('/api/new'), h.session);
  if (retire) {
    current = false;
    source.abandon();
  }
  rotation.resolve(json({ access_token: 'synthetic-final', refresh_token: 'synthetic-final-refresh' }));
  await refreshing;
  assert.equal(
    pending.credentials.accessToken,
    'synthetic-final',
    'capture late rotation even after retirement',
  );
  if (retire) {
    assert.ok((await save) instanceof h.session.ObsoleteSignInError);
    assert.equal(h.control.sets.length, 0);
  } else {
    await entered.promise;
    assert.equal(JSON.parse(h.control.sets[0].v).accessToken, 'synthetic-final');
    current = false;
    assert.deepEqual(source.abandon(), { status: 'deferred', reason: 'persistence' });
    finish.resolve();
    await save;
    assert.deepEqual(source.abandon(), { status: 'released' });
    await rejectLocal(pending.client.get('/api/old'), h.session);
    const [{ client }] = await h.session.loadStoredClients();
    assert.equal(client.authHeaders.Authorization, 'Bearer synthetic-final');
  }
  assert.equal(refreshes, 1);
  assert.equal(api, 1);
  console.log('PASS entered refresh settles before save; sealed requests refused; retirement ' + retire);
}

// Failed preparation releases only its own seal; no native admission has occurred.
{
  const h = await harness({ empty: true });
  const started = deferred(),
    rotation = deferred();
  simpleTransport();
  const pending = await verified(h);
  globalThis.fetch = async (url) =>
    url.endsWith('/login/oauth2/token') ? (started.resolve(), rotation.promise) : json({}, 401);
  const refreshing = pending.client.get('/api/test').catch((e) => e);
  await started.promise;
  const saving = h.session.reviewInternals.addAccount(pending, { current: () => true });
  const rejected = assert.rejects(saving);
  await tick();
  rotation.reject(Error('synthetic offline'));
  await Promise.all([refreshing, rejected]);
  assert.equal(h.control.sets.length, 0);
  simpleTransport();
  await h.session.reviewInternals.addAccount(pending, { current: () => true });
  assert.equal(h.control.sets.length, 1);
  console.log('PASS failed refresh seal thaws for safe current retry');
}

for (const changed of [false, true]) {
  const h = await harness({ empty: true });
  simpleTransport();
  const pending = await verified(h);
  h.control.beforeSecureWrite = (k, v) => {
    h.secure.set(k, v);
    throw Error('ambiguous native outcome');
  };
  await assert.rejects(h.session.reviewInternals.addAccount(pending, { current: () => true }));
  assert.equal(h.session.reviewInternals.pendingSources.get(pending).phase, 'uncertain');
  await rejectLocal(pending.client.get('/api/never'), h.session);
  assert.equal(h.session.reviewInternals.getSnapshot().accounts.length, 0);
  h.control.beforeSecureWrite = undefined;
  if (changed) {
    await h.session.reviewInternals.addAccount({
      account: initialAccount,
      credentials: oldCredentials,
      client: pending.client,
    });
    await rejectLocal(h.session.reviewInternals.addAccount(pending, { current: () => true }), h.session);
    assert.equal(h.control.sets.length, 2);
  } else {
    await h.session.reviewInternals.addAccount(pending, { current: () => true });
    assert.equal(h.control.sets.length, 2);
    assert.equal(h.control.sets[0].v, h.control.sets[1].v);
    assert.deepEqual(h.session.abandonSignIn(pending), { status: 'released' });
    await rejectLocal(h.session.reviewInternals.addAccount(pending), h.session);
    assert.equal(h.control.sets.length, 2, 'adopted source replay cannot persist again');
  }
  assert.equal(h.control.deletes.length, 0);
  console.log(
    'PASS ambiguous admission is frozen; same-credential retry requires unchanged saved lifetime ' + changed,
  );
}

for (const otherKind of ['pending', 'saved', 'pat', 'distinct']) {
  const h = await harness({ empty: true });
  const requests = simpleTransport();
  const source = h.session.createOAuthSource(host, key);
  const a = await verified(h, source);
  const otherResponse =
    otherKind === 'distinct' ? { ...response, access_token: 'synthetic-distinct' } : response;
  const b =
    otherKind === 'pat'
      ? await h.session.verifyToken(host.host, response.access_token)
      : await h.session.verifyOAuth(host, otherResponse, key);
  if (otherKind === 'saved' || otherKind === 'pat') await h.session.reviewInternals.addAccount(b);
  assert.deepEqual(source.abandon(), { status: 'deferred', reason: 'unknown' });
  assert.deepEqual(source.abandon(), h.session.abandonSignIn(a));
  await rejectLocal(a.client.get('/api/retired'), h.session);
  if (otherKind === 'pending' || otherKind === 'distinct') {
    await b.client.get('/api/live');
    await h.session.reviewInternals.addAccount(b);
  }
  const [{ client }] = await h.session.loadStoredClients();
  await client.get('/api/saved');
  assert.equal(
    requests.some((r) => r.options.method === 'DELETE'),
    false,
  );
  assert.equal(h.control.deletes.length, 0);
  console.log('PASS source-only retirement spares ' + otherKind + ' bearer owner; no automatic DELETE');
}

for (const settings of [{ unavailableIndex: true }, { locked: true }]) {
  const h = await harness(settings);
  const requests = simpleTransport();
  const pending = await verified(h);
  if (settings.unavailableIndex)
    await rejectLocal(h.session.reviewInternals.addAccount(pending, { current: () => true }), h.session);
  h.session.abandonSignIn(pending);
  assert.equal(h.control.sets.length, 0);
  assert.equal(h.control.deletes.length, 0);
  assert.equal(
    requests.some((r) => r.options.method === 'DELETE'),
    false,
  );
}
{
  const h = await harness({ empty: true });
  const requests = simpleTransport();
  const legacy = { account: initialAccount, credentials: oldCredentials, client: {} };
  assert.deepEqual(h.session.abandonSignIn(legacy), { status: 'deferred', reason: 'unknown' });
  await h.session.reviewInternals.addAccount(legacy);
  assert.equal(h.control.sets.length, 1);
  assert.equal(requests.length, 0);
  console.log('PASS unknown index/locked credentials and legacy pending compatibility; no cleanup effects');
}

// Reuse the existing synthetic hook/element loader, not a second lifecycle algorithm.
// Load the real form/lifetime with REAL session and legal modules; only OAuth/browser/UI are boundaries.
function formsHarness(actual) {
  const file = path.join(root, 'src/i18n/checks/auth-forms.check.cjs');
  const helpers = readFileSync(file, 'utf8').split('async function main()')[0];
  const marker = 'const runtime =';
  const at = helpers.indexOf(marker);
  const context = {
    require: createRequire(file),
    __dirname: path.dirname(file),
    console,
    process,
    URL,
    AbortController,
    boundarySession: actual,
  };
  const inject = `
    const sourceEvents=[];
    Object.assign(mocks['@/canvas/session'], boundarySession, {
      useSession:()=>session,
      verifyOAuth:stage('verifyOAuth',boundarySession.verifyOAuth),
      createOAuthSource:(...args)=>{
        const source=boundarySession.createOAuthSource(...args);
        const capture=source.capture, abandon=source.abandon;
        sourceEvents.push(['create',source,args]);
        source.capture=(...args)=>{sourceEvents.push(['capture',source]); return capture(...args);};
        source.abandon=()=>{const outcome=abandon();sourceEvents.push(['abandon',source,outcome]);return outcome;};
        return source;
      }
    });
    Object.assign(mocks['@/canvas/api/legal'], {
      fetchRequiresTerms:stage('terms',boundarySession.reviewLegal.fetchRequiresTerms),
      acceptTerms:stage('accept',boundarySession.reviewLegal.acceptTerms)
    });
  `;
  vm.runInNewContext(
    helpers.slice(0, at) +
      inject +
      helpers.slice(at) +
      `
    globalThis.api={form,one,locale,calls,sourceEvents,operations,load,mount,
      configure(next={}) { reset(); behavior=next;
        session.addAccount=stage('save',boundarySession.reviewInternals.addAccount);
      }};
  `,
    context,
    { filename: file },
  );
  return context.api;
}
function beginForm(fh) {
  const f = fh.form({ onSignedIn: () => fh.calls.push(['signed']) });
  f.edit('school', 'example.test');
  f.revise = f.field('school').onChangeText;
  f.submit();
  return f;
}
const called = (fh, name) => fh.calls.filter((c) => c[0] === name).length;

for (const boundary of ['exchange', 'verify', 'refresh', 'lookup', 'content', 'accept', 'native']) {
  const h = await harness({ empty: true });
  const fh = formsHarness(h.session);
  const gate = deferred(),
    entered = deferred();
  let refresh = 0;
  const requests = [];
  fh.configure(
    boundary === 'exchange'
      ? {
          exchange: () => {
            entered.resolve();
            return gate.promise;
          },
        }
      : {},
  );
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/login/oauth2/token')) {
      refresh++;
      entered.resolve();
      return gate.promise;
    }
    if (url.endsWith('/users/self') && options.method === 'GET') {
      if (boundary === 'verify') {
        entered.resolve();
        return gate.promise;
      }
      if (boundary === 'refresh' && refresh === 0) return json({}, 401);
      return json({ id: '1', name: 'Test' });
    }
    if (url.includes('/login/session_token')) {
      if (boundary === 'lookup') {
        entered.resolve();
        return gate.promise;
      }
      return json({ requires_terms_acceptance: boundary === 'content' || boundary === 'accept' });
    }
    if (url.endsWith('/terms_of_service')) {
      entered.resolve();
      return gate.promise;
    }
    if (options.method === 'PUT') {
      entered.resolve();
      return gate.promise;
    }
    throw Error('Unexpected synthetic request ' + url);
  };
  // Give the real verifier refresh-capable synthetic response.
  if (boundary !== 'exchange') fh.configure({ exchange: async () => response });
  if (boundary === 'native')
    h.control.beforeSecureWrite = () => {
      entered.resolve();
      return gate.promise;
    };
  const f = beginForm(fh);
  await tick();
  f.render();
  let content, accept;
  if (boundary === 'content')
    content = h.session.reviewLegal.fetchTerms(fh.one(f.tree, 'TermsStep').pending.client);
  if (boundary === 'accept') accept = fh.one(f.tree, 'TermsStep').onAccept();
  await entered.promise;
  const source = fh.sourceEvents.find((e) => e[0] === 'create')[1];
  f.m.unmount();
  const countBefore = requests.length;
  gate.resolve(
    boundary === 'exchange'
      ? response
      : boundary === 'verify'
        ? json({ id: '1', name: 'Test' })
        : boundary === 'refresh'
          ? json({ access_token: 'synthetic-late-rotation', refresh_token: 'synthetic-late-refresh' })
          : boundary === 'lookup'
            ? json({ requires_terms_acceptance: true })
            : boundary === 'content'
              ? json({})
              : json({}),
  );
  await tick();
  if (content) await content;
  if (accept) await accept;
  assert.equal(requests.length, countBefore, 'retired ' + boundary + ' cannot start later transport');
  assert.equal(called(fh, 'success'), 0);
  assert.equal(called(fh, 'signed'), 0);
  assert.equal(called(fh, 'save'), boundary === 'native' ? 1 : 0);
  assert.equal(fh.sourceEvents.filter((e) => e[0] === 'abandon').length, 1);
  assert.equal(
    fh.sourceEvents.filter((e) => e[0] === 'capture').length,
    1,
    'the form captures exactly once before verification or a retired return',
  );
  assert.deepEqual(
    source.abandon(),
    boundary === 'native' ? { status: 'released' } : { status: 'deferred', reason: 'unknown' },
  );
  if (boundary === 'exchange') assert.equal(called(fh, 'verifyOAuth'), 0);
  if (boundary === 'refresh') {
    // Source response captured despite retirement; inspect via test-only WeakMap, not a public secret API.
    assert.equal(
      h.session.reviewInternals.oauthSources.get(source).credentials.accessToken,
      'synthetic-late-rotation',
    );
  }
  assert.equal(
    requests.some((r) => r.options.method === 'DELETE'),
    false,
  );
  console.log(
    'PASS real form/session retirement across ' + boundary + '; capture/release and no later stages',
  );
}

for (const retirement of ['unmount', 'revision', 'release', 'account', 'replay']) {
  const h = await harness({ empty: true });
  const fh = formsHarness(h.session);
  fh.configure({ exchange: async () => response });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return json(
      url.includes('/login/session_token') ? { requires_terms_acceptance: true } : { id: '1', name: 'Test' },
    );
  };
  const f = beginForm(fh);
  await tick();
  f.render();
  const terms = fh.one(f.tree, 'TermsStep'),
    source = fh.sourceEvents.find((e) => e[0] === 'create')[1];
  const descriptor = Object.getOwnPropertyDescriptor(terms.pending, 'credentials');
  assert.equal(typeof descriptor.get, 'function');
  assert.deepEqual(Object.keys(terms.pending).sort(), ['account', 'client', 'credentials']);
  const op = fh.operations[0];
  assert.equal(fh.sourceEvents[0][2][2], op.current, 'source receives original operation predicate');
  const verify = fh.calls.find((c) => c[0] === 'verifyOAuth');
  assert.equal(verify[4].source, source);
  const exchange = fh.calls.find((c) => c[0] === 'exchange'),
    code = fh.calls.find((c) => c[0] === 'code');
  assert.equal(exchange[1], code[2]);
  assert.equal(exchange[2], 'inert-code');
  for (const lang of ['fr', 'ar', 'en']) {
    fh.locale(lang);
    f.render();
    assert.equal(fh.one(f.tree, 'TermsStep').pending, terms.pending);
    assert.equal(op.current(), true);
  }
  assert.equal(fh.sourceEvents.filter((e) => e[0] === 'abandon').length, 0, 'locale preserves idle source');
  if (retirement === 'unmount') f.m.unmount();
  else if (retirement === 'account') {
    f.props = { addingAccount: true };
    f.render();
  } else if (retirement === 'replay') f.m.replayEffects();
  else if (retirement === 'revision') {
    f.revise('replacement.test');
    f.render();
  } else {
    const lifetime = fh.load('@/features/auth/authFormsLifetime');
    // The owner itself is private; release is the same operation-specific retirement boundary.
    assert.equal(typeof lifetime.authFormsRetire, 'function');
    op.release();
  }
  const before = requests.length;
  await terms.onAccept();
  await terms.onDecline();
  await rejectLocal(terms.pending.client.get('/api/never'), h.session);
  assert.equal(requests.length, before);
  assert.equal(called(fh, 'save'), 0);
  assert.equal(fh.sourceEvents.filter((e) => e[0] === 'abandon').length, 1);
  let late = 0;
  op.onRetire(() => late++);
  assert.equal(late, 1, 'already-retired registration fires immediately');
  op.release();
  assert.equal(fh.sourceEvents.filter((e) => e[0] === 'abandon').length, 1);
  assert.deepEqual(source.abandon(), { status: 'deferred', reason: 'unknown' });
  if (retirement !== 'unmount') f.m.unmount();
  console.log(
    'PASS idle terms source retirement ' + retirement + ' and locale/getter/callback compatibility',
  );
}

for (const failure of ['verification', 'exchange']) {
  const h = await harness({ empty: true });
  const fh = formsHarness(h.session);
  fh.configure({
    exchange: async () => {
      assert.equal(fh.sourceEvents[0][0], 'create', 'source predates exchange');
      if (failure === 'exchange') throw Error('synthetic exchange failure');
      return response;
    },
  });
  globalThis.fetch = async () => json({ error: 'synthetic refusal' }, 403);
  const f = beginForm(fh);
  await tick();
  f.render();
  assert.equal(called(fh, 'terms'), 0);
  assert.equal(called(fh, 'save'), 0);
  assert.equal(called(fh, 'error'), 1);
  const source = fh.sourceEvents[0][1];
  assert.equal(fh.sourceEvents.filter((e) => e[0] === 'abandon').length, 1);
  assert.deepEqual(
    source.abandon(),
    failure === 'exchange' ? { status: 'released' } : { status: 'deferred', reason: 'unknown' },
  );
  f.m.unmount();
  console.log('PASS ' + failure + ' error releases source without later stages');
}

// Real terms callbacks retry preparation and ambiguous native failure without repeating accepted PUT.
for (const failure of ['obsolete', 'native']) {
  const h = await harness({ empty: true });
  const fh = formsHarness(h.session);
  fh.configure({ exchange: async () => response });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return json(
      url.includes('/login/session_token') ? { requires_terms_acceptance: true } : { id: '1', name: 'Test' },
    );
  };
  const f = beginForm(fh);
  await tick();
  f.render();
  const original = fh.one(f.tree, 'TermsStep');
  let accepted;
  if (failure === 'native') {
    h.control.beforeSecureWrite = () => {
      throw Error('synthetic ambiguous rejection');
    };
    await assert.rejects(original.onAccept());
    h.control.beforeSecureWrite = undefined;
  } else {
    const blocker = deferred();
    const queued = h.session.reviewInternals.queueCredentialWrite(id, () => blocker.promise);
    accepted = original.onAccept();
    await tick();
    // A competing intent supersedes only this waiting save. Its own operation is retired before admission.
    let otherCurrent = true;
    const competing = h.session.reviewInternals
      .addAccount(
        { account: initialAccount, credentials: oldCredentials, client: {} },
        { current: () => otherCurrent },
      )
      .catch((e) => e);
    otherCurrent = false;
    blocker.resolve();
    await queued;
    await competing;
    await accepted;
    f.render();
    assert.notEqual(fh.one(f.tree, 'TermsStep'), original, 'local refusal remounts retryable terms control');
  }
  const retry = fh.one(f.tree, 'TermsStep');
  await retry.onAccept();
  await tick();
  assert.equal(requests.filter((r) => r.options.method === 'PUT').length, 1);
  assert.equal(called(fh, 'signed'), 1);
  assert.equal(h.session.reviewInternals.getSnapshot().accounts.length, 1);
  const put = requests.find((r) => r.options.method === 'PUT');
  assert.equal(put.url, host.baseUrl + '/api/v1/users/self');
  assert.equal(put.options.body, JSON.stringify({ user: { terms_of_use: true } }));
  f.m.unmount();
  console.log('PASS real terms ' + failure + ' retry preserves accepted consent and source');
}

// Entry retirement cannot reserve a new save intent over another source, even for shared bearers.
{
  const h = await harness({ empty: true });
  simpleTransport();
  const a = await verified(h),
    b = await verified(h);
  h.session.abandonSignIn(a);
  const blocker = deferred();
  const queued = h.session.reviewInternals.queueCredentialWrite(id, () => blocker.promise);
  const save = h.session.reviewInternals.addAccount(b);
  await tick();
  await rejectLocal(h.session.reviewInternals.addAccount(a), h.session);
  blocker.resolve();
  await queued;
  await save;
  assert.equal(h.control.sets.length, 1);
  console.log('PASS retired replay cannot supersede another pending source save');
}

{
  const h = await harness({ empty: true });
  const fh = formsHarness(h.session);
  fh.configure({ exchange: async () => response });
  simpleTransport();
  let f, outcome;
  const unsubscribe = h.session.reviewInternals.subscribe(() => {
    if (h.session.reviewInternals.getSnapshot().accounts.length) {
      const source = fh.sourceEvents[0][1];
      outcome = source.abandon();
      f.m.unmount();
    }
  });
  f = beginForm(fh);
  await tick();
  unsubscribe();
  assert.deepEqual(outcome, { status: 'released' }, 'adoption precedes synchronous index notification');
  assert.equal(called(fh, 'signed'), 0);
  assert.equal(called(fh, 'success'), 0);
  console.log('PASS source adopted before notification-driven form retirement');
}
{
  const h = await harness({ empty: true });
  simpleTransport();
  const pending = await verified(h);
  let reads = 0;
  const getter = Object.getOwnPropertyDescriptor(pending, 'credentials').get;
  Object.defineProperty(pending, 'credentials', {
    get() {
      reads++;
      return getter();
    },
  });
  const blocker = deferred();
  const queued = h.session.reviewInternals.queueCredentialWrite(id, () => blocker.promise);
  const save = h.session.reviewInternals.addAccount(pending);
  await tick();
  assert.equal(reads, 0);
  blocker.resolve();
  await queued;
  await save;
  assert.equal(reads, 1);
  console.log('PASS settled pending credentials captured once at native admission');
}
{
  const h = await harness({ empty: true });
  const requests = simpleTransport();
  const source = h.session.createOAuthSource(host, key);
  assert.deepEqual(source.abandon(), { status: 'released' });
  source.capture(response);
  const initial = h.session.reviewInternals.oauthSources.get(source).credentials;
  source.capture(response);
  assert.equal(h.session.reviewInternals.oauthSources.get(source).credentials, initial);
  assert.throws(() => source.capture({ ...response }), h.session.ObsoleteSignInError);
  await rejectLocal(h.session.verifyOAuth(host, response, key, { source }), h.session);
  assert.equal(requests.length, 0);
  console.log(
    'PASS late capture is idempotent and retired verification/replayed response is refused locally',
  );
}

{
  const h = await harness({ empty: true });
  simpleTransport();
  const a = await verified(h), b = await verified(h);
  h.control.beforeSecureWrite = () => { throw Error('ambiguous native rejection'); };
  await assert.rejects(h.session.reviewInternals.addAccount(a, { current: () => true }));
  await assert.rejects(h.session.reviewInternals.addAccount(b, { current: () => true }));
  h.control.beforeSecureWrite = undefined;
  await rejectLocal(h.session.reviewInternals.addAccount(a, { current: () => true }), h.session);
  assert.equal(h.control.sets.length, 2, 'later ambiguous admission fences older same-cache retry');
  await h.session.reviewInternals.addAccount(b, { current: () => true });
  assert.equal(h.control.sets.length, 3);
  console.log('PASS later ambiguous admission invalidates older retry without relying on cache publication');
}

{
  const h = await harness({ empty: true }); simpleTransport(); const pending = await verified(h);
  h.control.beforeSecureWrite = () => { throw Error('ambiguous native rejection'); };
  await assert.rejects(h.session.reviewInternals.addAccount(pending, { current: () => true }));
  assert.deepEqual(h.session.abandonSignIn(pending), { status: 'deferred', reason: 'persistence' });
  assert.deepEqual(h.session.abandonSignIn(pending), { status: 'deferred', reason: 'persistence' });
  h.control.beforeSecureWrite = undefined;
  await rejectLocal(h.session.reviewInternals.addAccount(pending, { current: () => true }), h.session);
  assert.equal(h.control.sets.length, 1); assert.equal(h.control.deletes.length, 0);
  console.log('PASS explicit local release fences uncertain retry even without an original form predicate');
}

{
  const h = await harness({ empty: true });
  simpleTransport();
  const mobileKey = { clientId: 'test-key', clientSecret: 'synthetic-mobile-secret', mobileVerify: true };
  const pending = await h.session.verifyOAuth(host, response, mobileKey);
  await h.session.reviewInternals.addAccount(pending);
  const saved = h.secure.get('easel.token.example.test_1');
  assert.equal(JSON.parse(saved).mobileVerify, true);
  const reloaded = await harness();
  reloaded.secure.set('easel.token.example.test_1', saved);
  assert.deepEqual(await reloaded.session.storedClientCredentials(id), mobileKey);
  let rotated = false;
  globalThis.fetch = async (url, init) => {
    if (url.endsWith('/login/oauth2/token')) {
      const fields = new URLSearchParams(init.body);
      assert.equal(fields.get('client_secret'), mobileKey.clientSecret);
      assert.equal(fields.get('refresh_token'), response.refresh_token);
      rotated = true;
      return json({ access_token: 'synthetic-mobile-rotated' });
    }
    return rotated ? json({ ok: true }) : json({}, 401);
  };
  const [{ client }] = await reloaded.session.loadStoredClients();
  await client.get('/api/test');
  assert.equal(rotated, true);
  assert.equal(JSON.parse(reloaded.secure.get('easel.token.example.test_1')).mobileVerify, true);
  assert.deepEqual(await reloaded.session.storedClientCredentials(id), mobileKey);
  console.log('PASS mobile credentials and OOB marker survive SecureStore reload and refresh');
}
