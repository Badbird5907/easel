import { useLayoutEffect, useMemo } from 'react';
import { useCanvas } from '@/canvas/session';

// Only committed owners may act. Presentation changes publish fresh callbacks
// without revoking the question indices offered by this membership/order.
class ControlOwner {
  constructor(
    readonly account: string,
    readonly client: object,
    readonly attemptKey: string,
    readonly membership: string,
    readonly visible: boolean,
  ) {}
  active = false;
  actions: { go?: (index: number) => void; close?: () => void; review?: () => void } = {};
  readonly announced = new Set<number>();
  activate() {
    this.active = true;
  }
  publish(actions: ControlOwner['actions']) {
    this.actions = actions;
  }
  dispose() {
    this.active = false;
    this.actions = {};
  }
  announce(mark: number) {
    if (!this.active || this.announced.has(mark)) return false;
    this.announced.add(mark);
    return true;
  }
  go(index: number, before?: () => void) {
    if (!this.active) return;
    before?.();
    this.actions.go?.(index);
  }
  close() {
    if (this.active) this.actions.close?.();
  }
  review() {
    if (this.active) this.actions.review?.();
  }
}

/** attemptKey is a serialized course/quiz/submission/attempt identity, never a title.
 * Account and client ownership is intrinsic, including standalone consumers.
 * Hidden/away-and-back sheets get fresh owners. No ref publication in render.
 */
export function useQuizControlOwner(
  attemptKey = '',
  membership = '',
  visible = true,
  actions: ControlOwner['actions'] = {},
) {
  const { account, client } = useCanvas();
  const owner = useMemo(
    () => new ControlOwner(account.id, client, attemptKey, membership, visible),
    [account.id, client, attemptKey, membership, visible],
  );
  useLayoutEffect(() => {
    if (visible) owner.activate();
    return () => owner.dispose();
  }, [owner, visible]);
  useLayoutEffect(() => {
    owner.publish(actions);
  });
  return owner;
}
