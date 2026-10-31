import { useLocalSearchParams } from 'expo-router';

import { useTranslation } from '@/i18n';

import { Screen } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { useRefreshControl } from '@/features/course/states';
import { QuizResult } from '@/features/quizzes/QuizResult';

/** A submitted attempt's result (QUIZ-2). The attempt screen replaces itself with this one. */
export default function QuizResultScreen() {
  const { courseId, quizId, submissionId } = useLocalSearchParams<{
    courseId: string;
    quizId: string;
    submissionId: string;
  }>();
  const { t } = useTranslation();
  const refreshControl = useRefreshControl([['courses', courseId, 'quizzes', quizId]]);
  return (
    <CourseScope courseId={courseId} title={t('quizPresentation.result')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        <QuizResult courseId={courseId} quizId={quizId} submissionId={submissionId} />
      </Screen>
    </CourseScope>
  );
}
