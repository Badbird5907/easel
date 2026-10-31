import { useNavigation } from 'expo-router';
import { useLayoutEffect, useMemo, useState } from 'react';
import type { Translate } from '@/i18n';

/** A committed source lifetime, independent of translated presentation. */
class ActivityPresentationOwner {
  constructor(readonly identity: readonly unknown[]) {}
  active = false;
  generation = 0;
  opening = false;
  refreshing = false;
  t: Translate | null = null;
  activate(active: boolean) {
    this.active = active;
  }
  present(t: Translate) {
    this.t = t;
  }
  beginOpen() {
    if (!this.active || this.opening) return false;
    this.opening = true;
    return true;
  }
  finishOpen() {
    this.opening = false;
  }
  beginRefresh() {
    if (!this.active || this.refreshing) return false;
    this.refreshing = true;
    return true;
  }
  finishRefresh() {
    this.refreshing = false;
  }
  revoke() {
    this.active = false;
    this.generation++;
    this.opening = false;
    this.refreshing = false;
  }
  owns(generation: number) {
    return this.active && this.generation === generation;
  }
}

export function useActivityPresentationOwner(
  accountId: string,
  baseUrl: string,
  client: object,
  source: unknown,
  refetch: unknown,
  filter: string,
  t: Translate,
) {
  const navigation = useNavigation();
  const [focusVersion, setFocusVersion] = useState(0);
  const owner = useMemo(
    () =>
      new ActivityPresentationOwner([
        accountId,
        baseUrl,
        client,
        source,
        refetch,
        filter,
        navigation,
        focusVersion,
      ]),
    [accountId, baseUrl, client, source, refetch, filter, navigation, focusVersion],
  );
  useLayoutEffect(() => {
    owner.activate(navigation.isFocused());
    const blur = navigation.addListener('blur', () => {
      owner.revoke();
      setFocusVersion((n) => n + 1);
    });
    const focus = navigation.addListener('focus', () => setFocusVersion((n) => n + 1));
    return () => {
      owner.revoke();
      blur();
      focus();
    };
  }, [owner, navigation]);
  useLayoutEffect(() => {
    owner.present(t);
  }, [owner, t]);
  return owner;
}
