import { Stack } from 'expo-router';
import { Megaphone } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  FEED_DAYS,
  useAccountNotifications,
  useAnnouncements,
  useDismissAccountNotification,
} from '@/canvas/api/announcements';
import { useDashboardCourses } from '@/canvas/api/courses';
import { AccentScope, Callout, Chip, EmptyState, ListGroup, Screen, Skeleton, useTheme } from '@/design';
import { useTranslation } from '@/i18n';
import { GlobalNotice } from '@/features/discussions/GlobalNotice';
import { AnnouncementRow } from '@/features/discussions/rows';

/** Announcements from every dashboard course, newest first, with a course filter (ANN-1). */
export default function AnnouncementsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const courses = useDashboardCourses();
  const courseIds = useMemo(() => courses.data?.map((c) => c.id), [courses.data]);
  const feed = useAnnouncements(courseIds, FEED_DAYS);
  const notices = useAccountNotifications();
  const dismiss = useDismissAccountNotification();
  const [courseId, setCourseId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = new Date();

  const courseFor = (id: string | null) => (id ? courses.data?.find((c) => c.id === id) : undefined);
  const selected = courseFor(courseId);
  const visible = (feed.data ?? []).filter((a) => !courseId || a.courseId === courseId);

  const refresh = async () => {
    setRefreshing(true);
    try {
      // Query error states render failures; wait for the other refreshes to settle too.
      await Promise.allSettled([courses.refetch(), feed.refetch(), notices.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const loading = courses.isPending || feed.isPending;
  const error = courses.error ?? feed.error;

  return (
    <>
      <Stack.Screen options={{ title: t('announcements.title') }} />
      <Screen
        contentClassName="gap-5"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        {notices.data?.map((notice) => (
          <GlobalNotice key={notice.id} notice={notice} onDismiss={() => dismiss.mutate(notice.id)} />
        ))}

        {courses.data && courses.data.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="-mx-4"
            contentContainerClassName="gap-2 px-4"
            accessibilityLabel={t('announcements.filter')}
          >
            <Chip selected={courseId === null} onPress={() => setCourseId(null)}>
              {t('announcements.allCourses')}
            </Chip>
            {courses.data.map((course) => (
              <AccentScope key={course.id} color={course.color}>
                <Chip
                  selected={courseId === course.id}
                  accessibilityLabel={course.name}
                  onPress={() => setCourseId(course.id)}
                >
                  {course.code}
                </Chip>
              </AccentScope>
            ))}
          </ScrollView>
        ) : null}

        {loading ? (
          <View className="gap-3">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </View>
        ) : error ? (
          <Callout
            tone="danger"
            title={t('announcements.loadError')}
            action={{
              label: t('common.retry'),
              onPress: () => (courses.isError ? courses.refetch() : feed.refetch()),
            }}
          >
            {error.message}
          </Callout>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title={selected ? t('announcements.emptyCourse', { course: selected.code }) : t('announcements.empty')}
            description={t('announcements.range')}
          />
        ) : (
          <ListGroup>
            {visible.map((a) => (
              <AnnouncementRow
                key={a.id}
                announcement={a}
                course={courseId ? undefined : courseFor(a.courseId)}
                now={now}
              />
            ))}
          </ListGroup>
        )}
      </Screen>
    </>
  );
}
