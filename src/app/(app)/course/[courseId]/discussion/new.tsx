import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { courseContext } from '@/canvas/api/discussions';
import { NewTopicForm } from '@/features/discussions/NewTopicForm';

/** Start a discussion in a course (CONTENT-5). */
export default function NewCourseTopicScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const context = useMemo(() => courseContext(courseId), [courseId]);
  return <NewTopicForm context={context} />;
}
