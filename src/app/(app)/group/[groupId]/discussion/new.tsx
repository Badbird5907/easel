import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { groupContext } from '@/canvas/api/discussions';
import { NewTopicForm } from '@/features/discussions/NewTopicForm';

/** Start a discussion in a group (CONTENT-5, COURSE-7). */
export default function NewGroupTopicScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const context = useMemo(() => groupContext(groupId), [groupId]);
  return <NewTopicForm context={context} />;
}
