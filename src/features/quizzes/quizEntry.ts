import { useLayoutEffect, useMemo } from 'react';

/** Published only by commits. Disposal revokes even continuations surviving effect replay. */
class EntryOwner<T> {
  constructor(readonly key: string, readonly context: unknown) { }
  active = false;
  current: T | null = null;
  claim: object | null = null;
  activate() { this.active = true; }
  dispose() { this.active = false; this.current = null; this.claim = null; }
  publish(value: T) { this.current = value; }
  acquire() {
    if (!this.active || this.claim) return null;
    const claim = {};
    this.claim = claim;
    return claim;
  }
  owns(claim: object) { return this.active && this.claim === claim; }
  release(claim: object) { if (this.claim === claim) this.claim = null; }
}
export function useEntryOwner<T>(key: string, context: unknown, snapshot: T) {
  const owner = useMemo(() => new EntryOwner<T>(key, context), [key, context]);
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.dispose();
  }, [owner]);
  useLayoutEffect(() => { owner.publish(snapshot); });
  return owner;
}
