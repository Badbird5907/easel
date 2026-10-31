import { useCallback, useSyncExternalStore } from 'react';

import { JsonStore, keysWithPrefix } from '@/features/notifications/storage';

import {
  type AccountReminders,
  fireTime,
  type ItemReminders,
  newReminderId,
  type Reminder,
  type ReminderItem,
  type ReminderSpec,
} from './model';

/*
 * Reminders on disk, one record per account. Every change asks the scheduler
 * to bring the system's scheduled notifications in line (schedule.ts).
 */

const PREFIX = 'reminders:';
const stores = new Map<string, JsonStore<AccountReminders>>();

export function remindersFor(accountId: string): JsonStore<AccountReminders> {
  let store = stores.get(accountId);
  if (!store) {
    store = new JsonStore<AccountReminders>(`${PREFIX}${accountId}`, () => ({}));
    stores.set(accountId, store);
  }
  return store;
}

/** Accounts with reminders on this device. */
export function reminderAccountIds(): string[] {
  return keysWithPrefix(PREFIX).map((key) => key.slice(PREFIX.length));
}

const changeListeners = new Set<() => void>();

/** Called after any change, e.g. to reschedule notifications. */
export function onRemindersChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function changed() {
  for (const listener of changeListeners) listener();
}

function updateItem(
  accountId: string,
  item: ReminderItem,
  change: (entry: ItemReminders) => ItemReminders | null,
) {
  const store = remindersFor(accountId);
  store.update((all) => {
    const current = all[item.id] ?? { item, reminders: [] };
    const next = change({ ...current, item: { ...current.item, ...item } });
    const { [item.id]: _removed, ...rest } = all;
    // Keep the record once the default was handled, so it doesn't come back.
    if (!next || (next.reminders.length === 0 && !next.defaultHandled)) return rest;
    return { ...rest, [item.id]: next };
  });
  changed();
}

export function useItemReminders(accountId: string, itemId: string): ItemReminders | null {
  const store = remindersFor(accountId);
  const select = useCallback(() => store.get()[itemId] ?? null, [store, itemId]);
  return useSyncExternalStore(store.subscribe, select, select);
}

const sameSpec = (a: ReminderSpec, b: ReminderSpec) =>
  a.type === 'before' && b.type === 'before'
    ? a.minutes === b.minutes
    : a.type === 'at' && b.type === 'at' && Math.abs(a.at - b.at) < 60_000;

/** Adds a reminder, unless an identical one exists. */
export function addReminder(accountId: string, item: ReminderItem, spec: ReminderSpec) {
  updateItem(accountId, item, (entry) =>
    entry.reminders.some((r) => sameSpec(r, spec))
      ? entry
      : {
          ...entry,
          reminders: [...entry.reminders, { ...spec, id: newReminderId(), source: 'user' } as Reminder],
        },
  );
}

export function removeReminder(accountId: string, item: ReminderItem, reminderId: string) {
  updateItem(accountId, item, (entry) => ({
    ...entry,
    reminders: entry.reminders.filter((r) => r.id !== reminderId),
  }));
}

/** Toggles a preset offset on or off. */
export function toggleOffset(accountId: string, item: ReminderItem, minutes: number) {
  updateItem(accountId, item, (entry) => {
    const existing = entry.reminders.find((r) => r.type === 'before' && r.minutes === minutes);
    return existing
      ? { ...entry, reminders: entry.reminders.filter((r) => r !== existing) }
      : {
          ...entry,
          reminders: [...entry.reminders, { type: 'before', minutes, id: newReminderId(), source: 'user' }],
        };
  });
}

export function clearReminders(accountId: string, item: ReminderItem) {
  updateItem(accountId, item, (entry) => ({ ...entry, reminders: [] }));
}

const sameItem = (a: ReminderItem, b: ReminderItem) =>
  a.title === b.title && a.dueAt === b.dueAt && a.courseId === b.courseId && a.url === b.url;

/**
 * Updates stored item details from fresh data, so reminders follow a changed
 * due date (ASSIGN-14). Only touches items that already have reminders.
 * Returns whether anything changed.
 */
