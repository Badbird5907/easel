import { Stack } from 'expo-router';
import { Bell, BellOff, Moon } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { useSession } from '@/canvas/session';
import {
  IconTile,
  ListGroup,
  ListItem,
  type Option,
  OptionGroup,
  Screen,
  Sheet,
  Switch,
  useToast,
} from '@/design';
import { backgroundChecksAvailable, runBackgroundCheckNow } from '@/background/tasks';
import { useApplyDefaultReminders } from '@/features/notifications/bridge';
import { replayLastWeek } from '@/features/notifications/check';
import {
  ensurePermission,
  openNotificationSettings,
  useNotificationPermission,
} from '@/features/notifications/permission';
import { scheduleAt } from '@/features/notifications/platform';
import {
  type NotificationSettings,
  updateCategories,
  updateSettings,
  useCheckMeta,
  useNotificationSettings,
} from '@/features/notifications/settings';
import { useOnline } from '@/features/offline/useOnline';
import { DateTimeRow } from '@/features/planner/DateTimeRow';
import { offsetLabel, presetOffsets } from '@/features/reminders/model';
import { type RemindableItem, ReminderControl } from '@/features/reminders/ReminderControl';
import { remindersFor, retargetDefaultReminders } from '@/features/reminders/store';
import { createDateContext, deviceTimeZone, useDisplayTimeZone } from '@/lib/dates';
import { quietHourValue, quietHourMinutes, checkAge } from '@/features/notifications/display';
import { useTranslation } from '@/i18n';

function change(patch: (s: NotificationSettings) => Partial<NotificationSettings>) {
  updateSettings((s) => ({ ...s, ...patch(s) }));
}

