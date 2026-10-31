import { LocalizedText as Text } from '@/i18n/LocalizedText';
import { useTranslation } from '@/i18n';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { View } from 'react-native';

import { Card, Icon, IconTile } from '@/design';
import { daysFrom, dueIn } from '@/lib/dates';
import type { Course } from '@/canvas/models';
import type { DueSummary } from '@/lib/due';

import { kindIcon } from './AssignmentRow';

type Props = {
  summary: DueSummary;
  courseFor: (courseId: string | null) => Course | undefined;
  onPress: () => void;
  now?: Date;
};

/**
 * Top of Home: the one deadline that matters most right now, plus what else is
 * waiting. Missing work is counted here and listed below, never hidden.
 */
export function NextDueCard({ summary, courseFor, onPress, now = new Date() }: Props) {
  const { t, direction } = useTranslation();
  const { next, overdue, later } = summary;
  const laterThisWeek = later.filter((a) => daysFrom(a.dueAt, now) < 7).length;
  const course = next ? courseFor(next.courseId) : undefined;
  const meta = next
    ? [
        course?.code ?? next.contextName,
        next.points != null ? t('work.points', { count: next.points }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const missingText = overdue.length > 0 ? t('home.missing', { count: overdue.length }) : null;
  const laterText = laterThisWeek > 0 ? t('home.later', { count: laterThisWeek }) : null;

  return (
    <Card
      style={{ direction }}
      onPress={onPress}
      accessibilityLabel={[
        next ? t('home.itemDue', { title: next.title, when: dueIn(next.dueAt, now) }) : t('home.nothingDue'),
        missingText,
        laterText,
        t('home.openTodo'),
      ]
        .filter(Boolean)
        .join('. ')}
      className="gap-5"
    >
      {next ? (
        <View className="gap-3">
          <Text variant="title2">{t('home.due', { when: dueIn(next.dueAt, now) })}</Text>
          <View className="flex-row items-center gap-3">
            <IconTile icon={kindIcon[next.kind]} color={course?.color} tone="neutral" />
            <View className="flex-1">
              <Text variant="headline" numberOfLines={2}>
                {next.title}
              </Text>
              {meta ? (
                <Text variant="subhead" tone="muted">
                  {meta}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      ) : (
        <Text variant="title2">{t('home.nothingDue')}</Text>
      )}

      <View className="flex-row items-center gap-2">
        <Text variant="subhead" tone="muted" className="flex-1">
          {missingText ? (
            <Text variant="subhead" weight="semibold" tone="danger">
              {missingText}
            </Text>
          ) : null}
          {missingText && laterText ? ' · ' : null}
          {laterText}
          {!missingText && !laterText ? t('home.nothingElseDue') : null}
        </Text>
        <Icon icon={direction === 'rtl' ? ChevronLeft : ChevronRight} size={18} tone="subtle" />
      </View>
    </Card>
  );
}
