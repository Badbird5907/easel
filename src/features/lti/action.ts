import { useState } from 'react';
import { useCanvas } from '@/canvas/session';
import { useToolLifetime } from './lifetime';

/** Per-control claim; validity survives settlement so the engine's alert can still act. */
export function useToolAction(key: string, eligible = true, context?: { active: boolean }) {
  const { account, client } = useCanvas();
  const owner = useToolLifetime(
    JSON.stringify([account.id, account.baseUrl, key, eligible]),
    client,
    context,
  );
  const [pending, setPending] = useState<{ owner: typeof owner; claim: object } | null>(null);
  const run = async (work: (isCurrent: () => boolean) => unknown) => {
    const live = owner.capture();
    if (!live() || !eligible || (context && !context.active)) return;
    const claim = owner.acquire();
    if (!claim) return;
    owner.invocations.set('action', claim);
    const isCurrent = () =>
      live() && (!context || context.active) && owner.invocations.get('action') === claim;
    setPending({ owner, claim });
    try {
      await work(isCurrent);
    } finally {
      if (isCurrent()) setPending(null);
      owner.release(claim);
    }
  };
  return { run, pending: pending?.owner === owner && owner.owns(pending.claim) };
}
