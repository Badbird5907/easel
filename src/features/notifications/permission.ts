import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Linking } from 'react-native';

import { getPermission, type PermissionState, requestPermission } from './platform';

/*
 * Notification permission, shared by every screen that asks or explains.
 * Easel asks in context, the first time the student sets a reminder, and
 * links to system Settings once it's been declined.
 */

let state: PermissionState | null = null;
const listeners = new Set<() => void>();

function set(next: PermissionState) {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

export async function refreshPermission(): Promise<PermissionState> {
  const next = await getPermission();
  set(next);
  return next;
}

/** Asks if the student hasn't been asked; otherwise reports what they chose. */
export async function ensurePermission(): Promise<PermissionState> {
  const next = await requestPermission();
  set(next);
  return next;
}

export function openNotificationSettings() {
  Linking.openSettings().catch(() => {});
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => state;

/** Null until the first read. Rereads when the student comes back from Settings. */
export function useNotificationPermission(): PermissionState | null {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    void refreshPermission();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshPermission();
    });
    return () => subscription.remove();
  }, []);
  return current;
}
