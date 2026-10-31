import { useLayoutEffect, useMemo } from 'react';
import { useCanvas } from '@/canvas/session';

/** Values are published only after commit; speculative renders cannot authorize actions. */
export class QuestionInputOwner<T> {
  private active = false;
  private value: T | undefined;
  private operation: object | null = null;
  constructor(
    readonly account: string,
    readonly client: object,
    readonly identity: string,
    readonly parent?: QuestionInputOwner<unknown>,
  ) {}
  publish(value: T) {
    this.value = value;
  }
  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.value = undefined;
    this.operation = null;
  }
  read(): T | undefined {
    return this.active && (!this.parent || this.parent.read()) ? this.value : undefined;
  }
  claim() {
    if (!this.read() || this.operation) return null;
    return (this.operation = {});
  }
  owns(operation: object) {
    return !!this.read() && this.operation === operation;
  }
  release(operation: object) {
    if (this.owns(operation)) this.operation = null;
  }
  busy() {
    return this.operation !== null;
  }
}

export function useQuestionInputOwner<T>(identity: string, value: T, parent?: QuestionInputOwner<unknown>) {
  const { account, client } = useCanvas();
  const owner = useMemo(
    () => new QuestionInputOwner<T>(account.id, client, identity, parent),
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
