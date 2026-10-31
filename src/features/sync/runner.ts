import type { QueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { fetchDashboardCourses } from '@/canvas/api/courses';
import { fetchAllCourses } from '@/canvas/api/tabs';
import type { CanvasClient } from '@/canvas/client';
import { type Account, loadStoredClients, registerAccountCleanup, useSession } from '@/canvas/session';
import { removeDownload } from '@/features/files/download';
import { isOnline } from '@/features/offline/connectivity';

import { type CourseToSync, syncCourse, type SyncProgress } from './engine';
import {
  courseStatus,
  setCourseStatus,
  type SyncContent,
  syncedCourses,
  syncSettingsStore,
  syncStatusStore,
} from './settings';
import { removeAccountAssets, removeCourseAssets } from './assets';
import { revokeSync } from './lifecycle';
import { removeAccountSnapshots, removeCourseSnapshot } from './snapshots';

/*
 * Runs course syncs (OFF-3): one at a time, with progress anyone can watch
 * (the Storage screen, Home's activity strip) and a cancel. Auto-sync runs
 * daily or weekly, from the background task and when the app opens, and waits
 * for Wi-Fi when the student asked it to.
 */

export type SyncRun = {
  accountId: string;
  reason: 'manual' | 'auto';
  courses: { id: string; name: string }[];
  /** Index into `courses` of the one syncing now. */
  index: number;
  progress: SyncProgress | null;
  startedAt: number;
};

let current: SyncRun | null = null;
type SyncRunOwner = {
  accountId: string;
  controller: AbortController;
  promise: Promise<void>;
  removedCourses: Set<string>;
};
let active: SyncRunOwner | null = null;
// Only snapshots actually published by this runner carry cancellation authority.
// Neither public fields, copied metadata nor wall-clock timestamps confer it.
const runOwners = new WeakMap<SyncRun, SyncRunOwner>();
const listeners = new Set<() => void>();
let liveQueryClient: QueryClient | null = null;

function setCurrent(next: SyncRun | null) {
  current = next;
  for (const listener of listeners) listener();
}

const syncRunStore = {
  get: () => current,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** The sync running now, if any. */
export function useSyncRun(): SyncRun | null {
  return useSyncExternalStore(syncRunStore.subscribe, syncRunStore.get, syncRunStore.get);
}

export function cancelSync() {
  active?.controller.abort();
}

/**
 * Atomically cancels only the owner of a runner-published snapshot. Older progress
 * snapshots from that same run remain valid. Copies and externally constructed
 * SyncRuns fail closed; keep the exact object returned by useSyncRun for controls.
 * Already-entered native work may still settle after cancellation.
 */
export function cancelSyncRun(run: SyncRun): boolean {
  const owner = runOwners.get(run);
  if (!owner || owner !== active || owner.controller.signal.aborted) return false;
  owner.controller.abort();
  return true;
}

function publishRun(owner: SyncRunOwner, run: SyncRun) {
  if (active !== owner || owner.controller.signal.aborted) return;
  runOwners.set(run, owner);
  setCurrent(run);
}

/** Course names for the courses chosen, from the dashboard (and every course, for older ones). */
async function courseNames(client: CanvasClient, signal: AbortSignal): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const [dashboard, all] = await Promise.allSettled([fetchDashboardCourses(client, signal), fetchAllCourses(client, signal)]);
  if (all.status === 'fulfilled') for (const c of all.value) names.set(c.id, c.name);
  if (dashboard.status === 'fulfilled') for (const c of dashboard.value) names.set(c.id, c.name);
  return names;
}

export type SyncRequest = {
  account: Account;
  client: CanvasClient;
  /** Courses to sync now; defaults to every course chosen for the account. */
  courseIds?: string[];
  reason?: SyncRun['reason'];
  /** Names, when the caller has them, so progress reads well right away. */
  names?: Map<string, string>;
};

/** Syncs courses for one account. Resolves when done, cancelled, or stopped by the network. */
export function startSync(request: SyncRequest): Promise<void> {
  if (active) return active.promise;
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const owner: SyncRunOwner = {
    accountId: request.account.id,
    controller: new AbortController(),
    promise,
    removedCourses: new Set(),
  };
  // Reserve admission AND its return promise before storage, name lookup or
  // publication can synchronously reenter startSync (including supplied names).
  active = owner;
  const { signal } = owner.controller;
  const { removedCourses } = owner;
  const work = async () => {
    try {
      const chosen = syncedCourses(owner.accountId);
      const ids = (request.courseIds ?? Object.keys(chosen)).filter((id) => chosen[id]?.length);
      if (!ids.length || signal.aborted) return;
      const names = request.names ?? (await courseNames(request.client, signal).catch(() => new Map<string, string>()));
      if (signal.aborted) return;
      const courses: CourseToSync[] = ids.map((id) => ({
        id,
        name: names.get(id) ?? 'Course',
        content: chosen[id] as SyncContent[],
      }));
      const run: SyncRun = {
        accountId: request.account.id,
        reason: request.reason ?? 'manual',
        courses: courses.map((c) => ({ id: c.id, name: c.name })),
        index: 0,
        progress: null,
        startedAt: Date.now(),
      };
      publishRun(owner, run);
      for (const [index, course] of courses.entries()) {
        if (signal.aborted) break;
        if (removedCourses.has(course.id)) continue;
        run.index = index;
        publishRun(owner, { ...run });
        if (signal.aborted) break;
        if (removedCourses.has(course.id)) continue;
        try {
          const result = await syncCourse(course, {
            account: request.account,
            client: request.client,
            queryClient: liveQueryClient,
            signal,
            onProgress: (progress) => publishRun(owner, { ...run, index, progress }),
          });
          // The network went away: the rest would fail the same way.
          if (!result.ok && result.error?.includes('couldn’t be reached')) break;
        } catch {
          if (removedCourses.has(course.id) && !signal.aborted) continue;
          break;
        }
      }
    } finally {
      if (active === owner) {
        active = null;
        // Clear all ownership before notifying: a listener may admit a new run.
        // A no-selection run releases admission synchronously and publishes nothing.
        if (current) setCurrent(null);
      }
    }
  };
  void work().then(resolve, reject);
  return promise;
}

/** Stops syncing a course and removes what it kept on the device. */
export async function removeCourseSync(accountId: string, courseId: string) {
  if (active?.accountId === accountId) active.removedCourses.add(courseId);
  const settled = revokeSync(accountId, courseId);
  const fileIds = courseStatus(accountId, courseId)?.fileIds ?? [];
  // Clear immediately, then once more after in-flight native writes have settled.
  removeCourseAssets(accountId, courseId);
  removeCourseSnapshot(accountId, courseId);
  setCourseStatus(accountId, courseId, null);
  await settled;
  for (const id of fileIds) removeDownload(accountId, id, 'kept');
  removeCourseAssets(accountId, courseId);
  for (const id of courseStatus(accountId, courseId)?.fileIds ?? []) removeDownload(accountId, id, 'kept');
  removeCourseSnapshot(accountId, courseId);
  setCourseStatus(accountId, courseId, null);
}

// Removing an account removes its synced courses (AUTH-10). Kept files go with its download folders.
registerAccountCleanup(async (accountId) => {
  if (active?.accountId === accountId) active.controller.abort();
  const settled = revokeSync(accountId);
  removeAccountAssets(accountId);
  removeAccountSnapshots(accountId);
  await settled;
  removeAccountAssets(accountId);
  removeAccountSnapshots(accountId);
});

// --- Auto-sync ------------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60_000;

function autoSyncDue(accountId: string): boolean {
  const { schedule } = syncSettingsStore.get();
  if (schedule === 'off') return false;
  const last = syncStatusStore.get().autoSyncedAt[accountId] ?? 0;
  const every = schedule === 'daily' ? DAY_MS : 7 * DAY_MS;
  // A little early is fine: background runs come when the system decides.
  return Date.now() - last >= every - 60 * 60_000;
}

/** Whether the connection suits an automatic sync right now. */
async function connectionAllows(): Promise<boolean> {
  if (!isOnline()) return false;
  if (!syncSettingsStore.get().wifiOnly) return true;
  try {
    const state = await Network.getNetworkStateAsync();
    return state.type === Network.NetworkStateType.WIFI || state.type === Network.NetworkStateType.ETHERNET;
  } catch {
    return false;
  }
}

/**
 * Syncs every account whose schedule is due. The background task calls this;
 * so does the app when it opens, since the system may rarely run the task.
 */
export async function runAutoSync(): Promise<{ synced: number }> {
  syncSettingsStore.reload();
  syncStatusStore.reload();
  if (syncSettingsStore.get().schedule === 'off' || !(await connectionAllows())) return { synced: 0 };
  let synced = 0;
  for (const { account, client } of await loadStoredClients()) {
    if (!Object.keys(syncedCourses(account.id)).length || !autoSyncDue(account.id)) continue;
    // A manual run already in progress cannot count as this account's scheduled sync.
    if (active) return { synced };
    const startedAt = Date.now();
    await startSync({ account, client, reason: 'auto' });
    const selected = Object.keys(syncedCourses(account.id));
    const completed = selected.length > 0 && selected.every((id) => {
      const status = courseStatus(account.id, id);
      // Online-only embeds remain visible as partial coverage, but immediately
      // retrying cannot cache them. Actual request/download failures still retry.
      return status?.syncedAt && status.syncedAt >= startedAt && !status.error &&
        status.skipped === (status.unsupportedEmbeds ?? 0);
    });
    if (!completed) continue;
    synced += 1;
    syncStatusStore.update((s) => ({ ...s, autoSyncedAt: { ...s.autoSyncedAt, [account.id]: Date.now() } }));
  }
  return { synced };
}

/**
 * Lets syncs update the live query cache and runs auto-sync when the app
 * opens. Render once, inside the query provider.
 */
export function useCourseSyncRuntime(queryClient: QueryClient) {
  const { status } = useSession();
  useEffect(() => {
    liveQueryClient = queryClient;
    return () => {
      if (liveQueryClient === queryClient) liveQueryClient = null;
    };
  }, [queryClient]);

  useEffect(() => {
    if (status !== 'ready') return;
    const soon = setTimeout(() => void runAutoSync().catch(() => {}), 10_000);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void runAutoSync().catch(() => {});
    });
    return () => {
      clearTimeout(soon);
      sub.remove();
    };
  }, [status]);
}
