import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ellipsis, Forward, Reply, ReplyAll, Star, Trash2 } from 'lucide-react-native';
import { type ComponentRef, type RefObject, useRef, useState } from 'react';
import { Alert, RefreshControl, View } from 'react-native';

import {
  type ConversationDetail,
  type ConversationMessage,
  useConversation,
  useRemoveMessages,
} from '@/canvas/api/conversations';
import { useDashboardCourses } from '@/canvas/api/courses';
import { useCanvas } from '@/canvas/session';
import { Button, Callout, Card, IconButton, Screen, Skeleton, Text, useTheme } from '@/design';
import { useConversationActions } from '@/features/inbox/actions';
import { MessageCard } from '@/features/inbox/MessageCard';
import {
  BrowsingOptionsSheet as OptionsSheet,
  type SheetOption,
} from '@/features/inbox/browsingOptionsSheet';
import {
  onceWhile,
  useBrowsingOwner,
  useBrowsingRefresh,
  useBrowsingMenu,
} from '@/features/inbox/browsingLifetime';
import { useBrowsingPresentation } from '@/features/inbox/browsingPresentation';

type ComposeMode = 'reply' | 'replyAll' | 'forward';

function compose(conversationId: string, mode: ComposeMode, messageId?: string) {
  router.push({
    pathname: '/compose',
    params: { mode, conversationId, ...(messageId && { messageId }) },
  } as never);
}

