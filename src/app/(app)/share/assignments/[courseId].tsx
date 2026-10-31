import { useLocalSearchParams } from 'expo-router';

import { AssignmentPicker } from '@/features/share/AssignmentPicker';

/** "Submit to an assignment", step two: an open assignment in the course (ASSIGN-16). */
export default function ShareAssignmentsRoute() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  return <AssignmentPicker courseId={courseId} />;
}
