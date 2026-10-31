import { SQLiteStorage } from 'expo-sqlite/kv-store';

/** Key-value storage for notification state: SQLite on iOS and Android, so the background task can read it. */
export const kv = new SQLiteStorage('easel-notifications.db');
