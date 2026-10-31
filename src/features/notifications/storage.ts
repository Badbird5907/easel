import { kv as storage } from './kv';

/*
 * Local state for notifications and reminders: settings, reminders, and what
 * the student has seen, per account. SQLite, so the background task and the
 * app read the same data. Values are small JSON blobs, read and written
 * synchronously so a background run that gets cut off never loses a write.
 */

export function readJson<T>(key: string): T | null {
  try {
    const raw = storage.getItemSync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    storage.setItemSync(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: keep the in-memory copy.
  }
}

export function removeKey(key: string) {
  try {
    storage.removeItemSync(key);
  } catch {
    // Already gone.
  }
}

export function keysWithPrefix(prefix: string): string[] {
  try {
    return storage.getAllKeysSync().filter((key) => key.startsWith(prefix));
  } catch {
    return [];
  }
}

/**
 * One JSON value with an in-memory copy and change listeners, for
 * `useSyncExternalStore`. `reload()` rereads the disk, for when the background
 * task may have written in another JS runtime.
 */
export class JsonStore<T> {
  private value: T | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly key: string,
    private readonly initial: () => T,
    private readonly migrate: (stored: T) => T = (stored) => stored,
  ) {}

  get = (): T => {
    if (this.value === undefined) {
      const stored = readJson<T>(this.key);
      this.value = stored === null ? this.initial() : this.migrate(stored);
    }
    return this.value;
  };

  set(next: T) {
    if (next === this.value) return;
    this.value = next;
    writeJson(this.key, next);
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
    removeKey(this.key);
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
