import { useKeepAwake } from 'expo-keep-awake';
import { router, Stack, usePreventRemove } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Cloud,
  CloudOff,
  Globe,
  KeyboardOff,
  LayoutGrid,
  Lock,
  TimerOff,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCanvas } from '@/canvas/session';
import { useTranslation } from '@/i18n';
import { attemptErrorDetail, useAttemptScreenOwner } from './attemptScreenOwner';

import { useQuiz } from '@/canvas/api/quizzes';
import {
  Button,
  Callout,
  Divider,
  EmptyState,
  haptics,
  Icon,
  IconButton,
  ProgressBar,
  Screen,
  Text,
  useTheme,
} from '@/design';
import { DetailSkeleton, LoadError } from '@/features/course/states';

import { answerState, isAnswerable, questionNumbers } from './answers';
import { QuestionNavigator } from './QuestionNavigator';
import { QuestionView } from './QuestionView';
import { QuizTimer } from './QuizTimer';
import { ReviewPanel } from './ReviewPanel';
import { openQuizOnWeb } from './TakeQuiz';
import { type SaveState, useQuizAttempt } from './useQuizAttempt';

/** How close to closing an untimed quiz shows its clock. */
const UNTIMED_CLOCK_SECONDS = 3600;

/**
 * Taking a classic quiz natively (QUIZ-2 to QUIZ-4): one question per page with
 * Previous and Next, a navigator showing answered and flagged questions, the
 * clock, a save indicator, and a review page that lists what's left before
 * submitting. The screen stays awake, and leaving asks first.
 */
type AttemptScreenProps = {
  courseId: string;
  quizId: string;
  submissionId: string;
};

/** Reset the engine mount on resource/client replacement, without locale/title remounts.
 * The engine additionally tags each committed load with explicit provenance.
 */
export function QuizAttemptScreen(props: AttemptScreenProps) {
  const { account, client } = useCanvas();
  const identity = JSON.stringify([account.id, props.courseId, props.quizId, props.submissionId]);
  const [boundary, setBoundary] = useState({ identity, client, generation: 0 });
  if (boundary.identity !== identity || boundary.client !== client) {
    setBoundary({ identity, client, generation: boundary.generation + 1 });
    return null;
  }
  return <AttemptBody key={boundary.generation} {...props} />;
}

