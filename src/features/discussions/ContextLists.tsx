import { router, Stack } from 'expo-router';
import { Megaphone, MessageSquare, SquarePen } from 'lucide-react-native';
import { useState } from 'react';
import { RefreshControl, View } from 'react-native';

import { useContextAnnouncements } from '@/canvas/api/announcements';
import {
  type DiscussionContext,
  type DiscussionTopic,
  useDiscussions,
  useTopicCreation,
} from '@/canvas/api/discussions';
import {
  AccentScope,
  Callout,
  deriveAccent,
  EmptyState,
  IconButton,
  ListGroup,
  Screen,
  Skeleton,
  useTheme,
} from '@/design';
import { useTranslation } from '@/i18n';
import { useContextLabel } from '@/features/groups/context';

import { AnnouncementRow, DiscussionRow } from './rows';

const activity = (t: DiscussionTopic) => (t.lastReplyAt ?? t.postedAt)?.getTime() ?? 0;

/** Pinned first in the instructor's order, then open by recent activity, then closed. */
function group(topics: DiscussionTopic[]) {
  const pinned = topics.filter((t) => t.pinned).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const rest = topics.filter((t) => !t.pinned).sort((a, b) => activity(b) - activity(a));
  return [
    { key: 'pinned', titleKey: 'discussions.pinned' as const, items: pinned },
    { key: 'open', titleKey: 'discussions.title' as const, items: rest.filter((t) => !t.locked) },
    { key: 'closed', titleKey: 'discussions.closed' as const, items: rest.filter((t) => t.locked) },
  ].filter((g) => g.items.length > 0);
}

/** Where {t('discussions.start')} goes for a course or group (CONTENT-5). */
export function newTopicRoute(context: DiscussionContext) {
  return context.type === 'course'
    ? { pathname: '/course/[courseId]/discussion/new', params: { courseId: context.id } }
    : { pathname: '/group/[groupId]/discussion/new', params: { groupId: context.id } };
}

/** A course's or group's discussions (CONTENT-1), with {t('discussions.start')} when students may (CONTENT-5). */
export function DiscussionListScreen({ context }: { context: DiscussionContext }) {
  const { t } = useTranslation();
  const { colors, scheme } = useTheme();
  const label = useContextLabel(context);
  const discussions = useDiscussions(context);
  const creation = useTopicCreation(context);
  const canStart = !!creation.data?.canCreate;
  const [refreshing, setRefreshing] = useState(false);
  const now = new Date();
  const tint = label.color ? deriveAccent(label.color, scheme).accentFg : undefined;
  const where = context.type === 'course' ? (label.code ?? t('discussions.thisCourse')) : (label.name ?? t('discussions.thisGroup'));

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([discussions.refetch(), creation.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const start = () => router.push(newTopicRoute(context) as never);

  return (
    <AccentScope color={label.color} className="flex-1">
      <Stack.Screen
        options={{
          title: t('discussions.title'),
          ...(tint && { headerTintColor: tint }),
          headerRight: canStart
            ? () => (
                <IconButton
                  icon={SquarePen}
                  accessibilityLabel={t('discussions.start')}
                  iconColor={tint ?? colors.accentFg}
                  onPress={start}
                />
              )
            : undefined,
        }}
      />
      <Screen
        contentClassName="gap-6"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        {discussions.isPending ? (
          <View className="gap-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-40 rounded-2xl" />
          </View>
        ) : discussions.isError ? (
          <Callout
            tone="danger"
            title={t('discussions.loadError')}
            action={{ label: t('common.retry'), onPress: () => discussions.refetch() }}
          >
            {discussions.error.message}
          </Callout>
        ) : discussions.data.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={t('discussions.empty')}
            description={
              canStart
                ? t('discussions.emptyCreate', { context: where })
                : t('discussions.emptyContext', { context: where })
            }
            action={canStart ? { label: t('discussions.start'), onPress: start, leadingIcon: SquarePen } : undefined}
          />
        ) : (
          group(discussions.data).map((g) => (
            <ListGroup key={g.key} header={t(g.titleKey)}>
              {g.items.map((topic) => (
                <DiscussionRow key={topic.id} topic={topic} now={now} />
              ))}
            </ListGroup>
          ))
        )}
      </Screen>
    </AccentScope>
  );
}

/** Every announcement in one course or group, newest first (ANN-2). */
export function AnnouncementListScreen({ context }: { context: DiscussionContext }) {
  const { t } = useTranslation();
  const { colors, scheme } = useTheme();
  const label = useContextLabel(context);
  const announcements = useContextAnnouncements(context);
  const [refreshing, setRefreshing] = useState(false);
  const now = new Date();
  const tint = label.color ? deriveAccent(label.color, scheme).accentFg : undefined;
  const where = context.type === 'course' ? (label.code ?? t('discussions.thisCourse')) : (label.name ?? t('discussions.thisGroup'));

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([announcements.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <AccentScope color={label.color} className="flex-1">
      <Stack.Screen options={{ title: t('announcements.title'), ...(tint && { headerTintColor: tint }) }} />
      <Screen
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        {announcements.isPending ? (
          <View className="gap-3">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </View>
        ) : announcements.isError ? (
          <Callout
            tone="danger"
            title={t('announcements.loadError')}
            action={{ label: t('common.retry'), onPress: () => announcements.refetch() }}
          >
            {announcements.error.message}
          </Callout>
        ) : announcements.data.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title={t('announcements.emptyYet')}
            description={t('announcements.emptyContext', { context: where })}
          />
        ) : (
          <ListGroup>
            {announcements.data.map((a) => (
              <AnnouncementRow key={a.id} announcement={a} now={now} context={context} />
            ))}
          </ListGroup>
        )}
      </Screen>
    </AccentScope>
  );
}
