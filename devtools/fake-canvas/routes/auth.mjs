/**
 * Sign-in for the fake Canvas: the OAuth 2 provider, a Canvas login page, a
 * fake SAML identity provider, terms of use, and per-token users.
 *
 * Mirrors canvas-lms `oauth2_provider_controller.rb`, `login/canvas_controller.rb`,
 * and `lib/canvas/oauth/`. State lives in ../tokens.mjs so it survives reloads.
 *
 * Testing helpers (open in a browser): http://localhost:3030/fake/oauth lists
 * issued tokens and can expire or revoke them.
 *
 * This file sorts before core.mjs, so its /api/v1/users/self routes win.
 */
import { Buffer } from 'node:buffer';

import { BASE } from '../data.mjs';
import {
  acceptTerms,
  browserSession,
  developerKeys,
  endIdpSession,
  endSession,
  expireAll,
  IDP_COOKIE,
  idpSession,
  issueCode,
  issueToken,
  listTokens,
  parseCookies,
  redeemCode,
  refreshToken,
  requestUser,
  revokeAll,
  revokeToken,
  SESSION_COOKIE,
  startIdpSession,
  termsRequired,
  updateSession,
  userById,
  userByLogin,
  verifierMatches,
} from '../tokens.mjs';

const SCHOOL = 'Fake University';

const escape = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const cookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${maxAge === 0 ? '; Max-Age=0' : ''}`;

/** A Canvas-looking page. `idp` switches to the identity provider's look. */
function page(title, body, { status = 200, headers = {}, idp = false } = {}) {
  const accent = idp ? '#5B3FA8' : '#2B7ABC';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: light dark; --accent: ${accent}; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.45 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
    background: #F5F5F5; color: #273540; }
  header { background: var(--accent); color: white; padding: 18px 20px; font-weight: 600; font-size: 18px; }
  header small { display: block; font-weight: 400; opacity: .85; font-size: 13px; }
  main { max-width: 420px; margin: 24px auto; padding: 0 16px; }
  .card { background: white; border-radius: 10px; padding: 22px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
  h1 { font-size: 22px; margin: 0 0 14px; }
  p { margin: 0 0 14px; }
  label { display: block; font-weight: 600; font-size: 14px; margin: 14px 0 6px; }
  input[type=text], input[type=password] { width: 100%; font-size: 16px; padding: 11px 12px;
    border: 1px solid #C7CDD1; border-radius: 6px; background: white; color: inherit; }
  button, .button { display: block; width: 100%; margin-top: 18px; padding: 12px; font-size: 16px; font-weight: 600;
    color: white; background: var(--accent); border: 0; border-radius: 6px; text-align: center; text-decoration: none; }
  .secondary { background: #E8EAEC; color: #273540; }
  .sso { background: white; color: var(--accent); border: 1.5px solid var(--accent); }
  .error { background: #FDECEA; color: #8C1A10; padding: 10px 12px; border-radius: 6px; margin-bottom: 4px; font-size: 14px; }
  .note { font-size: 13px; color: #6B7780; margin-top: 18px; }
  .banner { background: #FFF4E5; color: #6A3A00; padding: 10px 12px; border-radius: 6px; font-size: 14px; margin-bottom: 14px; }
  .divider { text-align: center; color: #6B7780; font-size: 13px; margin: 18px 0 0; }
  a { color: var(--accent); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { text-align: left; padding: 6px 4px; border-bottom: 1px solid #E8EAEC; }
  @media (prefers-color-scheme: dark) {
    body { background: #1B1F23; color: #E8EAEC; }
    .card { background: #262B30; box-shadow: none; }
    input[type=text], input[type=password] { background: #1B1F23; border-color: #4A545C; }
    .secondary { background: #3A4148; color: #E8EAEC; }
    .sso { background: transparent; color: #8CC4F0; border-color: #8CC4F0; }
    a { color: #8CC4F0; }
  }
</style>
</head>
<body>
<header>${idp ? 'Fake University Single Sign-On' : escape(SCHOOL)}<small>${idp ? 'idp.fake.edu' : 'Canvas (fake, for Easel development)'}</small></header>
<main>${body}</main>
</body>
</html>`;
  return { status, body: html, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers } };
}

