import { useListPlaceholder } from './cacheSeed';
import { htmlToText } from '../html';
import type { CanvasClient } from '../client';
import { useCanvasQuery } from '../query';
import type { CanvasAttachment } from '../types';

// Raw shapes (lib/api/v1/assignment.rb, assignment_group.rb, submission.rb,
// submission_comment.rb, rubric_assessment.rb; app/serializers/grading_period_serializer.rb).

/** `media_comment_json` in lib/api.rb. `media_type` is "audio" or "video". */
export type CanvasMediaComment = {
  url: string;
  media_id?: string;
  media_type?: string;
  display_name?: string | null;
  'content-type'?: string;
};

export type CanvasSubmissionComment = {
  id: string;
  author_id: string | null;
  author_name: string;
  created_at: string;
  edited_at?: string | null;
  /** Plain text. */
  comment: string;
  attempt?: number | null;
  author?: { id?: string; display_name?: string; avatar_image_url?: string | null } | null;
  attachments?: CanvasAttachment[];
  media_comment?: CanvasMediaComment | null;
};

export type CanvasSubmission = {
  id: string;
  assignment_id: string;
  user_id: string;
  attempt: number | null;
  body: string | null;
  url: string | null;
  submission_type: string | null;
  submitted_at: string | null;
  score: number | null;
  grade: string | null;
  graded_at: string | null;
  posted_at?: string | null;
  workflow_state: 'submitted' | 'unsubmitted' | 'graded' | 'pending_review';
  late?: boolean;
  missing?: boolean;
  excused?: boolean | null;
  points_deducted?: number | null;
  redo_request?: boolean;
  extra_attempts?: number | null;
  grade_matches_current_submission?: boolean;
  attachments?: CanvasAttachment[];
  media_comment?: CanvasMediaComment | null;
  preview_url?: string | null;
  external_tool_url?: string | null;
  discussion_entries?: { message: string; created_at?: string }[];
  submission_history?: CanvasSubmission[];
  submission_comments?: CanvasSubmissionComment[];
  rubric_assessment?: Record<
    string,
    { rating_id?: string | null; comments?: string | null; points?: number | null }
  > | null;
};

export type CanvasRubricCriterion = {
  id: string;
  description: string;
  long_description?: string | null;
  points: number;
  ignore_for_scoring?: boolean;
  criterion_use_range?: boolean;
  ratings: { id: string; description: string; long_description?: string | null; points: number }[];
};

export type CanvasAssignment = {
  id: string;
  name: string;
  description: string | null;
  course_id: string;
  assignment_group_id: string;
  position?: number;
  points_possible: number | null;
  grading_type: 'points' | 'percent' | 'letter_grade' | 'gpa_scale' | 'pass_fail' | 'not_graded';
  due_at: string | null;
  unlock_at: string | null;
  lock_at: string | null;
  submission_types: string[];
  allowed_extensions?: string[];
  /** -1 means unlimited. */
  allowed_attempts?: number | null;
  html_url: string;
  locked_for_user?: boolean;
  lock_explanation?: string | null;
  quiz_id?: string;
  discussion_topic?: { id: string; html_url?: string } | null;
  external_tool_tag_attributes?: { url?: string; new_tab?: boolean } | null;
  omit_from_final_grade?: boolean;
  rubric?: CanvasRubricCriterion[];
  rubric_settings?: {
    title?: string;
    points_possible?: number;
    hide_points?: boolean;
    hide_score_total?: boolean;
    free_form_criterion_comments?: boolean;
  };
  submission?: CanvasSubmission;
  /** Present with `include[]=can_submit`: Canvas's own submit check (locks, attempts, enrollment). */
  can_submit?: boolean;
  require_lockdown_browser?: boolean;
  /** Letters only for this student (GRADE-4). Canvas still sends scores and points. */
  restrict_quantitative_data?: boolean;
  /** The document a `student_annotation` assignment annotates. */
  annotatable_attachment_id?: string | null;
  has_submitted_submissions?: boolean;
  /** Peer reviews are on (ASSIGN-12). */
  peer_reviews?: boolean;
  anonymous_peer_reviews?: boolean;
  peer_reviews_due_at?: string | null;
  /** Set for group assignments (ASSIGN-13): the group set whose groups submit together. */
  group_category_id?: string | null;
  grade_group_students_individually?: boolean;
};