export function refreshItems(accountId: string, items: (Partial<ReminderItem> & { id: string })[]): boolean {
  const store = remindersFor(accountId);
  const all = store.get();
  let next: AccountReminders | null = null;
  for (const fresh of items) {
    const entry: ItemReminders | undefined = (next ?? all)[fresh.id];
    if (!entry) continue;
    const merged: ReminderItem = {
      ...entry.item,
      ...Object.fromEntries(Object.entries(fresh).filter(([, v]) => v !== undefined)),
    } as ReminderItem;
    if (sameItem(merged, entry.item)) continue;
    next = { ...(next ?? all), [fresh.id]: { ...entry, item: merged } };
  }
  if (!next) return false;
  store.set(next);
  changed();
  return true;
}

export type DefaultCandidate = ReminderItem & { done: boolean };

/**
 * Adds the default reminder (SET-5) to work it hasn't been offered for yet,
 * and drops default reminders from work that's already done. Reminders the
 * student set stay put.
 */
export function applyDefaultReminders(
  accountId: string,
  candidates: DefaultCandidate[],
  minutes: number | null,
) {
  const store = remindersFor(accountId);
  const all = store.get();
  const now = Date.now();
  let next: AccountReminders | null = null;
  for (const { done, ...item } of candidates) {
    const entry: ItemReminders | undefined = (next ?? all)[item.id];
    if (done) {
      if (entry?.reminders.some((r) => r.source === 'default')) {
        next = {
          ...(next ?? all),
          [item.id]: { ...entry, reminders: entry.reminders.filter((r) => r.source !== 'default') },
        };
      }
      continue;
    }
    if (minutes === null || entry?.defaultHandled || item.dueAt === null) continue;
    const at = fireTime({ type: 'before', minutes }, item);
    if (at === null || at <= now) continue;
    const reminders = entry?.reminders ?? [];
    const exists = reminders.some((r) => r.type === 'before' && r.minutes === minutes);
    next = {
      ...(next ?? all),
      [item.id]: {
        item: entry?.item ?? item,
        reminders: exists
          ? reminders
          : [...reminders, { type: 'before', minutes, id: newReminderId(), source: 'default' }],
        defaultHandled: true,
      },
    };
  }
  if (!next) return;
  store.set(next);
  changed();
}

/** Moves every default reminder to a new offset, or removes them when the default is turned off. */
export function retargetDefaultReminders(minutes: number | null) {
  for (const accountId of reminderAccountIds()) {
    const store = remindersFor(accountId);
    const all = store.get();
    let touched = false;
    const next: AccountReminders = {};
    for (const [id, entry] of Object.entries(all)) {
      const reminders = entry.reminders.flatMap((r): Reminder[] => {
        if (r.source !== 'default') return [r];
        touched = true;
        if (minutes === null) return [];
        // A student reminder at the same offset already covers it.
        if (entry.reminders.some((o) => o.source === 'user' && o.type === 'before' && o.minutes === minutes))
          return [];
        return [{ ...r, type: 'before', minutes }];
      });
      next[id] = { ...entry, reminders };
    }
    if (touched) store.set(next);
  }
  changed();
}

/**
 * Drops records that can never go off again: every reminder has passed and
 * the due date is more than a week gone.
 */
export function pruneReminders(accountId: string) {
  const store = remindersFor(accountId);
  const all = store.get();
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60_000;
  let removed = false;
  const next: AccountReminders = {};
  for (const [id, entry] of Object.entries(all)) {
    const upcoming = entry.reminders.some((r) => (fireTime(r, entry.item) ?? 0) > now);
    // An offset on an undated item comes back to life if the item gets a due date.
    const waiting = entry.item.dueAt === null && entry.reminders.some((r) => r.type === 'before');
    const gone = entry.item.dueAt === null || entry.item.dueAt < cutoff;
    if (!upcoming && !waiting && gone) removed = true;
    else next[id] = entry;
  }
  if (removed) store.set(next);
}

/** Forgets an account's reminders (AUTH-10). */
export function removeAccountReminders(accountId: string) {
  remindersFor(accountId).clear();
  stores.delete(accountId);
  changed();
}

/** Rereads every account from disk, after the background task may have written. */
export function reloadReminders() {
  for (const store of stores.values()) store.reload();
}
