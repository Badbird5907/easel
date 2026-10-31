/**
 * STAT 306, the grading test course (GRADE-2 to GRADE-5). Owned by the Grades workstream.
 *
 * Every grade state the calculator and the grade rows have to handle, in one course:
 *   weighted assignment groups      Homework 25, Quizzes 15, Exams 40, Project 20 (nothing graded yet)
 *   weighted grading periods        Term 1 (40, closed) and Term 2 (60, current)
 *   drop lowest with never drop     Homework drops its lowest score but never HW 5
 *   30602 late                      late_policy_status late, 1 point deducted (entered 8, score 7)
 *   30603 missing                   late_policy_status missing, 50% missing deduction (5 of 10)
 *   30604 excused
 *   30611, 30612 pass/fail          complete (5 of 5) and incomplete (0 of 5)
 *   30613 letter grade              B+ (Canvas stores 8.9 of 10: one point under A−)
 *   30614 pending review            quiz with an essay to grade; 6 points so far
 *   30607 submitted, ungraded
 *   30631 custom grade status       "Needs revision", no score yet
 *   30615 graded, not posted        auto-posted assignment whose grade the teacher hid
 *   30622 graded, not posted        manually posted assignment (post_manually)
 *
 * The routes claim only course 306's literal paths, so the shared routes in core.mjs,
 * course-content.mjs, and grades.mjs keep serving every other course. This file sorts
 * before them and the first match wins.
 *
 * Totals come from `canvasScores` below, a port of the server's GradeCalculator for the
 * student's posted scores. It's independent of Easel's calculator (a port of the web's),
 * so the two checking each other is meaningful. data.mjs keeps STAT 306's all-periods
 * current score for the course list (core.mjs); a mismatch logs a warning at load.
 *
 * Shapes: lib/api/v1/assignment.rb, assignment_group.rb, submission.rb, course_json.rb,
 * user.rb (grades_hash), app/serializers/grading_period_serializer.rb,
 * app/graphql/types/custom_grade_status_type.rb.
 */
import { Buffer } from 'node:buffer';
import { stat } from 'node:fs/promises';

import { at, BASE, courseById, courses, NOW, user } from '../data.mjs';
import { paginate } from './core.mjs';

const COURSE = '306';
const api = `/api/v1/courses/${COURSE}`;

// Route files reload, but data.mjs loads once per server run. Copy STAT 306's record from the
// file on disk into the running copy, so it shows up (and keeps up with edits) without a restart,
// which would reset other fixtures' in-memory state. A no-op once the server restarts.
{
  const file = new URL('../data.mjs', import.meta.url);
  const { mtimeMs } = await stat(file);
  const record = (await import(`${file.href}?v=${mtimeMs}`)).courseById(COURSE);
  if (record && courseById(COURSE)) Object.assign(courseById(COURSE), record);
  else if (record) courses.push({ ...record });
}

const course = courseById(COURSE);
// core.mjs reads default_view from the shared record.
if (course) course.defaultView = 'assignments';

const notFound = { status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } };
const isPast = (iso) => !!iso && new Date(iso) < NOW;

// MARK: - Fixtures

const periods = [
  { id: '30681', title: 'Term 1', start: at(-75, 0), end: at(-22, 0), close: at(-15, 23, 59), weight: 40 },
  { id: '30682', title: 'Term 2', start: at(-22, 0), end: at(45, 23, 59), close: at(52, 23, 59), weight: 60 },
];

const groups = [
  { id: '30691', name: 'Homework', weight: 25, rules: { drop_lowest: 1, never_drop: ['30605'] } },
  { id: '30692', name: 'Quizzes', weight: 15, rules: {} },
  { id: '30693', name: 'Exams', weight: 40, rules: {} },
  { id: '30694', name: 'Project', weight: 20, rules: {} },
];

const customStatuses = [
  { _id: '3071', name: 'Needs revision', color: '#C54396', icon: null },
  { _id: '3072', name: 'Medical leave', color: '#197EAB', icon: null },
];

