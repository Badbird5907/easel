import { useLocalSearchParams } from 'expo-router';

import { useTranslation } from '@/i18n';
import { Screen } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { useRefreshControl } from '@/features/course/states';
import { AttemptResults } from '@/features/quizzes/AttemptResults';

/** One quiz attempt's score and which questions were right (QUIZ-9). */
export default function QuizAttemptResultsScreen() {
  const { courseId, quizId, attempt } = useLocalSearchParams<{
    courseId: string;
    quizId: string;
    attempt: string;
  }>();
  const { t } = useTranslation();
  const refreshControl = useRefreshControl([['courses', courseId, 'quizzes', quizId]]);
  return (
    <CourseScope courseId={courseId} title={t('quizPresentation.attempt', { count: Number(attempt) })}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        <AttemptResults courseId={courseId} quizId={quizId} attempt={Number(attempt)} />
      </Screen>
    </CourseScope>
  );
}
