import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { fetchUnreadCount } from '@/canvas/api/notifications';
import { loadStoredClients, registerAccountCleanup, useSession } from '@/canvas/session';
import { createTranslator, displayLocale, formatNumber, t } from '@/i18n/runtime';
import type { Translate } from '@/i18n/types';

/*
 * Unread Inbox counts for every signed-in account (ACCT-5), for the account
 * switcher and Settings. One request per account at most every couple of
 * minutes, only while a screen that shows them is open, and again when the
 * app comes back to the foreground. A failed refresh keeps the last count.
 */

/** How old a count can be before showing it again triggers a refresh. */
const MAX_AGE_MS = 2 * 60_000;

type Entry = { count: number; fetchedAt: number };

let counts: Record<string, number> = {};
const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function emit() {
  counts = Object.fromEntries([...entries].map(([id, e]) => [id, e.count]));
  for (const listener of listeners) listener();
}

registerAccountCleanup((accountId) => {
  entries.delete(accountId);
  emit();
});

/** Refreshes counts older than `maxAge` (all of them with `force`). Never throws. */
export async function refreshAccountBadges({ force = false }: { force?: boolean } = {}) {
  const stored = await loadStoredClients().catch(() => []);
  const now = Date.now();
  await Promise.all(
    stored.map(({ account, client }) => {
      const entry = entries.get(account.id);
      if (!force && entry && now - entry.fetchedAt < MAX_AGE_MS) return Promise.resolve();
      let running = inflight.get(account.id);
      if (!running) {
        running = fetchUnreadCount(client)
          .then((count) => {
            entries.set(account.id, { count, fetchedAt: Date.now() });
            emit();
          })
          .catch(() => {})
          .finally(() => inflight.delete(account.id));
        inflight.set(account.id, running);
      }
      return running;
    }),
  );
}

/** Sets one account's count, e.g. after reading messages, without a request. */
export function setAccountBadge(accountId: string, count: number) {
  entries.set(accountId, { count, fetchedAt: Date.now() });
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getCounts = () => counts;

/**
 * Unread Inbox counts by account ID. Missing means not loaded yet (or the
 * account needs signing in again). Refreshes stale counts while mounted.
 */
export function useAccountBadges({ active = true }: { active?: boolean } = {}): Record<string, number> {
  const value = useSyncExternalStore(subscribe, getCounts, getCounts);
  // A newly added or re-signed-in account gets its count right away.
  const accountKey = useSession()
    .accounts.map((a) => `${a.id}:${a.expired ? 0 : 1}`)
    .join(',');
  useEffect(() => {
    if (!active) return;
    refreshAccountBadges();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshAccountBadges();
    });
    return () => sub.remove();
  }, [active, accountKey]);
  return value;
}

/** "3 unread messages", for screen readers. */
export function unreadLabel(count: number | undefined, translate: Translate = t): string | null {
  if (!count) return null;
  return translate('accounts.unread', { count });
}

/** Badge text: counts past 99 read as "99+". */
export function badgeText(count: number, locale = displayLocale()): string {
  return count > 99
    ? createTranslator(locale)('nav.badgeOverflow', { count: 99 })
    : formatNumber(count, undefined, locale);
}
