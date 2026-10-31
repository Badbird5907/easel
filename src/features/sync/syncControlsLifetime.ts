import { useLayoutEffect, useState } from 'react';

class SyncControlsOwner {
  private dependencies: readonly unknown[] = [];
  private generation = {};
  private active = false;

  commit(dependencies: readonly unknown[]) {
    if (
      !this.active ||
      dependencies.length !== this.dependencies.length ||
      dependencies.some((value, index) => !Object.is(value, this.dependencies[index]))
    ) {
      this.generation = {};
    }
    this.dependencies = dependencies;
    this.active = true;
    return this.generation;
  }
  retire() {
    this.active = false;
    this.generation = {};
  }
  current(generation: object | null) {
    return this.active && generation === this.generation;
  }
}

class SyncControlsTicket {
  private generation: object | null = null;
  constructor(
    private owner: SyncControlsOwner,
    private dependencies: readonly unknown[],
  ) {}
  commit() {
    this.generation = this.owner.commit(this.dependencies);
  }
  current() {
    return this.owner.current(this.generation);
  }
}

/** Imperative entry state belongs to one semantic UI context, never to locale. */
export class SyncControlsEntry {
  busy = false;
  closed = false;
  pending = false;
  used = false;
  constructor(readonly context: readonly unknown[]) {}
  setBusy(value: boolean) {
    this.busy = value;
  }
  setPending(value: boolean) {
    this.pending = value;
  }
  close() {
    this.closed = true;
  }
  use() {
    this.used = true;
  }
}

/** Render creates an inert ticket; commit activates it. Changes retire old tickets.
 * No native work is cancelled, and locale is intentionally absent from dependencies. */
export function useSyncControlsLifetime(dependencies: readonly unknown[]) {
  const [owner] = useState(() => new SyncControlsOwner());
  const ticket = new SyncControlsTicket(owner, dependencies);
  useLayoutEffect(() => {
    ticket.commit();
  });
  useLayoutEffect(() => () => owner.retire(), [owner]);
  return () => ticket.current();
}
