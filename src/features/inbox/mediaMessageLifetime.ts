import { useCallback, useLayoutEffect, useRef } from 'react';

/** Commit-owned token. Abandoned renders cannot retire the visible controls. */
export function useMediaMessageLifetime(identity: object) {
  const committed = useRef<{ identity: object; token: object } | null>(null);
  useLayoutEffect(() => {
    const owner = { identity, token: {} };
    committed.current = owner;
    return () => {
      if (committed.current === owner) committed.current = null;
    };
  }, [identity]);
  return useCallback(
    () => (committed.current?.identity === identity ? committed.current.token : null),
    [identity],
  );
}
