import { fetchCourseTabs, hasGradesTab } from './tabs';
import { courseColors } from '@/design/tokens/colors';
import { defaultGradingScheme, type GradingSchemeRow, scoreToLetter } from '@/features/grades/calculate';

import { CanvasError, type CanvasClient } from '../client';
import { useCanvasQuery } from '../query';
import { useCanvas } from '../session';
import type { CanvasCustomColors } from '../types';

// MARK: - Raw Canvas shapes (trimmed to what Grades reads)

/** Student enrollment inside course JSON (lib/api/v1/course_json.rb). */
type CanvasCourseEnrollment = {
  type: string;
  role?: string;
  enrollment_state?: string;
  computed_current_score?: number | null;
  computed_current_grade?: string | null;
  /** Set only when the student is under restricted quantitative data. */
  computed_current_letter_grade?: string | null;
  computed_final_score?: number | null;
  computed_final_grade?: string | null;
  // `include[]=current_grading_period_scores`
  current_grading_period_id?: string | null;
  current_grading_period_title?: string | null;
  has_grading_periods?: boolean;
  totals_for_all_grading_periods_option?: boolean;
  current_period_computed_current_score?: number | null;
  current_period_computed_current_grade?: string | null;
  current_period_computed_final_score?: number | null;
  current_period_computed_final_grade?: string | null;
};

/** `GET /api/v1/courses[/:id]` with grade includes (lib/api/v1/course.rb, course_json.rb). */
export type CanvasGradesCourse = {
  id: string;
  name: string;
  course_code: string;
  hide_final_grades?: boolean;
  restrict_quantitative_data?: boolean;
  apply_assignment_group_weights?: boolean;
  has_grading_periods?: boolean;
  has_weighted_grading_periods?: boolean;
  /** `include[]=grading_scheme`: `[name, lower bound 0–1]` pairs, highest first. */
  grading_scheme?: [string, number][] | null;
  points_based_grading_scheme?: boolean;
  enrollments?: CanvasCourseEnrollment[];
  term?: { id: string; name: string } | null;
};

/** Submission JSON (lib/api/v1/submission.rb). Score fields are absent when the grade isn't posted. */
export type CanvasSubmission = {
  id: string;
  assignment_id: string;
  score?: number | null;
  grade?: string | null;
  entered_score?: number | null;
  entered_grade?: string | null;
  excused?: boolean | null;
  late?: boolean;
  missing?: boolean;
  late_policy_status?: 'late' | 'missing' | 'extended' | 'none' | null;
  points_deducted?: number | null;
  seconds_late?: number;
  custom_grade_status_id?: string | null;
  workflow_state?: 'unsubmitted' | 'submitted' | 'graded' | 'pending_review';
  /** False after a resubmission over an existing grade. */
  grade_matches_current_submission?: boolean;
  submitted_at?: string | null;
  graded_at?: string | null;
  posted_at?: string | null;
  grading_period_id?: string | null;
  redo_request?: boolean;
};

export type CanvasGradingType =
  'points' | 'percent' | 'letter_grade' | 'gpa_scale' | 'pass_fail' | 'not_graded';

/** Assignment JSON (lib/api/v1/assignment.rb). */
export type CanvasGradesAssignment = {
  id: string;
  name: string;
  position?: number;
  points_possible?: number | null;
  grading_type?: CanvasGradingType;
  submission_types?: string[];
  due_at?: string | null;
  html_url?: string;
  assignment_group_id: string;
  published?: boolean;
  omit_from_final_grade?: boolean;
  hide_in_gradebook?: boolean;
  post_manually?: boolean;
  anonymize_students?: boolean;
  restrict_quantitative_data?: boolean;
  submission?: CanvasSubmission | null;
};

/** `GET /api/v1/courses/:id/assignment_groups` (lib/api/v1/assignment_group.rb). */
export type CanvasAssignmentGroup = {
  id: string;
  name: string;
  position?: number;
  group_weight?: number | null;
  rules?: { drop_lowest?: number; drop_highest?: number; never_drop?: string[] } | null;
  assignments?: CanvasGradesAssignment[];
};

