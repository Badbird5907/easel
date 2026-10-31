import { type CanvasHost, CanvasOAuthError, normalizeHost, requestOAuthToken } from './client';
import type { ClientCredentials } from './session';

const QR_HOSTS = new Set(['sso.canvaslms.com', 'sso.beta.canvaslms.com', 'sso.test.canvaslms.com']);
export type CanvasQrLogin = { host: CanvasHost; code: string };

/** Only the Student Android grant matches the candroid discovery client, on either platform. */
export function parseCanvasQrLogin(value: string): CanvasQrLogin | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !QR_HOSTS.has(url.hostname) || url.port || url.username || url.password || url.hash) return null;
    if (url.searchParams.getAll('domain').length !== 1 || url.searchParams.getAll('code_android').length !== 1) return null;
    const domain = url.searchParams.get('domain')!;
    const code = url.searchParams.get('code_android')!;
    if (!code.trim() || /[\s\x00-\x1f\x7f]/.test(code)) return null;
    const school = new URL(domain.includes('://') ? domain : `https://${domain}`);
    if (school.protocol !== 'https:' || school.username || school.password || school.port || school.search || school.hash || school.pathname !== '/') return null;
    const host = normalizeHost(school.hostname);
    if (!host || !host.baseUrl.startsWith('https://') || !school.hostname.includes('.') || /^[\d.]+$/.test(school.hostname) || school.hostname.endsWith('.localhost')) return null;
    return { host, code };
  } catch {
    return null;
  }
}

export class ExpiredQrLoginError extends Error {}

/** Match Android QRLogin -> OAuthAPI.getToken. The QR grant has no app-created PKCE verifier. */
export async function exchangeQrLogin(host: CanvasHost, key: ClientCredentials, code: string) {
  try {
    return await requestOAuthToken(host.baseUrl, {
      grant_type: 'authorization_code',
      client_id: key.clientId,
      client_secret: key.clientSecret,
      code,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    });
  } catch (error) {
    if (error instanceof CanvasOAuthError && error.code === 'invalid_grant') throw new ExpiredQrLoginError();
    throw error;
  }
}