/**
 * `sub` is the grade as the teacher sees it. `submissionJson` derives what the student
 * gets: unposted grades lose score, grade, entered_score, and entered_grade.
 *   state      workflow_state
 *   submitted  submitted_at
 *   posted     false when the grade is hidden from the student (default true once graded)
 *   deducted   points_deducted; entered_score is score + deducted
 *   policy     late_policy_status; lateBy is seconds_late_override for "late"
 *   status     custom_grade_status_id
 */
// prettier-ignore
const assignments = [
  // Homework
  { id: '30601', group: '30691', name: 'HW 1: Sampling distributions', due: at(-60, 23, 59), points: 10, types: ['online_upload'],
    sub: { state: 'graded', submitted: at(-61, 20), score: 9, graded: at(-57, 10) } },
  { id: '30602', group: '30691', name: 'HW 2: Point estimators', due: at(-46, 23, 59), points: 10, types: ['online_upload'],
    sub: { state: 'graded', submitted: at(-44, 21), score: 7, deducted: 1, policy: 'late', lateBy: 2 * 86_400, graded: at(-42, 9) } },
  { id: '30603', group: '30691', name: 'HW 3: Confidence intervals', due: at(-32, 23, 59), points: 10, types: ['online_upload'],
    sub: { state: 'graded', submitted: null, score: 5, policy: 'missing', graded: at(-31, 0, 5), auto: true } },
  { id: '30604', group: '30691', name: 'HW 4: Hypothesis tests', due: at(-15, 23, 59), points: 10, types: ['online_upload'],
    sub: { state: 'graded', submitted: null, excused: true, graded: at(-14, 9) } },
  { id: '30605', group: '30691', name: 'HW 5: Power and sample size', due: at(-9, 23, 59), points: 10, types: ['online_upload'],
    sub: { state: 'graded', submitted: at(-10, 18), score: 4, graded: at(-7, 11) } },
  { id: '30606', group: '30691', name: 'HW 6: Two-sample tests', due: at(-5, 23, 59), points: 10, types: ['online_upload'],
    sub: { state: 'graded', submitted: at(-6, 22), score: 10, graded: at(-3, 15) } },
  { id: '30607', group: '30691', name: 'HW 7: Paired designs', due: at(-2, 23, 59), points: 10, types: ['online_upload'],
    sub: { state: 'submitted', submitted: at(-2, 20, 15) } },
  { id: '30608', group: '30691', name: 'HW 8: Nonparametric tests', due: at(6, 23, 59), points: 10, types: ['online_upload'],
    sub: { state: 'unsubmitted', submitted: null } },
  // Quizzes
  { id: '30611', group: '30692', name: 'Reading check 1', due: at(-55, 10), points: 5, gradingType: 'pass_fail', types: ['online_text_entry'],
    sub: { state: 'graded', submitted: at(-55, 8), score: 5, grade: 'complete', graded: at(-54, 12) } },
  { id: '30612', group: '30692', name: 'Reading check 2', due: at(-40, 10), points: 5, gradingType: 'pass_fail', types: ['online_text_entry'],
    sub: { state: 'graded', submitted: at(-40, 9, 30), score: 0, grade: 'incomplete', graded: at(-39, 12) } },
  { id: '30613', group: '30692', name: 'Quiz 1: Estimation', due: at(-12, 10), points: 10, gradingType: 'letter_grade', types: ['on_paper'],
    sub: { state: 'graded', submitted: null, score: 8.9, grade: 'B+', graded: at(-10, 16) } },
  { id: '30614', group: '30692', name: 'Quiz 2: Hypothesis testing', due: at(-7, 10), points: 10, types: ['online_quiz'], quiz: '30714',
    sub: { state: 'pending_review', submitted: at(-7, 9, 40), score: 6 } },
  { id: '30615', group: '30692', name: 'Quiz 3: Two-sample inference', due: at(-3, 10), points: 10, types: ['on_paper'],
    sub: { state: 'graded', submitted: null, score: 9, graded: at(-2, 16), posted: false } },
  // Exams
  { id: '30621', group: '30693', name: 'Midterm exam', due: at(-35, 14), points: 100, types: ['on_paper'],
    sub: { state: 'graded', submitted: null, score: 82, graded: at(-31, 12) } },
  { id: '30622', group: '30693', name: 'Exam 2', due: at(-4, 14), points: 100, types: ['on_paper'], postManually: true,
    sub: { state: 'graded', submitted: null, score: 91, graded: at(-1, 17), posted: false } },
  // Project
  { id: '30631', group: '30694', name: 'Project proposal', due: at(-1, 23, 59), points: 20, types: ['online_upload'],
    sub: { state: 'submitted', submitted: at(-1, 22, 30), status: '3071' } },
  { id: '30632', group: '30694', name: 'Final project report', due: at(25, 23, 59), points: 80, types: ['online_upload'],
    sub: { state: 'unsubmitted', submitted: null } },
];

