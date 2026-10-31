import { useSyncExternalStore } from 'react';

import { upcomingRange, usePlannerItems } from '@/canvas/api/planner';
import { useCanvas } from '@/canvas/session';
import { JsonStore } from '@/features/notifications/storage';
import { useNow } from '@/features/reminders/useNow';
import { countDueNow } from './dueCount';
import { startOfDay, useDisplayTimeZone } from '@/lib/dates';

/*
 * The To Do tab's badge (TODO-6): how many open items are overdue or due
 * today. Off until the student turns it on, per account.
 */

const stores = new Map<string, JsonStore<boolean>>();

function badgeStore(accountId: string) {
  let store = stores.get(accountId);
  if (!store) {
    store = new JsonStore<boolean>(`todo:badge:${accountId}`, () => false);
    stores.set(accountId, store);
  }
  return store;
}

/** Whether the To Do tab shows its count, with a setter. */
export function useTodoBadgeSetting(): [boolean, (on: boolean) => void] {
  const { account } = useCanvas();
  const store = badgeStore(account.id);
  const on = useSyncExternalStore(store.subscribe, store.get);
  return [on, (next) => store.set(next)];
}

export { countDueNow } from './dueCount';

/**
 * The badge count, or null when the badge is off. Reads the same planner
 * list as Home and To Do, so marking something done updates it at once.
 */
export function useTodoBadgeCount(): number | null {
  useDisplayTimeZone();
  const [on] = useTodoBadgeSetting();
  const [now] = useNow(60_000);
  const day = startOfDay(new Date(now)).getTime();
  const range = upcomingRange(new Date(day));
  const planner = usePlannerItems(range, { enabled: on });
  if (!on || !planner.data) return null;
  return countDueNow(planner.data, new Date(now));
}
