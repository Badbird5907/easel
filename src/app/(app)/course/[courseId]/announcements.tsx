import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { courseContext } from '@/canvas/api/discussions';
import { AnnouncementListScreen } from '@/features/discussions/ContextLists';

/** Every announcement in one course, newest first (ANN-2). */
export default function CourseAnnouncementsScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const context = useMemo(() => courseContext(courseId), [courseId]);
  return <AnnouncementListScreen context={context} />;
}