const assignmentById = (id) => assignments.find((a) => a.id === id);

/** Canvas places work in a period by its due date; undated work goes in the last period. */
function periodFor(a) {
  if (!a.due) return periods.at(-1);
  return periods.find((p) => a.due >= p.start && a.due < p.end) ?? null;
}

// MARK: - Submission rules (app/models/submission.rb)

const expectsSubmission = (a) =>
  !(a.types.length === 1 && ['on_paper', 'none', 'not_graded', 'external_tool'].includes(a.types[0]));

const postedAt = (a) => {
  const s = a.sub;
  const graded = s.excused || (s.score != null && s.state === 'graded');
  return s.posted === false || !graded ? null : s.graded;
};

/** Submission#hide_grade_from_student? */
function hideGradeFromStudent(a) {
  const posted = !!postedAt(a);
  if (a.postManually) return !posted;
  const graded = a.sub.excused || (a.sub.score != null && a.sub.state === 'graded');
  return graded && !posted;
}

/** Submission#late? */
function isLate(a) {
  const s = a.sub;
  if (s.excused || s.status) return false;
  if (s.policy) return s.policy === 'late';
  return !!s.submitted && !!a.due && s.submitted > a.due;
}

/** Submission#missing? */
function isMissing(a) {
  const s = a.sub;
  if (s.excused || s.status) return false;
  if (s.state === 'graded' && !s.auto && !s.policy) return false; // grader_id && late_policy_status.nil?
  if (s.policy) return s.policy === 'missing';
  if (s.submitted) return false;
  if (!isPast(a.due)) return false;
  return expectsSubmission(a);
}

function secondsLate(a) {
  const s = a.sub;
  if (s.policy === 'late') return s.lateBy ?? 0;
  if (!s.submitted || !a.due || s.submitted <= a.due) return 0;
  return Math.round((Date.parse(s.submitted) - Date.parse(a.due)) / 1000);
}

/** lib/api/v1/submission.rb submission_attempt_json, as the student sees it. */
function submissionJson(a, includes = new Set()) {
  const s = a.sub;
  const graded = s.score != null || s.excused;
  const json = {
    id: `s${a.id}`,
    user_id: user.id,
    url: null,
    score: s.score ?? null,
    grade: s.grade ?? (s.score != null ? String(s.score) : null),
    excused: !!s.excused,
    attempt: s.submitted ? 1 : null,
    submission_type: s.submitted ? a.types[0] : null,
    submitted_at: s.submitted ?? null,
    body: null,
    assignment_id: a.id,
    graded_at: graded ? (s.graded ?? null) : null,
    grade_matches_current_submission: true,
    grader_id: s.state === 'graded' && !s.auto ? `t${COURSE}` : null,
    workflow_state: s.state,
    late_policy_status: s.policy ?? null,
    points_deducted: s.deducted ?? null,
    grading_period_id: periodFor(a)?.id ?? null,
    cached_due_date: a.due ?? null,
    extra_attempts: null,
    posted_at: postedAt(a),
    redo_request: false,
    sticker: null,
    custom_grade_status_id: s.status ?? null,
    late: isLate(a),
    missing: isMissing(a),
    seconds_late: secondsLate(a),
    entered_grade: null,
    entered_score: s.score != null ? s.score + (s.deducted ?? 0) : null,
    preview_url: `${BASE}/courses/${COURSE}/assignments/${a.id}/submissions/${user.id}?preview=1&version=1`,
  };
  // Submission#entered_grade: the grade before the deduction, for point-based grading.
  json.entered_grade =
    json.entered_score === null
      ? null
      : json.entered_score === json.score
        ? json.grade
        : String(json.entered_score);
  // Submission#filter_attributes_for_user: an unposted grade never reaches the student.
  if (hideGradeFromStudent(a)) {
    for (const key of ['score', 'grade', 'entered_score', 'entered_grade']) delete json[key];
  }
  if (includes.has('submission_history')) json.submission_history = [{ ...json }];
  if (includes.has('submission_comments')) json.submission_comments = [];
  return json;
}

