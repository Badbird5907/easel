import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useAccountKey } from '@/canvas/query';
import { useCanvas } from '@/canvas/session';
import { useTranslation } from '@/i18n';
import { useOnline } from '@/features/offline/useOnline';
import { initialAttemptSnapshot, QuizAttemptEngine, type AttemptSnapshot } from './quizAttemptEngine';
export type { AttemptStatus, SaveState } from './quizAttemptEngine';

/** Commit creates a load; rendering never publishes refs or starts operations.
 * Locale/policy updates configure the existing engine without replacing auth. */
export function useQuizAttempt({
  courseId,
  quizId,
  submissionId,
  autoSubmit,
}: {
  courseId: string;
  quizId: string;
  submissionId: string;
  autoSubmit: boolean;
}) {
  const { client, account } = useCanvas();
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  const { t } = useTranslation();
  const online = useOnline();
  const [loadKey, setLoadKey] = useState(0);
  const context = useMemo(
    () => ({ accountId: account.id, client, courseId, quizId, submissionId, loadKey }),
    [account.id, client, courseId, quizId, submissionId, loadKey],
  );
  const [view, setView] = useState<{ engine: QuizAttemptEngine; snapshot: AttemptSnapshot } | null>(
    null,
  );
  useLayoutEffect(() => {
    const engine = new QuizAttemptEngine(
      context,
      t,
      (snapshot) => setView({ engine, snapshot }),
      () => {
        void queryClient.invalidateQueries({
          queryKey: [accountKey, 'courses', courseId, 'quizzes', quizId],
        });
        void queryClient.invalidateQueries({ queryKey: [accountKey, 'courses', courseId, 'modules'] });
      },
    );
    engine.configure(t, autoSubmit);
    void engine.load();
    return engine.dispose;
    // Presentation/configuration is published separately; never reload on locale changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, queryClient, accountKey]);
  const engine = view?.engine.context === context ? view.engine : null;
  useLayoutEffect(() => {
    engine?.configure(t, autoSubmit);
  }, [engine, t, autoSubmit]);
  useEffect(() => {
    if (online) void engine?.flush();
  }, [engine, online]);
  const isCurrent = () => !!engine?.current();
  const snapshot = engine && isCurrent() ? view!.snapshot : initialAttemptSnapshot();
  return {
    ...snapshot,
    isCurrent,
    setPosition: (index: number) => engine?.setPosition(index),
    setAnswer: (id: string, answer: Parameters<QuizAttemptEngine['setAnswer']>[1]) =>
      engine?.setAnswer(id, answer),
    toggleFlag: (id: string) => engine?.toggleFlag(id),
    submit: (options?: { auto?: boolean }) => engine?.submit(options) ?? Promise.resolve(),
    flush: () => engine?.flush() ?? Promise.resolve(),
    retry: () => {
      if (!engine?.current()) return;
      engine.dispose(); // Revoke immediately, before the next React commit.
      setLoadKey((k) => k + 1);
    },
  };
}