/** `GET /api/v1/courses/:id/grading_periods` (app/controllers/grading_periods_controller.rb). */
export type CanvasGradingPeriod = {
  id: string;
  title: string;
  start_date?: string | null;
  end_date?: string | null;
  close_date?: string | null;
  weight?: number | null;
  is_closed?: boolean;
};

type CanvasGradingPeriodsResponse = { grading_periods: CanvasGradingPeriod[] };

/** `GET /api/v1/courses/:id/enrollments` (lib/api/v1/enrollment.rb). Grades are period-scoped with `grading_period_id`. */
type CanvasEnrollment = {
  id: string;
  type: string;
  user_id: string;
  enrollment_state?: string;
  grades?: {
    current_score?: number | null;
    current_grade?: string | null;
    final_score?: number | null;
    final_grade?: string | null;
  } | null;
};

// MARK: - Models

/** One active course's headline grade, for the all-courses overview. */
export type CourseGradeSummary = {
  id: string;
  name: string;
  code: string;
  color: string;
  /** The instructor hides course totals (`hide_final_grades`). */
  hidden: boolean;
  /** Letter grades only: never show points or percentages. */
  restricted: boolean;
  /** Percentage, 0 to 100. Null when hidden, restricted, or nothing is graded. */
  score: number | null;
  grade: string | null;
  /** Set when the grade is for the current grading period rather than the whole course. */
  periodTitle: string | null;
};

/** Course settings that change how grades are shown and calculated. */
export type GradesCourse = {
  id: string;
  name: string;
  code: string;
  hideFinalGrades: boolean;
  restrictQuantitativeData: boolean;
  weightGroups: boolean;
  weightedPeriods: boolean;
  scheme: GradingSchemeRow[];
  /** Canvas shows letter grades for this course (it sent one, or the course is restricted). */
  usesLetterGrades: boolean;
  currentGradingPeriodId: string | null;
  /** False when the course turns off the total across all grading periods. */
  totalsForAllPeriods: boolean;
  /** Course totals from the course JSON, used when the enrollments call isn't available. */
  totals: EnrollmentGrades;
};

export type GradingPeriod = {
  id: string;
  title: string;
  startDate: Date | null;
  endDate: Date | null;
  weight: number | null;
  closed: boolean;
};

export type EnrollmentGrades = {
  currentScore: number | null;
  currentGrade: string | null;
  finalScore: number | null;
  finalGrade: string | null;
};

export type GradeSubmission = {
  /** The submission's ID, for saving a what-if score (GRADE-5). */
  id: string | null;
  /** After any late deduction. Null when ungraded or not posted. */
  score: number | null;
  grade: string | null;
  /** The score before the late deduction (`entered_score`). */
  enteredScore: number | null;
  excused: boolean;
  late: boolean;
  missing: boolean;
  extended: boolean;
  pointsDeducted: number | null;
  customStatusId: string | null;
  /** Submitted and waiting on a grader (`pending_review`). Any score is partial. */
  pendingReview: boolean;
  submitted: boolean;
  /**
   * The instructor hasn't posted the grade, so Canvas withholds it. The calculator treats
   * it as ungraded, even when `excused` says otherwise.
   */
  hidden: boolean;
  gradingPeriodId: string | null;
};

export type GradeAssignmentKind = 'assignment' | 'quiz' | 'discussion';

export type GradeAssignment = {
  id: string;
  groupId: string;
  name: string;
  kind: GradeAssignmentKind;
  dueAt: Date | null;
  pointsPossible: number;
  gradingType: CanvasGradingType;
  /** Counts toward the course total. */
  counts: boolean;
  restricted: boolean;
  htmlUrl: string | null;
  submission: GradeSubmission | null;
};

export type GradeGroup = {
  id: string;
  name: string;
  weight: number;
  dropLowest: number;
  dropHighest: number;
  neverDrop: string[];
  assignments: GradeAssignment[];
};

// MARK: - Mapping

