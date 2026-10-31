import { useCanvas } from '@/canvas/session';
import { observeAccountDisplay } from '@/i18n/account-display';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useLayoutEffect } from 'react';
import { useProfile } from '@/canvas/api/profile';
import { useAccountKey } from '@/canvas/query';
import { resetAccountLocale, setAccountLocale, useTranslation } from '@/i18n';
import { redrawDates } from './timeZone';

/** Mount once around the signed-in navigator. Never persist a global account preference. */
export function CanvasLocaleSync({ children }: { children: ReactNode }) {
  const profile = useProfile();
  const { client } = useCanvas();
  const accountId = useAccountKey();
  const queryClient = useQueryClient();
  const current = useTranslation();
  const effectiveLocale = profile.data?.effectiveLocale;
  useLayoutEffect(() => {
    if (setAccountLocale(accountId, effectiveLocale)) redrawDates(queryClient, accountId);
  }, [accountId, effectiveLocale, queryClient]);
  useLayoutEffect(() => {
    if (profile.data) observeAccountDisplay(accountId, client, profile.data);
  }, [accountId, client, profile.data, profile.dataUpdatedAt]);
  useLayoutEffect(() => () => resetAccountLocale(accountId), [accountId]);
  // Do not mount a new account's screens against the old account's date formatters.
  // Same-account language changes keep the navigator and all draft/component state mounted.
  return current.accountId === accountId ? children : null;
}
