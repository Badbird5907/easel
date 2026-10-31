import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { courseContext } from '@/canvas/api/discussions';
import { DiscussionListScreen } from '@/features/discussions/ContextLists';

/** A course's discussions (CONTENT-1), with "Start a discussion" when students may (CONTENT-5). */
export default function CourseDiscussionsScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const context = useMemo(() => courseContext(courseId), [courseId]);
  return <DiscussionListScreen context={context} />;
}
