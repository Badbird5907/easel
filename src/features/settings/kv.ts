import { SQLiteStorage } from 'expo-sqlite/kv-store';

/**
 * Device settings that must be readable synchronously at launch, before the
 * first frame, such as the tab Easel opens to (SET-3).
 */
export const settingsKv = new SQLiteStorage('easel-settings.db');
