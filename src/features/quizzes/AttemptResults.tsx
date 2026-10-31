import {
  Circle,
  CircleCheck,
  CircleDot,
  CircleX,
  EyeOff,
  Globe,
  Hourglass,
  type LucideIcon,
} from 'lucide-react-native';
import { View } from 'react-native';

import {
  type AttemptQuestion,
  attemptHistoryUrl,
  type Quiz,
  type QuestionOutcome,
  type QuizSubmission,
  resultsVisible,
  showsCorrectAnswers,
  useAttemptQuestions,
  useQuiz,
  useQuizHistory,
} from '@/canvas/api/quizzes';
import { useCourse } from '@/canvas/api/courses';
import { useAssignment } from '@/canvas/api/assignments';
import { useCanvas } from '@/canvas/session';
import {
  Button,
  Callout,
  Card,
  Icon,
  type IconTone,
  ListGroup,
  ListItem,
  ProgressRing,
  Section,
  Text,
} from '@/design';
import { type Fact, FactList } from '@/features/course/FactList';
import { DetailSkeleton, ListSkeleton, LoadError } from '@/features/course/states';
import { scoredQuiz, useQuizPresentation, type QuizPresentation } from './quizPresentation';
import { useAttemptActions } from './quizAttemptResults';

import { isSurvey } from './QuizHistory';

const outcomes: Record<
  QuestionOutcome,
  { icon: LucideIcon; tone: IconTone; label: `quizAttemptResults.${QuestionOutcome}` }
> = {
  correct: { icon: CircleCheck, tone: 'success', label: 'quizAttemptResults.correct' },
  incorrect: { icon: CircleX, tone: 'danger', label: 'quizAttemptResults.incorrect' },
  partial: { icon: CircleDot, tone: 'warning', label: 'quizAttemptResults.partial' },
  pending: { icon: Hourglass, tone: 'muted', label: 'quizAttemptResults.pending' },
};

/** Why the quiz keeps right and wrong answers from the student, in plain words. */
function hiddenReason(
  quiz: Quiz,
  attempt: QuizSubmission,
  attemptsLeft: number | null,
  p: QuizPresentation,
  now = new Date(),
) {
  const { results } = quiz;
  if (!resultsVisible(quiz, attempt))
    return results.hide === 'until_after_last_attempt'
      ? p.t('quizAttemptResults.afterLast')
      : results.oneTimeResults
        ? p.t('quizAttemptResults.once')
        : p.t('quizAttemptResults.noResults');
  if (!results.showCorrectAnswers) return p.t('quizAttemptResults.noCorrect');
  if (results.showCorrectAnswersLastAttempt && attemptsLeft !== 0)
    return p.t('quizAttemptResults.correctLast');
  if (results.hideCorrectAnswersAt && now > results.hideCorrectAnswersAt)
    return p.t('quizAttemptResults.correctStopped', { date: p.date(results.hideCorrectAnswersAt, now) });
  if (results.showCorrectAnswersAt && now <= results.showCorrectAnswersAt)
    return p.t('quizAttemptResults.correctAfter', { date: p.date(results.showCorrectAnswersAt, now) });
  return p.t('quizAttemptResults.noCorrect');
}

