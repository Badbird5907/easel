import { router, Stack } from 'expo-router';
import { CalendarClock, EyeOff, Lock, MessageSquare, UsersRound, VenetianMask } from 'lucide-react-native';
import { type ComponentRef, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, type HostInstance, Pressable, RefreshControl, type ScrollView, View } from 'react-native';

import {
  contextKey,
  type DiscussionContext,
  type DiscussionEntry,
  type DiscussionTopic,
  useDeleteEntry,
  useDiscussionThread,
  useDiscussionTopic,
  useMarkAllRead,
  useMarkEntriesRead,
  useMarkEntryUnread,
  useMarkTopicRead,
  useOwnPostPermissions,
  usePostEntry,
  useRateEntry,
  useUpdateEntry,
} from '@/canvas/api/discussions';
import { useMyCourseGroups } from '@/canvas/api/groups';
import { useCanvas } from '@/canvas/session';
import {
  AccentScope,
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  deriveAccent,
  EmptyState,
  Screen,
  SearchField,
  Section,
  SegmentedControl,
  Skeleton,
  Text,
  useTheme,
  useToast,
} from '@/design';
import { RichContent } from '@/features/content/RichContent';
import { useContextLabel } from '@/features/groups/context';
import { AttachmentList } from '@/features/files/AttachmentList';
import { useTranslation } from '@/i18n';
import { useDisplayTimeZone } from '@/lib/dates';

import { CheckpointCard } from './CheckpointCard';
import { discussionPresentation } from './presentation';
import { discussionErrorMessage, entryAuthorName } from './threadPresentation';
import { useReplySort } from './sortPreference';
import {
  Composer,
  ComposerActionProvider,
  ComposerHeaderButton,
  type ComposerTarget,
  type EntryDraftInput,
  MentionHint,
  SearchResults,
  searchEntries,
  ThreadList,
  ThreadProvider,
  useComposerActionHost,
} from './Thread';
import { useSeenTracker } from './useSeenTracker';

const unreadIn = (entries: DiscussionEntry[]): string[] =>
  entries.flatMap((e) => [...(e.unread && !e.deleted ? [e.id] : []), ...unreadIn(e.replies)]);

/** Opens a topic in Easel's thread screen, in its course or group. */
export function topicRoute(context: DiscussionContext, topicId: string) {
  return context.type === 'course'
    ? { pathname: '/course/[courseId]/discussion/[topicId]', params: { courseId: context.id, topicId } }
    : { pathname: '/group/[groupId]/discussion/[topicId]', params: { groupId: context.id, topicId } };
}

/**
 * Group discussions live once per group. The course's copy only introduces
 * the topic, so the student goes straight to their group's (CONTENT-4).
 */
function useGroupCopy(topic: DiscussionTopic | undefined) {
  const groups = useMyCourseGroups(topic?.courseId, { enabled: !!topic?.isGroupDiscussion });
  if (!topic?.isGroupDiscussion) return { status: 'none' as const };
  if (groups.isPending) return { status: 'pending' as const };
  if (groups.isError) return { status: 'error' as const, error: groups.error.message, onRetry: () => groups.refetch() };
  const mine = new Set((groups.data ?? []).map((g) => g.id));
  const child = topic.groupChildren.find((c) => mine.has(c.groupId));
  if (child) return { status: 'found' as const, child };
  return { status: 'missing' as const };
}

/**
 * An announcement or discussion in a course or group: the post, its
 * attachments, and threaded replies (ANN-3, ANN-4, CONTENT-2 to CONTENT-4).
 * Opening it marks the post read; replies are marked read as they scroll into
 * view.
 */