function AttemptBody({ courseId, quizId, submissionId }: AttemptScreenProps) {
  useKeepAwake();
  const { t } = useTranslation();
  const quiz = useQuiz(courseId, quizId);
  const attempt = useQuizAttempt({
    courseId,
    quizId,
    submissionId,
    autoSubmit: !(quiz.data?.timerAutosubmitDisabled ?? false),
  });
  const { account, client } = useCanvas();
  const provenance = attempt.provenance;
  const engineCurrent = attempt.isCurrent() && provenance?.accountId === account.id &&
    provenance.client === client && provenance.courseId === courseId &&
    provenance.quizId === quizId && provenance.submissionId === submissionId &&
    provenance.attempt === (attempt.submission?.attempt ?? null);
  const status = engineCurrent ? attempt.status : { kind: 'loading' as const };
  const { answers, flags, position } = attempt;
  // Canvas reports time left until the quiz closes even without a time limit. A
  // weeks-long countdown is noise, so untimed quizzes show the clock only in
  // their last hour. Auto-submit still follows Canvas's deadline either way.
  const secondsLeft =
    attempt.secondsLeft !== null &&
    (quiz.data?.timeLimitMinutes || attempt.secondsLeft <= UNTIMED_CLOCK_SECONDS)
      ? attempt.secondsLeft
      : null;
  const questions = useMemo(() => engineCurrent ? attempt.questions : [], [engineCurrent, attempt.questions]);
  const { colors } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const controlsAttemptKey = JSON.stringify([courseId, quizId, submissionId, attempt.submission?.attempt, provenance?.generation]);
  const resource = useAttemptScreenOwner(controlsAttemptKey, {
    courseId,
    quizId,
    submissionId,
  });
  const [ui, setUi] = useState<{
    owner: typeof resource;
    mode: 'question' | 'review';
    navigatorOpen: boolean;
    leaving: boolean;
  }>({
    owner: resource,
    mode: 'question',
    navigatorOpen: false,
    leaving: false,
  });
  const { mode, navigatorOpen, leaving } =
    ui.owner === resource ? ui : { mode: 'question', navigatorOpen: false, leaving: false };
  const updateUi = (patch: Partial<Omit<typeof ui, 'owner'>>) => {
    if (!resource.read()) return;
    setUi((old) => ({
      ...(old.owner === resource
        ? old
        : {
            owner: resource,
            mode: 'question',
            navigatorOpen: false,
            leaving: false,
          }),
      ...patch,
    }));
  };
  const keyboard = useKeyboardShown(resource);

  const numbers = useMemo(() => questionNumbers(questions), [questions]);
  const total = useMemo(() => questions.filter(isAnswerable).length, [questions]);
  const answered = useMemo(
    () =>
      questions.filter((q) => isAnswerable(q) && answerState(q, answers[q.id] ?? q.answer) !== 'unanswered')
        .length,
    [questions, answers],
  );
  const open = status.kind === 'ready' || status.kind === 'submitting';
  const question = questions[position];

  // Raw presentation changes do not retire work. Policy and ordered membership do.
  const policy = JSON.stringify([
    quiz.data?.id,
    quiz.data?.locked,
    quiz.data?.oneQuestionAtATime,
    quiz.data?.cantGoBack,
    quiz.data?.requiresLockdownBrowser,
    quiz.data?.timerAutosubmitDisabled,
    questions.map((q) => [q.id, q.type]),
  ]);
  const work = useAttemptScreenOwner(
    JSON.stringify([policy, open]),
    { attempt, quiz: quiz.data, t, updateUi },
    resource,
  );
  const actions = useAttemptScreenOwner(
    JSON.stringify([status.kind, position, navigatorOpen, leaving, mode]),
    {
      attempt,
      quiz: quiz.data,
      t,
      updateUi,
      total,
      answered,
      questions,
      timed: (quiz.data?.timeLimitMinutes ?? 0) > 0,
      answerRevision: JSON.stringify(questions.map((q) => [q.id, answers[q.id] ?? q.answer])),
    },
    work,
  );
  const go = (index: number) => {
    const current = actions.read();
    if (!current || !open || leaving) return;
    current.updateUi({ navigatorOpen: false, mode: 'question' });
    current.attempt.setPosition(Math.max(0, Math.min(index, current.questions.length - 1)));
  };
  const showReview = () => {
    if (actions.read() && open && !leaving) updateUi({ navigatorOpen: false, mode: 'review' });
  };
  const openWeb = () => {
    const current = actions.read();
    if (current?.attempt.isCurrent() && current.quiz && !leaving) openQuizOnWeb(current.quiz, courseId, current.t('quizEntry.leave'));
  };
  // Each result uses its original route parameters, once even under effect replay.
  useEffect(() => {
    if (status.kind !== 'submitted' || !attempt.isCurrent() || !resource.complete()) return;
    haptics.success();
    router.replace({
      pathname: '/course/[courseId]/quiz/[quizId]/result',
      params: { courseId, quizId, submissionId },
    } as never);
  }, [status.kind, resource, courseId, quizId, submissionId, attempt]);

  const saveActions = useAttemptScreenOwner(attempt.saveState, { attempt, t }, actions);
  const save = () => {
    const current = saveActions.read();
    if (
      !current ||
      !open ||
      leaving ||
      (current.attempt.saveState !== 'error' && current.attempt.saveState !== 'offline')
    )
      return;
    const token = work.claim();
    if (!token) return;
    const error = current.attempt.saveError;
    if (error)
      Alert.alert(
        current.t('quizAttemptScreen.saveErrorTitle'),
        current.t('quizAttemptScreen.saveError', { error }),
      );
    void Promise.resolve()
      .then(() => {
        if (work.owns(token)) return current.attempt.flush();
      })
      .catch((error: unknown) => {
        if (work.owns(token))
          Alert.alert(
            current.t('quizAttemptScreen.saveErrorTitle'),
            current.t('quizAttemptScreen.saveError', {
              error: attemptErrorDetail(error),
            }),
          );
      })
      .finally(() => work.release(token));
  };
  usePreventRemove(open && !leaving, ({ repeat }) => {
    const current = actions.read();
    if (!current || !open || leaving) return;
    const token = work.claim(actions.lease());
    if (!token) return;
    const cancel = () => work.release(token);
    Alert.alert(
      current.t('quizAttemptScreen.leaveTitle'),
      current.t(current.timed ? 'quizAttemptScreen.leaveTimed' : 'quizAttemptScreen.leaveBody'),
      [
        {
          text: current.t('quizAttemptScreen.stay'),
          style: 'cancel',
          onPress: cancel,
        },
        {
          text: current.t('quizAttemptScreen.leave'),
          style: 'destructive',
          onPress: () => {
            if (!work.owns(token) || !current.attempt.isCurrent()) return;
            cancel(); // Single-use: repeated native responses cannot repeat navigation.
            if (!resource.complete()) return;
            // Preserve flush / set-leaving / repeat order; an entered flush cannot be undone.
            void current.attempt.flush().catch(() => {});
            current.updateUi({ leaving: true });
            repeat();
          },
        },
      ],
      { onDismiss: cancel },
    );
  });

  const submit = () => {
    const current = actions.read();
    if (!current || current.attempt.status.kind !== 'ready' || leaving) return;
    const token = work.claim(actions.lease());
    if (!token) return;
    const cancel = () => work.release(token);
    const missing = current.total - current.answered;
    Alert.alert(
      missing > 0
        ? current.t('quizAttemptScreen.submitMissing', { count: missing })
        : current.t('quizAttemptScreen.submitTitle'),
      current.t('quizAttemptScreen.submitBody'),
      [
        {
          text: current.t('quizAttemptScreen.keepWorking'),
          style: 'cancel',
          onPress: cancel,
        },
        {
          text: current.t('quizAttemptScreen.submit'),
          onPress: () => {
            if (!work.owns(token) || !current.attempt.isCurrent()) return;
            const latest = actions.read();
            cancel();
            if (!latest || latest.attempt.status.kind !== 'ready') return;
            // Edits remain intact. A changed answer snapshot needs a fresh, single-use summary.
            if (latest.answerRevision !== current.answerRevision) {
              submit();
              return;
            }
            const operation = work.claim();
            if (!operation) return;
            // Enter immediately; retain ownership through this submit's ready/submitting/ready cycle.
            void (async () => {
              try {
                await latest.attempt.submit();
              } catch (error) {
                if (work.owns(operation))
                  Alert.alert(
                    current.t('quizAttemptScreen.submitErrorTitle'),
                    current.t('quizAttemptScreen.submitError', {
                      error: attemptErrorDetail(error),
                    }),
                  );
              } finally {
                work.release(operation);
              }
            })();
          },
        },
      ],
      { onDismiss: cancel },
    );
  };

  // The title comes from the route's CourseScope.
  const headerOptions = {
    headerRight: () =>
      open && questions.length ? (
        <IconButton
          icon={LayoutGrid}
          accessibilityLabel={t('quizAttemptScreen.allQuestions')}
          iconColor={colors.accentFg}
          onPress={() => {
            if (actions.read() && open && !leaving) updateUi({ navigatorOpen: true });
          }}
        />
      ) : null,
  };

  let body;
  if (status.kind === 'loading' || (status.kind === 'submitted' && !questions.length)) {
    body = (
      <Screen>
        <DetailSkeleton />
      </Screen>
    );
  } else if (status.kind === 'error') {
    body = (
      <Screen>
        <LoadError
          title={t('quizAttemptScreen.loadError')}
          error={status.messageKey ? new Error(t(status.messageKey)) : status.error}
          onRetry={() => {
            const current = actions.read();
            if (current && status.kind === 'error') {
              const token = work.claim(actions.lease());
              if (token) {
                void (async () => {
                  try {
                    await current.attempt.retry();
                  } catch (error) {
                    if (work.owns(token))
                      Alert.alert(current.t('quizAttemptScreen.loadError'), attemptErrorDetail(error));
                  } finally {
                    work.release(token);
                  }
                })();
              }
            }
          }}
        />
      </Screen>
    );
  } else if (status.kind === 'web') {
    body = (
      <Screen contentClassName="gap-4">
        <Callout tone="info" icon={Globe} title={t('quizAttemptScreen.webTitle')}>
          {t('quizAttemptScreen.webBody')}
        </Callout>
        {quiz.data ? <Button onPress={openWeb}>{t('quizInputs.webOpen')}</Button> : null}
      </Screen>
    );
  } else if (status.kind === 'ended') {
    body = (
      <Screen>
        <EmptyState
          icon={Lock}
          title={t('quizAttemptScreen.closed')}
          description={t(status.messageKey)}
          action={{
            label: t('quizAttemptScreen.back'),
            onPress: () => {
              if (actions.read()?.attempt.isCurrent() && resource.complete()) router.back();
            },
          }}
        />
      </Screen>
    );
  } else if (!question) {
    body = (
      <Screen>
        <EmptyState
          icon={CircleAlert}
          title={t('quizAttemptScreen.empty')}
          description={t('quizAttemptScreen.emptyHelp')}
        />
      </Screen>
    );
  } else {
    body = (
      <Screen
        // A new page starts at its top.
        key={`${controlsAttemptKey}-${mode}-${position}`}
        contentClassName="gap-6"
        keyboardShouldPersistTaps="handled"
      >
        {mode === 'review' ? (
          <ReviewPanel
            attemptKey={controlsAttemptKey}
            questions={questions}
            answers={answers}
            flags={flags}
            numbers={numbers}
            onGo={go}
          />
        ) : (
          <QuestionView
            attemptKey={controlsAttemptKey}
            key={question.id}
            question={question}
            answer={answers[question.id] ?? question.answer}
            flagged={!!flags[question.id]}
            number={numbers.get(question.id) ?? null}
            total={total}
            courseId={courseId}
            quizId={quizId}
            disabled={status.kind !== 'ready'}
            onChange={(a) => {
              const current = actions.read();
              if (current?.attempt.status.kind === 'ready' && !leaving)
                current.attempt.setAnswer(question.id, a);
            }}
            onToggleFlag={() => {
              const current = actions.read();
              if (current?.attempt.status.kind === 'ready' && !leaving)
                current.attempt.toggleFlag(question.id);
            }}
            onOpenWeb={openWeb}
          />
        )}
      </Screen>
    );
  }

  const last = position >= questions.length - 1;
  return (
    // The bottom bar rides above the keyboard, so Previous and Next stay in reach while typing.
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-bg"
      style={{ paddingTop: Platform.OS === 'ios' ? headerHeight : 0 }}
    >
      <Stack.Screen options={headerOptions} />
      {open && questions.length ? (
        <View className="gap-2 bg-bg px-4 pb-3 pt-2">
          <View className="flex-row items-center gap-3">
            {secondsLeft !== null ? (
              <QuizTimer attemptKey={controlsAttemptKey} seconds={secondsLeft} />
            ) : null}
            <Text variant="subhead" tone="muted" className="flex-1" tabular numberOfLines={1}>
              {t('quizAttemptScreen.answered', { answered, total })}
            </Text>
            <SaveIndicator state={attempt.saveState} error={attempt.saveError} onRetry={save} />
          </View>
          <ProgressBar
            value={total ? answered / total : 0}
            size="sm"
            accessibilityLabel={t('quizAttemptScreen.progress')}
          />
          {attempt.expired ? (
            <TimeUp waiting={attempt.waitingToSubmit} autoSubmit={!quiz.data?.timerAutosubmitDisabled} />
          ) : null}
        </View>
      ) : null}
      {open && questions.length ? <Divider /> : null}
      <View className="flex-1">{body}</View>
      {open && question ? (
        <View className="bg-bg">
          <Divider />
          <View
            className="flex-row items-center gap-3 px-4 pt-3"
            style={{
              paddingBottom: keyboard ? 12 : Math.max(insets.bottom, 12),
            }}
          >
            {mode === 'review' ? (
              <>
                <Button
                  variant="secondary"
                  size="lg"
                  className="flex-1"
                  onPress={() => {
                    if (actions.read() && !leaving) updateUi({ mode: 'question' });
                  }}
                >
                  {t('quizAttemptScreen.keepWorking')}
                </Button>
                <Button size="lg" className="flex-1" loading={status.kind === 'submitting'} onPress={submit}>
                  {t('quizAttemptScreen.submitQuiz')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="lg"
                  className="flex-1"
                  leadingIcon={ChevronLeft}
                  disabled={position === 0}
                  accessibilityLabel={t('quizAttemptScreen.previousQuestion')}
                  onPress={() => {
                    if (position !== 0) go(position - 1);
                  }}
                >
                  {t('quizAttemptScreen.previous')}
                </Button>
                <Button
                  size="lg"
                  className="flex-1"
                  trailingIcon={last ? undefined : ChevronRight}
                  accessibilityLabel={
                    last ? t('quizAttemptScreen.reviewAnswers') : t('quizAttemptScreen.nextQuestion')
                  }
                  onPress={() => (last ? showReview() : go(position + 1))}
                >
                  {last ? t('quizAttemptScreen.review') : t('quizAttemptScreen.next')}
                </Button>
              </>
            )}
            {keyboard ? (
              <IconButton
                icon={KeyboardOff}
                variant="secondary"
                size="lg"
                accessibilityLabel={t('quizAttemptScreen.hideKeyboard')}
                onPress={() => {
                  if (actions.read() && !leaving) Keyboard.dismiss();
                }}
              />
            ) : null}
          </View>
        </View>
      ) : null}
      <QuestionNavigator
        attemptKey={controlsAttemptKey}
        visible={navigatorOpen}
        onClose={() => {
          if (actions.read()) updateUi({ navigatorOpen: false });
        }}
        questions={questions}
        answers={answers}
        flags={flags}
        numbers={numbers}
        current={mode === 'review' ? -1 : position}
        onGo={go}
        onReview={showReview}
      />
    </KeyboardAvoidingView>
  );
}

function SaveIndicator({
  state,
  error,
  onRetry,
}: {
  state: SaveState;
  error: string | null;
  onRetry: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const label =
    state === 'saved'
      ? t('quizAttemptScreen.saved')
      : state === 'saving'
        ? t('quizAttemptScreen.saving')
        : state === 'offline'
          ? t('quizAttemptScreen.offlineSaved')
          : t('quizAttemptScreen.notSaved');
  const content = (
    <View className="flex-row items-center gap-1.5">
      {state === 'saving' ? (
        <ActivityIndicator size="small" color={colors.fgMuted} />
      ) : (
        <Icon
          icon={state === 'saved' ? Cloud : state === 'offline' ? CloudOff : CircleAlert}
          size={16}
          tone={state === 'error' ? 'danger' : state === 'offline' ? 'warning' : 'muted'}
        />
      )}
      <Text
        variant="footnote"
        tone={state === 'error' ? 'danger' : state === 'offline' ? 'warning' : 'muted'}
        numberOfLines={1}
      >
        {state === 'offline' ? t('quizAttemptScreen.offline') : label}
      </Text>
    </View>
  );
  if (state === 'error' || state === 'offline')
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('quizAttemptScreen.saveRetry', { label })}
        accessibilityHint={error ?? undefined}
        accessibilityLiveRegion="polite"
        hitSlop={10}
        onPress={() => {
          onRetry();
        }}
        className="min-h-11 justify-center"
      >
        {content}
      </Pressable>
    );
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      className="min-h-11 justify-center"
    >
      {content}
    </View>
  );
}

function TimeUp({ waiting, autoSubmit }: { waiting: boolean; autoSubmit: boolean }) {
  const { t } = useTranslation();
  return (
    <Callout tone={autoSubmit ? 'warning' : 'danger'} icon={TimerOff} title={t('quizAttemptScreen.timeUp')}>
      {!autoSubmit
        ? t('quizAttemptScreen.timeManual')
        : waiting
          ? t('quizAttemptScreen.timeWaiting')
          : t('quizAttemptScreen.timeSubmitting')}
    </Callout>
  );
}

/** Whether the software keyboard is up. */
function useKeyboardShown(owner: ReturnType<typeof useAttemptScreenOwner>) {
  const [state, setState] = useState({ owner, shown: false });
  useEffect(() => {
    const setShown = (shown: boolean) => setState({ owner, shown });
    let active = true;
    const valid = owner.lease();
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => active && valid() && setShown(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => active && valid() && setShown(false),
    );
    return () => {
      active = false;
      show.remove();
      hide.remove();
    };
  }, [owner]);
  return state.owner === owner && state.shown;
}
