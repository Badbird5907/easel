import { useLayoutEffect, useMemo, useState } from 'react';
import { useCanvas } from '@/canvas/session';

/** Only committed renders publish capabilities. Entered remote work is not cancelled. */
export class ComposeOwner<T> {
  constructor(
    readonly accountId: string,
    readonly client: object,
    readonly identity: string,
  ) {}
  private value: T | undefined;
  private epoch = {};
  private pending: object | null = null;
  private finished = false;
  publish(value: T) {
    this.value = value;
  }
  retire() {
    this.value = undefined;
    this.epoch = {};
    this.pending = null;
  }
  read() {
    return this.finished ? undefined : this.value;
  }
  lease() {
    const epoch = this.epoch;
    return () => epoch === this.epoch && !!this.read();
  }
  claim() {
    if (!this.read() || this.pending) return null;
    return (this.pending = {});
  }
  owns(token: object) {
    return !!this.read() && this.pending === token;
  }
  release(token: object) {
    if (this.pending === token) this.pending = null;
  }
  complete() {
    this.finished = true;
  }
}
export function useComposeOwner<T>(identity: string, value: T, active = true) {
  const { account, client } = useCanvas();
  const owner = useMemo(
    () => new ComposeOwner<T>(account.id, client, identity),
    [account.id, client, identity],
  );
  useLayoutEffect(() => () => owner.retire(), [owner]);
  useLayoutEffect(() => {
    if (active) owner.publish(value);
    else owner.retire();
  });
  return owner;
}

/** A render-local state adjustment resets the subtree without mutating live ownership. */
export function useComposeBoundary(identity: string) {
  const { account, client } = useCanvas();
  const [boundary, setBoundary] = useState({ account: account.id, client, identity, key: 0 });
  if (boundary.account !== account.id || boundary.client !== client || boundary.identity !== identity) {
    const next = { account: account.id, client, identity, key: boundary.key + 1 };
    setBoundary(next);
    return next.key;
  }
  return boundary.key;
}
