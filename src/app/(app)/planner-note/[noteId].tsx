import { useTranslation } from '@/i18n';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, View } from 'react-native';

import { useDashboardCourses } from '@/canvas/api/courses';
import {
  useQueuedDeletePlannerNote as useDeletePlannerNote,
  useQueuedPlannerNote as usePlannerNote,
  useQueuedUpdatePlannerNote as useUpdatePlannerNote,
} from '@/features/offline/plannerWrites';
import { Callout, haptics, ListGroup, ListItem, Screen, Skeleton } from '@/design';
import { PlannerNoteForm } from '@/features/planner/PlannerNoteForm';
import { ReminderControl } from '@/features/reminders/ReminderControl';

/** Edit or delete a personal to-do (TODO-3), and set reminders for it (TODO-7). */
export default function EditPlannerNoteScreen() {
  const { t } = useTranslation();
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const note = usePlannerNote(noteId);
  const courses = useDashboardCourses();
  const update = useUpdatePlannerNote(noteId);
  const remove = useDeletePlannerNote(noteId);

  const confirmDelete = () => {
    if (!note.data) return;
    Alert.alert(t('planner.deleteQuestion', { title: note.data.title }), t('planner.deleteHelp'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('planner.delete'),
        style: 'destructive',
        onPress: () =>
          remove.mutate(undefined, {
            onSuccess: () => {
              haptics.success();
              router.back();
            },
            onError: (error) => Alert.alert(t('planner.deleteError'), error.message),
          }),
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: t('planner.edit') }} />
      <Screen automaticallyAdjustKeyboardInsets contentClassName="gap-6">
        {note.isPending ? (
          <View className="gap-6">
            <View className="gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-12 rounded-xl" />
            </View>
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-28 rounded-xl" />
          </View>
        ) : note.isError ? (
          <Callout
            tone="danger"
            title={t('planner.noteLoadError')}
            action={{ label: t('common.retry'), onPress: () => note.refetch() }}
          >
            {note.error.message}
          </Callout>
        ) : (
          <PlannerNoteForm
            key={note.data.id}
            initial={note.data}
            courses={courses.data ?? []}
            courseLocked={!!note.data.linkedUrl}
            submitLabel={t('planner.save')}
            saving={update.isPending}
            error={update.error?.message ?? null}
            extras={
              <ListGroup footer={t('planner.reminderHelp')}>
                <ReminderControl
                  item={{
                    id: `planner_note_${note.data.id}`,
                    title: note.data.title,
                    dueAt: note.data.todoDate,
                    courseId: note.data.courseId,
                    url: `/planner-note/${note.data.id}`,
                  }}
                />
              </ListGroup>
            }
            onSubmit={(input) =>
              update.mutate(input, {
                onSuccess: () => {
                  haptics.success();
                  router.back();
                },
              })
            }
            footer={
              <ListGroup>
                <ListItem
                  title={remove.isPending ? t('planner.deleting') : t('planner.deleteNote')}
                  destructive
                  chevron={false}
                  disabled={remove.isPending}
                  onPress={confirmDelete}
                />
              </ListGroup>
            }
          />
        )}
      </Screen>
    </>
  );
}