export function TopicView({ context, topicId }: { context: DiscussionContext; topicId: string }) {
  const { t } = useTranslation();
  const { colors, scheme } = useTheme();
  const toast = useToast();
  const label = useContextLabel(context);
  const topic = useDiscussionTopic(context, topicId);
  const canSeePosts = !topic.isPending && !topic.isError && !!topic.data?.canSeePosts;
  const groupCopy = useGroupCopy(topic.data);
  const canLoadThread = canSeePosts && groupCopy.status === 'none';
  const thread = useDiscussionThread(context, topicId, {
    enabled: canLoadThread,
    anonymous: !!topic.data?.anonymity,
  });
  const loaded = canLoadThread && !thread.isPending && !thread.isError && thread.data?.status === 'visible';
  const [refreshing, setRefreshing] = useState(false);
  const [target, setTarget] = useState<ComposerTarget>(null);
  const headerAction = useComposerActionHost();
  const now = new Date();

  const { mutate: markTopicRead } = useMarkTopicRead();
  const { mutate: markEntriesRead } = useMarkEntriesRead();
  const markAllRead = useMarkAllRead();
  const markUnread = useMarkEntryUnread();
  const post = usePostEntry();
  const update = useUpdateEntry();
  const remove = useDeleteEntry();
  const rate = useRateEntry();

  const onSeen = useCallback(
    (entryIds: string[]) => {
      if (loaded) markEntriesRead({ context, topicId, entryIds });
    },
    [context, topicId, markEntriesRead, loaded],
  );
  const tracker = useSeenTracker(onSeen);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  // Screen hands every prop, ref included, to its ScrollView; ScreenProps doesn't declare ref.
  const scrollProps = { ref: scrollRef } as object;

  // Once per visit, when the post loads.
  const topicMarked = useRef(false);
  const topicUnread = topic.data?.unread;
  useEffect(() => {
    if (topicUnread === undefined || topicMarked.current) return;
    topicMarked.current = true;
    if (topicUnread) markTopicRead({ context, topicId });
  }, [topicUnread, context, topicId, markTopicRead]);

  // A group discussion opens the student's group's copy instead.
  const child = groupCopy.status === 'found' ? groupCopy.child : null;
  useEffect(() => {
    if (!child) return;
    router.replace({
      pathname: '/group/[groupId]/discussion/[topicId]',
      params: { groupId: child.groupId, topicId: child.topicId },
    } as never);
  }, [child]);

  // Replies already on screen when the thread loads count as seen.
  const { checkNow } = tracker;
  useEffect(() => {
    if (loaded) checkNow();
  }, [loaded, checkNow]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([topic.refetch(), canSeePosts ? thread.refetch() : null]);
    } finally {
      setRefreshing(false);
    }
  };

  const openComposer = (next: ComposerTarget) => {
    post.reset();
    update.reset();
    setTarget(next);
  };

  const title = label.name ?? t(topic.data?.isAnnouncement ? 'discussionDetail.announcement' : 'discussionDetail.discussion');
  const tint = label.color ? deriveAccent(label.color, scheme).accentFg : undefined;

  return (
    <AccentScope color={label.color} className="flex-1">
      <Stack.Screen
        options={{
          title,
          ...(tint && { headerTintColor: tint }),
          // While a reply is being written, its Post or Save button also sits here, above the keyboard.
          headerRight: headerAction.action
            ? () => (
                <AccentScope color={label.color}>
                  <ComposerHeaderButton action={headerAction.action!} />
                </AccentScope>
              )
            : undefined,
        }}
      />
      <ComposerActionProvider host={headerAction.host}>
        <Screen
          {...scrollProps}
          automaticallyAdjustKeyboardInsets
          contentClassName="gap-6"
          onScroll={loaded ? tracker.check : undefined}
          onMomentumScrollEnd={loaded ? tracker.checkNow : undefined}
          onScrollEndDrag={loaded ? tracker.checkNow : undefined}
          onContentSizeChange={loaded ? tracker.checkNow : undefined}
          scrollEventThrottle={100}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
          }
        >
          {topic.isPending ? (
            <TopicSkeleton />
          ) : topic.isError && !topic.data ? (
            <Callout
              tone="danger"
              title={t('discussionDetail.loadError')}
              action={{ label: t('common.retry'), onPress: () => topic.refetch() }}
            >
              {discussionErrorMessage(topic.error, t)}
            </Callout>
          ) : (
            <>
              <TopicHeader topic={topic.data} meta={label.code} now={now} />

              {topic.data.html ? <RichContent html={topic.data.html} /> : null}
              <AttachmentList
                attachments={topic.data.attachments}
                courseId={topic.data.courseId || undefined}
                header={t('discussionDetail.attachments')}
              />

              {groupCopy.status !== 'none' ? (
                <GroupCopyNotice {...groupCopy} courseId={topic.data.courseId} />
              ) : (
                <Replies
                  context={context}
                  topic={topic.data}
                  thread={thread}
                  target={target}
                  setTarget={openComposer}
                  submitting={post.isPending || update.isPending}
                  error={discussionErrorMessage(post.error ?? update.error, t)}
                  now={now}
                  scrollViewRef={scrollRef}
                  seen={tracker.seen}
                  registerUnread={tracker.register}
                  onLayoutChange={tracker.checkNow}
                  markingAll={markAllRead.isPending}
                  onMarkAllRead={(ids) => {
                    tracker.markHandled(ids);
                    markAllRead.mutate(
                      { context, topicId },
                      { onError: (error) => Alert.alert(t('discussionDetail.markReadError'), discussionErrorMessage(error, t) ?? undefined) },
                    );
                  }}
                  onMarkUnread={(entryId) => {
                    tracker.markHandled([entryId]);
                    markUnread.mutate(
                      { context, topicId, entryId },
                      { onError: (error) => Alert.alert(t('discussionDetail.markUnreadError'), discussionErrorMessage(error, t) ?? undefined) },
                    );
                  }}
                  onReply={(parentId, draft) => {
                    const wasGated = !topic.data.canSeePosts;
                    post.mutate(
                      {
                        context,
                        topicId,
                        parentId,
                        html: draft.html,
                        fileId: draft.fileId,
                        anonymous: draft.anonymous,
                      },
                      {
                        onSuccess: () => {
                          setTarget(null);
                          toast.show(
                            wasGated ? t('discussionDetail.postedGated') : t('discussionDetail.posted'),
                          );
                        },
                      },
                    );
                  }}
                  onEdit={(entryId, draft) =>
                    update.mutate(
                      {
                        context,
                        topicId,
                        entryId,
                        html: draft.html,
                        fileId: draft.fileId,
                        removeAttachment: draft.removeAttachment,
                        attachments: draft.attachments,
                      },
                      { onSuccess: () => setTarget(null) },
                    )
                  }
                  onDelete={(entryId) =>
                    remove.mutate(
                      { context, topicId, entryId },
                      {
                        onSuccess: () => toast.show(t('discussionDetail.deleted')),
                        onError: (error) => Alert.alert(t('discussionDetail.deleteError'), discussionErrorMessage(error, t) ?? undefined),
                      },
                    )
                  }
                  onLike={(entryId, liked) =>
                    rate.mutate(
                      { context, topicId, entryId, liked },
                      { onError: (error) => Alert.alert(t('discussionDetail.likeError'), discussionErrorMessage(error, t) ?? undefined) },
                    )
                  }
                />
              )}
            </>
          )}
        </Screen>
      </ComposerActionProvider>
      {toast.element}
    </AccentScope>
  );
}

