import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { groupContext } from '@/canvas/api/discussions';
import { TopicView } from '@/features/discussions/TopicView';

/** A group announcement or discussion with its replies (COURSE-7, CONTENT-4). */
export default function GroupTopicScreen() {
  const { groupId, topicId } = useLocalSearchParams<{ groupId: string; topicId: string }>();
  const context = useMemo(() => groupContext(groupId), [groupId]);
  return <TopicView context={context} topicId={topicId} />;
}
