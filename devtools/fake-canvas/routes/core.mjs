/** Users, dashboard cards, colors, and course basics. Shared by every feature. */
import { BASE, courseById as currentCourseById, courses, user } from '../data.mjs';

/** Canvas-style pagination: `?page=N&per_page=M` with a Link header. */
export function paginate(items, query, url) {
  const perPage = Math.min(Number(query.per_page ?? 10), 100);
  const page = Math.max(Number(query.page ?? 1), 1);
  const slice = items.slice((page - 1) * perPage, page * perPage);
  const headers = {};
  if (page * perPage < items.length) {
    const next = new URL(url);
    next.searchParams.set('page', String(page + 1));
    next.searchParams.set('per_page', String(perPage));
    headers.Link = `<${next.toString().replace(/^http:\/\/[^/]+/, BASE)}>; rel="next"`;
  }
  return { status: 200, body: slice, headers };
}

export const assetString = (id) => `course_${id}`;

// --- Terms, and courses beyond this term ---------------------------------------
//
// data.mjs holds the current term's courses (the dashboard). All courses also
// lists past and upcoming enrollments and two pending invitations; those live
// here so dashboard cards stay as they are.

const terms = {
  1: { id: '1', name: 'Fall 2026', start_at: '2026-08-24T05:00:00Z', end_at: '2026-12-18T06:00:00Z' },
  2: { id: '2', name: 'Spring 2026', start_at: '2026-01-12T06:00:00Z', end_at: '2026-05-08T05:00:00Z' },
  3: { id: '3', name: 'Fall 2025', start_at: '2025-08-25T05:00:00Z', end_at: '2025-12-19T06:00:00Z' },
  4: { id: '4', name: 'Spring 2027', start_at: '2027-01-11T06:00:00Z', end_at: '2027-05-07T05:00:00Z' },
};

/**
 * `workflow` is the course's state; `enrollment` is the student's enrollment
 * workflow_state before any accept or decline. `restricted` courses are past
 * their dates at a school that closes them to students, so Canvas lists them
 * with only an ID.
 */
// prettier-ignore
const otherCourses = [
  // Past: Spring 2026
  { id: '301', code: 'CHEM 102', name: 'General Chemistry II', term: '2', workflow: 'completed', enrollment: 'completed', enrollmentId: '70301', section: 'CHEM 102 Lecture A', teacher: 'Dr. Ruth Abara' },
  // Concluded by the term's end date; Canvas never moved the course itself to completed.
  { id: '302', code: 'MATH 231', name: 'Calculus II', term: '2', workflow: 'available', enrollment: 'active', enrollmentId: '70302', section: 'MATH 231 Section 4', teacher: 'Prof. Daniel Reyes' },
  // Past: Fall 2025
  { id: '303', code: 'ENGL 101', name: 'Academic Writing', term: '3', workflow: 'completed', enrollment: 'completed', enrollmentId: '70303', section: 'ENGL 101 Section 12', teacher: 'Dr. Hannah Kim' },
  { id: '304', code: 'PSYC 100', name: 'Introduction to Psychology', term: '3', workflow: 'completed', enrollment: 'completed', enrollmentId: '70304', section: 'PSYC 100 Lecture', teacher: 'Dr. Mei Tanaka', restricted: true },
  { id: '305', code: 'BIO 150', name: 'Foundations of Biology', term: '3', workflow: 'completed', enrollment: 'completed', enrollmentId: '70305', section: 'BIO 150 Lab B', teacher: 'Dr. Amara Osei' },
  // Upcoming: Spring 2027, already enrolled
  { id: '401', code: 'BIO 310', name: 'Molecular Genetics', term: '4', workflow: 'available', enrollment: 'active', enrollmentId: '70401', section: 'BIO 310 Lecture', teacher: 'Dr. Amara Osei' },
  { id: '402', code: 'STAT 200', name: 'Statistical Methods', term: '4', workflow: 'available', enrollment: 'active', enrollmentId: '70402', section: 'STAT 200 Section 1', teacher: 'Prof. Ines Duarte' },
  // Pending invitations (HOME-6)
  { id: '501', code: 'ART 205', name: 'Printmaking', term: '1', workflow: 'available', enrollment: 'invited', enrollmentId: '70501', section: 'ART 205 Section 2', teacher: 'Marco Bellini' },
  { id: '502', code: 'PHYS 212', name: 'Electricity and Magnetism', term: '4', workflow: 'available', enrollment: 'invited', enrollmentId: '70502', section: 'PHYS 212 Lab L4', teacher: 'Prof. Omar Haddad' },
];

/**
 * Accept and decline (routes/enrollments.mjs) change enrollment states. Route
 * files reload as fresh module instances, and a plain `import './core.mjs'`
 * keeps whichever version loaded first, so the fixtures and changes are shared
 * on globalThis instead. Changes survive either file reloading and reset when
 * the server restarts.
 */
