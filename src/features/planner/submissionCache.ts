import type { QueryClient } from '@tanstack/react-query';
import type { CalendarItem } from '@/canvas/api/calendar';
import type { Quiz, QuizAttempts, QuizSubmission } from '@/canvas/api/quizzes';
import type { WorkItem } from '@/canvas/models';

type SubmittedWork = { courseId: string; quizId?: string; assignmentId?: string | null };

/** Apply the planner's submitted state to every cached window before reconciliation. */
export function markSubmittedWork(client: QueryClient, account: string, work: SubmittedWork) {
  const matches = (item: { id: string; courseId: string | null }) =>
    item.courseId === work.courseId &&
    ((!!work.quizId && item.id === `quiz:${work.quizId}`) ||
      (!!work.assignmentId && item.id === `assignment:${work.assignmentId}`));
  // Cancel old reads synchronously so they cannot overwrite the accepted submission.
  void client.cancelQueries({ queryKey: [account, 'planner'] });
  client.setQueriesData<WorkItem[]>({ queryKey: [account, 'planner', 'items'] }, (items) =>
    items?.map((item) => (matches(item) ? { ...item, status: 'submitted' } : item)),
  );
  client.setQueriesData<{ items: CalendarItem[]; assignmentIds: string[] }>(
    { queryKey: [account, 'planner', 'calendar'] },
    (part) =>
      part && { ...part, items: part.items.map((item) => (matches(item) ? { ...item, done: true } : item)) },
  );
  void client.invalidateQueries({ queryKey: [account, 'planner'] });
}

/** Seed only server-confirmed attempt data. Scores are never inferred. */
export function cacheCompletedQuiz(
  client: QueryClient,
  account: string,
  courseId: string,
  quizId: string,
  submission: QuizSubmission,
) {
  const key = [account, 'courses', courseId, 'quizzes', quizId];
  const quiz = client.getQueryData<Quiz>(key);
  void client.cancelQueries({ queryKey: key });
  client.setQueryData([...key, 'submissions', submission.id], submission);
  const replace = (items: QuizSubmission[] | undefined) => [
    submission,
    ...(items ?? []).filter((item) => item.id !== submission.id || item.attempt !== submission.attempt),
  ];
  client.setQueryData<QuizSubmission[]>([...key, 'submissions'], replace);
  client.setQueryData<QuizSubmission[]>([...key, 'history'], replace);
  client.setQueryData<QuizAttempts>([...key, 'attempts'], {
    used: submission.attempt,
    left: submission.attemptsLeft,
    keptScore: submission.keptScore,
    latestScore: submission.score,
    inProgress: false,
    pendingReview: submission.workflowState === 'pending_review',
  });
  markSubmittedWork(client, account, { courseId, quizId, assignmentId: quiz?.assignmentId });
  void client.invalidateQueries({ queryKey: key });
  if (quiz?.assignmentId) {
    void client.invalidateQueries({
      queryKey: [account, 'courses', courseId, 'assignments', quiz.assignmentId],
    });
    void client.invalidateQueries({ queryKey: [account, 'courses', courseId, 'assignment_groups'] });
  }
}
