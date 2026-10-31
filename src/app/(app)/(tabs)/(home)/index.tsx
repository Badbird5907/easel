import { GradesShortcut } from '@/features/grades/GradesShortcut';
import { LocalizedText as Text } from '@/i18n/LocalizedText';
import { useTranslation } from '@/i18n';
import { router } from 'expo-router';
import { Bell, BookOpen, Palette, Settings } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, useWindowDimensions, View } from 'react-native';

import {
  useAccountNotifications,
  useAnnouncements,
  useDismissAccountNotification,
} from '@/canvas/api/announcements';
import { useLiveConferences } from '@/canvas/api/conferences';
import { useDashboardCourses } from '@/canvas/api/courses';
import { useGroups } from '@/canvas/api/groups';
import { upcomingRange, usePlannerItems } from '@/canvas/api/planner';
import type { Course } from '@/canvas/models';
import { useCanvas } from '@/canvas/session';
import { AssignmentRow } from '@/components/AssignmentRow';
import { CourseCard } from '@/components/CourseCard';
import { NextDueCard } from '@/components/NextDueCard';
import {
  Avatar,
  Callout,
  Card,
  EmptyState,
  haptics,
  IconButton,
  IconTile,
  ListGroup,
  ListItem,
  Screen,
  Section,
  Skeleton,
  useTheme,
} from '@/design';
import { AccountSwitcherSheet } from '@/features/accounts/AccountSwitcher';
import { openCanvasLink } from '@/features/content/links';
import { GlobalNotice } from '@/features/discussions/GlobalNotice';
import { CourseInvitations } from '@/features/home/CourseInvitations';
import { GroupsSection } from '@/features/home/GroupsSection';
import { LiveConferences } from '@/features/home/LiveConferences';
import { ActivityStrip } from '@/features/offline/ActivityStrip';
import { canOpenWorkItem, openWorkItem } from '@/features/planner/open';
import { useNow } from '@/features/reminders/useNow';
import { relativeAge, relativeAgeLabel, useDisplayTimeZone } from '@/lib/dates';
import { summarizeDue } from '@/lib/due';

/** How many rows Home previews before "See all" takes over. */
const UP_NEXT_LIMIT = 4;
const ANNOUNCEMENT_LIMIT = 3;

function courseRows<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return rows;
}

