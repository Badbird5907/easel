/* global __dirname */
// Headless protocol regression: actual OAuth/client/legal code, synthetic boundaries.
// No native, storage, account, browser, HTTP or entropy effects. No source snapshots.
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const redirect = 'easel://oauth/callback';
const host = Object.freeze({
  host: 'original.example.test',
  baseUrl: 'https://original.example.test:8443/canvas',
});
const key = Object.freeze({ clientId: 'synthetic client+&=/%é', clientSecret: 'synthetic secret+&=/%é' });
const rawDevice = '  École + / = & مدرسة  ';
const bytes = (size) => Uint8Array.from({ length: size }, (_, i) => (251 + i * 29) % 256);
const expectedVerifier = Buffer.from(bytes(32)).toString('base64url');
const expectedState = Buffer.from(bytes(16)).toString('base64url');
const expectedChallenge = createHash('sha256').update(expectedVerifier, 'utf8').digest('base64url');
const equal = (actual, expected) => assert.deepEqual(structuredClone(actual), expected);

// Extract only these independent public declarations. Never evaluate session's
// module initialization, storage, refresh or admission implementation (Task A).
const sessionFile = path.join(root, 'canvas/session.tsx');
const sessionSource = ts.createSourceFile(
  sessionFile,
  readFileSync(sessionFile, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const sessionDeclarations = sessionSource.statements.filter(
  (node) =>
    (ts.isClassDeclaration(node) && node.name?.text === 'SignInError') ||
    (ts.isVariableStatement(node) &&
      node.declarationList.declarations.length === 1 &&
      node.declarationList.declarations[0].name.getText(sessionSource) === 'OAUTH_REDIRECT_URI'),
);
assert.equal(sessionDeclarations.length, 2, 'required public session declarations');
const sources = new Map([
  ['@/canvas/session', sessionDeclarations.map((node) => node.getText(sessionSource)).join('\n')],
  ...['features/auth/oauth', 'canvas/client', 'canvas/api/legal'].map((id) => [
    '@/' + id,
    readFileSync(path.join(root, id + '.ts'), 'utf8'),
  ]),
]);
const compiled = new Map(
  [...sources].map(([id, source]) => [
    id,
    ts.transpileModule(source, {
      fileName: id + '.ts',
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  ]),
);

function harness({ os = 'ios', deviceName = rawDevice, modelName = 'synthetic model' } = {}) {
  const queue = { fetch: [], open: [], dismiss: [], random: [], digest: [] };
  const events = [],
    violations = [],
    cache = new Map();
  const unexpected = (label) => {
    violations.push(label);
    throw new Error('Unexpected synthetic boundary: ' + label);
  };
  const take = (kind, args) => {
    events.push([kind, ...args]);
    if (!queue[kind].length) return unexpected(kind);
    try {
      return queue[kind].shift()(...args);
    } catch (error) {
      // Transport/native assertions must survive production's intentional catches.
      if (error instanceof assert.AssertionError) violations.push('boundary assertion');
      throw error;
    }
  };
  const denied = (label) => () => unexpected(label);
  const mocks = {
    'expo-crypto': {
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
      CryptoEncoding: { BASE64: 'base64' },
      getRandomBytes: (...args) => take('random', args),
      digestStringAsync: async (...args) => take('digest', args),
    },
    'expo-device': { deviceName, modelName },
    'expo-web-browser': {
      openAuthSessionAsync: async (...args) => take('open', args),
      dismissAuthSession: (...args) => take('dismiss', args),
    },
    'react-native': { Platform: { OS: os } },
    '@tanstack/react-query': { useQuery: denied('query hook') },
    '@/canvas/query': { useCanvasQuery: denied('account query hook') },
  };
  const syntheticMath = Object.create(Math);
  syntheticMath.random = denied('random entropy');
  function load(id, parent = '@/entry') {
    if (id.startsWith('.')) id = path.posix.normalize(path.posix.dirname(parent) + '/' + id);
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (!compiled.has(id)) return unexpected('import');
    if (cache.has(id)) return cache.get(id).exports;
    const module = { exports: {} };
    cache.set(id, module);
    new vm.Script(compiled.get(id), { filename: id + '.ts' }).runInNewContext(
      {
        module,
        exports: module.exports,
        require: (name) => load(name, id),
        fetch: async (...args) => take('fetch', args),
        btoa: (value) => Buffer.from(value, 'latin1').toString('base64'),
        Error,
        URIError,
        URL,
        Math: syntheticMath,
        console: {
          log: denied('production logging'),
          warn: denied('production logging'),
          error: denied('production logging'),
        },
      },
      { timeout: 1000 },
    );
    return module.exports;
  }
  const session = load('@/canvas/session');
  assert.equal(session.OAUTH_REDIRECT_URI, redirect);
  return {
    oauth: load('@/features/auth/oauth'),
    client: load('@/canvas/client'),
    legal: load('@/canvas/api/legal'),
    SignInError: session.SignInError,
    queue,
    events,
    done() {
      equal(violations, []); // Unexpected calls cannot be hidden by production catch/fallback paths.
      for (const remaining of Object.values(queue))
        assert.equal(remaining.length, 0, 'unused synthetic boundary');
    },
  };
}
function planCrypto(h) {
  h.queue.random.push(
    (size) => {
      assert.equal(size, 32);
      return bytes(size);
    },
    (size) => {
      assert.equal(size, 16);
      return bytes(size);
    },
  );
  h.queue.digest.push((algorithm, input, options) => {
    assert.equal(algorithm, 'SHA-256');
    assert.equal(input, expectedVerifier);
    equal(options, { encoding: 'base64' });
    // SDK boundary uses padded base64; independent expected value uses Node base64url.
    return createHash('sha256').update(input, 'utf8').digest('base64');
  });
}
const request = (clientSecret = key.clientSecret) => ({
  url: host.baseUrl + '/login/oauth2/auth?synthetic=original',
  state: 'original state+&=/%é',
  verifier: 'synthetic verifier+&=/%é',
  host,
  key: { ...key, clientSecret },
  embedded: false,
  siteAdmin: false,
});
const callback = (query) => redirect + '?' + query;
const matches = (Class, message) => (error) => {
  assert.ok(error instanceof Class, 'expected production error class');
  if (message !== undefined) assert.equal(error.message, message);
  return true;
};
const response = (data, status = 200, options = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => options.headers?.[name] ?? null },
  text: async () => {
    if (options.textError) throw new Error('synthetic body failure');
    return options.raw ?? JSON.stringify(data);
  },
  json: async () => data,
});
const networkFailure = () => {
  throw new Error('synthetic offline');
};
const tokenResult = {
  access_token: 'synthetic-access',
  refresh_token: 'synthetic-refresh',
  expires_in: 3600,
  user: { id: 'synthetic-user', name: '  École مدرسة  ', effective_locale: 'ar' },
};
const tokenHeaders = {
  Accept: 'application/json+canvas-string-ids, application/json',
  'Content-Type': 'application/x-www-form-urlencoded',
};

async function authorization() {
  for (const mode of ['browser', 'canvas', 'site-admin', 'embedded']) {
    for (const provider of [undefined, '', 'synthetic provider+&=/%é']) {
      for (const forceLogin of [undefined, false, true]) {
        const h = harness();
        planCrypto(h);
        const result = await h.oauth.createAuthorization(host, key, {
          mode,
          authenticationProvider: provider,
          forceLogin,
        });
        assert.strictEqual(result.host, host);
        assert.strictEqual(result.key, key);
        assert.equal(result.verifier, expectedVerifier);
        assert.equal(result.state, expectedState);
        assert.equal(result.embedded, mode === 'embedded' || mode === 'site-admin');
        assert.equal(result.siteAdmin, mode === 'site-admin');
        const expected = {
          client_id: key.clientId,
          response_type: 'code',
          redirect_uri: redirect,
          state: expectedState,
          code_challenge: expectedChallenge,
          code_challenge_method: 'S256',
          purpose: 'Easel on ' + rawDevice,
        };
        if (mode === 'canvas') expected.canvas_login = '1';
        if (mode === 'site-admin') expected.canvas_sa_delegated = '1';
        if (provider && (mode === 'browser' || mode === 'embedded'))
          expected.authentication_provider = provider;
        if (forceLogin) expected.prompt = 'login';
        // URLSearchParams is independent of production's encoder. Spaces in the
        // original protocol are %20 rather than form-style +; fixtures avoid ~.
        const query = new URLSearchParams(expected).toString().replaceAll('+', '%20');
        assert.equal(result.url, host.baseUrl + '/login/oauth2/auth?' + query);
        equal(Object.fromEntries(new URL(result.url).searchParams), expected);
        equal(
          h.events.map(([kind]) => kind),
          ['random', 'digest', 'random'],
        );
        h.done();
      }
    }
  }
  for (const [deviceName, modelName, purpose] of [
    [rawDevice, 'ignored model', 'Easel on ' + rawDevice],
    [null, '  Modèle مدرسة  ', 'Easel on   Modèle مدرسة  '],
    ['', 'synthetic model', 'Easel on synthetic model'],
    [null, null, 'Easel on this device'],
    ['', '', 'Easel on this device'],
  ]) {
    const h = harness({ deviceName, modelName });
    assert.equal(h.oauth.tokenPurpose(), purpose);
    assert.equal(h.oauth.tokenPurpose(), purpose); // No random suffix, trimming or localization.
    planCrypto(h);
    const result = await h.oauth.createAuthorization(host, key, { mode: 'browser' });
    assert.equal(new URL(result.url).searchParams.get('purpose'), purpose);
    h.done();
  }
}

function callbacks() {
  const h = harness(),
    r = request(),
    state = encodeURIComponent(r.state);
  for (const [encoded, decoded] of [
    ['synthetic%2Bcode%26%3D%2F%25%C3%A9', 'synthetic+code&=/%é'],
    ['synthetic=code==', 'synthetic=code=='],
    ['synthetic+code%2Btail', 'synthetic code+tail'],
    ['%252B%2525', '%2B%25'],
  ])
    assert.equal(
      h.oauth.codeFromCallback(callback(`state=${state}&code=${encoded}#code=ignored`), r),
      decoded,
    );
  assert.equal(h.oauth.codeFromCallback(callback(`&st%61te=${state}&&code=synthetic`), r), 'synthetic');
  const mismatch = matches(h.SignInError, 'The sign-in response didn’t match this request. Try again.');
  for (const query of ['code=synthetic', 'state=wrong&code=synthetic', 'state=&code=synthetic', ''])
    assert.throws(() => h.oauth.codeFromCallback(callback(query), r), mismatch);
  for (const query of [`state=${state}`, `state=${state}&code=`])
    assert.throws(
      () => h.oauth.codeFromCallback(callback(query), r),
      matches(h.SignInError, 'Canvas didn’t send a sign-in code. Try again.'),
    );
  assert.throws(() => h.oauth.codeFromCallback(redirect + `#state=${state}&code=synthetic`, r), mismatch);
  const errors = [
    ['access_denied', h.oauth.SignInCanceled, 'Sign-in canceled.'],
    [
      'unauthorized_client',
      h.SignInError,
      `${host.host} hasn’t turned on Easel’s developer key. Ask your school’s Canvas admin to turn it on, or sign in with an access token.`,
    ],
    [
      'invalid_scope',
      h.SignInError,
      `The developer key for ${host.host} requires scopes, which Easel doesn’t support. Ask your school’s Canvas admin for a key without enforced scopes.`,
    ],
    [
      'client_not_allowed_for_user',
      h.SignInError,
      `Your account at ${host.host} isn’t allowed to use this developer key.`,
    ],
    ['unknown_synthetic_error', h.SignInError, 'Canvas couldn’t sign you in. Try again.'],
  ];
  // Existing policy: error mapping precedes state validation, even without state.
  for (const [error, Class, message] of errors)
    for (const suffix of ['', '&state=wrong', `&state=${state}`])
      assert.throws(
        () => h.oauth.codeFromCallback(callback(`error=${error}${suffix}`), r),
        matches(Class, message),
      );
  assert.throws(
    () => h.oauth.codeFromCallback(callback('error=synthetic&error_description=Raw+%2B%3D%26%C3%A9'), r),
    matches(h.SignInError, 'Canvas couldn’t sign you in: Raw +=&é'),
  );
  assert.equal(h.oauth.codeFromCallback(callback(`error=&state=${state}&code=synthetic`), r), 'synthetic');
  // Existing policy: last duplicate wins; malformed percent escapes propagate URIError.
  assert.equal(
    h.oauth.codeFromCallback(callback(`state=wrong&state=${state}&code=old&code=synthetic`), r),
    'synthetic',
  );
  assert.throws(() => h.oauth.codeFromCallback(callback(`state=${state}&code=%ZZ`), r), { name: 'URIError' });
  // isCallback is a case-sensitive prefix check, not URL authority/path validation.
  for (const value of [redirect, callback('code=synthetic'), redirect + '/suffix', redirect + '-suffix'])
    assert.equal(h.oauth.isCallback(value), true);
  for (const value of [
    'EASEL://oauth/callback',
    'https://other.example.test/' + redirect,
    'easel://oauth/logout',
    '',
  ])
    assert.equal(h.oauth.isCallback(value), false);
  // The parser itself does not call isCallback. This is compatibility, not OS acceptance.
  assert.equal(
    h.oauth.codeFromCallback(`https://other.example.test/?state=${state}&code=synthetic`, r),
    'synthetic',
  );
  h.done();
}

async function exchange() {
  for (const secret of [key.clientSecret, null, '', undefined]) {
    const h = harness(),
      r = request();
    r.key.clientSecret = secret;
    h.queue.fetch.push((url, init) => {
      assert.equal(url, host.baseUrl + '/login/oauth2/token');
      const prefix = 'grant_type=authorization_code&client_id=synthetic%20client%2B%26%3D%2F%25%C3%A9';
      const optional = secret ? '&client_secret=synthetic%20secret%2B%26%3D%2F%25%C3%A9' : '';
      const suffix =
        '&code=synthetic%20code%2B%26%3D%2F%25%C3%A9&code_verifier=synthetic%20verifier%2B%26%3D%2F%25%C3%A9&redirect_uri=easel%3A%2F%2Foauth%2Fcallback';
      equal(init, { method: 'POST', headers: tokenHeaders, body: prefix + optional + suffix });
      const params = new URLSearchParams(init.body);
      assert.equal(params.get('code'), 'synthetic code+&=/%é');
      assert.equal(params.has('client_secret'), !!secret);
      return response(tokenResult, 200, { raw: 'while(1);' + JSON.stringify(tokenResult) });
    });
    equal(await h.oauth.exchangeCode(r, 'synthetic code+&=/%é'), tokenResult);
    h.done();
  }
  // Exercise refresh serialization only. No session queue, expiry or rotation fallback is loaded.
  for (const secret of [key.clientSecret, null, '', undefined]) {
    const h = harness();
    h.queue.fetch.push((url, init) => {
      assert.equal(url, host.baseUrl + '/login/oauth2/token');
      equal(init, {
        method: 'POST',
        headers: tokenHeaders,
        body:
          'grant_type=refresh_token&client_id=synthetic%20client%2B%26%3D%2F%25%C3%A9' +
          (secret ? '&client_secret=synthetic%20secret%2B%26%3D%2F%25%C3%A9' : '') +
          '&refresh_token=synthetic%20refresh%2B%26%3D%2F%25%C3%A9',
      });
      return response({ access_token: 'synthetic-rotated' });
    });
    equal(
      await h.client.requestOAuthToken(host.baseUrl, {
        grant_type: 'refresh_token',
        client_id: key.clientId,
        client_secret: secret,
        refresh_token: 'synthetic refresh+&=/%é',
      }),
      { access_token: 'synthetic-rotated' },
    );
    h.done();
  }
}

async function tokenErrors() {
  const cases = [
    {
      status: 400,
      data: { error: 'invalid_client', error_description: 'synthetic raw description' },
      kind: 'oauth',
    },
    { status: 401, data: { error: 'invalid_grant' }, kind: 'oauth' },
    { status: 400, data: { error: 'synthetic_other', error_description: 7 }, kind: 'oauth' },
    { status: 403, data: { error: 'invalid_client' }, kind: 'server' },
    { status: 500, data: { error: 'invalid_grant' }, kind: 'server' },
    { status: 200, data: {}, kind: 'server' },
    { status: 200, data: { access_token: 7 }, kind: 'server' },
    { status: 502, data: {}, raw: '<html>synthetic proxy</html>', kind: 'server' },
    { status: 400, data: {}, textError: true, kind: 'server' },
    { kind: 'network' },
    { kind: 'abort' },
  ];
  for (const test of cases) {
    const h = harness();
    const reply = () => {
      if (test.kind === 'network') return networkFailure();
      if (test.kind === 'abort') {
        const error = new Error('synthetic abort');
        error.name = 'AbortError';
        throw error;
      }
      return response(test.data, test.status, test);
    };
    h.queue.fetch.push(reply, reply);
    await assert.rejects(
      h.client.requestOAuthToken(host.baseUrl, { grant_type: 'authorization_code' }),
      (error) => {
        if (test.kind === 'oauth') {
          assert.ok(error instanceof h.client.CanvasOAuthError);
          assert.equal(error.code, test.data.error);
          assert.equal(error.status, test.status);
          assert.equal(
            error.description,
            typeof test.data.error_description === 'string' ? test.data.error_description : null,
          );
        } else if (test.kind === 'server') {
          assert.ok(error instanceof h.client.CanvasError);
          assert.equal(error.status, test.status);
          assert.equal(error.path, '/login/oauth2/token');
          assert.equal(error.message, `Canvas returned an error (${test.status}).`);
        } else assert.ok(error instanceof h.client.CanvasNetworkError);
        return true;
      },
    );
    const message =
      test.kind === 'oauth'
        ? test.data.error === 'invalid_client'
          ? `Canvas didn’t accept the developer key for ${host.host}. Check the client ID and secret, or ask your school’s Canvas admin.`
          : 'Canvas didn’t accept the sign-in. It may have taken too long. Try again.'
        : test.kind === 'server'
          ? `${host.host} had a problem signing you in. Try again.`
          : `Couldn’t reach ${host.host}. Check your connection and try again.`;
    await assert.rejects(h.oauth.exchangeCode(request(), 'synthetic-code'), matches(h.SignInError, message));
    h.done();
  }
  const h = harness(),
    original = new Error('synthetic serializer failure'),
    r = request();
  Object.defineProperty(r.key, 'clientId', {
    get() {
      throw original;
    },
  });
  await assert.rejects(h.oauth.exchangeCode(r, 'synthetic-code'), (error) => error === original);
  h.done();
}

async function browser() {
  for (const os of ['ios', 'android']) {
    for (const result of [
      { type: 'success', url: callback('synthetic=original') },
      { type: 'cancel' },
      { type: 'dismiss' },
      { type: 'locked' },
      { type: 'opened' },
      { type: 'success', url: '' },
      { type: 'success' },
    ]) {
      const h = harness({ os }),
        r = request();
      h.queue.open.push((...args) => {
        equal(args, [r.url, redirect]);
        return result;
      });
      if (result.type === 'success' && result.url)
        assert.equal(await h.oauth.authorizeInBrowser(r), result.url);
      else
        await assert.rejects(
          h.oauth.authorizeInBrowser(r),
          matches(h.oauth.SignInCanceled, 'Sign-in canceled.'),
        );
      equal(
        h.events.map(([kind]) => kind),
        ['open'],
      );
      h.done();
    }
    for (const outcome of ['success', 'cancel', 'reject']) {
      const h = harness({ os }),
        r = request();
      h.queue.open.push((...args) => {
        equal(args, [r.url, redirect]);
        throw new Error('synthetic already open');
      });
      if (os === 'ios')
        h.queue.dismiss.push((...args) => {
          equal(args, []);
        });
      h.queue.open.push((...args) => {
        equal(args, [r.url, redirect]);
        if (outcome === 'reject') throw new Error('synthetic second failure');
        return outcome === 'success'
          ? { type: 'success', url: callback('synthetic=retry') }
          : { type: 'cancel' };
      });
      if (outcome === 'success')
        assert.equal(await h.oauth.authorizeInBrowser(r), callback('synthetic=retry'));
      else
        await assert.rejects(
          h.oauth.authorizeInBrowser(r),
          matches(
            outcome === 'cancel' ? h.oauth.SignInCanceled : h.SignInError,
            outcome === 'cancel'
              ? 'Sign-in canceled.'
              : 'Couldn’t open the sign-in page. Try again, or choose Sign in inside Easel.',
          ),
        );
      equal(
        h.events.map(([kind]) => kind),
        os === 'ios' ? ['open', 'dismiss', 'open'] : ['open', 'open'],
      );
      h.done(); // A third attempt is forbidden even if production swallows the boundary exception.
    }
  }
  const h = harness();
  h.queue.open.push(networkFailure);
  h.queue.dismiss.push(networkFailure);
  await assert.rejects(
    h.oauth.authorizeInBrowser(request()),
    matches(h.SignInError, 'Couldn’t open the sign-in page. Try again, or choose Sign in inside Easel.'),
  );
  equal(
    h.events.map(([kind]) => kind),
    ['open', 'dismiss'],
  );
  h.done();
}

function expectApi(h, apiPath, reply, { method = 'GET', body, signal, query = '' } = {}) {
  h.queue.fetch.push((url, init) => {
    assert.equal(url, host.baseUrl + apiPath + query);
    assert.strictEqual(init.signal, signal);
    equal(init, {
      method,
      signal,
      headers: {
        Authorization: 'Bearer synthetic-legal-access',
        Accept: 'application/json+canvas-string-ids',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return reply();
  });
}
async function legal() {
  const sessionPath = '/api/v1/login/session_token';
  for (const value of [true, false, undefined, null, 'true', 1]) {
    const h = harness(),
      client = new h.client.CanvasClient(host.baseUrl, 'synthetic-legal-access');
    expectApi(h, sessionPath, () => response({ requires_terms_acceptance: value }), {
      query: '?return_to=https%3A%2F%2Foriginal.example.test%3A8443%2Fcanvas%2F',
    });
    assert.equal(await h.legal.fetchRequiresTerms(client), value === true);
    h.done();
  }
  for (const reply of [
    networkFailure,
    () => response({}, 503),
    () => response({}, 401, { headers: { 'WWW-Authenticate': 'Bearer' } }),
    () => response({}, 200, { raw: 'synthetic malformed JSON' }),
  ]) {
    const h = harness(),
      client = new h.client.CanvasClient(host.baseUrl, 'synthetic-legal-access');
    expectApi(h, sessionPath, reply, {
      query: '?return_to=https%3A%2F%2Foriginal.example.test%3A8443%2Fcanvas%2F',
    });
    assert.equal(await h.legal.fetchRequiresTerms(client), false);
    h.done();
  }
  for (const fail of [false, true]) {
    const h = harness(),
      client = new h.client.CanvasClient(host.baseUrl, 'synthetic-legal-access');
    expectApi(h, '/api/v1/users/self', () => response({}, fail ? 503 : 204, { raw: '' }), {
      method: 'PUT',
      body: { user: { terms_of_use: true } },
    });
    if (fail) await assert.rejects(h.legal.acceptTerms(client), matches(h.client.CanvasError));
    else assert.equal(await h.legal.acceptTerms(client), undefined);
    h.done();
  }
  const raw = '  <p dir="rtl">RAW École + &amp; مدرسة</p>\n';
  const url = 'https://policy.example.test/RAW?lang=é&value=+#شروط';
  const fallback = host.baseUrl + '/terms_of_use';
  for (const test of [
    { tos: { terms_type: 'no_terms', content: raw }, expected: { html: null, url: fallback, none: true } },
    { tos: { terms_type: 'custom', content: raw }, expected: { html: raw, url: fallback, none: false } },
    {
      tos: { terms_type: 'default', content: ' \n' },
      policy: { content: raw, redirectUrl: url },
      expected: { html: raw, url, none: false },
    },
    { tos: {}, policy: { content: ' \n', redirectUrl: url }, expected: { html: null, url, none: false } },
    { tos: {}, policy: {}, expected: { html: null, url: fallback, none: false } },
    { failure: true, policy: {}, expected: { html: null, url: fallback, none: false } },
  ]) {
    const h = harness(),
      client = new h.client.CanvasClient(host.baseUrl, 'synthetic-legal-access');
    // Inert signal identity, not a live controller or native request.
    const signal = { synthetic: 'signal' };
    expectApi(
      h,
      '/api/v1/accounts/self/terms_of_service',
      test.failure ? networkFailure : () => response(test.tos),
      { signal },
    );
    if (test.policy)
      expectApi(
        h,
        '/api/v1/acceptable_use_policy',
        test.failure ? networkFailure : () => response(test.policy),
        { signal },
      );
    equal(await h.legal.fetchTerms(client, signal), test.expected);
    h.done();
  }
}

async function mobileOAuth() {
  const h = harness();
  planCrypto(h);
  const mobileHost = { host: 'canonical.example.test', baseUrl: 'https://canonical.example.test' };
  const mobileKey = { ...key, mobileVerify: true };
  const r = await h.oauth.createAuthorization(mobileHost, mobileKey, { mode: 'browser' });
  const auth = new URL(r.url);
  assert.equal(auth.searchParams.get('redirect_uri'), 'urn:ietf:wg:oauth:2.0:oob');
  assert.equal(auth.searchParams.get('mobile'), '1');
  assert.equal(r.embedded, true);
  const callback = mobileHost.baseUrl + '/login/oauth2/auth?code=synthetic&state=' + encodeURIComponent(r.state);
  assert.equal(h.oauth.isCallback(callback, r), true);
  assert.equal(h.oauth.isCallback(r.url, r), false);
  assert.equal(h.oauth.codeFromCallback(callback, r), 'synthetic');
  for (const bad of [callback.replace('canonical.example.test', 'attacker.test'), callback.replace('/auth?', '/auth/other?'), callback.replace('https:', 'http:'), 'easel://oauth/callback?code=synthetic&state=' + r.state]) {
    assert.equal(h.oauth.isCallback(bad, r), false);
    assert.throws(() => h.oauth.codeFromCallback(bad, r), h.SignInError);
  }
  assert.throws(() => h.oauth.codeFromCallback(callback.replace(r.state, 'wrong'), r), h.SignInError);
  h.queue.fetch.push((url, init) => {
    assert.equal(url, mobileHost.baseUrl + '/login/oauth2/token');
    const fields = new URLSearchParams(init.body);
    assert.equal(fields.get('redirect_uri'), 'urn:ietf:wg:oauth:2.0:oob');
    assert.equal(fields.get('client_secret'), mobileKey.clientSecret);
    assert.equal(fields.get('code_verifier'), r.verifier);
    return response(tokenResult);
  });
  await h.oauth.exchangeCode(r, 'synthetic');
  h.done();
}

async function main() {
  for (const [label, run] of [
    ['mobile OAuth embedded OOB, origin/state and exchange', mobileOAuth],
    ['authorization PKCE, purpose and mode matrix', authorization],
    ['callback decoding and current policy boundaries', callbacks],
    ['code exchange and refresh transport serialization', exchange],
    ['production token error classes and sign-in mappings', tokenErrors],
    ['browser arguments, cancellation and bounded platform retry', browser],
    ['legal transport, fallbacks and raw content', legal],
  ]) {
    await run();
    console.log('PASS ' + label);
  }
  console.log('PASS synthetic protocol suite; native/server/session acceptance unverified');
}
main().catch((error) => {
  // All inputs are synthetic; assertion details are safe and useful for regressions.
  console.error('FAIL synthetic protocol suite', error);
  process.exitCode = 1;
});
