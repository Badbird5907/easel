import assert from 'node:assert/strict';
import { parseCanvasQrLogin, exchangeQrLogin, ExpiredQrLoginError } from './qrLogin.ts';
import { CanvasNetworkError, CanvasOAuthError } from './client.ts';

const url = 'https://sso.canvaslms.com/canvas/login?domain=school.example.test&code_android=synthetic%2Bcode&code_ios=ignored';
const login = parseCanvasQrLogin(url);
assert.deepEqual(login, { host: { host: 'school.example.test', baseUrl: 'https://school.example.test' }, code: 'synthetic+code' });
for (const host of ['sso.beta.canvaslms.com', 'sso.test.canvaslms.com']) assert.ok(parseCanvasQrLogin(url.replace('sso.canvaslms.com', host)));
for (const bad of [
  '', 'not a URL', url.replace('https:', 'http:'), url.replace('sso.canvaslms.com', 'sso.canvaslms.com.evil.test'),
  url.replace('https://', 'https://user:password@'), url + '#fragment', url + '&domain=other.test', url + '&code_android=other',
  url.replace('code_android=', 'code_android_teacher='), url.replace('code_android=', 'code_android_parent='),
  url.replace('synthetic%2Bcode', ''), url.replace('synthetic%2Bcode', '%0a'),
  ...['http://school.test', 'https://user:pass@school.test', 'school.test/path', 'school.test:1234', 'localhost', '127.0.0.1', 'school.test?x=y'].map(domain => url.replace('school.example.test', encodeURIComponent(domain))),
]) assert.equal(parseCanvasQrLogin(bad), null, 'Reject malformed or unrelated QR input');
const oldFetch = globalThis.fetch;
try {
  globalThis.fetch = async (input, init) => {
    assert.equal(input, 'https://school.example.test/login/oauth2/token');
    assert.equal(init.method, 'POST');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)), {
      grant_type: 'authorization_code', client_id: 'synthetic-client', client_secret: 'synthetic-secret',
      code: 'synthetic+code', redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    });
    return Response.json({ access_token: 'synthetic-token', refresh_token: 'synthetic-refresh' });
  };
  const key = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret', mobileVerify: true };
  assert.equal((await exchangeQrLogin(login.host, key, login.code)).access_token, 'synthetic-token');
  globalThis.fetch = async () => Response.json({ error: 'invalid_grant', error_description: 'sensitive detail' }, { status: 400 });
  await assert.rejects(exchangeQrLogin(login.host, key, login.code), ExpiredQrLoginError);
  globalThis.fetch = async () => Response.json({ error: 'invalid_client' }, { status: 401 });
  await assert.rejects(exchangeQrLogin(login.host, key, login.code), CanvasOAuthError);
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(exchangeQrLogin(login.host, key, login.code), CanvasNetworkError);
} finally { globalThis.fetch = oldFetch; }
console.log('PASS Canvas Student QR parsing, exact trusted hosts, code exchange and expired-code handling');