export type CanvasAssignmentGroup = {
  id: string;
  name: string;
  position: number;
  group_weight?: number | null;
  assignments?: CanvasAssignment[];
};

export type CanvasGradingPeriod = {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  close_date?: string | null;
  is_closed?: boolean;
};

// Models

/** What kind of thing the student turns in, which decides where the assignment opens. */
export type AssignmentKind = 'assignment' | 'quiz' | 'discussion' | 'external_tool' | 'offline';

/**
 * Where the work stands for the student:
 * - `open`: still needs a submission
 * - `missing`: past due with nothing turned in
 * - `submitted`: turned in, waiting for a grade
 * - `graded`: graded (or excused)
 * - `none`: nothing to turn in online and not graded yet
 */
export type AssignmentStatus = 'open' | 'missing' | 'submitted' | 'graded' | 'none';

/** Canvas attachment JSON, kept raw for `AttachmentList` (src/features/files). */
export type Attachment = CanvasAttachment;

export type SubmissionSummary = {
  /** The submission record's ID, which DocViewer sessions and peer reviews refer to. */
  id: string | null;
  /** Attempts used so far. Zero when nothing has been turned in. */
  attempt: number;
  submittedAt: Date | null;
  submissionType: string | null;
  score: number | null;
  grade: string | null;
  gradedAt: Date | null;
  late: boolean;
  missing: boolean;
  excused: boolean;
  /** The grade is for an earlier attempt; the latest one is waiting. */
  gradeIsStale: boolean;
  redoRequested: boolean;
  extraAttempts: number;
  state: CanvasSubmission['workflow_state'];
};

export type RubricCriterion = {
  id: string;
  description: string;
  longDescription: string | null;
  points: number;
  ignoreForScoring: boolean;
  ratings: { id: string; description: string; longDescription: string | null; points: number }[];
};

export type Assignment = {
  id: string;
  courseId: string;
  groupId: string;
  name: string;
  /** Description HTML. Empty when the list request excluded it. */
  html: string;
  htmlUrl: string;
  points: number | null;
  gradingType: CanvasAssignment['grading_type'];
  dueAt: Date | null;
  unlockAt: Date | null;
  lockAt: Date | null;
  submissionTypes: string[];
  allowedExtensions: string[];
  /** Null when unlimited. */
  allowedAttempts: number | null;
  locked: boolean;
  /** Plain-text reason the assignment is locked. */
  lockExplanation: string | null;
  kind: AssignmentKind;
  quizId: string | null;
  discussionTopicId: string | null;
  externalToolUrl: string | null;
  rubric: RubricCriterion[] | null;
  rubricHidesPoints: boolean;
  rubricHidesTotal: boolean;
  requiresLockdownBrowser: boolean;
  /** Restricted quantitative data: show letter grades only, never points or percentages. */
  restricted: boolean;
  /** Canvas's `can_submit`, or null when the request didn't ask for it (lists). */
  canSubmit: boolean | null;
  annotatableAttachmentId: string | null;
  /** Null when peer reviews are off. */
  peerReviews: { anonymous: boolean; dueAt: Date | null } | null;
  /** Null unless it's a group assignment. */
  groupCategoryId: string | null;
  submission: SubmissionSummary | null;
  status: AssignmentStatus;
};

export type AssignmentGroup = { id: string; name: string; position: number; weight: number | null };

export type GradingPeriod = {
  id: string;
  title: string;
  startAt: Date | null;
  endAt: Date | null;
  closed: boolean;
};

/** An audio or video recording Canvas stores as a media object (submission or comment). */
export type MediaComment = {
  url: string;
  kind: 'audio' | 'video';
  title: string | null;
};

export type SubmissionAttempt = {
  attempt: number;
  submittedAt: Date | null;
  type: string | null;
  body: string | null;
  url: string | null;
  /** Files, each with `preview_url` (DocViewer, where instructors annotate) when the school has it. */
  attachments: Attachment[];
  media: MediaComment | null;
  externalToolUrl: string | null;
  discussionEntries: string[];
  score: number | null;
  grade: string | null;
  late: boolean;
};

