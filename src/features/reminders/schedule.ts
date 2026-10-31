import { isStoredAccountLifetime, loadStoredAccountLifetimes } from '@/canvas/session';
import { accountDateContext, onDisplayPreferencesChanged } from '@/i18n/account-preferences';
import * as Notifications from 'expo-notifications';

import { scheduleAt } from '@/features/notifications/platform';
import { getSettings, inQuietHours } from '@/features/notifications/settings';

import { fireTime, reminderText } from './model';
import { onRemindersChanged, pruneReminders, reminderAccountIds, remindersFor } from './store';

/*
 * Keeps the system's scheduled notifications in line with stored reminders.
 * iOS holds at most 64 pending local notifications per app, so only the
 * soonest ones are scheduled; the rest go in on a later sync (app launch,
 * foreground, background refresh, or any reminder change).
 */

const PREFIX = 'easel-reminder:';
const MAX_SCHEDULED = 48;
/** Reminders closer than this are skipped: the system may not deliver them in time to matter. */
const MIN_LEAD_MS = 5_000;

/** A short stable hash, so a reminder's identifier changes whenever its content or time does. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

type Planned = {
  identifier: string;
  at: number;
  accountId: string;
  itemId: string;
  courseId: string | null;
  url: string | null;
  title: string;
  body: string;
};

function plan(now: number, allowed: Set<string>): Planned[] {
  if (!getSettings().reminders) return [];
  const planned: Planned[] = [];
  for (const accountId of reminderAccountIds()) {
    if (!allowed.has(accountId)) continue;
    const display = accountDateContext(accountId);
    pruneReminders(accountId);
    for (const entry of Object.values(remindersFor(accountId).get())) {
      for (const reminder of entry.reminders) {
        const at = fireTime(reminder, entry.item);
        if (at === null || at <= now + MIN_LEAD_MS) continue;
        const text = reminderText(entry.item, at, display);
        const quiet = inQuietHours(new Date(at)) ? 'q' : '';
        planned.push({
          identifier: `${PREFIX}${hash([accountId, entry.item.id, reminder.id, at, text.title, text.body, quiet].join('|'))}`,
          at,
          accountId,
          itemId: entry.item.id,
          courseId: entry.item.courseId,
          url: entry.item.url,
          ...text,
        });
      }
    }
  }
  return planned.sort((a, b) => a.at - b.at).slice(0, MAX_SCHEDULED);
}

async function sync() {
  const accounts = await loadStoredAccountLifetimes();
  // Failed index reads cannot establish that an account was removed.
  if (accounts === null) return;
  const current = (id: string) =>
    accounts.some((lifetime) => lifetime.accountId === id && isStoredAccountLifetime(lifetime));
  const wanted = plan(
    Date.now(),
    new Set(accounts.filter((lifetime) => current(lifetime.accountId)).map((lifetime) => lifetime.accountId)),
  );
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync()).filter((n) =>
    n.identifier.startsWith(PREFIX),
  );
  const keep = new Set(wanted.filter((p) => current(p.accountId)).map((p) => p.identifier));
  await Promise.all(
    scheduled
      .filter((n) => !keep.has(n.identifier))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})),
  );
  const existing = new Set(scheduled.map((n) => n.identifier));
  for (const p of wanted) {
    if (!current(p.accountId)) {
      if (existing.has(p.identifier))
        await Notifications.cancelScheduledNotificationAsync(p.identifier).catch(() => {});
      continue;
    }
    if (existing.has(p.identifier)) continue;
    await scheduleAt(
      p.identifier,
      new Date(p.at),
      { title: p.title, body: p.body },
      { kind: 'reminder', accountId: p.accountId, path: null, url: p.url, courseId: p.courseId },
    ).catch(() => {});
    // Removal can race native scheduling; undo a late completion.
    if (!current(p.accountId))
      await Notifications.cancelScheduledNotificationAsync(p.identifier).catch(() => {});
  }
}

let chain: Promise<void> = Promise.resolve();

/** Brings scheduled notifications in line with stored reminders. Runs one at a time. */
export function syncReminders(): Promise<void> {
  chain = chain.then(sync, sync).catch(() => {});
  return chain;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Syncs shortly, so a burst of changes schedules once. */
export function requestReminderSync() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncReminders();
  }, 300);
}

onRemindersChanged(requestReminderSync);

onDisplayPreferencesChanged(requestReminderSync);