/** A conversation's messages, newest first, with reply, reply all, and forward (INBOX-2). */
export default function ConversationScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { account } = useCanvas();
  const { colors } = useTheme();
  const conversation = useConversation(conversationId);
  const courses = useDashboardCourses();
  const presentation = useBrowsingPresentation();
  const { t } = presentation;
  const removeMessages = useRemoveMessages();
  const actionsFor = useConversationActions();
  const [menu, setMenu] = useState<'conversation' | ConversationMessage | null>(null);
  const conversationTrigger = useRef<ComponentRef<typeof View>>(null);
  const [menuTrigger, setMenuTrigger] = useState<RefObject<ComponentRef<typeof View> | null>>();
  const menuLife = useBrowsingMenu(conversationId);
  const now = new Date();

  const c = conversation.data;
  const course = c?.courseId ? courses.data?.find((x) => x.id === c.courseId) : undefined;
  const people = new Map((c?.participants ?? []).map((p) => [p.id, p]));
  const userId = account.user.id;

  const owner = useBrowsingOwner(conversationId, { c, error: conversation.isError, t });
  const current = () => owner.live;
  const getCurrent = () =>
    current() && !owner.value.error && owner.value.c?.id === conversationId ? owner.value.c : undefined;
  const menuCurrent = () => current() && !!menuLife.session?.live;
  const { refreshing, refresh } = useBrowsingRefresh(owner, () => conversation.refetch());
  const canCompose = (mode: ComposeMode, messageId?: string) => {
    const latest = getCurrent();
    const message = messageId ? latest?.messages.find((m) => m.id === messageId) : undefined;
    if (!latest || (messageId && (!message || message.generated))) return false;
    if (mode === 'reply' && message?.authorId === userId) return false;
    return mode === 'forward' || (latest.canReply && (mode !== 'replyAll' || latest.audience.length > 1));
  };
  const goCompose = (mode: ComposeMode, messageId?: string, fromMenu = false) =>
    onceWhile(
      () => (!fromMenu || menuCurrent()) && canCompose(mode, messageId),
      () => compose(conversationId, mode, messageId),
    );

  const messageOptions = (detail: ConversationDetail, m: ConversationMessage): SheetOption[] => {
    const eligible = () =>
      menuCurrent() && !!getCurrent()?.messages.some((message) => message.id === m.id && !message.generated);
    return [
      ...(detail.canReply && m.authorId !== userId
        ? [
            {
              key: 'reply',
              label: t('inboxBrowse.reply'),
              icon: Reply,
              onPress: goCompose('reply', m.id, true),
            },
          ]
        : []),
      ...(detail.canReply && detail.audience.length > 1
        ? [
            {
              key: 'all',
              label: t('inboxBrowse.replyAll'),
              icon: ReplyAll,
              onPress: goCompose('replyAll', m.id, true),
            },
          ]
        : []),
      {
        key: 'forward',
        label: t('inboxBrowse.forward'),
        icon: Forward,
        onPress: goCompose('forward', m.id, true),
      },
      {
        key: 'delete',
        label: t('inboxBrowse.deleteMessage'),
        icon: Trash2,
        destructive: true,
        onPress: onceWhile(eligible, () => {
          const key = `delete:${m.id}`;
          if (owner.claims.has(key)) return;
          owner.claims.add(key);
          let answered = false;
          const cancel = () => {
            if (answered) return;
            answered = true;
            owner.claims.delete(key);
          };
          Alert.alert(
            owner.value.t('inboxBrowse.deleteMessageTitle'),
            owner.value.t('inboxBrowse.deleteMessageBody'),
            [
              { text: owner.value.t('inboxBrowse.cancel'), style: 'cancel', onPress: cancel },
              {
                text: owner.value.t('inboxBrowse.delete'),
                style: 'destructive',
                onPress: () => {
                  if (answered) return;
                  answered = true;
                  if (!eligible()) {
                    owner.claims.delete(key);
                    return;
                  }
                  const last = owner.value.c!.messages.length <= 1;
                  removeMessages.mutate(
                    { id: detail.id, messageIds: [m.id] },
                    {
                      onSuccess: () => {
                        // A refetch can already have removed this message. Only navigate if no replacement messages appeared.
                        if (
                          menuCurrent() &&
                          last &&
                          !owner.value.c?.messages.some((message) => message.id !== m.id)
                        )
                          router.back();
                      },
                      onError: (error) => {
                        if (menuCurrent())
                          Alert.alert(owner.value.t('inboxBrowse.deleteMessageError'), error.message);
                      },
                      onSettled: () => {
                        owner.claims.delete(key);
                      },
                    },
                  );
                },
              },
            ],
            { onDismiss: cancel },
          );
        }),
      },
    ];
  };

  const sheetOptions: SheetOption[] = !c
    ? []
    : menu === 'conversation'
      ? [
          {
            key: 'forward',
            label: t('inboxBrowse.forward'),
            icon: Forward,
            onPress: goCompose('forward', undefined, true),
          },
          ...actionsFor(c, {
            onDeleted: () => router.back(),
            onMarkedUnread: () => router.back(),
            isCurrent: menuCurrent,
            getCurrent,
          }),
        ]
      : menu
        ? c.messages.some((m) => m.id === menu.id)
          ? messageOptions(c, menu)
          : []
        : [];

  return (
    <>
      <Stack.Screen
        options={{
          title: c?.contextName ?? t('inboxBrowse.message'),
          headerRight: () =>
            c ? (
              <View className="flex-row items-center">
                <IconButton
                  icon={Star}
                  accessibilityLabel={t(c.starred ? 'inboxBrowse.unstar' : 'inboxBrowse.star')}
                  accessibilityState={{ selected: c.starred }}
                  iconColor={c.starred ? colors.warningFg : undefined}
                  onPress={actionsFor(c, { isCurrent: current, getCurrent })[0].onPress}
                />
                <IconButton
                  icon={Ellipsis}
                  ref={conversationTrigger}
                  accessibilityLabel={t('inboxBrowse.more')}
                  onPress={() => {
                    if (!current()) return;
                    menuLife.open();
                    setMenuTrigger(conversationTrigger);
                    setMenu('conversation');
                  }}
                />
              </View>
            ) : null,
        }}
      />
      <Screen
        contentClassName="gap-4"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        {conversation.isPending ? (
          <View className="gap-4">
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Card className="gap-3">
              <View className="flex-row items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-4 w-1/3" />
              </View>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </Card>
          </View>
        ) : conversation.isError ? (
          <Callout
            tone="danger"
            title={t('inboxBrowse.loadConversationError')}
            action={{ label: t('inboxBrowse.retry'), onPress: refresh }}
          >
            {conversation.error.message}
          </Callout>
        ) : (
          <>
            <View className="gap-1">
              <Text variant="title2" accessibilityRole="header">
                {conversation.data.subject || t('inboxBrowse.noSubject')}
              </Text>
              <Text variant="subhead" tone="muted">
                {[
                  t('inboxBrowse.with', { people: presentation.people(conversation.data.audience, 3) }),
                  course?.code ?? conversation.data.contextName,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>

            {conversation.data.canReply ? (
              <View className="flex-row gap-2">
                <Button variant="tonal" size="sm" leadingIcon={Reply} onPress={goCompose('reply')}>
                  {t('inboxBrowse.reply')}
                </Button>
                {conversation.data.audience.length > 1 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={ReplyAll}
                    onPress={goCompose('replyAll')}
                  >
                    {t('inboxBrowse.replyAll')}
                  </Button>
                ) : null}
                <Button variant="secondary" size="sm" leadingIcon={Forward} onPress={goCompose('forward')}>
                  {t('inboxBrowse.forward')}
                </Button>
              </View>
            ) : (
              <Callout tone="info">{t('inboxBrowse.repliesOff')}</Callout>
            )}

            {conversation.data.messages.map((m) => (
              <MessageCard
                key={m.id}
                message={m}
                people={people}
                userId={userId}
                courseId={conversation.data.courseId}
                now={now}
                canReply={conversation.data.canReply}
                onReply={goCompose('reply', m.id)}
                onMore={(trigger) => {
                  if (!canCompose('forward', m.id)) return;
                  menuLife.open();
                  setMenuTrigger(trigger);
                  setMenu(m);
                }}
              />
            ))}
          </>
        )}
      </Screen>
      <OptionsSheet
        visible={!!menu && !!menuLife.session}
        onClose={(selected) => {
          if (menuLife.close(selected)) setMenu(null);
        }}
        options={sheetOptions}
        returnFocusRef={menuTrigger}
      />
    </>
  );
}