export type SubmissionComment = {
  id: string;
  authorId: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  createdAt: Date;
  text: string;
  attempt: number | null;
  attachments: Attachment[];
  media: MediaComment | null;
};

export type RubricAssessment = Record<
  string,
  { ratingId: string | null; points: number | null; comments: string | null }
>;

export type SubmissionDetail = SubmissionSummary & {
  /** Newest first. Only attempts the student actually turned in. */
  attempts: SubmissionAttempt[];
  comments: SubmissionComment[];
  rubricAssessment: RubricAssessment | null;
};

// Mapping

const toDate = (value?: string | null) => (value ? new Date(value) : null);

/** Keys for one assignment. Its submission lives under the same prefix, so invalidating it refreshes both. */
export const assignmentKeys = {
  detail: (courseId: string, assignmentId: string) => ['courses', courseId, 'assignments', assignmentId] as const,
  submission: (courseId: string, assignmentId: string) =>
    ['courses', courseId, 'assignments', assignmentId, 'submission'] as const,
  groups: (courseId: string) => ['courses', courseId, 'assignment_groups'] as const,
};

const OFFLINE_TYPES = ['on_paper', 'none', 'not_graded', 'wiki_page'];

function kindOf(a: CanvasAssignment): AssignmentKind {
  const types = a.submission_types;
  if (a.quiz_id || types.includes('online_quiz')) return 'quiz';
  if (a.discussion_topic || types.includes('discussion_topic')) return 'discussion';
  if (types.includes('external_tool') || types.includes('basic_lti_launch')) return 'external_tool';
  if (types.length === 0 || types.every((t) => OFFLINE_TYPES.includes(t))) return 'offline';
  return 'assignment';
}

function toSubmissionSummary(s: CanvasSubmission): SubmissionSummary {
  const graded = s.workflow_state === 'graded' && (s.score !== null || s.grade !== null);
  return {
    id: s.id ? String(s.id) : null,
    attempt: s.attempt ?? 0,
    submittedAt: toDate(s.submitted_at),
    submissionType: s.submission_type,
    score: s.score,
    grade: s.grade,
    gradedAt: toDate(s.graded_at),
    late: s.late ?? false,
    missing: s.missing ?? false,
    excused: s.excused ?? false,
    gradeIsStale: graded && s.grade_matches_current_submission === false,
    redoRequested: s.redo_request ?? false,
    extraAttempts: s.extra_attempts ?? 0,
    state: s.workflow_state,
  };
}

function statusOf(kind: AssignmentKind, s: SubmissionSummary | null): AssignmentStatus {
  if (s?.excused) return 'graded';
  const graded = s && s.state === 'graded' && (s.score !== null || s.grade !== null) && !s.redoRequested;
  if (graded && !s.gradeIsStale) return 'graded';
  if (s && (s.state === 'submitted' || s.state === 'pending_review' || s.gradeIsStale)) return 'submitted';
  if (kind === 'offline') return 'none';
  if (s?.missing) return 'missing';
  return 'open';
}

