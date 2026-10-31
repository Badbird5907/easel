import type { Query } from '@tanstack/react-query';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import Constants from 'expo-constants';

import { isSyncOwned } from '@/features/sync/snapshots';

import { cacheStorage } from './cacheStorage';
import { decodeJson, encodeJson } from './json';

/*
 * The React Query cache on disk (OFF-1), so every screen opens with the last
 * data it showed, even offline or right after a cold start. Stored in its own
 * SQLite key-value database, apart from settings and reminders.
 */

/** How long cached data stays usable. Older data is dropped rather than shown. */
export const CACHE_MAX_AGE = 7 * 24 * 60 * 60_000;

/**
 * Bump when a model's shape changes incompatibly, so restored data never
 * reaches a screen that expects the new shape. App updates drop the cache too.
 */
const CACHE_SCHEMA = 1;

export const cacheBuster = [
  CACHE_SCHEMA,
  Constants.expoConfig?.version ?? '0',
  Constants.nativeBuildVersion ?? '0',
].join(':');

export function serializeCache(client: PersistedClient): string {
  return encodeJson(client);
}

export function deserializeCache(text: string): PersistedClient {
  return decodeJson<PersistedClient>(text);
}

/**
 * Keep the provider's restore gate and sync hydration, but save each query separately.
 * Unchanged data never gets re-serialized. SQLite awaits yield between changed queries,
 * so a small refresh cannot stringify the entire account on the UI thread.
 */
const ROW_PREFIX = 'easel.query.v2:';
const LEGACY_KEY = 'easel.query-cache';
type SavedQuery = PersistedClient['clientState']['queries'][number];
const saved = new Map<string, SavedQuery>();
let writes: Promise<void> = Promise.resolve();
let latestClient: PersistedClient | undefined;

function serial(work: () => Promise<void>): Promise<void> {
  const next = writes.catch(() => {}).then(work);
  writes = next;
  return next;
}

/** Restoring waits at most this long before opening with the rows read so far. */
const RESTORE_LIMIT_MS = 3_000;

/** Reads the saved cache into `queries` as rows arrive; resolves once every row is read. */
async function readSavedClient(queries: SavedQuery[]): Promise<PersistedClient | undefined> {
  // Until migration finishes, the legacy snapshot is the complete copy. A kill
  // halfway through writing rows must not restore only that partial migration.
  const legacy = await cacheStorage.getItem(LEGACY_KEY);
  if (legacy) {
    try {
      const client = deserializeCache(legacy);
      if (client.buster === cacheBuster && client.timestamp > Date.now() - CACHE_MAX_AGE) return client;
    } catch {
      // Recover any independently valid rows below.
    }
    await cacheStorage.removeItem(LEGACY_KEY);
  }
  const keys = (await cacheStorage.getAllKeys()).filter((key) => key.startsWith(ROW_PREFIX));
  await Promise.all(
    keys.map(async (key) => {
      try {
        const text = await cacheStorage.getItem(key);
        if (!text) return;
        const row = deserializeCache(text);
        const query = row.clientState.queries[0];
        if (row.buster !== cacheBuster || !query || query.state.dataUpdatedAt <= Date.now() - CACHE_MAX_AGE) {
          await cacheStorage.removeItem(key);
          return;
        }
        queries.push(query);
        saved.set(query.queryHash, query);
      } catch {
        // A corrupt row must not discard every other cached screen.
        await cacheStorage.removeItem(key);
      }
    }),
  );
  if (queries.length)
    return {
      buster: cacheBuster,
      timestamp: Date.now(),
      clientState: { mutations: [], queries },
    };
  return undefined;
}

export const cachePersister: Persister = {
  persistClient: (client) => {
    latestClient = client;
    return serial(async () => {
      // Coalesce to the newest snapshot, but finish its write before resolving any
      // caller (especially account cleanup, which must not return before deletion).
      client = latestClient ?? client;
      const current = new Set(client.clientState.queries.map((query) => query.queryHash));
      for (const key of await cacheStorage.getAllKeys()) {
        if (key.startsWith(ROW_PREFIX) && !current.has(key.slice(ROW_PREFIX.length))) {
          await cacheStorage.removeItem(key);
          saved.delete(key.slice(ROW_PREFIX.length));
        }
      }
      for (const query of client.clientState.queries) {
        const previous = saved.get(query.queryHash);
        if (
          previous &&
          previous.state.data === query.state.data &&
          previous.state.dataUpdatedAt === query.state.dataUpdatedAt
        )
          continue;
        const row: PersistedClient = {
          buster: client.buster,
          timestamp: client.timestamp,
          clientState: { mutations: [], queries: [query] },
        };
        await cacheStorage.setItem(ROW_PREFIX + query.queryHash, serializeCache(row));
        saved.set(query.queryHash, query);
      }
      await cacheStorage.removeItem(LEGACY_KEY);
    });
  },
  restoreClient: async () => {
    // A stuck read must never hold the app on the splash screen. Past the limit,
    // the app opens with whatever rows were already read.
    const queries: SavedQuery[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<'limit'>((resolve) => {
      timer = setTimeout(() => resolve('limit'), RESTORE_LIMIT_MS);
    });
    const result = await Promise.race([readSavedClient(queries), limit]);
    clearTimeout(timer);
    if (result !== 'limit') return result;
    return queries.length
      ? { buster: cacheBuster, timestamp: Date.now(), clientState: { mutations: [], queries: [...queries] } }
      : undefined;
  },
  removeClient: () => {
    latestClient = undefined;
    return serial(async () => {
      for (const key of await cacheStorage.getAllKeys()) {
        if (key.startsWith(ROW_PREFIX) || key === LEGACY_KEY) await cacheStorage.removeItem(key);
      }
      saved.clear();
    });
  },
};

/**
 * Only data worth showing again: successful, recent, and not opted out with
 * `meta: { persist: false }`. Failed queries are never written. Data a course
 * sync saved on its own (OFF-3) isn't written twice; it comes back from the
 * sync snapshot.
 */
export function shouldPersistQuery(query: Query): boolean {
  return (
    query.state.status === 'success' &&
    query.state.data !== undefined &&
    query.state.dataUpdatedAt > Date.now() - CACHE_MAX_AGE &&
    query.meta?.persist !== false &&
    !isSyncOwned(query.queryHash, query.state.dataUpdatedAt)
  );
}
