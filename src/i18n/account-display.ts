import { fetchProfile } from '@/canvas/api/profile';
import type { CanvasClient } from '@/canvas/client';
import { type Account, isStoredAccountClient } from '@/canvas/session';
import {
  accountDateContext,
  displayRevision,
  recordDisplayPreferences,
  type AccountDisplayPreferences,
} from './account-preferences';

/** Foreground profile observations are already account-keyed by React Query. */
export function observeAccountDisplay(
  accountId: string,
  client: CanvasClient,
  profile: AccountDisplayPreferences,
) {
  if (isStoredAccountClient(accountId, client)) recordDisplayPreferences(accountId, profile);
}

const pending = new Map<CanvasClient, Promise<void>>();
/** Once per network job (coalesced across simultaneous jobs), never per row or reminder.
 * Offline uses only this account's saved metadata; cold/missing uses English/device zone.
 * A foreground profile observation wins over a request that started before it.
 */
export async function refreshAccountDisplay(account: Account, client: CanvasClient) {
  if (!isStoredAccountClient(account.id, client)) return accountDateContext(account.id);
  let job = pending.get(client);
  if (!job) {
    const revision = displayRevision(account.id);
    job = (async () => {
      try {
        const profile = await fetchProfile(client, account.user.id);
        if (
          profile.id === account.user.id &&
          isStoredAccountClient(account.id, client) &&
          displayRevision(account.id) === revision
        )
          recordDisplayPreferences(account.id, profile);
      } catch {
        // Optional metadata must not change a job's baselines or failure policy.
      }
    })().finally(() => {
      pending.delete(client);
    });
    pending.set(client, job);
  }
  await job;
  return accountDateContext(account.id);
}
