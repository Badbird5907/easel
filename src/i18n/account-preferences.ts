import { readJson, removeKey, writeJson } from '@/features/notifications/storage';
import { createDateContext } from '@/lib/dates';

/** Only display metadata, never tokens or the rest of a profile. Read disk per job. */
export type AccountDisplayPreferences = { effectiveLocale: string | null; timeZone: string | null };
const key = (id: string) => `account-display:${id}`;
const revisionKey = (id: string) => `account-display-revision:${id}`;
const generationKey = (id: string) => `account-display-generation:${id}`;
const stamp = () => `${Date.now()}:${Math.random()}`;
/** Opaque tombstone survives removal; it contains no profile or credentials. */
export const displayGeneration = (id: string) => readJson<string>(generationKey(id));
export function invalidateDisplayJobs(id: string) {
  writeJson(generationKey(id), stamp());
  for (const listener of listeners) listener(id);
}
const listeners = new Set<(accountId: string) => void>();
export const displayRevision = (id: string) => readJson<string>(revisionKey(id));

export function accountDateContext(id: string) {
  const value = readJson<AccountDisplayPreferences>(key(id));
  return createDateContext(
    typeof value?.effectiveLocale === 'string' ? value.effectiveLocale : null,
    typeof value?.timeZone === 'string' ? value.timeZone : null,
  );
}

/** Caller must verify live membership. Even an unchanged observation supersedes an older fetch. */
export function recordDisplayPreferences(id: string, value: AccountDisplayPreferences) {
  writeJson(revisionKey(id), stamp());
  const previous = readJson<AccountDisplayPreferences>(key(id));
  writeJson(key(id), { effectiveLocale: value.effectiveLocale, timeZone: value.timeZone });
  if (previous?.effectiveLocale !== value.effectiveLocale || previous?.timeZone !== value.timeZone)
    for (const listener of listeners) listener(id);
}

export function removeDisplayPreferences(id: string) {
  invalidateDisplayJobs(id);
  writeJson(revisionKey(id), stamp());
  removeKey(key(id));
  for (const listener of listeners) listener(id);
}

export function onDisplayPreferencesChanged(listener: (accountId: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
