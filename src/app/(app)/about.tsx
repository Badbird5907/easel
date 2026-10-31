import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { FileText, Lock, ShieldCheck } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';

import { privacyPolicyUrl, useSignInProfile, useTerms } from '@/canvas/api/legal';
import { useCanvas } from '@/canvas/session';
import {
  Button,
  Callout,
  Card,
  haptics,
  IconTile,
  ListGroup,
  ListItem,
  Screen,
  Sheet,
  Skeleton,
  Switch,
  Text,
  useToast,
} from '@/design';
import { RichContent } from '@/features/content/RichContent';
import { useDeveloperMode } from '@/features/settings/developer';
import { useSettingsAboutOwner, type SettingsAboutRun } from '@/features/settings/settingsAboutLifetime';
import { UpdatesSection } from '@/features/updates/UpdatesSection';
import { useTranslation } from '@/i18n';

/** Taps on the version that turn on developer settings (SET-13). */
const TAPS = 7;

/** About and legal (SET-12): versions, the signed-in account, the school's terms, and Easel's privacy. */
export default function AboutScreen() {
  const { t } = useTranslation();
  const { account, client } = useCanvas();
  const profile = useSignInProfile();
  const terms = useTerms();
  const developer = useDeveloperMode();
  const toast = useToast();
  const identity = useMemo(
    () => ({ accountId: account.id, userId: account.user.id, client, baseUrl: account.baseUrl }),
    [account.id, account.user.id, client, account.baseUrl],
  );
  const owner = useSettingsAboutOwner(identity);
  const html = terms.data?.html;
  const termsUrl = terms.data?.url ?? `${account.baseUrl}/terms_of_use`;
  const none = !!terms.data?.none;
  const legalIdentity = useMemo(
    () => ({ identity, html, termsUrl, none, pending: terms.isPending }),
    [identity, html, termsUrl, none, terms.isPending],
  );
  const legalOwner = useSettingsAboutOwner(legalIdentity);
  const developerIdentity = useMemo(
    () => ({ identity, enabled: developer.enabled, alwaysOn: developer.alwaysOn }),
    [identity, developer.enabled, developer.alwaysOn],
  );
  const developerOwner = useSettingsAboutOwner(developerIdentity);
  // Locale/refetch object changes preserve progress. Account/client/focus changes don't.
  const taps = useRef<{ owner: typeof owner | null; count: number; last: number }>({
    owner: null,
    count: 0,
    last: 0,
  });
  const changedDeveloper = useRef<typeof developerOwner | null>(null);
  const browser = useRef<SettingsAboutRun | null>(null);
  const liveSheet = useRef<SettingsAboutRun | null>(null);
  const [sheet, setSheet] = useState<SettingsAboutRun | null>(null);
  const termsOpen = sheet?.owner === legalOwner && sheet.current();

  const version =
    Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? t('settingsAbout.unknown');
  const build = Application.nativeBuildVersion;

  const tapVersion = () => {
    if (!developerOwner.current()) return;
    if (developer.alwaysOn) return toast.show(t('settingsAbout.alwaysOnNotice'));
    if (developer.enabled) return toast.show(t('settingsAbout.alreadyOn'));
    if (changedDeveloper.current === developerOwner) return;
    if (taps.current.owner !== owner) taps.current = { owner, count: 0, last: 0 };
    const progress = taps.current;
    const now = Date.now();
    progress.count = now - progress.last < 1500 ? progress.count + 1 : 1;
    progress.last = now;
    const left = TAPS - progress.count;
    if (left <= 0) {
      progress.count = 0;
      changedDeveloper.current = developerOwner;
      developer.setEnabled(true);
      haptics.success();
      toast.show(t('settingsAbout.enabledNotice'));
    } else if (left <= 3) {
      toast.show(t('settingsAbout.moreTaps', { count: left }));
    }
  };
  const toggleDeveloper = (enabled: boolean) => {
    if (
      !developerOwner.current() ||
      developer.alwaysOn ||
      !developer.enabled ||
      enabled === developer.enabled ||
      changedDeveloper.current === developerOwner
    )
      return;
    changedDeveloper.current = developerOwner;
    developer.setEnabled(enabled);
  };
  const openBrowser = async (target: typeof owner, url: string) => {
    if (!target.current() || browser.current?.current()) return;
    const run = { owner: target, current: target.capture() };
    browser.current = run;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      // Preserve the existing silent browser failure behavior.
    } finally {
      // A late settlement cannot release a newer account/resource's browser claim.
      if (browser.current === run) browser.current = null;
    }
  };
  const openTerms = () => {
    if (!legalOwner.current() || none || terms.isPending) return;
    if (html) {
      if (liveSheet.current?.current()) return;
      const run = { owner: legalOwner, current: legalOwner.capture() };
      liveSheet.current = run;
      setSheet(run);
    } else void openBrowser(legalOwner, termsUrl);
  };
  const closeTerms = () => {
    if (!sheet?.current() || liveSheet.current !== sheet) return;
    liveSheet.current = null;
    setSheet(null);
  };
  const browseTerms = () => {
    if (!sheet?.current() || liveSheet.current !== sheet || none || terms.isPending) return;
    void openBrowser(legalOwner, termsUrl);
  };

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('settingsAbout.title') }} />
      <Screen contentClassName="gap-6">
        <ListGroup header="Easel">
          {account.authMethod === 'demo' ? <ListItem title={t('demo.label')} chevron={false} /> : null}
          <ListItem
            title={t('settingsAbout.version')}
            value={build ? t('settingsAbout.versionBuild', { version, build }) : version}
            chevron={false}
            accessibilityLabel={
              build
                ? t('settingsAbout.versionBuildLabel', { version, build })
                : t('settingsAbout.versionLabel', { version })
            }
            onPress={tapVersion}
          />
          {developer.enabled ? (
            <ListItem
              title={t('settingsAbout.developer')}
              subtitle={t(developer.alwaysOn ? 'settingsAbout.alwaysOn' : 'settingsAbout.gallery')}
              trailing={
                <Switch
                  value={developer.enabled}
                  disabled={developer.alwaysOn}
                  onValueChange={toggleDeveloper}
                  accessibilityLabel={t('settingsAbout.developer')}
                />
              }
            />
          ) : null}
        </ListGroup>

        <UpdatesSection />

        <ListGroup header={t('settingsAbout.signedIn')}>
          <ListItem title={t('settingsAbout.school')} value={account.host} />
          <ListItem
            title={t('settingsAbout.loginId')}
            value={
              profile.data
                ? (profile.data.loginId ?? t('settingsAbout.notShown'))
                : profile.isError
                  ? t('settingsAbout.unavailable')
                  : undefined
            }
            trailing={profile.isPending ? <Skeleton className="h-4 w-24 rounded-md" /> : null}
          />
          <ListItem
            title={t('settingsAbout.signedInWith')}
            value={t(
              account.authMethod === 'oauth' ? 'settingsAbout.schoolSignIn' : 'settingsAbout.accessToken',
            )}
          />
        </ListGroup>

        <ListGroup
          header={t('settingsAbout.yourSchool')}
          footer={t('settingsAbout.schoolSource', { host: account.host })}
        >
          {terms.data?.none ? null : (
            <ListItem
              leading={<IconTile icon={FileText} tone="neutral" />}
              title={t('settingsAbout.terms')}
              onPress={openTerms}
              disabled={terms.isPending}
            />
          )}
          <ListItem
            leading={<IconTile icon={ShieldCheck} tone="neutral" />}
            title={t('settingsAbout.privacyPolicy')}
            onPress={() => void openBrowser(owner, privacyPolicyUrl(account.baseUrl))}
          />
        </ListGroup>

        <Card variant="filled" className="gap-3">
          <View className="flex-row items-center gap-3">
            <IconTile icon={Lock} tone="accent" />
            <Text variant="headline" accessibilityRole="header" className="flex-1">
              {t('settingsAbout.privacyTitle')}
            </Text>
          </View>
          <Text variant="subhead" tone="muted">
            {t(Platform.OS === 'ios' ? 'settingsAbout.privacyIos' : 'settingsAbout.privacyAndroid')}
          </Text>
          <Text variant="subhead" tone="muted">
            {t('settingsAbout.schoolPrivacy')}
          </Text>
        </Card>

        <Text variant="footnote" tone="muted" align="center" className="px-4">
          {t('settingsAbout.independent')}
        </Text>
      </Screen>
      {toast.element}

      <Sheet visible={!!termsOpen} title={t('settingsAbout.terms')} onClose={closeTerms}>
        {terms.data?.html ? (
          <View className="px-1">
            <RichContent html={terms.data.html} />
          </View>
        ) : (
          <Callout tone="info" title={t('settingsAbout.webTerms')}>
            {t('settingsAbout.webTermsHelp')}
          </Callout>
        )}
        <Button variant="outline" onPress={browseTerms} disabled={!termsOpen || none || terms.isPending}>
          {t('settingsAbout.openBrowser')}
        </Button>
      </Sheet>
    </View>
  );
}
