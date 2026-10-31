// Registers the offline runtime and the write queue's handlers before anything runs (OFF-2).
import '@/features/offline/runtime';

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { checkForUpdates, type CheckResult } from '@/features/notifications/check';
import { setBackgroundRegistrar, setBackgroundWant } from '@/features/offline/background';
import { flushQueue } from '@/features/offline/queue';
import { cancelSync, runAutoSync } from '@/features/sync/runner';
import { refreshWidgets } from '@/features/widgets/publish';

/*
 * Background refresh. The task must be defined when the JS bundle loads,
 * before any screen mounts, because the system can launch Easel just to run
 * it. The root layout imports this file first thing. Each run:
 *   1. checks Canvas for news and posts notifications (NOTIF-3), and sends
 *      writes queued while offline (OFF-2)
 *   2. refreshes the home screen widgets (SYS-1)
 *   3. syncs courses whose daily or weekly sync is due (OFF-3)
 *
 * WorkManager (Android) and BGTaskScheduler (iOS) decide when it runs: at
 * least 30 minutes apart, usually less often, and only with a network.
 */

export const UPDATE_CHECK_TASK = 'easel-update-check';

/** Minutes between runs, at the least. */
const MINIMUM_INTERVAL = 30;

TaskManager.defineTask(UPDATE_CHECK_TASK, async () => {
  // iOS can stop a run at any time; a sync in progress keeps what it saved so far.
  const expiry = safeExpirationListener(cancelSync);
  try {
    const [check] = await Promise.allSettled([
      checkForUpdates('background'),
      flushQueue(),
      refreshWidgets(),
    ]);
    await runAutoSync().catch(() => {});
    if (check.status === 'rejected') return BackgroundTask.BackgroundTaskResult.Failed;
    const result = check.value;
    return result.accounts > 0 && result.failed === result.accounts
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  } finally {
    expiry?.remove();
  }
});

function safeExpirationListener(listener: () => void) {
  try {
    return BackgroundTask.addExpirationListener(listener);
  } catch {
    // Android has no expiration event.
    return null;
  }
}

/** False on iOS simulators and anywhere else the system won't run background work. */
export async function backgroundChecksAvailable(): Promise<boolean> {
  try {
    return (await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available;
  } catch {
    return false;
  }
}

async function applyRegistration(enabled: boolean) {
  if (!(await backgroundChecksAvailable())) return;
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(UPDATE_CHECK_TASK);
    if (enabled && !registered) {
      await BackgroundTask.registerTaskAsync(UPDATE_CHECK_TASK, { minimumInterval: MINIMUM_INTERVAL });
    } else if (!enabled && registered) {
      await BackgroundTask.unregisterTaskAsync(UPDATE_CHECK_TASK);
    }
  } catch {
    // Not configured in this build; foreground checks still run.
  }
}

setBackgroundRegistrar(applyRegistration);

/** Turns periodic notification checks on or off. Safe to call repeatedly. */
export async function setBackgroundChecks(enabled: boolean) {
  setBackgroundWant('notifications', enabled);
}

/**
 * Developer tool: asks the system to run the background task now
 * (`triggerTaskWorkerForTestingAsync`, debug builds only). Where the system
 * can't run background work, like the iOS simulator, it runs the same check
 * in the app instead.
 */
export async function runBackgroundCheckNow(): Promise<
  { via: 'system' } | { via: 'app'; result: CheckResult }
> {
  if (await backgroundChecksAvailable()) {
    await setBackgroundChecks(true);
    // Registration waits for wants to settle; this needs the task registered now.
    await applyRegistration(true);
    try {
      if (await BackgroundTask.triggerTaskWorkerForTestingAsync()) return { via: 'system' };
    } catch {
      // Fall through to running it here.
    }
  }
  const [result] = await Promise.all([checkForUpdates('manual'), flushQueue().catch(() => null)]);
  await refreshWidgets().catch(() => {});
  return { via: 'app', result };
}
