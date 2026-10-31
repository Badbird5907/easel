import { router } from 'expo-router';
import { History } from 'lucide-react-native';
import { View } from 'react-native';

import { useAssignment } from '@/canvas/api/assignments';
import { useCourse } from '@/canvas/api/courses';
import { type Quiz, type QuizSubmission, useQuiz, useQuizHistory } from '@/canvas/api/quizzes';
import { Card, EmptyState, ListGroup, ListItem, Text } from '@/design';
import { formatGrade, formatScore } from '@/features/course/format';
import {
  scoredQuiz,
  type QuizPresentation,
  useQuizOwner,
  useQuizPresentation,
  useQuizRetry,
} from './quizPresentation';
import { ListSkeleton, LoadError } from '@/features/course/states';

/** "30 minutes", "1 hr 5 min", for time spent on an attempt. */
export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return 'Under a minute';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} hr${m ? ` ${m} min` : ''}`;
}

export const isSurvey = (quiz: Pick<Quiz, 'type'> | undefined) =>
  quiz?.type === 'survey' || quiz?.type === 'graded_survey';

/**
 * Restricted quantitative data (GRADE-4): the course, or the quiz's assignment,
 * shows letter grades only. Scores stay hidden until both have answered.
 */
export function useQuizRestricted(courseId: string, quiz: Quiz | undefined): boolean | undefined {
  const course = useCourse(courseId);
  const assignment = useAssignment(courseId, quiz?.assignmentId);
  if (course.data?.restricted || assignment.data?.restricted) return true;
  // A failed permissions lookup is not permission to show numeric grades.
  if (course.isError || (quiz?.assignmentId && assignment.isError)) return true;
  if (course.isPending || (quiz?.assignmentId && assignment.isPending)) return undefined;
  if (!quiz || !course.data || (quiz.assignmentId && !assignment.data)) return undefined;
  return false;
}

/** A score as the student may see it: "22/25", a letter under restricted data, or null. */
export function attemptScore(
  score: number | null,
  points: number | null,
  restricted: boolean,
): string | null {
  if (score === null) return null;
  if (restricted) return formatGrade(score, null, { points, gradingType: 'points', restricted: true });
  return formatScore(score, null, points);
}

export function attemptResultsRoute(courseId: string, quizId: string, attempt: number) {
  return {
    pathname: '/course/[courseId]/quiz/[quizId]/attempt/[attempt]',
    params: { courseId, quizId, attempt: String(attempt) },
  } as const;
}

export function historyRoute(courseId: string, quizId: string) {
  return { pathname: '/course/[courseId]/quiz/[quizId]/history', params: { courseId, quizId } } as const;
}

function statusLine(s: QuizSubmission, p: QuizPresentation) {
  return [
    s.finishedAt
      ? p.t('quizPresentation.submittedDate', { date: p.date(s.finishedAt, undefined, true) })
      : p.t('quizPresentation.submitted'),
    s.timeSpent ? p.duration(s.timeSpent) : null,
    s.workflowState === 'pending_review' ? p.t('quizPresentation.needsGrading') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Every finished attempt with its score, newest first (QUIZ-9). Each opens its results. */
export function QuizHistory({ courseId, quizId }: { courseId: string; quizId: string }) {
  const quiz = useQuiz(courseId, quizId);
  const history = useQuizHistory(courseId, quizId);
  const restricted = useQuizRestricted(courseId, quiz.data);
  const p = useQuizPresentation();
  const { t } = p;
  const key = JSON.stringify([courseId, quizId]);
  const owner = useQuizOwner(key, { attempts: history.data, eligible: !!quiz.data && !quiz.isError });
  const retry = useQuizRetry(key, [quiz.refetch, history.refetch]);

  const error = quiz.error ?? history.error;
  if (error && (!quiz.data || !history.data))
    return <LoadError title={t('quizPresentation.loadResults')} error={error} onRetry={retry} />;
  if (!quiz.data || !history.data) return <ListSkeleton rows={3} leading={false} />;

  const q = quiz.data;
  const attempts = history.data;
  const survey = isSurvey(q);
  const latest = attempts[0];
  const points = latest?.pointsPossible ?? q.points;
  const multiple = q.allowedAttempts === null || q.allowedAttempts > 1;
  const visibility = quiz.isError || !scoredQuiz(q) ? undefined : restricted;
  const kept = survey ? null : p.score(latest?.keptScore ?? null, points, visibility);

  return (
    <>
      {error ? <LoadError title={t('quizPresentation.loadResults')} error={error} onRetry={retry} /> : null}
      <View className="gap-1">
        <Text variant="title2" accessibilityRole="header">
          {q.title}
        </Text>
        <Text variant="subhead" tone="muted">
          {attempts.length === 0
            ? t('quizPresentation.noAttempts')
            : q.allowedAttempts === null
              ? t('quizPresentation.attemptCount', { count: attempts.length })
              : t('quizPresentation.attemptsUsed', {
                  used: p.number(attempts.length),
                  total: p.number(Math.max(q.allowedAttempts, latest?.attempt ?? 0)),
                })}
        </Text>
      </View>

      {attempts.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={History}
            title={t('quizPresentation.noResults')}
            description={t('quizPresentation.noResultsHelp')}
          />
        </Card>
      ) : (
        <>
          {kept && multiple ? (
            <Card className="gap-0.5" accessibilityLabel={t('quizPresentation.keptLabel', { score: kept })}>
              <Text variant="footnote" tone="muted">
                {t('quizPresentation.kept')}
              </Text>
              <Text variant="title3" tabular>
                {kept}
              </Text>
              {q.scoringPolicy ? (
                <Text variant="subhead" tone="muted">
                  {p.scoring(q.scoringPolicy)}
                </Text>
              ) : null}
            </Card>
          ) : null}

          <ListGroup header={t('quizPresentation.attempts')}>
            {attempts.map((s, i) => {
              const score = survey ? null : p.score(s.score, s.pointsPossible ?? q.points, visibility);
              const title =
                i === 0 && attempts.length > 1
                  ? t('quizPresentation.latest', { count: s.attempt })
                  : t('quizPresentation.attempt', { count: s.attempt });
              const value =
                score ??
                (s.workflowState === 'pending_review'
                  ? t('quizPresentation.pending')
                  : t('quizPresentation.submitted'));
              const line = statusLine(s, p);
              return (
                <ListItem
                  key={s.attempt}
                  title={title}
                  subtitle={line}
                  value={value}
                  accessibilityLabel={
                    score
                      ? t('quizPresentation.scoreLabel', { title, score, status: line })
                      : t('quizPresentation.statusLabel', { title, status: line })
                  }
                  accessibilityHint={t('quizPresentation.openAttempt')}
                  onPress={() => {
                    if (
                      owner.active &&
                      owner.current?.eligible &&
                      owner.current.attempts?.some(
                        (current) => current.id === s.id && current.attempt === s.attempt,
                      )
                    )
                      router.push(attemptResultsRoute(courseId, quizId, s.attempt) as never);
                  }}
                />
              );
            })}
          </ListGroup>
        </>
      )}
    </>
  );
}
