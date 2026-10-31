import { KeyRound, Lock, ShieldAlert, Wifi } from 'lucide-react-native';
import { View } from 'react-native';

import { type Quiz, type QuizAttempts, type QuizType, useQuiz, useQuizAttempts } from '@/canvas/api/quizzes';
import { Badge, Callout, Card, Section, Text } from '@/design';
import { RichContent } from '@/features/content/RichContent';
import { TakeQuiz } from '@/features/quizzes/TakeQuiz';

import { type Fact, FactList } from './FactList';
import { useQuizRestricted } from '@/features/quizzes/QuizHistory';
import {
  type QuizPresentation,
  scoredQuiz,
  useQuizPresentation,
  useQuizRetry,
} from '@/features/quizzes/quizPresentation';
import { DetailSkeleton, LoadError } from './states';

export const quizTypeLabels: Record<QuizType, string> = {
  assignment: 'Graded quiz',
  practice_quiz: 'Practice quiz',
  graded_survey: 'Graded survey',
  survey: 'Survey',
};

/** Attempts left, or null when unlimited. Falls back to the quiz's limit before the first attempt. */
export function quizAttemptsLeft(quiz: Quiz, attempts: QuizAttempts | undefined): number | null {
  if (attempts && attempts.left !== undefined) return attempts.left;
  if (quiz.allowedAttempts === null) return null;
  return Math.max(0, quiz.allowedAttempts - (attempts?.used ?? 0));
}

function attemptsFact(quiz: Quiz, attempts: QuizAttempts | undefined, p: QuizPresentation): string {
  const used = attempts?.used ?? 0;
  if (quiz.allowedAttempts === null)
    return used > 0
      ? p.t('quizPresentation.usedUnlimited', { used: p.number(used) })
      : p.t('quizPresentation.unlimited');
  const left = quizAttemptsLeft(quiz, attempts) ?? 0;
  return p.t('quizPresentation.used', { used: p.number(used), total: p.number(used + left) });
}

function Result({
  quiz,
  attempts,
  restricted,
  ready,
}: {
  quiz: Quiz;
  attempts: QuizAttempts;
  restricted: boolean | undefined;
  ready: boolean;
}) {
  const p = useQuizPresentation();
  const { t } = p;
  if (attempts.used === 0) return null;
  const score =
    ready && scoredQuiz(quiz)
      ? p.score(attempts.keptScore ?? attempts.latestScore, quiz.points, restricted)
      : null;
  const title = attempts.inProgress
    ? t('quizPresentation.inProgress')
    : attempts.pendingReview
      ? t('quizPresentation.waiting')
      : score !== null
        ? score
        : t('quizPresentation.submitted');
  const detail =
    attempts.inProgress || score === null
      ? t('quizPresentation.attempt', { count: attempts.used })
      : quiz.allowedAttempts === 1
        ? t('quizPresentation.yourScore')
        : t('quizPresentation.keptAfter', { count: attempts.used });
  return (
    <Card className="gap-0.5" accessibilityLabel={`${title}. ${detail}`}>
      <Text variant="headline" tabular>
        {title}
      </Text>
      <Text variant="subhead" tone="muted">
        {detail}
      </Text>
    </Card>
  );
}