/** Easel's own notifications (SET-5): what alerts, quiet hours, the default reminder, and permission. */
export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const defaultOptions: Option<string>[] = [
    { value: 'off', label: t('reminder.none') },
    ...presetOffsets.map((p) => ({ value: String(p.minutes), label: offsetLabel(p.minutes, t) })),
  ];
  const settings = useNotificationSettings();
  const permission = useNotificationPermission();
  const toast = useToast();
  const applyDefaults = useApplyDefaultReminders();
  const [defaultOpen, setDefaultOpen] = useState(false);

  const permissionRow =
    permission === 'granted'
      ? { title: t('notifications.permissionOn'), subtitle: t('notifications.permissionOnHint') }
      : permission === 'denied'
        ? {
            title: t('notifications.permissionOff'),
            subtitle: t('notifications.permissionOffHint'),
          }
        : permission === 'undetermined'
          ? {
              title: t('notifications.permissionAllow'),
              subtitle: t('notifications.permissionAllowHint'),
            }
          : { title: t('notifications.permissionChecking'), subtitle: undefined };

  return (
    <>
      <Stack.Screen options={{ title: t('notifications.title') }} />
      <Screen contentClassName="gap-6">
        <ListGroup>
          <ListItem
            leading={
              <IconTile
                icon={permission === 'denied' ? BellOff : Bell}
                tone={permission === 'denied' ? 'warning' : permission === 'granted' ? 'success' : 'neutral'}
              />
            }
            title={permissionRow.title}
            subtitle={permissionRow.subtitle}
            disabled={permission === null}
            accessibilityHint={
              permission === 'undetermined' ? t('notifications.permissionAskHint') : t('notifications.openSettingsHint')
            }
            onPress={() => {
              if (permission === 'undetermined') void ensurePermission();
              else openNotificationSettings();
            }}
          />
        </ListGroup>

        <ListGroup
          header={t('notifications.updates')}
          footer={t('notifications.updatesHint')}
        >
          {updateCategories.map((category) => (
            <ListItem
              key={category.value}
              title={t(`notifications.update.${category.value}`)}
              subtitle={t(`notifications.update.${category.value}.detail`)}
              chevron={false}
              trailing={
                <Switch
                  accessibilityLabel={t(`notifications.update.${category.value}`)}
                  value={settings.updates[category.value]}
                  onValueChange={(on) => change((s) => ({ updates: { ...s.updates, [category.value]: on } }))}
                />
              }
            />
          ))}
        </ListGroup>

        <ListGroup
          header={t('notifications.dueReminders')}
          footer={
            settings.defaultReminderMinutes === null
              ? t('reminder.manualHint')
              : t('reminder.defaultHint', { offset: offsetLabel(settings.defaultReminderMinutes, t) })
          }
        >
          <ListItem
            title={t('notifications.reminders')}
            subtitle={t('notifications.remindersHint')}
            chevron={false}
            trailing={
              <Switch
                accessibilityLabel={t('notifications.reminders')}
                value={settings.reminders}
                onValueChange={(on) => change(() => ({ reminders: on }))}
              />
            }
          />
          <ListItem
            title={t('notifications.default')}
            value={
              settings.defaultReminderMinutes === null ? t('reminder.none') : offsetLabel(settings.defaultReminderMinutes, t)
            }
            disabled={!settings.reminders}
            className={settings.reminders ? undefined : 'opacity-40'}
            accessibilityHint={t('notifications.defaultChooseHint')}
            onPress={() => setDefaultOpen(true)}
          />
        </ListGroup>

        <ListGroup
          header={t('notifications.quiet')}
          footer={t(Platform.OS === 'ios' ? 'notifications.quietIos' : 'notifications.quietAndroid')}
        >
          <ListItem
            leading={<IconTile icon={Moon} tone="neutral" />}
            title={t('notifications.quiet')}
            chevron={false}
            trailing={
              <Switch
                accessibilityLabel={t('notifications.quiet')}
                value={settings.quietHours.enabled}
                onValueChange={(on) => change((s) => ({ quietHours: { ...s.quietHours, enabled: on } }))}
              />
            }
          />
          {settings.quietHours.enabled ? (
            <DateTimeRow
              label={t('notifications.from')}
              mode="time"
              timeZone={deviceTimeZone()}
              value={quietHourValue(settings.quietHours.start)}
              onChange={(date) =>
                change((s) => ({ quietHours: { ...s.quietHours, start: quietHourMinutes(date) } }))
              }
            />
          ) : null}
          {settings.quietHours.enabled ? (
            <DateTimeRow
              label={t('notifications.to')}
              mode="time"
              timeZone={deviceTimeZone()}
              value={quietHourValue(settings.quietHours.end)}
              onChange={(date) => change((s) => ({ quietHours: { ...s.quietHours, end: quietHourMinutes(date) } }))}
            />
          ) : null}
        </ListGroup>

        {__DEV__ ? <DeveloperSection onMessage={toast.show} /> : null}
      </Screen>
      {toast.element}

      <Sheet visible={defaultOpen} title={t('notifications.default')} onClose={() => setDefaultOpen(false)}>
        <OptionGroup
          options={defaultOptions}
          selected={
            settings.defaultReminderMinutes === null ? 'off' : String(settings.defaultReminderMinutes)
          }
          footer={t('notifications.defaultFooter')}
          onSelect={(value) => {
            const minutes = value === 'off' ? null : Number(value);
            change(() => ({ defaultReminderMinutes: minutes }));
            retargetDefaultReminders(minutes);
            applyDefaults();
            if (minutes !== null) void ensurePermission();
            setDefaultOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}

/** Debug builds only: run the background check and post a test notification on demand. */
function DeveloperSection({ onMessage }: { onMessage: (message: string) => void }) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const display = useMemo(() => createDateContext(locale, zone), [locale, zone]);
  const { accounts, active } = useSession();
  const meta = useCheckMeta();
  const online = useOnline();
  const [running, setRunning] = useState(false);
  const [systemTasks, setSystemTasks] = useState<boolean | null>(null);
  // Due 16 minutes after it was first shown, so "15 minutes before" goes off in about a minute.
  // Keeps its due date while that's ahead, so reopening this screen doesn't move the reminder.
  const [sample] = useState<RemindableItem>(() => {
    const kept = active ? remindersFor(active.id).get().dev_sample?.item.dueAt : null;
    const dueAt = kept && kept > Date.now() ? kept : Math.ceil(Date.now() / 60_000) * 60_000 + 16 * 60_000;
    return {
      id: 'dev_sample',
      title: '',
      dueAt: new Date(dueAt),
      url: '/notification-settings',
    };
  });

  useEffect(() => {
    backgroundChecksAvailable().then(setSystemTasks);
  }, []);

  const age = meta.lastCheckAt ? checkAge(new Date(meta.lastCheckAt), display) : null;
  const last = age
    ? [t('notifications.lastCheck', { age, count: meta.lastResult?.posted ?? 0 }),
        meta.lastResult?.failed ? t('notifications.failedCount', { count: meta.lastResult.failed }) : null].filter(Boolean).join(' ')
    : t('notifications.noCheck');
  const where =
    systemTasks === false
      ? t('notifications.noBackground')
      : t('notifications.background');

  return (
    <ListGroup header={t('notifications.developer')} footer={`${last} ${where}`}>
      <ListItem
        title={running ? t('notifications.checking') : t('notifications.checkNow')}
        subtitle={online ? t('notifications.checkHint') : t('notifications.offline')}
        disabled={running || !online}
        onPress={async () => {
          setRunning(true);
          try {
            const outcome = await runBackgroundCheckNow();
            onMessage(
              outcome.via === 'system'
                ? t('notifications.systemRequested')
                : t('notifications.checked', { count: outcome.result.accounts, posted: outcome.result.posted }),
            );
          } catch (error) {
            onMessage(t('notifications.checkError', { error: (error as Error).message }));
          } finally {
            setRunning(false);
          }
        }}
      />
      <ListItem
        title={t('notifications.sendTest')}
        subtitle={t('notifications.sendTestHint', { count: 5 })}
        onPress={async () => {
          const permission = await ensurePermission();
          if (permission !== 'granted') {
            onMessage(t('notifications.testOff'));
            return;
          }
          await scheduleAt(
            `easel-test:${Date.now()}`,
            new Date(Date.now() + 5_000),
            { title: t('notifications.testTitle'), body: t('notifications.testBody') },
            { kind: 'test', accountId: active?.id ?? null, path: '/notification-settings' },
          );
          onMessage(t('notifications.sending', { count: 5 }));
        }}
      />
      <ReminderControl item={{ ...sample, title: t('notifications.sample') }} />
      <ListItem
        title={t('notifications.replay')}
        subtitle={t('notifications.replayHint')}
        onPress={() => {
          replayLastWeek(accounts.map((a) => a.id));
          onMessage(t('notifications.replayDone'));
        }}
      />
    </ListGroup>
  );
}
