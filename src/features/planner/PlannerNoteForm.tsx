import { useTranslation } from '@/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Keyboard, View } from 'react-native';

import type { PlannerNoteInput } from '@/canvas/api/planner';
import type { Course } from '@/canvas/models';
import { useCanvas } from '@/canvas/session';
import {
  AccentScope,
  Button,
  Callout,
  haptics,
  ListGroup,
  ListItem,
  type Option,
  OptionGroup,
  Sheet,
  TextField,
} from '@/design';

import { queueCreateNote, queueUpdateNote } from '@/features/offline/plannerWrites';
import { useOnline } from '@/features/offline/useOnline';

import { DateTimeRow } from './DateTimeRow';

const NO_COURSE = 'none';

type Props = {
  initial: PlannerNoteInput;
  courses: Course[];
  submitLabel: string;
  saving: boolean;
  error: string | null;
  onSubmit: (input: PlannerNoteInput) => void;
  /** Notes made from a course item keep that course. */
  courseLocked?: boolean;
  autoFocus?: boolean;
  /** Extra actions below the form, such as Delete. */
  footer?: ReactNode;
  /** Rows after the details that apply right away, such as reminders. */
  extras?: ReactNode;
};

/** Title, course, date and time, and details for a personal to-do (planner note). */
export function PlannerNoteForm({
  initial,
  courses,
  submitLabel,
  saving,
  error,
  onSubmit,
  courseLocked = false,
  autoFocus = false,
  footer,
  extras,
}: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial.title);
  const [details, setDetails] = useState(initial.details);
  const [date, setDate] = useState(initial.todoDate);
  const [courseId, setCourseId] = useState(initial.courseId);
  const [picking, setPicking] = useState(false);
  const [triedEmpty, setTriedEmpty] = useState(false);
  const online = useOnline();
  const queryClient = useQueryClient();
  const { account } = useCanvas();

  const course = courses.find((c) => c.id === courseId);
  const trimmed = title.trim();

  const options: Option<string>[] = [
    {
      value: NO_COURSE,
      label: t('planner.noCourse'),
      subtitle: t('planner.onPersonal'),
      leading: <View className="h-3 w-3 rounded-full bg-fg-muted" />,
    },
    ...courses.map((c) => ({
      value: c.id,
      label: c.code,
      subtitle: c.name,
      leading: (
        <AccentScope color={c.color}>
          <View className="h-3 w-3 rounded-full bg-accent" />
        </AccentScope>
      ),
    })),
  ];

  const submit = () => {
    if (!trimmed) {
      setTriedEmpty(true);
      return;
    }
    const input = { title: trimmed, details: details.trim(), todoDate: date, courseId };
    // OFF-2: offline, the form queues the save itself and closes; it syncs once Easel is back online.
    if (!online) {
      const noteId = 'id' in initial && typeof initial.id === 'string' ? initial.id : null;
      if (noteId) queueUpdateNote(queryClient, account.id, noteId, input);
      else queueCreateNote(queryClient, account.id, input);
      haptics.success();
      router.back();
      return;
    }
    onSubmit(input);
  };

  return (
    <AccentScope color={course?.color} className="gap-6">
      <TextField
        label={t('planner.title')}
        value={title}
        onChangeText={setTitle}
        placeholder={t('planner.placeholder')}
        autoFocus={autoFocus}
        returnKeyType="done"
        maxLength={255}
        error={triedEmpty && !trimmed ? t('planner.titleRequired') : null}
      />

      <ListGroup>
        <ListItem
          title={t('planner.course')}
          value={course?.code ?? t('planner.noCourse')}
          disabled={courseLocked}
          chevron={!courseLocked}
          accessibilityLabel={t('planner.courseLabel', {
            course: course ? `${course.code}, ${course.name}` : t('planner.noCourse'),
          })}
          accessibilityHint={courseLocked ? undefined : t('planner.coursesHint')}
          onPress={
            courseLocked
              ? undefined
              : () => {
                  Keyboard.dismiss();
                  setPicking(true);
                }
          }
        />
        <DateTimeRow label={t('planner.date')} mode="date" value={date} onChange={setDate} />
        <DateTimeRow label={t('planner.time')} mode="time" value={date} onChange={setDate} />
      </ListGroup>

      <TextField
        label={t('planner.details')}
        value={details}
        onChangeText={setDetails}
        placeholder={t('planner.detailsHint')}
        multiline
      />

      {extras}

      {/* OFF-2: the screens queue the save offline; say so before the student taps it. */}
      {!online ? (
        <Callout tone="info" title={t('planner.offline')}>
          {t('planner.offlineHelp')}
        </Callout>
      ) : null}

      {error ? (
        <Callout tone="danger" title={t('planner.saveError')}>
          {error}
        </Callout>
      ) : null}

      <View className="gap-3">
        <Button size="lg" loading={saving} onPress={submit}>
          {submitLabel}
        </Button>
        {footer}
      </View>

      <Sheet visible={picking} title={t('planner.course')} onClose={() => setPicking(false)}>
        <OptionGroup
          options={options}
          selected={courseId ?? NO_COURSE}
          onSelect={(value) => {
            setCourseId(value === NO_COURSE ? null : value);
            setPicking(false);
          }}
        />
      </Sheet>
    </AccentScope>
  );
}
