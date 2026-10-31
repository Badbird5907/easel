import { useTranslation } from '@/i18n';
import {
  type ComponentRef,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useRef,
  useState,
} from 'react';
import { Keyboard, type ScrollView, TextInput, View } from 'react-native';

import type { PersonalEventInput } from '@/canvas/api/calendar';
import {
  Button,
  Callout,
  ListGroup,
  ListItem,
  type Option,
  OptionGroup,
  Sheet,
  Switch,
  TextField,
} from '@/design';
import { isBlankHtml, RichEditor } from '@/features/editor/RichEditor';
import { dayKey, fromDayKey, mergeDateTime, useDisplayTimeZone } from '@/lib/dates';
import { DateTimeRow } from '@/features/planner/DateTimeRow';

import {
  defaultUntil,
  describeRepeat,
  occurrenceCount,
  type Recurrence,
  recurrenceProblem,
  type RepeatKind,
  repeatKinds,
  repeatValue,
  ruleFor,
} from './recurrence';

export type EventFormValues = {
  input: PersonalEventInput;
  /** The recurrence as chosen, to tell what changed. */
  recurrence: Recurrence;
};

type Props = {
  initial: Omit<PersonalEventInput, 'rrule'>;
  initialRecurrence: Recurrence;
  submitLabel: string;
  saving: boolean;
  error: string | null;
  onSubmit: (values: EventFormValues) => void;
  autoFocus?: boolean;
  /** Extra actions below the form, such as Delete. */
  footer?: ReactNode;
  /** The screen's scroll view, so the details editor can stay above the keyboard. */
  scrollViewRef?: RefObject<ComponentRef<typeof ScrollView> | null>;
};

const HOUR = 60 * 60_000;
const CUSTOM = 'custom';

/**
 * Title, day, times, repeat, location, and rich-text details for an event on
 * the student's own calendar (CAL-5).
 */
