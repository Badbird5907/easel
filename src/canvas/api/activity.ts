import { activityGradePreview, activityGradePreviewText } from '@/features/activity/activityVisibility';

import type { CanvasClient } from '../client';
import { htmlToText } from '../html';
import { useCanvasQuery } from '../query';

/*
 * The activity stream (NOTIF-1): what changed across the student's courses.
 * It stands in for push notifications until those exist (PRD 4.3).
 */

/** `GET /api/v1/users/self/activity_stream` (lib/api/v1/stream_item.rb) */
export type CanvasStreamItem = {
  id: string;
  title: string | null;
  message: string | null;
  type:
    | 'DiscussionTopic'
    | 'Announcement'
    | 'Conversation'
    | 'Message'
    | 'Submission'
    | 'WebConference'
    | 'Collaboration'
    | 'AssessmentRequest'
    | 'DiscussionEntry';
  /** True once read. */
  read_state: boolean | null;
  created_at: string;
  updated_at: string;
  context_type?: 'Course' | 'Group' | 'User';
  course_id?: string;
  group_id?: string;
  html_url?: string | null;
  url?: string | null;
  // DiscussionTopic and Announcement
  discussion_topic_id?: string;
  announcement_id?: string;
  // Conversation
  conversation_id?: string;
  participant_count?: number;
  latest_messages?: { body?: string; author_id?: string }[];
  // Message
  notification_category?: string | null;
  // Submission
  assignment?: {
    id: string;
    name?: string;
    points_possible?: number | null;
    grading_type?: string;
    restrict_quantitative_data?: boolean;
  } | null;
  course?: { id: string; restrict_quantitative_data?: boolean } | null;
  grade?: string | null;
  score?: number | null;
  workflow_state?: string;
  submission_comments?: { author_name?: string; comment?: string; body?: string }[];
  // DiscussionEntry (a mention) and Collaboration
  author_name?: string;
  collaboration_id?: string;
  web_conference_id?: string;
  assessment_request_id?: string;
};

export type ActivityKind =
  'announcement' | 'discussion' | 'conversation' | 'submission' | 'message' | 'conference' | 'other';

/** Where opening an item goes. Every type has one, so every row opens something. */
export type ActivityTarget =
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'topic'; courseId: string; topicId: string }
  /** A grade: the assignment, where the score and feedback are (GRADE-7). */
  | { kind: 'assignment'; courseId: string; assignmentId: string }
  /** A mention in a reply: Canvas sends no topic, so it opens the course's discussions. */
  | { kind: 'course-discussions'; courseId: string }
  /** A Canvas URL: opened in Easel when it can be, otherwise signed in on the web. */
  | { kind: 'url'; url: string };

/** Provenance only for text synthesized here; absent on legacy cached items. */
export type ActivityGeneratedPreview =
  | { kind: 'comment'; body: string }
  | { kind: 'scored'; score: number; points: number }
  | { kind: 'grade'; grade: string }
  | { kind: 'graded' | 'excused' };

export type ActivityItem = {
  generatedTitle?: { kind: 'untitled' | 'assignment' | 'mention'; author?: string };
  generatedPreview?: ActivityGeneratedPreview;
  id: string;
  kind: ActivityKind;
  title: string;
  preview: string;
  updatedAt: Date;
  courseId: string | null;
  unread: boolean;
  htmlUrl: string | null;
  conversationId: string | null;
  /** Discussion or announcement topic, for clearing unread state when it opens. */
  topicId: string | null;
  /** For grades and comments. */
  assignmentId: string | null;
  target: ActivityTarget | null;
};

const kinds: Record<CanvasStreamItem['type'], ActivityKind> = {
  Announcement: 'announcement',
  DiscussionTopic: 'discussion',
  DiscussionEntry: 'discussion',
  Conversation: 'conversation',
  Submission: 'submission',
  AssessmentRequest: 'submission',
  Message: 'message',
  WebConference: 'conference',
  Collaboration: 'other',
};

function submissionPreview(item: CanvasStreamItem): string {
  const comments = item.submission_comments ?? [];
  const last = comments[comments.length - 1];
  if (last) return `${last.author_name ?? 'Comment'}: ${last.comment ?? last.body ?? ''}`.trim();
  return activityGradePreviewText(activityGradePreview(item))
    ?? (item.workflow_state === 'graded' ? 'Graded' : '');
}

function submissionProvenance(item: CanvasStreamItem): ActivityGeneratedPreview | undefined {
  const comments = item.submission_comments ?? [];
  const last = comments[comments.length - 1];
  if (last) return last.author_name == null
    ? { kind: 'comment', body: last.comment ?? last.body ?? '' } : undefined;
  return activityGradePreview(item)
    ?? (item.workflow_state === 'graded' ? { kind: 'graded' } : undefined);
}

function targetOf(
  item: CanvasStreamItem,
  courseId: string | null,
  topicId: string | null,
): ActivityTarget | null {
  if (item.conversation_id) return { kind: 'conversation', conversationId: String(item.conversation_id) };
  if (courseId && topicId) return { kind: 'topic', courseId, topicId };
  // A grade without comments opens the assignment; comments open on the submission (its html_url).
  if (item.type === 'Submission' && courseId && item.assignment?.id && !item.submission_comments?.length)
    return { kind: 'assignment', courseId, assignmentId: String(item.assignment.id) };
  const url = item.html_url ?? item.url;
  if (url) return { kind: 'url', url };
  if (item.type === 'DiscussionEntry' && courseId) return { kind: 'course-discussions', courseId };
  return null;
}