export default function HomeScreen() {
  const { t, direction } = useTranslation();
  const { fontScale } = useWindowDimensions();
  const columns = fontScale > 1.3 ? 1 : 2;
  const { account } = useCanvas();
  const { colors } = useTheme();
  const zone = useDisplayTimeZone();
  const [nowMs] = useNow();
  const now = new Date(nowMs);
  const range = upcomingRange(now, zone);
  const courses = useDashboardCourses();
  const planner = usePlannerItems(range);
  const courseIds = useMemo(() => courses.data?.map((c) => c.id), [courses.data]);
  const announcements = useAnnouncements(courseIds, 14);
  const notices = useAccountNotifications();
  const dismissNotice = useDismissAccountNotification();
  const groups = useGroups();
  const conferences = useLiveConferences();
  const [refreshing, setRefreshing] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const courseFor = (id: string | null) => (id ? courses.data?.find((c) => c.id === id) : undefined);
  const due = summarizeDue(planner.data ?? [], now);
  const upNext = [...due.overdue, ...due.later].slice(0, UP_NEXT_LIMIT);
  const openTodo = () => router.navigate('/todo');

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([
      courses.refetch(),
      planner.refetch(),
      announcements.refetch(),
      notices.refetch(),
      groups.refetch(),
      conferences.refetch(),
    ]);
    setRefreshing(false);
  };

  return (
    <>
      <Screen
        style={{ direction }}
        title={t('nav.home')}
        titleAccessory={
          <View className="flex-row gap-2">
            <IconButton
              icon={Bell}
              variant="secondary"
              accessibilityLabel={t('home.activity')}
              onPress={() => router.push('/activity')}
            />
            {/* Touch and hold to switch accounts (ACCT-4); screen readers get it as an action. */}
            <IconButton
              icon={Settings}
              variant="secondary"
              accessibilityLabel={t('nav.settings')}
              accessibilityActions={[{ name: 'switchAccount', label: t('home.switchAccount') }]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'switchAccount') setSwitcherOpen(true);
              }}
              onPress={() => router.push('/settings')}
              onLongPress={() => {
                haptics.selection();
                setSwitcherOpen(true);
              }}
            />
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        {notices.data && notices.data.length > 0 ? (
          <View className="gap-3">
            {notices.data.map((notice) => (
              <GlobalNotice
                key={notice.id}
                notice={notice}
                onDismiss={() => dismissNotice.mutate(notice.id)}
                onPress={() => router.push('/announcements')}
              />
            ))}
          </View>
        ) : null}

        <ActivityStrip />

        <LiveConferences courseFor={courseFor} />

        <CourseInvitations />

        {planner.isPending ? (
          <Card className="gap-4">
            <Skeleton className="h-7 w-2/3" />
            <View className="flex-row items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <View className="flex-1 gap-2">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-1/3" />
              </View>
            </View>
          </Card>
        ) : planner.isError && !planner.data ? (
          <Callout
            tone="danger"
            title={t('home.dueError')}
            action={{ label: t('common.retry'), onPress: () => planner.refetch() }}
          >
            {t('common.loadHint')}
          </Callout>
        ) : (
          <NextDueCard summary={due} now={now} courseFor={courseFor} onPress={openTodo} />
        )}

        {upNext.length > 0 ? (
          <Section title={t('home.upNext')} action={{ label: t('common.seeAll'), onPress: openTodo }}>
            <ListGroup>
              {upNext.map((item) => (
                <AssignmentRow
                  key={item.id}
                  item={item}
                  course={courseFor(item.courseId)}
                  onPress={canOpenWorkItem(item) ? () => openWorkItem(item, account.baseUrl) : undefined}
                />
              ))}
            </ListGroup>
          </Section>
        ) : null}

        <Section
          title={t('home.courses')}
          action={{ label: t('common.seeAll'), onPress: () => router.push('/courses') }}
        >
          {courses.isPending ? (
            <View className="flex-row gap-3">
              <Skeleton className="h-36 flex-1 rounded-2xl" />
              <Skeleton className="h-36 flex-1 rounded-2xl" />
            </View>
          ) : courses.isError && !courses.data ? (
            <Callout
              tone="danger"
              title={t('home.coursesError')}
              action={{ label: t('common.retry'), onPress: () => courses.refetch() }}
            >
              {t('common.loadHint')}
            </Callout>
          ) : courses.data.length === 0 ? (
            <Card padding="none">
              <EmptyState icon={BookOpen} title={t('home.noCourses')} description={t('home.noCoursesHint')} />
            </Card>
          ) : (
            <View className="gap-3">
              {courseRows<Course>(courses.data, columns).map((row) => (
                <View key={row[0].id} className="flex-row gap-3">
                  {row.map((course) => (
                    <CourseCard
                      key={course.id}
                      course={course}
                      className="flex-1"
                      onPress={() =>
                        router.push({ pathname: '/course/[courseId]', params: { courseId: course.id } })
                      }
                    />
                  ))}
                  {columns === 2 && row.length === 1 ? <View className="flex-1" /> : null}
                </View>
              ))}
              <ListGroup>
                <GradesShortcut />
                <ListItem
                  leading={<IconTile icon={Palette} tone="neutral" />}
                  title={t('home.customize')}
                  subtitle={t('home.customizeHint')}
                  onPress={() => router.push('/customize-courses')}
                />
              </ListGroup>
            </View>
          )}
        </Section>

        <GroupsSection courseFor={courseFor} />

        {announcements.data && announcements.data.length > 0 ? (
          <Section
            title={t('home.announcements')}
            action={{ label: t('common.seeAll'), onPress: () => router.push('/announcements') }}
          >
            <ListGroup>
              {announcements.data.slice(0, ANNOUNCEMENT_LIMIT).map((n) => {
                const course = courseFor(n.courseId);
                const age = relativeAge(n.postedAt, now);
                return (
                  <ListItem
                    key={n.id}
                    leading={<Avatar name={n.author.name} uri={n.author.avatarUrl} />}
                    title={n.title}
                    subtitle={[course?.code, n.preview].filter(Boolean).join(' · ')}
                    accessibilityLabel={t(n.unread ? 'home.unreadAnnouncement' : 'home.announcement', {
                      title: n.title,
                      author: n.author.name,
                      age: relativeAgeLabel(n.postedAt, now),
                    })}
                    trailing={
                      <View className="flex-row items-center gap-1.5 self-start pt-3.5">
                        {n.unread ? <View className="h-2 w-2 rounded-full bg-accent" /> : null}
                        <Text variant="caption" tone="subtle">
                          {age}
                        </Text>
                      </View>
                    }
                    chevron={false}
                    onPress={() => openCanvasLink(n.htmlUrl, account.baseUrl)}
                  />
                );
              })}
            </ListGroup>
          </Section>
        ) : null}
      </Screen>
      {/* Modals sit beside the scroll view so they don't take space in its content. */}
      <AccountSwitcherSheet visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </>
  );
}
