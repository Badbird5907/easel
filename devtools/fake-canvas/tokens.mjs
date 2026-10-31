/**
 * OAuth state for the fake Canvas: developer keys, users who can sign in,
 * authorization codes, access and refresh tokens, and browser sessions.
 *
 * server.mjs imports this once, so the state survives route reloads. It's also
 * saved to the system temp folder, so restarting the server doesn't sign the
 * app out. Delete that file (path in `STATE_FILE`) to start over.
 *
 * Behavior follows canvas-lms `lib/canvas/oauth/` and
 * `app/controllers/oauth2_provider_controller.rb`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { user as defaultUser } from './data.mjs';

export const REDIRECT_URI = 'easel://oauth/callback';

/**
 * Developer keys an admin would create in Canvas. `ttl` is the access token
 * lifetime in seconds. A public client has no secret, uses PKCE, and gets a
 * new refresh token on every refresh, as Canvas does (developer_key.rb).
 */
export const developerKeys = {
  'easel-dev': {
    id: 'easel-dev',
    name: 'Easel (development)',
    secret: 'dev-secret',
    redirectUris: [REDIRECT_URI],
    ttl: 60 * 60,
    publicClient: false,
  },
  // Short-lived tokens for testing refresh. Enter it under "Use a developer key"; leave the secret blank.
  'easel-short': {
    id: 'easel-short',
    name: 'Easel (short tokens)',
    secret: null,
    redirectUris: [REDIRECT_URI],
    ttl: 60,
    publicClient: true,
  },
};

/**
 * Who can sign in. Any non-empty password works. `terms` must accept the terms
 * of use after every sign-in; `other` is a second student for multi-account tests.
 */
export const users = {
  // The same object data.mjs exports, so profile edits show up everywhere.
  student: defaultUser,
  terms: {
    id: '1002',
    name: 'Jordan Rivera',
    short_name: 'Jordan',
    sortable_name: 'Rivera, Jordan',
    avatar_url: null,
    locale: null,
    effective_locale: 'en',
    primary_email: 'jordan@example.edu',
    login_id: 'terms',
  },
  other: {
    id: '1003',
    name: 'Sam Okafor',
    short_name: 'Sam',
    sortable_name: 'Okafor, Sam',
    avatar_url: null,
    locale: null,
    effective_locale: 'en',
    primary_email: 'sam@example.edu',
    login_id: 'other',
  },
};

export const userById = (id) => Object.values(users).find((u) => u.id === String(id)) ?? null;
export const userByLogin = (login) => users[String(login ?? '').trim().toLowerCase()] ?? null;

export const STATE_FILE = join(tmpdir(), 'easel-fake-canvas-oauth.json');

/**
 * - codes: authorization code -> { clientId, userId, redirectUri, challenge, purpose, sso, expiresAt }
 * - tokens: access token record id -> { accessToken, refreshToken, clientId, userId, purpose, sso, expiresAt }
 * - sessions: browser session id -> { userId, sso, oauth }
 * - termsPending: user ids that must accept terms before Canvas lets them in
 */
const state = load();

function load() {
  const empty = { codes: {}, tokens: {}, sessions: {}, idpSessions: {}, termsPending: [] };
  try {
    if (existsSync(STATE_FILE)) return { ...empty, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    // Corrupt file: start fresh.
  }
  return empty;
}

function save() {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error(`Couldn't save OAuth state: ${error.message}`);
  }
}

const secret = (bytes = 24) => randomBytes(bytes).toString('hex');

/* Browser sessions (cookies) */

