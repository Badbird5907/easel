import { useLayoutEffect, useMemo } from 'react';

/** An opaque semantic identity, activated only at commit. Locale is never an owner. */
export function useAuthTermsLifetime(identity: object) {
  const owner = useMemo(() => ({ identity, active: false, epoch: 0, claimed: false }), [identity]);
  useLayoutEffect(() => {
    activate(owner);
    return () => {
      deactivate(owner);
      authTermsRetire(owner);
    };
  }, [owner]);
  return owner;
}

type Owner = ReturnType<typeof useAuthTermsLifetime>;

/** Retire entered work synchronously, including callbacks retained by native Alerts. */
export function authTermsRetire(owner: Owner) {
  owner.epoch++;
  owner.claimed = false;
}

export function authTermsClaim(owner: Owner) {
  if (!owner.active || owner.claimed) return null;
  owner.claimed = true;
  const epoch = owner.epoch;
  let released = false;
  const current = () => owner.active && owner.epoch === epoch && !released;
  return {
    current,
    release() {
      if (current()) owner.claimed = false;
      released = true;
    },
  };
}

function activate(owner: Owner) {
  owner.active = true;
}
function deactivate(owner: Owner) {
  owner.active = false;
}

/** Close this decision immediately, before React commits its replacement. */
export function authTermsClose(owner: Owner) {
  deactivate(owner);
  authTermsRetire(owner);
}