const redirect = (location, headers = {}) => ({ status: 302, body: '', headers: { Location: location, ...headers } });

const json = (status, body, headers = {}) => ({ status, body, headers });

/** Canvas::OAuth::Provider.final_redirect */
function finalRedirect(redirectUri, params) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null));
  return `${redirectUri}${redirectUri.includes('?') ? '&' : '?'}${query}`;
}

/** The browser session plus a Set-Cookie header if it's new. */
function session(req) {
  const [id, data, isNew] = browserSession(req);
  return { id, data, headers: isNew ? { 'Set-Cookie': cookie(SESSION_COOKIE, id) } : {} };
}

function loginForm({ oauth, error, uniqueId, canvasOnly }) {
  const key = oauth ? developerKeys[oauth.clientId] : null;
  const siteAdmin = oauth?.siteAdmin;
  return `<div class="card">
  ${siteAdmin ? '<div class="banner">Site admin login. Delegated authentication (SSO) is skipped.</div>' : ''}
  <h1>${siteAdmin ? 'Site admin login' : 'Log in to Canvas'}</h1>
  ${key ? `<p>to continue to <strong>${escape(key.name)}</strong></p>` : ''}
  ${error ? `<div class="error" role="alert">${escape(error)}</div>` : ''}
  <form method="post" action="/login/canvas">
    <label for="unique_id">Email or username</label>
    <input type="text" id="unique_id" name="pseudonym_session[unique_id]" value="${escape(uniqueId)}"
      autocomplete="username" autocapitalize="none" autocorrect="off" required>
    <label for="password">Password</label>
    <input type="password" id="password" name="pseudonym_session[password]" autocomplete="current-password" required>
    <button type="submit">Log In</button>
  </form>
  ${
    canvasOnly || siteAdmin
      ? ''
      : `<p class="divider">or</p><a class="button sso" href="/login/saml">Continue with Single Sign-On</a>`
  }
  <p class="note">Fake Canvas users: <strong>student</strong>, <strong>terms</strong> (must accept terms),
  and <strong>other</strong>. Any password works.</p>
</div>`;
}

function samlPost(login) {
  const response = Buffer.from(JSON.stringify({ login, issuedAt: Date.now() })).toString('base64');
  return page(
    'Signing you in',
    `<div class="card"><h1>Signing you in…</h1><p>Returning to ${escape(SCHOOL)} Canvas.</p>
    <form id="saml" method="post" action="/login/saml">
      <input type="hidden" name="SAMLResponse" value="${escape(response)}">
      <noscript><button type="submit">Continue</button></noscript>
    </form>
    <script>setTimeout(function () { document.getElementById('saml').submit(); }, 400);</script></div>`,
    { idp: true },
  );
}

/** Client ID and secret from the body or HTTP Basic, like OAuth2ProviderController#token. */
function clientCredentials(req, body) {
  let id = body.client_id;
  let secret = body.client_secret;
  const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '');
  if (basic) {
    const [user, pass] = Buffer.from(basic[1], 'base64').toString('utf8').split(':');
    id ||= user;
    secret ||= pass;
  }
  return { id, secret };
}

const oauthError = (status, error, description) =>
  json(status, { error, error_description: description }, status === 401 ? { 'WWW-Authenticate': 'Canvas OAuth 2.0' } : {});

/** BaseType#validate_client_id_and_secret */
function checkClient(key, secret, allowPublic) {
  if (!key) return oauthError(401, 'invalid_client', 'unknown client');
  if (allowPublic && key.publicClient && !secret) return null;
  if (!key.secret || secret !== key.secret) return oauthError(401, 'invalid_client', 'invalid client');
  return null;
}

const termsHtml = `<h2>Acceptable Use Policy</h2>
<p>This is the fake Canvas's terms of use, so Easel can show and accept them during development.</p>
<h3>Using Canvas</h3>
<p>Use Canvas for your coursework. Don't share your password, and don't try to get into accounts or courses that aren't yours.</p>
<h3>Your content</h3>
<p>You keep the rights to what you submit. Your instructors and classmates can see what you post in their courses.</p>
<h3>Privacy</h3>
<p>Fake University handles your data under its <a href="${BASE}/privacy_policy">privacy policy</a>.</p>`;