/** lib/api/v1/assignment.rb assignment_json. */
function assignmentJson(a, includes = new Set(), excludes = new Set()) {
  const inGroup = assignments.filter((x) => x.group === a.group);
  const json = {
    id: a.id,
    name: a.name,
    description: `<p>${a.name}. Instructions are in the course syllabus.</p>`,
    course_id: COURSE,
    assignment_group_id: a.group,
    position: inGroup.indexOf(a) + 1,
    points_possible: a.points,
    grading_type: a.gradingType ?? 'points',
    created_at: at(-80, 9),
    updated_at: at(-20, 9),
    due_at: a.due ?? null,
    unlock_at: null,
    lock_at: null,
    submission_types: a.types,
    has_submitted_submissions: !!a.sub.submitted,
    due_date_required: false,
    allowed_attempts: -1,
    html_url: `${BASE}/courses/${COURSE}/assignments/${a.id}`,
    published: true,
    workflow_state: 'published',
    muted: !!a.postManually,
    omit_from_final_grade: false,
    hide_in_gradebook: false,
    only_visible_to_overrides: false,
    visible_to_everyone: true,
    peer_reviews: false,
    anonymous_grading: false,
    anonymize_students: false,
    moderated_grading: false,
    post_manually: !!a.postManually,
    grading_standard_id: null,
    is_quiz_assignment: !!a.quiz,
    is_quiz_lti_assignment: false,
    require_lockdown_browser: false,
    restrict_quantitative_data: false,
    locked_for_user: false,
  };
  if (a.quiz) json.quiz_id = a.quiz;
  if (includes.has('submission')) json.submission = submissionJson(a);
  if (includes.has('can_submit'))
    json.can_submit = expectsSubmission(a) && !a.quiz && a.sub.state !== 'graded';
  for (const field of excludes) delete json[field];
  return json;
}

// MARK: - Totals (lib/grade_calculator.rb, posted scores)

const round2 = (n) => Math.round(Number(`${Number(n.toPrecision(12))}e2`)) / 100;

const counts = (a) => a.gradingType !== 'not_graded';

/** Kane & Kane keeps the set with the best percentage. Brute force is fine at this size. */
function dropAssignments(rows, rules) {
  const dropLowest = rules.drop_lowest ?? 0;
  if (!dropLowest) return rows;
  const neverDrop = new Set(rules.never_drop ?? []);
  const pinned = rows.filter((r) => neverDrop.has(r.id));
  const droppable = rows.filter((r) => !neverDrop.has(r.id));
  if (droppable.length === 0) return pinned;
  const keepCount = droppable.length - Math.min(dropLowest, droppable.length - 1);
  let best = droppable;
  let bestRatio = -Infinity;
  const choose = (start, kept) => {
    if (kept.length === keepCount) {
      const all = [...kept, ...pinned];
      const possible = all.reduce((t, r) => t + r.total, 0);
      const ratio = possible ? all.reduce((t, r) => t + r.score, 0) / possible : 0;
      if (ratio > bestRatio) [best, bestRatio] = [kept, ratio];
      return;
    }
    for (let i = start; i < droppable.length; i++) choose(i + 1, [...kept, droppable[i]]);
  };
  choose(0, []);
  return [...best, ...pinned];
}

