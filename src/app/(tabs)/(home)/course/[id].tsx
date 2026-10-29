import { Stack, useLocalSearchParams } from 'expo-router';
import { BookX } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { AssignmentRow } from '@/components/AssignmentRow';
import { formatScore } from '@/components/CourseCard';
import {
  AccentScope,
  Callout,
  Card,
  deriveAccent,
  EmptyState,
  ListGroup,
  ProgressRing,
  Screen,
  SegmentedControl,
  Text,
  useTheme,
} from '@/design';
import { assignmentsFor, courseById } from '@/mocks/canvas';

type Filter = 'open' | 'done';

const filters = [
  { value: 'open', label: 'To do' },
  { value: 'done', label: 'Completed' },
] as const;

export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { scheme } = useTheme();
  const [filter, setFilter] = useState<Filter>('open');
  const course = courseById(id);

  if (!course) {
    return (
      <>
        <Stack.Screen options={{ title: 'Course' }} />
        <EmptyState icon={BookX} title="Course not found" description="It may have ended or been removed." />
      </>
    );
  }

  const all = assignmentsFor(course.id);
  const done = (a: (typeof all)[number]) => a.status === 'submitted' || a.status === 'graded';
  const visible = all.filter((a) => (filter === 'done' ? done(a) : !done(a)));

  return (
    <AccentScope color={course.color} className="flex-1">
      <Stack.Screen
        options={{ title: course.name, headerTintColor: deriveAccent(course.color, scheme).accentFg }}
      />
      <Screen>
        <Card padding="lg" className="flex-row items-center gap-4">
          <ProgressRing value={course.score ?? 0} size={72} thickness={6} accessibilityLabel="Current grade">
            <Text variant="headline" tone="accent">
              {course.letter ?? '–'}
            </Text>
          </ProgressRing>
          <View className="flex-1 gap-0.5">
            <Text variant="overline" tone="accent">
              {course.code}
            </Text>
            <Text variant="title3" tabular>
              {formatScore(course.score) ?? 'No grade yet'}
            </Text>
            <Text variant="subhead" tone="muted" numberOfLines={1}>
              {course.instructor}
            </Text>
          </View>
        </Card>

        <View className="gap-3">
          <SegmentedControl
            options={filters}
            value={filter}
            onChange={setFilter}
            accessibilityLabel="Filter assignments"
          />
          {visible.length > 0 ? (
            <ListGroup>
              {visible.map((a) => (
                <AssignmentRow key={a.id} assignment={a} showCourse={false} />
              ))}
            </ListGroup>
          ) : (
            <Card variant="outlined">
              <Text variant="subhead" tone="muted" align="center">
                {filter === 'done' ? 'Nothing completed yet.' : 'Nothing left to do here.'}
              </Text>
            </Card>
          )}
        </View>

        <Callout tone="warning" title="Late policy">
          Work submitted late loses 10% per day, up to 3 days.
        </Callout>
      </Screen>
    </AccentScope>
  );
}
