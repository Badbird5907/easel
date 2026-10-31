import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Inbox, SquarePen } from 'lucide-react-native';
import { type ComponentRef, type RefObject, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { type Conversation, type ConversationScope, useConversations } from '@/canvas/api/conversations';
import { useDashboardCourses } from '@/canvas/api/courses';
import { useAccountKey } from '@/canvas/query';
import {
  Callout,
  Chip,
  EmptyState,
  IconButton,
  Screen,
  SearchField,
  Skeleton,
  Text,
  useTheme,
} from '@/design';
import { useConversationActions } from '@/features/inbox/actions';
import { ConversationList, ConversationRow } from '@/features/inbox/ConversationRow';
import { MenuChip } from '@/features/inbox/OptionsSheet';
import { SubmissionCommentList } from '@/features/inbox/SubmissionComments';

import { BrowsingOptionsSheet as OptionsSheet } from '@/features/inbox/browsingOptionsSheet';
import {
  onceWhile,
  useBrowsingOwner,
  useBrowsingMenu,
  useBrowsingRefresh,
} from '@/features/inbox/browsingLifetime';
import { useTranslation } from '@/i18n';

/** Conversation scopes, plus the web inbox's "Submission comments" view (INBOX-8). */
type InboxScope = ConversationScope | 'submission_comments';

const scopeValues = ['inbox', 'unread', 'starred', 'sent', 'archived', 'submission_comments'] as const;

function matches(c: Conversation, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [c.subject, c.lastMessage, c.contextName ?? '', ...c.participants.map((p) => p.name)].some((s) =>
    s.toLowerCase().includes(q),
  );
}

/** Conversations by scope and course (INBOX-1), with per-conversation actions (INBOX-6). */
export default function InboxScreen() {
  const { t } = useTranslation();
  const scopes = scopeValues.map((value) => {
    const key = value === 'submission_comments' ? 'comments' : value;
    return {
      value,
      label: t(`inboxBrowse.${value}`),
      empty: t(`inboxBrowse.${key}Empty`),
      description: t(`inboxBrowse.${key}Description`),
    };
  });
  const { colors } = useTheme();
  const [scope, setScope] = useState<InboxScope>('inbox');
  const comments = scope === 'submission_comments';
  const [courseId, setCourseId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [menuFor, setMenuFor] = useState<Conversation | null>(null);
  const courseTrigger = useRef<ComponentRef<typeof View>>(null);
  const [menuTrigger, setMenuTrigger] = useState<RefObject<ComponentRef<typeof View> | null>>();
  const menuLife = useBrowsingMenu(JSON.stringify([scope, courseId, query]));
  const pickerLife = useBrowsingMenu(JSON.stringify([scope, courseId, query]));
  const courses = useDashboardCourses();
  const conversations = useConversations(comments ? 'inbox' : scope, courseId, !comments);
  const actionsFor = useConversationActions();
  const now = new Date();

  const courseFor = (id: string | null) => (id ? courses.data?.find((c) => c.id === id) : undefined);
  const selectedCourse = courseFor(courseId);
  const active = scopes.find((s) => s.value === scope) ?? scopes[0];
  const visible = (conversations.data ?? []).filter((c) => matches(c, query));

  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  const owner = useBrowsingOwner(JSON.stringify([scope, courseId, query]), { conversations, courses });
  const { refreshing, refresh } = useBrowsingRefresh(owner, () =>
    comments
      ? queryClient.refetchQueries({ queryKey: [accountKey, 'inbox', 'submission-comments'] })
      : conversations.refetch(),
  );
  const menuCurrent = () => owner.live && !!menuLife.session?.live;
  const currentConversation = (id: string) =>
    owner.value.conversations.isError ? undefined : owner.value.conversations.data?.find((c) => c.id === id);
  const menuConversation =
    menuFor && !conversations.isError ? conversations.data?.find((c) => c.id === menuFor.id) : undefined;
  const pickerCurrent = () => owner.live && !!pickerLife.session?.live;

  return (
    <Screen
      title={t('inboxBrowse.inbox')}
      titleAccessory={
        <IconButton
          icon={SquarePen}
          variant="secondary"
          accessibilityLabel={t('inboxBrowse.newMessage')}
          onPress={onceWhile(
            () => owner.live,
            () => router.push({ pathname: '/compose', params: courseId ? { courseId } : {} } as never),
          )}
        />
      }
      contentClassName="gap-4"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
      }
    >
      <SearchField
        value={query}
        onChangeText={(value) => {
          if (owner.live) setQuery(value);
        }}
        placeholder={t(comments ? 'inboxBrowse.searchComments' : 'inboxBrowse.searchMessages')}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="-mx-4"
        contentContainerClassName="items-center gap-2 px-4"
      >
        <MenuChip
          ref={courseTrigger}
          label={selectedCourse?.code ?? t('inboxBrowse.allCourses')}
          accessibilityLabel={t('inboxBrowse.courseFilter')}
          active={!!selectedCourse}
          color={selectedCourse?.color}
          onPress={() => {
            if (owner.live) {
              pickerLife.open();
              setPicking(true);
            }
          }}
        />
        <View className="mx-1 h-5 bg-border-strong" style={{ width: StyleSheet.hairlineWidth }} />
        {scopes.map((s) => (
          <Chip
            key={s.value}
            selected={scope === s.value}
            onPress={() => {
              if (owner.live) setScope(s.value);
            }}
          >
            {s.label}
          </Chip>
        ))}
      </ScrollView>

      {comments ? (
        <SubmissionCommentList courseId={courseId} courseFor={courseFor} query={query} now={now} />
      ) : conversations.isPending ? (
        <View className="gap-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </View>
      ) : conversations.isError ? (
        <Callout
          tone="danger"
          title={t('inboxBrowse.loadMessagesError')}
          action={{ label: t('inboxBrowse.retry'), onPress: refresh }}
        >
          {conversations.error.message}
        </Callout>
      ) : visible.length === 0 ? (
        query.trim() ? (
          <Text variant="subhead" tone="muted" align="center" className="py-8">
            {t('inboxBrowse.noMatches', { query: query.trim() })}
          </Text>
        ) : (
          <EmptyState
            icon={Inbox}
            title={
              selectedCourse
                ? t('inboxBrowse.courseEmpty', { empty: active.empty, course: selectedCourse.code })
                : active.empty
            }
            description={active.description}
          />
        )
      ) : (
        <ConversationList>
          {visible.map((c) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              course={courseId ? undefined : courseFor(c.courseId)}
              sent={scope === 'sent'}
              now={now}
              onPress={onceWhile(
                () => owner.live && !!currentConversation(c.id),
                () =>
                  router.push({
                    pathname: '/conversation/[conversationId]',
                    params: { conversationId: c.id },
                  } as never),
              )}
              onLongPress={(trigger) => {
                if (!owner.live || !currentConversation(c.id)) return;
                menuLife.open();
                setMenuTrigger(trigger);
                setMenuFor(c);
              }}
            />
          ))}
        </ConversationList>
      )}

      <OptionsSheet
        visible={picking && !!pickerLife.session}
        returnFocusRef={courseTrigger}
        onClose={(selected) => {
          if (pickerLife.close(selected)) setPicking(false);
        }}
        title={t('inboxBrowse.showFrom')}
        options={[
          {
            key: 'all',
            label: t('inboxBrowse.allCourses'),
            selected: courseId === null,
            onPress: onceWhile(pickerCurrent, () => setCourseId(null)),
          },
          ...(courses.data ?? []).map((course) => ({
            key: course.id,
            label: course.code,
            subtitle: course.name,
            color: course.color,
            selected: courseId === course.id,
            onPress: onceWhile(
              () => pickerCurrent() && !!owner.value.courses.data?.some((c) => c.id === course.id),
              () => setCourseId(course.id),
            ),
          })),
        ]}
      />
      <OptionsSheet
        visible={!!menuFor && !!menuLife.session}
        returnFocusRef={menuTrigger}
        onClose={(selected) => {
          if (menuLife.close(selected)) setMenuFor(null);
        }}
        title={menuConversation?.subject || t('inboxBrowse.noSubject')}
        options={
          menuConversation
            ? actionsFor(menuConversation, {
                isCurrent: menuCurrent,
                getCurrent: () => currentConversation(menuConversation.id),
              })
            : []
        }
      />
    </Screen>
  );
}
