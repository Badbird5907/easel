/**
 * Profile, time zone, language, avatars, and observer pairing (SET-6, SET-9,
 * SET-14), plus testing helpers for accounts and terms.
 *
 * routes/auth.mjs sorts first and answers GET/PUT `/api/v1/users/self` (terms
 * of use) and GET `/api/v1/users/self/profile`. This file answers the
 * `/api/v1/users/:id` forms Easel uses for profile edits. Both read and write
 * the same user objects (tokens.mjs `users`, shared with data.mjs), so edits
 * here show up in `users/self` and `users/self/profile` too.
 *
 * Shapes and rules: users_controller.rb (#api_show, #update), lib/api/v1/user.rb,
 * lib/api/v1/user_profile.rb, profile_controller.rb#profile_pics,
 * observer_pairing_codes_api_controller.rb.
 */
import { randomBytes } from 'node:crypto';

import { BASE } from '../data.mjs';
import * as tokens from '../tokens.mjs';

const { issueCode, issueToken, REDIRECT_URI, requestUser, userById, userByLogin, users } = tokens;

const DEV_TOKEN = process.env.FAKE_CANVAS_TOKEN ?? 'dev';

/** The server's own zone: fixture due dates are written in it, so they read the same in Easel by default. */
const SERVER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver';

/** The school's pronoun list (Account#pronouns): Canvas's defaults, turned on. */
const SCHOOL_PRONOUNS = ['She/Her', 'He/Him', 'They/Them'];

/** Canvas's locales (config/locales/locales.yml). */
const LOCALES = new Set(
  'ar ca cy da de el en en-AU en-CA en-GB es es-ES fa fi fr fr-CA ga he hi ht hu hy id is it ja ko mi ms nb nl nn pl pt pt-BR ru sl sv th tr uk vi zh-Hans zh-Hant'.split(
    ' ',
  ),
);

/*
 * Profile fields the fixtures in data.mjs and tokens.mjs leave out. `??=` keeps
 * edits when this file reloads. `other` works at a school that locks names, so
 * both answers to `can_update_name` can be tried.
 */
for (const [login, u] of Object.entries(users)) {
  u.time_zone ??= SERVER_ZONE;
  u.bio ??= login === 'student' ? 'Biology major. Usually in the library on the third floor.' : null;
  u.pronouns ??= login === 'student' ? 'He/Him' : null;
  u.permissions ??= {
    can_update_name: login !== 'other',
    can_update_avatar: true,
    limit_parent_app_web_access: false,
  };
}

const unauthorized = () => ({
  status: 401,
  body: { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] },
});
const notFound = () => ({ status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } });

/** `api_find(User, id)` limited to the signed-in user: students can't read or edit anyone else here. */
function target(req, id) {
  const me = requestUser(req, DEV_TOKEN);
  if (id === 'self' || id === me.id) return me;
  return userById(id) ? null : undefined;
}

/** users_controller#api_show: `permissions`, `locale`, `effective_locale`, `avatar_url`, and `email` always come along. */
function userJson(u) {
  return {
    id: u.id,
    name: u.name,
    created_at: '2025-08-20T15:00:00Z',
    sortable_name: u.sortable_name,
    short_name: u.short_name,
    sis_user_id: null,
    integration_id: null,
    login_id: u.login_id,
    avatar_url: u.avatar_url ?? null,
    email: u.primary_email,
    locale: u.locale || null,
    effective_locale: u.locale || u.effective_locale || 'en',
    ...(u.pronouns ? { pronouns: u.pronouns } : {}),
    permissions: u.permissions,
    time_zone: u.time_zone,
  };
}

const validZone = (name) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
};

/** Profile pictures the student can pick (profile_controller#profile_pics): their uploaded images, newest first. */
async function avatarsFor() {
  const response = await fetch(`${BASE}/api/v1/users/self/files?per_page=100`, {
    headers: { Authorization: `Bearer ${DEV_TOKEN}`, Accept: 'application/json' },
  });
  const files = response.ok ? await response.json() : [];
  return [
    ...files
      .filter((f) => String(f['content-type'] ?? '').startsWith('image/') && f.thumbnail_url)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((f) => ({
        type: 'attachment',
        id: f.id,
        display_name: f.display_name,
        'content-type': f['content-type'],
        filename: f.filename,
        url: f.thumbnail_url,
        token: `avatar-attachment-${f.id}`,
      })),
    { type: 'no_pic', display_name: 'No pic', url: `${BASE}/images/messages/avatar-50.png`, token: 'avatar-no_pic' },
  ];
}

const pairingCodes = (globalThis.__fakeCanvasPairingCodes ??= []);
const errorReports = (globalThis.__fakeCanvasErrorReports ??= []);

