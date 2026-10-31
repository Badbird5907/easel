import { useLocalSearchParams } from 'expo-router';

import { useTranslation } from '@/i18n';

import { Screen } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { useRefreshControl } from '@/features/course/states';
import { QuizHistory } from '@/features/quizzes/QuizHistory';

/** Every finished attempt on a quiz, with scores (QUIZ-9). Opened from the quiz's "Results and history". */
export default function QuizHistoryScreen() {
  const { courseId, quizId } = useLocalSearchParams<{ courseId: string; quizId: string }>();
  const { t } = useTranslation();
  const refreshControl = useRefreshControl([['courses', courseId, 'quizzes', quizId]]);
  return (
    <CourseScope courseId={courseId} title={t('quizPresentation.results')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        <QuizHistory courseId={courseId} quizId={quizId} />
      </Screen>
    </CourseScope>
  );
}
