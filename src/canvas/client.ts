/**
 * Minimal Canvas REST client. Every request goes through here so auth,
 * pagination, and error handling behave the same everywhere.
 */

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];
export type Query = Record<string, QueryValue>;

export class CanvasError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = 'CanvasError';
  }
}

/**
 * The token is invalid, expired, or revoked, and couldn't be refreshed. The
 * account needs signing in again.
 */
export class CanvasAuthError extends CanvasError {
  constructor(path: string) {
    super('Canvas no longer accepts this sign-in.', 401, path);
    this.name = 'CanvasAuthError';
  }
}

/** The request never reached Canvas: offline, DNS, TLS, or timeout. */
export class CanvasNetworkError extends Error {
  constructor(message = "Couldn't reach Canvas. Check your connection.") {
    super(message);
    this.name = 'CanvasNetworkError';
  }
}

/**
 * The token endpoint refused a code, refresh token, or client
 * (`Canvas::OAuth::RequestError`). `code` is the OAuth error, such as
 * `invalid_grant` or `invalid_client`.
 */
export class CanvasOAuthError extends Error {
  constructor(
    readonly code: string,
    readonly description: string | null,
    readonly status: number,
  ) {
    super(description ?? code);
    this.name = 'CanvasOAuthError';
  }
}

/**
 * Supplies the access token for a client, and replaces it when Canvas says
 * it's dead (AUTH-8). Session code owns the implementation; one source per
 * account, so every client for that account shares a single refresh.
 */
export interface TokenSource {
  /** The token to send right now. */
  readonly accessToken: string;
  /** Whether a dead token can be replaced without the student. */
  readonly canRefresh: boolean;
  /** True shortly before a known expiry, so requests refresh first instead of failing. */
  shouldRefresh(): boolean;
  /**
   * A token newer than `stale`. Concurrent callers share one refresh, and a
   * caller whose token was already replaced gets the new one right away.
   * Throws `CanvasAuthError` when the account has to sign in again, and
   * `CanvasNetworkError` when Canvas can't be reached.
   */
  refresh(stale: string): Promise<string>;
}

/** A personal access token: it works until the student deletes it, and can't be refreshed. */
function staticToken(token: string): TokenSource {
  return {
    accessToken: token,
    canRefresh: false,
    shouldRefresh: () => false,
    refresh: () => Promise.reject(new CanvasAuthError('/')),
  };
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
};

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/;

export type CanvasHost = {
  /** e.g. `school.instructure.com`, or `localhost:3030` for the fake Canvas. */
  host: string;
  /** e.g. `https://school.instructure.com`. */
  baseUrl: string;
};

/**
 * Turns whatever a student types into a Canvas host. Accepts full URLs, bare
 * domains, and short names ("myschool" becomes myschool.instructure.com).
 */
export function normalizeHost(input: string): CanvasHost | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!value) return null;
  if (!LOCAL_HOSTS.test(value) && !value.includes('.')) value = `${value}.instructure.com`;
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(value)) return null;
  // Plain http only for local development servers.
  const scheme = LOCAL_HOSTS.test(value) ? 'http' : 'https';
  return { host: value, baseUrl: `${scheme}://${value}` };
}

function encodeQuery(query: Query = {}): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value)
        parts.push(`${encodeURIComponent(`${key}[]`)}=${encodeURIComponent(String(item))}`);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Canvas paginates with RFC 5988 Link headers. */
function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { errors?: { message?: string }[] | string; message?: string };
    if (Array.isArray(data.errors) && data.errors[0]?.message) return data.errors[0].message;
    if (typeof data.errors === 'string') return data.errors;
    // Validation errors arrive keyed by field: { errors: { attempt: [{ message }] } }.
    if (data.errors && typeof data.errors === 'object' && !Array.isArray(data.errors)) {
      const first = Object.values(data.errors as Record<string, { message?: string }[]>).flat()[0];
      if (first?.message) return first.message;
    }
    if (data.message) return data.message;
  } catch {
    // Not JSON.
  }
  return `Canvas returned an error (${response.status}).`;
}

export class CanvasClient {
  private readonly auth: TokenSource;

  /** `auth` is a personal access token, or a source that can refresh OAuth tokens. */
  constructor(
    readonly baseUrl: string,
    auth: string | TokenSource,
  ) {
    this.auth = typeof auth === 'string' ? staticToken(auth) : auth;
  }

