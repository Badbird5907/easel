import { useIsFocused } from 'expo-router';
import {
  AtSign,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  Ellipsis,
  MailOpen,
  Pencil,
  Reply,
  ThumbsUp,
  Trash2,
} from 'lucide-react-native';
import {
  type ComponentRef,
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Alert, type HostInstance, Pressable, type ScrollView, View } from 'react-native';

import {
  type DiscussionContext,
  type DiscussionEntry,
  type MentionableUser,
  useMentionableUsers,
} from '@/canvas/api/discussions';
import { type FileItem, toFileItem } from '@/canvas/api/files';
import type { CanvasAttachment } from '@/canvas/types';
import {
  Avatar,
  Button,
  Card,
  Icon,
  IconButton,
  ListGroup,
  ListItem,
  Skeleton,
  Switch,
  Text,
  useTheme,
} from '@/design';
import { RichContent } from '@/features/content/RichContent';
import { RichEditor } from '@/features/editor/RichEditor';
import { AttachmentList } from '@/features/files/AttachmentList';
import {
  AttachButton,
  AttachmentStatus,
  PendingAttachmentList,
  useAttachmentUploads,
} from '@/features/inbox/attachments';
import { OptionsSheet, type SheetOption } from '@/features/inbox/OptionsSheet';
import { cn } from '@/lib/cn';
import { useTranslation } from '@/i18n';
import { useDisplayTimeZone } from '@/lib/dates';

import { discussionPresentation } from './presentation';
import { entryAuthorName } from './threadPresentation';

import {
  applyMentions,
  boldMentions,
  insertMention,
  type Mention,
  type MentionQuery,
  mentionQuery,
  mentionsIn,
  postLines,
  projectHtml,
  visibleText,
} from './mentions';

// Tags a native Text can stand in for. Anything else (links, images, lists,
// tables, math, inline styles) goes through the shared HTML renderer.
const RICH_TAG = /<\/?(?!(?:p|br|div|span)\b)[a-z][^>]*>/i;
const STYLED = /<(?:p|div|span)\s[^>]*style=/i;

/**
 * A post body. Most replies are a few plain paragraphs; those render as native
 * text so a long thread doesn't mount a web view per reply. Mentions show as
 * names in the accent color, highlighted when they mention the student.
 */
export function EntryBody({ html, userId }: { html: string; userId?: string }) {
  if (RICH_TAG.test(html) || STYLED.test(html)) return <RichContent html={boldMentions(html)} />;
  const lines = postLines(html);
  return (
    <View className="gap-2">
      {lines.map((line, i) => (
        <Text key={i} variant="body" selectable>
          {line.map((segment, j) =>
            segment.kind === 'mention' ? (
              <Text
                key={j}
                variant="body"
                weight="semibold"
                tone="accent"
                className={segment.userId === userId ? 'bg-accent-soft' : undefined}
              >
                {segment.text}
              </Text>
            ) : (
              segment.text
            ),
          )}
        </Text>
      ))}
    </View>
  );
}

// MARK: Composer

/** What a composer sends: HTML with mentions marked up, and the attachment change. */
export type EntryDraftInput = {
  html: string;
  /** A newly attached file. */
  fileId: string | null;
  /** The post had an attachment and the student removed it. */
  removeAttachment: boolean;
  /** What the post will show, for an edit that appears before Canvas answers. */
  attachments: CanvasAttachment[];
  /** Posted without the student's name (partially anonymous topics). */
  anonymous: boolean;
};

// MARK: Header action

/** The open composer's main action, shown in the screen header while the keyboard is up. */
export type ComposerAction = { label: string; disabled: boolean; loading: boolean; submit: () => void };

type ActionHost = (owner: string, action: ComposerAction | null) => void;

const ComposerActionContext = createContext<ActionHost | null>(null);

/**
 * Lets a focused composer put its Post or Save button in the screen header, so
 * the keyboard never covers it. Pass `host` to `ComposerActionProvider` around
 * the screen's content, and render `action` with `ComposerHeaderButton`.
 */
