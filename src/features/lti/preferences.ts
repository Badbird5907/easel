import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { registerAccountCleanup } from '@/canvas/session';

/**
 * Where each tool opens, remembered per account and tool (LTI-2): Easel's
 * signed-in web view (`app`) or the in-app browser (`browser`). Tools the
 * student never chose for follow the default in `launch.ts`.
 */
export type ToolOpenMode = 'app' | 'browser';

const storageKey = (accountId: string) => `easel.lti.openIn.${accountId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

const cache = new Map<string, Record<string, ToolOpenMode>>();
const loading = new Map<string, Promise<Record<string, ToolOpenMode>>>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

async function load(accountId: string): Promise<Record<string, ToolOpenMode>> {
  const cached = cache.get(accountId);
  if (cached) return cached;
  const pending = loading.get(accountId);
  if (pending) return pending;
  const promise = AsyncStorage.getItem(storageKey(accountId))
    .then((raw) => (raw ? (JSON.parse(raw) as Record<string, ToolOpenMode>) : {}))
    .catch(() => ({}))
    .then((prefs) => {
      cache.set(accountId, prefs);
      loading.delete(accountId);
      emit();
      return prefs;
    });
  loading.set(accountId, promise);
  return promise;
}

/** The student's choice for a tool, or null when they never chose. */
export async function toolOpenMode(accountId: string, toolId: string | null): Promise<ToolOpenMode | null> {
  if (!toolId) return null;
  return (await load(accountId))[toolId] ?? null;
}

export async function setToolOpenMode(accountId: string, toolId: string, mode: ToolOpenMode) {
  const prefs = { ...(await load(accountId)), [toolId]: mode };
  cache.set(accountId, prefs);
  emit();
  await AsyncStorage.setItem(storageKey(accountId), JSON.stringify(prefs)).catch(() => {});
}

registerAccountCleanup(async (accountId) => {
  cache.delete(accountId);
  await AsyncStorage.removeItem(storageKey(accountId)).catch(() => {});
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** A tool's remembered mode, live, with a setter. `fallback` shows until the student chooses. */
export function useToolOpenMode(accountId: string, toolId: string | null, fallback: ToolOpenMode) {
  useEffect(() => {
    load(accountId).catch(() => {});
  }, [accountId]);
  const chosen = useSyncExternalStore(subscribe, () =>
    toolId ? (cache.get(accountId)?.[toolId] ?? null) : null,
  );
  const set = useCallback(
    (mode: ToolOpenMode) => {
      if (toolId) setToolOpenMode(accountId, toolId, mode).catch(() => {});
    },
    [accountId, toolId],
  );
  return { mode: chosen ?? fallback, chosen, setMode: set };
}