export function EventForm({
  initial,
  initialRecurrence,
  submitLabel,
  saving,
  error,
  onSubmit,
  autoFocus = false,
  footer,
  scrollViewRef,
}: Props) {
  const { t } = useTranslation();
  useDisplayTimeZone();
  const [title, setTitle] = useState(initial.title);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [timedStart, setStart] = useState(initial.start);
  const [civilDate, setCivilDate] = useState(() => initial.allDayDate ?? dayKey(initial.start));
  const start = allDay ? fromDayKey(civilDate) : timedStart;
  const [end, setEnd] = useState(initial.end);
  const [location, setLocation] = useState(initial.location);
  const [details, setDetails] = useState(initial.details ?? '');
  const [detailsChanged, setDetailsChanged] = useState(false);
  // UNTIL is a chosen civil day, even though the RRULE serializes it as UTC.
  const [repeatState, setRepeatState] = useState(() => ({
    value: initialRecurrence,
    untilDay: initialRecurrence.kind === 'custom' ? null : dayKey(initialRecurrence.until),
  }));
  const recurrence: Recurrence =
    repeatState.value.kind === 'custom'
      ? repeatState.value
      : { ...repeatState.value, until: fromDayKey(repeatState.untilDay!) };
  const setRecurrence = (action: SetStateAction<Recurrence>) => {
    setRepeatState((previous) => {
      const current =
        previous.value.kind === 'custom'
          ? previous.value
          : { ...previous.value, until: fromDayKey(previous.untilDay!) };
      const value = typeof action === 'function' ? action(current) : action;
      return { value, untilDay: value.kind === 'custom' ? null : dayKey(value.until) };
    });
  };
  const [picking, setPicking] = useState(false);
  const [triedEmpty, setTriedEmpty] = useState(false);
  const titleInput = useRef<ComponentRef<typeof TextInput>>(null);
  const repeatTrigger = useRef<ComponentRef<typeof View>>(null);

  const trimmed = title.trim();
  const backwards = !allDay && end.getTime() < start.getTime();
  const repeatProblem = recurrenceProblem(recurrence, start, t);
  const count = occurrenceCount(recurrence, start);

  /** Moving the day or start time carries the end along, keeping the length. */
  const changeStart = (next: Date) => {
    const length = Math.max(end.getTime() - start.getTime(), 0);
    setStart(next);
    setCivilDate(dayKey(next));
    setEnd(new Date(next.getTime() + length));
    // A series that would now end before it starts moves its end out too.
    if (recurrence.kind !== 'none' && recurrence.kind !== CUSTOM && dayKey(recurrence.until) < dayKey(next)) {
      setRecurrence({ kind: recurrence.kind, until: defaultUntil(recurrence.kind, next) });
    }
  };

  const changeEnd = (next: Date) => {
    // Ends land on the start's day; events here don't span days.
    setEnd(mergeDateTime(start, next, 'time'));
  };

  const chooseRepeat = (value: string) => {
    setPicking(false);
    if (value === CUSTOM) return;
    const kind = value as RepeatKind;
    setRecurrence((current) => ({
      kind,
      until:
        current.kind !== CUSTOM && current.kind !== 'none' && dayKey(current.until) >= dayKey(start)
          ? current.until
          : defaultUntil(kind, start),
    }));
  };

  const submit = () => {
    if (saving) return;
    if (!trimmed) {
      setTriedEmpty(true);
      titleInput.current?.focus();
      return;
    }
    if (backwards || repeatProblem) return;
    onSubmit({
      input: {
        title: trimmed,
        start,
        end: allDay ? start : end,
        allDay,
        allDayDate: allDay ? civilDate : null,
        location: location.trim(),
        // Untouched details stay as they are in Canvas.
        details: detailsChanged ? (isBlankHtml(details) ? '' : details) : undefined,
        rrule: ruleFor(recurrence, start),
      },
      recurrence,
    });
  };

  const options: Option<string>[] = [
    ...repeatKinds.map((kind) => ({ value: kind, label: describeRepeat(kind, start, t) })),
    ...(recurrence.kind === CUSTOM
      ? [{ value: CUSTOM, label: recurrence.text ?? t('event.custom'), subtitle: t('event.onWebsite') }]
      : []),
  ];

  return (
    <View className="gap-6">
      <TextField
        ref={titleInput}
        label={t('planner.title')}
        value={title}
        onChangeText={setTitle}
        placeholder={t('event.placeholder')}
        autoFocus={autoFocus}
        returnKeyType="done"
        maxLength={255}
        error={triedEmpty && !trimmed ? t('event.titleRequired') : null}
      />

      <View className="gap-2">
        <ListGroup>
          <ListItem
            title={t('calendar.allDay')}
            chevron={false}
            trailing={
              <Switch
                value={allDay}
                onValueChange={(next) => {
                  if (next) setCivilDate(dayKey(start));
                  else setStart(start);
                  setAllDay(next);
                  if (!next && end.getTime() <= start.getTime()) setEnd(new Date(start.getTime() + HOUR));
                }}
                accessibilityLabel={t('calendar.allDay')}
              />
            }
          />
          <DateTimeRow label={t('planner.date')} mode="date" value={start} onChange={changeStart} />
          {allDay ? null : (
            <DateTimeRow label={t('event.starts')} mode="time" value={start} onChange={changeStart} />
          )}
          {allDay ? null : (
            <DateTimeRow label={t('event.ends')} mode="time" value={end} onChange={changeEnd} />
          )}
        </ListGroup>
        {backwards ? (
          <Callout tone="warning" title={t('event.backwards')}>
            {t('event.backwardsHelp')}
          </Callout>
        ) : null}
      </View>

      <View className="gap-2">
        <ListGroup footer={count && !repeatProblem ? t('event.addsCount', { count }) : undefined}>
          <ListItem
            ref={repeatTrigger}
            title={t('event.repeat')}
            value={repeatValue(recurrence, t)}
            accessibilityLabel={t('event.repeatLabel', {
              repeat:
                recurrence.kind === 'none' || recurrence.kind === CUSTOM
                  ? repeatValue(recurrence, t)
                  : describeRepeat(recurrence.kind, start, t),
            })}
            accessibilityHint={t('event.repeatHint')}
            onPress={() => {
              Keyboard.dismiss();
              setPicking(true);
            }}
          />
          {recurrence.kind !== 'none' && recurrence.kind !== CUSTOM ? (
            <DateTimeRow
              label={t('event.until')}
              mode="date"
              value={recurrence.until}
              minimumDate={start}
              onChange={(until) => setRecurrence({ kind: recurrence.kind as RepeatKind, until })}
            />
          ) : null}
        </ListGroup>
        {repeatProblem ? (
          <Callout tone="warning" title={t('event.repeatError')}>
            {repeatProblem}
          </Callout>
        ) : null}
      </View>

      <TextField
        label={t('event.location')}
        value={location}
        onChangeText={setLocation}
        placeholder={t('event.locationHint')}
        returnKeyType="done"
      />

      <RichEditor
        label={t('planner.details')}
        value={details}
        onChange={(html) => {
          setDetails(html);
          setDetailsChanged(true);
        }}
        placeholder={t('event.detailsHint')}
        minHeight={110}
        scrollViewRef={scrollViewRef}
      />

      {error ? (
        <Callout tone="danger" title={t('event.saveError')}>
          {error}
        </Callout>
      ) : null}

      <View className="gap-3">
        <Button size="lg" loading={saving} disabled={backwards || !!repeatProblem} onPress={submit}>
          {submitLabel}
        </Button>
        {footer}
      </View>

      <Sheet
        visible={picking}
        title={t('event.repeat')}
        onClose={() => setPicking(false)}
        returnFocusRef={repeatTrigger}
      >
        <OptionGroup
          options={options}
          selected={recurrence.kind}
          onSelect={chooseRepeat}
          footer={t('event.repeatLimit', { count: 400 })}
        />
      </Sheet>
    </View>
  );
}
