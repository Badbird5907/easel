import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { CourseScope } from '@/features/course/CourseScope';
import { PageEditor } from '@/features/course/PageContent';
import { useTranslation } from '@/i18n';

/** Edit a course page the student may edit (CONTENT-8). */
export default function EditCoursePageScreen() {
  const { t } = useTranslation();
  const { courseId, pageUrl } = useLocalSearchParams<{ courseId: string; pageUrl: string }>();
  const context = useMemo(() => ({ type: 'course' as const, id: courseId }), [courseId]);
  return (
    <CourseScope courseId={courseId} title={t('pages.edit')}>
      <PageEditor context={context} pageUrl={pageUrl} />
    </CourseScope>
  );
}
