import { router } from 'expo-router';
import { CircleCheck, Hourglass, ListChecks } from 'lucide-react-native';
import { View } from 'react-native';

import { useQuiz, useQuizSubmission } from '@/canvas/api/quizzes';
import { Button, Callout, Card, Icon, ProgressRing, Text } from '@/design';
import { type Fact, FactList } from '@/features/course/FactList';
import { DetailSkeleton, LoadError } from '@/features/course/states';

import { attemptResultsRoute, isSurvey, useQuizRestricted } from './QuizHistory';

import { scoredQuiz, useQuizOwner, useQuizPresentation, useQuizRetry } from './quizPresentation';

/** After submitting (QUIZ-2): the score Canvas gave, what's left to grade, and what's next. */
export function QuizResult({
  courseId,
  quizId,
  submissionId,
}: {
  courseId: string;
  quizId: string;
  submissionId: string;
}) {
  const quiz = useQuiz(courseId, quizId);
  const result = useQuizSubmission(courseId, quizId, submissionId);
  // Restricted quantitative data shows letters, never points or percentages.
  const restricted = useQuizRestricted(courseId, quiz.data);
  const p = useQuizPresentation();
  const { t } = p;
  const key = JSON.stringify([courseId, quizId, submissionId]);
  const owner = useQuizOwner(key, {
    quiz: quiz.data,
    submission: result.data,
    eligible: !quiz.isError && !!quiz.data,
  });
  const retry = useQuizRetry(key, [quiz.refetch, result.refetch]);
  const error = quiz.error ?? result.error;
  if (!result.data || !quiz.data) {
    if (error) return <LoadError title={t('quizPresentation.loadResult')} error={error} onRetry={retry} />;
    if (result.isPending || quiz.isPending) return <DetailSkeleton />;
    return (
      <Callout title={t('quizPresentation.loadResult')} action={{ label: t('common.retry'), onPress: retry }}>
        {t('quizPresentation.unavailable')}
      </Callout>
    );
  }

  const s = result.data;
  const q = quiz.data;
  const survey = isSurvey(q);
  const pending = s.workflowState === 'pending_review';
  const points = s.pointsPossible ?? q?.points ?? null;
  const fraction =
    s.score !== null && points && restricted === false && scoredQuiz(q) && !quiz.isError
      ? Math.max(0, Math.min(1, s.score / points))
      : null;
  const score = !scoredQuiz(q) || quiz.isError ? null : p.score(s.score, points, restricted);
  const percent = fraction !== null ? p.percent(fraction) : null;
  const multiple = q ? q.allowedAttempts === null || q.allowedAttempts > 1 : false;

  const facts: (Fact | null)[] = [
    { label: t('quizPresentation.attemptFact'), value: p.number(s.attempt) },
    s.finishedAt ? { label: t('quizPresentation.submitted'), value: p.date(s.finishedAt) } : null,
    s.timeSpent ? { label: t('quizPresentation.time'), value: p.duration(s.timeSpent) } : null,
    multiple && s.keptScore !== null && scoredQuiz(q) && !quiz.isError && restricted !== undefined
      ? { label: t('quizPresentation.kept'), value: p.score(s.keptScore, points, restricted) ?? '' }
      : null,
    s.attemptsLeft !== null
      ? { label: t('quizPresentation.attemptsLeft'), value: p.number(s.attemptsLeft) }
      : null,
  ];

  const heading = survey
    ? t('quizPresentation.thanks')
    : pending || !scoredQuiz(q) || quiz.isError
      ? t('quizPresentation.submitted')
      : t('quizPresentation.yourScore');
  return (
    <View className="gap-6">
      {error ? <LoadError title={t('quizPresentation.loadResult')} error={error} onRetry={retry} /> : null}
      <Card
        className="items-center gap-4 py-6"
        accessibilityLabel={[heading, score, percent].filter(Boolean).join(', ')}
      >
        {survey ? (
          <CircleCheckBadge />
        ) : fraction !== null ? (
          <ProgressRing value={fraction} size={112} thickness={9} tone={pending ? 'info' : 'accent'}>
            <Text variant="title2" tabular>
              {percent}
            </Text>
          </ProgressRing>
        ) : (
          <CircleCheckBadge />
        )}
        <View className="items-center gap-1">
          <Text variant="title2" accessibilityRole="header" align="center">
            {heading}
          </Text>
          {!survey && score ? (
            <Text variant="body" tone="muted" tabular align="center">
              {pending
                ? t('quizPresentation.soFar', { score })
                : restricted
                  ? t('quizPresentation.grade', { score })
                  : t('quizPresentation.scorePoints', { score })}
            </Text>
          ) : null}
        </View>
      </Card>

      {pending && scoredQuiz(q) && !quiz.isError ? (
        <Callout tone="info" icon={Hourglass} title={t('quizPresentation.grading')}>
          {t('quizPresentation.gradingHelp')}
        </Callout>
      ) : null}

      <FactList facts={facts} />

      <View className="gap-3">
        <Button
          size="lg"
          onPress={() => {
            if (
              owner.active &&
              owner.current?.submission?.id === s.id &&
              owner.current.submission.attempt === s.attempt
            )
              router.back();
          }}
        >
          {t('quizPresentation.back')}
        </Button>
        {!scoredQuiz(q) || quiz.isError ? null : (
          <Button
            variant="ghost"
            leadingIcon={ListChecks}
            accessibilityHint={t('quizPresentation.resultsHint')}
            onPress={() => {
              const current = owner.current;
              if (
                owner.active &&
                current?.eligible &&
                !!current.quiz &&
                scoredQuiz(current.quiz) &&
                current.submission?.id === s.id &&
                current.submission.attempt === s.attempt
              )
                router.push(attemptResultsRoute(courseId, quizId, s.attempt) as never);
            }}
          >
            {t('quizPresentation.seeResults')}
          </Button>
        )}
      </View>
    </View>
  );
}

function CircleCheckBadge() {
  return (
    <View className="h-20 w-20 items-center justify-center rounded-full bg-success-soft">
      <Icon icon={CircleCheck} size={40} tone="success" />
    </View>
  );
}
