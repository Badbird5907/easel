import * as Clipboard from 'expo-clipboard';
import { Stack, useIsFocused, useNavigation } from 'expo-router';
import { Copy, RefreshCw, Share2, ShieldOff } from 'lucide-react-native';
import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { Share, View } from 'react-native';

import { CanvasError } from '@/canvas/client';
import { pairingLink, usePairingAvailability, useProfile } from '@/canvas/api/profile';
import { useCanvas } from '@/canvas/session';
import { useCanvasMutation } from '@/canvas/query';
import { Button, Callout, Card, EmptyState, haptics, Screen, Skeleton, Text } from '@/design';
import { useOnline } from '@/features/offline/useOnline';
import { QrCode } from '@/features/settings/QrCode';
import {
  settingsPairingCreate,
  SettingsPairingEffects,
  SettingsPairingOwner,
  SettingsPairingVisit,
} from '@/features/settings/settingsPairingLifetime';
import { useTranslation } from '@/i18n';
import { createDateContext, isValidTimeZone } from '@/lib/dates';

/** Canvas answers 401 when the school doesn't let observers sign themselves up. */
const notAllowed = (error: unknown) =>
  error instanceof CanvasError && (error.status === 401 || error.status === 403);

/** SET-9. New codes do not revoke earlier codes; expiration remains Canvas-owned. */
export default function ObserverPairingScreen() {
  const { account, client } = useCanvas();
  const availability = usePairingAvailability();
  const profile = useProfile();
  const { mutateAsync, reset } = useCanvasMutation(settingsPairingCreate);
  const online = useOnline();
  const focused = useIsFocused();
  const navigation = useNavigation();
  const { t, locale } = useTranslation();
  const status = availability.isError
    ? 'error'
    : availability.data?.allowed === true
      ? 'allowed'
      : availability.data?.allowed === false
        ? 'denied'
        : 'unknown';
  const schoolAccountId = availability.data?.accountId;
  const effects = useMemo(() => new SettingsPairingEffects(), []);
  const visit = useMemo(
    () => new SettingsPairingVisit(account.id, account.host, client, effects),
    [account.id, account.host, client, effects],
  );
  const owner = useMemo(
    () => new SettingsPairingOwner(visit, status === 'allowed', schoolAccountId, focused, navigation),
    [visit, status, schoolAccountId, focused, navigation],
  );
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  useLayoutEffect(() => {
    owner.activate();
    return () => {
      owner.retire();
      // Detach the mutation observer before a replacement account can update its options.
      reset();
    };
  }, [owner, reset]);
  useLayoutEffect(() => owner.setOnline(online), [owner, online]);
  useLayoutEffect(() => {
    owner.setShareMessage((code) => t('settingsPairing.shareMessage', { code }));
  }, [owner, t]);
  useEffect(() => {
    const current = owner.capture();
    // Replay can retire the first schedule before any request enters Canvas.
    void Promise.resolve().then(() => {
      if (current()) void owner.generate(owner.getSnapshot(), mutateAsync, true);
    });
  }, [owner, online, mutateAsync]);

  const code = state.code;
  const link = code && schoolAccountId ? pairingLink(account.host, code.code, schoolAccountId) : null;
  const blocked = status === 'denied' || notAllowed(availability.error) || notAllowed(state.error);
  const zone = profile.data?.timeZone;
  // Unknown Canvas metadata must not silently substitute the device's civil day.
  const dates = useMemo(
    () => (zone && isValidTimeZone(zone) ? createDateContext(locale, zone) : null),
    [locale, zone],
  );
  const generate = () => owner.generate(state, mutateAsync);
  const retry = () => owner.retry(() => availability.refetch());

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('settingsPairing.title') }} />
      <Screen contentClassName="gap-6">
        {blocked ? (
          <Card padding="none">
            <EmptyState
              icon={ShieldOff}
              title={t('settingsPairing.blockedTitle')}
              description={t('settingsPairing.blockedBody', { host: account.host })}
            />
          </Card>
        ) : (
          <>
            <Text variant="body" tone="muted">
              {t('settingsPairing.introduction')}
            </Text>
            <Card className="items-center gap-4" padding="lg">
              {status !== 'allowed' ? (
                status === 'error' || !online ? (
                  <Callout
                    tone="danger"
                    title={t('settingsPairing.availabilityError')}
                    action={{ label: t('settingsPairing.retry'), onPress: retry }}
                    className="self-stretch"
                  >
                    {t(!online ? 'settingsPairing.offlineAvailability' : 'settingsPairing.availabilityHelp')}
                  </Callout>
                ) : (
                  <Text variant="subhead" tone="muted">
                    {t('settingsPairing.checking')}
                  </Text>
                )
              ) : (
                <>
                  {code ? (
                    <>
                      {link ? (
                        <View className="overflow-hidden rounded-xl" style={{ borderCurve: 'continuous' }}>
                          <QrCode
                            value={link}
                            accessibilityLabel={t('settingsPairing.qrLabel', {
                              code: code.code.split('').join(' '),
                            })}
                          />
                        </View>
                      ) : null}
                      <View className="items-center gap-1">
                        <Text variant="subhead" tone="muted">
                          {t('settingsPairing.codeLabel')}
                        </Text>
                        <Text
                          variant="title1"
                          weight="semibold"
                          tabular
                          selectable
                          className="tracking-[4px]"
                          accessibilityLabel={t('settingsPairing.spokenCode', {
                            code: code.code.split('').join(' '),
                          })}
                        >
                          {code.code}
                        </Text>
                        <Text variant="footnote" tone="muted">
                          {dates
                            ? t('settingsPairing.expires', { date: dates.dueIn(code.expiresAt) })
                            : t('settingsPairing.expirationUnavailable')}
                        </Text>
                      </View>
                    </>
                  ) : state.pending ? (
                    <View className="items-center gap-4" accessibilityLabel={t('settingsPairing.creating')}>
                      <Skeleton className="h-[220px] w-[220px] rounded-xl" />
                      <Skeleton className="h-8 w-32" />
                    </View>
                  ) : !online ? (
                    <Text variant="subhead" tone="muted" align="center">
                      {t('settingsPairing.offline')}
                    </Text>
                  ) : !state.error ? (
                    <Button onPress={generate}>{t('settingsPairing.generate')}</Button>
                  ) : null}
                  {state.error ? (
                    <Callout
                      tone="danger"
                      title={t('settingsPairing.createError')}
                      action={online ? { label: t('settingsPairing.retry'), onPress: generate } : undefined}
                      className="self-stretch"
                    >
                      {t(online ? 'settingsPairing.createHelp' : 'settingsPairing.offline')}
                    </Callout>
                  ) : null}
                </>
              )}
            </Card>
            {code && status === 'allowed' ? (
              <View className="gap-2">
                <Button
                  leadingIcon={Share2}
                  disabled={state.pending}
                  onPress={() =>
                    owner.native(
                      state,
                      'share',
                      (raw) => Share.share({ message: owner.formatShareMessage(raw) }),
                      () => {},
                    )
                  }
                >
                  {t('settingsPairing.share')}
                </Button>
                <Button
                  variant="secondary"
                  leadingIcon={Copy}
                  disabled={state.pending}
                  onPress={() =>
                    owner.native(
                      state,
                      'copy',
                      (raw) => Clipboard.setStringAsync(raw),
                      () => haptics.success(),
                    )
                  }
                >
                  {t('settingsPairing.copy')}
                </Button>
                <Button
                  variant="ghost"
                  leadingIcon={RefreshCw}
                  loading={state.pending}
                  disabled={!online}
                  onPress={generate}
                >
                  {t('settingsPairing.newCode')}
                </Button>
                {state.feedback ? (
                  <Text
                    variant="footnote"
                    tone={state.feedback === 'copied' ? 'muted' : 'danger'}
                    accessibilityLiveRegion="polite"
                  >
                    {t(`settingsPairing.${state.feedback}`)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </Screen>
    </View>
  );
}
