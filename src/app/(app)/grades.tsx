import { useCanvas } from '@/canvas/session';
import { useGradeLifetime, useGradesRefresh } from '@/features/grades/lifetime';
import { useGradePresentation } from '@/features/grades/presentation';
import { router, Stack } from 'expo-router';
import { BookOpen, EyeOff, GraduationCap } from 'lucide-react-native';
import { RefreshControl, View } from 'react-native';

import { type CourseGradeSummary, useGradesOverview } from '@/canvas/api/grades';
import {
  Callout,
  Card,
  EmptyState,
  Icon,
  IconTile,
  ListGroup,
  ListItem,
  Screen,
  Skeleton,
  Text,
  useTheme,
} from '@/design';
import { displayLetter, formatPercent, spokenLetter } from '@/features/grades/format';

function GradeValue({ course }: { course: CourseGradeSummary }) {
  const p = useGradePresentation();
  const { t, locale } = p;
  if (course.hidden) {
    return (
      <View className="max-w-[40%] flex-row items-center gap-1.5">
        <Icon icon={EyeOff} size={14} tone="subtle" />
        <Text variant="footnote" tone="muted" align="right" className="shrink">
          {t('grades.hidden')}
        </Text>
      </View>
    );
  }
  if (course.restricted) {
    return course.grade ? (
      <Text variant="headline">{displayLetter(course.grade, p)}</Text>
    ) : (
      <Text variant="footnote" tone="muted">
        {t('grades.noGrade')}
      </Text>
    );
  }
  if (course.score === null) {
    return (
      <Text variant="footnote" tone="muted">
        {t('grades.noGrade')}
      </Text>
    );
  }
  return (
    <View className="items-end">
      <Text variant="headline" tabular>
        {formatPercent(course.score, locale)}
      </Text>
      {course.grade ? (
        <Text variant="footnote" tone="muted">
          {displayLetter(course.grade, p)}
        </Text>
      ) : null}
    </View>
  );
}

function spokenGrade(
  course: CourseGradeSummary,
  p: ReturnType<typeof useGradePresentation>,
): string {
  const { t, locale } = p;
  if (course.hidden) return t('grades.hidden');
  if (course.restricted) return course.grade ? spokenLetter(course.grade, p) : t('grades.noGrade');
  if (course.score === null) return t('grades.noGrade');
  return [formatPercent(course.score, locale), course.grade ? spokenLetter(course.grade, p) : null]
    .filter(Boolean)
    .join(', ');
}

/** GRADE-1: every active course with its current grade. Home links here; Home cards never show grades. */
export default function GradesScreen() {
  const p = useGradePresentation();
  const { t } = p;
  const { account, client } = useCanvas();
  const owner = useGradeLifetime(account.id, client);
  const { colors } = useTheme();
  const overview = useGradesOverview();
  const { refreshing, refresh } = useGradesRefresh(owner, [overview.refetch]);

  return (
    <>
      <Stack.Screen options={{ title: t('grades.title') }} />
      <Screen
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        {overview.isPending || overview.isFetching || (!overview.isError && !!overview.failureReason) ? (
          <Card padding="none" className="overflow-hidden">
            {[0, 1, 2, 3].map((i) => (
              <View key={i} className="min-h-[60px] flex-row items-center gap-3 px-4 py-3">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <View className="flex-1 gap-2">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-1/4" />
                </View>
                <Skeleton className="h-5 w-14" />
              </View>
            ))}
          </Card>
        ) : overview.isError ? (
          <Callout
            tone="danger"
            title={t('grades.loadError')}
            action={{ label: t('grades.retry'), onPress: refresh }}
          >
            {overview.error.message}
          </Callout>
        ) : overview.data.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={GraduationCap}
              title={t('grades.noCourses')}
              description={t('grades.coursesHelp')}
            />
          </Card>
        ) : (
          <ListGroup>
            {overview.data.map((course) => (
              <ListItem
                key={course.id}
                leading={<IconTile icon={BookOpen} color={course.color} />}
                title={course.name}
                subtitle={[course.code, course.periodTitle].filter(Boolean).join(' · ')}
                subtitleLines={1}
                trailing={<GradeValue course={course} />}
                accessibilityLabel={`${course.name}, ${course.code}: ${spokenGrade(course, p)}`}
                accessibilityHint={t('grades.openCourse')}
                onPress={() => {
                  if (owner.valid())
                    router.push({
                      pathname: '/course/[courseId]/grades',
                      params: { courseId: course.id },
                    });
                }}
              />
            ))}
          </ListGroup>
        )}
      </Screen>
    </>
  );
}