function tally(questions: AttemptQuestion[], p: QuizPresentation): string {
  const count = (o: QuestionOutcome) => questions.filter((q) => q.outcome === o).length;
  return [
    count('correct') ? p.t('quizAttemptResults.tallyCorrect', { count: count('correct') }) : null,
    count('incorrect') ? p.t('quizAttemptResults.tallyIncorrect', { count: count('incorrect') }) : null,
    count('partial') ? p.t('quizAttemptResults.tallyPartial', { count: count('partial') }) : null,
    count('pending') ? p.t('quizAttemptResults.tallyPending', { count: count('pending') }) : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function QuestionResults({
  courseId,
  quiz,
  attempt,
  numeric,
  policyKey,
}: {
  courseId: string;
  quiz: Quiz;
  attempt: QuizSubmission;
  numeric: boolean;
  policyKey: string;
}) {
  const questions = useAttemptQuestions(courseId, quiz.id, attempt.id, attempt.attempt);
  const p = useQuizPresentation();
  const { t } = p;
  const { retry } = useAttemptActions(
    JSON.stringify([policyKey, questions.isError, questions.isPending, questions.data?.status]),
    null,
    questions.refetch,
  );
  if (questions.isPending) return <ListSkeleton rows={4} />;
  if (questions.isError)
    return (
      <LoadError title={t('quizAttemptResults.loadQuestions')} error={questions.error} onRetry={retry} />
    );
  const data = questions.data;
  if (!data)
    return (
      <Callout
        title={t('quizAttemptResults.loadQuestions')}
        action={{ label: t('common.retry'), onPress: retry }}
      >
        {t('quizPresentation.unavailable')}
      </Callout>
    );
  if (data.status === 'hidden')
    return (
      <Callout tone="info" icon={EyeOff} title={t('quizAttemptResults.hidden')}>
        {t('quizAttemptResults.hiddenHelp')}
      </Callout>
    );
  if (data.status === 'unavailable')
    return (
      <Callout tone="info" title={t('quizAttemptResults.onCanvas')}>
        {t('quizAttemptResults.oneQuestion')}
      </Callout>
    );
  if (!data.questions.length)
    return (
      <Text variant="subhead" tone="muted" className="px-1">
        {t('quizAttemptResults.empty')}
      </Text>
    );
  return (
    <View className="gap-3">
      <Text variant="subhead" tone="muted" className="px-1" accessibilityRole="summary">
        {tally(data.questions, p)}
      </Text>
      <ListGroup>
        {data.questions.map((q) => {
          const outcome = q.outcome ? outcomes[q.outcome] : null;
          const points = numeric ? p.points(q.points) : null;
          const name =
            q.generatedNameOrdinal !== undefined
              ? t('quizAttemptResults.question', { count: q.generatedNameOrdinal })
              : q.name;
          return (
            <ListItem
              key={q.id}
              leading={
                outcome ? (
                  <Icon icon={outcome.icon} size={22} tone={outcome.tone} />
                ) : (
                  <Icon icon={Circle} size={22} tone="subtle" />
                )
              }
              title={name}
              subtitle={q.text || undefined}
              subtitleLines={2}
              value={points ?? undefined}
              accessibilityLabel={[
                name,
                outcome ? t(outcome.label) : t('quizAttemptResults.notGraded'),
                points,
                q.text,
              ]
                .filter(Boolean)
                .join(', ')}
            />
          );
        })}
      </ListGroup>
    </View>
  );
}

/** One attempt's score and which questions were right, when the quiz allows it (QUIZ-9). */
export function AttemptResults({
  courseId,
  quizId,
  attempt: number,
}: {
  courseId: string;
  quizId: string;
  attempt: number;
}) {
  const { account } = useCanvas();
  const quiz = useQuiz(courseId, quizId);
  const history = useQuizHistory(courseId, quizId);
  const course = useCourse(courseId);
  const assignment = useAssignment(courseId, quiz.data?.assignmentId);
  const p = useQuizPresentation();
  const { t } = p;
  const q = quiz.data;
  const attempt = history.data?.find((s) => s.attempt === number);
  const permissionError = course.error ?? (q?.assignmentId ? assignment.error : null);
  const error = quiz.error ?? history.error ?? permissionError;
  const ready = !!q && !!attempt && !quiz.isError && !history.isError;
  const permissionsReady =
    !!course.data &&
    !course.isPending &&
    !course.isError &&
    (!q?.assignmentId || (!!assignment.data && !assignment.isPending && !assignment.isError));
  const restricted = course.data?.restricted || (q?.assignmentId ? assignment.data?.restricted : false);
  const gradePolicy = ready && permissionsReady && scoredQuiz(q) ? !!restricted : undefined;
  const numeric = gradePolicy === false;
  const attemptsLeft = history.data?.[0]?.attemptsLeft ?? null;
  const visible = !!q && !!attempt && resultsVisible(q, attempt);
  const webUrl =
    q && attempt
      ? (attempt.resultUrl ??
        attemptHistoryUrl(account.baseUrl, courseId, quizId, attempt.id, attempt.attempt))
      : null;
  // Dates/flags are policy, whereas a raw title or viewing locale is presentation.
  const policyKey = JSON.stringify([
    courseId,
    quizId,
    number,
    q?.id,
    attempt?.id,
    q?.type,
    q?.assignmentId,
    q?.allowedAttempts,
    q?.results,
    q?.oneQuestionAtATime,
    attempt?.attempt,
    attempt?.workflowState,
    attempt?.hasSeenResults,
    attemptsLeft,
    webUrl,
    quiz.isError,
    history.isError,
    quiz.isPending,
    history.isPending,
    course.isError,
    course.isPending,
    assignment.isError,
    assignment.isPending,
    permissionsReady,
    gradePolicy,
  ]);
  const { retry, open } = useAttemptActions(
    policyKey,
    ready && permissionsReady && visible && !q.results.lockdownOnly && webUrl !== null
      ? {
          url: webUrl,
          title: t('quizAttemptResults.webTitle', { title: q.title, count: attempt.attempt }),
          courseId,
        }
      : null,
    quiz.refetch,
    history.refetch,
    course.refetch,
    q?.assignmentId ? assignment.refetch : undefined,
  );

  if (!q || !history.data) {
    if (error) return <LoadError title={t('quizAttemptResults.loadAttempt')} error={error} onRetry={retry} />;
    if (quiz.isPending || history.isPending) return <DetailSkeleton />;
    return (
      <Callout
        title={t('quizAttemptResults.loadAttempt')}
        action={{ label: t('common.retry'), onPress: retry }}
      >
        {t('quizPresentation.unavailable')}
      </Callout>
    );
  }
  if (!attempt)
    return (
      <LoadError
        title={t('quizAttemptResults.missing')}
        error={new Error(t('quizAttemptResults.missingHelp'))}
        onRetry={retry}
      />
    );

  const survey = isSurvey(q);
  const pending = attempt.workflowState === 'pending_review';
  const points = attempt.pointsPossible ?? q.points;
  const score = p.score(attempt.score, points, gradePolicy);
  const fraction =
    numeric && attempt.score !== null && points ? Math.max(0, Math.min(1, attempt.score / points)) : null;
  const percent = fraction !== null ? p.percent(fraction) : null;
  const showCorrect = !survey && showsCorrectAnswers(q, attempt, attemptsLeft);

  const facts: (Fact | null)[] = [
    attempt.finishedAt ? { label: t('quizPresentation.submitted'), value: p.date(attempt.finishedAt) } : null,
    attempt.timeSpent ? { label: t('quizPresentation.time'), value: p.duration(attempt.timeSpent) } : null,
    numeric && points !== null
      ? { label: t('quizAttemptResults.pointsPossible'), value: p.points(points) ?? '' }
      : null,
  ];

  return (
    <>
      {error ? <LoadError title={t('quizAttemptResults.loadAttempt')} error={error} onRetry={retry} /> : null}
      <Card
        className="items-center gap-4 py-6"
        accessibilityLabel={[
          t('quizPresentation.attempt', { count: attempt.attempt }),
          score,
          percent,
          pending ? t('quizPresentation.needsGrading') : null,
        ]
          .filter(Boolean)
          .join(', ')}
      >
        {fraction !== null ? (
          <ProgressRing value={fraction} size={112} thickness={9} tone={pending ? 'info' : 'accent'}>
            <Text variant="title2" tabular>
              {percent}
            </Text>
          </ProgressRing>
        ) : null}
        <View className="items-center gap-1">
          <Text variant="title2" accessibilityRole="header" align="center">
            {t('quizPresentation.attempt', { count: attempt.attempt })}
          </Text>
          <Text variant="body" tone="muted" tabular align="center">
            {survey
              ? t('quizAttemptResults.surveySubmitted')
              : score
                ? pending
                  ? t('quizPresentation.soFar', { score })
                  : restricted
                    ? t('quizPresentation.grade', { score })
                    : t('quizPresentation.scorePoints', { score })
                : t('quizPresentation.submitted')}
          </Text>
        </View>
      </Card>

      {pending && scoredQuiz(q) ? (
        <Callout tone="info" icon={Hourglass} title={t('quizPresentation.grading')}>
          {t('quizPresentation.gradingHelp')}
        </Callout>
      ) : null}

      <FactList facts={facts} />

      {survey ? null : (
        <Section title={t('quizPresentation.questions')}>
          {!ready ? (
            <Callout tone="info">{t('quizAttemptResults.policyUnavailable')}</Callout>
          ) : q.results.lockdownOnly ? (
            <Callout tone="info" icon={EyeOff} title={t('quizAttemptResults.lockdown')}>
              {t('quizAttemptResults.lockdownHelp')}
            </Callout>
          ) : q.oneQuestionAtATime ? (
            <Callout tone="info" title={t('quizAttemptResults.onCanvas')}>
              {t('quizAttemptResults.oneQuestion')}
            </Callout>
          ) : showCorrect ? (
            <QuestionResults
              courseId={courseId}
              quiz={q}
              attempt={attempt}
              numeric={numeric}
              policyKey={policyKey}
            />
          ) : (
            <Callout tone="info" icon={EyeOff} title={t('quizAttemptResults.answersHidden')}>
              {hiddenReason(q, attempt, attemptsLeft, p)}
            </Callout>
          )}
        </Section>
      )}

      {ready && permissionsReady && visible && !q.results.lockdownOnly ? (
        <View className="gap-2">
          <Button variant="secondary" leadingIcon={Globe} onPress={open}>
            {t('quizAttemptResults.web')}
          </Button>
          <Text variant="footnote" tone="muted" align="center">
            {t('quizAttemptResults.webHelp')}
          </Text>
        </View>
      ) : null}
    </>
  );
}
