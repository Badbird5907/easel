import { useIsFocused, useNavigation } from 'expo-router';
import { useLayoutEffect, useMemo } from 'react';

/** Activated only after commit; an abandoned render cannot retire live callbacks. */
export class SettingsStorageOwner {
  private epoch: object | null = null;
  private claims = new Set<string>();
  private sheet: object | null = null;
  constructor(
    readonly identity: object,
    private focused: boolean,
    private navigation: { isFocused(): boolean },
    private parent?: SettingsStorageOwner,
  ) {}
  activate() {
    this.epoch = {};
  }
  retire() {
    this.epoch = null;
    this.sheet = null;
    this.claims.clear();
  }
  current = (): boolean =>
    !!this.epoch &&
    this.focused &&
    this.navigation.isFocused() &&
    (!this.parent || this.parent.current());
  get key(): object {
    return this.epoch ?? this;
  }
  release(key: string) {
    this.claims.delete(key);
  }
  capture() {
    const epoch = this.epoch;
    return () => !!epoch && this.epoch === epoch && this.current();
  }
  claim(key: string) {
    if (!this.current() || this.claims.has(key)) return false;
    this.claims.add(key);
    return true;
  }
  openSheet() {
    if (!this.current()) return null;
    return (this.sheet = {});
  }
  ownsSheet(sheet: object | null) {
    return !!sheet && this.sheet === sheet && this.current();
  }
  closeSheet(sheet: object | null) {
    if (!this.ownsSheet(sheet)) return false;
    this.sheet = null;
    return true;
  }
}

export function useSettingsStorageOwner(identity: object, parent?: SettingsStorageOwner) {
  const focused = useIsFocused();
  const navigation = useNavigation();
  const owner = useMemo(
    () => new SettingsStorageOwner(identity, focused, navigation, parent),
    [identity, focused, navigation, parent],
  );
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.retire();
  }, [owner]);
  return owner;
}

/** Only effect entry is coalesced. An entered global cache clear cannot be undone. */
export class SettingsStorageWork {
  private pending = new Map<unknown, Promise<void>>();
  private measurement = 0;
  private measurementKeys = new WeakMap<object, object>();
  private confirmation: object | null = null;
  busy(key: unknown) {
    return this.pending.has(key);
  }
  run(key: unknown, enter: () => Promise<void>): Promise<void> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    // Install the claim before invoking a boundary, including synchronous throws/reentry.
    const task = Promise.resolve()
      .then(enter)
      .finally(() => {
        if (this.pending.get(key) === task) this.pending.delete(key);
      });
    this.pending.set(key, task);
    return task;
  }
  measurementKey(owner: object) {
    let key = this.measurementKeys.get(owner);
    if (!key) {
      key = {};
      this.measurementKeys.set(owner, key);
    }
    return key;
  }
  invalidateMeasurement() {
    this.measurement++;
    this.measurementKeys = new WeakMap();
  }
  async measure<T>(read: () => Promise<T>, current: () => boolean, publish: (value: T) => void) {
    if (!current()) return;
    const version = ++this.measurement;
    // New owners must not publish a snapshot taken halfway through a global clear.
    await this.pending.get('clear')?.catch(() => {});
    if (!current() || version !== this.measurement) return;
    try {
      const value = await read();
      if (current() && version === this.measurement) publish(value);
    } catch (error) {
      if (current() && version === this.measurement) throw error;
    }
  }
  confirm(current: () => boolean) {
    if (!current() || this.busy('clear')) return null;
    const token = {};
    this.confirmation = token;
    return {
      cancel: () => {
        if (this.confirmation === token) this.confirmation = null;
      },
      take: () => {
        if (this.confirmation !== token) return false;
        this.confirmation = null;
        return current() && !this.busy('clear');
      },
    };
  }
}
