import type { CanvasClient } from '../client';
import { htmlToText } from '../html';
import type { CanvasPlannerItem } from '../types';
import type { CanvasStreamItem } from './activity';
import type { CanvasConversation } from './conversations';

/*
 * What changed in Canvas, for background refresh (NOTIF-3). Canvas can't push
 * to Easel (PRD 4.3), so the app polls a few cheap endpoints and diffs them
 * against what the student has already seen:
 *   - the activity stream: grades, submission comments, announcements
 *   - unread conversations, plus the unread count for the badge
 *   - planner items: newly published work, and due dates for reminders
 * These fetchers run outside React (in the background task), so there are no hooks here.
 */

// MARK: Raw API shapes

/** Submission stream items carry the whole submission_json (lib/api/v1/stream_item.rb). */
type CanvasStreamChange = Omit<CanvasStreamItem, 'submission_comments'> & {
  assignment_id?: string;
  submission_id?: string;
  graded_at?: string | null;
  posted_at?: string | null;
  excused?: boolean | null;
  submission_comments?: {
    id?: string;
    author_id?: string;
    author_name?: string;
    comment?: string;
    body?: string;
    created_at?: string;
  }[];
};

/** planner_item_json adds these to every plannable (lib/api/v1/planner_item.rb, API_PLANNABLE_FIELDS). */
type CanvasPlannerChange = CanvasPlannerItem & {
  plannable: CanvasPlannerItem['plannable'] & { created_at?: string; updated_at?: string };
};

// MARK: Models

export type GradeChange = {
  assignmentId: string;
  courseId: string | null;
  title: string;
  grade: string | null;
  score: number | null;
  pointsPossible: number | null;
  excused: boolean;
  /** When the grade became visible: graded or posted, whichever is later. */
  at: number;
};

export type CommentChange = {
  id: string;
  assignmentId: string;
  courseId: string | null;
  title: string;
  authorId: string | null;
  author: string;
  text: string;
  at: number;
};

export type AnnouncementChange = {
  topicId: string;
  courseId: string | null;
  title: string;
  preview: string;
  unread: boolean;
  at: number;
};

export type StreamChanges = {
  grades: GradeChange[];
  comments: CommentChange[];
  announcements: AnnouncementChange[];
};

export type MessageChange = {
  conversationId: string;
  subject: string;
  preview: string;
  contextName: string | null;
  at: number;
};

export type PlannedWork = {
  /** ReminderControl's item ID: `<plannable_type>_<id>`, like `assignment_123` or `planner_note_45`. */
  reminderId: string;
  /** Graded quizzes and discussions are also reachable as `assignment_<assignment_id>`. */
  assignmentReminderId: string | null;
  plannableType: string;
  plannableId: string;
  courseId: string | null;
  title: string;
  contextName: string | null;
  dueAt: number | null;
  htmlUrl: string | null;
  /** When Canvas last changed it. Absent on some instances; treat as unknown. */
  updatedAt: number | null;
  /** Something with a due date and a grade: assignments, graded quizzes and discussions. */
  gradable: boolean;
  /** Submitted, graded, excused, or checked off. */
  done: boolean;
};

// MARK: Mapping

const time = (value?: string | null): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

function toStreamChanges(items: CanvasStreamChange[]): StreamChanges {
  const changes: StreamChanges = { grades: [], comments: [], announcements: [] };
  for (const item of items) {
    const courseId = item.course_id ? String(item.course_id) : null;
    const updated = time(item.updated_at) ?? time(item.created_at) ?? 0;
    if (item.type === 'Submission') {
      const assignmentId = String(item.assignment?.id ?? item.assignment_id ?? '');
      if (!assignmentId) continue;
      const title = item.assignment?.name ?? item.title ?? 'Assignment';
      // Canvas hides grades that aren't posted yet, so a visible grade is a posted one.
      const excused = !!item.excused;
      if (item.grade != null || item.score != null || excused) {
        const at = Math.max(time(item.graded_at) ?? 0, time(item.posted_at) ?? 0) || updated;
        changes.grades.push({
          assignmentId,
          courseId,
          title,
          grade: item.grade ?? null,
          score: item.score ?? null,
          pointsPossible: item.assignment?.points_possible ?? null,
          excused,
          at,
        });
      }
      for (const [index, comment] of (item.submission_comments ?? []).entries()) {
        const text = (comment.comment ?? comment.body ?? '').trim();
        if (!text) continue;
        changes.comments.push({
          id: String(comment.id ?? `${item.id}-${index}`),
          assignmentId,
          courseId,
          title,
          authorId: comment.author_id ? String(comment.author_id) : null,
          author: comment.author_name ?? 'Your instructor',
          text,
          at: time(comment.created_at) ?? updated,
        });
      }
    } else if (item.type === 'Announcement') {
      const topicId = String(item.announcement_id ?? item.discussion_topic_id ?? '');
      if (!topicId) continue;
      changes.announcements.push({
        topicId,
        courseId,
        title: item.title?.trim() || 'Announcement',
        preview: htmlToText(item.message ?? '')
          .replace(/\s+/g, ' ')
          .slice(0, 180),
        unread: item.read_state === false,
        at: time(item.created_at) ?? updated,
      });
    }
  }
  return changes;
}