function titleOf(item: CanvasStreamItem): string {
  const title = item.title?.trim() || item.assignment?.name;
  if (title) return title;
  if (item.type === 'DiscussionEntry')
    return item.author_name ? `${item.author_name} mentioned you` : 'You were mentioned';
  return 'Untitled';
}

export function toActivityItem(item: CanvasStreamItem): ActivityItem {
  const kind = kinds[item.type] ?? 'other';
  let preview: string;
  if (kind === 'submission') preview = submissionPreview(item);
  else if (kind === 'conversation')
    preview = item.latest_messages?.[0]?.body ?? htmlToText(item.message ?? '');
  else preview = htmlToText(item.message ?? '');
  const courseId = item.course_id ? String(item.course_id) : null;
  const topicId = item.discussion_topic_id
    ? String(item.discussion_topic_id)
    : item.announcement_id
      ? String(item.announcement_id)
      : null;
  return {
    id: String(item.id),
    kind,
    title: titleOf(item),
    ...(!(item.title?.trim() || item.assignment?.name) ? {
      generatedTitle: item.type === 'DiscussionEntry'
        ? { kind: 'mention' as const, ...(item.author_name ? { author: item.author_name } : {}) }
        : { kind: 'untitled' as const },
    } : {}),
    ...(kind === 'submission' ? { generatedPreview: submissionProvenance(item) } : {}),
    preview: preview.replace(/\s+/g, ' ').slice(0, 200),
    updatedAt: new Date(item.updated_at ?? item.created_at),
    courseId,
    unread: item.read_state === false,
    htmlUrl: item.html_url ?? item.url ?? null,
    conversationId: item.conversation_id ? String(item.conversation_id) : null,
    topicId,
    assignmentId: item.assignment?.id ? String(item.assignment.id) : null,
    target: targetOf(item, courseId, topicId),
  };
}

/** `GET /api/v1/users/self/graded_submissions` (users_controller.rb#user_graded_submissions), trimmed. */
type CanvasGradedSubmission = {
  id: string;
  assignment_id: string;
  graded_at: string | null;
  score?: number | null;
  grade?: string | null;
  excused?: boolean;
  workflow_state?: string;
  assignment?: {
    id: string;
    name?: string;
    course_id?: string;
    points_possible?: number | null;
    grading_type?: string;
    restrict_quantitative_data?: boolean;
  } | null;
  course?: { id: string; restrict_quantitative_data?: boolean } | null;
};

function gradePreview(s: CanvasGradedSubmission): string | null {
  return activityGradePreviewText(activityGradePreview(s, true));
}

function gradeProvenance(s: CanvasGradedSubmission): ActivityGeneratedPreview | undefined {
  return activityGradePreview(s, true);
}

/** Recent grades as activity (GRADE-7), each opening its assignment. Unposted grades carry no score and are left out. */
function toGradeItem(s: CanvasGradedSubmission): ActivityItem | null {
  const courseId = s.assignment?.course_id ? String(s.assignment.course_id) : s.course ? String(s.course.id) : null;
  const preview = gradePreview(s);
  if (!courseId || !s.graded_at || !preview) return null;
  return {
    id: `grade:${s.id}`,
    kind: 'submission',
    title: s.assignment?.name?.trim() || 'Assignment',
    ...(!s.assignment?.name?.trim() ? { generatedTitle: { kind: 'assignment' as const } } : {}),
    generatedPreview: gradeProvenance(s),
    preview,
    updatedAt: new Date(s.graded_at),
    courseId,
    unread: false,
    htmlUrl: null,
    conversationId: null,
    topicId: null,
    assignmentId: String(s.assignment_id),
    target: { kind: 'assignment', courseId, assignmentId: String(s.assignment_id) },
  };
}

/** How far back new grades reach in Activity. */
const GRADE_DAYS = 21;

async function fetchRecentGrades(client: CanvasClient, signal?: AbortSignal): Promise<ActivityItem[]> {
  const list = await client.get<CanvasGradedSubmission[]>(
    '/api/v1/users/self/graded_submissions',
    {
      include: ['assignment', 'course'],
      only_current_enrollments: true,
      only_published_assignments: true,
      per_page: 30,
    },
    signal,
  );
  const since = Date.now() - GRADE_DAYS * 86_400_000;
  return (list ?? [])
    .map(toGradeItem)
    .filter((i): i is ActivityItem => !!i && i.updatedAt.getTime() >= since);
}

export async function fetchActivity(client: CanvasClient, signal?: AbortSignal): Promise<ActivityItem[]> {
  const [items, grades] = await Promise.all([
    client.getAll<CanvasStreamItem>(
      '/api/v1/users/self/activity_stream',
      { only_active_courses: true },
      { signal, maxPages: 2 },
    ),
    // New grades also come from the student's graded submissions, which list every recent
    // grade; the stream can miss grades that were posted after grading (stream_item.rb).
    fetchRecentGrades(client, signal).catch((): ActivityItem[] => []),
  ]);
  const stream = items.map(toActivityItem);
  const inStream = new Set(stream.filter((i) => i.kind === 'submission').map((i) => i.assignmentId));
  return [...stream, ...grades.filter((g) => !inStream.has(g.assignmentId))].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
}

/** Recent activity across every course, newest first. */
export function useActivity() {
  // Legacy previews have no reliable grade/comment provenance. Do not reuse them:
  // a cold/offline upgrade waits for fresh policy-bearing data instead of guessing
  // from text. Keep the activity prefix for invalidations and notification marks.
  return useCanvasQuery(['activity', 'visibility-v2'], fetchActivity);
}
