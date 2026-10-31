import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query } from '@tanstack/react-query';
import {
  removeOldestQuery,
  type PersistedClient,
  type Persister,
} from '@tanstack/react-query-persist-client';
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

/** Restoring waits at most this long, so a slow disk never holds the app on the splash screen. */
const RESTORE_TIMEOUT_MS = 2_500;

function withRestoreTimeout(persister: Persister): Persister {
  return {
    ...persister,
    restoreClient: () =>
      Promise.race([
        Promise.resolve(persister.restoreClient()).catch(() => undefined),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), RESTORE_TIMEOUT_MS)),
      ]),
  };
}

export const cachePersister = withRestoreTimeout(
  createAsyncStoragePersister({
    storage: cacheStorage,
    key: 'easel.query-cache',
    throttleTime: 2_000,
    serialize: serializeCache,
    deserialize: deserializeCache,
    // A save too large for storage drops the oldest queries until it fits.
    retry: removeOldestQuery,
  }),
);

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
