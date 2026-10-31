import { useTranslation } from '@/i18n';
import { useDisplayTimeZone } from '@/lib/dates';
import { appointmentDisplay, availability } from '@/features/appointments/display';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { CalendarCheck, CalendarClock, MapPin, Users } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, RefreshControl, View } from 'react-native';

import { type AppointmentSlot, useAppointmentGroup, useCancelSlot } from '@/canvas/api/appointments';
import { useDashboardCourses } from '@/canvas/api/courses';
import {
  AccentScope,
  Badge,
  Callout,
  Card,
  EmptyState,
  haptics,
  IconTile,
  ListGroup,
  ListItem,
  Screen,
  Skeleton,
  Text,
  useTheme,
} from '@/design';
import { RichContent } from '@/features/content/RichContent';

/** One sign-up sheet (CAL-6): its open times, the student's reservation, reserve and cancel. */
export default function AppointmentGroupScreen() {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const display = useMemo(() => appointmentDisplay(locale, zone), [locale, zone]);
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { colors } = useTheme();
  const group = useAppointmentGroup(groupId);
  const courses = useDashboardCourses();
  const cancel = useCancelSlot();
  const [refreshing, setRefreshing] = useState(false);

  const data = group.data;
  const course = data?.courseId ? courses.data?.find((c) => c.id === data.courseId) : undefined;
  const atLimit = !!data?.maxPerStudent && data.reserved.length >= data.maxPerStudent;

  const refresh = async () => {
    setRefreshing(true);
    await group.refetch();
    setRefreshing(false);
  };

  // The confirmation and its deferred callbacks retain this viewing translator.
  const confirmCancel = (slot: AppointmentSlot) => {
    if (!slot.reservationId) return;
    const id = slot.reservationId;
    Alert.alert(
      t('appointments.cancelQuestion'),
      t('appointments.cancelBody', { day: display.fullDay.format(slot.start), time: display.range(slot) }),
      [
        { text: t('appointments.keep'), style: 'cancel' },
        {
          text: t('appointments.cancelReservation'),
          style: 'destructive',
          onPress: () =>
            cancel.mutate(id, {
              onSuccess: () => haptics.success(),
              onError: (error) => Alert.alert(t('appointments.cancelError'), error.message),
            }),
        },
      ],
    );
  };

  const openSlot = (slot: AppointmentSlot) => {
    if (slot.reserved) return confirmCancel(slot);
    router.push({ pathname: '/appointments/reserve', params: { groupId, slotId: slot.id } });
  };

  const days = new Map<string, AppointmentSlot[]>();
  for (const slot of data?.slots ?? []) {
    const key = display.dayKey(slot.start);
    days.set(key, [...(days.get(key) ?? []), slot]);
  }
  const reservedSlots = (data?.slots ?? []).filter((s) => s.reserved);

  return (
    <AccentScope color={course?.color} className="flex-1">
      <Stack.Screen options={{ title: t('appointments.signUp') }} />
      <Screen
        contentClassName="gap-6"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        {group.isPending ? (
          <View className="gap-6">
            <View className="gap-3">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
            </View>
            <Skeleton className="h-40 rounded-2xl" />
          </View>
        ) : group.isError ? (
          <Callout
            tone="danger"
            title={t('appointments.groupLoadError')}
            action={{ label: t('appointments.retry'), onPress: () => group.refetch() }}
          >
            {group.error.message}
          </Callout>
        ) : (
          <>
            <View className="gap-2">
              <Text variant="title1" accessibilityRole="header">
                {group.data.title}
              </Text>
              {course ? (
                <View className="flex-row items-center gap-2">
                  <View className="h-2.5 w-2.5 rounded-full bg-accent" />
                  <Text variant="subhead" tone="muted" className="flex-1" numberOfLines={2}>
                    {`${course.code} · ${course.name}`}
                  </Text>
                </View>
              ) : null}
            </View>

            {group.data.location || group.data.forGroups ? (
              <ListGroup>
                {group.data.location ? (
                  <ListItem
                    leading={<IconTile icon={MapPin} tone="accent" />}
                    title={group.data.location}
                    subtitle={group.data.address ?? undefined}
                  />
                ) : null}
                {group.data.forGroups ? (
                  <ListItem
                    leading={<IconTile icon={Users} tone="accent" />}
                    title={t('appointments.groupSignUp')}
                    subtitle={t('appointments.groupHint')}
                  />
                ) : null}
              </ListGroup>
            ) : null}

            {group.data.description ? (
              <Card>
                <RichContent html={group.data.description} />
              </Card>
            ) : null}

            {reservedSlots.length > 0 ? (
              <ListGroup header={t('appointments.yourTimes', { count: reservedSlots.length })}>
                {reservedSlots.map((slot) => (
                  <ListItem
                    key={slot.id}
                    leading={<IconTile icon={CalendarCheck} tone="success" />}
                    title={display.fullDay.format(slot.start)}
                    subtitle={[display.range(slot), slot.comments ? t('appointments.note', { note: slot.comments }) : null]
                      .filter(Boolean)
                      .join(' · ')}
                    trailing={
                      <Text variant="body" weight="medium" tone="danger">
                        {t('appointments.cancel')}
                      </Text>
                    }
                    chevron={false}
                    accessibilityLabel={t('appointments.reservedLabel', { day: display.fullDay.format(slot.start), time: display.range(slot) })}
                    accessibilityHint={t('appointments.cancelHint')}
                    onPress={() => confirmCancel(slot)}
                  />
                ))}
              </ListGroup>
            ) : group.data.requiringAction ? (
              <Callout tone="accent" icon={CalendarClock} title={t('appointments.choose')}>
                {t('appointments.chooseHint')}
              </Callout>
            ) : null}

            {atLimit && group.data.slots.some((s) => !s.reserved && s.open !== 0) ? (
              <Text variant="footnote" tone="muted" className="px-1">
                {t('appointments.limit', { count: group.data.maxPerStudent! })}
              </Text>
            ) : null}

            {group.data.slots.length === 0 ? (
              <Card variant="outlined" padding="none">
                <EmptyState
                  icon={CalendarCheck}
                  title={t('appointments.noTimes')}
                  description={t('appointments.noTimesHint')}
                />
              </Card>
            ) : (
              [...days.entries()].map(([key, slots]) => (
                <ListGroup key={key} header={display.fullDay.format(slots[0].start)}>
                  {slots.map((slot) => {
                    const full = !slot.reserved && slot.open === 0;
                    return (
                      <ListItem
                        key={slot.id}
                        title={display.range(slot)}
                        trailing={
                          slot.reserved ? (
                            <Badge tone="success">{t('appointments.reserved')}</Badge>
                          ) : (
                            <Text variant="footnote" tone={full ? 'subtle' : 'muted'}>
                              {availability(slot, t)}
                            </Text>
                          )
                        }
                        disabled={full}
                        chevron={!full && !slot.reserved}
                        accessibilityLabel={t('appointments.slotLabel', { day: display.fullDay.format(slot.start), time: display.range(slot), availability: availability(slot, t) })}
                        accessibilityHint={
                          slot.reserved ? t('appointments.cancelHint') : full ? undefined : t('appointments.reserveHint')
                        }
                        accessibilityState={{ disabled: full, selected: slot.reserved }}
                        onPress={full ? undefined : () => openSlot(slot)}
                      />
                    );
                  })}
                </ListGroup>
              ))
            )}
          </>
        )}
      </Screen>
    </AccentScope>
  );
}
