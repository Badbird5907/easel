import {
  Bell,
  ClipboardCheck,
  type LucideIcon,
  Mail,
  Megaphone,
  MessageSquare,
  Sparkles,
  Video,
} from 'lucide-react-native';
import { View } from 'react-native';

import type { ActivityItem, ActivityKind } from '@/canvas/api/activity';
import type { Course } from '@/canvas/models';
import { IconTile, ListItem, Text } from '@/design';
import type { MessageKey } from '@/i18n';
import { activityPresentationText, useActivityPresentation } from './activityPresentation';

export const activityIcon: Record<ActivityKind, LucideIcon> = {
  announcement: Megaphone,
  discussion: MessageSquare,
  conversation: Mail,
  submission: ClipboardCheck,
  message: Bell,
  conference: Video,
  other: Sparkles,
};

const kindLabel: Record<ActivityKind, MessageKey> = {
  announcement: 'activityPresentation.announcement',
  discussion: 'activityPresentation.discussion',
  conversation: 'activityPresentation.message',
  submission: 'activityPresentation.gradeFeedback',
  message: 'activityPresentation.notification',
  conference: 'activityPresentation.conference',
  other: 'activityPresentation.update',
};

type ActivityRowProps = {
  item: ActivityItem;
  course?: Course;
  onPress?: () => void;
};

/** One stream item: what changed, in which course, and when. */
export function ActivityRow({ item, course, onPress }: ActivityRowProps) {
  const { t, dates } = useActivityPresentation();
  const time = dates.formatTime(item.updatedAt);
  const { title, preview } = activityPresentationText(item, t, dates.locale);
  return (
    <ListItem
      leadingAlignment="top"
      subtitleLines={3}
      leading={<IconTile icon={activityIcon[item.kind]} color={course?.color} tone="neutral" />}
      title={title}
      subtitle={[course?.code, preview].filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim() || undefined}
      accessibilityLabel={[
        item.unread ? t('activityPresentation.unread') : null,
        t(kindLabel[item.kind]),
        title,
        course?.code,
        preview,
        time,
      ]
        .filter(Boolean)
        .join(', ')}
      trailing={
        <View className="flex-row items-center gap-1.5 self-start pt-3.5">
          {item.unread ? <View className="h-2 w-2 rounded-full bg-accent" /> : null}
          <Text variant="caption" tone="subtle" tabular>
            {time}
          </Text>
        </View>
      }
      chevron={false}
      onPress={onPress}
    />
  );
}
