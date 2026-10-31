import { SQLiteStorage } from 'expo-sqlite/kv-store';

/**
 * Key-value storage for offline state: the write queue, course sync settings
 * and progress, and widget settings. SQLite, so the background task reads
 * what the app wrote.
 */
export const offlineKv = new SQLiteStorage('easel-offline.db');
