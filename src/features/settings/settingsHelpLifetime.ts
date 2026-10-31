import { useIsFocused, useNavigation } from 'expo-router';
import { useLayoutEffect, useMemo } from 'react';

/** A shared entry claim survives owner replacement until its own completion. */
export class SettingsHelpEffects {
  private pending = new Map<string, object>();
  async run(kind: string, enter: () => unknown) {
    if (this.pending.has(kind)) return;
    const claim = {};
    this.pending.set(kind, claim);
    try {
      await enter();
    } catch {
      // Query errors are rendered by the query; browser failures retain legacy behavior.
    } finally {
      if (this.pending.get(kind) === claim) this.pending.delete(kind);
    }
  }
}

/** Render may allocate an owner, but only a committed effect can activate it. */
export class SettingsHelpOwner {
  private epoch: object | null = null;
  private navigated = false;
  private teachers = '';
  setTeachers(label: string) {
    this.teachers = label;
  }
  teacherLabel() {
    return this.teachers;
  }
  private sheet: object | null = null;
  constructor(
    readonly identity: object,
    private focused: boolean,
    private navigation: { isFocused(): boolean },
    private parent?: SettingsHelpOwner,
  ) {}
  activate() {
    this.epoch = {};
  }
  retire() {
    this.epoch = null;
  }
  current = (): boolean =>
    !!this.epoch && this.focused && this.navigation.isFocused() && (!this.parent || this.parent.current());
  capture() {
    const epoch = this.epoch;
    return () => !!epoch && epoch === this.epoch && this.current();
  }
  openSheet() {
    if (!this.current() || this.navigated || this.sheet) return null;
    this.sheet = {};
    return this.sheet;
  }
  ownsSheet(sheet: object | null) {
    return !!sheet && this.sheet === sheet && this.current();
  }
  closeSheet(sheet: object | null) {
    if (!this.ownsSheet(sheet)) return false;
    this.sheet = null;
    return true;
  }
  navigate(enter: () => void) {
    if (!this.current() || this.navigated) return;
    this.navigated = true;
    enter();
  }
  run(effects: SettingsHelpEffects, kind: string, enter: () => unknown) {
    if (!this.current() || this.navigated) return;
    const current = this.capture();
    return effects.run(kind, () => {
      if (current()) return enter();
    });
  }
}

export function useSettingsHelpOwner(identity: object, parent?: SettingsHelpOwner) {
  const focused = useIsFocused();
  const navigation = useNavigation();
  const owner = useMemo(
    () => new SettingsHelpOwner(identity, focused, navigation, parent),
    [identity, focused, navigation, parent],
  );
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.retire();
  }, [owner]);
  return owner;
}
