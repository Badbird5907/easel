import { type CanvasHost, normalizeHost } from './client';

/** Instructure's mobile app selector; retain Easel's identity in the compatibility UA. */
export const MOBILE_VERIFY_USER_AGENT = 'candroid Easel/1.0';
const ENDPOINT = 'https://sso.canvaslms.com/api/v1/mobile_verify.json';

export class MobileVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MobileVerifyError';
  }
}

/** Credentials stay in memory until the session saves them to SecureStore. Never log responses. */
export async function discoverMobileCredentials(host: CanvasHost, signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${ENDPOINT}?domain=${encodeURIComponent(host.host)}&user_agent=${encodeURIComponent(MOBILE_VERIFY_USER_AGENT)}`, {
      headers: { Accept: 'application/json', 'User-Agent': MOBILE_VERIFY_USER_AGENT, 'Cache-Control': 'no-store' },
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) throw new MobileVerifyError('Canvas mobile sign-in is unavailable. Try again, or use a developer key or access token.');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object') throw new MobileVerifyError('Canvas returned an invalid mobile sign-in response.');
    const value = data as Record<string, unknown>;
    if (value.result === 2) throw new MobileVerifyError(`${host.host} doesn’t allow mobile sign-in. Use a developer key or access token.`);
    if (value.result === 3) throw new MobileVerifyError('Canvas doesn’t recognize this mobile sign-in client. Use a developer key or access token.');
    if (value.result !== 0 || value.authorized !== true)
      throw new MobileVerifyError('Canvas didn’t authorize mobile sign-in. Use a developer key or access token.');
    if (typeof value.client_id !== 'string' || !value.client_id.trim() || typeof value.client_secret !== 'string' || !value.client_secret.trim())
      throw new MobileVerifyError('Canvas didn’t return mobile sign-in credentials. Use a developer key or access token.');
    // This trusted service can canonicalize a school alias. Never send credentials over HTTP.
    let canonical = host;
    if (value.base_url !== undefined && value.base_url !== '') {
      if (typeof value.base_url !== 'string') throw new MobileVerifyError('Canvas returned an invalid school address.');
      const url = new URL(value.base_url);
      const normalized = normalizeHost(url.host);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || normalized?.baseUrl !== url.origin)
        throw new MobileVerifyError('Canvas returned an invalid school address.');
      canonical = normalized;
    }
    if (!canonical.baseUrl.startsWith('https://')) throw new MobileVerifyError('Mobile sign-in requires a secure school address.');
    return { host: canonical, key: { clientId: value.client_id, clientSecret: value.client_secret, mobileVerify: true as const } };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof MobileVerifyError) throw error;
    throw new MobileVerifyError('Couldn’t reach Canvas mobile sign-in. Try again, or use a developer key or access token.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