const enrollmentStore = (globalThis.__fakeCanvasEnrollments ??= { changes: {} });
enrollmentStore.otherCourses = otherCourses;
enrollmentStore.terms = terms;

const enrollmentStateOf = (c) => enrollmentStore.changes[c.id] ?? c.enrollment ?? 'active';

const courseById = (id) => currentCourseById(id) ?? otherCourses.find((c) => c.id === String(id));

const nowMs = () => Date.now();

/**
 * The enrollment's state by date (Canvas's EnrollmentState): an active
 * enrollment before the term starts is pending, and after it ends, completed.
 */
function stateByDate(c) {
  const state = enrollmentStateOf(c);
  const term = terms[c.term ?? '1'];
  const started = Date.parse(term.start_at) <= nowMs();
  const ended = Date.parse(term.end_at) < nowMs();
  if (state === 'active') {
    if (c.workflow === 'completed' || ended) return 'completed';
    return started ? 'active' : 'pending_active';
  }
  if (state === 'invited') return started ? 'invited' : 'pending_invited';
  return state;
}

/** Whether the course belongs in `GET /api/v1/courses` for these params (courses_controller#courses_for_user). */
function listed(c, query) {
  const workflow = c.workflow ?? 'available';
  const state = enrollmentStateOf(c);
  const byDate = stateByDate(c);
  if (query.state) {
    // state[]: the course's workflow state, each with the enrollment states Canvas pairs it with.
    const wanted = new Set(
      []
        .concat(query.state)
        .flatMap((s) =>
          s === 'unpublished'
            ? ['created', 'claimed']
            : s === 'current_and_concluded'
              ? ['available', 'completed']
              : [s],
        ),
    );
    if (!wanted.has(workflow)) return false;
    const pairs = { available: ['active', 'invited'], completed: ['active', 'completed'] };
    if (!(pairs[workflow] ?? ['active']).includes(state)) return false;
    switch (query.enrollment_state) {
      case 'active':
        return byDate === 'active';
      case 'invited_or_pending':
        return ['invited', 'pending_invited', 'pending_active'].includes(byDate);
      case 'completed':
        return byDate === 'completed';
      default:
        return true;
    }
  }
  // enrollment_state=active alone: participating enrollments, current by date.
  if (query.enrollment_state === 'active') return workflow === 'available' && byDate === 'active';
  // Otherwise Canvas's "current-ish" enrollments: active or invited, in published courses.
  if (workflow !== 'available' || !['active', 'invited'].includes(state)) return false;
  if (query.enrollment_state === 'invited_or_pending')
    return ['invited', 'pending_invited', 'pending_active'].includes(byDate);
  if (query.enrollment_state === 'completed') return byDate === 'completed';
  return true;
}

/** Current grading periods, matching routes/course-content.mjs (BIO 201's second half is always current). */
const currentGradingPeriods = { 201: { id: '92', title: 'Second half' } };

/** Course JSON as Canvas builds it (lib/api/v1/course_json.rb); `include[]` adds the optional blocks. */
function courseJson(c, includes) {
  const other = otherCourses.includes(c);
  const term = terms[c.term ?? '1'];
  if (c.restricted)
    // Canvas sends restricted courses as just an ID (lib/api/v1/course.rb).
    return { id: c.id, access_restricted_by_date: true };
  const totals = includes.has('total_scores') && !c.hideFinalGrades && !other;
  const period = currentGradingPeriods[c.id];
  const json = {
    id: c.id,
    name: c.name,
    course_code: c.code,
    original_name: c.name,
    workflow_state: c.workflow ?? 'available',
    default_view: c.defaultView ?? 'modules',
    hide_final_grades: c.hideFinalGrades ?? false,
    restrict_quantitative_data: c.restrictQuantitativeData ?? false,
    apply_assignment_group_weights: true,
    enrollment_term_id: term.id,
    start_at: null,
    end_at: null,
    restrict_enrollments_to_course_dates: false,
    enrollments: [
      {
        type: 'student',
        role: 'StudentEnrollment',
        role_id: '3',
        user_id: user.id,
        enrollment_state: enrollmentStateOf(c),
        limit_privileges_to_course_section: false,
        // grading_period_info: with both total_scores and current_grading_period_scores.
        ...(includes.has('total_scores') && includes.has('current_grading_period_scores')
          ? {
              current_grading_period_id: period?.id ?? null,
              current_grading_period_title: period?.title ?? null,
              has_grading_periods: !!period,
              multiple_grading_periods_enabled: !!period,
            }
          : {}),
        ...(totals
          ? {
              computed_current_score: c.score,
              computed_current_grade: c.grade,
              computed_final_score: c.score === null ? null : Math.round(c.score * 0.86 * 10) / 10,
              computed_final_grade: c.grade,
              ...(includes.has('current_grading_period_scores')
                ? {
                    totals_for_all_grading_periods_option: true,
                    current_period_computed_current_score: period ? c.score : null,
                    current_period_computed_final_score:
                      period && c.score !== null ? Math.round(c.score * 0.9 * 10) / 10 : null,
                    current_period_computed_current_grade: period ? c.grade : null,
                    current_period_computed_final_grade: period ? c.grade : null,
                  }
                : {}),
            }
          : {}),
      },
    ],
  };
  if (includes.has('current_grading_period_scores')) {
    json.has_grading_periods = !!period;
    json.multiple_grading_periods_enabled = !!period;
    json.has_weighted_grading_periods = false;
  }
  if (includes.has('term')) json.term = { ...term };
  if (includes.has('concluded'))
    json.concluded = c.workflow === 'completed' || Date.parse(term.end_at) < nowMs();
  if (includes.has('favorites')) json.is_favorite = !other;
  if (includes.has('sections'))
    json.sections = [
      {
        id: `${c.id}0`,
        name: c.section ?? `${c.code} Section 1`,
        start_at: null,
        end_at: null,
        enrollment_role: 'StudentEnrollment',
      },
    ];
  if (includes.has('teachers')) json.teachers = [{ id: `t${c.id}`, display_name: c.teacher }];
  if (includes.has('syllabus_body'))
    json.syllabus_body =
      c.syllabus ??
      `<h2>${c.name}</h2><p>Office hours are posted in the course calendar. Late work loses 10% per day, up to three days.</p>`;
  return json;
}

