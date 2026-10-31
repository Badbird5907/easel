import { SQLiteStorage } from 'expo-sqlite/kv-store';

/** Where the query cache is saved: its own SQLite key-value database. */
export const cacheStorage = new SQLiteStorage('easel-query-cache.db');
