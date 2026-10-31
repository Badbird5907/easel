import assert from 'node:assert/strict';
import { discoverMobileCredentials, MOBILE_VERIFY_USER_AGENT, MobileVerifyError } from './mobileVerify.ts';

const host = { host: 'alias.example.test', baseUrl: 'https://alias.example.test' };
const valid = { result: 0, authorized: true, client_id: 'synthetic-id', client_secret: 'synthetic-secret', base_url: 'https://canonical.example.test/' };
const original = globalThis.fetch;
try {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://sso.canvaslms.com');
    assert.equal(url.pathname, '/api/v1/mobile_verify.json');
    assert.equal(url.searchParams.get('domain'), host.host);
    assert.equal(url.searchParams.get('user_agent'), MOBILE_VERIFY_USER_AGENT);
    assert.equal(new Headers(init?.headers).get('User-Agent'), MOBILE_VERIFY_USER_AGENT);
    assert.equal(init?.redirect, 'error');
    return Response.json(valid);
  };
  assert.deepEqual(await discoverMobileCredentials(host), {
    host: { host: 'canonical.example.test', baseUrl: 'https://canonical.example.test' },
    key: { clientId: 'synthetic-id', clientSecret: 'synthetic-secret', mobileVerify: true },
  });
  for (const data of [null, [], {}, { ...valid, result: 3 }, { ...valid, result: 2 }, { ...valid, authorized: false }, { ...valid, client_secret: '' }, { ...valid, client_id: 123 }, ...['http://school.test/', 'https://user:password@school.test/', 'https://school.test/path', 'https://school.test/?secret=oops', 'javascript:alert(1)'].map(base_url => ({ ...valid, base_url }))]) {
    globalThis.fetch = async () => Response.json(data);
    await assert.rejects(discoverMobileCredentials(host), MobileVerifyError);
  }
  globalThis.fetch = async () => new Response('sensitive service details', { status: 503 });
  await assert.rejects(discoverMobileCredentials(host), error => error instanceof MobileVerifyError && !error.message.includes('sensitive'));
  const controller = new AbortController();
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  const pending = discoverMobileCredentials(host, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  console.log('PASS mobile verification parsing, canonical hosts, rejection and cancellation');
} finally {
  globalThis.fetch = original;
}
