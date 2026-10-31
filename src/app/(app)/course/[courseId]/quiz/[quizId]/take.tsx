import { useLocalSearchParams } from 'expo-router';

import { useTranslation } from '@/i18n';
import { useCanvas } from '@/canvas/session';
import { useQuiz } from '@/canvas/api/quizzes';
import { CourseScope } from '@/features/course/CourseScope';
import { QuizAttemptScreen } from '@/features/quizzes/QuizAttemptScreen';

/** Taking a classic quiz natively (QUIZ-2 to QUIZ-4). Opened from the quiz's "Take quiz". */
export default function TakeQuizScreen() {
  const { courseId, quizId, submissionId } = useLocalSearchParams<{
    courseId: string;
    quizId: string;
    submissionId: string;
  }>();
  const { t } = useTranslation();
  const { account } = useCanvas();
  const quiz = useQuiz(courseId, quizId);
  return (
    <CourseScope courseId={courseId} title={quiz.data?.title ?? t('quizPresentation.single')}>
      <QuizAttemptScreen
        key={JSON.stringify([account.id, courseId, quizId, submissionId])}
        courseId={courseId}
        quizId={quizId}
        submissionId={submissionId}
      />
    </CourseScope>
  );
}