export function useComposerActionHost() {
  const [state, setState] = useState<{ owner: string; action: ComposerAction } | null>(null);
  const host = useCallback<ActionHost>(
    (owner, action) =>
      setState((current) => (action ? { owner, action } : current?.owner === owner ? null : current)),
    [],
  );
  return { action: state?.action ?? null, host };
}

export function ComposerActionProvider({ host, children }: { host: ActionHost; children: ReactNode }) {
  return <ComposerActionContext value={host}>{children}</ComposerActionContext>;
}

/** The header copy of a composer's action. */
export function ComposerHeaderButton({ action }: { action: ComposerAction }) {
  return (
    <Button
      size="sm"
      disabled={action.disabled}
      loading={action.loading}
      onPress={action.submit}
      className="me-2"
    >
      {action.label}
    </Button>
  );
}

/** Registers the composer's action with the header while its editor has focus. */
function useHeaderAction(focused: boolean, action: ComposerAction) {
  const host = use(ComposerActionContext);
  const owner = useId();
  const submit = useRef(action.submit);
  useEffect(() => {
    submit.current = action.submit;
  });
  const { label, disabled, loading } = action;
  useEffect(() => {
    if (!host) return;
    host(owner, focused ? { label, disabled, loading, submit: () => submit.current() } : null);
  }, [host, owner, focused, label, disabled, loading]);
  useEffect(() => () => host?.(owner, null), [host, owner]);
}

function toAttachment(file: FileItem): CanvasAttachment {
  return {
    id: file.id,
    display_name: file.name,
    filename: file.filename,
    'content-type': file.contentType,
    url: file.url ?? '',
    size: file.size ?? 0,
    thumbnail_url: file.thumbnailUrl,
  };
}

/** Waits a moment after typing stops. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function MentionSuggestions({
  context,
  topicId,
  query,
  exclude,
  onPick,
}: {
  context: DiscussionContext;
  topicId: string;
  query: string;
  exclude: string[];
  onPick: (user: MentionableUser) => void;
}) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const { countParams } = discussionPresentation(locale, zone);
  const term = useDebounced(query, 200);
  const users = useMentionableUsers(context, topicId, term);
  const list = (users.data ?? []).filter((u) => !exclude.includes(u.id)).slice(0, 5);

  return (
    <View
      className="overflow-hidden rounded-xl bg-surface-sunken"
      style={{ borderCurve: 'continuous' }}
      accessibilityLabel={t('discussionThread.mentionPeople')}
    >
      {users.isPending ? (
        <View className="gap-2 p-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </View>
      ) : users.isError ? (
        <Text variant="footnote" tone="muted" className="p-3">
          {t('discussionThread.mentionError')}
        </Text>
      ) : list.length === 0 ? (
        <Text variant="footnote" tone="muted" className="p-3" accessibilityLiveRegion="polite">
          {term ? t('discussionThread.mentionNoMatches', { term }) : t('discussionThread.mentionEmpty')}
        </Text>
      ) : (
        <>
          <Text variant="footnote" tone="muted" className="sr-only" accessibilityLiveRegion="polite">
            {t('discussionThread.peopleFound', countParams(list.length))}
          </Text>
          {list.map((user) => (
            <Pressable
              key={user.id}
              accessibilityRole="button"
              accessibilityLabel={t('discussionThread.mention', { name: user.name })}
              onPress={() => onPick(user)}
              className="min-h-11 flex-row items-center gap-2.5 px-3 py-1.5 active:opacity-60"
            >
              <Avatar name={user.name} size="xs" />
              <Text variant="subhead" weight="medium" numberOfLines={1} className="flex-1">
                {user.name}
              </Text>
              {user.pronouns ? (
                <Text variant="caption" tone="subtle">
                  {user.pronouns}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </>
      )}
    </View>
  );
}

type ComposerProps = {
  label: string;
  placeholder: string;
  submitLabel: string;
  context: DiscussionContext;
  topicId: string;
  initialHtml?: string;
  initialAttachments?: CanvasAttachment[];
  /** Starts the reply with a mention, e.g. when answering deep in a thread. */
  initialMention?: Mention;
  canAttach: boolean;
  /** Partially anonymous topics: offer anonymous posting. New replies only. */
  canPostAnonymously?: boolean;
  /** Fully anonymous topics: say that the student's name is hidden. */
  fullyAnonymous?: boolean;
  submitting: boolean;
  error?: string | null;
  onSubmit: (draft: EntryDraftInput) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** The screen's scroll view, so the editor can move above the keyboard. */
  scrollViewRef?: RefObject<ComponentRef<typeof ScrollView> | null>;
};

