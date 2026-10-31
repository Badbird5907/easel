import { useTranslation } from '@/i18n';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { type ComponentRef, useRef, useState } from 'react';
import type { ScrollView } from 'react-native';

import { type PersonalEventInput, useCreatePersonalEvent } from '@/canvas/api/calendar';
import { haptics, Screen } from '@/design';
import { EventForm } from '@/features/calendar/EventForm';
import { dateParts, fromDayKey, withTime } from '@/lib/dates';
import { defaultUntil, type Recurrence } from '@/features/calendar/recurrence';

/**
 * The start for a new event on the given Canvas day (`YYYY-MM-DD`), or today:
 * `minutes` past midnight when given (a long press on the hour grid), else the
 * next whole hour.
 */
function defaultStart(day?: string, minutes?: string): Date {
  const now = new Date();
  const match = day?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match ? fromDayKey(day!) : new Date(now);
  const at = minutes !== undefined ? Number(minutes) : NaN;
  return Number.isFinite(at) && at >= 0 && at < 24 * 60
    ? withTime(date, Math.floor(at / 60), at % 60)
    : withTime(date, Math.min(dateParts(now).hour + 1, 23));
}

/** New event on the student's own calendar (CAL-5). `date` and `minutes` prefill when it starts. */
export default function NewEventScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ date?: string; minutes?: string }>();
  const create = useCreatePersonalEvent();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [initial] = useState<PersonalEventInput>(() => {
    const start = defaultStart(params.date, params.minutes);
    return {
      title: '',
      start,
      end: new Date(start.getTime() + 60 * 60_000),
      allDay: false,
      location: '',
      details: '',
    };
  });
  const [recurrence] = useState<Recurrence>(() => ({
    kind: 'none',
    until: defaultUntil('weekly', initial.start),
  }));

  return (
    <>
      <Stack.Screen options={{ title: t('event.new') }} />
      <Screen ref={scroll} automaticallyAdjustKeyboardInsets contentClassName="gap-6">
        <EventForm
          initial={initial}
          initialRecurrence={recurrence}
          submitLabel={t('calendar.addEvent')}
          saving={create.isPending}
          error={create.error?.message ?? null}
          autoFocus
          scrollViewRef={scroll}
          onSubmit={({ input }) =>
            create.mutate(input, {
              onSuccess: (event) => {
                haptics.success();
                router.replace({ pathname: '/event/[eventId]', params: { eventId: event.id } });
              },
            })
          }
        />
      </Screen>
    </>
  );
}
