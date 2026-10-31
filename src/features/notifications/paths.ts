/*
 * In-app routes that notifications open (NOTIF-5). Strings, so they survive
 * the trip through the notification payload.
 */

const seg = (value: string) => encodeURIComponent(value);

export const paths = {
  assignment: (courseId: string, assignmentId: string) =>
    `/course/${seg(courseId)}/assignment/${seg(assignmentId)}`,
  submission: (courseId: string, assignmentId: string) =>
    `/course/${seg(courseId)}/assignment/${seg(assignmentId)}/submission`,
  quiz: (courseId: string, quizId: string) => `/course/${seg(courseId)}/quiz/${seg(quizId)}`,
  discussion: (courseId: string, topicId: string) => `/course/${seg(courseId)}/discussion/${seg(topicId)}`,
  conversation: (conversationId: string) => `/conversation/${seg(conversationId)}`,
  grades: '/grades',
  activity: '/activity',
  announcements: '/announcements',
  inbox: '/inbox',
  todo: '/todo',
} as const;

/** Where a planner item opens, by its plannable type. Null when Easel has no screen for it. */
export function plannablePath(type: string, id: string, courseId: string | null): string | null {
  if (!courseId) return null;
  switch (type) {
    case 'assignment':
    case 'sub_assignment':
      return paths.assignment(courseId, id);
    case 'quiz':
      return paths.quiz(courseId, id);
    case 'discussion_topic':
      return paths.discussion(courseId, id);
    default:
      return null;
  }
}