/**
 * Writes or edits a reply (CONTENT-3): the rich editor, @-mention suggestions as
 * the student types "@", and one attachment where the course allows it.
 */
export function Composer({
  label,
  placeholder,
  submitLabel,
  context,
  topicId,
  initialHtml,
  initialAttachments = [],
  initialMention,
  canAttach,
  canPostAnonymously = false,
  fullyAnonymous = false,
  submitting,
  error,
  onSubmit,
  onCancel,
  autoFocus = true,
  scrollViewRef,
}: ComposerProps) {
  const { t } = useTranslation();
  const [html, setHtml] = useState(
    initialHtml ?? (initialMention ? `<p>@${initialMention.name.replace(/</g, '&lt;')}&nbsp;</p>` : ''),
  );
  // Editors keep mentions as plain "@Name" text; they're marked up again on send.
  const [mentions, setMentions] = useState<Mention[]>(() => [
    ...(initialMention ? [initialMention] : []),
    ...(initialHtml ? mentionsIn(initialHtml) : []),
  ]);
  const [typing, setTyping] = useState<MentionQuery | null>(null);
  const screenFocused = useIsFocused();
  const uploads = useAttachmentUploads({
    folderPath: 'unfiled', max: 1,
    owner: { resource: JSON.stringify([context.type, context.id, topicId]), focused: screenFocused, eligible: canAttach && !submitting },
  });
  const seeded = useRef(false);
  const [focused, setFocused] = useState(false);
  const [anonymous, setAnonymous] = useState(false);

  // Editing starts from the post's current file. Uploads seed once.
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (initialAttachments.length) uploads.seed(initialAttachments.map(toFileItem));
  }, [initialAttachments, uploads]);

  const change = (next: string) => {
    setTyping(mentionQuery(projectHtml(html).text, projectHtml(next).text));
    setHtml(next);
  };

  const pick = (user: MentionableUser) => {
    if (!typing) return;
    const mention = { id: user.id, name: user.shortName };
    setHtml((current) => insertMention(current, typing, mention));
    setMentions((list) => [...list.filter((m) => m.id !== mention.id), mention]);
    setTyping(null);
  };

  const empty = visibleText(html).length === 0;
  const blocked = uploads.uploading || uploads.failed;

  const submit = () => {
    if (empty || blocked || submitting) return;
    const current = uploads.files[0] ?? null;
    const before = initialAttachments[0]?.id ?? null;
    onSubmit({
      html: applyMentions(html, mentions),
      fileId: current && current.id !== before ? current.id : null,
      removeAttachment: !!before && !current,
      attachments: current ? [toAttachment(current)] : [],
      anonymous: canPostAnonymously && anonymous,
    });
  };

  useHeaderAction(focused, {
    label: submitLabel,
    disabled: empty || blocked,
    loading: submitting,
    submit,
  });

  return (
    <View className="gap-3">
      <RichEditor
        value={html}
        onChange={change}
        accessibilityLabel={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        editable={!submitting}
        minHeight={88}
        scrollViewRef={scrollViewRef}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {typing ? (
        <MentionSuggestions
          context={context}
          topicId={topicId}
          query={typing.query}
          exclude={mentions.map((m) => m.id)}
          onPick={pick}
        />
      ) : null}
      {error ? (
        <Text variant="footnote" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <PendingAttachmentList uploads={uploads} />
      <AttachmentStatus uploads={uploads} />
      {canPostAnonymously ? (
        <ListGroup>
          <ListItem
            title={t('discussionThread.anonymous')}
            subtitle={anonymous ? t('discussionThread.anonymousHelp') : undefined}
            chevron={false}
            disabled={submitting}
            accessibilityRole="switch"
            accessibilityState={{ checked: anonymous, disabled: submitting }}
            onPress={() => setAnonymous((value) => !value)}
            trailing={
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Switch value={anonymous} onValueChange={setAnonymous} disabled={submitting} />
              </View>
            }
          />
        </ListGroup>
      ) : fullyAnonymous ? (
        <Text variant="footnote" tone="muted" className="px-1">
          {t('discussionThread.anonymousDiscussion')}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        {canAttach ? <AttachButton uploads={uploads} label={t('discussions.attach')} disabled={submitting} /> : null}
        <View className="ms-auto flex-row items-center gap-2">
          {onCancel ? (
            <Button variant="ghost" size="sm" onPress={onCancel} disabled={submitting}>
              {t('common.cancel')}
            </Button>
          ) : null}
          <Button size="sm" disabled={empty || blocked} loading={submitting} onPress={submit}>
            {submitLabel}
          </Button>
        </View>
      </View>
    </View>
  );
}

// MARK: Thread

/** Where the open composer is: replying to the topic (`parentId` null) or an entry, or editing one. */
export type ComposerTarget =
  { kind: 'reply'; parentId: string | null } | { kind: 'edit'; entryId: string } | null;

type ThreadActions = {
  target: ComposerTarget;
  setTarget: (target: ComposerTarget) => void;
  canReply: boolean;
  /** Replies can nest; otherwise only the topic takes replies. */
  threaded: boolean;
  canLike: boolean;
  canAttach: boolean;
  /** Whether the student may edit and delete this post of theirs. */
  canManage: (entryId: string) => boolean;
  submitting: boolean;
  error: string | null;
  reply: (parentId: string | null, draft: EntryDraftInput) => void;
  edit: (entryId: string, draft: EntryDraftInput) => void;
  remove: (entryId: string) => void;
  like: (entryId: string, liked: boolean) => void;
  markUnread: (entryId: string) => void;
  /** Watches an unread reply so it's marked read once seen. */
  registerUnread: (entryId: string, view: HostInstance | null) => void;
  /** Replies or reply chains expanded or collapsed; visibility may have changed. */
  onLayoutChange: () => void;
  context: DiscussionContext;
  /** For opening attachments with the course's files. Empty in groups. */
  courseId: string;
  /** Partially anonymous: replies may be posted without a name. */
  canPostAnonymously: boolean;
  fullyAnonymous: boolean;
  topicId: string;
  userId: string;
  now: Date;
  scrollViewRef?: RefObject<ComponentRef<typeof ScrollView> | null>;
};

const ThreadContext = createContext<ThreadActions | null>(null);

export function ThreadProvider({ value, children }: { value: ThreadActions; children: ReactNode }) {
  return <ThreadContext value={value}>{children}</ThreadContext>;
}

function useThread(): ThreadActions {
  const value = use(ThreadContext);
  if (!value) throw new Error('Entries need a <ThreadProvider>.');
  return value;
}

/** Replies indent this many levels, then continue at the deepest indent with "Replying to". */
const MAX_DEPTH = 3;
/**
 * Reply chains at this depth start collapsed unless something in them is unread.
 * Opening one shows the whole chain below it.
 */
const COLLAPSE_DEPTH = 2;

const countReplies = (entry: DiscussionEntry): number =>
  entry.replies.reduce((n, r) => n + (r.deleted ? 0 : 1) + countReplies(r), 0);
const hasUnread = (entry: DiscussionEntry): boolean => entry.replies.some((r) => r.unread || hasUnread(r));

function ActionButton({
  icon,
  label,
  accessibilityLabel,
  selected,
  expanded,
  onPress,
}: {
  icon: typeof Reply;
  label?: string;
  accessibilityLabel: string;
  selected?: boolean;
  expanded?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const state = selected !== undefined ? { selected } : expanded !== undefined ? { expanded } : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={state}
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={onPress}
      className="min-h-9 flex-row items-center gap-1.5 rounded-full px-2 active:opacity-60"
    >
      <Icon
        icon={icon}
        size={17}
        tone={selected ? 'accent' : 'muted'}
        strokeWidth={selected ? 2.25 : 1.75}
        color={selected ? colors.accentFg : undefined}
      />
      {label ? (
        <Text variant="footnote" weight="medium" tone={selected ? 'accent' : 'muted'} tabular>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

type EntryProps = {
  entry: DiscussionEntry;
  depth: number;
  /** Who this replies to, shown once replies stop indenting. */
  parentAuthor?: string | null;
  /** A search result: no nested replies, always says who it replies to. */
  flat?: boolean;
};

function Entry({ entry, depth, parentAuthor, flat = false }: EntryProps) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const { dates, ageLabel, number, countParams, replies } = discussionPresentation(locale, zone);
  const thread = useThread();
  const [menuOpen, setMenuOpen] = useState(false);
  const replyCount = countReplies(entry);
  const [expanded, setExpanded] = useState(() => depth !== COLLAPSE_DEPTH || hasUnread(entry));
  const replying = thread.target?.kind === 'reply' && thread.target.parentId === entry.id;
  const editing = thread.target?.kind === 'edit' && thread.target.entryId === entry.id;
  const author = entryAuthorName(entry, t);
  const age = dates.relativeAge(entry.createdAt, thread.now);
  const manageable = entry.mine && thread.canManage(entry.id);
  const showReplyingTo = !!parentAuthor && (flat || depth > MAX_DEPTH);
  const watching = entry.unread && !entry.deleted;

  const confirmDelete = () =>
    Alert.alert(t('discussionThread.deleteTitle'), t('discussionThread.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('discussionThread.delete'), style: 'destructive', onPress: () => thread.remove(entry.id) },
    ]);

  const options: SheetOption[] = [
    ...(!entry.unread && !entry.mine
      ? [
          {
            key: 'unread',
            label: t('discussionThread.markUnread'),
            icon: MailOpen,
            onPress: () => thread.markUnread(entry.id),
          },
        ]
      : []),
    ...(manageable
      ? [
          {
            key: 'edit',
            label: t('discussionThread.editReply'),
            icon: Pencil,
            onPress: () => thread.setTarget({ kind: 'edit', entryId: entry.id }),
          },
          {
            key: 'delete',
            label: t('discussionThread.deleteReply'),
            icon: Trash2,
            destructive: true,
            onPress: confirmDelete,
          },
        ]
      : []),
  ];

  const toggleReplies = () => {
    setExpanded((value) => !value);
    thread.onLayoutChange();
  };

  // Past the deepest indent, a reply starts by naming who it answers, as Canvas does.
  const replyMention =
    depth >= MAX_DEPTH && entry.author && !entry.mine && !entry.anonymous
      ? { id: entry.author.id, name: entry.author.name }
      : undefined;

  return (
    <View className="gap-3">
      <View className="flex-row gap-3">
        {entry.deleted ? (
          <View className="h-8 w-8 rounded-full bg-surface-sunken" />
        ) : (
          <Avatar name={author} uri={entry.author?.avatarUrl} size="sm" />
        )}
        <View className="flex-1 gap-1.5">
          <View
            ref={watching ? (view) => thread.registerUnread(entry.id, view) : undefined}
            collapsable={false}
            accessible
            accessibilityLabel={
              entry.deleted
                ? t('discussionThread.deleted')
                : [
                    entry.unread ? t('discussionThread.unread') : null,
                    entry.mine && !entry.anonymous ? t('discussionThread.you', { name: author }) : author,
                    showReplyingTo ? t('discussionThread.replyingTo', { name: parentAuthor ?? '' }) : null,
                    ageLabel(entry.createdAt, thread.now),
                    entry.edited ? t('discussionThread.edited') : null,
                  ]
                    .filter(Boolean)
                    .join(', ')
            }
            className="min-h-8 justify-center gap-0.5"
          >
            {entry.deleted ? (
              <Text variant="subhead" tone="muted">
                {t('discussionThread.deleted')}
              </Text>
            ) : (
              <View className="flex-row items-center gap-1.5">
                <Text variant="subhead" weight="semibold" numberOfLines={1} className="shrink">
                  {author}
                </Text>
                <Text variant="caption" tone="subtle">
                  {entry.edited ? t('discussionThread.editedAge', { age }) : age}
                </Text>
                {entry.unread ? <View className="h-2 w-2 rounded-full bg-accent" /> : null}
              </View>
            )}
            {showReplyingTo && !entry.deleted ? (
              <View className="flex-row items-center gap-1">
                <Icon icon={CornerDownRight} size={13} tone="subtle" />
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {t('discussionThread.replyingTo', { name: parentAuthor ?? '' })}
                </Text>
              </View>
            ) : null}
          </View>

          {editing ? (
            <Composer
              label={t('discussionThread.editYourReply')}
              placeholder={t('discussionDetail.writeReply')}
              submitLabel={t('discussionThread.save')}
              context={thread.context}
              topicId={thread.topicId}
              initialHtml={entry.html}
              initialAttachments={entry.attachments}
              canAttach={thread.canAttach}
              submitting={thread.submitting}
              error={thread.error}
              onSubmit={(draft) => thread.edit(entry.id, draft)}
              onCancel={() => thread.setTarget(null)}
              scrollViewRef={thread.scrollViewRef}
            />
          ) : entry.deleted ? null : (
            <EntryBody html={entry.html} userId={thread.userId} />
          )}

          {!entry.deleted && !editing && entry.attachments.length > 0 ? (
            <AttachmentList
              attachments={entry.attachments}
              courseId={thread.courseId || undefined}
              className="mt-1"
            />
          ) : null}

          {!editing ? (
            <View className="-ms-2 flex-row flex-wrap items-center">
              {!entry.deleted && thread.canReply && thread.threaded ? (
                <ActionButton
                  icon={Reply}
                  label={t('discussionThread.reply')}
                  accessibilityLabel={t('discussionThread.replyTo', { name: author })}
                  onPress={() => thread.setTarget({ kind: 'reply', parentId: entry.id })}
                />
              ) : null}
              {!entry.deleted && thread.canLike ? (
                <ActionButton
                  icon={ThumbsUp}
                  label={entry.likes > 0 ? number(entry.likes) : undefined}
                  accessibilityLabel={t('discussionThread.like', { likes: t('discussionThread.likes', countParams(entry.likes)) })}
                  selected={entry.liked}
                  onPress={() => thread.like(entry.id, !entry.liked)}
                />
              ) : !entry.deleted && entry.likes > 0 ? (
                <View
                  accessible
                  accessibilityLabel={t('discussionThread.likes', countParams(entry.likes))}
                  className="flex-row items-center gap-1.5 px-2"
                >
                  <Icon icon={ThumbsUp} size={17} tone="subtle" />
                  <Text variant="footnote" tone="subtle" tabular>
                    {number(entry.likes)}
                  </Text>
                </View>
              ) : null}
              {!flat && replyCount > 0 ? (
                <ActionButton
                  icon={expanded ? ChevronUp : ChevronDown}
                  label={replies(replyCount)}
                  accessibilityLabel={t(expanded ? 'discussionThread.hideReplies' : 'discussionThread.showReplies', { ...countParams(replyCount), name: author })}
                  expanded={expanded}
                  onPress={toggleReplies}
                />
              ) : null}
              {!entry.deleted && options.length > 0 ? (
                <IconButton
                  icon={Ellipsis}
                  size="sm"
                  accessibilityLabel={entry.mine ? t('discussionThread.moreOwn') : t('discussionThread.more', { name: author })}
                  onPress={() => setMenuOpen(true)}
                />
              ) : null}
            </View>
          ) : null}

          {replying ? (
            <Composer
              label={t('discussionThread.replyTo', { name: author })}
              placeholder={t('discussionThread.replyTo', { name: author })}
              submitLabel={t('discussionDetail.postReply')}
              context={thread.context}
              topicId={thread.topicId}
              initialMention={replyMention}
              canAttach={thread.canAttach}
              canPostAnonymously={thread.canPostAnonymously}
              fullyAnonymous={thread.fullyAnonymous}
              submitting={thread.submitting}
              error={thread.error}
              onSubmit={(draft) => thread.reply(entry.id, draft)}
              onCancel={() => thread.setTarget(null)}
              scrollViewRef={thread.scrollViewRef}
            />
          ) : null}
        </View>
      </View>

      {!flat && expanded && entry.replies.length > 0 ? (
        <View className={cn('gap-4', depth < MAX_DEPTH && 'ms-2 border-s-2 border-border ps-3')}>
          {entry.replies.map((child) => (
            <Entry
              key={child.id}
              entry={child}
              depth={depth + 1}
              parentAuthor={entry.deleted ? null : author}
            />
          ))}
        </View>
      ) : null}

      {options.length > 0 ? (
        <OptionsSheet visible={menuOpen} onClose={() => setMenuOpen(false)} options={options} />
      ) : null}
    </View>
  );
}

/** Root replies as cards, each with its nested replies. */
export function ThreadList({ entries }: { entries: DiscussionEntry[] }) {
  return (
    <View className="gap-3">
      {entries.map((entry) => (
        <Card key={entry.id} padding="md">
          <Entry entry={entry} depth={0} />
        </Card>
      ))}
    </View>
  );
}

type Found = {
  entry: DiscussionEntry;
  parentAuthor: string | null;
  parentAuthorOrigin?: DiscussionEntry['authorNameOrigin'];
};

/** Every reply matching raw content or, when supplied, its current display author. */
export function searchEntries(
  entries: DiscussionEntry[],
  term: string,
  displayAuthor?: (entry: DiscussionEntry) => string,
): Found[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];
  // Translator isolation controls are presentation, not characters a student must type.
  const displayNeedle = needle.replace(/[\u2068\u2069]/g, '');
  const found: Found[] = [];
  const walk = (list: DiscussionEntry[], parentAuthor: string | null, parentAuthorOrigin?: DiscussionEntry['authorNameOrigin']) => {
    for (const e of list) {
      if (!e.deleted) {
        const text = projectHtml(e.html).text.toLowerCase();
        if (
          text.includes(needle) || e.author?.name.toLowerCase().includes(needle) ||
          (displayNeedle && displayAuthor?.(e).replace(/[\u2068\u2069]/g, '').toLowerCase().includes(displayNeedle))
        )
          found.push({ entry: e, parentAuthor, ...(parentAuthorOrigin ? { parentAuthorOrigin } : {}) });
      }
      walk(e.replies, e.deleted ? null : (e.author?.name ?? null), e.deleted ? undefined : e.authorNameOrigin);
    }
  };
  walk(entries, null);
  return found.sort((a, b) => b.entry.createdAt.getTime() - a.entry.createdAt.getTime());
}

/** Search results as a flat list, newest first, each saying who it replies to. */
export function SearchResults({ results, term }: { results: Found[]; term: string }) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const { countParams } = discussionPresentation(locale, zone);
  return (
    <View className="gap-3">
      <Text variant="footnote" tone="muted" className="px-1" accessibilityLiveRegion="polite">
        {results.length === 0
          ? t('discussionThread.noMatches', { term: term.trim() })
          : t('discussionThread.matches', { ...countParams(results.length), term: term.trim() })}
      </Text>
      {results.map(({ entry, parentAuthor, parentAuthorOrigin }) => (
        <Card key={entry.id} padding="md">
          <Entry
            entry={entry}
            depth={0}
            parentAuthor={parentAuthorOrigin ? entryAuthorName({
              author: parentAuthor == null ? null : { name: parentAuthor },
              authorNameOrigin: parentAuthorOrigin,
            }, t) : parentAuthor}
            flat
          />
        </Card>
      ))}
    </View>
  );
}

/** Shown on the reply prompt so students know mentions work. */
export function MentionHint() {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center gap-1.5 px-1">
      <Icon icon={AtSign} size={14} tone="subtle" />
      <Text variant="footnote" tone="subtle">
        {t('discussionThread.mentionHint')}
      </Text>
    </View>
  );
}
