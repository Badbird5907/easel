import * as WebBrowser from 'expo-web-browser';
import { ExternalLink } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useSignInTerms } from '@/canvas/api/legal';
import { CanvasNetworkError } from '@/canvas/client';
import type { PendingSignIn } from '@/canvas/session';
import { Button, Callout, Card, haptics, Skeleton, Text } from '@/design';
import { useTranslation, type MessageKey } from '@/i18n';

import { authTermsClaim, useAuthTermsLifetime } from './authTermsLifetime';
import { TermsDocument } from './TermsDocument';

type Props = {
  pending: PendingSignIn;
  /** Draws "Terms of use" as a heading, when the screen has no large title. */
  showHeading?: boolean;
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
};

/**
 * The school's terms of use, when Canvas says they need accepting (AUTH-7).
 * Accepting sends `PUT /api/v1/users/self` with `user[terms_of_use]`.
 */
export function TermsStep({ pending, showHeading, onAccept, onDecline }: Props) {
  const terms = useSignInTerms(pending.client);
  const { t } = useTranslation();
  const { account, client } = pending;
  const { html, url, none } = terms.data ?? {};
  // Recheck reconstructs pending each render. Only semantic terms/account changes retire work.
  const identity = useMemo(
    () => ({
      id: account.id,
      baseUrl: account.baseUrl,
      client,
      html,
      url,
      none,
      pending: terms.isPending,
    }),
    [account.id, account.baseUrl, client, html, url, none, terms.isPending],
  );
  const owner = useAuthTermsLifetime(identity);
  const auxiliaryIdentity = useMemo(
    () => ({ owner, isError: terms.isError }),
    [owner, terms.isError],
  );
  const auxiliaryOwner = useAuthTermsLifetime(auxiliaryIdentity);
  const [status, setStatus] = useState<{
    owner: typeof owner;
    busy: 'accept' | 'decline' | null;
    error: MessageKey | null;
  } | null>(null);
  const busy = status?.owner === owner ? status.busy : null;
  const error = status?.owner === owner ? status.error : null;

  const act = async (kind: 'accept' | 'decline') => {
    if (kind === 'accept' && terms.isPending) return;
    const operation = authTermsClaim(owner);
    if (!operation) return;
    setStatus({ owner, busy: kind, error: null });
    try {
      await (kind === 'accept' ? onAccept() : onDecline());
      // Success remains claimed until the parent leaves or remounts after Alert cancellation.
    } catch (e) {
      if (!operation.current()) return;
      haptics.error();
      setStatus({
        owner,
        busy: null,
        error: e instanceof CanvasNetworkError ? 'authTerms.networkError' : 'authTerms.answerError',
      });
      operation.release();
    }
  };

  const auxiliary = async (kind: 'retry' | 'browser') => {
    if (terms.isPending || html || (kind === 'retry' && !terms.isError)) return;
    const control = authTermsClaim(auxiliaryOwner);
    if (!control) return;
    const operation = authTermsClaim(owner);
    if (!operation) {
      control.release();
      return;
    }
    setStatus({ owner, busy: null, error: null });
    try {
      if (kind === 'retry') await terms.refetch();
      else await WebBrowser.openBrowserAsync(url ?? `${account.baseUrl}/terms_of_use`);
    } catch {
      if (operation.current() && control.current())
        setStatus({
          owner,
          busy: null,
          error: kind === 'retry' ? 'authTerms.loadError' : 'authTerms.browserError',
        });
    } finally {
      control.release();
      operation.release();
    }
  };

  return (
    <View className="gap-6">
      <View className="gap-1.5">
        {showHeading ? (
          <Text variant="title2" accessibilityRole="header">
            {t('authTerms.heading')}
          </Text>
        ) : null}
        <Text variant="body" tone="muted" className={showHeading ? undefined : '-mt-2'}>
          {t('authTerms.schoolRequest', { name: account.host })}
        </Text>
      </View>

      <Card variant="outlined" padding="lg" className="gap-3">
        {terms.isPending ? (
          <View className="gap-2.5" accessibilityLabel={t('authTerms.loading')}>
            <Skeleton className="h-5 w-2/3 rounded-md" />
            <Skeleton className="h-4 w-full rounded-md" />
            <Skeleton className="h-4 w-full rounded-md" />
            <Skeleton className="h-4 w-4/5 rounded-md" />
          </View>
        ) : terms.data?.html ? (
          <TermsDocument html={terms.data.html} baseUrl={account.baseUrl} />
        ) : (
          <View className="gap-3">
            {terms.isError ? (
              <Callout
                tone="warning"
                title={t('authTerms.loadError')}
                action={{ label: t('authTerms.retry'), onPress: () => auxiliary('retry') }}
              >
                {t('authTerms.websiteInstead')}
              </Callout>
            ) : (
              <Text variant="subhead" tone="muted">
                {t('authTerms.website')}
              </Text>
            )}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              leadingIcon={ExternalLink}
              onPress={() => auxiliary('browser')}
            >
              {t('authTerms.read')}
            </Button>
          </View>
        )}
      </Card>

      {error ? (
        <Callout tone="danger" title={t('authTerms.continueError')}>
          {t(error)}
        </Callout>
      ) : null}

      <View className="gap-2">
        <Button
          size="lg"
          loading={busy === 'accept'}
          disabled={terms.isPending || !!busy}
          onPress={() => act('accept')}
        >
          {t('authTerms.accept')}
        </Button>
        <Button
          variant="ghost"
          loading={busy === 'decline'}
          disabled={!!busy}
          onPress={() => act('decline')}
        >
          {t('authTerms.decline')}
        </Button>
      </View>

      <Text variant="footnote" tone="muted" align="center">
        {t('authTerms.signingIn', { name: account.user.name })}
      </Text>
    </View>
  );
}
