import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { courseContext } from '@/canvas/api/discussions';
import { TopicView } from '@/features/discussions/TopicView';

/** A course announcement or discussion with its replies (ANN-3, ANN-4, CONTENT-2 to CONTENT-4). */
export default function CourseTopicScreen() {
  const { courseId, topicId } = useLocalSearchParams<{ courseId: string; topicId: string }>();
  const context = useMemo(() => courseContext(courseId), [courseId]);
  return <TopicView context={context} topicId={topicId} />;
}
