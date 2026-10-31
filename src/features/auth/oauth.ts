import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import {
  CanvasError,
  type CanvasHost,
  CanvasNetworkError,
  CanvasOAuthError,
  type OAuthTokenResponse,
  probeCanvas,
  requestOAuthToken,
} from '@/canvas/client';
import { type ClientCredentials, OAUTH_REDIRECT_URI, SignInError } from '@/canvas/session';

/**
 * How the Canvas sign-in page is reached (AUTH-3 to AUTH-5).
 * - `browser`: the school's usual sign-in, in the system auth browser.
 * - `canvas`: `canvas_login=1`, Canvas's own username and password form instead of SSO.
 * - `site-admin`: `canvas_sa_delegated`, for Canvas administrators. Canvas reads it as a
 *   cookie, which only an in-app web view can set, so it always signs in inside Easel.
 * - `embedded`: the school's usual sign-in inside Easel, for IdPs that break in the browser.
 */
export type LoginMode = 'browser' | 'canvas' | 'site-admin' | 'embedded';

const MOBILE_REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';
const redirectUri = (key: ClientCredentials) => key.mobileVerify ? MOBILE_REDIRECT_URI : OAUTH_REDIRECT_URI;

export type AuthorizationRequest = {
  url: string;
  state: string;
  verifier: string;
  host: CanvasHost;
  key: ClientCredentials;
  /** Sign in inside Easel rather than in the system browser. */
  embedded: boolean;
  siteAdmin: boolean;
};

/** Thrown when the student closes the browser or cancels on Canvas's authorize page. */
export class SignInCanceled extends Error {
  constructor() {
    super('Sign-in canceled.');
    this.name = 'SignInCanceled';
  }
}

const base64Url = (base64: string) => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function randomString(bytes: number): string {
  const data = Crypto.getRandomBytes(bytes);
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return base64Url(btoa(binary));
}

/** RFC 7636 S256: Canvas supports only that method (lib/canvas/oauth/pkce.rb). */
async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomString(32);
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return { verifier, challenge: base64Url(digest) };
}

/** Labels the token in the student's Canvas settings, under Approved integrations (AUTH-2). */
export function tokenPurpose(): string {
  const device = Device.deviceName || Device.modelName || 'this device';
  return `Easel on ${device}`;
}

/** Builds `/login/oauth2/auth` with PKCE, state, and the login mode's parameters. */
export async function createAuthorization(
  host: CanvasHost,
  key: ClientCredentials,
  options: {
    mode: LoginMode;
    /** Bundled school entries can name an `authentication_provider` (AUTH-4). */
    authenticationProvider?: string;
    /** Ask Canvas for a fresh login even if the browser is signed in, for adding another account. */
    forceLogin?: boolean;
  },
): Promise<AuthorizationRequest> {
  const { verifier, challenge } = await pkce();
  const state = randomString(16);
  const params: Record<string, string> = {
    client_id: key.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(key),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    purpose: tokenPurpose(),
  };
  if (key.mobileVerify) params.mobile = '1';
  if (options.mode === 'canvas') params.canvas_login = '1';
  if (options.mode === 'site-admin') params.canvas_sa_delegated = '1';
  else if (options.authenticationProvider && options.mode !== 'canvas')
    params.authentication_provider = options.authenticationProvider;
  if (options.forceLogin) params.prompt = 'login';
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return {
    url: `${host.baseUrl}/login/oauth2/auth?${query}`,
    state,
    verifier,
    host,
    key,
    embedded: !!key.mobileVerify || options.mode === 'embedded' || options.mode === 'site-admin',
    siteAdmin: options.mode === 'site-admin',
  };
}

/** Confirms the host runs Canvas, so a typo fails here instead of in a blank browser. */
export async function checkSchool(host: CanvasHost) {
  try {
    if ((await probeCanvas(host.baseUrl)) === 'not-canvas')
      throw new SignInError(`${host.host} doesn’t look like a Canvas site. Check the address.`);
  } catch (error) {
    if (error instanceof CanvasNetworkError)
      throw new SignInError(`Couldn’t reach ${host.host}. Check the address and your connection.`);
    throw error;
  }
}

/**
 * Opens the authorize page in the system auth browser (AUTH-3):
 * ASWebAuthenticationSession on iOS, Custom Tabs on Android. Shares the
 * browser's cookies, so existing SSO sessions and password managers work.
 * Resolves the callback URL; throws `SignInCanceled` if the student closes it.
 */
