import { localizedZoneName } from '@/i18n/timeZones';
import { LocalizedText as Text } from '@/i18n/LocalizedText';
import { useTranslation } from '@/i18n';
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import {
  Bell,
  CalendarDays,
  HardDrive,
  Puzzle,
  Signature,
  Check,
  Clock,
  Download,
  Folder,
  Globe,
  House,
  Info,
  LifeBuoy,
  Mail,
  Plus,
  QrCode,
} from 'lucide-react-native';
import { type ComponentRef, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { usePairingAvailability, useProfile, useUpdateProfile } from '@/canvas/api/profile';
import { useSession } from '@/canvas/session';
import {
  haptics,
  Icon,
  IconTile,
  ListGroup,
  ListItem,
  type Option,
  OptionGroup,
  Screen,
  type SchemePreference,
  SearchField,
  Sheet,
  useSchemePreference,
  useToast,
} from '@/design';
import { AccountRow } from '@/features/accounts/AccountSwitcher';
import { useAccountBadges } from '@/features/accounts/badges';
import { confirmSignOut } from '@/features/auth/signOut';
import { useDeveloperMode } from '@/features/settings/developer';
import { landingTabs, useLandingTab } from '@/features/settings/landingTab';
import { canvasLanguages, languageName, languageOptionCode } from '@/features/settings/languages';
import { applyTimeZone } from '@/features/settings/timeZone';
import { useDisplayTimeZone } from '@/lib/dates';
import { useTimeZoneOptions } from '@/features/settings/useTimeZoneOptions';

const appearanceOptions: {
  value: SchemePreference;
  key: 'settings.system' | 'settings.light' | 'settings.dark';
}[] = [
  { value: 'system', key: 'settings.system' },
  { value: 'light', key: 'settings.light' },
  { value: 'dark', key: 'settings.dark' },
];

type SheetKind = 'landing' | 'language' | 'timeZone' | null;

/** Canvas's "use the school's default" language: an empty `user[locale]`. */
const SCHOOL_DEFAULT = 'default';

export default function SettingsScreen() {
  const { t, direction } = useTranslation();
  const { preference, setPreference } = useSchemePreference();
  const { accounts, active, switchAccount, signOut } = useSession();
  const badges = useAccountBadges();
  const developer = useDeveloperMode();
  const [landing, setLanding] = useLandingTab();
  const profile = useProfile();
  const pairing = usePairingAvailability();
  const update = useUpdateProfile();
  const zone = useDisplayTimeZone();
  const toast = useToast();
  const queryClient = useQueryClient();
  const landingTrigger = useRef<ComponentRef<typeof View>>(null);
  const languageTrigger = useRef<ComponentRef<typeof View>>(null);
  const zoneTrigger = useRef<ComponentRef<typeof View>>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);

  const unavailable = profile.isError && !profile.data ? t('settings.unavailable') : undefined;
  const pendingLocale = update.isPending ? update.variables?.locale : undefined;
  const pendingZone = update.isPending ? update.variables?.time_zone : undefined;
  const locale = languageOptionCode(
    pendingLocale !== undefined ? pendingLocale || null : profile.data?.locale,
  );
  const timeZone = pendingZone ?? profile.data?.timeZone ?? zone;

  const effectiveLocale = profile.data?.effectiveLocale;
  const languageOptions = useMemo<Option<string>[]>(
    () => [
      {
        value: SCHOOL_DEFAULT,
        label: t('settings.schoolDefault'),
        subtitle: effectiveLocale ? (languageName(effectiveLocale) ?? undefined) : undefined,
      },
      ...canvasLanguages.map(([value, label]) => ({ value, label })),
    ],
    [effectiveLocale, t],
  );

  const save = (patch: { locale?: string; time_zone?: string }, done: string) => {
    update.mutate(patch, {
      onSuccess: () => {
        haptics.success();
        if (patch.time_zone && active) applyTimeZone(queryClient, active.id, patch.time_zone);
        toast.show(done);
      },
      onError: () => {
        haptics.error();
        toast.show(t('settings.saveFailed'));
      },
    });
  };

  const close = () => {
    setSheet(null);
  };

  return (
    <View className="flex-1 bg-bg" style={{ direction }}>
      <Stack.Screen options={{ title: t('nav.settings') }} />
      <Screen contentClassName="gap-6">
        <ListGroup header={t('settings.accounts')} footer={t('settings.accountsHint')}>
          {accounts.map((account) => {
            const current = account.id === active?.id;
            return (
              <AccountRow
                key={account.id}
                account={account}
                current={current}
                unread={badges[account.id]}
                currentHint={t('settings.profile')}
                onPress={() => {
                  if (current) return router.push('/profile');
                  haptics.selection();
                  switchAccount(account.id);
                }}
              />
            );
          })}
          <ListItem
            leading={<IconTile icon={Plus} tone="neutral" />}
            title={t('nav.addAccount')}
            onPress={() => router.push('/add-account')}
          />
        </ListGroup>

        <ListGroup header={t('settings.appearance')} footer={t('settings.systemHint')}>
          {appearanceOptions.map((option) => {
            const selected = preference === option.value;
            return (
              <ListItem
                key={option.value}
                title={t(option.key)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                trailing={selected ? <Icon icon={Check} tone="accent" strokeWidth={2.25} /> : null}
                chevron={false}
                onPress={() => {
                  if (selected) return;
                  haptics.selection();
                  setPreference(option.value);
                }}
              />
            );
          })}
        </ListGroup>

        <ListGroup>
          <ListItem
            leading={<IconTile icon={House} tone="neutral" />}
            title={t('settings.start')}
            value={t(`nav.${landing}`)}
            ref={landingTrigger}
            onPress={() => setSheet('landing')}
          />
        </ListGroup>

        <ListGroup header={t('settings.languageZone')} footer={t('settings.languageZoneHint')}>
          <ListItem
            leading={<IconTile icon={Globe} tone="neutral" />}
            title={t('settings.language')}
            value={unavailable ?? (locale ? (languageName(locale) ?? locale) : t('settings.schoolDefault'))}
            disabled={!profile.data}
            ref={languageTrigger}
            onPress={() => setSheet('language')}
          />
          <ListItem
            leading={<IconTile icon={Clock} tone="neutral" />}
            title={t('settings.timeZone')}
            value={unavailable ?? localizedZoneName(timeZone) ?? undefined}
            disabled={!profile.data}
            ref={zoneTrigger}
            onPress={() => setSheet('timeZone')}
          />
        </ListGroup>

        <ListGroup header={t('settings.notifications')}>
          <ListItem
            leading={<IconTile icon={Bell} tone="neutral" />}
            title={t('settings.easelNotifications')}
            subtitle={t('settings.alertsHint')}
            onPress={() => router.push('/notification-settings')}
          />
          <ListItem
            leading={<IconTile icon={Mail} tone="neutral" />}
            title={t('settings.canvasNotifications')}
            subtitle={t('settings.emailHint')}
            onPress={() => router.push('/canvas-notifications')}
          />
        </ListGroup>

        <ListGroup>
          <ListItem
            leading={<IconTile icon={Signature} tone="neutral" />}
            title={t('settings.signature')}
            subtitle={t('settings.signatureHint')}
            onPress={() => router.push('/signature')}
          />
          <ListItem
            leading={<IconTile icon={CalendarDays} tone="neutral" />}
            title={t('settings.calendarFeed')}
            subtitle={t('settings.calendarHint')}
            onPress={() => router.push('/calendar-feed')}
          />
          <ListItem
            leading={<IconTile icon={Puzzle} tone="neutral" />}
            title={t('settings.tools')}
            subtitle={t('settings.toolsHint')}
            onPress={() => router.push('/tools')}
          />
        </ListGroup>

        <ListGroup header={t('settings.files')}>
          <ListItem
            leading={<IconTile icon={Folder} tone="neutral" />}
            title={t('settings.myFiles')}
            subtitle={t('settings.filesHint')}
            onPress={() => router.push('/files')}
          />
          <ListItem
            leading={<IconTile icon={Download} tone="neutral" />}
            title={t('settings.downloads')}
            subtitle={t('settings.downloadsHint')}
            onPress={() => router.push('/files/downloads')}
          />
        </ListGroup>

        <ListGroup>
          <ListItem
            leading={<IconTile icon={HardDrive} tone="neutral" />}
            title={t('settings.storage')}
            subtitle={t('settings.storageHint')}
            onPress={() => router.push('/storage')}
          />
        </ListGroup>

        <ListGroup>
          <ListItem
            leading={<IconTile icon={LifeBuoy} tone="neutral" />}
            title={t('settings.help')}
            subtitle={t('settings.helpHint')}
            onPress={() => router.push('/help')}
          />
          {pairing.data?.allowed ? (
            <ListItem
              leading={<IconTile icon={QrCode} tone="neutral" />}
              title={t('settings.observer')}
              subtitle={t('settings.observerHint')}
              onPress={() => router.push('/observer-pairing')}
            />
          ) : null}
        </ListGroup>

        {developer.enabled ? (
          <ListGroup header={t('settings.developer')}>
            <ListItem
              title={t('nav.design')}
              subtitle={t('settings.designHint')}
              onPress={() => router.push('/design')}
            />
          </ListGroup>
        ) : null}

        <ListGroup>
          <ListItem
            leading={<IconTile icon={Info} tone="neutral" />}
            title={t('settings.about')}
            value={Constants.expoConfig?.version ?? undefined}
            onPress={() => router.push('/about')}
          />
        </ListGroup>

        {active ? (
          <ListGroup>
            <ListItem
              title={t('settings.signOut', { name: active.user.shortName })}
              destructive
              chevron={false}
              onPress={() => confirmSignOut(active, signOut)}
            />
          </ListGroup>
        ) : null}
      </Screen>

      <Sheet
        doneLabel={t('common.done')}
        returnFocusRef={landingTrigger}
        visible={sheet === 'landing'}
        title={t('settings.start')}
        onClose={close}
      >
        {sheet === 'landing' ? (
          <View style={{ direction }}>
            <OptionGroup
              options={landingTabs.map((tab) => ({ value: tab.value, label: t(`nav.${tab.value}`) }))}
              selected={landing}
              footer={t('settings.startHint')}
              onSelect={(value) => {
                setLanding(value);
                close();
              }}
            />
          </View>
        ) : null}
      </Sheet>

      <Sheet
        doneLabel={t('common.done')}
        returnFocusRef={languageTrigger}
        visible={sheet === 'language'}
        title={t('settings.language')}
        onClose={close}
      >
        {sheet === 'language' ? (
          <View style={{ direction }}>
            <OptionGroup
              options={languageOptions}
              selected={locale ?? SCHOOL_DEFAULT}
              footer={t('settings.languageHint')}
              onSelect={(value) => {
                close();
                if (value === (locale ?? SCHOOL_DEFAULT)) return;
                save(
                  { locale: value === SCHOOL_DEFAULT ? '' : value },
                  t('settings.languageSaved', {
                    language:
                      value === SCHOOL_DEFAULT ? t('settings.schoolDefault') : (languageName(value) ?? value),
                  }),
                );
              }}
            />
          </View>
        ) : null}
      </Sheet>

      <Sheet
        doneLabel={t('common.done')}
        returnFocusRef={zoneTrigger}
        visible={sheet === 'timeZone'}
        title={t('settings.timeZone')}
        onClose={close}
      >
        {sheet === 'timeZone' ? (
          <TimeZoneOptions
            timeZone={timeZone}
            onClose={close}
            onSelect={(value) =>
              save({ time_zone: value }, t('settings.zoneSaved', { zone: localizedZoneName(value) }))
            }
          />
        ) : null}
      </Sheet>
      {toast.element}
    </View>
  );
}

function TimeZoneOptions({
  timeZone,
  onClose,
  onSelect,
}: {
  timeZone: string;
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  const { t, direction, locale } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();
  const [search, setSearch] = useState('');
  const { options: all, complete } = useTimeZoneOptions(locale, timeZone, t('settings.deviceZone'));
  const options = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? all.filter((option) => option.searchText.includes(term)) : all;
  }, [all, search]);
  return (
    <View className="gap-6" style={{ minHeight: windowHeight * 0.72, direction }}>
      <SearchField
        value={search}
        onChangeText={setSearch}
        placeholder={t('settings.searchZones')}
        accessibilityLabel={t('settings.searchZones')}
        returnKeyType="search"
      />
      {options.length ? (
        <OptionGroup
          options={options}
          selected={timeZone}
          onSelect={(value) => {
            onClose();
            if (value === timeZone) return;
            onSelect(value);
          }}
        />
      ) : complete ? (
        <Text variant="subhead" tone="muted" align="center" className="py-6">
          {t('settings.noZones', { search: search.trim() })}
        </Text>
      ) : null}
    </View>
  );
}
