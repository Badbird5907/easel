import { router } from 'expo-router';
import { Globe, History, ShieldAlert, Wifi } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import {
  fetchQuizSubmissions,
  type Quiz,
  type QuizAttempts,
  QuizRefusedError,
  startQuizSubmission,
} from '@/canvas/api/quizzes';
import { CanvasNetworkError } from '@/canvas/client';
import { useCanvas } from '@/canvas/session';
import { Button, Callout, Text } from '@/design';
import type { Translate } from '@/i18n';
import { openWebView, QUIZ_LEAVE_GUARD } from '@/features/web/open';

import { AccessCodePrompt } from './AccessCodePrompt';
import { openLockdownBrowser } from './lockdown';
import { historyRoute } from './QuizHistory';
import { useQuizPresentation } from './quizPresentation';
import { useEntryOwner } from './quizEntry';
import { loadAccessCode, saveAccessCode, quizStorageOwner } from './storage';

/** How a quiz is taken in Easel: natively, on Canvas's quiz page, or only in LockDown Browser. */
export type QuizMode = 'native' | 'web' | 'lockdown';

/**
 * Natively whenever the API allows (QUIZ-2). Canvas's API refuses
 * one-question-at-a-time quizzes (and can't-go-back ones), so those take the
 * web fallback (QUIZ-6). LockDown quizzes need Respondus's app (QUIZ-7).
 */
export function quizMode(quiz: Quiz): QuizMode {
  if (quiz.requiresLockdownBrowser) return 'lockdown';
  if (quiz.oneQuestionAtATime || quiz.cantGoBack) return 'web';
  return 'native';
}

/** Opens the quiz on Canvas's own page inside Easel, guarded against leaving (QUIZ-6). */
export function openQuizOnWeb(quiz: Quiz, courseId: string, guard = QUIZ_LEAVE_GUARD) {
  openWebView({ url: quiz.mobileUrl ?? quiz.htmlUrl, title: quiz.title, guard, courseId });
}

export function attemptRoute(courseId: string, quizId: string, submissionId: string) {
  return {
    pathname: '/course/[courseId]/quiz/[quizId]/take',
    params: { courseId, quizId, submissionId },
  } as const;
}

type Refusal = { title: string; body: string; icon: typeof Wifi; tone: 'warning' | 'danger' };

function refusalFor(error: unknown, t: Translate): Refusal | null {
  if (error instanceof QuizRefusedError) {
    switch (error.reason) {
      case 'lockdown':
        return { title: t('quizEntry.lockdownTitle'), body: t('quizEntry.lockdownBody'), icon: ShieldAlert, tone: 'warning' };
      case 'ip_filter':
        return {
          title: t('quizEntry.networkTitle'),
          // Show Canvas's own words plainly (QUIZ-5).
          body: t('quizEntry.ipBody', { message: error.serverMessage }),
          icon: Wifi,
          tone: 'warning',
        };
      case 'locked':
        return {
          title: t('quizEntry.lockedTitle'),
          body: t('quizEntry.lockedBody'),
          icon: ShieldAlert,
          tone: 'warning',
        };
      case 'exists':
        return {
          title: t('quizEntry.existsTitle'),
          body: t('quizEntry.existsBody'),
          icon: ShieldAlert,
          tone: 'warning',
        };
      default:
        return {
          title: t('quizEntry.failed'),
          body: error.serverMessage,
          icon: ShieldAlert,
          tone: 'danger',
        };
    }
  }
  if (error instanceof CanvasNetworkError)
    return {
      title: t('quizEntry.failed'),
      body: t('quizEntry.networkBody'),
      icon: Wifi,
      tone: 'danger',
    };
  return error instanceof Error
    ? { title: t('quizEntry.failed'), body: error.message, icon: ShieldAlert, tone: 'danger' }
    : null;
}

/**
 * "Take quiz" on a quiz's details (QUIZ-1 to QUIZ-7): resumes an attempt in
 * progress, asks for the access code, starts the attempt, and explains IP
 * filters and LockDown Browser in plain words.
 */
