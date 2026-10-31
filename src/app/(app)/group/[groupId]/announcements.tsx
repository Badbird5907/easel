import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { groupContext } from '@/canvas/api/discussions';
import { AnnouncementListScreen } from '@/features/discussions/ContextLists';

/** A group's announcements (COURSE-7). */
export default function GroupAnnouncementsScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const context = useMemo(() => groupContext(groupId), [groupId]);
  return <AnnouncementListScreen context={context} />;
}