export function toAssignment(a: CanvasAssignment): Assignment {
  const kind = kindOf(a);
  const submission = a.submission ? toSubmissionSummary(a.submission) : null;
  return {
    id: String(a.id),
    courseId: String(a.course_id),
    groupId: String(a.assignment_group_id),
    name: a.name,
    html: a.description ?? '',
    htmlUrl: a.html_url,
    points: a.points_possible,
    gradingType: a.grading_type,
    dueAt: toDate(a.due_at),
    unlockAt: toDate(a.unlock_at),
    lockAt: toDate(a.lock_at),
    submissionTypes: a.submission_types,
    allowedExtensions: a.allowed_extensions ?? [],
    allowedAttempts: a.allowed_attempts == null || a.allowed_attempts < 0 ? null : a.allowed_attempts,
    locked: a.locked_for_user ?? false,
    lockExplanation: a.lock_explanation ? htmlToText(a.lock_explanation) : null,
    kind,
    quizId: a.quiz_id ? String(a.quiz_id) : null,
    discussionTopicId: a.discussion_topic ? String(a.discussion_topic.id) : null,
    externalToolUrl: a.external_tool_tag_attributes?.url ?? null,
    rubric: a.rubric
      ? a.rubric.map((c) => ({
          id: c.id,
          description: c.description,
          longDescription: c.long_description || null,
          points: c.points,
          ignoreForScoring: c.ignore_for_scoring ?? false,
          ratings: c.ratings.map((r) => ({
            id: r.id,
            description: r.description,
            longDescription: r.long_description || null,
            points: r.points,
          })),
        }))
      : null,
    rubricHidesPoints: a.rubric_settings?.hide_points ?? false,
    rubricHidesTotal: a.rubric_settings?.hide_score_total ?? false,
    requiresLockdownBrowser: a.require_lockdown_browser ?? false,
    restricted: a.restrict_quantitative_data ?? false,
    canSubmit: a.can_submit ?? null,
    annotatableAttachmentId: a.annotatable_attachment_id ? String(a.annotatable_attachment_id) : null,
    peerReviews: a.peer_reviews
      ? { anonymous: a.anonymous_peer_reviews ?? false, dueAt: toDate(a.peer_reviews_due_at) }
      : null,
    groupCategoryId: a.group_category_id ? String(a.group_category_id) : null,
    submission,
    status: statusOf(kind, submission),
  };
}

function toMedia(m: CanvasMediaComment | null | undefined): MediaComment | null {
  if (!m?.url) return null;
  const type = m.media_type ?? m['content-type'] ?? '';
  return { url: m.url, kind: type.startsWith('audio') ? 'audio' : 'video', title: m.display_name || null };
}

function toAttempt(s: CanvasSubmission): SubmissionAttempt {
  return {
    attempt: s.attempt ?? 0,
    submittedAt: toDate(s.submitted_at),
    type: s.submission_type,
    body: s.body,
    url: s.url,
    attachments: s.attachments ?? [],
    media: toMedia(s.media_comment),
    externalToolUrl: s.external_tool_url ?? null,
    discussionEntries: (s.discussion_entries ?? []).map((e) => e.message),
    score: s.workflow_state === 'graded' ? s.score : null,
    grade: s.workflow_state === 'graded' ? s.grade : null,
    late: s.late ?? false,
  };
}

function toComment(c: CanvasSubmissionComment): SubmissionComment {
  return {
    id: String(c.id),
    authorId: c.author_id ? String(c.author_id) : (c.author?.id ?? null),
    authorName: c.author?.display_name || c.author_name,
    authorAvatarUrl: c.author?.avatar_image_url ?? null,
    createdAt: new Date(c.created_at),
    text: c.comment,
    attempt: c.attempt ?? null,
    attachments: c.attachments ?? [],
    media: toMedia(c.media_comment),
  };
}

export function toSubmissionDetail(s: CanvasSubmission): SubmissionDetail {
  const history = s.submission_history?.length ? s.submission_history : [s];
  const attempts = history
    .filter((h) => h.submitted_at || (h.attempt ?? 0) > 0)
    .map(toAttempt)
    .sort((a, b) => b.attempt - a.attempt);
  return {
    ...toSubmissionSummary(s),
    attempts,
    comments: (s.submission_comments ?? [])
      .map(toComment)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    rubricAssessment: s.rubric_assessment
      ? Object.fromEntries(
          Object.entries(s.rubric_assessment).map(([id, r]) => [
            id,
            { ratingId: r.rating_id ?? null, points: r.points ?? null, comments: r.comments || null },
          ]),
        )
      : null,
  };
}

// Fetchers and hooks

export type AssignmentList = { groups: AssignmentGroup[]; assignments: Assignment[] };

