import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { Screen } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { PageList } from '@/features/course/PageContent';
import { useRefreshControl } from '@/features/course/states';
import { TabDisabled, useTabGate } from '@/features/course/TabGate';
import { useTranslation } from '@/i18n';

/** The course's pages, front page first (CONTENT-8). */
export default function PagesScreen() {
  const { t } = useTranslation();
  const { courseId, fromHome } = useLocalSearchParams<{ courseId: string; fromHome?: string }>();
  const gate = useTabGate(courseId, 'pages', fromHome === '1');
  const context = useMemo(() => ({ type: 'course' as const, id: courseId }), [courseId]);
  const refreshControl = useRefreshControl([
    ['courses', courseId, 'pages'],
    ['courses', courseId, 'tabs'],
  ]);
  return (
    <CourseScope courseId={courseId} title={t('pages.title')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-4">
        {gate === 'hidden' ? <TabDisabled courseId={courseId} label={t('pages.title')} /> : <PageList context={context} />}
      </Screen>
    </CourseScope>
  );
}
