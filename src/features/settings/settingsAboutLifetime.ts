import { useIsFocused, useNavigation } from 'expo-router';
import { useLayoutEffect, useMemo } from 'react';

class AboutOwner {
  private token: object | null = null;
  constructor(
    readonly identity: object,
    private focused: boolean,
    private navigation: { isFocused: () => boolean },
  ) {}
  activate() {
    this.token = {};
  }
  retire() {
    this.token = null;
  }
  current = () => !!this.token && this.focused && this.navigation.isFocused();
  capture() {
    const token = this.token;
    return () => !!token && token === this.token && this.current();
  }
}

/** Only committed replacement retires callbacks; locale is not a resource identity. */
export function useSettingsAboutOwner(identity: object) {
  const focused = useIsFocused();
  const navigation = useNavigation();
  const owner = useMemo(() => new AboutOwner(identity, focused, navigation), [identity, focused, navigation]);
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.retire();
  }, [owner]);
  return owner;
}

export type SettingsAboutRun = { owner: ReturnType<typeof useSettingsAboutOwner>; current: () => boolean };