export const routes = [
  /* OAuth 2 provider */
  {
    path: '/login/oauth2/auth',
    public: true,
    handler: ({ query, req }) => {
      // Canvas shows a bare page when it's the oob landing spot.
      if (query.code || query.error) return page('Done', '<div class="card"><p>You can close this window.</p></div>');

      const key = developerKeys[query.client_id];
      if (!key) return oauthError(401, 'invalid_client', 'unknown client');
      if (!key.redirectUris.includes(query.redirect_uri))
        return oauthError(400, 'invalid_request', 'redirect_uri does not match client settings');
      if (query.response_type !== 'code')
        return redirect(
          finalRedirect(query.redirect_uri, {
            state: query.state,
            error: 'unsupported_response_type',
            error_description: 'Only response_type=code is permitted',
          }),
        );

      const s = session(req);
      const siteAdmin = query.canvas_sa_delegated === '1' || parseCookies(req).canvas_sa_delegated === '1';
      const oauth = {
        clientId: key.id,
        redirectUri: query.redirect_uri,
        state: query.state ?? null,
        // pkce.rb: only S256, and only when both params are present.
        challenge: query.code_challenge && query.code_challenge_method === 'S256' ? query.code_challenge : null,
        purpose: query.purpose ?? null,
        siteAdmin,
      };
      let forceLogin = query.force_login === '1' || query.force_login === 'true';
      if (query.prompt === 'login') forceLogin = true;
      else if (query.prompt === 'none') {
        if (!s.data.userId)
          return redirect(
            finalRedirect(oauth.redirectUri, {
              state: oauth.state,
              error: 'login_required',
              error_description: 'prompt=none but there is no current session',
            }),
            s.headers,
          );
      } else if (query.prompt)
        return redirect(
          finalRedirect(oauth.redirectUri, {
            state: oauth.state,
            error: 'unsupported_prompt_type',
            error_description: 'prompt must be "none" (or omitted)',
          }),
          s.headers,
        );

      updateSession(s.id, { oauth, ...(forceLogin && { userId: null, sso: false }) });
      if (s.data.userId && !forceLogin) return redirect('/login/oauth2/confirm', s.headers);

      // LoginController#new: canvas_login means the Canvas provider; otherwise follow the hint.
      const provider = query.canvas_login === '1' ? 'canvas' : query.authentication_provider;
      const params = new URLSearchParams();
      if (query.unique_id) params.set('unique_id', query.unique_id);
      if (provider === 'saml' || provider === 'sso') return redirect('/login/saml', s.headers);
      if (provider === 'canvas') params.set('canvas_only', '1');
      return redirect(`/login/canvas${params.size ? `?${params}` : ''}`, s.headers);
    },
  },
  {
    path: '/login/canvas',
    public: true,
    handler: ({ query, req }) => {
      const s = session(req);
      return page(
        'Log In to Canvas',
        loginForm({ oauth: s.data.oauth, uniqueId: query.unique_id, canvasOnly: query.canvas_only === '1' }),
        { headers: s.headers },
      );
    },
  },
  {
    method: 'POST',
    path: '/login/canvas',
    public: true,
    handler: ({ body = {}, req }) => {
      const s = session(req);
      const login = body['pseudonym_session[unique_id]'];
      const user = userByLogin(login);
      if (!user || !body['pseudonym_session[password]']) {
        return page(
          'Log In to Canvas',
          loginForm({
            oauth: s.data.oauth,
            uniqueId: login,
            error: 'Please verify your username or password and try again.',
            canvasOnly: true,
          }),
          { status: 400, headers: s.headers },
        );
      }
      updateSession(s.id, { userId: user.id, sso: false });
      if (!s.data.oauth) return page('Logged in', `<div class="card"><h1>Hi, ${escape(user.short_name)}</h1></div>`);
      return redirect('/login/oauth2/confirm', s.headers);
    },
  },
  {
    // Canvas starts SAML by redirecting to the identity provider.
    path: '/login/saml',
    public: true,
    handler: ({ req }) => {
      const s = session(req);
      const request = Buffer.from(JSON.stringify({ issuer: BASE, id: s.id })).toString('base64');
      return redirect(`/fake-idp/sso?SAMLRequest=${encodeURIComponent(request)}`, s.headers);
    },
  },
  {
    // The SAML assertion consumer service.
    method: 'POST',
    path: '/login/saml',
    public: true,
    handler: ({ body = {}, req }) => {
      const s = session(req);
      let user = null;
      try {
        user = userByLogin(JSON.parse(Buffer.from(body.SAMLResponse ?? '', 'base64').toString('utf8')).login);
      } catch {
        // Bad assertion.
      }
      if (!user) return page('Sign-in failed', '<div class="card"><div class="error">The SSO response was invalid.</div></div>', { status: 400 });
      updateSession(s.id, { userId: user.id, sso: true });
      if (!s.data.oauth) return page('Logged in', `<div class="card"><h1>Hi, ${escape(user.short_name)}</h1></div>`);
      return redirect('/login/oauth2/confirm', s.headers);
    },
  },
  {
    path: '/login/oauth2/confirm',
    public: true,
    handler: ({ req }) => {
      const s = session(req);
      const user = userById(s.data.userId);
      const key = developerKeys[s.data.oauth?.clientId];
      if (!s.data.oauth || !user || !key)
        return page('Log In', '<div class="card"><div class="error">Must submit new OAuth2 request.</div></div>', {
          status: 400,
        });
      const csrf = Math.random().toString(36).slice(2);
      updateSession(s.id, { oauth: { ...s.data.oauth, csrf } });
      return page(
        'Authorize',
        `<div class="card">
          <h1>${escape(key.name)} is requesting access to your account</h1>
          <p>You're logged in as <strong>${escape(user.name)}</strong>${s.data.sso ? ' through single sign-on' : ''}.</p>
          ${s.data.oauth.purpose ? `<p class="note">Purpose: ${escape(s.data.oauth.purpose)}</p>` : ''}
          <form method="post" action="/login/oauth2/accept">
            <input type="hidden" name="custom_csrf_token" value="${csrf}">
            <button type="submit">Authorize</button>
          </form>
          <a class="button secondary" href="/login/oauth2/deny">Cancel</a>
          <p class="note"><a href="/login/oauth2/switch">Not ${escape(user.short_name)}? Log in as someone else</a></p>
        </div>`,
      );
    },
  },
  {
    // Clears the logged-in user but keeps the OAuth request, like "Log in as someone else".
    path: '/login/oauth2/switch',
    public: true,
    handler: ({ req }) => {
      const s = session(req);
      updateSession(s.id, { userId: null, sso: false });
      return redirect('/login/canvas', s.headers);
    },
  },
  {
    method: 'POST',
    path: '/login/oauth2/accept',
    public: true,
    handler: ({ body = {}, req }) => {
      const s = session(req);
      const oauth = s.data.oauth;
      if (!oauth) return { status: 400, body: 'Invalid or missing session for oauth', headers: { 'Content-Type': 'text/plain' } };
      if (!oauth.csrf || body.custom_csrf_token !== oauth.csrf)
        return { status: 400, body: 'Invalid custom CSRF token', headers: { 'Content-Type': 'text/plain' } };
      const code = issueCode({
        clientId: oauth.clientId,
        userId: s.data.userId,
        redirectUri: oauth.redirectUri,
        challenge: oauth.challenge,
        purpose: oauth.purpose,
        sso: s.data.sso,
      });
      updateSession(s.id, { oauth: null });
      return redirect(finalRedirect(oauth.redirectUri, { code, state: oauth.state }));
    },
  },
  ...['GET', 'POST'].map((method) => ({
    method,
    path: '/login/oauth2/deny',
    public: true,
    handler: ({ req }) => {
      const s = session(req);
      const oauth = s.data.oauth;
      if (!oauth) return { status: 400, body: 'Invalid or missing session for oauth', headers: { 'Content-Type': 'text/plain' } };
      updateSession(s.id, { oauth: null });
      return redirect(finalRedirect(oauth.redirectUri, { error: 'access_denied', state: oauth.state }));
    },
  })),
  {
    method: 'POST',
    path: '/login/oauth2/token',
    public: true,
    handler: ({ body: raw, req }) => {
      const body = raw && typeof raw === 'object' && !Buffer.isBuffer(raw) ? raw : {};
      const { id, secret } = clientCredentials(req, body);
      const key = developerKeys[id];
      const grant = body.grant_type ?? (body.code ? 'authorization_code' : null);

      if (grant === 'authorization_code') {
        const pkce = 'code_verifier' in body;
        const rejected = checkClient(key, secret, pkce);
        if (rejected) return rejected;
        if (!body.code)
          return oauthError(
            400,
            'invalid_request',
            'You must provide the code parameter when using the authorization_code grant type',
          );
        const entry = redeemCode(body.code);
        if (pkce && !verifierMatches(body.code_verifier, entry?.challenge))
          return oauthError(
            400,
            'invalid_grant',
            'The provided authorization grant is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.',
          );
        if (!entry) return oauthError(400, 'invalid_grant', 'authorization_code not found');
        if (entry.clientId !== key.id) return oauthError(400, 'invalid_grant', 'incorrect client');
        return issueToken(entry);
      }

      if (grant === 'refresh_token') {
        const rejected = checkClient(key, secret, true);
        if (rejected) return rejected;
        if (!body.refresh_token)
          return oauthError(
            400,
            'invalid_request',
            'You must provide the refresh_token parameter when using the refresh_token grant type',
          );
        const result = refreshToken(key.id, body.refresh_token);
        if (result.error === 'invalid_refresh_token') return oauthError(400, 'invalid_grant', 'refresh_token not found');
        if (result.error) return oauthError(400, 'invalid_grant', 'incorrect client');
        return result.json;
      }

      return oauthError(400, 'unsupported_grant_type', 'The grant_type you requested is not currently supported');
    },
  },
  {
    method: 'DELETE',
    path: '/login/oauth2/token',
    handler: ({ query, req }) => {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const record = token ? revokeToken(token) : null;
      if (!record)
        return json(400, { message: "can't delete OAuth access token when not using an OAuth access token" });
      const response = {};
      // Canvas forwards to the identity provider's single logout when the session came from SSO.
      if (query.expire_sessions && record.sso) response.forward_url = `http://${req.headers.host}/fake-idp/logout`;
      return response;
    },
  },

  /* Fake identity provider */
  {
    path: '/fake-idp/sso',
    public: true,
    handler: ({ req }) => {
      const existing = idpSession(req);
      const user = existing && userById(existing.userId);
      // An existing SSO session signs straight back in, as a real IdP would.
      if (user) return samlPost(user.login_id);
      return page(
        'Fake University Sign-On',
        `<div class="card">
          <h1>Sign in with your Fake University account</h1>
          <form method="post" action="/fake-idp/sso">
            <label for="u">NetID</label>
            <input type="text" id="u" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" required>
            <label for="p">Password</label>
            <input type="password" id="p" name="password" autocomplete="current-password" required>
            <button type="submit">Sign in</button>
          </form>
          <p class="note">Try <strong>student</strong>, <strong>terms</strong>, or <strong>other</strong>, with any password.</p>
        </div>`,
        { idp: true },
      );
    },
  },
  {
    method: 'POST',
    path: '/fake-idp/sso',
    public: true,
    handler: ({ body = {} }) => {
      const user = userByLogin(body.username);
      if (!user || !body.password)
        return page(
          'Fake University Sign-On',
          `<div class="card"><div class="error" role="alert">We don't recognize that NetID and password.</div>
          <a class="button" href="/fake-idp/sso">Try again</a></div>`,
          { status: 400, idp: true },
        );
      const id = startIdpSession(user.id);
      const response = samlPost(user.login_id);
      response.headers['Set-Cookie'] = cookie(IDP_COOKIE, id);
      return response;
    },
  },
  {
    // Single logout: the IdP ends its session, then hands back to Canvas.
    path: '/fake-idp/logout',
    public: true,
    handler: ({ req }) => {
      endIdpSession(idpSession(req)?.id);
      return redirect('/login/saml/logout', { 'Set-Cookie': cookie(IDP_COOKIE, '', 0) });
    },
  },
  {
    path: '/login/saml/logout',
    public: true,
    handler: ({ req }) => {
      const id = parseCookies(req)[SESSION_COOKIE];
      if (id) endSession(id);
      return page(
        'Logged out',
        `<div class="card"><h1>You're signed out</h1><p>You signed out of ${escape(SCHOOL)} single sign-on. You can close this window.</p></div>`,
        { headers: { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) } },
      );
    },
  },

  /* The signed-in user, per token */
  { path: '/api/v1/users/self', handler: ({ req }) => requestUser(req) },
  {
    path: '/api/v1/users/self/profile',
    handler: ({ req }) => {
      const u = requestUser(req);
      return { ...u, calendar: { ics: `${BASE}/feeds/calendars/user_${u.id}.ics` } };
    },
  },
  {
    // UsersController#update. Handles terms acceptance and simple profile fields.
    method: 'PUT',
    path: '/api/v1/users/self',
    handler: ({ body, req }) => {
      const u = requestUser(req);
      const fields = (body && typeof body === 'object' && body.user) || {};
      const accepted = fields.terms_of_use ?? body?.['user[terms_of_use]'];
      if (accepted === true || accepted === '1' || accepted === 'true' || accepted === 1) acceptTerms(u.id);
      for (const name of ['name', 'short_name', 'sortable_name', 'pronouns', 'bio', 'time_zone', 'locale']) {
        if (typeof fields[name] === 'string') u[name] = fields[name];
      }
      return { ...u, ...(accepted !== undefined && { terms_of_use: !termsRequired(u.id) }) };
    },
  },
  {
    // LoginController#session_token: also reports whether the user still has to accept terms.
    path: '/api/v1/login/session_token',
    handler: ({ query, req }) => ({
      session_url: query.return_to ?? BASE,
      requires_terms_acceptance: termsRequired(requestUser(req).id),
    }),
  },

  /* Terms of use and privacy (accounts_controller.rb, legal_information_controller.rb) */
  {
    path: '/api/v1/accounts/:accountId/terms_of_service',
    public: true,
    handler: () => ({
      id: '1',
      terms_type: 'custom',
      passive: false,
      account_id: '1',
      content: termsHtml,
      self_registration_type: 'none',
    }),
  },
  { path: '/api/v1/acceptable_use_policy', public: true, handler: () => ({ content: termsHtml }) },
  { path: '/terms_of_use', public: true, handler: () => redirect('/acceptable_use_policy') },
  {
    path: '/acceptable_use_policy',
    public: true,
    handler: () => page('Acceptable Use Policy', `<div class="card">${termsHtml}</div>`),
  },
  {
    path: '/privacy_policy',
    public: true,
    handler: () =>
      page(
        'Privacy Policy',
        `<div class="card"><h1>Privacy Policy</h1><p>Fake University keeps your Canvas data for coursework only.
        This page stands in for a school's real privacy policy.</p></div>`,
      ),
  },

  /* Testing helpers */
  {
    path: '/fake/oauth',
    public: true,
    handler: ({ query }) => {
      const tokens = listTokens();
      if (query.format === 'json') return tokens;
      const rows = tokens
        .map(
          (t) =>
            `<tr><td>${escape(t.user)}</td><td>${escape(t.client_id)}</td><td>${t.expires_in}s</td><td>${t.refreshes}</td><td>${t.uses}</td><td>${t.sso ? 'SSO' : ''}</td></tr>`,
        )
        .join('');
      return page(
        'OAuth tokens',
        `<div class="card"><h1>Issued tokens</h1>
        ${tokens.length ? `<table><tr><th>User</th><th>Key</th><th>Expires</th><th>Refreshes</th><th>Requests</th><th></th></tr>${rows}</table>` : '<p>None.</p>'}
        <form method="post" action="/fake/oauth/expire"><button type="submit">Expire access tokens</button></form>
        <form method="post" action="/fake/oauth/revoke"><button class="secondary" type="submit">Revoke all tokens</button></form>
        <p class="note">Expiring tests refresh. Revoking is like removing Easel under Approved integrations in Canvas.</p></div>`,
      );
    },
  },
  {
    method: 'POST',
    path: '/fake/oauth/revoke',
    public: true,
    handler: ({ query, req }) =>
      req.headers.accept?.includes('text/html')
        ? (revokeAll({ login: query.login }), redirect('/fake/oauth'))
        : { revoked: revokeAll({ login: query.login }) },
  },
  {
    method: 'POST',
    path: '/fake/oauth/expire',
    public: true,
    handler: ({ req }) =>
      req.headers.accept?.includes('text/html') ? (expireAll(), redirect('/fake/oauth')) : { expired: expireAll() },
  },
];

