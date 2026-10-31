/**
 * Grades: the student's enrollment grades, overall and per grading period
 * (GET /api/v1/courses/:id/enrollments, lib/api/v1/enrollment.rb).
 *
 * Assignment groups and grading periods come from course-content.mjs, which
 * owns assignments so the grades list and the assignment screen agree. The
 * scores here are computed from whatever /assignment_groups serves, so the
 * course total always matches the rows the app shows.
 */
import { BASE, courseById, user } from '../data.mjs';

// MARK: - Course flags

// core.mjs reads these from the shared course records but data.mjs leaves them
// unset. Applying them here keeps /api/v1/courses and the grade routes in agreement.
const courseFlags = {
  101: { hideFinalGrades: true },
  110: { restrictQuantitativeData: true },
};
for (const [id, flags] of Object.entries(courseFlags)) {
  const course = courseById(id);
  if (course) Object.assign(course, flags);
}

// MARK: - Scores
//
// A small CourseGradeCalculator over the served assignment groups: weights,
// drop lowest (and never drop), excused, ungraded, and grades that aren't posted.

async function servedGroups(req, courseId, periodId) {
  const url = new URL(`${BASE}/api/v1/courses/${courseId}/assignment_groups`);
  url.searchParams.append('include[]', 'assignments');
  url.searchParams.append('include[]', 'submission');
  url.searchParams.set('per_page', '100');
  if (periodId) url.searchParams.set('grading_period_id', periodId);
  const response = await fetch(url, { headers: { Authorization: req.headers.authorization ?? '' } });
  return response.ok ? response.json() : [];
}

const notGraded = (a) =>
  a.grading_type === 'not_graded' ||
  (a.submission_types?.length === 1 && a.submission_types[0] === 'not_graded');
// Submission#hide_grade_from_student?
const hiddenFromStudent = (a, s) => !s.posted_at && (a.post_manually || s.workflow_state === 'graded');

function groupScore(group, includeUngraded) {
  let rows = (group.assignments ?? [])
    .filter((a) => a.published !== false && !a.omit_from_final_grade && !notGraded(a) && a.submission)
    // A hidden grade reaches the student as ungraded, even an excusal: it counts as zero
    // when ungraded work counts, as in Canvas's posted totals.
    .filter((a) => hiddenFromStudent(a, a.submission) || !a.submission.excused)
    .map((a) => {
      const hidden = hiddenFromStudent(a, a.submission);
      return {
        id: a.id,
        total: a.points_possible ?? 0,
        score: hidden ? 0 : (a.submission.score ?? 0),
        graded: !hidden && a.submission.score != null && a.submission.workflow_state !== 'pending_review',
      };
    });
  if (!includeUngraded) rows = rows.filter((r) => r.graded);
  const neverDrop = new Set(group.rules?.never_drop ?? []);
  const droppable = rows.filter((r) => !neverDrop.has(r.id));
  const drop = Math.min(group.rules?.drop_lowest ?? 0, Math.max(droppable.length - 1, 0));
  if (drop > 0) {
    // Brute force the best set to keep (what Kane & Kane finds); fixture groups are small.
    const pinned = rows.filter((r) => neverDrop.has(r.id));
    let best = droppable;
    let bestPct = -1;
    const choose = (start, kept, left) => {
      if (left === 0) {
        const all = [...kept, ...pinned];
        const total = all.reduce((t, r) => t + r.total, 0);
        const pct = total ? all.reduce((t, r) => t + r.score, 0) / total : 0;
        if (pct > bestPct) [best, bestPct] = [kept, pct];
        return;
      }
      for (let i = start; i < droppable.length; i++) choose(i + 1, [...kept, droppable[i]], left - 1);
    };
    choose(0, [], droppable.length - drop);
    rows = [...best, ...pinned];
  }
  return {
    score: rows.reduce((t, r) => t + r.score, 0),
    possible: rows.reduce((t, r) => t + r.total, 0),
    graded: rows.filter((r) => r.graded).length,
  };
}

const round2 = (n) => Math.round(Number(`${Number(n.toPrecision(12))}e2`)) / 100;

function courseScore(groups, weighted, includeUngraded) {
  const parts = groups.map((g) => ({ ...groupScore(g, includeUngraded), weight: g.group_weight ?? 0 }));
  if (!weighted) {
    const possible = parts.reduce((t, p) => t + p.possible, 0);
    return possible ? round2((parts.reduce((t, p) => t + p.score, 0) / possible) * 100) : null;
  }
  const relevant = parts.filter((p) => p.possible > 0);
  const weight = relevant.reduce((t, p) => t + p.weight, 0);
  if (weight === 0) return null;
  if (!includeUngraded && relevant.every((p) => p.graded === 0)) return null;
  const total = relevant.reduce((t, p) => t + (p.score / p.possible) * p.weight, 0);
  return round2(weight < 100 ? (total / weight) * 100 : total);
}

