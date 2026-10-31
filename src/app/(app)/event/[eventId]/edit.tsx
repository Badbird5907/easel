import { useTranslation } from '@/i18n';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { type ComponentRef, useRef } from 'react';
import { Alert, type ScrollView, View } from 'react-native';

import {
  type PersonalEventInput,
  type SeriesScope,
  useCalendarEvent,
  useUpdatePersonalEvent,
} from '@/canvas/api/calendar';
import { Callout, haptics, Screen, Skeleton } from '@/design';
import { EventForm, type EventFormValues } from '@/features/calendar/EventForm';
import { dayKey } from '@/features/calendar/month';
import { parseRule, type Recurrence } from '@/features/calendar/recurrence';
import { useActionSheet } from '@/features/files/ActionSheet';

function sameRecurrence(a: Recurrence, b: Recurrence) {
  if (a.kind === 'custom' || b.kind === 'custom') return a.kind === b.kind;
  return a.kind === b.kind && (a.kind === 'none' || dayKey(a.until) === dayKey(b.until));
}

/** Edit an event on the student's own calendar (CAL-5), one event or its whole series. */
export default function EditEventScreen() {
  const { t } = useTranslation();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const event = useCalendarEvent(eventId);
  const update = useUpdatePersonalEvent(eventId);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const { show, sheet } = useActionSheet();

  const data = event.data;
  // The form keeps what the student picks; this is what Canvas has now.
  const recurrence = data ? parseRule(data.rrule, data.start ?? new Date(), data.seriesText) : null;

  const save = (input: PersonalEventInput, scope?: SeriesScope) =>
    update.mutate(
      { input, scope },
      {
        onSuccess: () => {
          haptics.success();
          router.back();
        },
      },
    );

  const submit = ({ input, recurrence: chosen }: EventFormValues) => {
    if (!data || !recurrence) return;
    const scheduleChanged = !sameRecurrence(chosen, recurrence);
    // Untouched, the series keeps the rule Canvas has, word for word.
    const next: PersonalEventInput = { ...input, rrule: scheduleChanged ? input.rrule : undefined };
    if (!data.recurring) {
      save(next);
      return;
    }

    if (scheduleChanged && chosen.kind === 'none') {
      Alert.alert(t('event.stopQuestion'), t('event.stopHelp'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('event.stop'),
          style: 'destructive',
          onPress: () => save({ ...next, rrule: null }, 'all'),
        },
      ]);
      return;
    }

    // Canvas can't give one event its own schedule, or move a whole series from its middle.
    const dateChanged = !!data.start && dayKey(input.start) !== dayKey(data.start);
    const options: { label: string; scope: SeriesScope }[] = [
      ...(!scheduleChanged ? [{ label: t('event.one'), scope: 'one' as const }] : []),
      ...(!dateChanged || data.seriesHead ? [{ label: t('event.all'), scope: 'all' as const }] : []),
      ...(!data.seriesHead ? [{ label: t('event.following'), scope: 'following' as const }] : []),
    ];
    show({
      title: t('event.saveSeries'),
      message: scheduleChanged ? t('event.scheduleHelp') : t('event.scopeHelp'),
      options: options.map((o) => ({ label: o.label, onPress: () => save(next, o.scope) })),
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: t('event.edit') }} />
      <Screen ref={scroll} automaticallyAdjustKeyboardInsets contentClassName="gap-6">
        {event.isPending ? (
          <View className="gap-6">
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-28 rounded-xl" />
          </View>
        ) : event.isError ? (
          <Callout
            tone="danger"
            title={t('event.loadError')}
            action={{ label: t('common.retry'), onPress: () => event.refetch() }}
          >
            {event.error.message}
          </Callout>
        ) : !event.data.editable ? (
          <Callout tone="info" title={t('event.courseOwned')}>
            {t('event.instructorOnly')}
          </Callout>
        ) : recurrence ? (
          <EventForm
            key={event.data.id}
            initial={{
              title: event.data.title,
              start: event.data.start ?? new Date(),
              end: event.data.end ?? event.data.start ?? new Date(),
              allDay: event.data.allDay,
              allDayDate: event.data.allDayDate,
              location: event.data.location ?? '',
              details: event.data.html,
            }}
            initialRecurrence={recurrence}
            submitLabel={t('planner.save')}
            saving={update.isPending}
            error={update.error?.message ?? null}
            scrollViewRef={scroll}
            onSubmit={submit}
          />
        ) : null}
      </Screen>
      {sheet}
    </>
  );
}
