import { useIsFocused, useNavigation, useRoute } from 'expo-router';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useCanvas } from '@/canvas/session';

import { useOpenSignedIn } from './browser';

type Lease = { keys: readonly unknown[]; active: boolean; operation: object | null };
const same = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/** Only these two lists share this owner. Commit publishes identity; event handlers
 * synchronously claim work. A retired session/native request cannot be undone.
 * The shared helper checks mayOpen both before lookup and before native entry. */
export function useOutcomesPortfolioListBrowser(
  online: boolean,
  source: readonly unknown[],
) {
  const { account, client } = useCanvas();
  const navigation = useNavigation();
  const route = useRoute();
  const focused = useIsFocused();
  const openSignedIn = useOpenSignedIn();
  const [generation, setGeneration] = useState(0);
  const live = useRef<Lease | null>(null);
  const tickets = useRef(new WeakMap<object, Lease>());
  const [status, setStatus] = useState<{
    keys: readonly unknown[]; opening: string | null; error: Error | null;
  } | null>(null);
  const accountId = account.id, baseUrl = account.baseUrl, clientBaseUrl = client.baseUrl;
  const routeKey = route.key;
  const expired = account.expired;
  const keys = useMemo(() => [accountId, baseUrl, expired, client, clientBaseUrl,
    navigation, routeKey, focused, online, generation, ...source],
  [accountId, baseUrl, expired, client, clientBaseUrl, navigation, routeKey, focused, online, generation, source]);
  // This render-local ticket is published only after commit. Discarded render
  // controls cannot borrow the current lease, even when their keys are equal.
  const ticket = keys;
  useLayoutEffect(() => {
    const blur = navigation.addListener('blur', () => {
      if (live.current) live.current.active = false;
      setGeneration(value => value + 1);
    });
    const focus = navigation.addListener('focus', () => setGeneration(value => value + 1));
    return () => {
      blur();
      focus();
      if (live.current) live.current.active = false;
      live.current = null;
    };
  }, [navigation]);
  useLayoutEffect(() => {
    if (!live.current || !live.current.active || !same(live.current.keys, keys)) {
      if (live.current) live.current.active = false;
      live.current = { keys, active: true, operation: null };
      setStatus(null);
    }
    tickets.current.set(ticket, live.current);
  }, [keys, ticket]);
  const onRoute = () => {
    const state = navigation.getState();
    return state?.routes[state.index]?.key === routeKey;
  };
  const current = () => live.current !== null && live.current === tickets.current.get(ticket) &&
    live.current.active && focused && online && !account.expired &&
    account.id === accountId && account.baseUrl === baseUrl && client.baseUrl === clientBaseUrl &&
    navigation.isFocused() && onRoute();
  const open = async (path: string, sourceCurrent: () => boolean = () => true) => {
    if (!current() || !sourceCurrent() || live.current!.operation) return;
    const lease = live.current!;
    const operation = {};
    lease.operation = operation;
    const owns = () => current() && lease.operation === operation;
    const mayOpen = () => owns() && sourceCurrent();
    setStatus({ keys, opening: path, error: null });
    try {
      await openSignedIn(path, mayOpen);
    } catch (error) {
      if (mayOpen()) setStatus({ keys, opening: null, error: error as Error });
    } finally {
      if (owns()) {
        lease.operation = null;
        setStatus(value => value && same(value.keys, keys) ? { ...value, opening: null } : value);
      }
    }
  };
  return {
    open,
    opening: status && same(status.keys, keys) ? status.opening : null,
    openError: status && same(status.keys, keys) ? status.error : null,
  };
}
