import { useLocalSearchParams } from 'expo-router';

import { useTranslation } from '@/i18n';

import { Screen } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { QuizDetails } from '@/features/course/QuizDetails';
import { useRefreshControl } from '@/features/course/states';

/** Quiz details: instructions, limits, attempts, dates, and lock state (QUIZ-1). */
export default function QuizScreen() {
  const { courseId, quizId } = useLocalSearchParams<{ courseId: string; quizId: string }>();
  const { t } = useTranslation();
  const refreshControl = useRefreshControl([['courses', courseId, 'quizzes', quizId]]);
  return (
    <CourseScope courseId={courseId} title={t('quizPresentation.single')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        <QuizDetails courseId={courseId} quizId={quizId} />
      </Screen>
    </CourseScope>
  );
}
