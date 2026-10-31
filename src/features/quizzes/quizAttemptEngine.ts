import { AccessibilityInfo, AppState } from 'react-native';
import {
  type AnswerValue,
  answerPayload,
  answerQuestions,
  type AttemptAuth,
  completeQuizSubmission,
  fetchQuizSubmission,
  fetchQuizTime,
  fetchSubmissionQuestions,
  flagQuestion,
  postQuizEvents,
  type QuizEvent,
  QuizRefusedError,
  type QuizQuestion,
  type QuizSubmission,
} from '@/canvas/api/quizzes';
import { type CanvasClient, CanvasError, CanvasNetworkError } from '@/canvas/client';
import { isStoredAccountClient } from '@/canvas/session';
import type { Translate } from '@/i18n/types';
import { isNumberLike, saveDelay } from './answers';
import {
  clearAttempt,
  emptyAttempt,
  loadAccessCode,
  loadAttempt,
  saveAttempt,
  saveAccessCode,
  quizStorageOwner,
} from './storage';

export type SaveState = 'saved' | 'saving' | 'offline' | 'error';
export type EngineMessage = 'quizEngine.missingValidation' | 'quizEngine.token' | 'quizEngine.ended';
export type AttemptStatus =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'submitting'; auto: boolean }
  | { kind: 'submitted'; submission: QuizSubmission }
  | { kind: 'ended'; messageKey: EngineMessage }
  | { kind: 'web'; message: string }
  | { kind: 'error'; error: Error; messageKey?: never }
  | { kind: 'error'; error?: never; messageKey: EngineMessage };
export type AttemptContext = {
  accountId: string;
  client: CanvasClient;
  courseId: string;
  quizId: string;
  submissionId: string;
};
export type AttemptProvenance = AttemptContext & { generation: number; attempt: number | null };
export const initialAttemptSnapshot = () => ({
  status: { kind: 'loading' } as AttemptStatus,
  provenance: null as AttemptProvenance | null,
  submission: null as QuizSubmission | null,
  questions: [] as QuizQuestion[],
  answers: {} as Record<string, AnswerValue>,
  flags: {} as Record<string, boolean>,
  position: 0,
  saveState: 'saved' as SaveState,
  saveError: null as string | null,
  pendingCount: 0,
  secondsLeft: null as number | null,
  expired: false,
  waitingToSubmit: false,
});
export type AttemptSnapshot = ReturnType<typeof initialAttemptSnapshot>;
const RETRY_DELAYS = [2000, 4000, 8000, 15000, 30000];
let generation = 0;
const committedEngines = new Map<string, QuizAttemptEngine>();

/** Construct only on commit. Each continuation closes over this single load.
 * Canvas exposes attempt + validation token, not a server generation. Local
 * provenance prevents retired local loads being adopted; it cannot detect a
 * remote retake until Canvas reports it/refuses the old credentials. */
