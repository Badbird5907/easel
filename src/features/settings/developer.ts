import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

const KEY = 'easel.developerMode';

/*
 * Developer settings (SET-13): the design system gallery and anything else
 * meant for people working on Easel. Off in release builds until the student
 * taps the version in About seven times; always on in development builds.
 */

let stored = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function load() {
  loading ??= AsyncStorage.getItem(KEY)
    .then((value) => {
      stored = value === '1';
      emit();
    })
    .catch(() => {});
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether developer settings are on, for code outside React. */
export async function isDeveloperModeEnabled(): Promise<boolean> {
  await load();
  return __DEV__ || stored;
}

export function useDeveloperMode(): {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** Development builds can't turn it off. */
  alwaysOn: boolean;
} {
  const value = useSyncExternalStore(subscribe, () => stored);
  useEffect(() => {
    load();
  }, []);
  const setEnabled = useCallback((enabled: boolean) => {
    stored = enabled;
    emit();
    AsyncStorage.setItem(KEY, enabled ? '1' : '0').catch(() => {});
  }, []);
  return { enabled: __DEV__ || value, setEnabled, alwaysOn: __DEV__ };
}
