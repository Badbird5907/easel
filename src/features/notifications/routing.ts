import * as Notifications from 'expo-notifications';
import { type Href, router, useRootNavigationState, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { useSession } from '@/canvas/session';
import { openCanvasLink, resolveCanvasLink } from '@/features/content/links';

import type { NotificationData } from './platform';

/*
 * Notification taps (NOTIF-5). A tap switches to the notification's account
 * if another one is active, then opens its screen. Works for taps while Easel
 * runs and for taps that launch it (`getLastNotificationResponseAsync`).
 */

const TAB_ROOTS = new Set(['/', '/inbox', '/todo', '/calendar']);

function open(data: NotificationData, baseUrl: string, fromAnotherAccount: boolean) {
  // Screens left over from the other account would show its data under this one.
  if (fromAnotherAccount && router.canDismiss()) router.dismissAll();
  if (data.path) {
    if (TAB_ROOTS.has(data.path)) router.navigate(data.path as Href);
    else router.push(data.path as Href);
    return;
  }
  if (!data.url) return;
  const internal = resolveCanvasLink(data.url, baseUrl);
  if (internal) router.push(internal as never);
  // A path that isn't a Canvas link is one of Easel's own routes.
  else if (data.url.startsWith('/')) router.push(data.url as Href);
  else openCanvasLink(data.url, baseUrl);
}

export function useNotificationRouting() {
  const { status, accounts, active, switchAccount } = useSession();
  const navigationKey = useRootNavigationState()?.key;
  // The tap waiting for the session and navigator; `taps` reruns the effect below.
  const pending = useRef<NotificationData | null>(null);
  const [taps, setTaps] = useState(0);
  const switched = useRef(false);

  useEffect(() => {
    const handled = new Set<string>();
    const accept = (response: Notifications.NotificationResponse | null) => {
      if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const { request, date } = response.notification;
      const key = `${request.identifier}:${date}`;
      if (handled.has(key)) return;
      handled.add(key);
      const data = request.content.data as Partial<NotificationData> | undefined;
      if (data && (data.path || data.url)) {
        pending.current = data as NotificationData;
        setTaps((n) => n + 1);
      }
      // Handled once: a later launch shouldn't open it again.
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    Notifications.getLastNotificationResponseAsync()
      .then(accept)
      .catch(() => {});
    const subscription = Notifications.addNotificationResponseReceivedListener(accept);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const target = pending.current;
    if (!target || status !== 'ready' || !navigationKey) return;
    const account = target.accountId ? accounts.find((a) => a.id === target.accountId) : active;
    if (!account || account.expired) {
      // Signed out of that account since: just open Easel.
      pending.current = null;
      return;
    }
    if (active?.id !== account.id) {
      switched.current = true;
      void switchAccount(account.id);
      return;
    }
    const fromAnotherAccount = switched.current;
    switched.current = false;
    pending.current = null;
    // A frame for the active account's screens to settle before pushing.
    requestAnimationFrame(() => open(target, account.baseUrl, fromAnotherAccount));
  }, [taps, status, navigationKey, accounts, active, switchAccount]);
}

/** Native notifications enter through an easel:// link and share account-switching semantics. */
export function useBridgedNotificationRouting() {
  const { accountId, path } = useLocalSearchParams<{ accountId?: string; path?: string }>();
  const { status, accounts, active, switchAccount } = useSession();
  useEffect(() => {
    if (status !== 'ready') return;
    const account = accounts.find(a => a.id === accountId && !a.expired);
    if (!account) { router.replace('/'); return; }
    if (active?.id !== account.id) { void switchAccount(account.id); return; }
    // Only allow bridge destinations, never arbitrary URLs supplied in an intent.
    const safe = path && /^\/(activity|inbox|calendar|course\/[^/]+\/(announcements|grades|discussions|assignments))$/.test(path);
    if (router.canDismiss()) router.dismissAll();
    router.replace((safe ? path : '/activity') as Href);
  }, [status, accounts, active?.id, accountId, path, switchAccount]);
}