  /**
   * Headers for authenticated requests outside the client (images, downloads).
   * OAuth tokens rotate, so read this when the request starts, not once up front.
   */
  get authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.auth.accessToken}` };
  }

  /** `authHeaders`, after refreshing a token that's about to expire. Prefer it for long downloads. */
  async freshAuthHeaders(): Promise<Record<string, string>> {
    await this.ensureFresh();
    return this.authHeaders;
  }

  url(path: string, query?: Query): string {
    const absolute = /^https?:\/\//.test(path)
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    return `${absolute}${encodeQuery(query)}`;
  }

  /** Refreshes ahead of a known expiry. Offline, the request goes ahead and reports its own error. */
  private async ensureFresh() {
    if (!this.auth.canRefresh || !this.auth.shouldRefresh()) return;
    try {
      await this.auth.refresh(this.auth.accessToken);
    } catch (error) {
      if (error instanceof CanvasAuthError) throw error;
    }
  }

  private async send(url: string, options: RequestOptions, path: string, retried = false): Promise<Response> {
    await this.ensureFresh();
    const token = this.auth.accessToken;
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        signal: options.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          // String IDs: Canvas IDs can exceed JavaScript's safe integer range.
          Accept: 'application/json+canvas-string-ids',
          ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      throw new CanvasNetworkError();
    }
    if (response.status === 401) {
      // Canvas marks a dead token with WWW-Authenticate (and "… access token" errors).
      // A 401 without it means "not allowed to see this", which must not sign the student out.
      const message = await errorMessage(response);
      if (response.headers.get('WWW-Authenticate') || /access token|authorization required/i.test(message)) {
        // OAuth tokens expire. Swap in a fresh one and try once more; every request
        // that hits this together waits on the same refresh.
        if (!retried && this.auth.canRefresh) {
          await this.auth.refresh(token);
          return this.send(url, options, path, true);
        }
        throw new CanvasAuthError(path);
      }
      throw new CanvasError(message, 403, path);
    }
    if (!response.ok) throw new CanvasError(await errorMessage(response), response.status, path);
    return response;
  }

  private async parse<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    // Canvas prefixes some JSON with a JSON-hijacking guard.
    return JSON.parse(text.replace(/^while\(1\);/, '')) as T;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(this.url(path, options.query), options, path);
    return this.parse<T>(response);
  }

  get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { query, signal });
  }

  /** One page, retaining Canvas's opaque next link for infinite queries. */
  async getPage<T>(path: string, query?: Query, signal?: AbortSignal): Promise<{ items: T[]; next: string | null }> {
    const url = this.url(path, query);
    if (new URL(url).origin !== new URL(this.baseUrl).origin) {
      throw new CanvasError('Invalid pagination origin.', 400, path);
    }
    const response = await this.send(url, { signal }, path);
    return { items: await this.parse<T[]>(response), next: nextLink(response.headers.get('Link')) };
  }

  /** Follows every `next` page. `maxPages` guards against runaway collections. */
  async getAll<T>(
    path: string,
    query?: Query,
    options: { signal?: AbortSignal; maxPages?: number } = {},
  ): Promise<T[]> {
    const results: T[] = [];
    let url: string | null = this.url(path, { per_page: 100, ...query });
    let pages = 0;
    while (url && pages < (options.maxPages ?? 50)) {
      const response = await this.send(url, { signal: options.signal }, path);
      const page = await this.parse<T[]>(response);
      if (Array.isArray(page)) results.push(...page);
      url = nextLink(response.headers.get('Link'));
      pages += 1;
    }
    return results;
  }

  post<T>(path: string, body?: unknown, query?: Query): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, query });
  }

  put<T>(path: string, body?: unknown, query?: Query): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, query });
  }

  delete<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', query });
  }
}

/** What `POST /login/oauth2/token` returns (`Canvas::OAuth::Token#as_json`). */
export type OAuthTokenResponse = {
  access_token: string;
  token_type?: string;
  /** Sent with a new grant, and on every refresh for public clients, which rotate it. */
  refresh_token?: string;
  /** Seconds. Absent when the developer key doesn't expire tokens. */
  expires_in?: number;
  user?: { id: string | number; name: string; effective_locale?: string };
  real_user?: { id: string | number; name: string };
};

/**
 * `POST /login/oauth2/token` (oauth2_provider_controller.rb#token), for the
 * `authorization_code` and `refresh_token` grants. Throws `CanvasOAuthError`
 * when Canvas refuses the grant or client, `CanvasNetworkError` when it can't
 * be reached, and `CanvasError` for anything else.
 */
export async function requestOAuthToken(
  baseUrl: string,
  params: Record<string, string | null | undefined>,
): Promise<OAuthTokenResponse> {
  const form = Object.entries(params)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/login/oauth2/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json+canvas-string-ids, application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
  } catch {
    throw new CanvasNetworkError();
  }
  const text = await response.text().catch(() => '');
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text.replace(/^while\(1\);/, '')) as Record<string, unknown>;
  } catch {
    // Not JSON: a proxy page, or not Canvas at all.
  }
  if (response.ok && typeof data.access_token === 'string') return data as unknown as OAuthTokenResponse;
  if ((response.status === 400 || response.status === 401) && typeof data.error === 'string') {
    throw new CanvasOAuthError(
      data.error,
      typeof data.error_description === 'string' ? data.error_description : null,
      response.status,
    );
  }
  throw new CanvasError(`Canvas returned an error (${response.status}).`, response.status, '/login/oauth2/token');
}

/**
 * Checks that a host runs Canvas before sending the student there to sign in.
 * Canvas answers an unauthenticated `/api/v1/users/self` with a JSON 401.
 * Resolves `'canvas'`, `'not-canvas'`, or throws `CanvasNetworkError`.
 */
export async function probeCanvas(baseUrl: string, signal?: AbortSignal): Promise<'canvas' | 'not-canvas'> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/users/self`, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new CanvasNetworkError();
  }
  if (response.status !== 401 && response.status !== 200) return 'not-canvas';
  const type = response.headers.get('Content-Type') ?? '';
  return type.includes('json') ? 'canvas' : 'not-canvas';
}
