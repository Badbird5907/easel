import { displayGeneration, invalidateDisplayJobs, removeDisplayPreferences } from '@/i18n/account-preferences';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  CanvasAuthError,
  CanvasClient,
  CanvasError,
  type CanvasHost,
  CanvasNetworkError,
  CanvasOAuthError,
  normalizeHost,
  type OAuthTokenResponse,
  requestOAuthToken,
  type TokenSource,
} from './client';
import type { CanvasUser } from './types';

/** Where Canvas sends the browser after sign-in (AUTH-2). Developer keys must list it. */
export const OAUTH_REDIRECT_URI = 'easel://oauth/callback';
/** Closes the auth browser after SSO single logout, for identity providers that redirect back. */
export const OAUTH_LOGOUT_URI = 'easel://oauth/logout';

export type AuthMethod = 'token' | 'oauth';

/** A signed-in Canvas account. Secrets never leave secure storage except in memory. */
export type Account = {
  /** `<host>_<userId>`; stable across sign-ins. */
  id: string;
  host: string;
  baseUrl: string;
  user: { id: string; name: string; shortName: string; avatarUrl: string | null };
  /** A pasted personal access token, or OAuth through a developer key (AUTH-2, AUTH-6). */
  authMethod: AuthMethod;
  addedAt: string;
  /** Set when Canvas rejects the sign-in and it can't be refreshed; the account stays listed until fixed or removed. */
  expired?: boolean;
};

/** Everything secret about an account. Lives only in SecureStore (AUTH-9). */
export type Credentials = {
  accessToken: string;
  /** OAuth only. Public clients get a new one on every refresh. */
  refreshToken: string | null;
  /** Epoch milliseconds when Canvas said the access token expires, if it said. */
  expiresAt: number | null;
  /** When the access token was issued, to refresh a little before it expires. */
  issuedAt: number | null;
  /** The developer key that issued the token, needed to refresh it. */
  clientId: string | null;
  clientSecret: string | null;
};

/** A developer key's client credentials (AUTH-2, AUTH-6). */
export type ClientCredentials = { clientId: string; clientSecret?: string | null };

type StoredIndex = { accounts: Account[]; activeId: string | null };

