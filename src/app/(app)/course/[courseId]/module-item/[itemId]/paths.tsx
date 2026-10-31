import { useTranslation } from '@/i18n';
import { useLocalSearchParams } from 'expo-router';

import { Screen } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { MasteryPathChooser } from '@/features/course/ModuleItemParts';
import { useRefreshControl } from '@/features/course/states';

/** The mastery paths a module item's score opened, and choosing one (ASSIGN-15). */
export default function MasteryPathsScreen() {
  const { t } = useTranslation();
  const { courseId, itemId } = useLocalSearchParams<{ courseId: string; itemId: string }>();
  const refreshControl = useRefreshControl([['courses', courseId, 'modules']]);
  return (
    <CourseScope courseId={courseId} title={t('modules.choosePath')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        <MasteryPathChooser courseId={courseId} itemId={itemId} />
      </Screen>
    </CourseScope>
  );
}
