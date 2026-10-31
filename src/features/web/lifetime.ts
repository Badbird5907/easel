import { useLayoutEffect, useMemo, useRef } from 'react';

/** Mutable work bookkeeping is private to event/commit operations, never render. */
class WebLifetime {
  active = false;
  generation = 0;
  pending = false;
  started = false;
  allowInitialSigned = false;
  private firstUse = false;
  constructor(
    readonly key: string,
    readonly client: object,
    readonly account: string,
    readonly resource?: object,
  ) {}
  activate(allowInitialSigned: boolean) {
    this.active = true;
    this.allowInitialSigned = allowInitialSigned;
  }
  dispose() {
    this.active = false;
    this.generation++;
    this.pending = false;
    this.started = false;
  }
  begin() {
    this.pending = true;
    this.started = true;
    return ++this.generation;
  }
  next() {
    return ++this.generation;
  }
  finish() {
    this.pending = false;
  }
  initialSigned() {
    if (this.firstUse || !this.allowInitialSigned) return false;
    this.firstUse = true;
    return true;
  }
}

/** A render may describe an owner, but only a commit can activate it. */
export function useWebLifetime(key: string, client: object, account: string, resource?: object) {
  const owner = useMemo(
    () => new WebLifetime(key, client, account, resource),
    [key, client, account, resource],
  );
  const identity = useRef<{ client: object; account: string; replaced: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!identity.current) identity.current = { client, account, replaced: false };
    if (identity.current.client !== client || identity.current.account !== account)
      identity.current.replaced = true;
    owner.activate(!identity.current.replaced);
    return () => owner.dispose();
  }, [owner, client, account]);
  return owner;
}

/** Callback props become visible together with the render that supplied them. */
export function useWebLive<T>(value: T) {
  const live = useRef(value);
  useLayoutEffect(() => {
    live.current = value;
  });
  return live;
}
