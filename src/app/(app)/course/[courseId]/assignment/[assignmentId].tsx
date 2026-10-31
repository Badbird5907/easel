import { useLocalSearchParams } from 'expo-router';

import { useTranslation } from '@/i18n';

import { Screen } from '@/design';
import { AssignmentDetails } from '@/features/course/AssignmentDetails';
import { CourseScope } from '@/features/course/CourseScope';
import { useRefreshControl } from '@/features/course/states';

/** Assignment details (ASSIGN-2), with the latest submission (ASSIGN-10). */
export default function AssignmentScreen() {
  const { t } = useTranslation();
  const { courseId, assignmentId } = useLocalSearchParams<{
    courseId: string;
    assignmentId: string;
  }>();
  const refreshControl = useRefreshControl([['courses', courseId, 'assignments', assignmentId]]);
  return (
    <CourseScope courseId={courseId} title={t('assignmentPresentation.assignment')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        <AssignmentDetails courseId={courseId} assignmentId={assignmentId} />
      </Screen>
    </CourseScope>
  );
}
