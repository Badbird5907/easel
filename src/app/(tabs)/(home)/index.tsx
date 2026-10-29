import { router, Stack } from 'expo-router';
import { ArrowRight, Palette } from 'lucide-react-native';
import { View } from 'react-native';

import { AssignmentRow } from '@/components/AssignmentRow';
import { CourseCard } from '@/components/CourseCard';
import {
  Avatar,
  Badge,
  Button,
  Card,
  IconButton,
  ListGroup,
  ListItem,
  ProgressBar,
  Screen,
  Section,
  Text,
} from '@/design';
import { announcements, assignments, courseById, courses } from '@/mocks/canvas';

function pairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

export default function HomeScreen() {
  const upNext = assignments.filter((a) => a.status !== 'graded' && a.status !== 'submitted');
  const dueToday = assignments.filter((a) => a.status === 'dueToday').length;
  const doneThisWeek = assignments.filter((a) => a.status === 'submitted' || a.status === 'graded').length;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Home',
          headerRight: () => (
            <IconButton
              icon={Palette}
              accessibilityLabel="Design system"
              onPress={() => router.push('/design')}
            />
          ),
        }}
      />
      <Screen>
        <Card padding="lg" className="gap-4">
          <View className="gap-1">
            <Text variant="overline" tone="accent">
              This week
            </Text>
            <Text variant="title2">
              {dueToday} due today, {upNext.length} still open
            </Text>
          </View>
          <View className="gap-2">
            <ProgressBar
              value={doneThisWeek / assignments.length}
              accessibilityLabel="Assignments completed this week"
            />
            <Text variant="footnote" tone="muted">
              {doneThisWeek} of {assignments.length} assignments done
            </Text>
          </View>
          <Button trailingIcon={ArrowRight} onPress={() => router.navigate('/todo')}>
            Open To Do
          </Button>
        </Card>

        <Section title="Up next" action={{ label: 'See all', onPress: () => router.navigate('/todo') }}>
          <ListGroup>
            {upNext.map((a) => (
              <AssignmentRow key={a.id} assignment={a} />
            ))}
          </ListGroup>
        </Section>

        <Section title="Courses">
          <View className="gap-3">
            {pairs(courses).map((row) => (
              <View key={row[0].id} className="flex-row gap-3">
                {row.map((course) => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    className="flex-1"
                    onPress={() => router.push({ pathname: '/course/[id]', params: { id: course.id } })}
                  />
                ))}
                {row.length === 1 ? <View className="flex-1" /> : null}
              </View>
            ))}
          </View>
        </Section>

        <Section title="Announcements">
          <ListGroup>
            {announcements.map((n) => (
              <ListItem
                key={n.id}
                leading={<Avatar name={n.author} />}
                title={n.title}
                subtitle={`${courseById(n.courseId)?.code} · ${n.preview}`}
                trailing={
                  <View className="items-end gap-1.5 self-start pt-3">
                    <Text variant="caption" tone="subtle">
                      {n.postedLabel}
                    </Text>
                    {n.unread ? (
                      <Badge tone="accent" variant="solid" size="sm">
                        New
                      </Badge>
                    ) : null}
                  </View>
                }
                chevron={false}
              />
            ))}
          </ListGroup>
        </Section>
      </Screen>
    </>
  );
}
