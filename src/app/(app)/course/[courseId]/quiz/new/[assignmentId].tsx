import { useLocalSearchParams } from 'expo-router';
import { ClipboardCheck } from 'lucide-react-native';

import { useCanvas } from '@/canvas/session';
import { useTranslation } from '@/i18n';
import { useToolLifetime } from '@/features/lti/lifetime';
import { useQuizRetry } from '@/features/quizzes/quizPresentation';

import { useNewQuizzes } from '@/canvas/api/quizzes';
import { Card, EmptyState, Screen } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { DetailSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { NewQuizLaunch } from '@/features/quizzes/NewQuizLaunch';

/** A New Quiz from the quiz list (QUIZ-8): dates and points, and "Open quiz" in the signed-in web view. */
export default function NewQuizScreen() {
  const { courseId, assignmentId } = useLocalSearchParams<{
    courseId: string;
    assignmentId: string;
  }>();
  const { t } = useTranslation();
  const { account, client } = useCanvas();
  const quizzes = useNewQuizzes(courseId);
  const refreshControl = useRefreshControl([['courses', courseId, 'quizzes', 'new']]);
  const quiz = quizzes.data?.find((q) => q.assignmentId === assignmentId);
  const ready = !!quiz && !quizzes.isError && !quizzes.isPending;
  const context = useToolLifetime(
    JSON.stringify([account.id, courseId, assignmentId, ready]),
    client,
  );
  const retry = useQuizRetry(JSON.stringify(['new-quiz', courseId, assignmentId]), [
    quizzes.refetch,
  ]);
  return (
    <CourseScope courseId={courseId} title={t('quizPresentation.single')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        {quizzes.isError ? (
          <LoadError title={t('quizPresentation.loadQuiz')} error={quizzes.error} onRetry={retry} />
        ) : null}
        {quiz ? (
          <NewQuizLaunch
            ready={ready}
            context={context}
            courseId={courseId}
            assignmentId={quiz.assignmentId}
            title={quiz.title}
            dueAt={quiz.dueAt}
            points={quiz.points}
            locked={quiz.locked}
            lockExplanation={quiz.lockExplanation}
            canvasUrl={quiz.htmlUrl}
          />
        ) : quizzes.isPending ? (
          <DetailSkeleton />
        ) : !quizzes.isError ? (
          <Card padding="none">
            <EmptyState
              icon={ClipboardCheck}
              title={t('newQuizLaunch.unavailable')}
              description={t('newQuizLaunch.unavailableHelp')}
            />
          </Card>
        ) : null}
      </Screen>
    </CourseScope>
  );
}