const INDEX_KEY = 'easel.accounts';
const tokenKey = (accountId: string) => `easel.token.${accountId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

// Background refresh reads tokens while the phone is locked, and tokens shouldn't move to a new
// device through a backup: Easel drops accounts whose credentials didn't come along.
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/**
 * Refresh this long before Canvas's stated expiry, so requests don't race it:
 * a minute, or a quarter of the token's life for short-lived tokens.
 */
const REFRESH_EARLY_MS = 60_000;

function refreshDue(credentials: Credentials | null): boolean {
  if (!credentials?.expiresAt) return false;
  const lifetime = credentials.issuedAt ? credentials.expiresAt - credentials.issuedAt : Infinity;
  return Date.now() >= credentials.expiresAt - Math.min(REFRESH_EARLY_MS, lifetime / 4);
}

let accountIndexReadable = false;

async function readIndex(): Promise<StoredIndex> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const stored = raw ? JSON.parse(raw) as StoredIndex : { accounts: [], activeId: null };
    accountIndexReadable = true;
    return stored;
  } catch {
    // The UI can recover, but background reconciliation must not interpret an unreadable index as removal.
    accountIndexReadable = false;
  }
  return { accounts: [], activeId: null };
}

/** Older builds stored `authMethod: 'token'` only, or nothing. */
function migrateAccount(raw: Account): Account {
  return { ...raw, authMethod: raw.authMethod === 'oauth' ? 'oauth' : 'token' };
}

type ReadResult = { credentials: Credentials; legacy: boolean } | null;

/**
 * Reads an account's credentials. Older builds stored the bare token string;
 * those come back as `legacy` so they can be rewritten in the current format.
 * Resolves null when nothing is stored, and throws when the keychain is locked.
 */
async function readCredentials(accountId: string): Promise<ReadResult> {
  const raw = await SecureStore.getItemAsync(tokenKey(accountId));
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try {
      const data = JSON.parse(raw) as Partial<Credentials>;
      if (typeof data.accessToken === 'string' && data.accessToken) {
        return {
          legacy: false,
          credentials: {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken ?? null,
            expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : null,
            issuedAt: typeof data.issuedAt === 'number' ? data.issuedAt : null,
            clientId: data.clientId ?? null,
            clientSecret: data.clientSecret ?? null,
          },
        };
      }
    } catch {
      // Fall through: treat it as a bare token.
    }
  }
  return {
    legacy: true,
    credentials: {
      accessToken: raw,
      refreshToken: null,
      expiresAt: null,
      issuedAt: null,
      clientId: null,
      clientSecret: null,
    },
  };
}

const credentialWrites = new Map<string, Promise<void>>();
function queueCredentialWrite(accountId: string, action: () => Promise<void>): Promise<void> {
  const queued = (credentialWrites.get(accountId) ?? Promise.resolve()).catch(() => {}).then(action);
  credentialWrites.set(accountId, queued);
  return queued.finally(() => {
    if (credentialWrites.get(accountId) === queued) credentialWrites.delete(accountId);
  });
}

function setCredentials(accountId: string, credentials: Credentials) {
  return SecureStore.setItemAsync(tokenKey(accountId), JSON.stringify({ v: 1, ...credentials }), SECURE_OPTIONS);
}

async function writeCredentials(accountId: string, credentials: Credentials, current?: () => boolean) {
  await queueCredentialWrite(accountId, async () => {
    if (current && !current()) throw new CanvasAuthError('/login/oauth2/token');
    await setCredentials(accountId, credentials);
  });
}

/** Expiry fields from a token response's `expires_in` seconds. */
function expiryFrom(expiresIn: number | undefined): Pick<Credentials, 'expiresAt' | 'issuedAt'> {
  if (typeof expiresIn !== 'number' || expiresIn <= 0) return { expiresAt: null, issuedAt: null };
  const now = Date.now();
  return { expiresAt: now + expiresIn * 1000, issuedAt: now };
}

/*
 * Accounts live in one module-level store, shared by React and by code outside
 * it (background refresh, notification taps), so a token refreshed in one place
 * is the token everywhere. Public OAuth clients rotate refresh tokens on every
 * refresh, so two copies refreshing on their own would sign the student out.
 */

type Snapshot = StoredIndex & { loaded: boolean };

let snapshot: Snapshot = { loaded: false, accounts: [], activeId: null };
const listeners = new Set<() => void>();
const credentialCache = new Map<string, Credentials>();
const clients = new Map<string, CanvasClient>();
const clientDisplayGenerations = new WeakMap<CanvasClient, string | null>();
const replacingCredentials = new Map<string, object>();
const saveIntents = new Map<string, object>();
// Admission reservation is separate from removingAccounts: explicit revocation may still refresh.
const removalReservations = new Map<string, { done?: Promise<void> }>();
let selectionIntent: object | null = null;
const removingAccounts = new Set<string>();
let loading: Promise<void> | null = null;
let writes: Promise<void> = Promise.resolve();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;

/** Updates the index in memory right away, then saves it. Saves run in order. */
function commitIndex(accounts: Account[], activeId: string | null): Promise<void> {
  for (const previous of snapshot.accounts) {
    if (!accounts.some((a) => a.id === previous.id)) removeDisplayPreferences(previous.id);
  }
  snapshot = { loaded: true, accounts, activeId };
  accountIndexReadable = true;
  for (const listener of listeners) listener();
  writes = writes
    .then(() => AsyncStorage.setItem(INDEX_KEY, JSON.stringify({ accounts, activeId })))
    .catch(() => {});
  return writes;
}

function ensureLoaded(): Promise<void> {
  loading ??= (async () => {
    const stored = await readIndex();
    const accounts: Account[] = [];
    let changed = false;
    for (const raw of stored.accounts) {
      const account = migrateAccount(raw);
      if (account.authMethod !== raw.authMethod) changed = true;
      let result: ReadResult;
      try {
        result = await readCredentials(account.id);
      } catch {
        // Keychain locked (a background task before first unlock): keep the account, try again later.
        accounts.push(account);
        continue;
      }
      // Gone from the keychain (restored from a backup without it): drop the account.
      if (!result) {
        removeDisplayPreferences(account.id);
        changed = true;
        continue;
      }
      credentialCache.set(account.id, result.credentials);
      // Rewrite bare tokens as JSON, readable while the phone is locked.
      if (result.legacy) await writeCredentials(account.id, result.credentials).catch(() => {});
      accounts.push(account);
    }
    const activeId = accounts.some((a) => a.id === stored.activeId) ? stored.activeId : (accounts[0]?.id ?? null);
    if (changed || activeId !== stored.activeId) await commitIndex(accounts, activeId);
    else {
      snapshot = { loaded: true, accounts, activeId };
      for (const listener of listeners) listener();
    }
  })();
  return loading;
}

/** Retries credentials that couldn't be read at load, now that the keychain may be unlocked. */
async function loadMissingCredentials() {
  for (const account of snapshot.accounts) {
    if (credentialCache.has(account.id) || saveIntents.has(account.id) || removalReservations.has(account.id)) continue;
    const generation = displayGeneration(account.id);
    const result = await readCredentials(account.id).catch(() => undefined);
    // A read started before a save/removal must not adopt old credentials or erase new membership.
    if (snapshot.accounts.find((a) => a.id === account.id) !== account ||
        displayGeneration(account.id) !== generation || credentialCache.has(account.id) ||
        saveIntents.has(account.id) || removalReservations.has(account.id)) continue;
    if (result) credentialCache.set(account.id, result.credentials);
    else if (result === null) {
      const accounts = snapshot.accounts.filter((a) => a.id !== account.id);
      const activeId = snapshot.activeId === account.id ? (accounts[0]?.id ?? null) : snapshot.activeId;
      await commitIndex(accounts, activeId);
    }
  }
}

/** Marks an account as needing sign-in again (AUTH-8). Its data and settings stay. */
export async function markAccountExpired(accountId: string, sourceClient?: CanvasClient) {
  await ensureLoaded();
  if (sourceClient && !isStoredAccountClient(accountId, sourceClient)) return;
  if (!snapshot.accounts.some((a) => a.id === accountId && !a.expired)) return;
  invalidateDisplayJobs(accountId);
  await commitIndex(
    snapshot.accounts.map((a) => (a.id === accountId ? { ...a, expired: true } : a)),
    snapshot.activeId,
  );
}

/**
 * Updates the name or picture saved with an account after the student edits
 * their profile (SET-6), so the account switcher shows the change right away.
 */
export async function updateAccountUser(accountId: string, patch: Partial<Account['user']>) {
  await ensureLoaded();
  if (!snapshot.accounts.some((a) => a.id === accountId)) return;
  await commitIndex(
    snapshot.accounts.map((a) => (a.id === accountId ? { ...a, user: { ...a.user, ...patch } } : a)),
    snapshot.activeId,
  );
}

/**
 * Refreshes OAuth tokens (AUTH-8): one refresh at a time, shared by every
 * request that needs it. A refresh token Canvas refuses means the student has
 * to sign in again; a network failure doesn't.
 */
class RefreshingTokens implements TokenSource {
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly read: () => Credentials | null,
    private readonly write: (next: Credentials, options?: { persist?: boolean }) => Promise<void>,
    /** What's saved, which another runtime (a background task) may have refreshed and rotated. */
    private readonly reload: () => Promise<Credentials | null>,
    private readonly onDead: () => Promise<void>,
    private readonly pendingGuard?: () => void,
  ) {}

  get accessToken() {
    this.pendingGuard?.();
    return this.read()?.accessToken ?? '';
  }

  get canRefresh() {
    this.pendingGuard?.();
    const credentials = this.read();
    return !!credentials?.refreshToken && !!credentials.clientId;
  }

  shouldRefresh() {
    return refreshDue(this.read());
  }

  refresh(stale: string): Promise<string> {
    this.pendingGuard?.();
    const current = this.read();
    // Someone already replaced the token this caller used.
    if (current && current.accessToken !== stale && !this.shouldRefresh())
      return Promise.resolve(current.accessToken);
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Pending writes only update their own closure, never the stored credential queue. */
  async settle(): Promise<void> {
    await this.inflight;
  }

  private async run(): Promise<string> {
    let credentials = this.read();
    const saved = await this.reload().catch(() => null);
    // Adopt saved tokens only when they're newer than ours, never an older copy.
    if (saved && saved.accessToken !== credentials?.accessToken && (saved.expiresAt ?? 0) > (credentials?.expiresAt ?? 0)) {
      credentials = saved;
      await this.write(saved, { persist: false });
      if (!this.shouldRefresh()) return saved.accessToken;
    }
    if (!credentials?.refreshToken || !credentials.clientId) {
      await this.onDead();
      throw new CanvasAuthError('/login/oauth2/token');
    }

    this.pendingGuard?.();
    let response: OAuthTokenResponse;
    try {
      response = await requestOAuthToken(this.baseUrl, {
        grant_type: 'refresh_token',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
      });
    } catch (error) {
      // invalid_grant: the refresh token was revoked or rotated away. invalid_client: the key
      // was deleted or its secret changed. Either way, only signing in again fixes it.
      if (error instanceof CanvasOAuthError) {
        await this.onDead();
        throw new CanvasAuthError('/login/oauth2/token');
      }
      throw error;
    }
    const next: Credentials = {
      ...credentials,
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? credentials.refreshToken,
      ...expiryFrom(response.expires_in),
    };
    await this.write(next);
    return next.accessToken;
  }
}

/** One client per account, shared everywhere, so refreshes and their queues are too. */
function clientFor(account: Account): CanvasClient | null {
  const credentials = credentialCache.get(account.id);
  if (!credentials) return null;
  const existing = clients.get(account.id);
  if (existing && existing.baseUrl === account.baseUrl) return existing;
  const current = (): boolean => isStoredAccountClient(account.id, client);
  const client: CanvasClient =
    account.authMethod === 'oauth'
      ? new CanvasClient(
          account.baseUrl,
          new RefreshingTokens(
            account.baseUrl,
            () => current() ? credentialCache.get(account.id) ?? null : null,
            async (next, { persist = true } = {}) => {
              if (!current()) throw new CanvasAuthError('/login/oauth2/token');
              if (persist) await writeCredentials(account.id, next, current).catch(() => {});
              if (!current()) throw new CanvasAuthError('/login/oauth2/token');
              credentialCache.set(account.id, next);
            },
            async () => {
              if (!current()) return null;
              const saved = await readCredentials(account.id);
              return current() ? saved?.credentials ?? null : null;
            },
            () => markAccountExpired(account.id, client),
          ),
        )
      : new CanvasClient(account.baseUrl, {
          get accessToken() {
            return current() ? credentialCache.get(account.id)?.accessToken ?? '' : '';
          },
          canRefresh: false,
          shouldRefresh: () => false,
          refresh: () => Promise.reject(new CanvasAuthError('/')),
        });
  clients.set(account.id, client);
  clientDisplayGenerations.set(client, displayGeneration(account.id));
  return client;
}

/**
 * Every saved account with a client, for code outside React (background
 * refresh, notification taps). Expired accounts are skipped. OAuth clients
 * refresh their own tokens, sharing the refresh with the app.
 */
export async function loadStoredClients(): Promise<{ account: Account; client: CanvasClient }[]> {
  await ensureLoaded();
  await loadMissingCredentials();
  const loaded: { account: Account; client: CanvasClient }[] = [];
  for (const account of snapshot.accounts) {
    if (account.expired) continue;
    const client = clientFor(account);
    if (client) loaded.push({ account, client });
  }
  return loaded;
}

/** Synchronous job guard: rejects removed/expired accounts and old clients after re-add. */
export function isStoredAccountClient(accountId: string, client: CanvasClient): boolean {
  return !replacingCredentials.has(accountId) && !removingAccounts.has(accountId) &&
    snapshot.accounts.some((a) => a.id === accountId && !a.expired) &&
    credentialCache.has(accountId) && clients.get(accountId) === client &&
    clientDisplayGenerations.get(client) === displayGeneration(accountId);
}

export type StoredAccountLifetime = { accountId: string; generation: string | null };

/** Local reminders need saved membership, not an unlocked keychain. Null means membership is unknown. */
export async function loadStoredAccountLifetimes(): Promise<StoredAccountLifetime[] | null> {
  await ensureLoaded();
  if (!accountIndexReadable) return null;
  await loadMissingCredentials();
  return snapshot.accounts
    .filter((account) => !account.expired && !removingAccounts.has(account.id))
    .map((account) => ({ accountId: account.id, generation: displayGeneration(account.id) }));
}

export function isStoredAccountLifetime(lifetime: StoredAccountLifetime): boolean {
  return accountIndexReadable && !removingAccounts.has(lifetime.accountId) &&
    snapshot.accounts.some((a) => a.id === lifetime.accountId && !a.expired) &&
    displayGeneration(lifetime.accountId) === lifetime.generation;
}

/** The developer key an account signed in with, to sign in again with the same one. */
export async function storedClientCredentials(accountId: string): Promise<ClientCredentials | null> {
  await ensureLoaded();
  const credentials = credentialCache.get(accountId);
  return credentials?.clientId ? { clientId: credentials.clientId, clientSecret: credentials.clientSecret } : null;
}

type AccountCleanup = (accountId: string) => Promise<void> | void;
const cleanups = new Set<AccountCleanup>();

/**
 * Runs when an account is removed, so features can drop that account's data
 * (AUTH-10): cached queries, scheduled reminders, downloaded files. Returns an
 * unregister function.
 */
export function registerAccountCleanup(cleanup: AccountCleanup): () => void {
  cleanups.add(cleanup);
  return () => cleanups.delete(cleanup);
}

async function runAccountCleanups(accountId: string) {
  await Promise.all([...cleanups].map((cleanup) => Promise.resolve(cleanup(accountId)).catch(() => {})));
}

export class SignInError extends Error {}

/** Local save admission ended; this is not evidence of Canvas authentication failure. */
export class ObsoleteSignInError extends Error {}

export type AddAccountOptions = {
  expectedAccountId?: string;
  /** The original caller operation. Only checked before the noncancellable native write. */
  current?: () => boolean;
};

/**
 * A sign-in that Canvas accepted but Easel hasn't saved yet, so the student can
 * accept terms of use first (AUTH-7). Save it with `addAccount`, or throw it
 * away with `discardSignIn`.
 */
export type PendingSignIn = {
  account: Account;
  credentials: Credentials;
  /** Works before the account is saved, and refreshes if it sits a while. */
  client: CanvasClient;
};

export type AbandonSignInOutcome =
  | { status: 'released' }
  | { status: 'deferred'; reason: 'unknown' | 'persistence' };

/** An exchange owns a source before it has tokens; no secrets are exposed on this handle. */
export type OAuthSource = {
  capture: (response: OAuthTokenResponse) => void;
  abandon: () => AbandonSignInOutcome;
};

type PendingOAuthState = {
  phase: 'active' | 'sealing' | 'admitted' | 'adopted' | 'uncertain' | 'retired';
  released: boolean;
  credentials?: Credentials;
  response?: OAuthTokenResponse;
  tokens?: RefreshingTokens;
  client?: CanvasClient;
  current: () => boolean;
  host: CanvasHost;
  key: ClientCredentials;
  retryCurrent?: () => boolean;
  sealTicket?: object;
};
const oauthSources = new WeakMap<OAuthSource, PendingOAuthState>();
const pendingSources = new WeakMap<PendingSignIn, PendingOAuthState>();
// Admission identities only, not a bearer registry. Even a later ambiguous write invalidates
// retry of an older uncertain source whose cache/membership never changed.
const lastCredentialAdmission = new Map<string, object>();

function abandonSource(source: PendingOAuthState): AbandonSignInOutcome {
  source.released = true;
  if (source.phase === 'admitted' || source.phase === 'uncertain')
    return { status: 'deferred', reason: 'persistence' };
  if (source.phase === 'adopted') return { status: 'released' };
  source.phase = 'retired';
  // Even distinct bearers can address one Canvas token record. Never automatically DELETE.
  return source.credentials ? { status: 'deferred', reason: 'unknown' } : { status: 'released' };
}

function requirePending(source: PendingOAuthState) {
  if (!source.current()) abandonSource(source);
  if (source.phase !== 'active') throw new ObsoleteSignInError();
}

export function createOAuthSource(host: CanvasHost, key: ClientCredentials, current = () => true): OAuthSource {
  const state: PendingOAuthState = { phase: 'active', released: false, host, key, current };
  const handle: OAuthSource = {
    capture(response) {
      if (state.response) {
        if (state.response !== response) throw new ObsoleteSignInError();
        return;
      }
      // Capture even after retirement: an already-entered exchange cannot be canceled locally.
      state.response = response;
      state.credentials = {
        accessToken: response.access_token,
        refreshToken: response.refresh_token ?? null,
        ...expiryFrom(response.expires_in),
        clientId: key.clientId,
        clientSecret: key.clientSecret ?? null,
      };
    },
    abandon: () => abandonSource(state),
  };
  oauthSources.set(handle, state);
  return handle;
}

/** Local retirement only. Explicit decline/rejection still uses discardSignIn. */
export function abandonSignIn(pending: PendingSignIn): AbandonSignInOutcome {
  const source = pendingSources.get(pending);
  if (source) return abandonSource(source);
  return pending.account.authMethod === 'oauth'
    ? { status: 'deferred', reason: 'unknown' } : { status: 'released' };
}

function pendingClient(source: PendingOAuthState): CanvasClient {
  requirePending(source);
  source.tokens = new RefreshingTokens(
    source.host.baseUrl,
    () => source.credentials ?? null,
    async (next) => {
      // An entered rotation belongs to this source even if its form has since retired.
      source.credentials = next;
    },
    async () => null,
    async () => {},
    () => requirePending(source),
  );
  source.client = new CanvasClient(source.host.baseUrl, source.tokens);
  return source.client;
}

async function sealPending(source: PendingOAuthState, ticket: object) {
  requirePending(source);
  source.phase = 'sealing';
  source.sealTicket = ticket;
  await source.tokens?.settle();
  if (!source.current() || source.phase !== 'sealing') throw new ObsoleteSignInError();
}

async function fetchAccount(host: CanvasHost, client: CanvasClient, authMethod: AuthMethod): Promise<Account> {
  let user: CanvasUser;
  try {
    user = await client.get<CanvasUser>('/api/v1/users/self');
  } catch (error) {
    if (error instanceof ObsoleteSignInError) throw error;
    if (error instanceof CanvasAuthError)
      throw new SignInError(
        authMethod === 'token'
          ? 'Canvas didn’t accept that token. Check that you copied all of it.'
          : 'Canvas didn’t accept the sign-in. Try again.',
      );
    if (error instanceof CanvasNetworkError)
      throw new SignInError(`Couldn’t reach ${host.host}. Check the address and your connection.`);
    if (error instanceof CanvasError && error.status === 404)
      throw new SignInError(`${host.host} doesn’t look like a Canvas site.`);
    if (error instanceof SyntaxError) throw new SignInError(`${host.host} doesn’t look like a Canvas site.`);
    throw new SignInError((error as Error).message);
  }
  return {
    id: `${host.host}_${user.id}`,
    host: host.host,
    baseUrl: host.baseUrl,
    user: {
      id: String(user.id),
      name: user.name,
      shortName: user.short_name || user.name,
      avatarUrl: user.avatar_url ?? null,
    },
    authMethod,
    addedAt: new Date().toISOString(),
  };
}

/** Checks a personal access token against Canvas (AUTH-6). */
export async function verifyToken(domainInput: string, token: string): Promise<PendingSignIn> {
  const host = normalizeHost(domainInput);
  if (!host) throw new SignInError('Enter your school’s Canvas address, like school.instructure.com.');
  const trimmed = token.trim();
  if (!trimmed) throw new SignInError('Paste an access token from your Canvas settings.');
  const credentials: Credentials = {
    accessToken: trimmed,
    refreshToken: null,
    expiresAt: null,
    issuedAt: null,
    clientId: null,
    clientSecret: null,
  };
  const client = new CanvasClient(host.baseUrl, trimmed);
  return { account: await fetchAccount(host, client, 'token'), credentials, client };
}

/** Turns a token endpoint response into a sign-in (AUTH-2). */
export async function verifyOAuth(
  host: CanvasHost,
  response: OAuthTokenResponse,
  key: ClientCredentials,
  options: { source?: OAuthSource } = {},
): Promise<PendingSignIn> {
  const handle = options.source ?? createOAuthSource(host, key);
  const source = oauthSources.get(handle);
  if (!source || source.host.baseUrl !== host.baseUrl || source.key.clientId !== key.clientId ||
      source.key.clientSecret !== key.clientSecret) throw new ObsoleteSignInError();
  if (!source.response) handle.capture(response);
  else if (source.response !== response) throw new ObsoleteSignInError();
  requirePending(source);
  // A source verifies once. Replaying a callback cannot create an independent refreshing client.
  if (source.client) throw new ObsoleteSignInError();
  const client = pendingClient(source);
  try {
    const account = await fetchAccount(host, client, 'oauth');
    requirePending(source);
    const pending: PendingSignIn = {
      account,
      get credentials() { return source.credentials!; },
      client,
    };
    pendingSources.set(pending, source);
    return pending;
  } catch (error) {
    abandonSource(source);
    throw error;
  }
}

/**
 * `DELETE /login/oauth2/token` (AUTH-10). Resolves Canvas's `forward_url` for
 * SSO single logout, if any. Never throws: signing out works offline too.
 */
async function revokeOAuth(client: CanvasClient, { endSessions = true } = {}): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const result = await client.request<{ forward_url?: string } | undefined>('/login/oauth2/token', {
      method: 'DELETE',
      query: endSessions ? { expire_sessions: 1 } : undefined,
      signal: controller.signal,
    });
    return result?.forward_url ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Throws away a sign-in the student didn't finish: revokes its OAuth token. */
export async function discardSignIn(pending: PendingSignIn) {
  if (pending.account.authMethod === 'oauth') await revokeOAuth(pending.client);
}

type SessionState = {
  status: 'loading' | 'ready';
  accounts: Account[];
  active: Account | null;
  /** Client for the active account; null when signed out or expired. */
  client: CanvasClient | null;
  signInWithToken: (domain: string, token: string) => Promise<Account>;
  /**
   * Saves a verified sign-in and makes it active. With `expectedAccountId` (signing in again),
   * a different user is refused and the new token revoked.
   */
  addAccount: (pending: PendingSignIn, options?: AddAccountOptions) => Promise<Account>;
  switchAccount: (id: string) => Promise<void>;
  /** Revokes OAuth tokens, runs account cleanups, and forgets the account (AUTH-10). */
  signOut: (id: string) => Promise<void>;
  markExpired: (id: string) => void;
};

const SessionContext = createContext<SessionState | null>(null);

/** Message for signing in again as someone else (AUTH-8). */
export function wrongAccountMessage(signedInAs: Account, expected: Account): string {
  return `You signed in as ${signedInAs.user.name}, but this account belongs to ${expected.user.name}. Sign in as ${expected.user.shortName} to continue, or remove this account and add ${signedInAs.user.shortName}’s instead.`;
}

async function addAccount(pending: PendingSignIn, options: AddAccountOptions = {}): Promise<Account> {
  if (options.current && !options.current()) throw new ObsoleteSignInError();
  const source = pendingSources.get(pending);
  if (source) {
    if (source.phase === 'uncertain') {
      if (source.released || !source.current() || !options.current || !source.retryCurrent?.()) throw new ObsoleteSignInError();
    } else requirePending(source);
  }
  const id = pending.account.id;
  if (removalReservations.has(id)) throw new ObsoleteSignInError();
  const ticket = {};
  saveIntents.set(id, ticket);
  selectionIntent = ticket;
  const eligible = () => {
    if ((options.current && !options.current()) || saveIntents.get(id) !== ticket ||
        removalReservations.has(id) || (options.current && !accountIndexReadable) ||
        (options.expectedAccountId && (!snapshot.accounts.some((a) => a.id === options.expectedAccountId) ||
          removalReservations.has(options.expectedAccountId)))) throw new ObsoleteSignInError();
  };
  try {
    await ensureLoaded();
    eligible();
    const expected = snapshot.accounts.find((a) => a.id === options.expectedAccountId);
    if (expected && id !== expected.id) {
      await discardSignIn(pending);
      throw new SignInError(wrongAccountMessage(pending.account, expected));
    }
    // Seal outside the stored queue: only pending refreshes (closure writes) are drained here.
    // An ambiguous native failure may retry the same frozen credentials only while the original
    // form and saved lifetime/cache are unchanged. It must never restart pending refresh/consent.
    const retrying = source?.phase === 'uncertain';
    if (source) {
      if (retrying) {
        if (source.released || !source.current() || !options.current || !source.retryCurrent?.()) throw new ObsoleteSignInError();
      } else await sealPending(source, ticket);
    }
    let account!: Account;
    await queueCredentialWrite(id, async () => {
      eligible();
      if (source && (!source.current() || (retrying
        ? source.phase !== 'uncertain' || source.released || !source.retryCurrent?.()
        : source.phase !== 'sealing'))) throw new ObsoleteSignInError();
      // One final capture, after pending refresh settlement and queue waiting.
      const credentials = pending.credentials;
      const previousAccount = snapshot.accounts.find((a) => a.id === id);
      const previousCredentials = credentialCache.get(id);
      const generation = displayGeneration(id);
      replacingCredentials.set(id, ticket);
      try {
        // Last eligibility check and native invocation have no intervening await. Once entered,
        // session owns the save even if the form retires or a newer save/removal reserves intent.
        eligible();
        lastCredentialAdmission.set(id, ticket);
        if (source) {
          source.phase = 'admitted';
          source.retryCurrent = () => lastCredentialAdmission.get(id) === ticket && snapshot.accounts.find((a) => a.id === id) === previousAccount &&
            credentialCache.get(id) === previousCredentials && displayGeneration(id) === generation;
        }
        try {
          await setCredentials(id, credentials);
        } catch (error) {
          if (source) source.phase = 'uncertain';
          throw error;
        }
        if (lastCredentialAdmission.get(id) === ticket) lastCredentialAdmission.delete(id);
        if (source) source.phase = 'adopted';
        const existing = snapshot.accounts.find((a) => a.id === id);
        account = existing ? { ...pending.account, addedAt: existing.addedAt } : pending.account;
        invalidateDisplayJobs(id);
        credentialCache.set(id, credentials);
        clients.delete(id);
        // Finish ownership before commitIndex notifies subscribers (which may unmount the form).
        if (replacingCredentials.get(id) === ticket) replacingCredentials.delete(id);
        const accounts = existing
          ? snapshot.accounts.map((a) => a.id === id ? account : a)
          : [...snapshot.accounts, account];
        const activeId = selectionIntent === ticket ? id
          : accounts.some((a) => a.id === snapshot.activeId) ? snapshot.activeId : (accounts[0]?.id ?? null);
        await commitIndex(accounts, activeId);
      } finally {
        if (replacingCredentials.get(id) === ticket) replacingCredentials.delete(id);
      }
    });
    // Do not implicitly revoke the old OAuth grant: Canvas can reuse its token record for
    // the new bearer. Retaining that grant is safer than deleting accepted credentials.
    return account;
  } finally {
    if (source?.phase === 'sealing' && source.sealTicket === ticket) {
      // Failed/obsolete preparation is retryable if its original form still owns the source.
      if (source.current()) source.phase = 'active';
      else abandonSource(source);
    }
    if (saveIntents.get(id) === ticket) saveIntents.delete(id);
  }
}

function signOutAccount(id: string): Promise<void> {
  const reserved = removalReservations.get(id);
  if (reserved) return reserved.done!;
  const ticket: { done?: Promise<void> } = {};
  removalReservations.set(id, ticket);
  saveIntents.delete(id);
  selectionIntent = ticket;
  ticket.done = (async () => {
    try {
      await ensureLoaded();
      // Let admitted saves publish before choosing the target. Waiting saves fail admission.
      await queueCredentialWrite(id, async () => {});
      const account = snapshot.accounts.find((a) => a.id === id);
      const credentials = credentialCache.get(id);
      let forwardUrl: string | null = null;
      // Explicit OAuth revocation stays OUTSIDE the credential queue: it can refresh there.
      // A pasted personal access token belongs to the student and is never revoked here.
      if (account?.authMethod === 'oauth' && credentials) {
        const client = account.expired
          ? new CanvasClient(account.baseUrl, credentials.accessToken)
          : (clientFor(account) ?? new CanvasClient(account.baseUrl, credentials.accessToken));
        forwardUrl = await revokeOAuth(client);
      }
      removingAccounts.add(id);
      await queueCredentialWrite(id, () => SecureStore.deleteItemAsync(tokenKey(id))).catch(() => {});
      credentialCache.delete(id);
      clients.delete(id);
      removeDisplayPreferences(id);
      await runAccountCleanups(id);
      const accounts = snapshot.accounts.filter((a) => a.id !== id);
      const activeId = snapshot.activeId === id ? (accounts[0]?.id ?? null) : snapshot.activeId;
      await commitIndex(accounts, activeId);
      // SSO single logout uses the same browser as sign-in.
      if (forwardUrl && /^https?:\/\//.test(forwardUrl)) {
        WebBrowser.openAuthSessionAsync(forwardUrl, OAUTH_LOGOUT_URI).catch(() => {});
      }
    } finally {
      if (removalReservations.get(id) === ticket) {
        removalReservations.delete(id);
        removingAccounts.delete(id);
      }
    }
  })();
  return ticket.done;
}

async function switchAccount(id: string) {
  selectionIntent = {};
  if (snapshot.accounts.some((a) => a.id === id)) await commitIndex(snapshot.accounts, id);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const store = useSyncExternalStore(subscribe, getSnapshot);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureLoaded()
      .then(loadMissingCredentials)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signInWithToken = useCallback(
    async (domain: string, token: string) => addAccount(await verifyToken(domain, token)),
    [],
  );

  const markExpired = useCallback((id: string) => {
    markAccountExpired(id).catch(() => {});
  }, []);

  const active = store.accounts.find((a) => a.id === store.activeId) ?? null;
  // Stable per account: refreshing a token doesn't make a new client.
  const client = useMemo(() => (active && !active.expired ? clientFor(active) : null), [active]);

  const value = useMemo<SessionState>(
    () => ({
      status: ready && store.loaded ? 'ready' : 'loading',
      accounts: store.accounts,
      active,
      client,
      signInWithToken,
      addAccount,
      switchAccount,
      signOut: signOutAccount,
      markExpired,
    }),
    [ready, store, active, client, signInWithToken, markExpired],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionState {
  const session = use(SessionContext);
  if (!session) throw new Error('useSession() must be used inside <SessionProvider>.');
  return session;
}

/** The active account and its client. Only call from screens behind the signed-in guard. */
export function useCanvas(): { account: Account; client: CanvasClient } {
  const { active, client } = useSession();
  if (!active || !client) throw new Error('useCanvas() needs a signed-in account.');
  return { account: active, client };
}