function toMessageChange(c: CanvasConversation): MessageChange {
  return {
    conversationId: String(c.id),
    subject: c.subject?.trim() || '',
    preview: (c.last_message ?? '').replace(/\s+/g, ' ').slice(0, 180),
    contextName: c.context_name ?? null,
    at: time(c.last_message_at) ?? 0,
  };
}

const GRADABLE = new Set(['assignment', 'sub_assignment', 'quiz', 'discussion_topic']);

function toPlannedWork(item: CanvasPlannerChange): PlannedWork {
  const s = item.submissions || undefined;
  const plannable = item.plannable;
  const assignmentId = plannable.assignment_id ? String(plannable.assignment_id) : null;
  return {
    reminderId: `${item.plannable_type}_${item.plannable_id}`,
    assignmentReminderId:
      assignmentId && item.plannable_type !== 'assignment' ? `assignment_${assignmentId}` : null,
    plannableType: item.plannable_type,
    plannableId: String(item.plannable_id),
    courseId: item.course_id ? String(item.course_id) : (plannable.course_id ?? null),
    title: plannable.title,
    contextName: item.context_name ?? null,
    dueAt: time(plannable.due_at ?? plannable.todo_date ?? item.plannable_date),
    htmlUrl: item.html_url ?? null,
    updatedAt: time(plannable.updated_at) ?? time(plannable.created_at),
    gradable: GRADABLE.has(item.plannable_type),
    done:
      !!item.planner_override?.marked_complete ||
      !!(s && (s.submitted || s.graded || s.excused) && !s.redo_request),
  };
}

// MARK: Fetchers

/** The newest page of the activity stream: enough for what changed since the last check. */
export async function fetchStreamChanges(client: CanvasClient, signal?: AbortSignal): Promise<StreamChanges> {
  const items = await client.get<CanvasStreamChange[]>(
    '/api/v1/users/self/activity_stream',
    { only_active_courses: true, per_page: 50 },
    signal,
  );
  return toStreamChanges(Array.isArray(items) ? items : []);
}

/** Unread conversations, newest first. */
export async function fetchUnreadMessages(
  client: CanvasClient,
  signal?: AbortSignal,
): Promise<MessageChange[]> {
  const list = await client.get<CanvasConversation[]>(
    '/api/v1/conversations',
    { scope: 'unread', per_page: 25 },
    signal,
  );
  return (Array.isArray(list) ? list : []).map(toMessageChange);
}

/** `GET /api/v1/conversations/unread_count`. Canvas sends the count as a string. */
export async function fetchUnreadCount(client: CanvasClient, signal?: AbortSignal): Promise<number> {
  const result = await client.get<{ unread_count: string | number }>(
    '/api/v1/conversations/unread_count',
    undefined,
    signal,
  );
  const count = Number(result?.unread_count ?? 0);
  return Number.isFinite(count) ? count : 0;
}

/** A week back through two months ahead: what reminders and new-work checks care about. */
export function plannedWorkRange(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7 + 60);
  return { start, end };
}

export async function fetchPlannedWork(client: CanvasClient, signal?: AbortSignal): Promise<PlannedWork[]> {
  const { start, end } = plannedWorkRange();
  const items = await client.getAll<CanvasPlannerChange>(
    '/api/v1/planner/items',
    { start_date: start.toISOString(), end_date: end.toISOString() },
    { signal, maxPages: 5 },
  );
  return items.filter((i) => i.plannable_type !== 'announcement').map(toPlannedWork);
}

/** Course names by ID, for notification subtitles. */
export async function fetchCourseNames(
  client: CanvasClient,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const courses = await client.getAll<{ id: string; name?: string; course_code?: string }>(
    '/api/v1/courses',
    { enrollment_state: 'active' },
    { signal, maxPages: 2 },
  );
  return Object.fromEntries(courses.map((c) => [String(c.id), c.name || c.course_code || '']));
}