/** GradeCalculator#create_group_sums for one group, one period (or all), current or final. */
function groupSum(group, periodId, ignoreUngraded) {
  let rows = assignments
    .filter((a) => a.group === group.id && counts(a))
    .filter((a) => !periodId || periodFor(a)?.id === periodId)
    .map((a) => {
      // ignore_submission?: unposted grades are nil; pending review is nil for the current score.
      let s = hideGradeFromStudent(a) ? null : a.sub;
      if (ignoreUngraded && s?.state === 'pending_review') s = null;
      return { id: a.id, total: a.points, score: s?.score ?? null, excused: !!s?.excused };
    });
  if (ignoreUngraded) rows = rows.filter((r) => r.score !== null);
  rows = rows.filter((r) => !r.excused).map((r) => ({ ...r, score: r.score ?? 0 }));
  const kept = dropAssignments(rows, group.rules);
  return {
    score: kept.reduce((t, r) => t + r.score, 0),
    possible: kept.reduce((t, r) => t + r.total, 0),
    weight: group.weight,
  };
}

/** calculate_total_from_group_scores, weighted ("percent") scheme. */
function totalFromGroups(periodId, ignoreUngraded) {
  const relevant = groups.map((g) => groupSum(g, periodId, ignoreUngraded)).filter((g) => g.possible > 0);
  const fullWeight = relevant.reduce((t, g) => t + g.weight, 0);
  if (fullWeight === 0) return null;
  const grade = relevant.reduce((t, g) => t + (g.score / g.possible) * g.weight, 0);
  return round2(fullWeight < 100 ? (grade / fullWeight) * 100 : grade);
}

/** calculate_total_from_weighted_grading_periods over the rounded period scores. */
function totalFromPeriods(periodScores) {
  const sums = { current: { weight: 0, grade: 0 }, final: { weight: 0, grade: 0 } };
  for (const { period, current, final } of periodScores) {
    sums.final.weight += period.weight;
    if (current !== null) sums.current.weight += period.weight;
    sums.current.grade += (current ?? 0) * (period.weight / 100);
    sums.final.grade += (final ?? 0) * (period.weight / 100);
  }
  const scale = ({ weight, grade }) => (weight === 0 ? 0 : weight < 100 ? (grade * 100) / weight : grade);
  const anyCurrent = periodScores.some((p) => p.current !== null);
  return { current: anyCurrent ? round2(scale(sums.current)) : null, final: round2(scale(sums.final)) };
}

// Canvas's default grading standard (GradingStandard.default_grading_standard), as course JSON sends it.
// prettier-ignore
const scheme = [['A', 0.94], ['A-', 0.9], ['B+', 0.87], ['B', 0.84], ['B-', 0.8], ['C+', 0.77], ['C', 0.74], ['C-', 0.7], ['D+', 0.67], ['D', 0.64], ['D-', 0.61], ['F', 0]];
/** GradingStandard#score_to_grade. */
const letter = (score) => (score === null ? null : scheme.find(([, min]) => Math.max(score, 0) >= min * 100)[0]);

/** Posted current and final scores, per period and for all periods (weighted periods). */
export function canvasScores() {
  const byPeriod = periods.map((period) => ({
    period,
    current: totalFromGroups(period.id, true),
    final: totalFromGroups(period.id, false),
  }));
  return {
    periods: Object.fromEntries(byPeriod.map((p) => [p.period.id, { current: p.current, final: p.final }])),
    all: totalFromPeriods(byPeriod),
  };
}

const scores = canvasScores();
if (course && course.score !== scores.all.current)
  console.warn(
    `assignment-grading.mjs: data.mjs gives STAT 306 score ${course.score}; the fixtures total ${scores.all.current}.`,
  );

const currentPeriod = periods.find((p) => p.start <= NOW.toISOString() && NOW.toISOString() < p.end) ?? null;

// For the course list, which core.mjs builds from the shared record. core.mjs doesn't read
// these yet (see the Grades workstream's integration request); until it does, the list shows
// the all-periods current score from data.mjs and no current period.
if (course) {
  const period = currentPeriod ? scores.periods[currentPeriod.id] : null;
  Object.assign(course, {
    gradingPeriod: currentPeriod ? { id: currentPeriod.id, title: currentPeriod.title } : null,
    weightedPeriods: true,
    finalScore: scores.all.final,
    finalGrade: letter(scores.all.final),
    periodScores: period && {
      current: period.current,
      final: period.final,
      currentGrade: letter(period.current),
      finalGrade: letter(period.final),
    },
  });
}

