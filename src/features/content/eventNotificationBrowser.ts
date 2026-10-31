import { useIsFocused, useNavigation, useRoute } from 'expo-router';
import { useLayoutEffect, useRef, useState } from 'react';

import { useCanvas } from '@/canvas/session';

import { useOpenSignedIn } from './browser';

type Operation = { mayOpen: () => boolean };
type Owner = { keys: readonly unknown[]; active: boolean; operation: Operation | null };
type Ticket = { owner: Owner; settings: object | null };
const same = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/** Scoped to event detail and notification settings. Only commit publishes controls;
 * locale renders keep the owner, while retired controls cannot borrow a new one.
 * This retires browser entry, not requests or browsers that have already entered. */
export function useEventNotificationBrowser(source: readonly unknown[], emptyChannels = false) {
  const { account, client } = useCanvas();
  const navigation = useNavigation();
  const route = useRoute();
  const focused = useIsFocused();
  const openSignedIn = useOpenSignedIn();
  const [generation, setGeneration] = useState(0);
  const live = useRef<Owner | null>(null);
  const settings = useRef<object | null>(null);
  const tickets = useRef(new WeakMap<object, Ticket>());
  const accountId = account.id,
    baseUrl = account.baseUrl,
    clientBaseUrl = client.baseUrl;
  const routeKey = route.key;
  const keys = [
    accountId,
    baseUrl,
    account.expired,
    client,
    clientBaseUrl,
    navigation,
    routeKey,
    focused,
    generation,
    ...source,
  ];
  // Each render has its own ticket, including renders that never commit.
  const ticket = {};
  useLayoutEffect(() => {
    const blur = navigation.addListener('blur', () => {
      if (live.current) live.current.active = false;
      setGeneration((value) => value + 1);
    });
    const focus = navigation.addListener('focus', () => setGeneration((value) => value + 1));
    return () => {
      blur();
      focus();
      if (live.current) live.current.active = false;
      live.current = null;
      settings.current = null;
    };
  }, [navigation]);
  useLayoutEffect(() => {
    if (!live.current || !live.current.active || !same(live.current.keys, keys)) {
      if (live.current) live.current.active = false;
      live.current = { keys, active: true, operation: null };
    }
    // Empty-channel eligibility has its own lifetime. Changing channels must not
    // retire the always-present account-level communication button.
    settings.current = emptyChannels ? (settings.current ?? {}) : null;
    tickets.current.set(ticket, { owner: live.current, settings: settings.current });
  });
  const current = () => {
    const state = navigation.getState();
    return (
      live.current !== null &&
      live.current === tickets.current.get(ticket)?.owner &&
      live.current.active &&
      focused &&
      !account.expired &&
      account.id === accountId &&
      account.baseUrl === baseUrl &&
      client.baseUrl === clientBaseUrl &&
      route.key === routeKey &&
      navigation.isFocused() &&
      state?.routes[state.index]?.key === routeKey
    );
  };
  const open = async (path: string, sourceCurrent: () => boolean = () => true, emptyOnly = false) => {
    const eligible = () =>
      current() &&
      sourceCurrent() &&
      (!emptyOnly ||
        (settings.current !== null && settings.current === tickets.current.get(ticket)?.settings));
    if (!eligible()) return;
    const owner = live.current!;
    if (owner.operation?.mayOpen()) return;
    const operation: Operation = {
      mayOpen: () => eligible() && live.current === owner && owner.operation === operation,
    };
    owner.operation = operation; // Synchronous claim, before the session lookup.
    try {
      await openSignedIn(path, operation.mayOpen);
    } catch {
      // These controls intentionally retain their existing silent failure policy.
    } finally {
      if (live.current === owner && owner.operation === operation) owner.operation = null;
    }
  };
  return {
    open,
    openSettings: (sourceCurrent: () => boolean) => open('/profile/settings', sourceCurrent, true),
  };
}
