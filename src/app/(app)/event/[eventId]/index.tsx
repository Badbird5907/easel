import { useTranslation, type Translate } from '@/i18n';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  CalendarCheck,
  CalendarClock,
  Clock,
  ExternalLink,
  MapPin,
  MessageSquareText,
  Pencil,
  Repeat,
} from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Linking, Platform, RefreshControl, View } from 'react-native';

import {
  type CalendarEventDetail,
  type SeriesScope,
  useCalendarEvent,
  useCalendars,
  useCancelReservation,
  useDeletePersonalEvent,
} from '@/canvas/api/calendar';
import {
  AccentScope,
  Button,
  Callout,
  Card,
  deriveAccent,
  haptics,
  IconTile,
  ListGroup,
  ListItem,
  Screen,
  Skeleton,
  Text,
  useTheme,
} from '@/design';
import { calendarColor } from '@/features/calendar/AgendaRow';
import { fullDay } from '@/features/calendar/month';
import { describeRecurrence, parseRule } from '@/features/calendar/recurrence';
import { useEventNotificationBrowser } from '@/features/content/eventNotificationBrowser';
import { RichContent } from '@/features/content/RichContent';
import { useActionSheet } from '@/features/files/ActionSheet';
import { ReminderControl } from '@/features/reminders/ReminderControl';
import { dateFormatter, dayKey, formatTime } from '@/lib/dates';

const shortDay = dateFormatter({ weekday: 'short', month: 'short', day: 'numeric' });

/** "Thursday, October 30" and "2:00 PM – 4:00 PM", or both ends when it spans days. */
function when(event: CalendarEventDetail, t: Translate): { title: string; subtitle: string } {
  if (!event.start) return { title: t('event.noDate'), subtitle: '' };
  if (event.allDay) return { title: fullDay.format(event.start), subtitle: t('calendar.allDay') };
  const end = event.end ?? event.start;
  if (dayKey(end) !== dayKey(event.start)) {
    return {
      title: `${shortDay.format(event.start)}, ${formatTime(event.start)}`,
      subtitle: t('event.untilTime', { date: shortDay.format(end), time: formatTime(end) }),
    };
  }
  return {
    title: fullDay.format(event.start),
    subtitle:
      end.getTime() === event.start.getTime()
        ? formatTime(event.start)
        : `${formatTime(event.start)} – ${formatTime(end)}`,
  };
}

