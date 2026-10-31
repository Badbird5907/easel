import { useSyncExternalStore } from 'react';

import { JsonStore } from './storage';

/*
 * Easel's own notification settings (SET-5): which updates alert, quiet
 * hours, and the default due-date reminder. Device-wide, for every account.
 */

export type UpdateCategory = 'grades' | 'comments' | 'announcements' | 'messages' | 'assignments' | 'discussions' | 'calendar' | 'other';

export const updateCategories: { value: UpdateCategory; label: string; detail: string }[] = [
  { value: 'discussions', label: 'Discussions', detail: 'Discussions and mentions from Canvas Student' },
  { value: 'calendar', label: 'Calendar', detail: 'Calendar updates from Canvas Student' },
  { value: 'other', label: 'Other Canvas alerts', detail: 'Unrecognized alerts from Canvas Student' },
  { value: 'grades', label: 'Grades', detail: 'New and changed grades, once they’re posted' },
  { value: 'comments', label: 'Submission comments', detail: 'Feedback on your work' },
  { value: 'announcements', label: 'Announcements', detail: 'New announcements in your courses' },
  { value: 'messages', label: 'Inbox messages', detail: 'New messages in your Canvas inbox' },
  { value: 'assignments', label: 'New assignments', detail: 'Work that just appeared in your courses' },
];

export type QuietHours = {
  enabled: boolean;
  /** Minutes after midnight, local time. */
  start: number;
  end: number;
};

export type NotificationSettings = {
  bridgeEnabled: boolean;
  bridgeHideCopy: boolean;
  updates: Record<UpdateCategory, boolean>;
  /** Due-date reminders the student set. Off cancels them without deleting them. */
  reminders: boolean;
  quietHours: QuietHours;
  /** Added to every new assignment with a due date. Null is off. */
  defaultReminderMinutes: number | null;
};

const defaults: NotificationSettings = {
  bridgeEnabled: false,
  bridgeHideCopy: true,
  updates: { grades: true, comments: true, announcements: true, messages: true, assignments: true, discussions: true, calendar: true, other: true },
  reminders: true,
  quietHours: { enabled: false, start: 22 * 60, end: 7 * 60 },
  defaultReminderMinutes: null,
};

export const settingsStore = new JsonStore<NotificationSettings>(
  'settings',
  () => defaults,
  // Fill in fields added after the settings were first saved.
  (stored) => ({
    ...defaults,
    ...stored,
    updates: { ...defaults.updates, ...stored.updates },
    quietHours: { ...defaults.quietHours, ...stored.quietHours },
  }),
);

export function getSettings(): NotificationSettings {
  return settingsStore.get();
}

export function updateSettings(change: (current: NotificationSettings) => NotificationSettings) {
  settingsStore.update(change);
}

export function useNotificationSettings(): NotificationSettings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get);
}

/** Whether `date` falls in quiet hours. Handles spans over midnight, like 10 PM to 7 AM. */
export function inQuietHours(date: Date, quiet: QuietHours = getSettings().quietHours): boolean {
  if (!quiet.enabled || quiet.start === quiet.end) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return quiet.start < quiet.end
    ? minutes >= quiet.start && minutes < quiet.end
    : minutes >= quiet.start || minutes < quiet.end;
}

/** Bookkeeping for background checks. */
export type CheckMeta = {
  lastCheckAt: number | null;
  lastResult: { posted: number; accounts: number; failed: number } | null;
};

export const metaStore = new JsonStore<CheckMeta>('meta', () => ({ lastCheckAt: null, lastResult: null }));

export function useCheckMeta(): CheckMeta {
  return useSyncExternalStore(metaStore.subscribe, metaStore.get, metaStore.get);
}
