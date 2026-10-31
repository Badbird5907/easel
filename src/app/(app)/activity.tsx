import { router, Stack } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';

import { type ActivityItem, type ActivityKind, useActivity } from '@/canvas/api/activity';
import { useDashboardCourses } from '@/canvas/api/courses';
import { useCanvas } from '@/canvas/session';
import { Callout, Chip, EmptyState, ListGroup, Screen, Skeleton, useTheme } from '@/design';
import { ActivityRow } from '@/features/activity/ActivityRow';
import { useOpenSignedIn } from '@/features/content/browser';
import { resolveCanvasLink } from '@/features/content/links';
import {
  activityPresentationDays,
  useActivityPresentation,
} from '@/features/activity/activityPresentation';
import { useActivityPresentationOwner } from '@/features/activity/activityPresentationOwner';

import type { MessageKey } from '@/i18n';

type Filter = 'all' | ActivityKind;

const filters: { value: Filter; label: MessageKey; empty: MessageKey }[] = [
  {
    value: 'all',
    label: 'activityPresentation.all',
    empty: 'activityPresentation.emptyAll',
  },
  {
    value: 'announcement',
    label: 'activityPresentation.announcements',
    empty: 'activityPresentation.emptyAnnouncements',
  },
  {
    value: 'discussion',
    label: 'activityPresentation.discussions',
    empty: 'activityPresentation.emptyDiscussions',
  },
  {
    value: 'submission',
    label: 'activityPresentation.grades',
    empty: 'activityPresentation.emptyGrades',
  },
  {
    value: 'conversation',
    label: 'activityPresentation.inbox',
    empty: 'activityPresentation.emptyInbox',
  },
  {
    value: 'conference',
    label: 'activityPresentation.conferences',
    empty: 'activityPresentation.emptyConferences',
  },
  {
    value: 'message',
    label: 'activityPresentation.notifications',
    empty: 'activityPresentation.emptyNotifications',
  },
];

/** What changed across the student's courses (NOTIF-1). Home's bell opens it. */
export default function ActivityScreen() {
  const { colors } = useTheme();
  const { account, client } = useCanvas();
  const { t, dates } = useActivityPresentation();
  const activity = useActivity();
  const courses = useDashboardCourses();
  const [filter, setFilter] = useState<Filter>('all');
  const owner = useActivityPresentationOwner(
    account.id,
    account.baseUrl,
    client,
    activity.data,
    activity.refetch,
    filter,
    t,
  );
  const [refreshState, setRefreshState] = useState<{
    owner: typeof owner;
    pending: boolean;
    failed: boolean;
    error: unknown;
  } | null>(null);
  const refreshing = refreshState?.owner === owner && refreshState.pending;
  const refreshFailed = refreshState?.owner === owner && refreshState.failed;
  const refreshError = refreshState?.owner === owner ? refreshState.error : null;
  const now = new Date();

  const active = filters.find((f) => f.value === filter) ?? filters[0];
  const visible = (activity.data ?? []).filter((i) => filter === 'all' || i.kind === filter);
  const courseFor = (id: string | null) =>
    id ? courses.data?.find((c) => c.id === id) : undefined;

  const openSignedIn = useOpenSignedIn();

  // Prefer the matching Easel route; other Canvas URLs open signed in on the web.
  const open = (item: ActivityItem) => {
    const target = item.target;
    if (!target || !activity.data?.includes(item) || !owner.beginOpen()) return;
    const generation = owner.generation;
    switch (target.kind) {
      case 'conversation':
        router.push({
          pathname: '/conversation/[conversationId]',
          params: { conversationId: target.conversationId },
        } as never);
        return;
      case 'topic':
        router.push({
          pathname: '/course/[courseId]/discussion/[topicId]',
          params: { courseId: target.courseId, topicId: target.topicId },
        } as never);
        return;
      case 'assignment':
        router.push({
          pathname: '/course/[courseId]/assignment/[assignmentId]',
          params: {
            courseId: target.courseId,
            assignmentId: target.assignmentId,
          },
        } as never);
        return;
      case 'course-discussions':
        router.push({
          pathname: '/course/[courseId]/discussions',
          params: { courseId: target.courseId },
        } as never);
        return;
      case 'url': {
        const route = resolveCanvasLink(target.url, account.baseUrl);
        if (route) router.push(route as never);
        else
          void (async () => {
            try {
              await openSignedIn(target.url, () => owner.owns(generation));
            } catch (error) {
              if (owner.owns(generation) && owner.t)
                Alert.alert(
                  owner.t('activityPresentation.openError'),
                  error instanceof Error ? error.message : String(error),
                  [{ text: owner.t('activityPresentation.ok') }],
                );
            } finally {
              if (owner.owns(generation)) owner.finishOpen();
            }
          })();
      }
    }
  };

  const refresh = async () => {
    if (!owner.beginRefresh()) return;
    const generation = owner.generation;
    setRefreshState({ owner, pending: true, failed: false, error: null });
    let error: unknown = null;
    let failed = false;
    try {
      const result = await activity.refetch();
      failed = result.isError;
      if (failed) error = result.error;
    } catch (caught) {
      failed = true;
      error = caught;
    } finally {
      if (owner.owns(generation)) {
        owner.finishRefresh();
        setRefreshState({ owner, pending: false, failed, error });
      }
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: t('activityPresentation.title') }} />
      <Screen
        contentClassName="gap-6"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-4"
          contentContainerClassName="gap-2 px-4"
          accessibilityLabel={t('activityPresentation.filter')}
        >
          {filters.map((f) => (
            <Chip
              key={f.value}
              selected={filter === f.value}
              onPress={() => {
                if (owner.active) setFilter(f.value);
              }}
            >
              {t(f.label)}
            </Chip>
          ))}
        </ScrollView>

        {activity.isPending ? (
          <View className="gap-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-48 rounded-2xl" />
          </View>
        ) : activity.isError || refreshFailed ? (
          <Callout
            tone="danger"
            title={t('activityPresentation.loadError')}
            action={{
              label: t('activityPresentation.retry'),
              onPress: refresh,
            }}
          >
            {refreshError != null
              ? refreshError instanceof Error
                ? refreshError.message
                : String(refreshError)
              : activity.error?.message}
          </Callout>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={t(active.empty)}
            description={t('activityPresentation.emptyHelp')}
          />
        ) : (
          activityPresentationDays(visible, now, dates).map((group) => (
            <ListGroup key={group.key} header={group.title}>
              {group.items.map((item) => (
                <ActivityRow
                  key={item.id}
                  item={item}
                  course={courseFor(item.courseId)}
                  onPress={item.target ? () => open(item) : undefined}
                />
              ))}
            </ListGroup>
          ))
        )}
      </Screen>
    </>
  );
}
