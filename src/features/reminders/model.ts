import { t } from '@/i18n/runtime';
import type { Translate } from '@/i18n/types';
import { createDateContext, type DateContext, dayLabel, daysFrom, formatTime } from '@/lib/dates';

/*
 * Due-date reminders (ASSIGN-14, TODO-7, NOTIF-2): per account and item,
 * either an offset before the due date or a fixed time.
 */

export type ReminderSpec = { type: 'before'; minutes: number } | { type: 'at'; at: number };

export type Reminder = ReminderSpec & {
  id: string;
  /** `default` came from the default reminder setting (SET-5). */
  source: 'user' | 'default';
};

/** What a reminder needs to know about its item. Refreshed whenever a screen shows the item. */
export type ReminderItem = {
  id: string;
  title: string;
  /** Milliseconds; null when the item has no due date. */
  dueAt: number | null;
  courseId: string | null;
  /** In-app route or Canvas URL the notification opens. */
  url: string | null;
};

export type ItemReminders = {
  item: ReminderItem;
  reminders: Reminder[];
  /** The default reminder was added (or the student removed it). It never comes back on its own. */
  defaultHandled?: boolean;
};

/** Everything for one account, by item ID. */
export type AccountReminders = Record<string, ItemReminders>;

export const presetOffsets: { minutes: number }[] = [
  { minutes: 15 },
  { minutes: 60 },
  { minutes: 24 * 60 },
  { minutes: 2 * 24 * 60 },
];

export function offsetLabel(minutes: number, translate: Translate = t): string {
  if (minutes % (24 * 60) === 0) return translate('reminder.daysBefore', { count: minutes / (24 * 60) });
  if (minutes % 60 === 0) return translate('reminder.hoursBefore', { count: minutes / 60 });
  return translate('reminder.minutesBefore', { count: minutes });
}

/** When a reminder goes off, or null if it can't (an offset on an item with no due date). */
export function fireTime(reminder: ReminderSpec, item: Pick<ReminderItem, 'dueAt'>): number | null {
  if (reminder.type === 'at') return reminder.at;
  return item.dueAt === null ? null : item.dueAt - reminder.minutes * 60_000;
}

/** "Fri, Nov 6 at 9:00 AM", or "Today at 9:00 AM" ("today at 9:00 AM" mid-sentence). */
export function formatMoment(at: number, options: { midSentence?: boolean; display?: DateContext } = {}): string {
  const date = new Date(at);
  const now = new Date();
  const display = options.display ?? { t, daysFrom, dayLabel, formatTime };
  const relative: Record<number, string> = {
    [-1]: display.t('date.yesterdayLower'),
    0: display.t('date.todayLower'),
    1: display.t('date.tomorrowLower'),
  };
  const day = (options.midSentence && relative[display.daysFrom(date, now)]) || display.dayLabel(date, now);
  return display.t('date.at', { day, time: display.formatTime(date) });
}

export function describeReminder(reminder: Reminder, display?: DateContext): string {
  return reminder.type === 'before'
    ? offsetLabel(reminder.minutes, display?.t)
    : formatMoment(reminder.at, { display });
}

/** Sorted by when they go off; offsets without a due date last. */
export function sortReminders(reminders: Reminder[], item: ReminderItem): Reminder[] {
  return [...reminders].sort(
    (a, b) => (fireTime(a, item) ?? Number.MAX_SAFE_INTEGER) - (fireTime(b, item) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** The notification's text, as of when it goes off. */
export function reminderText(
  item: ReminderItem,
  at: number,
  display: DateContext = createDateContext(),
): { title: string; body: string } {
  if (item.dueAt === null) return { title: item.title, body: display.t('background.reminder') };
  const due = new Date(item.dueAt);
  const phrase = display.dueIn(due, new Date(at));
  // Events start; everything else is due.
  if (item.id.startsWith('calendar_event_')) {
    return {
      title: item.title,
      body: display.t(at < item.dueAt ? 'background.starts' : 'background.started', { when: phrase }),
    };
  }
  return {
    title: item.title,
    body: display.t(at < item.dueAt ? 'background.due' : 'background.wasDue', { when: phrase }),
  };
}

export function newReminderId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
