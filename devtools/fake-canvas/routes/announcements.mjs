/**
 * Global account announcements (owned by the Announcements, activity, and inbox
 * workstream). Course announcements are discussion topics, so they live in
 * routes/discussions.mjs with the read state they share.
 *
 * Shapes: lib/api/v1/account_notifications.rb. Dismissals live in module scope
 * and reset when this file reloads.
 */
import { at } from '../data.mjs';

const notifications = [
  {
    id: '3001',
    subject: 'Canvas maintenance Saturday night',
    message:
      '<p>Canvas will be unavailable Saturday from 11 PM to 2 AM while the university applies updates. Submit anything due that night before 11.</p>',
    start_at: at(-1, 8),
    end_at: at(5, 23),
    icon: 'warning',
  },
  {
    id: '3002',
    subject: 'Spring registration opens November 10',
    message:
      '<p>Check your registration time in the student portal. Advising holds must be cleared first; <a href="https://example.edu/advising">book an advising appointment</a> if you have one.</p>',
    start_at: at(-3, 8),
    end_at: at(14, 23),
    icon: 'calendar',
  },
];

const dismissed = new Set();

function json(n) {
  return { ...n, role_ids: [], roles: [], author: null };
}

const dismiss = ({ params }) => {
  const n = notifications.find((x) => x.id === params.id);
  if (!n) return { status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } };
  dismissed.add(n.id);
  return json(n);
};

export const routes = [
  {
    // GET /api/v1/accounts/self/account_notifications: active ones the user hasn't closed.
    path: '/api/v1/accounts/:accountId/account_notifications',
    handler: ({ query }) => {
      const now = Date.now();
      const all = query.include_all === 'true';
      return notifications
        .filter((n) => all || !dismissed.has(n.id))
        .filter((n) => new Date(n.start_at).getTime() <= now && new Date(n.end_at).getTime() >= now)
        .map(json);
    },
  },
  {
    path: '/api/v1/accounts/:accountId/account_notifications/:id',
    handler: ({ params }) => {
      const n = notifications.find((x) => x.id === params.id);
      return n
        ? json(n)
        : { status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } };
    },
  },
  {
    // "Close notification for user": affects only the current user.
    method: 'DELETE',
    path: '/api/v1/accounts/:accountId/account_notifications/:id',
    handler: dismiss,
  },
];
