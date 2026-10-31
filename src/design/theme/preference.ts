import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';

/** The user's appearance choice. `system` follows the device setting. */
export type SchemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'easel.colorScheme';

/**
 * Overrides the scheme app-wide through `Appearance`, so native chrome (tab
 * bar, headers, alerts, keyboard) switches along with Easel's own tokens.
 */
export function applySchemePreference(preference: SchemePreference) {
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
}

/** Reads and applies the saved choice. Call before first render to avoid a flash. */
export async function loadSchemePreference(): Promise<SchemePreference> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    const preference: SchemePreference = saved === 'light' || saved === 'dark' ? saved : 'system';
    applySchemePreference(preference);
    return preference;
  } catch {
    return 'system';
  }
}

export function saveSchemePreference(preference: SchemePreference) {
  applySchemePreference(preference);
  AsyncStorage.setItem(STORAGE_KEY, preference).catch(() => {});
}