export async function authorizeInBrowser(request: AuthorizationRequest): Promise<string> {
  const open = () => WebBrowser.openAuthSessionAsync(request.url, OAUTH_REDIRECT_URI);
  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await open();
  } catch {
    // A session left over from before a reload blocks a new one ("already open"): close it, try once more.
    try {
      if (Platform.OS === 'ios') WebBrowser.dismissAuthSession();
      result = await open();
    } catch {
      throw new SignInError('Couldn’t open the sign-in page. Try again, or choose Sign in inside Easel.');
    }
  }
  if (result.type === 'success' && result.url) return result.url;
  throw new SignInCanceled();
}

/** Whether a URL is the OAuth redirect. */
export const isCallback = (url: string, request?: AuthorizationRequest) => {
  if (!request?.key.mobileVerify) return url.startsWith(OAUTH_REDIRECT_URI);
  try {
    const parsed = new URL(url);
    return !parsed.username && !parsed.password && parsed.origin === new URL(request.host.baseUrl).origin &&
      parsed.pathname === '/login/oauth2/auth' &&
      (parsed.searchParams.has('code') || parsed.searchParams.has('error'));
  } catch {
    return false;
  }
};

/** Errors `final_redirect` can send back (oauth2_provider_controller.rb#auth). */
function callbackError(error: string, description: string | null, host: string, mobileVerify = false): Error {
  switch (error) {
    case 'access_denied':
      return new SignInCanceled();
    case 'unauthorized_client':
      return new SignInError(
        mobileVerify ? `${host} hasn’t enabled this mobile sign-in key. Use a developer key or access token.` : `${host} hasn’t turned on Easel’s developer key. Ask your school’s Canvas admin to turn it on, or sign in with an access token.`,
      );
    case 'invalid_scope':
      return new SignInError(
        `The developer key for ${host} requires scopes, which Easel doesn’t support. Ask your school’s Canvas admin for a key without enforced scopes.`,
      );
    case 'client_not_allowed_for_user':
      return new SignInError(`Your account at ${host} isn’t allowed to use this developer key.`);
    default:
      return new SignInError(description ? `Canvas couldn’t sign you in: ${description}` : 'Canvas couldn’t sign you in. Try again.');
  }
}

/** Reads the authorization code out of the redirect, checking `state`. */
export function codeFromCallback(url: string, request: AuthorizationRequest): string {
  if (request.key.mobileVerify && !isCallback(url, request))
    throw new SignInError('The sign-in response came from an unexpected address. Try again.');
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const params = new Map<string, string>();
  for (const part of query.split('&')) {
    if (!part) continue;
    const [key, ...rest] = part.split('=');
    params.set(decodeURIComponent(key), decodeURIComponent(rest.join('=').replace(/\+/g, ' ')));
  }
  if (request.key.mobileVerify && params.get('state') !== request.state)
    throw new SignInError('The sign-in response didn’t match this request. Try again.');
  const error = params.get('error');
  if (error) throw callbackError(error, params.get('error_description') ?? null, request.host.host, request.key.mobileVerify);
  if (params.get('state') !== request.state)
    throw new SignInError('The sign-in response didn’t match this request. Try again.');
  const code = params.get('code');
  if (!code) throw new SignInError('Canvas didn’t send a sign-in code. Try again.');
  return code;
}

/** Trades the code for tokens (`authorization_code` grant with the PKCE verifier). */
export async function exchangeCode(request: AuthorizationRequest, code: string): Promise<OAuthTokenResponse> {
  try {
    return await requestOAuthToken(request.host.baseUrl, {
      grant_type: 'authorization_code',
      client_id: request.key.clientId,
      client_secret: request.key.clientSecret ?? undefined,
      code,
      code_verifier: request.verifier,
      redirect_uri: redirectUri(request.key),
    });
  } catch (error) {
    if (error instanceof CanvasOAuthError) {
      if (error.code === 'invalid_client')
        throw new SignInError(
          `Canvas didn’t accept the developer key for ${request.host.host}. Check the client ID and secret, or ask your school’s Canvas admin.`,
        );
      throw new SignInError('Canvas didn’t accept the sign-in. It may have taken too long. Try again.');
    }
    if (error instanceof CanvasNetworkError)
      throw new SignInError(`Couldn’t reach ${request.host.host}. Check your connection and try again.`);
    if (error instanceof CanvasError) throw new SignInError(`${request.host.host} had a problem signing you in. Try again.`);
    throw error;
  }
}
