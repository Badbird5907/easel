/**
 * Easel's domain models: what screens render. Mapping from raw Canvas JSON
 * happens in `src/canvas/api/*`, never in components.
 */

export type Course = {
  id: string;
  /** Course code, e.g. "BIO 201". */
  code: string;
  /** The student's nickname if set, otherwise the course name. */
  name: string;
  originalName: string;
  /** The student's Canvas course color, always present (falls back to Canvas's palette). */
  color: string;
  imageUrl: string | null;
  isFavorite: boolean;
  term: string | null;
};

export type WorkItemKind =
  'assignment' | 'quiz' | 'discussion' | 'page' | 'note' | 'event' | 'peer_review' | 'announcement';

export type WorkItemStatus = 'open' | 'missing' | 'submitted' | 'graded';

/** Anything with a date on a student's plate: assignments, quizzes, to-dos, events. */
export type WorkItem = {
  /** `<plannable_type>:<plannable_id>`, unique across kinds. */
  id: string;
  plannableId: string;
  plannableType: string;
  kind: WorkItemKind;
  title: string;
  courseId: string | null;
  /** Course or group name from Canvas, for items outside the dashboard courses. */
  contextName: string | null;
  dueAt: Date;
  points: number | null;
  status: WorkItemStatus;
  late: boolean;
  excused: boolean;
  hasFeedback: boolean;
  /** Checked off in the planner by the student. */
  markedComplete: boolean;
  dismissed: boolean;
  overrideId: string | null;
  htmlUrl: string | null;
  newActivity: boolean;
};

export const isDone = (item: WorkItem) =>
  item.markedComplete || item.status === 'submitted' || item.status === 'graded' || item.excused;

export type Announcement = {
  id: string;
  courseId: string | null;
  title: string;
  author: { name: string; avatarUrl: string | null };
  /** Only adapter-generated fallback names; absent in legacy caches. */
  authorNameFallback?: 'unknown';
  postedAt: Date;
  /** Plain-text excerpt of the body. */
  preview: string;
  html: string;
  unread: boolean;
  htmlUrl: string;
};