/** Assignment groups with their assignments and the student's submissions (ASSIGN-1). */
export async function fetchAssignmentGroups(
  client: CanvasClient,
  courseId: string,
  gradingPeriodId: string | null,
  signal?: AbortSignal,
): Promise<AssignmentList> {
  const groups = await client.getAll<CanvasAssignmentGroup>(
    `/api/v1/courses/${courseId}/assignment_groups`,
    {
      include: ['assignments', 'submission'],
      exclude_response_fields: ['description', 'rubric'],
      override_assignment_dates: true,
      scope_assignments_to_student: true,
      grading_period_id: gradingPeriodId ?? undefined,
    },
    { signal },
  );
  const sorted = groups.sort((a, b) => a.position - b.position);
  return {
    groups: sorted.map((g) => ({
      id: String(g.id),
      name: g.name,
      position: g.position,
      weight: g.group_weight ?? null,
    })),
    assignments: sorted.flatMap((g) => (g.assignments ?? []).map(toAssignment)),
  };
}

export function useAssignmentGroups(courseId: string, gradingPeriodId: string | null, enabled = true) {
  return useCanvasQuery(
    ['courses', courseId, 'assignment_groups', gradingPeriodId ?? 'all'],
    (client, signal) => fetchAssignmentGroups(client, courseId, gradingPeriodId, signal),
    { enabled },
  );
}

export async function fetchGradingPeriods(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<GradingPeriod[]> {
  const data = await client.get<{ grading_periods?: CanvasGradingPeriod[] }>(
    `/api/v1/courses/${courseId}/grading_periods`,
    { per_page: 100 },
    signal,
  );
  return (data.grading_periods ?? []).map((p) => ({
    id: String(p.id),
    title: p.title,
    startAt: toDate(p.start_date),
    endAt: toDate(p.end_date),
    closed: p.is_closed ?? false,
  }));
}

export function useGradingPeriods(courseId: string) {
  return useCanvasQuery(['courses', courseId, 'grading_periods'], (client, signal) =>
    fetchGradingPeriods(client, courseId, signal),
  );
}

/** The grading period that contains `now`, if any. */
export function currentGradingPeriod(periods: GradingPeriod[], now = new Date()): GradingPeriod | null {
  return periods.find((p) => (!p.startAt || p.startAt <= now) && (!p.endAt || now <= p.endAt)) ?? null;
}

export async function fetchAssignment(
  client: CanvasClient,
  courseId: string,
  assignmentId: string,
  signal?: AbortSignal,
): Promise<Assignment> {
  const raw = await client.get<CanvasAssignment>(
    `/api/v1/courses/${courseId}/assignments/${assignmentId}`,
    { include: ['submission', 'can_submit'] },
    signal,
  );
  return toAssignment(raw);
}

/** One assignment with its description, rubric, and the student's submission (ASSIGN-2). */
export function useAssignment(courseId: string, assignmentId: string | null | undefined) {
  const placeholderData = useListPlaceholder<AssignmentList, Assignment>(
    ['courses', courseId, 'assignment_groups'],
    (list) => list.assignments?.find((item) => item.id === assignmentId),
  );
  return useCanvasQuery<Assignment>(
    assignmentKeys.detail(courseId, assignmentId ?? ''),
    (client, signal) => fetchAssignment(client, courseId, assignmentId!, signal),
    { enabled: !!assignmentId, placeholderData },
  );
}

export async function fetchSubmission(
  client: CanvasClient,
  courseId: string,
  assignmentId: string,
  signal?: AbortSignal,
): Promise<SubmissionDetail> {
  const raw = await client.get<CanvasSubmission>(
    `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/self`,
    { include: ['submission_history', 'submission_comments', 'rubric_assessment'] },
    signal,
  );
  return toSubmissionDetail(raw);
}

/** The student's submission with every attempt, comments, and rubric assessment (ASSIGN-10). */
export function useSubmission(courseId: string, assignmentId: string) {
  return useCanvasQuery(assignmentKeys.submission(courseId, assignmentId), (client, signal) =>
    fetchSubmission(client, courseId, assignmentId, signal),
  );
}

/** Every assignment in the course, by due date. For the syllabus summary. */
export async function fetchCourseAssignments(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<Assignment[]> {
  const list = await client.getAll<CanvasAssignment>(
    `/api/v1/courses/${courseId}/assignments`,
    { order_by: 'due_at', exclude_response_fields: ['description', 'rubric'] },
    { signal },
  );
  return list.map(toAssignment);
}
