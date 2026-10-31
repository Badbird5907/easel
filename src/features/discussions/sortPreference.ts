import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { registerAccountCleanup } from '@/canvas/session';

/*
 * The order the student reads replies in, newest or oldest first, remembered
 * per topic and as a default for topics they haven't sorted yet. Kept on the
 * device per account. Topics whose order the instructor locked ignore it.
 */

export type ReplySort = 'desc' | 'asc';

type Prefs = { last: ReplySort | null; topics: Record<string, ReplySort> };

/** Topics remembered at most; the oldest choices drop off first. */
const MAX_TOPICS = 300;

const storageKey = (accountId: string) =>
  `easel.discussions.sort.${accountId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

const empty = (): Prefs => ({ last: null, topics: {} });
const cache = new Map<string, Prefs>();
const loading = new Map<string, Promise<Prefs>>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function load(accountId: string): Promise<Prefs> {
  const cached = cache.get(accountId);
  if (cached) return Promise.resolve(cached);
  const pending = loading.get(accountId);
  if (pending) return pending;
  const promise = AsyncStorage.getItem(storageKey(accountId))
    .then((raw) => (raw ? { ...empty(), ...(JSON.parse(raw) as Prefs) } : empty()))
    .catch(empty)
    .then((prefs) => {
      cache.set(accountId, prefs);
      loading.delete(accountId);
      emit();
      return prefs;
    });
  loading.set(accountId, promise);
  return promise;
}

async function save(accountId: string, topicKey: string, sort: ReplySort) {
  const current = await load(accountId);
  // Re-inserting moves the topic to the end, so trimming drops the oldest choices.
  const { [topicKey]: _previous, ...rest } = current.topics;
  const entries = Object.entries({ ...rest, [topicKey]: sort });
  const next: Prefs = { last: sort, topics: Object.fromEntries(entries.slice(-MAX_TOPICS)) };
  cache.set(accountId, next);
  emit();
  await AsyncStorage.setItem(storageKey(accountId), JSON.stringify(next)).catch(() => {});
}

registerAccountCleanup(async (accountId) => {
  cache.delete(accountId);
  await AsyncStorage.removeItem(storageKey(accountId)).catch(() => {});
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * The reply order for a topic: what the student picked for it, else the order
 * they picked last anywhere, else the topic's own default. `locked` topics
 * always use the instructor's order.
 */
export function useReplySort(
  accountId: string,
  topicKey: string,
  fallback: ReplySort,
  locked: boolean,
): [ReplySort, (sort: ReplySort) => void] {
  useEffect(() => {
    load(accountId).catch(() => {});
  }, [accountId]);
  const remembered = useSyncExternalStore(subscribe, () => {
    const prefs = cache.get(accountId);
    return prefs ? (prefs.topics[topicKey] ?? prefs.last) : null;
  });
  const set = useCallback(
    (sort: ReplySort) => {
      save(accountId, topicKey, sort).catch(() => {});
    },
    [accountId, topicKey],
  );
  return [locked ? fallback : (remembered ?? fallback), set];
}