// --- Home customization (HOME-4) ------------------------------------------------
//
// Favorites, nicknames, colors, and dashboard order, on globalThis so they survive
// this file reloading. Every current course starts out favorited, so Home shows
// all six until the student unstars one.

const customize = (globalThis.__fakeCanvasCustomize ??= {
  favorites: courses.map((c) => c.id),
  positions: {},
  nicknames: {},
  colors: {},
});

const notFound = () => ({ status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } });
const colorOf = (c) => customize.colors[c.id] ?? c.color;
const nicknameJson = (id, nickname) => ({ course_id: id, name: courseById(id)?.name, nickname });

/** User#menu_courses: favorites if there are any, otherwise every current course, then dashboard_positions. */
function homeCourses() {
  const shown = customize.favorites.length ? courses.filter((c) => customize.favorites.includes(c.id)) : courses;
  const rank = (c, i) => customize.positions[assetString(c.id)] ?? 1000 + i;
  return shown
    .map((c, i) => [c, rank(c, i)])
    .sort((a, b) => a[1] - b[1])
    .map(([c]) => c);
}

export const routes = [
  {
    // Real Canvas returns a single-use URL that signs a browser in; the fake just echoes return_to.
    path: '/api/v1/login/session_token',
    handler: ({ query }) => ({ session_url: query.return_to ?? BASE, requires_terms_acceptance: false }),
  },
  { path: '/api/v1/users/self', handler: () => user },
  {
    path: '/api/v1/users/self/profile',
    handler: () => ({ ...user, calendar: { ics: `${BASE}/feeds/calendars/user_fake.ics` } }),
  },
  {
    // Dashboard cards (CourseForMenuPresenter): favorites, or every current course when there are none,
    // in the student's dashboard_positions order (HOME-3, HOME-4).
    path: '/api/v1/dashboard/dashboard_cards',
    handler: () =>
      homeCourses().map((c) => ({
        id: c.id,
        shortName: customize.nicknames[c.id] ?? c.name,
        originalName: c.name,
        courseCode: c.code,
        assetString: assetString(c.id),
        href: `/courses/${c.id}`,
        term: 'Fall 2026',
        isFavorited: customize.favorites.includes(c.id),
        image: null,
        color: colorOf(c),
        position: customize.positions[assetString(c.id)] ?? null,
        enrollmentType: 'StudentEnrollment',
      })),
  },
  {
    path: '/api/v1/users/:userId/colors',
    handler: () => ({ custom_colors: Object.fromEntries(courses.map((c) => [assetString(c.id), colorOf(c)])) }),
  },
  {
    path: '/api/v1/users/:userId/colors/:assetString',
    handler: ({ params }) => {
      const c = courseById(params.assetString.replace(/^course_/, ''));
      return c ? { hexcode: colorOf(c) } : notFound();
    },
  },
  {
    // users_controller#set_custom_color: `hexcode`, with or without "#".
    method: 'PUT',
    path: '/api/v1/users/:userId/colors/:assetString',
    handler: ({ params, body, query }) => {
      const c = courseById(params.assetString.replace(/^course_/, ''));
      if (!c) return notFound();
      const hex = String(body?.hexcode ?? query.hexcode ?? '');
      if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return { status: 400, body: { message: 'Invalid Hexcode Provided' } };
      customize.colors[c.id] = hex.startsWith('#') ? hex : `#${hex}`;
      return { hexcode: customize.colors[c.id] };
    },
  },
  {
    path: '/api/v1/users/:userId/dashboard_positions',
    handler: () => ({ dashboard_positions: customize.positions }),
  },
  {
    method: 'PUT',
    path: '/api/v1/users/:userId/dashboard_positions',
    handler: ({ body }) => {
      const positions = body?.dashboard_positions ?? {};
      for (const [key, value] of Object.entries(positions)) {
        if (!courseById(key.replace(/^course_/, ''))) return { status: 404, body: { errors: [{ message: `Asset ${key} does not exist` }] } };
        const n = Number(value);
        if (!Number.isInteger(n) || Math.abs(n) > 1000) return { status: 400, body: { message: 'Invalid position provided' } };
        customize.positions[key] = n;
      }
      return { dashboard_positions: customize.positions };
    },
  },
  {
    // favorites_controller#list_favorite_courses: the favorites, or Canvas's pick when there are none.
    path: '/api/v1/users/self/favorites/courses',
    handler: () => homeCourses().map((c) => ({ ...courseJson(c, new Set(['term'])), is_favorite: customize.favorites.includes(c.id) })),
  },
  {
    method: 'POST',
    path: '/api/v1/users/self/favorites/courses/:courseId',
    handler: ({ params }) => {
      const c = courseById(params.courseId);
      if (!c) return notFound();
      if (!customize.favorites.includes(c.id)) customize.favorites.push(c.id);
      return { context_id: c.id, context_type: 'Course' };
    },
  },
  {
    method: 'DELETE',
    path: '/api/v1/users/self/favorites/courses/:courseId',
    handler: ({ params }) => {
      const had = customize.favorites.includes(String(params.courseId));
      customize.favorites = customize.favorites.filter((id) => id !== String(params.courseId));
      return had ? { context_id: String(params.courseId), context_type: 'Course' } : {};
    },
  },
  {
    method: 'DELETE',
    path: '/api/v1/users/self/favorites/courses',
    handler: () => {
      customize.favorites = [];
      return { message: 'OK' };
    },
  },
  {
    // course_nicknames_controller.rb
    path: '/api/v1/users/self/course_nicknames',
    handler: () => Object.entries(customize.nicknames).map(([id, nickname]) => nicknameJson(id, nickname)),
  },
  {
    path: '/api/v1/users/self/course_nicknames/:courseId',
    handler: ({ params }) => {
      const c = courseById(params.courseId);
      if (!c) return notFound();
      return nicknameJson(c.id, customize.nicknames[c.id] ?? null);
    },
  },
  {
    method: 'PUT',
    path: '/api/v1/users/self/course_nicknames/:courseId',
    handler: ({ params, body, query }) => {
      const c = courseById(params.courseId);
      if (!c) return notFound();
      const nickname = String(body?.nickname ?? query.nickname ?? '');
      if (!nickname.trim()) return { status: 400, body: { message: 'missing nickname' } };
      if (nickname.length >= 60) return { status: 400, body: { message: 'nickname too long' } };
      customize.nicknames[c.id] = nickname;
      return nicknameJson(c.id, nickname);
    },
  },
  {
    method: 'DELETE',
    path: '/api/v1/users/self/course_nicknames/:courseId',
    handler: ({ params }) => {
      const c = courseById(params.courseId);
      if (!c) return notFound();
      delete customize.nicknames[c.id];
      return nicknameJson(c.id, null);
    },
  },
  {
    method: 'DELETE',
    path: '/api/v1/users/self/course_nicknames',
    handler: () => {
      customize.nicknames = {};
      return { message: 'OK' };
    },
  },
  {
    // GET /api/v1/courses (lib/api/v1/course_json.rb). Shared by All courses and Grades.
    path: '/api/v1/courses',
    // Filters by state[] and enrollment_state like courses_controller#courses_for_user.
    handler: ({ query, url }) => {
      const includes = new Set(query.include ?? []);
      const byName = (a, b) => a.name.localeCompare(b.name);
      return paginate(
        [...courses, ...[...otherCourses].sort(byName)]
          .filter((c) => listed(c, query))
          .map((c) => courseJson(c, includes)),
        query,
        url,
      );
    },
  },
  {
    path: '/api/v1/courses/:courseId',
    handler: ({ params, query }) => {
      const c = courseById(params.courseId);
      if (!c)
        return { status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } };
      return courseJson(c, new Set([...(query.include ?? []), 'total_scores']));
    },
  },
];
