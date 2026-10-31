import { LocalizedText as Text } from '@/i18n/LocalizedText';
import { useTranslation } from '@/i18n';
import {
  CalendarDays,
  ClipboardCheck,
  FileText,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  NotebookText,
  StickyNote,
  Users,
} from 'lucide-react-native';
import { View } from 'react-native';

import type { Course, WorkItem, WorkItemKind } from '@/canvas/models';
import { Badge, IconTile, ListItem } from '@/design';
import { dayLabel, formatTime } from '@/lib/dates';

export const kindIcon: Record<WorkItemKind, LucideIcon> = {
  assignment: FileText,
  quiz: ClipboardCheck,
  discussion: MessageSquare,
  page: NotebookText,
  note: StickyNote,
  event: CalendarDays,
  peer_review: Users,
  announcement: Megaphone,
};

type Props = {
  item: WorkItem;
  /** The item's course, for its color and code. Omit when the list is scoped to one course. */
  course?: Course;
  /** Hide the course code when the list is already scoped to one course. */
  showCourse?: boolean;
  /** Hide the due day when a group header already names it. */
  showDay?: boolean;
  onPress?: () => void;
};

/** What the trailing column says: when it's due, or what happened to it. */
function Status({ item, showDay }: { item: WorkItem; showDay: boolean }) {
  const { t } = useTranslation();
  if (item.markedComplete && item.status === 'open') {
    return (
      <Text variant="footnote" tone="muted">
        {t('common.done')}
      </Text>
    );
  }
  switch (item.status) {
    case 'missing':
      return <Badge tone="danger">{t('work.missing')}</Badge>;
    case 'submitted':
      return (
        <Text variant="footnote" tone="muted">
          {t('work.submitted')}
        </Text>
      );
    case 'graded':
      return (
        <Text variant="footnote" tone="muted">
          {t('work.graded')}
        </Text>
      );
    default:
      return (
        <View className="items-end">
          {showDay ? (
            <Text variant="footnote" weight="medium">
              {dayLabel(item.dueAt)}
            </Text>
          ) : null}
          <Text variant={showDay ? 'caption' : 'footnote'} tone="muted" weight="regular" tabular>
            {formatTime(item.dueAt)}
          </Text>
        </View>
      );
  }
}

export function AssignmentRow({ item, course, showCourse = true, showDay = true, onPress }: Props) {
  const { t } = useTranslation();
  const meta = [
    showCourse ? (course?.code ?? item.contextName) : null,
    item.points != null ? t('work.points', { count: item.points }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListItem
      title={item.title}
      subtitle={meta || undefined}
      subtitleLines={1}
      leading={<IconTile icon={kindIcon[item.kind]} color={course?.color} tone="neutral" />}
      trailing={<Status item={item} showDay={showDay} />}
      chevron={false}
      onPress={onPress}
    />
  );
}
