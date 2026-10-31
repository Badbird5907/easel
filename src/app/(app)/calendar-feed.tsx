import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  CalendarArrowDown,
  CalendarPlus,
  CalendarSync,
  Copy,
  Share2,
  ShieldAlert,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Platform, Share, View } from 'react-native';

import { type CalendarItem, useCalendarFeedUrl, useCalendarItems, useCalendars } from '@/canvas/api/calendar';
import { useCanvas } from '@/canvas/session';
import {
  Button,
  Callout,
  haptics,
  IconTile,
  ListGroup,
  ListItem,
  type Option,
  OptionGroup,
  Screen,
  Sheet,
  Skeleton,
  Text,
  useToast,
} from '@/design';
import {
  copyToDeviceCalendar,
  type DeviceCalendar,
  GOOGLE_ADD_BY_URL,
  subscribeToFeed,
  writableCalendars,
} from '@/features/calendar/deviceCalendar';
import { exportRange } from '@/features/calendar/exportDates';
import { formatMoment } from '@/features/reminders/model';
import { useNow } from '@/features/reminders/useNow';
import { useTranslation } from '@/i18n';
import { createDateContext, useDisplayTimeZone } from '@/lib/dates';

const byStart = (a: CalendarItem, b: CalendarItem) => a.start.getTime() - b.start.getTime();

/**
 * The Canvas calendar in the device's calendar app (CAL-7, SET-8): subscribe
 * to the feed so it stays current, copy or share its link, or copy chosen
 * events into a calendar on the device.
 */
