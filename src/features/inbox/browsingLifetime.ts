import { useLayoutEffect, useMemo, useState } from 'react';
import { useCanvas } from '@/canvas/session';

class BrowsingOwner<T> {
  live = false;
  claims = new Set<string>();
  constructor(public value: T) {}
  activate() {
    this.live = true;
  }
  retire() {
    this.live = false;
  }
  publish(value: T) {
    this.value = value;
  }
}
class MenuSession {
  live = true;
  closed = false;
  constructor(readonly identity: object) {}
  close(selected?: boolean) {
    if (!this.live || this.closed) return false;
    this.closed = true;
    if (!selected) this.retire();
    return true;
  }
  retire() {
    this.live = false;
  }
}

/** Publish ownership only on commit. Locale and freshly allocated query data aren't identities. */
export function useBrowsingOwner<T>(resource: string, value: T) {
  const { account, client } = useCanvas();
  const owner = useMemo(
    () => new BrowsingOwner(value),
    // value is published below, never to a live owner during render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account.id, client, resource],
  );
  useLayoutEffect(() => {
    owner.activate();
    return () => {
      owner.retire();
    };
  }, [owner]);
  useLayoutEffect(() => {
    owner.publish(value);
  });
  return owner;
}

export function onceWhile(valid: () => boolean, action: () => void) {
  let used = false;
  return () => {
    if (used || !valid()) return;
    used = true;
    action();
  };
}

/** Catch rejected refetches; query errors remain the source of failure presentation. */
export function useBrowsingRefresh(
  owner: { live: boolean; claims: Set<string> },
  work: () => Promise<unknown>,
) {
  const [pending, setPending] = useState<typeof owner | null>(null);
  const refresh = async () => {
    if (!owner.live || owner.claims.has('refresh')) return;
    owner.claims.add('refresh');
    setPending(owner);
    try {
      await work();
    } catch {
      /* query owns the error */
    } finally {
      owner.claims.delete('refresh');
      if (owner.live) setPending(null);
    }
  };
  return { refreshing: pending === owner, refresh };
}

/** A selected iOS action may run after dismissal; a plain dismissal retires it immediately. */
export function useBrowsingMenu(resource: string) {
  const { account, client } = useCanvas();
  const identity = useMemo(
    () => ({ accountId: account.id, client, resource }),
    [account.id, client, resource],
  );
  const [stored, setSession] = useState<MenuSession | null>(null);
  const session = stored?.identity === identity ? stored : null;
  useLayoutEffect(
    () => () => {
      if (session) session.retire();
    },
    [session],
  );
  return {
    session,
    open: () => {
      if (session) session.retire();
      setSession(new MenuSession(identity));
    },
    close: (selected?: boolean) => {
      return session?.close(selected) ?? false;
    },
  };
}
