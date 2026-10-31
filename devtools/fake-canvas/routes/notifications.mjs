/**
 * Developer hooks for testing background refresh (owned by the notifications
 * workstream). Each call makes one thing "new" in the fake Canvas, so the next
 * background check has something to announce:
 *
 *   curl -X POST 'localhost:3030/__dev/notifications/inject?kind=grade' -H 'Authorization: Bearer dev'
 *
 * kind: grade | comment | announcement | message | assignment
 *
 * Feature data lives in each route file's module scope, so this reaches the
 * same module instances the server loaded (it imports `<file>?v=<mtime>`, as
 * server.mjs does):
 *   - grade, comment, announcement: change items of the activity stream in place
 *   - message: adds a reply through the inbox API and marks the conversation unread.
 *     The fake has one user, so the reply is the student's own.
 *   - assignment: adds an existing course assignment to the shared planner fixtures
 * Everything resets when the edited route file reloads.
 */
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BASE, courseById, work } from '../data.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** The instance of a route file that the server is using. */
async function serverModule(file) {
  const path = join(here, file);
  const { mtimeMs } = await stat(path);
  return import(`${pathToFileURL(path).href}?v=${mtimeMs}`);
}

async function call(file, method, path, { params = {}, query = {}, body } = {}) {
  const mod = await serverModule(file);
  const route = mod.routes.find((r) => (r.method ?? 'GET') === method && r.path === path);
  if (!route) throw new Error(`${file} no longer serves ${method} ${path}`);
  const url = new URL(`${BASE}${path}`);
  const req = { headers: { authorization: 'Bearer dev' } };
  const result = await route.handler({ params, query, body, req, url });
  return result && typeof result === 'object' && 'body' in result ? result.body : result;
}

/** The activity stream's own item objects, so changes show up in its responses. */
const streamItems = () =>
  call('activity.mjs', 'GET', '/api/v1/users/self/activity_stream', { query: { per_page: '100' } });

let injected = 0;
const now = () => new Date().toISOString();

const injectors = {
  async grade() {
    const items = await streamItems();
    const item =
      items.find((i) => i.type === 'Submission' && i.assignment?.points_possible) ??
      items.find((i) => i.type === 'Submission');
    if (!item) return { status: 404, body: { errors: [{ message: 'No submission in the activity stream.' }] } };
    const points = item.assignment?.points_possible ?? 10;
    // A different score each time, so every injection is a changed grade.
    const score = Math.max(0, points - 1 - (injected % Math.max(1, Math.floor(points / 4))));
    Object.assign(item, {
      grade: String(score),
      score,
      workflow_state: 'graded',
      graded_at: now(),
      posted_at: now(),
      updated_at: now(),
      read_state: false,
    });
    return { kind: 'grade', assignment: item.assignment?.name, course_id: item.course_id, score };
  },

  async comment() {
    const items = await streamItems();
    const item = items.find((i) => i.type === 'Submission' && i.submission_comments) ?? items.find((i) => i.type === 'Submission');
    if (!item) return { status: 404, body: { errors: [{ message: 'No submission in the activity stream.' }] } };
    const teacher = courseById(item.course_id)?.teacher ?? 'Your instructor';
    const text = 'Nice revision. Tighten the conclusion and you’re there.';
    item.submission_comments = [
      ...(item.submission_comments ?? []),
      { id: `dev-${Date.now()}`, author_id: '2999', author_name: teacher, comment: text, body: text, created_at: now() },
    ];
    item.updated_at = now();
    item.read_state = false;
    return { kind: 'comment', assignment: item.assignment?.name, course_id: item.course_id };
  },

  async announcement() {
    const items = await streamItems();
    const announcements = items.filter((i) => i.type === 'Announcement');
    const item = announcements.find((i) => i.read_state) ?? announcements[0];
    if (!item) return { status: 404, body: { errors: [{ message: 'No announcement in the activity stream.' }] } };
    Object.assign(item, { read_state: false, created_at: now(), updated_at: now() });
    return { kind: 'announcement', title: item.title, course_id: item.course_id };
  },

  async message() {
    const id = '4008';
    await call('conversations.mjs', 'POST', '/api/v1/conversations/:id/add_message', {
      params: { id },
      body: { body: 'Following up: does the load factor include deleted slots?' },
    });
    await call('conversations.mjs', 'PUT', '/api/v1/conversations/:id', {
      params: { id },
      body: { conversation: { workflow_state: 'unread' } },
    });
    return { kind: 'message', conversation_id: id };
  },

  async assignment() {
    // Real assignments in course-content.mjs that the planner fixtures leave out.
    const candidates = [
      { id: '9102', course: '201', title: 'Lab Report: Photosynthesis', points: 50 },
      { id: '9108', course: '241', title: 'Problem Set 8: Double Integrals', points: 20 },
      { id: '9118', course: '110', title: 'Elevator pitch recording', points: 10 },
      { id: '9119', course: '201', title: 'Annotate the cell diagram', points: 10 },
    ];
    const next = candidates.find((c) => !work.some((w) => w.id === c.id));
    if (!next) return { status: 409, body: { errors: [{ message: 'Every sample assignment is already in the planner.' }] } };
    const detail = await call('course-content.mjs', 'GET', '/api/v1/courses/:courseId/assignments/:assignmentId', {
      params: { courseId: next.course, assignmentId: next.id },
    }).catch(() => null);
    work.push({
      id: next.id,
      course: next.course,
      type: 'assignment',
      title: next.title,
      due: detail?.due_at ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
      points: next.points,
      sub: {},
    });
    return { kind: 'assignment', title: next.title, course_id: next.course };
  },
};

export const routes = [
  {
    method: 'POST',
    path: '/__dev/notifications/inject',
    handler: async ({ query, body }) => {
      const kind = String(query.kind ?? body?.kind ?? '');
      const inject = injectors[kind];
      if (!inject) {
        return {
          status: 400,
          body: { errors: [{ message: `kind must be one of: ${Object.keys(injectors).join(', ')}` }] },
        };
      }
      injected += 1;
      return inject();
    },
  },
];
