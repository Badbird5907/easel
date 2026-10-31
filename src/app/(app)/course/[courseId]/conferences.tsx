import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from '@/i18n';

import { Screen } from '@/design';
import { ConferenceList } from '@/features/conferences/ConferenceList';
import { CourseScope } from '@/features/course/CourseScope';
import { useRefreshControl } from '@/features/course/states';
import { TabDisabled, useTabGate } from '@/features/course/TabGate';

/** A course's conferences, with Join and recordings (CONTENT-11). */
export default function CourseConferencesScreen() {
  const { t } = useTranslation();
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const gate = useTabGate(courseId, 'conferences');
  const context = useMemo(() => ({ type: 'course' as const, id: courseId }), [courseId]);
  const refreshControl = useRefreshControl([
    ['conferences', 'course', courseId],
    ['courses', courseId, 'tabs'],
  ]);
  return (
    <CourseScope courseId={courseId} title={t('conferences.title')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        {gate === 'hidden' ? (
          <TabDisabled courseId={courseId} label={t('conferences.title')} />
        ) : (
          <ConferenceList context={context} />
        )}
      </Screen>
    </CourseScope>
  );
}
