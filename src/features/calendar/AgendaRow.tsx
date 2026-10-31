import { useTranslation, type Translate } from '@/i18n';
import { View } from 'react-native';

import { type CalendarItem, type CalendarSource, groupColor } from '@/canvas/api/calendar';
import { kindIcon } from '@/components/AssignmentRow';
import { deriveAccent, IconTile, ListItem, Text, useTheme } from '@/design';
import { formatTime } from '@/lib/dates';

/** The raw color that represents a calendar: its course color, the group color, or none for personal. */
export function calendarColor(contextCode: string, source: CalendarSource | undefined): string | null {
  if (source?.color) return source.color;
  if (contextCode.startsWith('group_')) return groupColor;
  return null;
}

/** Calendar colors for dots, adjusted for the color scheme. Personal items are neutral. */
export function useDotColor() {
  const { scheme, colors } = useTheme();
  return (raw: string | null) => (raw ? deriveAccent(raw, scheme).accent : colors.fgMuted);
}

const kindName = {
  assignment: 'calendar.kind.assignment',
  quiz: 'calendar.kind.quiz',
  discussion: 'calendar.kind.discussion',
  page: 'calendar.kind.page',
  note: 'calendar.kind.note',
  event: 'calendar.kind.event',
  peer_review: 'calendar.kind.peer_review',
  announcement: 'calendar.kind.announcement',
} as const;

function timeSpan(
  item: CalendarItem,
  t: Translate,
): { primary: string; secondary: string | null; spoken: string } {
  if (item.allDay) return { primary: t('calendar.allDay'), secondary: null, spoken: t('calendar.allDay') };
  const start = formatTime(item.start);
  if (item.kind === 'event' && item.end && item.end.getTime() !== item.start.getTime()) {
    const end = formatTime(item.end);
    return { primary: start, secondary: end, spoken: t('calendar.timeSpan', { start, end }) };
  }
  if (item.kind === 'event' || item.kind === 'note')
    return { primary: start, secondary: null, spoken: start };
  return { primary: start, secondary: t('calendar.due'), spoken: t('calendar.dueTime', { time: start }) };
}

type Props = {
  item: CalendarItem;
  source: CalendarSource | undefined;
  onPress?: () => void;
};

/** One entry in the day's agenda: what it is, whose calendar, and when. */
export function AgendaRow({ item, source, onPress }: Props) {
  const { t } = useTranslation();
  const color = calendarColor(item.contextCode, source);
  const context =
    source?.type === 'user'
      ? t('calendar.personal')
      : source?.type === 'course'
        ? source.shortName
        : (source?.name ?? item.contextName ?? t('calendar.personal'));
  const time = timeSpan(item, t);
  const subtitle = [
    item.appointment ? t('calendar.appointment') : null,
    context,
    item.location,
    item.done ? t('common.done') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListItem
      title={item.title}
      subtitle={subtitle}
      subtitleLines={1}
      leading={<IconTile icon={kindIcon[item.kind]} color={color ?? undefined} tone="neutral" />}
      trailing={
        <View className="items-end">
          <Text variant="footnote" weight="medium" tabular>
            {time.primary}
          </Text>
          {time.secondary ? (
            <Text variant="caption" tone="muted" weight="regular" tabular>
              {time.secondary}
            </Text>
          ) : null}
        </View>
      }
      chevron={false}
      onPress={onPress}
      accessibilityLabel={[item.title, t(kindName[item.kind]), subtitle, time.spoken].join(', ')}
    />
  );
}
