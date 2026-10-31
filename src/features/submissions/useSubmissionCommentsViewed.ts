import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import type { SubmissionDetail } from '@/canvas/api/assignments';
import { useMarkSubmissionRead } from '@/canvas/api/conversations';
import { useCanvas } from '@/canvas/session';
import { raiseMark } from '@/features/notifications/seen';
import { useOnline } from '@/features/offline/useOnline';

/** Direct links to submission feedback count as read, just like opening it from Inbox. */
export function useSubmissionCommentsViewed(courseId: string, submission?: SubmissionDetail) {
  const { account } = useCanvas();
  const { mutate: markRead } = useMarkSubmissionRead();
  const online = useOnline();
  const id = submission?.id;
  const latest = submission?.comments.reduce(
    (at, comment) => Math.max(at, comment.createdAt.getTime()),
    0,
  ) ?? 0;

  useFocusEffect(
    useCallback(() => {
      if (!id || !latest) return;
      raiseMark(account.id, 'comments', courseId, latest);
      if (online) markRead(id);
    }, [account.id, courseId, id, latest, online, markRead]),
  );
}
