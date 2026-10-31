import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from '@/i18n';

import { Screen } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { CourseSearch } from '@/features/search/CourseSearch';

/** Search one course (COURSE-6). */
export default function CourseSearchScreen() {
  const { t } = useTranslation();
  const { courseId, q } = useLocalSearchParams<{ courseId: string; q?: string }>();
  return (
    <CourseScope courseId={courseId} title={t('course.searchTitle')}>
      <Screen contentClassName="gap-6" keyboardDismissMode="on-drag">
        <CourseSearch courseId={courseId} initialQuery={q ?? ''} />
      </Screen>
    </CourseScope>
  );
}
