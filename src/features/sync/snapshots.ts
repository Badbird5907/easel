import { hashKey, type QueryKey } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';

import { decodeJson, encodeJson } from '@/features/offline/json';
import { LocalStore } from '@/features/offline/store';

/*
 * What a course sync saved (OFF-3): every query a synced course's screens
 * use, one file per course under Documents, so the OS never purges it. The
 * query cache reads from here lazily: `useCanvasQuery` asks for a key's synced
 * copy only when nothing is cached for it, and the file loads on first use.
 * The small index (query hash to time) lives in SQLite so the lookup is cheap.
 *
 * Synced data is kept out of the persisted query cache (`isSyncOwned`) so it
 * isn't stored twice.
 */

type IndexEntry = { updatedAt: number; hashes: Record<string, number> };

type SyncIndex = {
  /** Models change shape between app versions; a mismatch ignores old snapshots. */
  buster: string;
  accounts: Record<string, Record<string, IndexEntry>>;
};

const SNAPSHOT_SCHEMA = 1;
const buster = [
  SNAPSHOT_SCHEMA,
  Constants.expoConfig?.version ?? '0',
  Constants.nativeBuildVersion ?? '0',
].join(':');

export const snapshotIndex = new LocalStore<SyncIndex>(
  'sync.index',
  () => ({ buster, accounts: {} }),
  (stored) => (stored.buster === buster ? stored : { buster, accounts: {} }),
);

type Located = { accountId: string; courseId: string; updatedAt: number };

let located: Map<string, Located> | null = null;
let locatedFor: SyncIndex | null = null;

/** Query hash to the course snapshot that holds it, rebuilt when the index changes. */
function locator(): Map<string, Located> {
  const index = snapshotIndex.get();
  if (located && locatedFor === index) return located;
  const map = new Map<string, Located>();
  for (const [accountId, courses] of Object.entries(index.accounts)) {
    for (const [courseId, entry] of Object.entries(courses)) {
      for (const [hash, updatedAt] of Object.entries(entry.hashes))
        map.set(hash, { accountId, courseId, updatedAt });
    }
  }
  located = map;
  locatedFor = index;
  return map;
}

const safe = (part: string) => part.replace(/[^A-Za-z0-9._-]/g, '_');

export function snapshotDirectory(accountId: string) {
  return new Directory(Paths.document, 'easel-sync', safe(accountId));
}

function snapshotFile(accountId: string, courseId: string) {
  return new File(snapshotDirectory(accountId), `${safe(courseId)}.json`);
}

type StoredEntry = { key: QueryKey; updatedAt: number; data: unknown };
type Snapshot = Record<string, StoredEntry>;

const loaded = new Map<string, Snapshot>();

function readSnapshot(accountId: string, courseId: string): Snapshot | null {
  const id = `${accountId}/${courseId}`;
  const cached = loaded.get(id);
  if (cached) return cached;
  try {
    const file = snapshotFile(accountId, courseId);
    if (!file.exists) return null;
    const snapshot = decodeJson<Snapshot>(file.textSync());
    loaded.set(id, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

/** The synced copy of a query (key includes the account ID), if a course sync saved one. */
export function syncedQueryData<T>(queryKey: QueryKey): { data: T; updatedAt: number } | null {
  const hash = hashKey(queryKey);
  const where = locator().get(hash);
  if (!where) return null;
  const entry = readSnapshot(where.accountId, where.courseId)?.[hash];
  return entry ? { data: entry.data as T, updatedAt: entry.updatedAt } : null;
}

/** True when the cached copy is the one a sync saved, so the cache needn't persist it. */
export function isSyncOwned(queryHash: string, dataUpdatedAt: number): boolean {
  const where = locator().get(queryHash);
  return !!where && where.updatedAt >= dataUpdatedAt;
}

export type SnapshotEntry = { queryKey: QueryKey; data: unknown; updatedAt: number };

/** Replaces a course's snapshot. Returns its size on disk in bytes. */
export function saveCourseSnapshot(accountId: string, courseId: string, entries: SnapshotEntry[]): number {
  const snapshot: Snapshot = {};
  const hashes: Record<string, number> = {};
  for (const entry of entries) {
    const hash = hashKey(entry.queryKey);
    snapshot[hash] = { key: entry.queryKey, updatedAt: entry.updatedAt, data: entry.data };
    hashes[hash] = entry.updatedAt;
  }
  const dir = snapshotDirectory(accountId);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = snapshotFile(accountId, courseId);
  file.writeSync(encodeJson(snapshot));
  loaded.set(`${accountId}/${courseId}`, snapshot);
  snapshotIndex.update((index) => ({
    ...index,
    accounts: {
      ...index.accounts,
      [accountId]: { ...index.accounts[accountId], [courseId]: { updatedAt: Date.now(), hashes } },
    },
  }));
  return file.size ?? 0;
}

/** Everything a course's last sync saved, for merging into a sync that stopped partway. */
export function courseSnapshotEntries(accountId: string, courseId: string): SnapshotEntry[] {
  const snapshot = readSnapshot(accountId, courseId);
  if (!snapshot) return [];
  return Object.values(snapshot).map((e) => ({ queryKey: e.key, data: e.data, updatedAt: e.updatedAt }));
}

export function removeCourseSnapshot(accountId: string, courseId: string) {
  loaded.delete(`${accountId}/${courseId}`);
  try {
    const file = snapshotFile(accountId, courseId);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
  snapshotIndex.update((index) => {
    const courses = { ...index.accounts[accountId] };
    delete courses[courseId];
    return { ...index, accounts: { ...index.accounts, [accountId]: courses } };
  });
}

export function removeAccountSnapshots(accountId: string) {
  for (const key of [...loaded.keys()]) if (key.startsWith(`${accountId}/`)) loaded.delete(key);
  try {
    const dir = snapshotDirectory(accountId);
    if (dir.exists) dir.delete();
  } catch {
    // Already gone.
  }
  snapshotIndex.update((index) => {
    const accounts = { ...index.accounts };
    delete accounts[accountId];
    return { ...index, accounts };
  });
}

/** Bytes a course's snapshot takes on disk. */
export function snapshotSize(accountId: string, courseId: string): number {
  try {
    const file = snapshotFile(accountId, courseId);
    return file.exists ? (file.size ?? 0) : 0;
  } catch {
    return 0;
  }
}
