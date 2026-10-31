import { useLocalSearchParams } from 'expo-router';
import { CalendarDays } from 'lucide-react-native';

import { type SyllabusItem, useSyllabus } from '@/canvas/api/syllabus';
import { IconTile, ListGroup, ListItem, Screen, Section, Text } from '@/design';
import { RichContent } from '@/features/content/RichContent';
import { assignmentKindIcon } from '@/features/course/AssignmentDetails';
import { CourseScope } from '@/features/course/CourseScope';
import { createSyllabusPresentation } from '@/features/course/pagePresentation';
import { assignmentTarget, pushRoute } from '@/features/course/navigation';
import { DetailSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { TabDisabled, useTabGate } from '@/features/course/TabGate';
import { useTranslation } from '@/i18n';
import { useDisplayTimeZone } from '@/lib/dates';

function SummaryRow({ item }: { item: SyllabusItem }) {
  const { t, locale } = useTranslation();
  const timeZone = useDisplayTimeZone();
  const presentation = createSyllabusPresentation(locale, timeZone);
  if (item.kind === 'event') {
    const when = item.date
      ? (item.allDay ? presentation.day(item.date) : presentation.dateTime(item.date))
      : t('syllabus.noDate');
    return (
      <ListItem
        leading={<IconTile icon={CalendarDays} tone="neutral" />}
        title={item.title}
        subtitle={when}
        subtitleLines={1}
        accessibilityLabel={t('syllabus.eventLabel', { title: item.title, date: when })}
        onPress={() => pushRoute({ pathname: '/event/[eventId]', params: { eventId: item.eventId } })}
      />
    );
  }
  const a = item.assignment;
  const subtitle = [
    a.dueAt ? t('syllabus.due', { date: presentation.dateTime(a.dueAt) }) : t('syllabus.noDueDate'),
    presentation.points(a.points),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <ListItem
      leading={<IconTile icon={assignmentKindIcon[a.kind]} tone="accent" />}
      title={a.name}
      subtitle={subtitle}
      subtitleLines={1}
      accessibilityLabel={`${a.name}, ${subtitle}`}
      onPress={() => pushRoute(assignmentTarget(a))}
    />
  );
}

/** The syllabus, then every dated item in the course (CONTENT-9). */
export default function SyllabusScreen() {
  const { t } = useTranslation();
  const { courseId, fromHome } = useLocalSearchParams<{ courseId: string; fromHome?: string }>();
  const gate = useTabGate(courseId, 'syllabus', fromHome === '1');
  const syllabus = useSyllabus(courseId);
  const refreshControl = useRefreshControl([
    ['courses', courseId, 'syllabus'],
    ['courses', courseId, 'tabs'],
  ]);

  return (
    <CourseScope courseId={courseId} title={t('syllabus.title')}>
      <Screen refreshControl={refreshControl}>
        {gate === 'hidden' ? (
          <TabDisabled courseId={courseId} label={t('syllabus.title')} />
        ) : syllabus.isPending ? (
          <DetailSkeleton />
        ) : syllabus.isError ? (
          <LoadError
            title={t('syllabus.loadError')}
            error={syllabus.error}
            onRetry={() => syllabus.refetch()}
          />
        ) : (
          <>
            {syllabus.data.html.trim() ? (
              <RichContent html={syllabus.data.html} />
            ) : (
              <Text variant="body" tone="muted">
                {t('syllabus.empty')}
              </Text>
            )}
            <Section title={t('syllabus.summary')}>
              {syllabus.data.summary.length ? (
                <ListGroup>
                  {syllabus.data.summary.map((item) => (
                    <SummaryRow key={item.id} item={item} />
                  ))}
                </ListGroup>
              ) : (
                <Text variant="subhead" tone="muted" className="px-1">
                  {t('syllabus.emptySummary')}
                </Text>
              )}
            </Section>
          </>
        )}
      </Screen>
    </CourseScope>
  );
}
