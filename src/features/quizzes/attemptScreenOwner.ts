import { useLayoutEffect, useMemo } from 'react';
import { useCanvas } from '@/canvas/session';

/** Committed screen capability. Status eligibility and entered work use separate owners. */
export class AttemptScreenOwner<T> {
  private value: T | undefined;
  private active = false;
  private epoch = {};
  private claimValue: { token: object; eligible: () => boolean } | undefined;
  private completed = false;
  publish(value: T) {
    this.value = value;
  }
  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.value = undefined;
    this.epoch = {};
    this.claimValue = undefined;
  }
  constructor(
    readonly account: string,
    readonly client: object,
    readonly identity: string,
    private parent?: AttemptScreenOwner<unknown>,
  ) {}
  read(): T | undefined {
    return this.active && (!this.parent || (this.parent.read() && !this.parent.completed))
      ? this.value
      : undefined;
  }
  lease() {
    const epoch = this.epoch;
    return () => epoch === this.epoch && !!this.read();
  }
  claim(eligible = this.lease()) {
    if (!this.read() || !eligible()) return null;
    if (this.claimValue?.eligible()) return null;
    const token = {};
    this.claimValue = { token, eligible };
    return token;
  }
  owns(token: object) {
    return !!this.read() && this.claimValue?.token === token && this.claimValue.eligible();
  }
  release(token: object) {
    if (this.claimValue?.token === token) this.claimValue = undefined;
  }
  /** Once per resource, including passive-effect replay. */
  complete() {
    if (!this.read() || this.completed) return false;
    this.completed = true;
    return true;
  }
}

export function useAttemptScreenOwner<T>(identity: string, value: T, parent?: AttemptScreenOwner<unknown>) {
  const { account, client } = useCanvas();
  const owner = useMemo(
    () => new AttemptScreenOwner<T>(account.id, client, identity, parent),
    [account.id, client, identity, parent],
  );
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.dispose();
  }, [owner]);
  useLayoutEffect(() => {
    owner.publish(value);
  });
  return owner;
}

export function attemptErrorDetail(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return error.message;
  return '';
}
