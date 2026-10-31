import { useIsFocused, useNavigation } from 'expo-router';
import { useLayoutEffect, useMemo } from 'react';

class ProfileFormsOwner {
  private token: object | null = null;
  constructor(
    readonly identity: object,
    private eligible: boolean,
    private focused: boolean,
    private navigation: { isFocused: () => boolean },
  ) {}
  activate() {
    this.token = {};
  }
  retire() {
    this.token = null;
  }
  current = () => !!this.token && this.eligible && this.focused && this.navigation.isFocused();
  capture() {
    const source = this.token;
    return () => !!source && this.token === source && this.current();
  }
}

/** Only commits activate owners. Cleanup/replay cannot revive captured work. */
export function useProfileFormsOwner(identity: object, eligible = true) {
  const focused = useIsFocused();
  const navigation = useNavigation();
  const owner = useMemo(
    () => new ProfileFormsOwner(identity, eligible, focused, navigation),
    [identity, eligible, focused, navigation],
  );
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.retire();
  }, [owner]);
  return owner;
}

export type ProfileFormsRun = { current: () => boolean };
export class ProfileFormsProgress {
  private run?: ProfileFormsRun;
  constructor(
    private publish: (value: { run: ProfileFormsRun; progress: number | null }) => void,
  ) {}
  start(run: ProfileFormsRun) {
    this.run = run;
  }
  finish() {
    this.run = undefined;
  }
  report(progress: number | null) {
    if (this.run?.current()) this.publish({ run: this.run, progress });
  }
}
