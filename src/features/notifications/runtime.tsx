import { useEffect } from 'react';
import { AppState } from 'react-native';

import { setBackgroundChecks } from '@/background/tasks';
import { registerAccountCleanup, useSession } from '@/canvas/session';
import { syncReminders, requestReminderSync } from '@/features/reminders/schedule';
import { removeAccountReminders } from '@/features/reminders/store';

import { useSeenFromScreens } from './bridge';
import { checkForUpdates } from './check';
import { dismissPresented, setForegroundHandler, setUpChannels } from './platform';
import { useNotificationRouting } from './routing';
import { removeAccountSeen, updateBadge } from './seen';
import { settingsStore, useNotificationSettings } from './settings';

/*
 * Notifications and reminders while Easel runs: routes taps, learns what the
 * student has seen, checks Canvas on returning to the app, keeps reminders
 * scheduled, and keeps the background task registered.
 */

setForegroundHandler();

// Removing an account cancels its reminders and clears what Easel remembered about it (AUTH-10).
registerAccountCleanup(async (accountId) => {
  removeAccountReminders(accountId);
  removeAccountSeen(accountId);
  await dismissPresented((data) => data.accountId === accountId);
  await syncReminders();
  await updateBadge();
});

/** Waits a moment after the app opens, so screens can mark what they show as seen first. */
const FOREGROUND_DELAY_MS = 4_000;

function useForegroundChecks(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void checkForUpdates('foreground'), FOREGROUND_DELAY_MS);
    };
    soon();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      soon();
      // A reminder may have fired or iOS may have dropped some; top them up.
      requestReminderSync();
    });
    return () => {
      subscription.remove();
      if (timer) clearTimeout(timer);
    };
  }, [signedIn]);
}

function useBackgroundRegistration(hasAccounts: boolean) {
  const settings = useNotificationSettings();
  const wanted = hasAccounts && (settings.reminders || Object.values(settings.updates).some(Boolean));
  useEffect(() => {
    void setBackgroundChecks(wanted);
  }, [wanted]);
}

/** Render once, inside the session and query providers. */
export function NotificationsRuntime() {
  const { status, accounts, active } = useSession();
  const ready = status === 'ready';
  useNotificationRouting();
  useSeenFromScreens();
  useForegroundChecks(ready && !!active && !active.expired);
  useBackgroundRegistration(ready && accounts.length > 0);

  useEffect(() => {
    void setUpChannels();
    void syncReminders();
    void updateBadge();
    // Settings change what's scheduled (reminders off, quiet hours) and what the badge counts.
    return settingsStore.subscribe(() => {
      requestReminderSync();
      void updateBadge();
    });
  }, []);

  return null;
}
