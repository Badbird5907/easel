import { router, Stack, useLocalSearchParams, usePreventRemove, useIsFocused } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { type ComponentRef, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';

import {
  type ConversationDetail,
  type Recipient,
  signatureBlock,
  useAddMessage,
  useConversation,
  useCreateConversation,
  useInboxSignature,
} from '@/canvas/api/conversations';
import { useDashboardCourses } from '@/canvas/api/courses';
import { useCanvas } from '@/canvas/session';
import {
  AccentScope,
  Button,
  Callout,
  Chip,
  ListGroup,
  ListItem,
  Screen,
  Skeleton,
  Switch,
  Text,
  TextField,
} from '@/design';
import {
  AttachButton,
  AttachmentStatus,
  PendingAttachmentList,
  useAttachmentUploads,
} from '@/features/inbox/attachments';
import { useTranslation } from '@/i18n';
import { useComposeBoundary, useComposeOwner } from '@/features/inbox/composeOwnership';
import type { ComposeRecipient } from '@/features/inbox/composePresentation';
import { MessageCard } from '@/features/inbox/MessageCard';
import { OptionsSheet } from '@/features/inbox/OptionsSheet';
import { RecipientPicker, RecipientPill } from '@/features/inbox/RecipientPicker';

type Mode = 'new' | 'reply' | 'replyAll' | 'forward';

const titles = {
  new: 'inboxCompose.new',
  reply: 'inboxCompose.reply',
  replyAll: 'inboxCompose.replyAll',
  forward: 'inboxCompose.forward',
} as const;

type Params = {
  mode?: string;
  conversationId?: string;
  messageId?: string;
  /** Prefill for new messages, e.g. from a course or a person's profile. */
  courseId?: string;
  /** Comma-separated user IDs and names, in the same order. */
  recipientIds?: string;
  recipientNames?: string;
  subject?: string;
};

/** Who a reply goes to: the message's author, or everyone it reached for reply all. */
function replyRecipients(c: ConversationDetail, mode: Mode, messageId: string | undefined, userId: string) {
  if (mode === 'forward') return [];
  const message = messageId
    ? c.messages.find((m) => m.id === messageId)
    : (c.messages.find((m) => m.authorId !== userId && !m.generated) ?? c.messages[0]);
  let ids: string[];
  if (mode === 'reply' && message && message.authorId !== userId) ids = [message.authorId];
  else ids = (message?.participantIds ?? []).filter((id) => id !== userId);
  if (ids.length === 0) ids = c.audience.map((p) => p.id);
  const people = new Map(c.participants.map((p) => [p.id, p]));
  return ids
    .map((id) => people.get(id))
    .filter((p) => !!p)
    .map((p): Recipient => ({
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      kind: 'user',
      roles: [],
      userCount: null,
    }));
}

function prefilled(params: Params): ComposeRecipient[] {
  const ids = params.recipientIds?.split(',').filter(Boolean) ?? [];
  const names = params.recipientNames?.split(',') ?? [];
  return ids.map((id, i): ComposeRecipient => ({
    id,
    name: names[i]?.trim() || 'Unknown',
    ...(!names[i]?.trim() && { composeNameOrigin: 'missing-prefill' as const }),
    avatarUrl: null,
    kind: 'user',
    roles: [],
    userCount: null,
  }));
}

/**
 * New messages (INBOX-3), and reply, reply all, and forward for an existing
 * conversation (INBOX-2). Presented as a modal.
 */
export default function ComposeScreen() {
  const params = useLocalSearchParams<Params>();
  const identity = JSON.stringify([
    params.mode,
    params.conversationId,
    params.messageId,
    params.courseId,
    params.recipientIds,
    params.recipientNames,
    params.subject,
  ]);
  const key = useComposeBoundary(identity);
  return <Composer key={key} params={params} />;
}

function Composer({ params }: { params: Params }) {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const mode: Mode =
    params.mode && Object.prototype.hasOwnProperty.call(titles, params.mode) ? (params.mode as Mode) : 'new';
  const isNew = mode === 'new';
  const { account } = useCanvas();
  const userId = account.user.id;
  const courses = useDashboardCourses();
  const conversation = useConversation(isNew ? undefined : params.conversationId);
  const create = useCreateConversation();
  const addMessage = useAddMessage();
  // Canvas leaves the signature to the client (INBOX-7): added on send, when it's turned on.
  const signature = signatureBlock(useInboxSignature().data);
  const [withSignature, setWithSignature] = useState(true);

  const [chosenCourseId, setCourseId] = useState<string | null>(params.courseId ?? null);
  const [chosenRecipients, setRecipients] = useState<Recipient[] | null>(isNew ? prefilled(params) : null);
  const [subject, setSubject] = useState(params.subject ?? '');
  const [body, setBody] = useState('');
  const [individually, setIndividually] = useState(false);
  const [picking, setPicking] = useState(isNew && !params.recipientIds && !!params.courseId);
  const [choosingCourse, setChoosingCourse] = useState(false);
  const courseTrigger = useRef<ComponentRef<typeof View>>(null);
  const recipientsTrigger = useRef<ComponentRef<typeof View>>(null);
  const [coursePickerSource, setCoursePickerSource] = useState<'course' | 'recipients'>('course');
  const openCoursePicker = (source: 'course' | 'recipients') => {
    if (!owner.read()) return;
    setCoursePickerSource(source);
    setChoosingCourse(true);
  };
  // Set once the message is sent or the draft discarded, so leaving isn't blocked.
  const [leaving, setLeaving] = useState(false);

  const c = conversation.data;
  const courseId = isNew ? chosenCourseId : (c?.courseId ?? null);
  const course = courseId ? courses.data?.find((x) => x.id === courseId) : undefined;
  const recipients = chosenRecipients ?? (c ? replyRecipients(c, mode, params.messageId, userId) : []);
  const forwarded =
    mode === 'forward' && c ? c.messages.filter((m) => !params.messageId || m.id === params.messageId) : [];

  const eligible =
    focused &&
    (isNew
      ? !courses.isError && !courses.isPending && !courses.isPlaceholderData && !!course
      : !conversation.isError &&
        !conversation.isPending &&
        !conversation.isPlaceholderData &&
        c?.id === params.conversationId &&
        c?.canReply === true &&
        (!params.messageId || c.messages.some((m) => m.id === params.messageId)));
  // Canvas keeps message attachments in the student's "conversation attachments" folder.
  const uploads = useAttachmentUploads({
    folderPath: 'conversation attachments',
    owner: {
      resource: JSON.stringify([courseId, mode, params.conversationId, params.messageId]),
      focused,
      eligible: eligible && !leaving && !create.isPending && !addMessage.isPending,
    },
  });
  // The hook's reset invalidates pending picker/upload continuations. Capture its
  // mount-local reset once: locale renders must not clear attachments.
  const [resetUploads] = useState(() => uploads.reset);
  useLayoutEffect(() => resetUploads, [resetUploads]);
  const owner = useComposeOwner(
    JSON.stringify([courseId, mode, params.conversationId, params.messageId, eligible]),
    {
      recipients,
      subject,
      body,
      signature,
      withSignature,
      individually,
      uploads,
      c,
      forwarded,
      create,
      addMessage,
      courseId,
      eligible,
      leaving,
      picking,
      courses,
      conversation,
    },
    focused,
  );
  // Child sheets may retain callbacks; only this committed composer can adopt files.
  const ownedUploads: typeof uploads = {
    ...uploads,
    pick: async (source) => {
      await owner.read()?.uploads.pick(source);
    },
    add: (files) => {
      owner.read()?.uploads.add(files);
    },
    remove: (key) => {
      owner.read()?.uploads.remove(key);
    },
    retry: (key) => {
      owner.read()?.uploads.retry(key);
    },
    reset: () => {
      owner.read()?.uploads.reset();
    },
    seed: (files) => {
      owner.read()?.uploads.seed(files);
    },
  };
  const [operation, setOperation] = useState<{
    owner: typeof owner;
    pending: boolean;
    error?: string;
  } | null>(null);
  const sending =
    (operation?.owner === owner && operation.pending) || create.isPending || addMessage.isPending;
  const error = operation?.owner === owner ? operation.error : undefined;
  const attachmentsReady = !uploads.uploading && !uploads.failed;
  const canSend =
    eligible &&
    !leaving &&
    !sending &&
    attachmentsReady &&
    recipients.length > 0 &&
    body.trim().length > 0 &&
    (isNew ? !!courseId : !!c);
  // A role, section, or group reaches several people, so it can be split too.
  const canSendIndividually =
    isNew && (recipients.length > 1 || recipients.some((r) => r.kind === 'context'));

  // Swiping the sheet away or tapping Cancel asks before throwing away a draft.
  const dirty =
    !leaving && (body.trim().length > 0 || uploads.items.length > 0 || (isNew && subject.trim().length > 0));
  const discardOwner = useComposeOwner(
    JSON.stringify([subject, body, uploads.items, recipients, withSignature, individually]),
    {},
    focused,
  );
  const allowLeave = usePreventRemove(dirty, ({ repeat }) => {
    const current = owner.read();
    if (!current || current.leaving) return;
    const valid = owner.lease();
    const validDraft = discardOwner.lease();
    // Editing after a prompt requires a new confirmation, including attachment changes.
    const draft = JSON.stringify([
      current.subject,
      current.body,
      current.uploads.items,
      current.recipients,
      current.withSignature,
      current.individually,
    ]);
    let answered = false;
    Alert.alert(
      t('inboxCompose.discardTitle'),
      t('inboxCompose.discardBody'),
      [
        {
          text: t('inboxCompose.keepEditing'),
          style: 'cancel',
          onPress: () => {
            answered = true;
          },
        },
        {
          text: t('inboxCompose.discard'),
          style: 'destructive',
          onPress: () => {
            const latest = owner.read();
            if (
              answered ||
              !valid() ||
              !validDraft() ||
              !latest ||
              latest.leaving ||
              draft !==
                JSON.stringify([
                  latest.subject,
                  latest.body,
                  latest.uploads.items,
                  latest.recipients,
                  latest.withSignature,
                  latest.individually,
                ])
            )
              return;
            answered = true;
            owner.complete();
            setLeaving(true);
            repeat();
          },
        },
      ],
      {
        onDismiss: () => {
          answered = true;
        },
      },
    );
  });

  const send = async () => {
    const current = owner.read();
    if (
      !current ||
      !current.eligible ||
      current.leaving ||
      current.uploads.uploading ||
      current.uploads.failed ||
      current.create.isPending ||
      current.addMessage.isPending ||
      !current.recipients.length ||
      !current.body.trim()
    )
      return;
    const token = owner.claim();
    if (!token) return;
    setOperation({ owner, pending: true });
    const ids = current.recipients.map((r) => r.id);
    const attachmentIds = current.uploads.files.map((f) => f.id);
    const text = `${current.body.trim()}${current.signature && current.withSignature ? current.signature : ''}`;
    try {
      if (isNew) {
        await current.create.mutateAsync({
          courseId: current.courseId!,
          subject: current.subject.trim(),
          body: text,
          recipients: ids,
          attachmentIds,
          individually:
            current.individually &&
            (current.recipients.length > 1 || current.recipients.some((r) => r.kind === 'context')),
        });
      } else {
        await current.addMessage.mutateAsync({
          id: current.c!.id,
          body: text,
          recipients: ids,
          attachmentIds,
          includedMessages: mode === 'forward' ? current.forwarded.map((m) => m.id) : undefined,
        });
      }
      if (!owner.owns(token)) return;
      owner.complete();
      setLeaving(true);
      allowLeave();
      router.back();
    } catch (error) {
      if (owner.owns(token))
        setOperation({
          owner,
          pending: false,
          error:
            error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
              ? error.message
              : typeof error === 'string'
                ? error
                : '',
        });
    } finally {
      owner.release(token);
    }
  };

  const chooseCourse = (id: string) => {
    const current = owner.read();
    if (
      !current ||
      !isNew ||
      current.courses.isError ||
      current.courses.isPending ||
      !current.courses.data?.some((x) => x.id === id) ||
      id === current.courseId
    )
      return;
    setCourseId(id);
    setRecipients([]);
    setPicking(true);
  };

  const people = new Map((c?.participants ?? []).map((p) => [p.id, p]));

  return (
    <AccentScope color={course?.color} className="flex-1">
      <Stack.Screen
        options={{
          presentation: 'modal',
          title: t(titles[mode]),
          ...(Platform.OS === 'ios' && {
            headerLeft: () => (
              <Pressable
                accessibilityRole="button"
                hitSlop={12}
                onPress={() => {
                  if (owner.read()) router.back();
                }}
              >
                <Text variant="body" tone="accent">
                  {t('inboxCompose.cancel')}
                </Text>
              </Pressable>
            ),
          }),
          // The header sits outside this screen's accent scope, so the button carries its own.
          headerRight: () => (
            <AccentScope color={course?.color}>
              <Button size="sm" disabled={!canSend} loading={sending} onPress={send} className="me-2">
                {t('inboxCompose.send')}
              </Button>
            </AccentScope>
          ),
        }}
      />
      <Screen automaticallyAdjustKeyboardInsets contentClassName="gap-5">
        {error !== undefined ? (
          <Callout tone="danger" title={t('inboxCompose.sendError')}>
            {error}
          </Callout>
        ) : null}

        {!isNew && conversation.isPending ? (
          <Skeleton className="h-24 rounded-2xl" />
        ) : !isNew && conversation.isError ? (
          <Callout
            tone="danger"
            title={t('inboxCompose.loadError')}
            action={{
              label: t('inboxCompose.retry'),
              onPress: () => {
                const current = owner.read();
                if (current) void current.conversation.refetch().catch(() => {});
              },
            }}
          >
            {conversation.error.message}
          </Callout>
        ) : (
          <>
            <ListGroup>
              <ListItem
                ref={courseTrigger}
                title={t('inboxCompose.course')}
                value={course?.code ?? c?.contextName ?? (isNew ? t('inboxCompose.choose') : undefined)}
                accessibilityLabel={t('inboxCompose.courseLabel', {
                  name: course?.name ?? c?.contextName ?? t('inboxCompose.notChosen'),
                })}
                onPress={isNew ? () => openCoursePicker('course') : undefined}
                chevron={isNew}
              />
              {!isNew ? (
                <ListItem
                  title={t('inboxCompose.subject')}
                  value={c?.subject || t('inboxCompose.noSubject')}
                />
              ) : null}
            </ListGroup>

            <View className="gap-2">
              <Text variant="subhead" weight="medium" tone="muted" className="px-1">
                {t('inboxCompose.to')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {recipients.map((r) => (
                  <RecipientPill
                    key={r.id}
                    recipient={r}
                    onRemove={() => {
                      const current = owner.read();
                      if (current)
                        setRecipients((previous) =>
                          (previous ?? current.recipients).filter((x) => x.id !== r.id),
                        );
                    }}
                  />
                ))}
                <Chip
                  ref={recipientsTrigger}
                  icon={picking ? undefined : Plus}
                  selected={picking}
                  accessibilityLabel={picking ? t('inboxCompose.doneChoosing') : undefined}
                  onPress={() => {
                    if (owner.read()) {
                      if (courseId) setPicking((p) => !p);
                      else openCoursePicker('recipients');
                    }
                  }}
                >
                  {picking
                    ? t('inboxCompose.done')
                    : recipients.length
                      ? t('inboxCompose.addPeople')
                      : t('inboxCompose.choosePeople')}
                </Chip>
              </View>
              {picking && courseId ? (
                <RecipientPicker
                  key={courseId}
                  courseId={courseId}
                  courseCode={course?.code ?? t('inboxCompose.thisCourse')}
                  selected={recipients}
                  onChange={(next) => {
                    if (owner.read()?.picking) setRecipients(next);
                  }}
                  userId={userId}
                />
              ) : null}
            </View>

            {isNew ? (
              <TextField
                label={t('inboxCompose.subject')}
                value={subject}
                onChangeText={(value) => {
                  if (owner.read()) setSubject(value);
                }}
                maxLength={255}
              />
            ) : null}
            <TextField
              label={t('inboxCompose.message')}
              multiline
              value={body}
              onChangeText={(value) => {
                if (owner.read()) setBody(value);
              }}
              autoFocus={!isNew}
              textAlignVertical="top"
            />

            {signature ? (
              <ListGroup footer={t('inboxCompose.signatureHelp')}>
                <ListItem
                  title={t('inboxCompose.signature')}
                  subtitle={signature.replace(/^\n\n---\n/, '')}
                  subtitleLines={3}
                  chevron={false}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: withSignature }}
                  onPress={() => {
                    if (owner.read()) setWithSignature((value) => !value);
                  }}
                  trailing={
                    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <Switch
                        value={withSignature}
                        onValueChange={(value) => {
                          if (owner.read()) setWithSignature(value);
                        }}
                      />
                    </View>
                  }
                />
              </ListGroup>
            ) : null}

            <View className="gap-3">
              <PendingAttachmentList uploads={ownedUploads} />
              <AttachButton
                uploads={ownedUploads}
                label={uploads.items.length ? t('inboxCompose.attachAnother') : t('inboxCompose.attach')}
                disabled={sending}
                media
              />
              <AttachmentStatus uploads={ownedUploads} />
            </View>

            {canSendIndividually ? (
              <ListGroup footer={t('inboxCompose.individualHelp')}>
                <ListItem
                  title={t('inboxCompose.individually')}
                  trailing={
                    <Switch
                      value={individually}
                      onValueChange={(value) => {
                        if (owner.read()) setIndividually(value);
                      }}
                      accessibilityLabel={t('inboxCompose.individually')}
                    />
                  }
                  chevron={false}
                />
              </ListGroup>
            ) : null}

            {forwarded.length > 0 && c ? (
              <View className="gap-3">
                <Text variant="subhead" weight="medium" tone="muted" className="px-1">
                  {t('inboxCompose.forwarding', { count: forwarded.length })}
                </Text>
                {forwarded.map((m) => (
                  <MessageCard
                    key={m.id}
                    message={m}
                    people={people}
                    userId={userId}
                    courseId={c.courseId}
                    now={new Date()}
                    canReply={false}
                  />
                ))}
              </View>
            ) : null}
          </>
        )}
      </Screen>

      <OptionsSheet
        visible={choosingCourse}
        returnFocusRef={coursePickerSource === 'course' ? courseTrigger : recipientsTrigger}
        onClose={() => {
          if (owner.read()) setChoosingCourse(false);
        }}
        title={t('inboxCompose.coursePicker')}
        options={(courses.data ?? []).map((x) => ({
          key: x.id,
          label: x.code,
          subtitle: x.name,
          color: x.color,
          selected: x.id === courseId,
          onPress: () => chooseCourse(x.id),
        }))}
      />
    </AccentScope>
  );
}
