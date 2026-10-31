import { useLayoutEffect, useMemo, useRef } from 'react';

/** UI lifetime only: invalidating a claim cannot undo an already-started native/request operation. */
export function useFileLifetime(accountKey: string, client: unknown) {
  const live = useRef<{ context: object } | null>(null);
  const lifetime = useMemo(() => {
    const context = { accountKey, client };
    const isCurrent = () => live.current?.context === context;
    return {
      context,
      isCurrent,
    };
  }, [accountKey, client]);
  useLayoutEffect(() => {
    live.current = { context: lifetime.context };
    return () => {
      if (live.current?.context === lifetime.context) live.current = null;
    };
  }, [lifetime]);
  return lifetime;
}