function TopicSkeleton() {
  return (
    <View className="gap-4">
      <Skeleton className="h-7 w-4/5" />
      <View className="flex-row items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <View className="flex-1 gap-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </View>
      </View>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-2/3" />
    </View>
  );
}

function TopicHeader({ topic, meta, now }: { topic: DiscussionTopic; meta: string | null; now: Date }) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const { dates, pointParams } = discussionPresentation(locale, zone);
  const author = topic.author?.name ?? t(topic.anonymity ? 'discussionDetail.anonymous' : 'discussionDetail.unknownAuthor');
  return (
    <View className="gap-4">
      <Text variant="title2" accessibilityRole="header">
        {topic.title}
      </Text>
      <View className="flex-row items-center gap-3">
        <Avatar name={author} uri={topic.author?.avatarUrl} />
        <View className="flex-1">
          <Text variant="subhead" weight="semibold" numberOfLines={1}>
            {author}
          </Text>
          <Text variant="footnote" tone="muted" numberOfLines={1}>
            {[meta, topic.postedAt ? dates.formatDueDate(topic.postedAt, now) : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      {topic.anonymity || topic.isGroupDiscussion || (topic.assignment && !topic.checkpoints.length) ? (
        <View className="flex-row flex-wrap gap-2">
          {topic.assignment && !topic.checkpoints.length && topic.assignment.dueAt ? (
            <Badge icon={CalendarClock} tone={topic.assignment.dueAt < now ? 'danger' : 'accent'}>
              {t('discussions.due', { date: dates.formatDueDate(topic.assignment.dueAt, now) })}
            </Badge>
          ) : null}
          {topic.assignment && !topic.checkpoints.length && topic.assignment.points != null ? (
            <Badge>{t('discussions.points', pointParams(topic.assignment.points))}</Badge>
          ) : null}
          {topic.anonymity ? (
            <Badge icon={VenetianMask}>
              {topic.anonymity === 'full' ? t('discussionDetail.anonymous') : t('discussionDetail.anonymousAllowed')}
            </Badge>
          ) : null}
          {topic.isGroupDiscussion ? <Badge icon={UsersRound}>{t('discussions.group')}</Badge> : null}
        </View>
      ) : null}
    </View>
  );
}

function GroupCopyNotice({
  status,
  courseId,
  error,
  onRetry,
}: {
  status: 'pending' | 'found' | 'missing' | 'error';
  courseId: string;
  error?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  if (status === 'error')
    return (
      <Callout tone="danger" title={t('groups.mineError')} action={onRetry ? { label: t('common.retry'), onPress: onRetry } : undefined}>
        {error}
      </Callout>
    );
  if (status !== 'missing')
    return (
      <Card className="gap-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </Card>
    );
  return (
    <Callout tone="info" icon={UsersRound} title={t('discussionDetail.groupMissing')}>
      <View className="gap-2">
        <Text variant="subhead" tone="muted">
          {t('discussionDetail.groupHelp')}
        </Text>
        {courseId ? (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onPress={() =>
              router.push({ pathname: '/course/[courseId]/people', params: { courseId, show: 'groups' } } as never)
            }
          >
            {t('discussionDetail.seeGroups')}
          </Button>
        ) : null}
      </View>
    </Callout>
  );
}

type RepliesProps = {
  context: DiscussionContext;
  topic: DiscussionTopic;
  thread: ReturnType<typeof useDiscussionThread>;
  target: ComposerTarget;
  setTarget: (target: ComposerTarget) => void;
  submitting: boolean;
  error: string | null;
  now: Date;
  scrollViewRef: RefObject<ComponentRef<typeof ScrollView> | null>;
  seen: ReadonlySet<string>;
  registerUnread: (entryId: string, view: HostInstance | null) => void;
  onLayoutChange: () => void;
  markingAll: boolean;
  onMarkAllRead: (ids: string[]) => void;
  onMarkUnread: (entryId: string) => void;
  onReply: (parentId: string | null, draft: EntryDraftInput) => void;
  onEdit: (entryId: string, draft: EntryDraftInput) => void;
  onDelete: (entryId: string) => void;
  onLike: (entryId: string, liked: boolean) => void;
};

function Replies({
  context,
  topic,
  thread,
  target,
  setTarget,
  submitting,
  error,
  now,
  scrollViewRef,
  seen,
  registerUnread,
  onLayoutChange,
  markingAll,
  onMarkAllRead,
  onMarkUnread,
  onReply,
  onEdit,
  onDelete,
  onLike,
}: RepliesProps) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const { number, countParams } = discussionPresentation(locale, zone);
  const sortOptions = [
    { value: 'desc', label: t('discussionDetail.newest') },
    { value: 'asc', label: t('discussionDetail.oldest') },
  ] as const;
  const { account } = useCanvas();
  const [sort, setSort] = useReplySort(
    account.id,
    `${contextKey(context)}:${topic.id}`,
    topic.sortOrder,
    topic.sortOrderLocked,
  );
  const [search, setSearch] = useState('');
  const gated = !topic.canSeePosts || thread.data?.status === 'gated';
  const visible = !gated && thread.data?.status === 'visible' ? thread.data : null;
  const entries = useMemo(() => {
    const list = visible?.entries ?? [];
    const sorted = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return sort === 'desc' ? sorted.reverse() : sorted;
  }, [visible, sort]);
  const count = visible ? visible.count : topic.replyCount;
  const unread = useMemo(() => unreadIn(entries), [entries]);
  const unseen = unread.filter((id) => !seen.has(id));
  const permissions = useOwnPostPermissions(context, topic.id, !!visible || topic.anonymity === 'partial');
  const replyingToTopic = target?.kind === 'reply' && target.parentId === null;
  const results = useMemo(
    () => searchEntries(entries, search, (entry) => entryAuthorName(entry, t)),
    [entries, search, t],
  );
  const canPostAnonymously = topic.anonymity === 'partial' && !!permissions.data?.canReplyAnonymously;
  const fullyAnonymous = topic.anonymity === 'full';

  const canManage = (entryId: string) => {
    const data = permissions.data;
    // Without permission data, offer the actions and let Canvas decide.
    if (!data) return true;
    if (data.manageable.includes(entryId)) return true;
    if (data.locked.includes(entryId)) return false;
    // A post newer than the permission check follows the course's rule.
    return data.manageable.length > 0 || data.locked.length === 0;
  };

  // Announcements without replies, where replies are off, need no section at all.
  if (topic.isAnnouncement && !topic.canReply && count === 0) return null;

  const topicComposer = (open: boolean) =>
    open ? (
      <Card padding="md">
        <Composer
          label={gated ? t('discussionDetail.yourReply') : t('discussionDetail.replyToPost')}
          placeholder={t('discussionDetail.writeReply')}
          submitLabel={t('discussionDetail.postReply')}
          context={context}
          topicId={topic.id}
          canAttach={topic.canAttach}
          canPostAnonymously={canPostAnonymously}
          fullyAnonymous={fullyAnonymous}
          submitting={submitting}
          error={error}
          autoFocus={!gated}
          onSubmit={(draft) => onReply(null, draft)}
          onCancel={gated ? undefined : () => setTarget(null)}
          scrollViewRef={scrollViewRef}
        />
      </Card>
    ) : (
      <View className="gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('discussionDetail.writeReply')}
          onPress={() => setTarget({ kind: 'reply', parentId: null })}
          className="min-h-12 justify-center rounded-xl bg-surface-sunken px-3.5 active:opacity-70"
          style={{ borderCurve: 'continuous' }}
        >
          <Text variant="body" tone="subtle">
            {t('discussionDetail.writeReply')}
          </Text>
        </Pressable>
        {fullyAnonymous ? null : <MentionHint />}
      </View>
    );

  const showTools = !gated && !!visible && entries.length > 0;
  const searching = search.trim().length > 0;

  return (
    <>
      {topic.checkpoints.length > 0 ? (
        <CheckpointCard
          topic={topic}
          entries={visible?.entries ?? null}
          gated={gated}
          now={now}
        />
      ) : null}
      <Section
        title={count > 0 && !gated ? t('discussionDetail.repliesCount', { number: number(count) }) : t('discussionDetail.replies')}
        action={
          !gated && unread.length > 0 && !markingAll
            ? { label: t('discussionDetail.markAllRead'), onPress: () => onMarkAllRead(unread) }
            : undefined
        }
      >
        {!gated && unread.length > 0 ? (
          <Text variant="footnote" tone="muted" className="-mt-1 px-1">
            {unseen.length > 0
              ? t('discussionDetail.unread', countParams(unseen.length))
              : t('discussionDetail.newSince', countParams(unread.length))}
          </Text>
        ) : null}

        {topic.locked && !topic.isAnnouncement ? (
          <Callout tone="info" icon={Lock}>
            {t('discussionDetail.closed')}
          </Callout>
        ) : null}

        {gated ? (
          <>
            <Callout tone="info" icon={EyeOff} title={t('discussionDetail.gateTitle')}>
              {t('discussionDetail.gateBody', {
                status: count > 0
                  ? t('discussionDetail.waiting', countParams(count))
                  : t('discussionDetail.noOneReplied'),
              })}
            </Callout>
            {topic.canReply ? topicComposer(true) : null}
          </>
        ) : (
          <>
            {topic.canReply ? topicComposer(replyingToTopic) : null}

            {showTools ? (
              <View className="gap-3">
                {count > 2 ? (
                  <SearchField value={search} onChangeText={setSearch} placeholder={t('discussionDetail.search')} />
                ) : null}
                {!searching && entries.length > 1 && !topic.sortOrderLocked ? (
                  <SegmentedControl
                    options={sortOptions}
                    value={sort}
                    onChange={setSort}
                    accessibilityLabel={t('discussionDetail.sort')}
                  />
                ) : null}
              </View>
            ) : null}

            {thread.isPending ? (
              <Card className="gap-3">
                <View className="flex-row items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-4 w-1/3" />
                </View>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </Card>
            ) : thread.isError && !visible ? (
              <Callout
                tone="danger"
                title={t('discussionDetail.repliesError')}
                action={{ label: t('common.retry'), onPress: () => thread.refetch() }}
              >
                {discussionErrorMessage(thread.error, t)}
              </Callout>
            ) : entries.length === 0 ? (
              <Card variant="outlined" padding="none">
                <EmptyState
                  icon={MessageSquare}
                  title={t('discussionDetail.empty')}
                  description={topic.canReply ? t('discussionDetail.emptyHelp') : undefined}
                  className="py-8"
                />
              </Card>
            ) : (
              <ThreadProvider
                value={{
                  target,
                  setTarget,
                  canReply: topic.canReply,
                  threaded: topic.threaded,
                  canLike: topic.allowRating && !topic.onlyGradersCanRate,
                  canAttach: topic.canAttach,
                  canManage,
                  submitting,
                  error,
                  reply: onReply,
                  edit: onEdit,
                  remove: onDelete,
                  like: onLike,
                  markUnread: onMarkUnread,
                  registerUnread,
                  onLayoutChange,
                  context,
                  courseId: topic.courseId,
                  canPostAnonymously,
                  fullyAnonymous,
                  topicId: topic.id,
                  userId: account.user.id,
                  now,
                  scrollViewRef,
                }}
              >
                {searching ? (
                  <SearchResults results={results} term={search} />
                ) : (
                  <ThreadList entries={entries} />
                )}
              </ThreadProvider>
            )}
          </>
        )}
      </Section>
    </>
  );
}