export class QuizAttemptEngine {
  provenance: AttemptProvenance;
  snapshot = initialAttemptSnapshot();
  private alive = true;
  private loadStarted = false;
  private store = emptyAttempt();
  private auth: AttemptAuth | null = null;
  private storage;
  private codeOwner;
  private resourceKey: string;
  private flagRevisions: Record<string, object> = {};
  private flushing: Promise<void> | null = null;
  private sending: Promise<void> | null = null;
  private timing: Promise<void> | null = null;
  private retries = 0;
  private deadline: number | null = null;
  private autoFailures = 0;
  private autoSubmit = true;
  private t: Translate;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
  private intervals: ReturnType<typeof setInterval>[] = [];
  private appSubscription: { remove(): void } | undefined;
  constructor(
    readonly context: AttemptContext,
    t: Translate,
    private publish: (snapshot: AttemptSnapshot) => void,
    private invalidate: () => void,
  ) {
    this.resourceKey = JSON.stringify([
      context.accountId,
      context.courseId,
      context.quizId,
      context.submissionId,
    ]);
    committedEngines.get(this.resourceKey)?.dispose();
    committedEngines.set(this.resourceKey, this);
    this.codeOwner = quizStorageOwner(context.accountId, context.client, this.current);
    this.t = t;
    this.provenance = { ...context, generation: ++generation, attempt: null };
    this.storage = quizStorageOwner(context.accountId, context.client);
  }
  // Pure: the hook/screen may inspect readiness during render.
  current = () => this.alive && isStoredAccountClient(this.context.accountId, this.context.client);
  private writable = () =>
    this.current() &&
    !!this.auth &&
    (this.snapshot.status.kind === 'ready' || this.snapshot.status.kind === 'submitting');
  private update(patch: Partial<AttemptSnapshot>) {
    if (!this.current()) return;
    if (
      this.snapshot.provenance === this.provenance &&
      Object.entries(patch).every(([key, value]) =>
        Object.is(this.snapshot[key as keyof AttemptSnapshot], value),
      )
    )
      return;
    this.snapshot = { ...this.snapshot, ...patch, provenance: this.provenance };
    this.publish(this.snapshot);
  }
  configure(t: Translate, autoSubmit: boolean) {
    this.t = t;
    this.autoSubmit = autoSubmit;
    if (!autoSubmit) {
      clearTimeout(this.autoTimer);
      this.autoTimer = undefined;
    }
    this.tick();
  }
  dispose = () => {
    this.alive = false;
    if (committedEngines.get(this.resourceKey) === this) committedEngines.delete(this.resourceKey);
    this.stopTimers();
  };
  private stopTimers() {
    clearTimeout(this.flushTimer);
    clearTimeout(this.autoTimer);
    this.flushTimer = this.autoTimer = undefined;
    this.intervals.forEach(clearInterval);
    this.intervals = [];
    this.appSubscription?.remove();
    this.appSubscription = undefined;
  }
  private terminal(status: AttemptStatus) {
    this.stopTimers();
    this.update({ status });
  }
  private ended(error: QuizRefusedError) {
    this.terminal({
      kind: 'ended',
      messageKey: error.reason === 'token' ? 'quizEngine.token' : 'quizEngine.ended',
    });
  }
  private persist() {
    if (!this.writable() || !this.auth) return;
    this.update({ pendingCount: Object.keys(this.store.pending).length });
    void saveAttempt(
      this.context.accountId,
      this.context.submissionId,
      this.auth.attempt,
      this.store,
      this.storage,
    );
  }
  private log(type: QuizEvent['type'], data?: unknown) {
    if (!this.writable()) return;
    this.store.events.push({ type, data, at: new Date().toISOString() });
    this.persist();
  }
  async load() {
    const { client, accountId, courseId, quizId, submissionId } = this.context;
    if (!this.current() || this.loadStarted) return;
    this.loadStarted = true;
    this.update({});
    try {
      const sub = await fetchQuizSubmission(client, courseId, quizId, submissionId);
      if (!this.current()) return;
      this.provenance = { ...this.provenance, attempt: sub.attempt };
      this.update({ submission: sub });
      if (!sub.inProgress) {
        this.terminal({ kind: 'submitted', submission: sub });
        return;
      }
      if (!sub.validationToken || !Number.isInteger(sub.attempt) || sub.attempt < 1) {
        this.terminal({ kind: 'error', messageKey: 'quizEngine.missingValidation' });
        return;
      }
      const accessCode = await loadAccessCode(accountId, quizId, this.codeOwner);
      if (!this.current()) return;
      const auth = { attempt: sub.attempt, validationToken: sub.validationToken, accessCode };
      const [qs, stored] = await Promise.all([
        fetchSubmissionQuestions(client, submissionId),
        loadAttempt(
          accountId,
          submissionId,
          sub.attempt,
          quizStorageOwner(accountId, client, this.current),
        ),
      ]);
      if (!this.current()) return;
      this.auth = auth;
      this.store = stored;
      const answers: Record<string, AnswerValue> = {},
        flags: Record<string, boolean> = {};
      for (const q of qs) {
        answers[q.id] = stored.pending[q.id]?.answer ?? q.answer;
        flags[q.id] = stored.flags[q.id] ?? q.flagged;
      }
      for (const id of Object.keys(stored.flags)) this.flagRevisions[id] = {};
      this.update({
        questions: qs,
        answers,
        flags,
        position: Math.min(stored.position, Math.max(0, qs.length - 1)),
        status: { kind: 'ready' },
        pendingCount: Object.keys(stored.pending).length,
      });
      if (!stored.events.some((e) => e.type === 'session_started'))
        this.log('session_started', { user_agent: 'Easel' });
      this.intervals = [
        setInterval(() => {
          if (this.snapshot.status.kind === 'ready') void this.sendEvents();
        }, 20000),
        setInterval(() => {
          if (this.snapshot.status.kind === 'ready') void this.refreshTime();
        }, 60000),
        setInterval(() => this.tick(), 1000),
      ];
      this.appSubscription = AppState.addEventListener('change', (state) => {
        if (!this.current()) { this.dispose(); return; }
        if (!this.writable() || this.snapshot.status.kind !== 'ready') return;
        if (state === 'active') {
          this.log('page_focused');
          void this.refreshTime();
          void this.flush();
        } else if (state === 'background' || state === 'inactive') {
          this.log('page_blurred');
          void this.flush();
          void this.sendEvents();
        }
      });
      void this.refreshTime();
      void this.flush();
    } catch (error) {
      if (!this.current()) return;
      if (error instanceof QuizRefusedError && error.reason === 'one_at_a_time')
        this.terminal({ kind: 'web', message: error.serverMessage });
      else this.terminal({ kind: 'error', error: error as Error });
    }
  }
  sendEvents = (): Promise<void> => {
    if (!this.writable()) return Promise.resolve();
    if (this.sending) return this.sending;
    const events = this.store.events.slice(); // Keep durable until acknowledged.
    if (!events.length) return Promise.resolve();
    const { client, courseId, quizId, submissionId } = this.context;
    this.sending = (async () => {
      try {
        await postQuizEvents(client, courseId, quizId, submissionId, events);
        if (!this.writable()) return;
        this.store.events = this.store.events.filter((e) => !events.includes(e));
        this.persist();
      } catch {
        /* Best effort; retain original events and concurrent additions. */
      }
    })().finally(() => {
      this.sending = null;
    });
    return this.sending;
  };
  flush = (): Promise<void> => {
    if (!this.writable()) return Promise.resolve();
    if (this.flushing) return this.flushing;
    if (!Object.keys(this.store.pending).length && !Object.keys(this.store.flags).length)
      return Promise.resolve();
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.flushing = this.flushQueue().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  };
  private async flushQueue() {
    const { client, submissionId } = this.context;
    const auth = this.auth!;
    while (this.writable()) {
      const entries = Object.entries(this.store.pending);
      const flags = Object.entries(this.store.flags).map(([id, value]) => ({
        id,
        value,
        revision: this.flagRevisions[id],
      }));
      if (!entries.length && !flags.length) {
        this.update({ saveState: 'saved' });
        return;
      }
      this.update({ saveState: 'saving' });
      try {
        if (entries.length) {
          try {
            await answerQuestions(
              client,
              submissionId,
              auth,
              entries.map(([questionId, e]) => ({ questionId, answer: e.answer, type: e.type })),
            );
          } catch (error) {
            if (!this.writable()) return;
            if (!(error instanceof CanvasError) || error.status !== 400 || entries.length === 1)
              throw error;
            for (const [questionId, e] of entries) {
              if (!this.writable()) return;
              try {
                await answerQuestions(client, submissionId, auth, [
                  { questionId, answer: e.answer, type: e.type },
                ]);
              } catch (single) {
                if (!this.writable()) return;
                if (!(single instanceof CanvasError) || single.status !== 400) throw single;
                this.update({ saveError: single.message });
              }
              if (!this.writable()) return;
              if (this.store.pending[questionId] === e) delete this.store.pending[questionId];
              this.persist();
            }
          }
          if (!this.writable()) return;
          for (const [id, e] of entries) if (this.store.pending[id] === e) delete this.store.pending[id];
          this.log(
            'question_answered',
            entries.map(([id, e]) => ({ quiz_question_id: id, answer: answerPayload(e.answer) })),
          );
        }
        for (const { id, value, revision } of flags) {
          if (!this.writable()) return;
          await flagQuestion(client, submissionId, id, value, auth);
          if (!this.writable()) return;
          if (this.flagRevisions[id] === revision) delete this.store.flags[id];
          this.log('question_flagged', { quiz_question_id: id, flagged: value });
        }
        this.persist();
        this.retries = 0;
        this.update({ saveError: null });
      } catch (error) {
        if (!this.writable()) return;
        this.persist();
        if (
          error instanceof QuizRefusedError &&
          (error.reason === 'ended' || error.reason === 'token')
        ) {
          this.ended(error);
          return;
        }
        this.update({
          saveState: error instanceof CanvasNetworkError ? 'offline' : 'error',
          saveError:
            error instanceof CanvasNetworkError ? this.snapshot.saveError : (error as Error).message,
        });
        this.scheduleFlush(RETRY_DELAYS[Math.min(this.retries++, RETRY_DELAYS.length - 1)]);
        return;
      }
    }
  }
  private scheduleFlush(delay: number) {
    if (!this.writable()) return;
    clearTimeout(this.flushTimer);
    if (delay <= 0) void this.flush();
    else
      this.flushTimer = setTimeout(() => {
        if (this.writable()) void this.flush();
      }, delay);
  }
  refreshTime = (): Promise<void> => {
    if (!this.writable()) return Promise.resolve();
    if (this.timing) return this.timing;
    const { client, courseId, quizId, submissionId } = this.context;
    this.timing = (async () => {
      try {
        const time = await fetchQuizTime(client, courseId, quizId, submissionId);
        if (!this.writable()) return;
        this.deadline =
          time.secondsLeft !== null
            ? Date.now() + time.secondsLeft * 1000
            : (time.endAt?.getTime() ?? null);
        this.tick();
      } catch {
        /* Continue the last Canvas clock until the next refresh. */
      }
    })().finally(() => {
      this.timing = null;
    });
    return this.timing;
  };
  private tick() {
    if (!this.current()) { this.dispose(); return; }
    if (!this.writable()) return;
    const secondsLeft =
      this.deadline === null ? null : Math.max(0, Math.round((this.deadline - Date.now()) / 1000));
    this.update({
      secondsLeft,
      expired: secondsLeft === 0,
      waitingToSubmit: secondsLeft === 0 && this.autoSubmit && this.autoFailures > 0,
    });
    if (secondsLeft !== 0 || !this.autoSubmit || this.snapshot.status.kind !== 'ready') {
      clearTimeout(this.autoTimer);
      this.autoTimer = undefined;
      return;
    }
    if (this.autoTimer !== undefined) return;
    this.autoTimer = setTimeout(
      () => {
        this.autoTimer = undefined;
        if (!this.writable() || !this.autoSubmit || !this.snapshot.expired) return;
        void this.submit({ auto: true }).catch(() => {
          if (!this.writable()) return;
          this.autoFailures++;
          this.tick();
        });
      },
      this.autoFailures === 0 ? 0 : 5000,
    );
  }
  setAnswer = (id: string, answer: AnswerValue) => {
    if (!this.writable() || this.snapshot.status.kind !== 'ready') return;
    const q = this.snapshot.questions.find((q) => q.id === id);
    if (!q) return;
    this.update({ answers: { ...this.snapshot.answers, [id]: answer } });
    if (
      (q.type === 'numerical_question' || q.type === 'calculated_question') &&
      answer.kind === 'text' &&
      answer.value.trim() &&
      !isNumberLike(answer.value)
    )
      return;
    this.store.pending[id] = { answer, type: q.type, at: Date.now() };
    this.persist();
    this.update({ saveState: 'saving' });
    this.scheduleFlush(saveDelay(q.type));
  };
  toggleFlag = (id: string) => {
    if (
      !this.writable() ||
      this.snapshot.status.kind !== 'ready' ||
      !this.snapshot.questions.some((q) => q.id === id)
    )
      return;
    const value = !this.snapshot.flags[id];
    this.update({ flags: { ...this.snapshot.flags, [id]: value } });
    this.store.flags[id] = value;
    this.flagRevisions[id] = {};
    this.persist();
    this.scheduleFlush(0);
  };
  setPosition = (index: number) => {
    if (!this.writable() || !this.snapshot.questions[index]) return;
    this.store.position = index;
    this.update({ position: index });
    // Browsing during submission remains available, but must not enqueue a
    // new snapshot after completion has queued its local attempt removal.
    if (this.snapshot.status.kind === 'ready')
      this.log('question_viewed', [this.snapshot.questions[index].id]);
  };
  submit = async ({ auto = false }: { auto?: boolean } = {}) => {
    if (!this.writable() || this.snapshot.status.kind !== 'ready') return;
    const { client, accountId, courseId, quizId, submissionId } = this.context;
    const auth = this.auth!;
    this.update({ status: { kind: 'submitting', auto } });
    clearTimeout(this.autoTimer);
    this.autoTimer = undefined;
    if (auto) AccessibilityInfo.announceForAccessibility(this.t('quizEngine.timeUp'));
    let entered = false;
    try {
      await this.flush();
      if (!this.writable()) return;
      if (Object.keys(this.store.pending).length || Object.keys(this.store.flags).length)
        throw new CanvasNetworkError();
      await this.sendEvents();
      if (!this.writable()) return;
      entered = true;
      const done = await completeQuizSubmission(client, courseId, quizId, submissionId, auth);
      if (!this.writable()) return;
      await clearAttempt(
        accountId,
        submissionId,
        auth.attempt,
        quizStorageOwner(accountId, client, this.current),
      );
      if (!this.writable()) return;
      await saveAccessCode(accountId, quizId, null, this.codeOwner);
      if (!this.writable()) return;
      this.update({ submission: done });
      this.terminal({ kind: 'submitted', submission: done });
    } catch (error) {
      if (!this.writable()) return;
      if (error instanceof QuizRefusedError) {
        if (error.reason === 'token') {
          this.ended(error);
          return;
        }
        if (error.reason === 'ended') {
          const latest = await fetchQuizSubmission(client, courseId, quizId, submissionId).catch(
            () => null,
          );
          if (!this.writable()) return;
          if (latest && !latest.inProgress && latest.attempt === auth.attempt) {
            await clearAttempt(
              accountId,
              submissionId,
              auth.attempt,
              quizStorageOwner(accountId, client, this.current),
            );
            if (!this.writable()) return;
            this.update({ submission: latest });
            this.terminal({ kind: 'submitted', submission: latest });
          } else this.ended(error);
          return;
        }
      }
      this.update({ status: { kind: 'ready' } });
      throw error;
    } finally {
      // A completion that entered may have written remotely even when its owner
      // retired or the response failed. Invalidate only its captured account.
      if (entered && isStoredAccountClient(accountId, client)) this.invalidate();
    }
  };
}