/** Canvas sends either a letter or a number in `*_grade`; only letters are letter grades. */
const isLetter = (grade: string | null | undefined): grade is string => !!grade && /[a-z]/i.test(grade);

function fallbackColor(index: number) {
  return courseColors[index % (courseColors.length - 1)].light;
}

function studentEnrollment(course: { enrollments?: CanvasCourseEnrollment[] }) {
  return course.enrollments?.find((e) => e.type === 'student' || e.type === 'StudentEnrollment');
}

function toScheme(raw: CanvasGradesCourse['grading_scheme']): GradingSchemeRow[] {
  if (!raw || raw.length === 0) return defaultGradingScheme;
  return raw.map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export function toCourseGradeSummary(course: CanvasGradesCourse, color: string): CourseGradeSummary {
  const enrollment = studentEnrollment(course);
  const hidden = course.hide_final_grades ?? false;
  const restricted = course.restrict_quantitative_data ?? false;
  // With grading periods, Canvas students see the current period's grade first.
  const usePeriod =
    !!enrollment?.current_grading_period_id && enrollment.current_period_computed_current_score != null;
  const score = usePeriod
    ? (enrollment?.current_period_computed_current_score ?? null)
    : (enrollment?.computed_current_score ?? null);
  const rawGrade = usePeriod
    ? enrollment?.current_period_computed_current_grade
    : (enrollment?.computed_current_letter_grade ?? enrollment?.computed_current_grade);
  const letter = isLetter(rawGrade) ? rawGrade : null;

  return {
    id: String(course.id),
    name: course.name,
    code: course.course_code,
    color,
    hidden,
    restricted,
    score: hidden || restricted ? null : score,
    // Restricted courses still get a letter: Canvas converts with the default scheme when needed.
    grade: hidden ? null : restricted ? (letter ?? scoreToLetter(score, defaultGradingScheme)) : letter,
    periodTitle: usePeriod ? (enrollment?.current_grading_period_title ?? null) : null,
  };
}

export function toGradesCourse(course: CanvasGradesCourse): GradesCourse {
  const enrollment = studentEnrollment(course);
  const restricted = course.restrict_quantitative_data ?? false;
  const currentGrade =
    enrollment?.computed_current_letter_grade ?? enrollment?.computed_current_grade ?? null;
  return {
    id: String(course.id),
    name: course.name,
    code: course.course_code,
    hideFinalGrades: course.hide_final_grades ?? false,
    restrictQuantitativeData: restricted,
    weightGroups: course.apply_assignment_group_weights ?? false,
    weightedPeriods: course.has_weighted_grading_periods ?? false,
    scheme: toScheme(course.grading_scheme),
    usesLetterGrades: restricted || isLetter(currentGrade),
    currentGradingPeriodId: enrollment?.current_grading_period_id ?? null,
    totalsForAllPeriods: enrollment?.totals_for_all_grading_periods_option ?? true,
    totals: {
      currentScore: enrollment?.computed_current_score ?? null,
      currentGrade: isLetter(currentGrade) ? currentGrade : null,
      finalScore: enrollment?.computed_final_score ?? null,
      finalGrade: isLetter(enrollment?.computed_final_grade) ? enrollment!.computed_final_grade! : null,
    },
  };
}

export function toGradingPeriod(period: CanvasGradingPeriod): GradingPeriod {
  return {
    id: String(period.id),
    title: period.title,
    startDate: period.start_date ? new Date(period.start_date) : null,
    endDate: period.end_date ? new Date(period.end_date) : null,
    weight: period.weight ?? null,
    closed: period.is_closed ?? false,
  };
}

function kindOf(assignment: CanvasGradesAssignment): GradeAssignmentKind {
  const types = assignment.submission_types ?? [];
  if (types.includes('online_quiz')) return 'quiz';
  if (types.includes('discussion_topic')) return 'discussion';
  return 'assignment';
}

function toSubmission(assignment: CanvasGradesAssignment): GradeSubmission | null {
  const s = assignment.submission;
  if (!s) return null;
  // Submission#hide_grade_from_student?: manual posting hides every grade until it's posted.
  // Automatic posting hides a grade (an excusal counts) or a resubmission over one that
  // isn't posted. Canvas strips the score itself; this flag says why it's missing.
  const graded = s.excused === true || s.workflow_state === 'graded';
  const resubmitted =
    (s.workflow_state === 'submitted' || s.workflow_state === 'pending_review') &&
    s.grade_matches_current_submission === false;
  const hidden = !s.posted_at && (assignment.post_manually === true || graded || resubmitted);
  const score = hidden ? null : (s.score ?? null);
  // `late` and `missing` already account for excused work and custom statuses
  // (Submission#late?, #missing?); the policy status is only a fallback.
  return {
    id: s.id ? String(s.id) : null,
    score,
    grade: hidden ? null : (s.grade ?? null),
    enteredScore: hidden ? null : (s.entered_score ?? score),
    excused: s.excused === true,
    late: s.late ?? s.late_policy_status === 'late',
    missing: s.missing ?? s.late_policy_status === 'missing',
    extended: s.late_policy_status === 'extended' && !s.excused && !s.custom_grade_status_id,
    pointsDeducted: hidden ? null : (s.points_deducted ?? null),
    customStatusId: s.custom_grade_status_id ? String(s.custom_grade_status_id) : null,
    pendingReview: s.workflow_state === 'pending_review',
    submitted: !!s.submitted_at || s.workflow_state === 'submitted' || s.workflow_state === 'pending_review',
    hidden,
    gradingPeriodId: s.grading_period_id ? String(s.grading_period_id) : null,
  };
}

export function toGradeAssignment(assignment: CanvasGradesAssignment): GradeAssignment {
  const gradingType = assignment.grading_type ?? 'points';
  const notGraded =
    gradingType === 'not_graded' ||
    (assignment.submission_types?.length === 1 && assignment.submission_types[0] === 'not_graded');
  return {
    id: String(assignment.id),
    groupId: String(assignment.assignment_group_id),
    name: assignment.name,
    kind: kindOf(assignment),
    dueAt: assignment.due_at ? new Date(assignment.due_at) : null,
    pointsPossible: assignment.points_possible ?? 0,
    gradingType: notGraded ? 'not_graded' : gradingType,
    counts: !assignment.omit_from_final_grade && !notGraded && assignment.published !== false,
    restricted: assignment.restrict_quantitative_data ?? false,
    htmlUrl: assignment.html_url ?? null,
    submission: toSubmission(assignment),
  };
}

export function toGradeGroup(group: CanvasAssignmentGroup): GradeGroup {
  return {
    id: String(group.id),
    name: group.name,
    weight: group.group_weight ?? 0,
    dropLowest: group.rules?.drop_lowest ?? 0,
    dropHighest: group.rules?.drop_highest ?? 0,
    neverDrop: (group.rules?.never_drop ?? []).map(String),
    assignments: (group.assignments ?? [])
      // Students never see these in Canvas's grade summary.
      .filter((a) => a.published !== false && !a.hide_in_gradebook && a.grading_type !== 'not_graded')
      .map(toGradeAssignment)
      .sort(
        (a, b) =>
          (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
      ),
  };
}

// MARK: - Fetchers

/** Includes that make Canvas send totals, period scores, and grade display rules. */
const gradeIncludes = ['total_scores', 'current_grading_period_scores', 'restrict_quantitative_data'];

export async function fetchGradesOverview(
  client: CanvasClient,
  signal?: AbortSignal,
): Promise<CourseGradeSummary[]> {
  const [courses, colors] = await Promise.all([
    client.getAll<CanvasGradesCourse>(
      '/api/v1/courses',
      { enrollment_state: 'active', include: gradeIncludes },
      { signal },
    ),
    client
      .get<CanvasCustomColors>('/api/v1/users/self/colors', undefined, signal)
      .catch((): CanvasCustomColors => ({ custom_colors: {} })),
  ]);
  const enrolled = courses.filter((course) => studentEnrollment(course));
  const visibility = await Promise.all(
    enrolled.map(async (course) => {
      try {
        return hasGradesTab(await fetchCourseTabs(client, String(course.id), signal));
      } catch (error) {
        // Restricted or removed courses must not break the other course grades.
        if (error instanceof CanvasError && (error.status === 403 || error.status === 404)) return false;
        throw error;
      }
    }),
  );
  return enrolled
    .filter((_course, index) => visibility[index])
    .map((course, index) =>
      toCourseGradeSummary(course, colors.custom_colors[`course_${course.id}`] ?? fallbackColor(index)),
    );
}

export async function fetchGradesCourse(client: CanvasClient, courseId: string, signal?: AbortSignal) {
  const course = await client.get<CanvasGradesCourse>(
    `/api/v1/courses/${courseId}`,
    { include: [...gradeIncludes, 'grading_scheme'] },
    signal,
  );
  return toGradesCourse(course);
}

export async function fetchGradingPeriods(client: CanvasClient, courseId: string, signal?: AbortSignal) {
  const response = await client.get<CanvasGradingPeriodsResponse>(
    `/api/v1/courses/${courseId}/grading_periods`,
    { per_page: 100 },
    signal,
  );
  return (response?.grading_periods ?? []).map(toGradingPeriod);
}

export async function fetchAssignmentGroups(
  client: CanvasClient,
  courseId: string,
  gradingPeriodId: string | null,
  signal?: AbortSignal,
): Promise<GradeGroup[]> {
  const groups = await client.getAll<CanvasAssignmentGroup>(
    `/api/v1/courses/${courseId}/assignment_groups`,
    {
      include: ['assignments', 'submission'],
      exclude_response_fields: ['description', 'rubric'],
      grading_period_id: gradingPeriodId ?? undefined,
      scope_assignments_to_student: true,
    },
    { signal },
  );
  return groups.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(toGradeGroup);
}

export async function fetchEnrollmentGrades(
  client: CanvasClient,
  courseId: string,
  userId: string,
  gradingPeriodId: string | null,
  signal?: AbortSignal,
): Promise<EnrollmentGrades | null> {
  const enrollments = await client.getAll<CanvasEnrollment>(
    `/api/v1/courses/${courseId}/enrollments`,
    {
      user_id: userId,
      type: ['StudentEnrollment'],
      state: ['active', 'completed'],
      grading_period_id: gradingPeriodId ?? undefined,
    },
    { signal },
  );
  const enrollment =
    enrollments.find((e) => e.enrollment_state === 'active') ?? enrollments.find((e) => e.grades);
  if (!enrollment?.grades) return null;
  const g = enrollment.grades;
  return {
    currentScore: g.current_score ?? null,
    currentGrade: isLetter(g.current_grade) ? g.current_grade : null,
    finalScore: g.final_score ?? null,
    finalGrade: isLetter(g.final_grade) ? g.final_grade : null,
  };
}

const customStatusQuery = `query CustomGradeStatuses($courseId: ID!) {
  course(id: $courseId) { customGradeStatusesConnection { nodes { _id name } } }
}`;

type CustomStatusResponse = {
  data?: { course?: { customGradeStatusesConnection?: { nodes?: { _id: string; name: string }[] } } };
};

/** Custom status names (only GraphQL has them). Empty when the school doesn't use them or the call fails. */
export async function fetchCustomGradeStatuses(
  client: CanvasClient,
  courseId: string,
): Promise<Record<string, string>> {
  try {
    const response = await client.post<CustomStatusResponse>('/api/graphql', {
      operationName: 'CustomGradeStatuses',
      query: customStatusQuery,
      variables: { courseId },
    });
    const nodes = response?.data?.course?.customGradeStatusesConnection?.nodes ?? [];
    return Object.fromEntries(nodes.map((n) => [String(n._id), n.name]));
  } catch {
    return {};
  }
}

// MARK: - Hooks

/** Every active course with its current grade. */
export function useGradesOverview() {
  return useCanvasQuery(['grades', 'overview'], fetchGradesOverview);
}

export function useGradesCourse(courseId: string) {
  return useCanvasQuery(['grades', courseId, 'course'], (client, signal) =>
    fetchGradesCourse(client, courseId, signal),
  );
}

export function useGradingPeriods(courseId: string) {
  return useCanvasQuery(['grades', courseId, 'periods'], (client, signal) =>
    fetchGradingPeriods(client, courseId, signal),
  );
}

/** `gradingPeriodId` null means all grading periods. Disabled until a period is chosen. */
export function useAssignmentGroups(courseId: string, gradingPeriodId: string | null | undefined) {
  return useCanvasQuery(
    ['grades', courseId, 'groups', gradingPeriodId ?? 'all'],
    (client, signal) => fetchAssignmentGroups(client, courseId, gradingPeriodId ?? null, signal),
    { enabled: gradingPeriodId !== undefined },
  );
}

export function useEnrollmentGrades(courseId: string, gradingPeriodId: string | null | undefined) {
  const { account } = useCanvas();
  return useCanvasQuery(
    ['grades', courseId, 'enrollment', gradingPeriodId ?? 'all'],
    (client, signal) =>
      fetchEnrollmentGrades(client, courseId, account.user.id, gradingPeriodId ?? null, signal),
    { enabled: gradingPeriodId !== undefined },
  );
}

export function useCustomGradeStatuses(courseId: string, enabled: boolean) {
  return useCanvasQuery(
    ['grades', courseId, 'custom-statuses'],
    (client) => fetchCustomGradeStatuses(client, courseId),
    { enabled, staleTime: 60 * 60_000 },
  );
}

/** The period Canvas marks current, else the one whose dates include today. */
export function currentPeriodId(periods: GradingPeriod[], fromCourse: string | null, now = new Date()) {
  if (fromCourse && periods.some((p) => p.id === fromCourse)) return fromCourse;
  return periods.find((p) => p.startDate && p.endDate && p.startDate <= now && now <= p.endDate)?.id ?? null;
}

// MARK: - What-if scores saved to Canvas (GRADE-5)

/** `GET /api/v1/courses/:id/students/submissions` with `include[]=student_entered_score` (lib/api/v1/submission.rb). */
type CanvasWhatIfSubmission = {
  id: string;
  assignment_id: string;
  student_entered_score?: number | string | null;
};

/** What-if scores the student saved in Canvas, by assignment ID. */
export async function fetchSavedWhatIf(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const submissions = await client.getAll<CanvasWhatIfSubmission>(
    `/api/v1/courses/${courseId}/students/submissions`,
    // No student_ids: Canvas answers for the current user.
    { include: ['student_entered_score'] },
    { signal },
  );
  const saved: Record<string, number> = {};
  for (const s of submissions) {
    const score =
      s.student_entered_score === null || s.student_entered_score === undefined
        ? Number.NaN
        : Number(s.student_entered_score);
    if (Number.isFinite(score)) saved[String(s.assignment_id)] = score;
  }
  return saved;
}

export const savedWhatIfKey = (courseId: string) => ['grades', courseId, 'what-if'] as const;

/** Saved what-if scores, fetched only when the student chose to save them. */
export function useSavedWhatIf(courseId: string, enabled: boolean) {
  return useCanvasQuery(
    savedWhatIfKey(courseId),
    (client, signal) => fetchSavedWhatIf(client, courseId, signal),
    {
      enabled,
    },
  );
}

/** `PUT /api/v1/submissions/:id/what_if_grades` (WhatIfGradesApiController#update). Null clears it. */
export const whatIfScoreRequest = (submissionId: string, score: number | null) => ({
  method: 'PUT' as const,
  path: `/api/v1/submissions/${submissionId}/what_if_grades`,
  body: { student_entered_score: score },
});

/** `PUT /api/v1/courses/:id/what_if_grades/reset` (WhatIfGradesApiController#reset_for_student_course). */
export const resetWhatIfRequest = (courseId: string) => ({
  method: 'PUT' as const,
  path: `/api/v1/courses/${courseId}/what_if_grades/reset`,
});
