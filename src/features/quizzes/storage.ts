import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AnswerValue, QuizEvent, QuizQuestion } from '@/canvas/api/quizzes';
import type { CanvasClient } from '@/canvas/client';
import { isStoredAccountClient, registerAccountCleanup } from '@/canvas/session';

/**
 * What an attempt keeps on the device so no answer is lost (QUIZ-4): answers
 * and flags Canvas hasn't confirmed yet, the quiz log not yet sent, and the
 * question the student was on. Canvas stays the source of truth: on resume,
 * the saved answers come from Canvas and these pending ones replay on top.
 */
export type PendingAnswer = { answer: AnswerValue; type: QuizQuestion['type']; at: number };

export type StoredAttempt = {
  pending: Record<string, PendingAnswer>;
  flags: Record<string, boolean>;
  events: QuizEvent[];
  position: number;
};

const PREFIX = 'easel.quiz.';
const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, '_');
const attemptKey = (accountId: string, submissionId: string, attempt: number) =>
  `${PREFIX}attempt.${safe(accountId)}.${safe(submissionId)}.${attempt}`;
const codeKey = (accountId: string, quizId: string) =>
  `${PREFIX}code.${safe(accountId)}.${safe(quizId)}`;

export const emptyAttempt = (): StoredAttempt => ({ pending: {}, flags: {}, events: [], position: 0 });

/** Optional capability for callers with session/operation ownership. Legacy callers
 * retain their signatures. A cleanup tombstone also guards unowned queued work. */
export type QuizStorageOwner = { accountId: string; current: () => boolean; readonly order: number };
let ownerOrder = 0;
const codeClaims = new Map<string, number>();
const generations = new Map<string, object>();
const removed = new Set<string>();
const generation = (id: string) => {
  if (!generations.has(id)) generations.set(id, {});
  return generations.get(id)!;
};
export function quizStorageOwner(
  accountId: string,
  client: CanvasClient,
  current = () => true,
): QuizStorageOwner {
  const epoch = generation(accountId);
  // Only a live saved client can reopen storage after removal/re-add.
  if (isStoredAccountClient(accountId, client)) removed.delete(accountId);
  return {
    accountId,
    order: ++ownerOrder,
    current: () =>
      generation(accountId) === epoch && isStoredAccountClient(accountId, client) && current(),
  };
}

// Reads, answers, codes and cleanup share an ordering boundary. Accepted edit
// snapshots may drain after a screen closes, before a subsequent reopen reads.
// No asynchronous engine continuation is allowed to enqueue after retirement.
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(
  accountId: string,
  owner: QuizStorageOwner | undefined,
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  const epoch = generation(accountId);
  const valid = () =>
    generation(accountId) === epoch &&
    !removed.has(accountId) &&
    (!owner || (owner.accountId === accountId && owner.current()));
  if (!valid()) return Promise.resolve(fallback);
  const result = chain.then(() => (valid() ? run() : fallback)).catch(() => fallback);
  chain = result;
  return result;
}
export function loadAttempt(
  accountId: string,
  submissionId: string,
  attempt: number,
  owner?: QuizStorageOwner,
) {
  return enqueue(accountId, owner, emptyAttempt(), async () => {
    const raw = await AsyncStorage.getItem(attemptKey(accountId, submissionId, attempt));
    return raw ? { ...emptyAttempt(), ...(JSON.parse(raw) as StoredAttempt) } : emptyAttempt();
  });
}
export function saveAttempt(
  accountId: string,
  submissionId: string,
  attempt: number,
  data: StoredAttempt,
  owner?: QuizStorageOwner,
) {
  const json = JSON.stringify(data); // Capture at acceptance, never a later mutable queue.
  return enqueue(accountId, owner, undefined, () =>
    AsyncStorage.setItem(attemptKey(accountId, submissionId, attempt), json),
  );
}
export function clearAttempt(
  accountId: string,
  submissionId: string,
  attempt: number,
  owner?: QuizStorageOwner,
) {
  return enqueue(accountId, owner, undefined, () =>
    AsyncStorage.removeItem(attemptKey(accountId, submissionId, attempt)),
  );
}
// A completion holds the capability acquired when it loaded the code, not a
// freshly minted capability that could erase a code accepted by a newer entry.
function claimCode(accountId: string, quizId: string, owner?: QuizStorageOwner) {
  if (!owner) return undefined;
  const key = codeKey(accountId, quizId);
  if (owner.accountId === accountId && owner.current() && owner.order >= (codeClaims.get(key) ?? 0))
    codeClaims.set(key, owner.order);
  return { ...owner, current: () => owner.current() && codeClaims.get(key) === owner.order };
}
export function loadAccessCode(accountId: string, quizId: string, owner?: QuizStorageOwner) {
  return enqueue(accountId, claimCode(accountId, quizId, owner), null as string | null, () =>
    AsyncStorage.getItem(codeKey(accountId, quizId)),
  );
}
export function saveAccessCode(
  accountId: string,
  quizId: string,
  code: string | null,
  owner?: QuizStorageOwner,
) {
  return enqueue(accountId, claimCode(accountId, quizId, owner), undefined, () =>
    code
      ? AsyncStorage.setItem(codeKey(accountId, quizId), code)
      : AsyncStorage.removeItem(codeKey(accountId, quizId)),
  );
}
registerAccountCleanup((accountId) => {
  // Synchronous revocation before waiting for any already-entered native write.
  generations.set(accountId, {});
  removed.add(accountId);
  const cleanup = chain
    .then(async () => {
      const keys = await AsyncStorage.getAllKeys();
      const mine = keys.filter(
        (k) =>
          k.startsWith(`${PREFIX}attempt.${safe(accountId)}.`) ||
          k.startsWith(`${PREFIX}code.${safe(accountId)}.`),
      );
      if (mine.length) await AsyncStorage.multiRemove(mine);
    })
    .catch(() => {});
  chain = cleanup;
  return cleanup;
});
