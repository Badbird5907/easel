import { router } from 'expo-router';
import { MessageSquare, MessageSquareLock, Pin } from 'lucide-react-native';
import { View } from 'react-native';

import { courseContext, type DiscussionContext, type DiscussionTopic } from '@/canvas/api/discussions';
import type { Announcement, Course } from '@/canvas/models';
import { Avatar, Badge, IconTile, ListItem, Text } from '@/design';
import { useTranslation } from '@/i18n';
import { useDisplayTimeZone } from '@/lib/dates';

import { discussionPresentation } from './presentation';

/** Opens an announcement or discussion in Easel's threaded detail screen, in its course or group. */
export function openTopic(context: DiscussionContext | string, topicId: string) {
  const c = typeof context === 'string' ? courseContext(context) : context;
  router.push(
    (c.type === 'course'
      ? { pathname: '/course/[courseId]/discussion/[topicId]', params: { courseId: c.id, topicId } }
      : { pathname: '/group/[groupId]/discussion/[topicId]', params: { groupId: c.id, topicId } }) as never,
  );
}

function UnreadDot() {
  return <View className="h-2 w-2 rounded-full bg-accent" />;
}

type AnnouncementRowProps = {
  announcement: Announcement;
  /** Shown as the course code. Omit inside a course. */
  course?: Course;
  /** Where it was posted, for group announcements, which carry no course. */
  context?: DiscussionContext;
  now?: Date;
};

/** Author, title, a preview, and how long ago. Matches Home's announcement rows. */
export function AnnouncementRow({ announcement: a, course, context, now = new Date() }: AnnouncementRowProps) {
  const { locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const p = discussionPresentation(locale, zone);
  const age = p.dates.relativeAge(a.postedAt, now);
  return (
    <ListItem
      leadingAlignment="top"
      leading={<Avatar name={p.author(a)} uri={a.author.avatarUrl} />}
      title={a.title}
      subtitleLines={3}
      subtitle={[course?.code, a.preview].filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim() || undefined}
      accessibilityLabel={[
        a.unread ? p.t('discussions.unread') : null,
        a.title,
        course ? course.code : null,
        p.t('discussions.authorAge', { author: p.author(a), age: p.ageLabel(a.postedAt, now) }),
      ]
        .filter(Boolean)
        .join(', ')}
      trailing={
        <View className="flex-row items-center gap-1.5 self-start pt-3.5">
          {a.unread ? <UnreadDot /> : null}
          <Text variant="caption" tone="subtle">
            {age}
          </Text>
        </View>
      }
      chevron={false}
      onPress={
        context ? () => openTopic(context, a.id) : a.courseId ? () => openTopic(a.courseId!, a.id) : undefined
      }
    />
  );
}

type DiscussionRowProps = {
  topic: DiscussionTopic;
  now?: Date;
};

/** A discussion in a course list: pinned, open, or closed, with unread replies. */
export function DiscussionRow({ topic, now = new Date() }: DiscussionRowProps) {
  const { locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const p = discussionPresentation(locale, zone);
  const icon = topic.locked ? MessageSquareLock : topic.pinned ? Pin : MessageSquare;
  const meta = p.meta(topic, now);
  const unreadLabel =
    topic.unreadCount > 0
      ? p.replies(topic.unreadCount, true)
      : null;
  return (
    <ListItem
      leadingAlignment="top"
      leading={<IconTile icon={icon} tone={topic.unread || topic.unreadCount > 0 ? 'accent' : 'neutral'} />}
      title={topic.title}
      subtitle={meta}
      subtitleLines={1}
      accessibilityLabel={[
        topic.unread ? p.t('discussions.unread') : null,
        topic.title,
        topic.pinned ? p.t('discussions.pinned') : null,
        topic.locked ? p.t('discussions.closed') : null,
        meta,
        unreadLabel,
      ]
        .filter(Boolean)
        .join(', ')}
      trailing={
        topic.unreadCount > 0 ? (
          <Badge tone="accent" variant="solid" size="sm">
            {p.number(topic.unreadCount)}
          </Badge>
        ) : topic.unread ? (
          <UnreadDot />
        ) : null
      }
      onPress={() => openTopic(topic.context, topic.id)}
    />
  );
}