export default function CalendarFeedScreen() {
  const { t, locale } = useTranslation();
  const { account } = useCanvas();
  const feed = useCalendarFeedUrl();
  const calendars = useCalendars();
  const zone = useDisplayTimeZone();
  const display = useMemo(() => createDateContext(locale, zone), [locale, zone]);
  const [now] = useNow();
  const range = exportRange(new Date(now), zone);
  const items = useCalendarItems(
    range,
    calendars.data?.map((c) => c.code),
  );
  const toast = useToast();
  const [noSubscriber, setNoSubscriber] = useState(false);
  const [choosing, setChoosing] = useState<'events' | 'calendar' | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [deviceCalendars, setDeviceCalendars] = useState<DeviceCalendar[] | null>(null);
  const [target, setTarget] = useState<DeviceCalendar | null>(null);
  const [copying, setCopying] = useState(false);

  const upcoming = (items.data ?? [])
    .filter((i) => i.start >= range.start && i.start < range.end)
    .sort(byStart);
  // Calendar events and appointments to start with; due dates when the student adds them.
  const selected = picked ?? new Set(upcoming.filter((i) => i.kind === 'event').map((i) => i.id));
  const chosen = upcoming.filter((i) => selected.has(i.id));

  const ics = feed.data;

  const subscribe = async () => {
    if (!ics) return;
    const handled = await subscribeToFeed(ics);
    if (!handled) setNoSubscriber(true);
  };

  const copyLink = async () => {
    if (!ics) return;
    await Clipboard.setStringAsync(ics);
    haptics.success();
    toast.show(t('calendarFeed.copiedLink'));
  };

  const shareLink = () => {
    if (!ics) return;
    Share.share(Platform.OS === 'ios' ? { url: ics } : { message: ics, title: t('calendarFeed.shareTitle') }).catch(
      () => {},
    );
  };

  const chooseCalendar = async () => {
    try {
      const list = await writableCalendars();
      if (list === null) {
        Alert.alert(
          t('calendarFeed.accessOff'),
          t('calendarFeed.accessHint'),
        );
        return;
      }
      setDeviceCalendars(list);
      setChoosing('calendar');
    } catch {
      Alert.alert(t('calendarFeed.openError'), t('calendarFeed.tryLater'));
    }
  };

  const copyEvents = async () => {
    if (!target || chosen.length === 0) return;
    setCopying(true);
    try {
      const { copied, failed } = await copyToDeviceCalendar(account.id, target.id, chosen, t);
      if (failed > 0) {
        haptics.error();
        Alert.alert(
          t(copied > 0 ? 'calendarFeed.partialCopy' : 'calendarFeed.copyError'),
          t('calendarFeed.copyErrorHint', { copied, total: chosen.length, calendar: target.title }),
        );
      } else {
        haptics.success();
        toast.show(t('calendarFeed.copied', { count: copied, calendar: target.title }));
      }
    } catch {
      Alert.alert(t('calendarFeed.copyError'), t('calendarFeed.removedCalendar'));
      setTarget(null);
    } finally {
      setCopying(false);
    }
  };

  const eventOptions: Option<string>[] = choosing === 'events' ? upcoming.map((item) => ({
    value: item.id,
    label: item.kind === 'event' || item.kind === 'note' ? item.title : t('calendarFeed.dueTitle', { title: item.title }),
    subtitle: [
      item.allDay ? t('calendar.allDay') : formatMoment(item.start.getTime(), { display }),
      calendars.data?.find((calendar) => calendar.code === item.contextCode)?.type === 'user'
        ? t('calendar.personal') : item.contextName,
    ]
      .filter(Boolean)
      .join(' · '),
  })) : [];

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <>
      <Stack.Screen options={{ title: t('calendarFeed.title') }} />
      <Screen contentClassName="gap-6">
        <Text variant="subhead" tone="muted" className="px-1">
          {t('calendarFeed.intro')}
        </Text>

        {feed.isPending ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : feed.isError ? (
          <Callout
            tone="danger"
            title={t('calendarFeed.linkError')}
            action={{ label: t('common.retry'), onPress: () => feed.refetch() }}
          >
            {feed.error.message}
          </Callout>
        ) : !ics ? (
          <Callout tone="info" title={t('calendarFeed.noFeed')}>
            {t('calendarFeed.noFeedHint')}
          </Callout>
        ) : (
          <View className="gap-3">
            <ListGroup footer={t('calendarFeed.refreshHint')}>
              <ListItem
                leading={<IconTile icon={CalendarSync} tone="accent" />}
                title={t(Platform.OS === 'ios' ? 'calendarFeed.subscribeIos' : 'calendarFeed.subscribe')}
                subtitle={t('calendarFeed.subscribeHint')}
                accessibilityHint={Platform.OS === 'ios' ? t('calendarFeed.openCalendarHint') : undefined}
                onPress={subscribe}
              />
              <ListItem
                leading={<IconTile icon={Copy} tone="accent" />}
                title={t('calendarFeed.copyLink')}
                chevron={false}
                onPress={copyLink}
              />
              <ListItem
                leading={<IconTile icon={Share2} tone="accent" />}
                title={t('calendarFeed.shareLink')}
                onPress={shareLink}
              />
            </ListGroup>

            {noSubscriber ? (
              <Callout
                tone="info"
                title={t('calendarFeed.noSubscriber')}
                action={{
                  label: t('calendarFeed.openGoogle'),
                  onPress: () => WebBrowser.openBrowserAsync(GOOGLE_ADD_BY_URL).catch(() => {}),
                }}
              >
                {t('calendarFeed.googleHint')}
              </Callout>
            ) : null}

            <Callout tone="warning" icon={ShieldAlert} title={t('calendarFeed.private')}>
              {t('calendarFeed.privateHint')}
            </Callout>
          </View>
        )}

        <View className="gap-3">
          <ListGroup
            header={t('calendarFeed.copySection')}
            footer={t('calendarFeed.copyHint')}
          >
            <ListItem
              leading={<IconTile icon={CalendarArrowDown} tone="accent" />}
              title={t('calendarFeed.events')}
              value={items.isPending ? t('calendarFeed.loading') : t('calendarFeed.selection', { chosen: chosen.length, total: upcoming.length })}
              subtitle={t('calendarFeed.nextWeeks')}
              accessibilityLabel={t('calendarFeed.selectionLabel', { chosen: chosen.length, total: upcoming.length })}
              accessibilityHint={t('calendarFeed.chooseEventsHint')}
              disabled={items.isPending || upcoming.length === 0}
              onPress={() => setChoosing('events')}
            />
            <ListItem
              leading={<IconTile icon={CalendarPlus} tone="accent" />}
              title={t('calendarFeed.calendar')}
              value={target?.title ?? t('calendarFeed.choose')}
              accessibilityLabel={t('calendarFeed.calendarLabel', { calendar: target?.title ?? t('calendarFeed.noneChosen') })}
              accessibilityHint={t('calendarFeed.chooseCalendarHint')}
              onPress={chooseCalendar}
            />
          </ListGroup>
          {items.isError ? (
            <Callout
              tone="danger"
              title={t('calendarFeed.eventsError')}
              action={{ label: t('common.retry'), onPress: () => items.refetch() }}
            >
              {items.error?.message ?? t('calendar.error')}
            </Callout>
          ) : null}
          <Button
            variant="tonal"
            loading={copying}
            disabled={!target || chosen.length === 0}
            onPress={copyEvents}
          >
            {target
              ? t('calendarFeed.copyCount', { count: chosen.length, calendar: target.title })
              : t('calendarFeed.chooseTarget')}
          </Button>
        </View>
      </Screen>

      <Sheet visible={choosing === 'events'} title={t('calendarFeed.eventsToCopy')} onClose={() => setChoosing(null)}>
        <View className="flex-row justify-center gap-3">
          <Button variant="secondary" size="sm" onPress={() => setPicked(new Set(upcoming.map((i) => i.id)))}>
            {t('calendarFeed.selectAll')}
          </Button>
          <Button variant="secondary" size="sm" onPress={() => setPicked(new Set())}>
            {t('calendarFeed.selectNone')}
          </Button>
        </View>
        <OptionGroup options={eventOptions} selected={selected} onSelect={toggle} />
      </Sheet>

      <Sheet visible={choosing === 'calendar'} title={t('calendarFeed.copyTo')} onClose={() => setChoosing(null)}>
        {deviceCalendars && deviceCalendars.length > 0 ? (
          <OptionGroup
            options={deviceCalendars.map((c) => ({
              value: c.id,
              label: c.title,
              subtitle: c.account || undefined,
            }))}
            selected={target?.id ?? null}
            onSelect={(id) => {
              setTarget(deviceCalendars.find((c) => c.id === id) ?? null);
              setChoosing(null);
            }}
          />
        ) : (
          <Callout tone="info" title={t('calendarFeed.noCalendars')}>
            {t('calendarFeed.noCalendarsHint')}
          </Callout>
        )}
      </Sheet>

      {toast.element}
    </>
  );
}
