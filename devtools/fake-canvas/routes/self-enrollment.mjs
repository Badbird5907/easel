/**
 * Joining a course with a code (COURSE-8), owned by the Course content and
 * communication workstream.
 *
 * Canvas has no JSON lookup from a code to a course: `GET /enroll/:code` is the
 * HTML join page (self_enrollments_controller.rb), whose form posts to
 * `POST /api/v1/courses/:id/enrollments` with `enrollment[self_enrollment_code]`
 * and `enrollment[user_id]=self` (enrollments_api_controller.rb#create_self_enrollment).
 *
 * Codes:
 *   ASTRO7  joins ASTR 101 Introduction to Astronomy (course 601), current term
 *   FULL22  a full course (course 602): 400 with type "full"
 *   OLDIE1  a concluded course (course 603): 400 with type "concluded"
 *
 * Joined courses go into routes/core.mjs's course list through the shared
 * enrollments store on globalThis, so All courses and the course screens see them.
 */
import { at, BASE, user } from '../data.mjs';

const codes = {
  ASTRO7: {
    id: '601',
    code: 'ASTR 101',
    name: 'Introduction to Astronomy',
    term: '1',
    workflow: 'available',
    enrollment: 'active',
    enrollmentId: '70601',
    section: 'ASTR 101 Lecture',
    teacher: 'Dr. Lena Okafor',
  },
  FULL22: { id: '602', code: 'PHOT 110', name: 'Intro to Photography', full: true },
  OLDIE1: { id: '603', code: 'GEOL 100', name: 'Physical Geology', concluded: true },
};

const byCourse = (id) => Object.entries(codes).find(([, c]) => c.id === String(id));

const store = () => (globalThis.__fakeCanvasEnrollments ??= { changes: {}, otherCourses: [] });
const joined = (globalThis.__fakeCanvasJoined ??= new Set());

/** Puts joined courses back in core.mjs's list, which resets when that file reloads. */
function syncJoined() {
  const list = store().otherCourses;
  for (const code of joined) {
    const c = codes[code];
    if (c && !list.some((x) => x.id === c.id)) list.push({ ...c });
  }
}

function joinPage(code, c) {
  const action = `${BASE}/api/v1/courses/${c.id}/enrollments?enrollment%5Bself_enrollment_code%5D=${code}&enrollment%5Buser_id%5D=self`;
  return `<!doctype html><html><head><title>Join ${c.name}</title><meta name="viewport" content="width=device-width"></head>
<body><h2>Join ${c.name}</h2>
<p>You are enrolling in <b>${c.name}</b>.</p>
<form id="enroll_form" action="${action}" method="post"><button type="submit">Enroll in Course</button></form>
</body></html>`;
}

const selfEnrollError = (type, message) => ({
  status: 400,
  body: { user: { errors: { self_enrollment_code: [{ attribute: 'self_enrollment_code', type, message }] } } },
});

export const routes = [
  {
    path: '/enroll/:code',
    public: true,
    handler: ({ params }) => {
      const code = params.code.toUpperCase();
      const c = codes[code];
      if (!c)
        return {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body: '<!doctype html><h1>Page Not Found</h1>',
        };
      return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: joinPage(code, c) };
    },
  },
  {
    method: 'POST',
    path: '/api/v1/courses/:courseId/enrollments',
    handler: ({ params, body, query }) => {
      const enrollment = body?.enrollment ?? {
        self_enrollment_code: query['enrollment[self_enrollment_code]'],
        user_id: query['enrollment[user_id]'],
      };
      if (!enrollment?.self_enrollment_code)
        return { status: 401, body: { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] } };
      const found = byCourse(params.courseId);
      const code = String(enrollment.self_enrollment_code).toUpperCase();
      if (!found || found[0] !== code)
        return { status: 400, body: { message: 'enrollment[self_enrollment_code] is invalid' } };
      if (enrollment.user_id !== 'self')
        return { status: 400, body: { message: "enrollment[user_id] must be 'self' when self-enrolling" } };
      const c = found[1];
      if (c.full) return selfEnrollError('full', 'full');
      if (c.concluded) return selfEnrollError('concluded', 'concluded');
      if (joined.has(code)) return selfEnrollError('already_enrolled', 'already_enrolled');
      joined.add(code);
      syncJoined();
      return {
        id: c.enrollmentId,
        user_id: user.id,
        course_id: c.id,
        type: 'StudentEnrollment',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        course_section_id: `${c.id}0`,
        enrollment_state: 'active',
        self_enrolled: true,
        role: 'StudentEnrollment',
        html_url: `${BASE}/courses/${c.id}/users/${user.id}`,
        start_at: null,
        end_at: null,
        last_activity_at: at(0, 0),
      };
    },
  },
  {
    // Development only: forget joined courses.
    method: 'POST',
    path: '/fake/self-enrollment/reset',
    handler: () => {
      const list = store().otherCourses;
      for (const code of joined) {
        const index = list.findIndex((x) => x.id === codes[code]?.id);
        if (index >= 0) list.splice(index, 1);
      }
      joined.clear();
      return { ok: true };
    },
  },
];

syncJoined();
