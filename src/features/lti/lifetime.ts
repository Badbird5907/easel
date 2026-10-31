import { useLayoutEffect, useMemo } from 'react';

/** Commit-owned scope. Presentation renders do not revoke work; disposal does. */
class ToolLifetime {
  constructor(
    readonly key: string,
    readonly client: object,
    readonly context?: object,
  ) {}
  active = false;
  generation = 0;
  claim: object | null = null;
  readonly invocations = new Map<string, object>();
  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.generation++;
    this.claim = null;
    this.invocations.clear();
  }
  capture() {
    const generation = this.generation;
    return () => this.active && this.generation === generation;
  }
  acquire() {
    if (!this.active || this.claim) return null;
    return (this.claim = {});
  }
  owns(claim: object) {
    return this.active && this.claim === claim;
  }
  release(claim: object) {
    if (this.claim === claim) this.claim = null;
  }
}

export function useToolLifetime(key: string, client: object, context?: object) {
  const lifetime = useMemo(() => new ToolLifetime(key, client, context), [key, client, context]);
  useLayoutEffect(() => {
    lifetime.activate();
    return () => lifetime.dispose();
  }, [lifetime]);
  return lifetime;
}
