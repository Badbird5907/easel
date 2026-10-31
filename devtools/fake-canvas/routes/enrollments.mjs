/**
 * The student's enrollments and course invitations (HOME-6), owned by the
 * Discussions, announcements, inbox, and courses workstream.
 *
 * Shapes: enrollment_json in lib/api/v1/user.rb; accept and reject in
 * app/controllers/enrollments_api_controller.rb. Past, upcoming, and invited
 * courses are fixtures in routes/core.mjs, so `/api/v1/courses` lists accepted
 * invitations as current.
 *
 * routes/grades.mjs serves GET /api/v1/courses/:courseId/enrollments; this file
 * leaves that path alone.
 */
import { at, BASE, courses, user } from '../data.mjs';
import { paginate } from './core.mjs';

/** Fixtures and accept/decline state, shared with routes/core.mjs on globalThis (see there). */
const store = () => (globalThis.__fakeCanvasEnrollments ??= { changes: {}, otherCourses: [] });
const enrollmentStateOf = (c) => store().changes[c.id] ?? c.enrollment ?? 'active';
const setEnrollmentState = (courseId, state) => {
  store().changes[courseId] = state;
};

/** Every enrollment the student has, current term first. */
function allEnrollments() {
  const current = courses.map((c, i) => ({
    course: c,
    id: `7${String(i + 1).padStart(4, '0')}`,
    section: `${c.code} Section 1`,
    term: '1',
  }));
  const other = store().otherCourses.map((c) => ({
    course: c,
    id: c.enrollmentId,
    section: c.section,
    term: c.term,
  }));
  return [...current, ...other];
}

/** enrollment_json (lib/api/v1/user.rb), for the student's own enrollment. */
function enrollmentJson({ course, id }) {
  return {
    id,
    user_id: user.id,
    course_id: course.id,
    type: 'StudentEnrollment',
    created_at: at(-80, 9),
    updated_at: at(-2, 9),
    associated_user_id: null,
    start_at: null,
    end_at: null,
    course_section_id: `${course.id}0`,
    root_account_id: '1',
    limit_privileges_to_course_section: false,
    enrollment_state: enrollmentStateOf(course),
    role: 'StudentEnrollment',
    role_id: '3',
    last_activity_at: null,
    last_attended_at: null,
    total_activity_time: 0,
    html_url: `${BASE}/courses/${course.id}/users/${user.id}`,
    grades: {
      html_url: `${BASE}/courses/${course.id}/grades/${user.id}`,
      current_score: null,
      current_grade: null,
      final_score: null,
      final_grade: null,
    },
  };
}

/**
 * `state[]` for a user's enrollments (enrollments_api_controller.rb
 * #enrollment_states_for_state_param). Omitted means active and invited.
 */
function wantedStates(state) {
  const states = new Set(state ? [].concat(state) : ['active', 'invited']);
  if (states.delete('current_and_invited')) ['active', 'invited'].forEach((s) => states.add(s));
  if (states.delete('current_and_future'))
    ['active', 'invited', 'creation_pending'].forEach((s) => states.add(s));
  if (states.delete('current_and_concluded')) ['active', 'completed'].forEach((s) => states.add(s));
  return states;
}

const notFound = () => ({
  status: 404,
  body: { errors: [{ message: 'The specified resource does not exist.' }] },
});

function findEnrollment(courseId, id) {
  return allEnrollments().find((e) => e.course.id === String(courseId) && e.id === String(id));
}

/** Accept or reject, with Canvas's guards: only the student's own invitation, only once. */
function answer(next) {
  return ({ params }) => {
    const e = findEnrollment(params.courseId, params.id);
    if (!e) return notFound();
    const state = enrollmentStateOf(e.course);
    if (next === 'active' && state === 'active') return { success: true };
    if (next === 'rejected' && state === 'rejected') return { success: true };
    if (state !== 'invited') return { status: 400, body: { error: 'no current invitation' } };
    setEnrollmentState(e.course.id, next);
    return { success: true };
  };
}

export const routes = [
  {
    // GET /api/v1/users/:user_id/enrollments: `self` or the student's ID.
    path: '/api/v1/users/:userId/enrollments',
    handler: ({ params, query, url }) => {
      if (params.userId !== 'self' && params.userId !== user.id) return notFound();
      const states = wantedStates(query.state);
      const items = allEnrollments()
        .filter((e) => states.has(enrollmentStateOf(e.course)))
        .map(enrollmentJson);
      return paginate(items, query, url);
    },
  },
  {
    method: 'POST',
    path: '/api/v1/courses/:courseId/enrollments/:id/accept',
    handler: answer('active'),
  },
  {
    method: 'POST',
    path: '/api/v1/courses/:courseId/enrollments/:id/reject',
    handler: answer('rejected'),
  },
  {
    // Development only: puts every invitation back, e.g. `curl -X POST -H 'Authorization: Bearer dev' localhost:3030/fake/enrollments/reset`.
    method: 'POST',
    path: '/fake/enrollments/reset',
    handler: () => {
      store().changes = {};
      return { success: true };
    },
  },
];