export function parseCookies(req) {
  const cookies = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

export const SESSION_COOKIE = 'fake_canvas_session';
export const IDP_COOKIE = 'fake_idp_session';

/** The browser's Canvas session, created on first visit. Returns [id, session, isNew]. */
export function browserSession(req) {
  const id = parseCookies(req)[SESSION_COOKIE];
  if (id && state.sessions[id]) return [id, state.sessions[id], false];
  const fresh = secret(16);
  state.sessions[fresh] = { userId: null, sso: false, oauth: null };
  save();
  return [fresh, state.sessions[fresh], true];
}

export function updateSession(id, patch) {
  state.sessions[id] = { ...state.sessions[id], ...patch };
  save();
  return state.sessions[id];
}

export function endSession(id) {
  delete state.sessions[id];
  save();
}

export function idpSession(req) {
  const id = parseCookies(req)[IDP_COOKIE];
  return id && state.idpSessions[id] ? { id, ...state.idpSessions[id] } : null;
}

export function startIdpSession(userId) {
  const id = secret(16);
  state.idpSessions[id] = { userId };
  save();
  return id;
}

export function endIdpSession(id) {
  if (id) delete state.idpSessions[id];
  save();
}

/* Authorization codes */

/** Canvas::OAuth::Token.generate_code_for: a single-use code valid for 10 minutes. */
export function issueCode({ clientId, userId, redirectUri, challenge, purpose, sso }) {
  const code = secret(32);
  state.codes[code] = {
    clientId,
    userId,
    redirectUri,
    challenge: challenge ?? null,
    purpose: purpose ?? null,
    sso: !!sso,
    expiresAt: Date.now() + 10 * 60_000,
  };
  // The fake's `terms` user has to accept the terms on every sign-in, so the flow is easy to repeat.
  if (userByLogin('terms')?.id === userId && !state.termsPending.includes(userId)) state.termsPending.push(userId);
  save();
  return code;
}

/** Takes the code (codes are single use). */
export function redeemCode(code) {
  const entry = state.codes[code];
  delete state.codes[code];
  save();
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry;
}

/** RFC 7636 S256, the only method Canvas supports (lib/canvas/oauth/pkce.rb). */
export function verifierMatches(verifier, challenge) {
  if (!verifier || !challenge) return false;
  return createHash('sha256').update(verifier).digest('base64url') === challenge;
}

/* Access tokens */

function tokenJson(record) {
  const u = userById(record.userId);
  const json = {
    access_token: record.accessToken,
    token_type: 'Bearer',
    user: {
      id: Number(u.id),
      name: u.name,
      global_id: u.id,
      effective_locale: u.effective_locale ?? 'en',
      fake_student: false,
    },
    canvas_region: 'unknown',
    expires_in: Math.max(0, Math.round((record.expiresAt - Date.now()) / 1000)),
  };
  // Canvas only returns a refresh token when it makes one (plaintext_refresh_token).
  if (record.plaintextRefresh) json.refresh_token = record.refreshToken;
  return json;
}

/** AuthorizationCode#generate_token: a new token with a refresh token. */
export function issueToken({ clientId, userId, purpose, sso }) {
  const key = developerKeys[clientId];
  const id = secret(8);
  const record = {
    id,
    accessToken: `fake~${secret(20)}`,
    refreshToken: `fake~${secret(20)}`,
    clientId,
    userId,
    purpose,
    sso: !!sso,
    createdAt: Date.now(),
    expiresAt: Date.now() + key.ttl * 1000,
  };
  state.tokens[id] = record;
  save();
  return tokenJson({ ...record, plaintextRefresh: true });
}

/**
 * RefreshToken#generate_token: a new access token. Public clients also get a
 * new refresh token, and the old one stops working.
 */
export function refreshToken(clientId, refresh) {
  const record = Object.values(state.tokens).find((t) => t.refreshToken === refresh);
  if (!record) return { error: 'invalid_refresh_token' };
  if (record.clientId !== clientId) return { error: 'incorrect_client' };
  const key = developerKeys[clientId];
  record.accessToken = `fake~${secret(20)}`;
  record.expiresAt = Date.now() + key.ttl * 1000;
  record.refreshedAt = Date.now();
  record.refreshes = (record.refreshes ?? 0) + 1;
  if (key.publicClient) record.refreshToken = `fake~${secret(20)}`;
  save();
  return { json: tokenJson({ ...record, plaintextRefresh: key.publicClient }) };
}

function recordFor(accessToken) {
  return Object.values(state.tokens).find((t) => t.accessToken === accessToken) ?? null;
}

/** DELETE /login/oauth2/token. Returns the deleted record, or null. */
export function revokeToken(accessToken) {
  const record = recordFor(accessToken);
  if (!record) return null;
  delete state.tokens[record.id];
  save();
  return record;
}

/** Deletes tokens as if the student removed Easel under Approved integrations. */
export function revokeAll({ login } = {}) {
  const target = login ? userByLogin(login) : null;
  let count = 0;
  for (const [id, record] of Object.entries(state.tokens)) {
    if (target && record.userId !== target.id) continue;
    delete state.tokens[id];
    count += 1;
  }
  save();
  return count;
}

/** Expires access tokens now without touching refresh tokens, to test refresh on demand. */
export function expireAll() {
  let count = 0;
  for (const record of Object.values(state.tokens)) {
    record.expiresAt = Date.now() - 1000;
    count += 1;
  }
  save();
  return count;
}

export function listTokens() {
  return Object.values(state.tokens).map((t) => ({
    id: t.id,
    client_id: t.clientId,
    user: userById(t.userId)?.login_id,
    purpose: t.purpose,
    sso: t.sso,
    expires_in: Math.round((t.expiresAt - Date.now()) / 1000),
    refreshes: t.refreshes ?? 0,
    uses: t.uses ?? 0,
    rejected_expired: t.rejected ?? 0,
    last_used_s_ago: t.lastUsedAt ? Math.round((Date.now() - t.lastUsedAt) / 1000) : null,
    access_token: `${t.accessToken.slice(0, 10)}…`,
  }));
}

/**
 * Checks an `Authorization` header the way Canvas does (lib/authentication_methods.rb).
 * `devToken` is the fake's personal access token, which never expires.
 */
export function authenticate(header, devToken) {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match) return { ok: false, message: 'Invalid access token.' };
  const token = match[1];
  if (token === devToken) return { ok: true, user: users.student, token: null };
  const record = recordFor(token);
  if (!record) return { ok: false, message: 'Invalid access token.' };
  // Counters for /fake/oauth, in memory only, so testers can see refresh happen.
  if (record.expiresAt < Date.now()) {
    record.rejected = (record.rejected ?? 0) + 1;
    return { ok: false, message: 'Expired access token.' };
  }
  record.uses = (record.uses ?? 0) + 1;
  record.lastUsedAt = Date.now();
  return { ok: true, user: userById(record.userId), token: record };
}

/** The signed-in user for a request that already passed the server's token check. */
export function requestUser(req, devToken = process.env.FAKE_CANVAS_TOKEN ?? 'dev') {
  const result = authenticate(req.headers.authorization, devToken);
  return result.ok ? result.user : users.student;
}

/* Terms of use */

export const termsRequired = (userId) => state.termsPending.includes(String(userId));

export function acceptTerms(userId) {
  state.termsPending = state.termsPending.filter((id) => id !== String(userId));
  save();
}