export const routes = [
  {
    path: '/api/v1/users/:userId',
    handler: ({ params, req }) => {
      const u = target(req, params.userId);
      if (u === undefined) return notFound();
      if (!u) return unauthorized();
      return userJson(u);
    },
  },
  {
    // UsersController#update. A field the student may not change refuses the whole request.
    method: 'PUT',
    path: '/api/v1/users/:userId',
    handler: async ({ params, body, req }) => {
      const u = target(req, params.userId);
      if (u === undefined) return notFound();
      if (!u) return unauthorized();
      const fields = (body && typeof body === 'object' && body.user) || {};
      const allowed = new Set(['terms_of_use', 'pronouns', 'time_zone', 'locale', 'avatar']);
      if (u.permissions.can_update_name) for (const f of ['name', 'short_name', 'sortable_name']) allowed.add(f);
      if (Object.keys(fields).length === 0 || Object.keys(fields).some((f) => !allowed.has(f))) return unauthorized();

      for (const f of ['name', 'short_name', 'sortable_name']) {
        if (typeof fields[f] === 'string' && fields[f].trim()) u[f] = fields[f].trim();
      }
      if (typeof fields.name === 'string' && typeof fields.sortable_name !== 'string') {
        const parts = u.name.split(/\s+/);
        u.sortable_name = parts.length > 1 ? `${parts.at(-1)}, ${parts.slice(0, -1).join(' ')}` : u.name;
      }
      if (typeof fields.pronouns === 'string') {
        // Only the school's options stick (Pronouns#match_pronoun); empty clears them.
        const match = SCHOOL_PRONOUNS.find((p) => p.toLowerCase() === fields.pronouns.trim().toLowerCase());
        if (match || fields.pronouns === '') u.pronouns = match ?? null;
      }
      if (typeof fields.time_zone === 'string') {
        if (!validZone(fields.time_zone))
          return { status: 400, body: { errors: { time_zone: [{ message: 'is not a valid time zone' }] } } };
        u.time_zone = fields.time_zone;
      }
      if (typeof fields.locale === 'string') {
        if (fields.locale && !LOCALES.has(fields.locale))
          return { status: 400, body: { errors: { locale: [{ message: 'is not a valid locale' }] } } };
        u.locale = fields.locale || null;
      }
      const token = fields.avatar?.token;
      if (typeof token === 'string') {
        if (token === 'avatar-no_pic') u.avatar_url = null;
        else {
          const avatar = (await avatarsFor()).find((a) => a.token === token);
          if (!avatar) return { status: 400, body: { errors: { avatar: [{ message: 'is invalid' }] } } };
          u.avatar_url = avatar.url;
        }
      }
      return userJson(u);
    },
  },
  {
    path: '/api/v1/users/:userId/avatars',
    handler: async ({ params, req }) => {
      const u = target(req, params.userId);
      if (!u) return unauthorized();
      return avatarsFor();
    },
  },
  {
    // ObserverPairingCodesApiController#create. Codes last seven days.
    method: 'POST',
    path: '/api/v1/users/:userId/observer_pairing_codes',
    handler: ({ params, req }) => {
      const u = target(req, params.userId);
      if (!u) return unauthorized();
      const code = {
        user_id: u.id,
        code: randomBytes(6).toString('base64').replace(/\W/g, '').slice(0, 6),
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        workflow_state: 'active',
      };
      pairingCodes.push(code);
      return code;
    },
  },

  /* Testing helpers */
  {
    // A personal-token stand-in for another fake user, to add a second account by pasting it:
    // POST /fake/accounts/token?login=terms (or other). Valid for an hour, like the easel-dev key.
    method: 'POST',
    path: '/fake/accounts/token',
    public: true,
    handler: ({ query }) => {
      const u = userByLogin(query.login ?? 'other');
      if (!u) return { status: 404, body: { message: 'Unknown login. Try student, terms, or other.' } };
      const issued = issueToken({ clientId: 'easel-dev', userId: u.id, purpose: 'Fake account helper' });
      return { login: u.login_id, name: u.name, access_token: issued.access_token ?? issued.accessToken ?? issued };
    },
  },
  {
    // The school changes its terms of use: Canvas asks the user to accept them again
    // (`requires_terms_acceptance` from /api/v1/login/session_token). POST /fake/terms/change?login=terms
    method: 'POST',
    path: '/fake/terms/change',
    public: true,
    handler: ({ query }) => {
      const u = userByLogin(query.login ?? 'terms');
      if (!u) return { status: 404, body: { message: 'Unknown login.' } };
      if (typeof tokens.requireTerms === 'function') tokens.requireTerms(u.id);
      // Without tokens.requireTerms, issuing a sign-in code marks the `terms` user pending (tokens.mjs#issueCode).
      else if (u.login_id === 'terms') issueCode({ clientId: 'easel-dev', userId: u.id, redirectUri: REDIRECT_URI });
      else return { status: 501, body: { message: 'Only the terms user can be reset until tokens.mjs exports requireTerms.' } };
      return { login: u.login_id, requires_terms_acceptance: tokens.termsRequired(u.id) };
    },
  },
  { path: '/fake/pairing_codes', public: true, handler: () => pairingCodes },
  { path: '/fake/error_reports', public: true, handler: () => errorReports },
];