// MARK: - Core routes, wrapped

/**
 * core.mjs builds the course JSON (term, teachers, syllabus, and so on). Import the
 * instance the server loaded (same `?v=mtime` URL) and fill in what it can't know:
 * weighted periods, the current period, the grading scheme, and real totals.
 */
async function coreCourseJson(ctx) {
  const file = new URL('./core.mjs', import.meta.url);
  const { mtimeMs } = await stat(file);
  const core = await import(`${file.href}?v=${mtimeMs}`);
  const route = core.routes.find((r) => r.path === '/api/v1/courses/:courseId' && (r.method ?? 'GET') === 'GET');
  // This route's path is literal, so it has no :courseId param of its own.
  return route.handler({ ...ctx, params: { ...ctx.params, courseId: COURSE } });
}

function withGrades(json, includes) {
  if (!json?.id || !Array.isArray(json.enrollments)) return json;
  json.apply_assignment_group_weights = true;
  const enrollment = json.enrollments[0];
  const periodScores = currentPeriod ? scores.periods[currentPeriod.id] : null;
  if (includes.has('total_scores') && includes.has('current_grading_period_scores')) {
    Object.assign(enrollment, {
      current_grading_period_id: currentPeriod?.id ?? null,
      current_grading_period_title: currentPeriod?.title ?? null,
      has_grading_periods: true,
      multiple_grading_periods_enabled: true,
    });
  }
  if (includes.has('total_scores') && !json.hide_final_grades) {
    Object.assign(enrollment, {
      computed_current_score: scores.all.current,
      computed_current_grade: letter(scores.all.current),
      computed_final_score: scores.all.final,
      computed_final_grade: letter(scores.all.final),
    });
    if (includes.has('current_grading_period_scores'))
      Object.assign(enrollment, {
        totals_for_all_grading_periods_option: true,
        current_period_computed_current_score: periodScores?.current ?? null,
        current_period_computed_final_score: periodScores?.final ?? null,
        current_period_computed_current_grade: letter(periodScores?.current ?? null),
        current_period_computed_final_grade: letter(periodScores?.final ?? null),
      });
  }
  if (includes.has('current_grading_period_scores')) {
    json.has_grading_periods = true;
    json.multiple_grading_periods_enabled = true;
    json.has_weighted_grading_periods = true;
  }
  if (includes.has('grading_scheme')) {
    json.grading_scheme = scheme;
    json.points_based_grading_scheme = false;
    json.scaling_factor = 1.0;
  }
  return json;
}

// MARK: - GraphQL

/** Answers routes/graphql.mjs for CustomGradeStatuses; 404 for every other operation. */
function resolveGraphql(body) {
  const request = body && typeof body === 'object' && !Buffer.isBuffer(body) ? body : {};
  const named = request.operationName === 'CustomGradeStatuses';
  const unnamed = !request.operationName && /customGradeStatusesConnection/.test(request.query ?? '');
  if (!named && !unnamed) return { status: 404, body: null };
  const id = String(request.variables?.courseId ?? '').replace(/^course_/, '');
  if (!courseById(id)) return { status: 200, body: { data: { course: null } } };
  // Custom statuses belong to the root account, so every course lists the same ones.
  return {
    status: 200,
    body: { data: { course: { customGradeStatusesConnection: { nodes: customStatuses } } } },
  };
}

// MARK: - Routes

