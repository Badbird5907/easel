import { useSyncExternalStore } from 'react';

import { offlineKv } from './kv';

/**
 * One JSON value on disk with an in-memory copy and change listeners, for
 * `useSyncExternalStore`. Reads and writes are synchronous, so a background
 * run that gets cut off never loses a write. `reload()` rereads the disk for
 * when the background task may have written from another JS runtime.
 */
export class LocalStore<T> {
  private value: T | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly key: string,
    private readonly initial: () => T,
    private readonly migrate: (stored: T) => T = (stored) => stored,
  ) {}

  get = (): T => {
    if (this.value === undefined) {
      let stored: T | null = null;
      try {
        const raw = offlineKv.getItemSync(this.key);
        stored = raw ? (JSON.parse(raw) as T) : null;
      } catch {
        stored = null;
      }
      this.value = stored === null ? this.initial() : this.migrate(stored);
    }
    return this.value;
  };

  set(next: T) {
    if (next === this.value) return;
    this.value = next;
    try {
      offlineKv.setItemSync(this.key, JSON.stringify(next));
    } catch {
      // Storage full or unavailable: keep the in-memory copy.
    }
    for (const listener of this.listeners) listener();
  }

  update(change: (current: T) => T) {
    this.set(change(this.get()));
  }

  reload() {
    this.value = undefined;
    for (const listener of this.listeners) listener();
  }

  clear() {
    this.value = undefined;
    try {
      offlineKv.removeItemSync(this.key);
    } catch {
      // Already gone.
    }
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/** Subscribes a component to a store. */
export function useLocalStore<T>(store: LocalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
