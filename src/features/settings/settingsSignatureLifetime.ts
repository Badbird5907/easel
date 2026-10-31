import { useIsFocused, useNavigation } from 'expo-router';
import { useLayoutEffect, useMemo } from 'react';

class SignatureOwner {
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
    const token = this.token;
    return () => !!token && this.token === token && this.current();
  }
}

/** Speculative renders never retire the committed signature editor. */
export function useSettingsSignatureOwner(identity: object, eligible = true) {
  const focused = useIsFocused();
  const navigation = useNavigation();
  const owner = useMemo(
    () => new SignatureOwner(identity, eligible, focused, navigation),
    [identity, eligible, focused, navigation],
  );
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.retire();
  }, [owner]);
  return owner;
}

export type SignatureRun = { current: () => boolean };