const scheme = [
  ['A', 94],
  ['A-', 90],
  ['B+', 87],
  ['B', 84],
  ['B-', 80],
  ['C+', 77],
  ['C', 74],
  ['C-', 70],
  ['D+', 67],
  ['D', 64],
  ['D-', 61],
  ['F', 0],
];
const letter = (score) => (score === null ? null : scheme.find(([, min]) => score >= min)[0]);

async function enrollmentGrades(req, courseId, periodId) {
  const c = courseById(courseId);
  if (!c || c.hideFinalGrades) {
    return { current_score: null, current_grade: null, final_score: null, final_grade: null };
  }
  const groups = await servedGroups(req, courseId, periodId);
  // core.mjs reports apply_assignment_group_weights: true for every course.
  const current = courseScore(groups, true, false);
  const final = courseScore(groups, true, true);
  return {
    html_url: `${BASE}/courses/${courseId}/grades/${user.id}`,
    current_score: current,
    current_grade: letter(current),
    final_score: final,
    final_grade: letter(final),
  };
}

// MARK: - What-if scores (WhatIfGradesApiController)
//
// Saved what-if scores live on the submission (`student_entered_score`). Every
// fake course names submissions `s<assignment id>`, so the map is keyed that way.

const whatIf = (globalThis.__easelFakeWhatIf ??= new Map());

const whatIfJson = (submissionId) => ({
  id: submissionId,
  assignment_id: submissionId.replace(/^s/, ''),
  user_id: user.id,
  student_entered_score: whatIf.get(submissionId) ?? null,
});

// MARK: - Routes

const notFound = { status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } };

export const routes = [
  {
    // GET /api/v1/courses/:course_id/students/submissions (SubmissionsApiController#for_students).
    // Keep saved scores isolated by course, as the Canvas endpoint does.
    path: '/api/v1/courses/:courseId/students/submissions',
    handler: async ({ params, req }) => {
      if (!courseById(params.courseId)) return notFound;
      const groups = await servedGroups(req, params.courseId, null);
      const ids = new Set(groups.flatMap((group) => (group.assignments ?? []).map((a) => String(a.submission?.id))));
      return [...whatIf.keys()].filter((id) => ids.has(id) && whatIf.get(id) !== null).map(whatIfJson);
    },
  },
  {
    // PUT /api/v1/submissions/:id/what_if_grades (WhatIfGradesApiController#update)
    method: 'PUT',
    path: '/api/v1/submissions/:id/what_if_grades',
    handler: ({ params, body, query }) => {
      const args = { ...(query ?? {}), ...(body ?? {}) };
      if (!('student_entered_score' in args))
        return {
          status: 400,
          body: { error: 'student_entered_score is required to be either a number or null.' },
        };
      const raw = args.student_entered_score;
      const score = raw === null || raw === 'null' || raw === 'nil' ? null : Number(raw);
      if (score !== null && !Number.isFinite(score))
        return {
          status: 400,
          body: { error: 'student_entered_score is required to be either a number or null.' },
        };
      if (score === null) whatIf.delete(params.id);
      else whatIf.set(params.id, Math.round(score * 100) / 100);
      return {
        grades: [],
        submission: { id: params.id, student_entered_score: whatIf.get(params.id) ?? null },
      };
    },
  },
  {
    // PUT /api/v1/courses/:course_id/what_if_grades/reset (WhatIfGradesApiController#reset_for_student_course)
    method: 'PUT',
    path: '/api/v1/courses/:courseId/what_if_grades/reset',
    handler: async ({ params, req }) => {
      if (!courseById(params.courseId)) return notFound;
      const groups = await servedGroups(req, params.courseId, null);
      for (const group of groups)
        for (const assignment of group.assignments ?? []) whatIf.delete(String(assignment.submission?.id));
      return { grades: [] };
    },
  },
  {
    // GET /api/v1/courses/:course_id/enrollments, the student's own enrollment (EnrollmentsApiController#index)
    path: '/api/v1/courses/:courseId/enrollments',
    handler: async ({ params, query, req }) => {
      const c = courseById(params.courseId);
      if (!c) return notFound;
      const periodId = query.grading_period_id || null;
      return [
        {
          id: `8${c.id}`,
          course_id: c.id,
          course_section_id: `7${c.id}`,
          user_id: user.id,
          type: 'StudentEnrollment',
          role: 'StudentEnrollment',
          enrollment_state: 'active',
          html_url: `${BASE}/courses/${c.id}/users/${user.id}`,
          grades: await enrollmentGrades(req, c.id, periodId),
          user: {
            id: user.id,
            name: user.name,
            short_name: user.short_name,
            sortable_name: user.sortable_name,
          },
        },
      ];
    },
  },
];
