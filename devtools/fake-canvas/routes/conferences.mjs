/**
 * Web conferences (HOME-8): one live now in BIO 201, one that ended, and one
 * scheduled for later. `GET /api/v1/conferences` (conferences_controller#for_user)
 * filters with `state=live` (lib/api/v1/conferences.rb). Course and group lists
 * live in group-content.mjs with the same three conferences. The join page
 * stands in for BigBlueButton.
 */
import { BASE, user } from '../data.mjs';

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

const conferences = [
  {
    id: '33010',
    title: 'Office Hours: Osmosis Lab Q&A',
    conference_type: 'BigBlueButton',
    description: 'Drop in with questions about the osmosis lab report.',
    duration: 60,
    started_at: minutesAgo(12),
    ended_at: null,
    context_type: 'Course',
    context_id: '201',
  },
  {
    id: '33001',
    title: 'MP3 Review Session',
    conference_type: 'BigBlueButton',
    description: 'Walkthrough of the hash table starter code.',
    duration: 90,
    started_at: minutesAgo(60 * 26),
    ended_at: minutesAgo(60 * 24),
    context_type: 'Course',
    context_id: '225',
  },
  {
    id: '33020',
    title: 'Lab Group Check-in',
    conference_type: 'BigBlueButton',
    description: null,
    duration: 30,
    started_at: null,
    ended_at: null,
    context_type: 'Group',
    context_id: '501',
  },
];

function json(c) {
  const context = c.context_type === 'Group' ? 'groups' : 'courses';
  return {
    id: c.id,
    title: c.title,
    conference_type: c.conference_type,
    description: c.description,
    duration: c.duration,
    started_at: c.started_at,
    ended_at: c.ended_at,
    start_at: null,
    end_at: null,
    users: [user.id],
    invitees: [],
    attendees: [],
    has_advanced_settings: false,
    long_running: false,
    user_settings: {},
    recordings: [],
    join_url: null,
    conference_key: `fake-${c.id}`,
    context_type: c.context_type,
    context_id: c.context_id,
    url: `${BASE}/${context}/${c.context_id}/conferences/${c.id}`,
  };
}

const live = (c) => c.started_at && !c.ended_at;

function joinPage({ params }) {
  const c = conferences.find((x) => x.id === params.conferenceId);
  if (!c) return { status: 404, body: 'Conference not found', headers: { 'Content-Type': 'text/plain' } };
  const body = live(c)
    ? `<h1>${c.title}</h1><p>You joined the conference. This page stands in for BigBlueButton.</p><p>3 people are here.</p>`
    : `<h1>${c.title}</h1><p>This conference isn't running right now.</p>`;
  return {
    status: 200,
    body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${c.title}</title>
<style>body{font:17px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:32px 20px;background:#1f2933;color:#f5f7fa}h1{font-size:24px}</style></head><body>${body}</body></html>`,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  };
}

export const routes = [
  {
    path: '/api/v1/conferences',
    handler: ({ query }) => ({
      conferences: conferences.filter((c) => query.state !== 'live' || live(c)).map(json),
    }),
  },
  // Canvas's join route redirects to the provider; the fake shows the room itself.
  { path: '/courses/:courseId/conferences/:conferenceId/join', public: true, handler: joinPage },
  { path: '/groups/:groupId/conferences/:conferenceId/join', public: true, handler: joinPage },
];