export function TakeQuiz({
  quiz,
  attempts,
  courseId,
  attemptsLeft,
}: {
  quiz: Quiz;
  attempts: QuizAttempts | undefined;
  courseId: string;
  attemptsLeft: number | null;
}) {
  const { client, account } = useCanvas();
  const { t, minutes } = useQuizPresentation();
  const [state, setState] = useState<{
    owner: object; busy: boolean;
    asking: object | null; codeError: boolean; error: unknown
  } | null>(null);
  const mode = quizMode(quiz);
  // Policy identities revoke on transitions, including away-and-back. Counts are
  // checked separately so our own successful start/cache update can still finish.
  const owner = useEntryOwner(JSON.stringify([account.id, courseId, quiz.id,
    mode, quiz.locked, quiz.requiresAccessCode]), client, { quiz, attempts, attemptsLeft, t, prompt: state?.asking, stateOwner: state?.owner });
  const entry = useEntryOwner(String(attemptsLeft !== 0 || !!attempts?.inProgress), owner, null);
  const historyOwner = useEntryOwner('history', owner, null);
  const view = state?.owner === owner ? state : null;
  const busy = view?.busy ?? false;
  const asking = view?.asking ?? null;
  const refusal = refusalFor(view?.error, t);
  const codeError = view?.codeError ? t('quizEntry.wrongCode') : null;
  const update = (patch: Partial<NonNullable<typeof state>>) => {
    if (owner.active) setState(previous => ({
      busy: false, asking: null,
      codeError: false, error: null, ...(previous?.owner === owner ? previous : {}), ...patch, owner
    }));
  };
  const eligible = () => entry.active && owner.active && !owner.current!.quiz.locked &&
    (owner.current!.attemptsLeft !== 0 || !!owner.current!.attempts?.inProgress);
  const web = () => openQuizOnWeb(owner.current!.quiz, courseId, owner.current!.t('quizEntry.leave'));
  const start = async (code?: string) => {
    if (!eligible() || mode !== 'native') return;
    if (code === undefined && owner.current!.stateOwner === owner && owner.current!.prompt) return;
    const claim = owner.acquire();
    if (!claim) return;
    const valid = () => owner.owns(claim);
    const storageOwner = quizStorageOwner(account.id, client, valid);
    update({ busy: true, error: null });
    try {
      const current = (await fetchQuizSubmissions(client, courseId, quiz.id)).find(s => s.inProgress);
      if (!valid() || !eligible()) return;
      if (current) {
        update({ asking: null });
        router.push(attemptRoute(courseId, quiz.id, current.id) as never);
        return;
      }
      const saved = code ?? (await loadAccessCode(account.id, quiz.id, storageOwner)) ?? undefined;
      if (!valid() || !eligible()) return;
      if (quiz.requiresAccessCode && !saved) {
        update({ codeError: false, asking: asking ?? {} });
        return;
      }
      const submission = await startQuizSubmission(client, courseId, quiz.id, saved);
      if (!valid()) return;
      // Storage rechecks this original claim at queued entry and drains entered writes before cleanup.
      if (quiz.requiresAccessCode && saved) await saveAccessCode(account.id, quiz.id, saved, storageOwner);
      if (!valid()) return;
      update({ asking: null });
      router.push(attemptRoute(courseId, quiz.id, submission.id) as never);
    } catch (error) {
      if (!valid() || !eligible()) return;
      if (error instanceof QuizRefusedError) {
        if (error.reason === 'access_code') {
          try { await saveAccessCode(account.id, quiz.id, null, storageOwner); }
          catch (storageError) {
            if (valid() && eligible()) update({ asking: null, error: storageError });
            return;
          }
          if (!valid() || !eligible()) return;
          update({ codeError: !!code, asking: asking ?? {} });
          return;
        }
        if (error.reason === 'unsupported' || error.reason === 'one_at_a_time') {
          web();
          return;
        }
      }
      update({ asking: null, error });
    } finally {
      if (valid()) {
        update({ busy: false });
        owner.release(claim);
      }
    }
  };
  const launch = (kind: 'web' | 'lockdown') => {
    if (!eligible()) return;
    // External launches retire with eligibility; native starts retain their
    // resource claim through the attempt-count update from their own success.
    const claim = entry.acquire();
    if (!claim) return;
    if (kind === 'web') {
      web();
      void Promise.resolve().then(() => entry.release(claim));
    }
    else void openLockdownBrowser(owner.current!.quiz.htmlUrl, {
      t: owner.current!.t, valid: () => entry.owns(claim) && eligible(),
      finished: () => entry.release(claim),
    });
  };
  // Results stay open after the quiz locks or the attempts run out (QUIZ-9).
  const finished = attempts ? attempts.used - (attempts.inProgress ? 1 : 0) : 0;
  const results =
    finished > 0 ? (
      <Button
        variant="ghost"
        leadingIcon={History}
        accessibilityHint={t('quizEntry.historyHint')}
        onPress={() => {
          const a = owner.current?.attempts;
          if (!owner.active || !a || a.used - (a.inProgress ? 1 : 0) <= 0) return;
          const claim = historyOwner.acquire();
          if (!claim) return;
          router.push(historyRoute(courseId, quiz.id) as never);
          void Promise.resolve().then(() => historyOwner.release(claim));
        }}
      >
        {t('quizEntry.history')}
      </Button>
    ) : null;

  if (quiz.locked) return results;
  if (attemptsLeft === 0 && !attempts?.inProgress)
    return (
      <View className="gap-2">
        <Text variant="subhead" tone="muted">
          {t('quizEntry.used')}
        </Text>
        {results}
      </View>
    );

  const verb = attempts?.inProgress ? t('quizEntry.resume') : (attempts?.used ?? 0) > 0 ? t('quizEntry.retake') : t('quizEntry.take');

  if (mode === 'lockdown') {
    return (
      <View className="gap-2">
        <Button size="lg" leadingIcon={ShieldAlert} onPress={() => launch('lockdown')}>
          {t('quizEntry.openLockdown')}
        </Button>
        <Text variant="footnote" tone="muted" align="center">
          {t('quizEntry.phoneNote')}
        </Text>
        <Button variant="ghost" trailingIcon={Globe} onPress={() => launch('web')}>
          {t('quizEntry.openCanvas')}
        </Button>
        {results}
      </View>
    );
  }

  const note =
    mode === 'web'
      ? t('quizEntry.webNote')
      : [
        quiz.timeLimitMinutes && !attempts?.inProgress
          ? t('quizEntry.timed', { duration: minutes(quiz.timeLimitMinutes) })
          : null,
        t('quizEntry.saves'),
      ]
        .filter(Boolean)
        .join(' ');

  return (
    <View className="gap-3">
      {refusal ? (
        <Callout tone={refusal.tone} icon={refusal.icon} title={refusal.title}>
          {refusal.body}
        </Callout>
      ) : null}
      <View className="gap-2">
        <Button
          size="lg"
          loading={busy}
          trailingIcon={mode === 'web' ? Globe : undefined}
          onPress={() => (mode === 'web' ? launch('web') : start())}
        >
          {verb}
        </Button>
        <Text variant="footnote" tone="muted" align="center">
          {note}
        </Text>
      </View>
      {results}
      <AccessCodePrompt
        visible={!!asking}
        context={asking ?? owner}
        isCurrent={() => owner.active && eligible() && !owner.claim}
        error={codeError}
        busy={busy}
        onSubmit={(code) => {
          if (asking && owner.current?.stateOwner === owner && owner.current.prompt === asking) return start(code);
        }}
        onCancel={() => { if (asking && owner.current?.stateOwner === owner && owner.current.prompt === asking && owner.active && !owner.claim) update({ asking: null }); }}
      />
    </View>
  );
}
