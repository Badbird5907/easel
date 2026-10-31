import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { useCanvas } from '@/canvas/session';

/**
 * Hidden calendars are stored rather than shown ones, so a new course appears
 * without the student having to turn it on.
 */
const storageKey = (accountId: string) => `easel.calendar.hidden.${accountId}`;

/** Read once per account per launch, so returning to the tab doesn't flash. */
const cache = new Map<string, string[]>();

async function load(accountId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(accountId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

/** Which calendars the student has hidden on the Calendar tab, saved per account. */
export function useHiddenCalendars() {
  const { account } = useCanvas();
  const [loaded, setLoaded] = useState<{ accountId: string; codes: string[] } | null>(null);

  useEffect(() => {
    if (cache.has(account.id)) return;
    let cancelled = false;
    load(account.id).then((codes) => {
      cache.set(account.id, codes);
      if (!cancelled) setLoaded({ accountId: account.id, codes });
    });
    return () => {
      cancelled = true;
    };
  }, [account.id]);

  const codes = loaded?.accountId === account.id ? loaded.codes : (cache.get(account.id) ?? null);

  const save = (next: string[]) => {
    cache.set(account.id, next);
    setLoaded({ accountId: account.id, codes: next });
    AsyncStorage.setItem(storageKey(account.id), JSON.stringify(next)).catch(() => {});
  };

  return {
    /** Null until the saved choice loads. */
    hidden: codes ? new Set(codes) : null,
    toggle: (code: string) => {
      const current = codes ?? [];
      save(current.includes(code) ? current.filter((c) => c !== code) : [...current, code]);
    },
    setHidden: (next: string[]) => save(next),
  };
}
