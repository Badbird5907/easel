import { router } from 'expo-router';
import { MessageSquareText } from 'lucide-react-native';
import { View } from 'react-native';

import {
  type SubmissionThread,
  useMarkSubmissionRead,
  useSubmissionThreads,
} from '@/canvas/api/conversations';
import type { Course } from '@/canvas/models';
import { useCanvas } from '@/canvas/session';
import { Avatar, Callout, EmptyState, ListGroup, ListItem, Skeleton, Text } from '@/design';
import { raiseMark } from '@/features/notifications/seen';
import { useBrowsingPresentation } from './browsingPresentation';
import { onceWhile, useBrowsingOwner, useBrowsingRefresh } from './browsingLifetime';

function matches(t: SubmissionThread, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [t.assignmentName, t.courseName ?? '', t.latest.author, t.latest.text].some((s) =>
    s.toLowerCase().includes(q),
  );
}

/**
 * The inbox's "Submission comments" view (INBOX-8): the student's submissions
 * with comments, newest first. Each opens the submission with its comments,
 * which marks them read in Canvas and seen for Easel's notifications.
 */
export function SubmissionCommentList({
  courseId,
  courseFor,
  query,
  now,
}: {
  courseId: string | null;
  courseFor: (id: string | null) => Course | undefined;
  query: string;
  now: Date;
}) {
  const { t: translate, dates } = useBrowsingPresentation();
  const { account } = useCanvas();
  const threads = useSubmissionThreads(courseId);
  const markRead = useMarkSubmissionRead();

  const owner = useBrowsingOwner(JSON.stringify([courseId, query]), threads);
  const { refresh } = useBrowsingRefresh(owner, () => threads.refetch());
  const open = (offered: SubmissionThread) => {
    if (!owner.live || owner.value.isError) return;
    const current = owner.value.data?.find((thread) => thread.id === offered.id);
    if (!current || current.courseId !== offered.courseId || current.assignmentId !== offered.assignmentId)
      return;
    if (current.unread) markRead.mutate(current.id);
    raiseMark(account.id, 'comments', current.courseId, current.latest.at.getTime());
    router.push({
      pathname: '/course/[courseId]/assignment/[assignmentId]/submission',
      params: { courseId: current.courseId, assignmentId: current.assignmentId },
    } as never);
  };

  if (threads.isPending)
    return (
      <View className="gap-3">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
      </View>
    );
  if (threads.isError)
    return (
      <Callout
        tone="danger"
        title={translate('inboxBrowse.commentsError')}
        action={{ label: translate('inboxBrowse.retry'), onPress: refresh }}
      >
        {threads.error.message}
      </Callout>
    );

  const visible = threads.data.filter((t) => matches(t, query));
  if (visible.length === 0)
    return query.trim() ? (
      <Text variant="subhead" tone="muted" align="center" className="py-8">
        {translate('inboxBrowse.noCommentMatches', { query: query.trim() })}
      </Text>
    ) : (
      <EmptyState
        icon={MessageSquareText}
        title={translate('inboxBrowse.commentsEmpty')}
        description={translate('inboxBrowse.commentsDescription')}
      />
    );

  return (
    <ListGroup>
      {visible.map((t) => {
        const course = courseFor(t.courseId);
        const age = dates.relativeAge(t.latest.at, now);
        const mine = t.latest.authorId === account.user.id;
        const who = mine ? translate('inboxBrowse.you') : t.latest.author;
        return (
          <ListItem
            key={t.id}
            leading={<Avatar name={t.latest.author} uri={t.latest.avatarUrl} />}
            title={t.assignmentName}
            subtitle={[course?.code ?? t.courseName, `${who}: ${t.latest.text}`].filter(Boolean).join(' · ')}
            subtitleLines={2}
            accessibilityLabel={[
              t.unread ? translate('inboxBrowse.unread') : null,
              t.assignmentName,
              course?.code ?? t.courseName,
              `${who}: ${t.latest.text}`,
              dates.formatDueDate(t.latest.at, now),
            ]
              .filter(Boolean)
              .join(', ')}
            accessibilityHint={translate('inboxBrowse.openSubmission')}
            trailing={
              <View className="flex-row items-center gap-1.5 self-start pt-3.5">
                {t.unread ? <View className="h-2 w-2 rounded-full bg-accent" /> : null}
                <Text variant="caption" tone="subtle">
                  {age}
                </Text>
              </View>
            }
            chevron={false}
            onPress={onceWhile(
              () => owner.live,
              () => open(t),
            )}
          />
        );
      })}
    </ListGroup>
  );
}
