import { useTranslation } from '@/i18n';
import { useDisplayTimeZone } from '@/lib/dates';
import { appointmentDisplay } from '@/features/appointments/display';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { CalendarClock, MapPin } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ReservationError, useAppointmentGroup, useReserveSlot } from '@/canvas/api/appointments';
import { useDashboardCourses } from '@/canvas/api/courses';
import {
  AccentScope,
  Button,
  Callout,
  haptics,
  IconTile,
  ListGroup,
  ListItem,
  Screen,
  Skeleton,
  TextField,
} from '@/design';
import { formatMoment } from '@/features/reminders/model';

/** Reserve one time slot (CAL-6), with an optional note for the instructor. */
export default function ReserveSlotScreen() {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const display = useMemo(() => appointmentDisplay(locale, zone), [locale, zone]);
  const { groupId, slotId } = useLocalSearchParams<{ groupId: string; slotId: string }>();
  const group = useAppointmentGroup(groupId);
  const courses = useDashboardCourses();
  const reserve = useReserveSlot();
  const [comments, setComments] = useState('');

  const data = group.data;
  const slot = data?.slots.find((s) => s.id === slotId);
  const course = data?.courseId ? courses.data?.find((c) => c.id === data.courseId) : undefined;
  // Reserving past the group's limit swaps out the student's other time, as the web does.
  const replacing = !!data?.maxPerStudent && data.reserved.length >= data.maxPerStudent ? data.reserved : [];
  const full = !!slot && !slot.reserved && slot.open === 0;

  const submit = () => {
    if (!slot) return;
    reserve.mutate(
      { slot, comments, replaceExisting: replacing.length > 0 },
      {
        onSuccess: () => {
          haptics.success();
          router.back();
        },
        onError: () => haptics.error(),
      },
    );
  };

  return (
    <AccentScope color={course?.color} className="flex-1">
      <Stack.Screen options={{ title: t('appointments.reserveTitle') }} />
      <Screen automaticallyAdjustKeyboardInsets contentClassName="gap-6">
        {group.isPending ? (
          <View className="gap-6">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-28 rounded-xl" />
          </View>
        ) : group.isError ? (
          <Callout
            tone="danger"
            title={t('appointments.slotLoadError')}
            action={{ label: t('appointments.retry'), onPress: () => group.refetch() }}
          >
            {group.error.message}
          </Callout>
        ) : !slot ? (
          <Callout tone="warning" title={t('appointments.unavailable')}>
            {t('appointments.unavailableHint')}
          </Callout>
        ) : (
          <>
            <ListGroup>
              <ListItem
                leading={<IconTile icon={CalendarClock} tone="accent" />}
                title={display.fullDay.format(slot.start)}
                subtitle={display.range(slot)}
              />
              <ListItem
                title={group.data.title}
                subtitle={course ? `${course.code} · ${course.name}` : undefined}
              />
              {group.data.location ? (
                <ListItem
                  leading={<IconTile icon={MapPin} tone="accent" />}
                  title={group.data.location}
                  subtitle={group.data.address ?? undefined}
                />
              ) : null}
            </ListGroup>

            {full ? (
              <Callout tone="warning" title={t('appointments.slotFull')}>
                {t('appointments.slotFullHint')}
              </Callout>
            ) : null}

            {replacing.length > 0 ? (
              <Callout tone="info" title={t('appointments.replaces')}>
                {replacing.length === 1
                  ? t('appointments.replaceOne', { time: formatMoment(replacing[0].start.getTime(), { midSentence: true, display: display.dates }) })
                  : t('appointments.replaceMany', { count: replacing.length })}
              </Callout>
            ) : null}

            <TextField
              label={t('appointments.noteLabel')}
              value={comments}
              onChangeText={setComments}
              placeholder={t('appointments.notePlaceholder')}
              multiline
              maxLength={1000}
            />

            {reserve.error ? (
              <Callout tone="danger" title={t('appointments.reserveError')}>
                {reserve.error instanceof ReservationError && reserve.error.reason
                  ? t(reserve.error.reason === 'started' ? 'appointments.started' : 'appointments.rejected')
                  : reserve.error.message}
              </Callout>
            ) : null}

            <Button size="lg" loading={reserve.isPending} disabled={full} onPress={submit}>
              {replacing.length > 0 ? t('appointments.switch') : t('appointments.reserve')}
            </Button>
          </>
        )}
      </Screen>
    </AccentScope>
  );
}
