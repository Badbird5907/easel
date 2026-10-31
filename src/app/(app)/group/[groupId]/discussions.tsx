import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { groupContext } from '@/canvas/api/discussions';
import { DiscussionListScreen } from '@/features/discussions/ContextLists';

/** A group's discussions (COURSE-7). */
export default function GroupDiscussionsScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const context = useMemo(() => groupContext(groupId), [groupId]);
  return <DiscussionListScreen context={context} />;
}