/** Instructions, limits, dates, and lock state for a classic quiz (QUIZ-1), and taking it (QUIZ-2 to QUIZ-7). */
export function QuizBody({
  quiz,
  attempts,
  courseId,
  resultsReady = true,
}: {
  quiz: Quiz;
  attempts: QuizAttempts | undefined;
  courseId: string;
  resultsReady?: boolean;
}) {
  const p = useQuizPresentation();
  const { t } = p;
  const restricted = useQuizRestricted(courseId, quiz);
  const points = p.points(quiz.points);
  const multiple = quiz.allowedAttempts === null || quiz.allowedAttempts > 1;
  const facts: (Fact | null)[] = [
    {
      label: t('quizPresentation.due'),
      value: quiz.dueAt ? p.date(quiz.dueAt) : t('quizPresentation.noDue'),
    },
    quiz.unlockAt ? { label: t('quizPresentation.availableFrom'), value: p.date(quiz.unlockAt) } : null,
    quiz.lockAt ? { label: t('quizPresentation.availableUntil'), value: p.date(quiz.lockAt) } : null,
    {
      label: t('quizPresentation.limit'),
      value: quiz.timeLimitMinutes ? p.minutes(quiz.timeLimitMinutes) : t('quizPresentation.none'),
    },
    { label: t('quizPresentation.attempts'), value: attemptsFact(quiz, attempts, p) },
    { label: t('quizPresentation.questions'), value: p.number(quiz.questionCount) },
    quiz.oneQuestionAtATime
      ? {
          label: t('quizPresentation.format'),
          value: quiz.cantGoBack ? t('quizPresentation.noBack') : t('quizPresentation.oneQuestion'),
        }
      : null,
    multiple && quiz.scoringPolicy
      ? { label: t('quizPresentation.scoring'), value: p.scoring(quiz.scoringPolicy) }
      : null,
  ];

  return (
    <>
      <View className="gap-2.5">
        <Text variant="title2" accessibilityRole="header">
          {quiz.title}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Badge tone={quiz.locked ? 'neutral' : 'accent'} icon={quiz.locked ? Lock : undefined}>
            {quiz.locked ? t('quizPresentation.locked') : p.type(quiz.type)}
          </Badge>
          {points && quiz.type !== 'survey' ? (
            <Text variant="subhead" tone="muted" tabular>
              {points}
            </Text>
          ) : null}
        </View>
      </View>

      {quiz.locked ? (
        <Callout tone="warning" icon={Lock} title={t('quizPresentation.locked')}>
          {quiz.lockExplanation ?? t('quizPresentation.lockedHelp')}
        </Callout>
      ) : null}
      {quiz.requiresLockdownBrowser && !quiz.locked ? (
        <Callout tone="warning" icon={ShieldAlert} title={t('quizPresentation.lockdown')}>
          {t('quizPresentation.lockdownHelp')}
        </Callout>
      ) : null}
      {quiz.ipFiltered && !quiz.locked ? (
        <Callout tone="info" icon={Wifi} title={t('quizPresentation.network')}>
          {t('quizPresentation.networkHelp')}
        </Callout>
      ) : null}
      {quiz.requiresAccessCode && !quiz.locked ? (
        <Callout tone="info" icon={KeyRound} title={t('quizPresentation.accessCode')}>
          {t('quizPresentation.accessCodeHelp')}
        </Callout>
      ) : null}

      {attempts ? (
        <Result quiz={quiz} attempts={attempts} restricted={restricted} ready={resultsReady} />
      ) : null}
      <TakeQuiz
        quiz={quiz}
        attempts={attempts}
        courseId={courseId}
        attemptsLeft={quizAttemptsLeft(quiz, attempts)}
      />
      <FactList facts={facts} />

      {quiz.html ? (
        <Section title={t('quizPresentation.instructions')}>
          <RichContent html={quiz.html} />
        </Section>
      ) : null}
    </>
  );
}

/** Loads and renders a quiz. Used by the quiz screen and module items. */
export function QuizDetails({ courseId, quizId }: { courseId: string; quizId: string }) {
  const quiz = useQuiz(courseId, quizId);
  const attempts = useQuizAttempts(courseId, quizId);
  const { t } = useQuizPresentation();
  const retry = useQuizRetry(JSON.stringify([courseId, quizId]), [quiz.refetch, attempts.refetch]);
  const error = quiz.error ?? attempts.error;
  return (
    <>
      {error ? <LoadError title={t('quizPresentation.loadQuiz')} error={error} onRetry={retry} /> : null}
      {quiz.data ? (
        <QuizBody
          quiz={quiz.data}
          attempts={attempts.data}
          courseId={courseId}
          resultsReady={!quiz.isError && !attempts.isError}
        />
      ) : !error ? (
        <DetailSkeleton />
      ) : null}
    </>
  );
}
