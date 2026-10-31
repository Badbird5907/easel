import { useLayoutEffect, useMemo } from 'react';

/** Only committed forms can start work. Locale is deliberately not an owner input. */
export function useAuthFormsLifetime(identity: string) {
  const owner = useMemo(() => ({ identity, active: false, revision: 0, epoch: 0, claimed: false, retirements: new Set<() => void>() }), [identity]);
  useLayoutEffect(() => {
    activate(owner);
    return () => deactivate(owner);
  }, [owner]);
  return owner;
}

export type AuthFormsOwner = ReturnType<typeof useAuthFormsLifetime>;
export type AuthFormsOperation = { current: () => boolean; onRetire: (callback: () => void) => () => void; release: () => void; waiting?: boolean; claimAction: () => boolean; endAction: () => void; };

function activate(owner: AuthFormsOwner) { owner.active = true; }
function deactivate(owner: AuthFormsOwner) { owner.active = false; owner.epoch++; owner.claimed = false; notifyRetirement(owner); }

export function authFormsClaim(owner: AuthFormsOwner, revision: number): AuthFormsOperation | null {
  if (!owner.active || owner.revision !== revision || owner.claimed) return null;
  owner.claimed = true;
  const epoch = owner.epoch;
  let released = false;
  let acting = false;
  const callbacks = new Set<() => void>();
  const notify = () => {
    owner.retirements.delete(notify);
    for (const callback of callbacks) callback();
    callbacks.clear();
  };
  owner.retirements.add(notify);
  const current = () => owner.active && owner.revision === revision && owner.epoch === epoch && !released;
  return {
    current,
    onRetire: (callback) => {
      if (!current()) { callback(); return () => {}; }
      callbacks.add(callback);
      return () => { callbacks.delete(callback); };
    },
    claimAction: () => {
      if (!current() || acting) return false;
      acting = true;
      return true;
    },
    endAction: () => { acting = false; },
    release: () => {
      if (current()) owner.claimed = false;
      released = true;
      notify();
    },
  };
}

export function authFormsRetire(owner: AuthFormsOwner) {
  owner.revision++;
  owner.claimed = false;
  notifyRetirement(owner);
}

function notifyRetirement(owner: AuthFormsOwner) {
  for (const notify of [...owner.retirements]) notify();
}
