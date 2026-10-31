import { useTranslation } from '@/i18n';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { useDashboardCourses } from '@/canvas/api/courses';
import type { PlannerNoteInput } from '@/canvas/api/planner';
import { useQueuedCreatePlannerNote as useCreatePlannerNote } from '@/features/offline/plannerWrites';
import { haptics, Screen } from '@/design';
import { fromDayKey, withTime } from '@/lib/dates';
import { PlannerNoteForm } from '@/features/planner/PlannerNoteForm';

/** End of the given Canvas day (`YYYY-MM-DD`), or of today: Canvas's default for new to-dos. */
function defaultDate(day?: string): Date {
  const match = day?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match ? fromDayKey(day!) : new Date();
  return withTime(date, 23, 59);
}

/** New personal to-do (TODO-3). `date` and `courseId` params prefill the form. */
export default function NewPlannerNoteScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ date?: string; courseId?: string }>();
  const courses = useDashboardCourses();
  const create = useCreatePlannerNote();
  const [initial] = useState<PlannerNoteInput>(() => ({
    title: '',
    details: '',
    todoDate: defaultDate(params.date),
    courseId: params.courseId ?? null,
  }));

  return (
    <>
      <Stack.Screen options={{ title: t('planner.new') }} />
      <Screen automaticallyAdjustKeyboardInsets contentClassName="gap-6">
        <PlannerNoteForm
          initial={initial}
          courses={courses.data ?? []}
          submitLabel={t('planner.add')}
          saving={create.isPending}
          error={create.error?.message ?? null}
          autoFocus
          onSubmit={(input) =>
            create.mutate(input, {
              onSuccess: () => {
                haptics.success();
                router.back();
              },
            })
          }
        />
      </Screen>
    </>
  );
}