function openInMaps(query: string) {
  const q = encodeURIComponent(query);
  Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?q=${q}` : `geo:0,0?q=${q}`).catch(() => {});
}

/**
 * Calendar event details (CAL-3): edit and delete for personal events,
 * including a whole series (CAL-5), cancel for reserved appointments (CAL-6),
 * and reminders for timed events (TODO-7).
 */
export default function EventScreen() {
  const { t } = useTranslation();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { scheme, colors } = useTheme();
  const event = useCalendarEvent(eventId);
  const calendars = useCalendars();
  const remove = useDeletePersonalEvent(eventId);
  const cancel = useCancelReservation(eventId);
  const { show, sheet } = useActionSheet();
  const [refreshing, setRefreshing] = useState(false);

  const data = event.data;
  const browserId = data?.id;
  const browserUrl = data?.htmlUrl;
  const browserEligible = !event.isPending && !event.isError;
  const browser = useEventNotificationBrowser([eventId, data, browserId, browserUrl, browserEligible]);
  const openEventBrowser = () =>
    browser.open(browserUrl!, () =>
      browserEligible && !event.isPending && !event.isError && event.data === data &&
      !!data && data.id === browserId && data.htmlUrl === browserUrl);
  const source = data ? calendars.data?.find((c) => c.code === data.contextCode) : undefined;
  const color = data ? (calendarColor(data.contextCode, source) ?? data.color) : null;
  const contextLabel =
    source?.type === 'user'
      ? t('calendar.personal')
      : source?.type === 'course'
        ? `${source.shortName} · ${source.name}`
        : (source?.name ?? data?.contextName);

  const refresh = async () => {
    setRefreshing(true);
    await event.refetch();
    setRefreshing(false);
  };

  const deleteEvent = (scope?: SeriesScope) =>
    remove.mutate(scope, {
      onSuccess: () => {
        haptics.success();
        router.back();
      },
      onError: (error) => Alert.alert(t('event.deleteError'), error.message),
    });

  const confirmDelete = () => {
    if (!data) return;
    if (data.recurring) {
      show({
        title: t('planner.deleteQuestion', { title: data.title }),
        message: t('event.deleteSeriesHelp'),
        options: [
          { label: t('event.deleteOne'), onPress: () => deleteEvent('one') },
          { label: t('event.deleteAll'), onPress: () => deleteEvent('all') },
          ...(data.seriesHead
            ? []
            : [{ label: t('event.deleteFollowing'), onPress: () => deleteEvent('following') }]),
        ],
      });
      return;
    }
    Alert.alert(t('planner.deleteQuestion', { title: data.title }), t('event.deleteHelp'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('planner.delete'), style: 'destructive', onPress: () => deleteEvent() },
    ]);
  };

  const confirmCancel = () => {
    if (!data) return;
    Alert.alert(t('event.cancelQuestion'), t('event.cancelHelp'), [
      { text: t('event.keep'), style: 'cancel' },
      {
        text: t('event.cancel'),
        style: 'destructive',
        onPress: () =>
          cancel.mutate(undefined, {
            onSuccess: () => {
              haptics.success();
              router.back();
            },
            onError: (error) => Alert.alert(t('event.cancelError'), error.message),
          }),
      },
    ]);
  };

  const time = data ? when(data, t) : null;
  const repeatText = data?.recurring
    ? (data.seriesText ??
      (data.start ? describeRecurrence(parseRule(data.rrule, data.start, null), data.start, t) : null) ??
      t('event.repeats'))
    : null;
  const remindable = !!data?.start && !data.allDay;

  return (
    <AccentScope color={color} className="flex-1">
      <Stack.Screen
        options={{
          title: t('calendar.kind.event'),
          ...(color && { headerTintColor: deriveAccent(color, scheme).accentFg }),
        }}
      />
      <Screen
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        {event.isPending ? (
          <View className="gap-6">
            <View className="gap-3">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
            </View>
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </View>
        ) : event.isError ? (
          <Callout
            tone="danger"
            title={t('event.loadError')}
            action={{ label: t('common.retry'), onPress: () => event.refetch() }}
          >
            {event.error.message}
          </Callout>
        ) : (
          <>
            <View className="gap-2">
              <Text variant="title1" accessibilityRole="header">
                {event.data.title}
              </Text>
              {contextLabel ? (
                <View className="flex-row items-center gap-2">
                  <View
                    className={
                      color ? 'h-2.5 w-2.5 rounded-full bg-accent' : 'h-2.5 w-2.5 rounded-full bg-fg-muted'
                    }
                  />
                  <Text variant="subhead" tone="muted" className="flex-1" numberOfLines={2}>
                    {contextLabel}
                  </Text>
                </View>
              ) : null}
            </View>

            <ListGroup>
              {time ? (
                <ListItem
                  leading={<IconTile icon={Clock} tone="accent" />}
                  title={time.title}
                  subtitle={time.subtitle || undefined}
                />
              ) : null}
              {repeatText ? (
                <ListItem
                  leading={<IconTile icon={Repeat} tone="accent" />}
                  title={t('event.repeats')}
                  subtitle={repeatText}
                />
              ) : null}
              {event.data.location || event.data.address ? (
                <ListItem
                  leading={<IconTile icon={MapPin} tone="accent" />}
                  title={event.data.location ?? event.data.address ?? ''}
                  subtitle={event.data.location ? (event.data.address ?? undefined) : undefined}
                  accessibilityHint={event.data.address ? t('event.mapsHint') : undefined}
                  onPress={
                    event.data.address
                      ? () => openInMaps([event.data.location, event.data.address].filter(Boolean).join(', '))
                      : undefined
                  }
                />
              ) : null}
              {event.data.appointment ? (
                <ListItem
                  leading={<IconTile icon={CalendarCheck} tone="accent" />}
                  title={t('event.reserved')}
                  subtitle={t('event.reservedHelp')}
                />
              ) : null}
              {event.data.reservation?.comments ? (
                <ListItem
                  leading={<IconTile icon={MessageSquareText} tone="accent" />}
                  title={t('event.yourNote')}
                  subtitle={event.data.reservation.comments}
                  subtitleLines={4}
                />
              ) : null}
            </ListGroup>

            {remindable ? (
              <ListGroup footer={t('event.reminderHelp')}>
                <ReminderControl
                  item={{
                    id: `calendar_event_${event.data.id}`,
                    title: event.data.title,
                    dueAt: event.data.start,
                    courseId: event.data.courseId,
                    url: `/event/${event.data.id}`,
                  }}
                />
              </ListGroup>
            ) : null}

            {event.data.html ? (
              <Card>
                <RichContent html={event.data.html} />
              </Card>
            ) : null}

            <View className="gap-3">
              {event.data.editable ? (
                <Button
                  variant="tonal"
                  leadingIcon={Pencil}
                  onPress={() =>
                    router.push({ pathname: '/event/[eventId]/edit', params: { eventId: event.data.id } })
                  }
                >
                  {t('event.edit')}
                </Button>
              ) : null}
              {event.data.reservation ? (
                <Button
                  variant="tonal"
                  leadingIcon={CalendarClock}
                  onPress={() =>
                    router.push({
                      pathname: '/appointments/[groupId]',
                      params: { groupId: event.data.reservation!.groupId },
                    })
                  }
                >
                  {t('event.otherTimes')}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                leadingIcon={ExternalLink}
                onPress={openEventBrowser}
              >
                {t('event.browser')}
              </Button>
            </View>

            {event.data.editable ? (
              <ListGroup>
                <ListItem
                  title={
                    remove.isPending
                      ? t('planner.deleting')
                      : event.data.recurring
                        ? t('event.deleteMore')
                        : t('event.delete')
                  }
                  destructive
                  chevron={false}
                  disabled={remove.isPending}
                  onPress={confirmDelete}
                />
              </ListGroup>
            ) : null}
            {event.data.reservation?.canCancel ? (
              <ListGroup>
                <ListItem
                  title={cancel.isPending ? t('event.canceling') : t('event.cancel')}
                  destructive
                  chevron={false}
                  disabled={cancel.isPending}
                  onPress={confirmCancel}
                />
              </ListGroup>
            ) : null}
          </>
        )}
      </Screen>
      {sheet}
    </AccentScope>
  );
}
