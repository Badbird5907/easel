import type { QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { CanvasAuthError, type CanvasClient, CanvasError, CanvasNetworkError } from '@/canvas/client';
import { loadStoredClients, registerAccountCleanup } from '@/canvas/session';

import { connectivity, isOnline, noteRequestError, reportReachable } from './connectivity';
import { LocalStore } from './store';
import type { QueueLabelDescriptor, QueueNoticeDescriptor } from './presentation';

/*
 * Queued writes (OFF-2). A write made offline (or one that couldn't reach
 * Canvas) waits here, on disk, and goes out when Easel is back online: on
 * reconnect, on returning to the app, and from the background task.
 *
 *   - Writes for one account go out in the order they were made, so a note
 *     created offline exists before its edit is sent.
 *   - Writes with the same `key` collapse: the newest wins (last write wins),
 *     or a handler merges them (a create and a delete cancel out).
 *   - Network trouble and server errors retry with backoff. Canvas refusing a
 *     write outright (a 4xx) drops it with a notice, as does a conflict the
 *     handler detects (deleting something that changed in Canvas).
 */

export type WriteStatus = 'pending' | 'running' | 'retrying';

export type QueuedWrite<P = unknown> = {
  id: string;
  accountId: string;
  kind: string;
  /** Pending writes with the same key collapse into one. */
  key: string;
  payload: P;
  /** What the student did, for lists and notices: "Mark “Lab 3” done". */
  label: string;
  labelDescriptor?: QueueLabelDescriptor;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  status: WriteStatus;
};

export type QueueNotice = {
  id: string;
  accountId: string;
  message: string;
  noticeDescriptor?: QueueNoticeDescriptor;
  at: number;
};

/** Raised by a handler when the write must not go out, with what to tell the student. */
export class WriteConflict extends Error {
  constructor(message: string, readonly noticeDescriptor?: QueueNoticeDescriptor) {
    super(message);
    this.name = 'WriteConflict';
  }
}

export type HandlerContext = {
  accountId: string;
  client: CanvasClient;
  /** Null in the background task, where there's no query cache to update. */
  queryClient: QueryClient | null;
};

export type WriteHandler<P> = {
  run: (payload: P, ctx: HandlerContext) => Promise<unknown>;
  /**
   * Combines a new write with a pending one for the same key. Return the payload
   * to keep, or null when the two cancel out. Defaults to the newer payload.
   */
  merge?: (pending: P, next: P) => P | null;
  /** After the write lands: swap temporary IDs, refresh caches. */
  onSuccess?: (result: unknown, payload: P, ctx: HandlerContext) => void;
  /** After the write is dropped (refused or a conflict): undo optimistic changes. */
  onDrop?: (payload: P, ctx: Omit<HandlerContext, 'client'>) => void;
};

const handlers = new Map<string, WriteHandler<never>>();

export function registerWriteHandler<P>(kind: string, handler: WriteHandler<P>) {
  handlers.set(kind, handler as unknown as WriteHandler<never>);
}

export const queueStore = new LocalStore<QueuedWrite[]>(
  'queue.writes',
  () => [],
  (stored) =>
    // A write that was running when the app stopped goes out again.
    stored.map((w) => (w.status === 'running' ? { ...w, status: 'pending' } : w)),
);

export const noticeStore = new LocalStore<QueueNotice[]>('queue.notices', () => []);

let queryClient: QueryClient | null = null;

const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 30 * 60_000;

function backoff(attempts: number) {
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
}

export function addNotice(accountId: string, message: string, noticeDescriptor?: QueueNoticeDescriptor) {
  noticeStore.update((list) =>
    [...list, { id: Crypto.randomUUID(), accountId, message, noticeDescriptor, at: Date.now() }].slice(-20),
  );
}

export function dismissNotice(id: string) {
  noticeStore.update((list) => list.filter((n) => n.id !== id));
}

export type EnqueueInput<P> = Pick<QueuedWrite<P>, 'accountId' | 'kind' | 'key' | 'payload' | 'label' | 'labelDescriptor'>;

/**
 * Adds a write, collapsing it into a pending one with the same key. Returns
 * false when the two cancelled out and nothing needs sending.
 */
export function enqueueWrite<P>(input: EnqueueInput<P>): boolean {
  const handler = handlers.get(input.kind) as WriteHandler<P> | undefined;
  let kept = true;
  queueStore.update((list) => {
    // Generic requests can depend on intervening operations (score, course reset,
    // score). Only coalesce an adjacent request; moving it before a reset loses it.
    const lastForAccount = list.findLastIndex((w) => w.accountId === input.accountId);
    const index = list.findIndex(
      (w, i) => w.accountId === input.accountId && w.key === input.key && w.status !== 'running' &&
        (input.kind !== 'request' || i === lastForAccount),
    );
    if (index === -1) {
      return [...list, makeWrite(input)];
    }
    const pending = list[index] as QueuedWrite<P>;
    const merged = handler?.merge ? handler.merge(pending.payload, input.payload) : input.payload;
    if (merged === null) {
      kept = false;
      return list.filter((_, i) => i !== index);
    }
    const next = [...list];
    // Keep its place in line, so it still goes after what came before it.
    next[index] = {
      ...pending,
      kind: input.kind,
      payload: merged,
      label: input.label,
      labelDescriptor: input.labelDescriptor,
      attempts: 0,
      nextAttemptAt: Date.now(),
      lastError: null,
      status: 'pending',
    };
    return next;
  });
  requestFlush();
  return kept;
}

function makeWrite<P>(input: EnqueueInput<P>): QueuedWrite<P> {
  return {
    ...input,
    id: Crypto.randomUUID(),
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: Date.now(),
    lastError: null,
    status: 'pending',
  };
}

/** Rewrites pending payloads, e.g. a temporary note ID becoming the real one. */
export function rewritePending(accountId: string, change: (write: QueuedWrite) => QueuedWrite) {
  queueStore.update((list) =>
    list.map((w) => (w.accountId === accountId && w.status !== 'running' ? change(w) : w)),
  );
}

export function pendingWrites(accountId?: string): QueuedWrite[] {
  const list = queueStore.get();
  return accountId ? list.filter((w) => w.accountId === accountId) : list;
}

function patch(id: string, change: Partial<QueuedWrite>) {
  queueStore.update((list) => list.map((w) => (w.id === id ? { ...w, ...change } : w)));
}

function remove(id: string) {
  queueStore.update((list) => list.filter((w) => w.id !== id));
}

// --- Flushing ---------------------------------------------------------------------------

let flushing: Promise<FlushResult> | null = null;
let again = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export type FlushResult = { sent: number; dropped: number; remaining: number };

/** Sends what's due. One flush at a time; a request during a flush runs another after it. */
export function flushQueue(): Promise<FlushResult> {
  if (flushing) {
    again = true;
    return flushing;
  }
  flushing = runFlush().finally(() => {
    flushing = null;
    if (again) {
      again = false;
      void flushQueue();
    }
  });
  return flushing;
}

/** Flushes soon when there's something to send and Easel is online. */
export function requestFlush() {
  if (!isOnline() || queueStore.get().length === 0) return;
  setTimeout(() => void flushQueue(), 0);
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  // Only writes backing off; ones held for other reasons (signed out, offline) go on
  // reconnect, on returning to the app, or with the next write.
  const waiting = queueStore.get().filter((w) => w.nextAttemptAt > Date.now());
  if (!waiting.length) return;
  const soonest = Math.min(...waiting.map((w) => w.nextAttemptAt));
  retryTimer = setTimeout(
    () => {
      retryTimer = null;
      requestFlush();
    },
    Math.max(1_000, soonest - Date.now()),
  );
}

async function runFlush(): Promise<FlushResult> {
  queueStore.reload();
  const result: FlushResult = { sent: 0, dropped: 0, remaining: 0 };
  if (queueStore.get().length === 0) return result;
  const clients = new Map((await loadStoredClients()).map((c) => [c.account.id, c.client]));
  const blocked = new Set<string>();

  // Oldest first. A write that can't go yet holds back the rest of its account's line.
  for (const write of [...queueStore.get()]) {
    if (blocked.has(write.accountId)) continue;
    const client = clients.get(write.accountId);
    const handler = handlers.get(write.kind) as WriteHandler<unknown> | undefined;
    if (!client || !handler) {
      // Signed out or expired: wait for the account to come back.
      blocked.add(write.accountId);
      continue;
    }
    if (write.nextAttemptAt > Date.now()) {
      blocked.add(write.accountId);
      continue;
    }
    if (!isOnline()) break;
    // Its payload may have been rewritten since the loop started.
    const current = queueStore.get().find((w) => w.id === write.id);
    if (!current) continue;
    patch(current.id, { status: 'running' });
    const ctx: HandlerContext = { accountId: current.accountId, client, queryClient };
    try {
      const data = await handler.run(current.payload, ctx);
      reportReachable();
      remove(current.id);
      result.sent += 1;
      handler.onSuccess?.(data, current.payload, ctx);
    } catch (error) {
      // Same as any request: no answer marks Canvas unreachable until it answers again.
      noteRequestError(error, client.baseUrl);
      const outcome = classify(error, current.attempts + 1);
      if (outcome === 'drop') {
        remove(current.id);
        result.dropped += 1;
        handler.onDrop?.(current.payload, { accountId: current.accountId, queryClient });
        addNotice(
          current.accountId,
          error instanceof WriteConflict
            ? error.message
            : `Couldn’t sync “${current.label}”. ${(error as Error).message || 'Canvas refused the change.'}`,
          error instanceof WriteConflict
            ? error.noticeDescriptor
            : {
                kind: 'dropped',
                label: current.label,
                labelDescriptor: current.labelDescriptor,
                detail: (error as Error).message || null,
              },
        );
      } else {
        patch(current.id, {
          status: 'retrying',
          attempts: current.attempts + 1,
          nextAttemptAt: Date.now() + backoff(current.attempts + 1),
          lastError: (error as Error).message ?? null,
        });
        blocked.add(current.accountId);
        if (error instanceof CanvasNetworkError) break;
      }
    }
  }
  result.remaining = queueStore.get().length;
  scheduleRetry();
  return result;
}

function classify(error: unknown, attempts: number): 'retry' | 'drop' {
  if (error instanceof WriteConflict) return 'drop';
  // Signed out: keep it for when the student signs in again.
  if (error instanceof CanvasAuthError) return 'retry';
  if (error instanceof CanvasNetworkError) return 'retry';
  if (error instanceof CanvasError) {
    if (error.status === 408 || error.status === 429 || error.status >= 500)
      return attempts >= MAX_ATTEMPTS ? 'drop' : 'retry';
    return 'drop';
  }
  return attempts >= MAX_ATTEMPTS ? 'drop' : 'retry';
}

// Removing an account drops its queued writes and notices (AUTH-10).
registerAccountCleanup((accountId) => {
  queueStore.update((list) => list.filter((w) => w.accountId !== accountId));
  noticeStore.update((list) => list.filter((n) => n.accountId !== accountId));
});

// --- React ------------------------------------------------------------------------------

/**
 * Runs the queue while the app is open: flushes on start, on reconnect, and on
 * returning to the foreground. Render once, inside the query provider.
 */
export function useWriteQueue(client: QueryClient) {
  useEffect(() => {
    queryClient = client;
    requestFlush();
    let wasOnline = isOnline();
    const unsubscribe = connectivity.subscribe(() => {
      const online = isOnline();
      if (online && !wasOnline) {
        // Back online: everything waiting goes now, not at its backoff time.
        queueStore.update((list) => list.map((w) => ({ ...w, nextAttemptAt: Date.now() })));
        requestFlush();
      }
      wasOnline = online;
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') requestFlush();
    });
    return () => {
      unsubscribe();
      sub.remove();
      if (queryClient === client) queryClient = null;
    };
  }, [client]);
}

const emptyWrites: QueuedWrite[] = [];

/** Writes waiting for the network, for one account. */
export function useQueuedWrites(accountId: string): QueuedWrite[] {
  const all = useSyncExternalStore(queueStore.subscribe, queueStore.get, queueStore.get);
  return useFilteredMemo(all, accountId);
}

const filtered = new WeakMap<QueuedWrite[], Map<string, QueuedWrite[]>>();

/** Stable arrays per store value and account, so effects that depend on them don't loop. */
function useFilteredMemo(all: QueuedWrite[], accountId: string): QueuedWrite[] {
  let byAccount = filtered.get(all);
  if (!byAccount) filtered.set(all, (byAccount = new Map()));
  let list = byAccount.get(accountId);
  if (!list) {
    list = all.filter((w) => w.accountId === accountId);
    byAccount.set(accountId, list.length ? list : emptyWrites);
    list = byAccount.get(accountId)!;
  }
  return list;
}

export function useQueueNotices(accountId: string): QueueNotice[] {
  const all = useSyncExternalStore(noticeStore.subscribe, noticeStore.get, noticeStore.get);
  return all.filter((n) => n.accountId === accountId);
}