export const routes = [
  {
    path: api,
    handler: async (ctx) => {
      const includes = new Set([...(ctx.query.include ?? []), 'total_scores']);
      return withGrades(await coreCourseJson(ctx), includes);
    },
  },
  {
    // The default tabs in course-content.mjs have no Assignments tab; this course is all assignments.
    path: `${api}/tabs`,
    handler: () =>
      [
        ['home', 'Home', ''],
        ['announcements', 'Announcements', '/announcements'],
        ['assignments', 'Assignments', '/assignments'],
        ['grades', 'Grades', '/grades'],
        ['people', 'People', '/users'],
        ['syllabus', 'Syllabus', '/assignments/syllabus'],
      ].map(([id, label, path], index) => ({
        id,
        html_url: `/courses/${COURSE}${path}`,
        full_url: `${BASE}/courses/${COURSE}${path}`,
        position: index + 1,
        visibility: 'public',
        label,
        type: 'internal',
      })),
  },
  {
    // AssignmentGroupsController#index
    path: `${api}/assignment_groups`,
    handler: ({ query, url }) => {
      const includes = new Set(query.include ?? []);
      const excludes = new Set(query.exclude_response_fields ?? []);
      const period = query.grading_period_id;
      if (period && !periods.some((p) => p.id === period)) return notFound;
      const list = groups.map((g, index) => {
        const json = {
          id: g.id,
          name: g.name,
          position: index + 1,
          group_weight: g.weight,
          sis_source_id: null,
          integration_data: {},
          rules: g.rules,
        };
        if (includes.has('assignments'))
          json.assignments = assignments
            .filter((a) => a.group === g.id)
            .filter((a) => !period || periodFor(a)?.id === period)
            .map((a) => assignmentJson(a, includes, excludes));
        return json;
      });
      return paginate(list, query, url);
    },
  },
  {
    // GradingPeriodsController#index (GradingPeriodSerializer)
    path: `${api}/grading_periods`,
    handler: () => ({
      grading_periods: periods.map((p) => ({
        id: p.id,
        grading_period_group_id: '3068',
        start_date: p.start,
        end_date: p.end,
        close_date: p.close,
        weight: p.weight,
        title: p.title,
        permissions: { read: true, create: false, update: false, delete: false },
        is_closed: isPast(p.close),
      })),
      meta: { primaryCollection: 'grading_periods' },
    }),
  },
  {
    path: `${api}/assignments`,
    handler: ({ query, url }) => {
      const includes = new Set(query.include ?? []);
      const excludes = new Set(query.exclude_response_fields ?? []);
      let list = assignments;
      if (query.order_by === 'due_at')
        list = [...list].sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
      return paginate(
        list.map((a) => assignmentJson(a, includes, excludes)),
        query,
        url,
      );
    },
  },
  {
    path: `${api}/assignments/:assignmentId`,
    handler: ({ params, query }) => {
      const a = assignmentById(params.assignmentId);
      return a ? assignmentJson(a, new Set(query.include ?? [])) : notFound;
    },
  },
  {
    // SubmissionsApiController#show
    path: `${api}/assignments/:assignmentId/submissions/:userId`,
    handler: ({ params, query }) => {
      const a = assignmentById(params.assignmentId);
      if (!a || (params.userId !== 'self' && params.userId !== user.id)) return notFound;
      return submissionJson(a, new Set(query.include ?? []));
    },
  },
  {
    // EnrollmentsApiController#index, the student's own enrollment (grades_hash in lib/api/v1/user.rb)
    path: `${api}/enrollments`,
    handler: ({ query }) => {
      const period = query.grading_period_id || null;
      if (period && !scores.periods[period]) return notFound;
      const { current, final } = period ? scores.periods[period] : scores.all;
      return [
        {
          id: `8${COURSE}`,
          course_id: COURSE,
          course_section_id: `7${COURSE}`,
          user_id: user.id,
          type: 'StudentEnrollment',
          role: 'StudentEnrollment',
          enrollment_state: 'active',
          html_url: `${BASE}/courses/${COURSE}/users/${user.id}`,
          grades: {
            html_url: `${BASE}/courses/${COURSE}/grades/${user.id}`,
            current_score: current,
            current_grade: letter(current),
            final_score: final,
            final_grade: letter(final),
          },
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
  {
    // Internal: routes/graphql.mjs forwards GraphQL operations here (see its `resolvers`).
    method: 'POST',
    path: '/fake/graphql/grades',
    handler: ({ body }) => resolveGraphql(body),
  },
];
