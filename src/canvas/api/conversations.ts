import { type QueryClient, type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { CanvasClient } from '../client';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';
import { useCanvas } from '../session';
import type { CanvasAttachment } from '../types';
import type { ActivityItem } from './activity';
import { graphql, type Person } from './discussions';

/*
 * Inbox: conversations, messages, and recipients. Canvas returns one
 * ConversationParticipant per conversation, from the student's side.
 */

// MARK: Raw API shapes

/** conversation_user_json (lib/api/v1/conversation.rb) */
export type CanvasConversationUser = {
  id: string;
  name: string;
  full_name?: string;
  pronouns?: string | null;
  avatar_url?: string | null;
  common_courses?: Record<string, string[]>;
  common_groups?: Record<string, string[]>;
};

/** media_comment_json (lib/api.rb): a recorded video or audio message. */
export type CanvasMediaComment = {
  'content-type'?: string;
  display_name?: string | null;
  media_id?: string;
  media_type?: string;
  /** `/users/:id/media_download?entryId=…&redirect=1`, which needs the token. */
  url?: string;
};

/** conversation_message_json */
export type CanvasConversationMessage = {
  id: string;
  created_at: string;
  body: string;
  author_id: string;
  generated: boolean;
  media_comment?: CanvasMediaComment | null;
  forwarded_messages?: CanvasConversationMessage[];
  attachments?: CanvasAttachment[];
  participating_user_ids?: string[];
};

/** conversation_json (ConversationParticipant#as_json) */
export type CanvasConversation = {
  id: string;
  subject: string | null;
  workflow_state: 'read' | 'unread' | 'archived';
  last_message: string | null;
  last_message_at: string | null;
  last_authored_message?: string | null;
  last_authored_message_at?: string | null;
  message_count: number;
  subscribed?: boolean;
  private?: boolean;
  starred: boolean;
  properties?: ('last_author' | 'attachments' | 'media_objects')[];
  audience?: string[];
  audience_contexts?: { courses?: Record<string, string[]>; groups?: Record<string, string[]> };
  avatar_url?: string | null;
  participants: CanvasConversationUser[];
  visible?: boolean;
  context_code?: string | null;
  context_name?: string | null;
  cannot_reply?: boolean;
  messages?: CanvasConversationMessage[];
};

/**
 * `GET /api/v1/search/recipients` (search_controller.rb, SearchHelper#matching_contexts):
 * users, plus contexts such as `course_1_teachers`, `section_2`, and `group_3`.
 * Folder contexts (`course_1_sections`, `course_1_groups`) carry `item_count` instead.
 */
export type CanvasRecipient = {
  id: string;
  name: string;
  full_name?: string;
  avatar_url?: string | null;
  type?: 'context' | 'course' | 'section' | 'group' | 'user' | null;
  user_count?: number;
  item_count?: number;
  context_name?: string;
  common_courses?: Record<string, string[]>;
};

// MARK: Models

export type ConversationScope = 'inbox' | 'unread' | 'starred' | 'sent' | 'archived';

export type Conversation = {
  id: string;
  subject: string;
  unread: boolean;
  archived: boolean;
  starred: boolean;
  /** Preview of the newest message. */
  lastMessage: string;
  lastMessageAt: Date | null;
  /** Preview of the student's newest message, for Sent. */
  lastAuthoredMessage: string;
  lastAuthoredMessageAt: Date | null;
  messageCount: number;
  hasAttachments: boolean;
  /** Has a recorded video or audio message. */
  hasMedia: boolean;
  /** Everyone, including the student. */
  participants: Person[];
  /** Everyone but the student. */
  audience: Person[];
  courseId: string | null;
  contextCode: string | null;
  contextName: string | null;
  canReply: boolean;
};

export type MessageMedia = {
  id: string | null;
  /** The title the author gave it, if any. */
  title: string | null;
  kind: 'video' | 'audio';
  url: string | null;
};

export type ConversationMessage = {
  id: string;
  authorId: string;
  author: Person | null;
  body: string;
  createdAt: Date;
  /** System messages, like "Ana was added to the conversation". */
  generated: boolean;
  attachments: CanvasAttachment[];
  media: MessageMedia | null;
  forwarded: ConversationMessage[];
  /** Who received this message, including the author. */
  participantIds: string[];
};

export type ConversationDetail = Conversation & { messages: ConversationMessage[] };

export type Recipient = {
  /** A user ID, or a context such as `course_1_teachers`, `section_2`, or `group_3`. */
  id: string;
  name: string;
  avatarUrl: string | null;
  /** A person, or everyone in a role, section, or group. */
  kind: 'user' | 'context';
  /** Enrollment types in the searched course, e.g. "TeacherEnrollment". Users only. */
  roles: string[];
  /** How many people a context reaches. */
  userCount: number | null;
};

/** A drill-in list of contexts in the address book: a course's sections or its student groups. */
export type RecipientFolder = {
  /** `course_1_sections` or `course_1_groups`, searched as a context. */
  id: string;
  kind: 'sections' | 'groups';
  name: string;
  count: number;
};

// MARK: Mapping

function toPerson(u: CanvasConversationUser): Person {
  return { id: String(u.id), name: u.full_name || u.name, avatarUrl: u.avatar_url ?? null };
}

function toConversation(c: CanvasConversation, userId: string): Conversation {
  const participants = c.participants.map(toPerson);
  const audienceIds = new Set((c.audience ?? []).map(String));
  const audience = participants.filter((p) => (audienceIds.size ? audienceIds.has(p.id) : p.id !== userId));
  const courseId = c.context_code?.startsWith('course_') ? c.context_code.slice('course_'.length) : null;
  return {
    id: String(c.id),
    subject: c.subject?.trim() || '',
    unread: c.workflow_state === 'unread',
    archived: c.workflow_state === 'archived',
    starred: !!c.starred,
    lastMessage: c.last_message ?? '',
    lastMessageAt: c.last_message_at ? new Date(c.last_message_at) : null,
    lastAuthoredMessage: c.last_authored_message ?? '',
    lastAuthoredMessageAt: c.last_authored_message_at ? new Date(c.last_authored_message_at) : null,
    messageCount: c.message_count,
    hasAttachments: !!c.properties?.includes('attachments'),
    hasMedia: !!c.properties?.includes('media_objects'),
    participants,
    audience,
    courseId,
    contextCode: c.context_code ?? null,
    contextName: c.context_name ?? null,
    canReply: !c.cannot_reply,
  };
}

function toMedia(m: CanvasMediaComment): MessageMedia {
  const audio = m.media_type === 'audio' || !!m['content-type']?.startsWith('audio/');
  return {
    id: m.media_id ?? null,
    title: m.display_name?.trim() || null,
    kind: audio ? 'audio' : 'video',
    url: m.url ?? null,
  };
}

function toMessage(m: CanvasConversationMessage, people: Map<string, Person>): ConversationMessage {
  const authorId = String(m.author_id);
  return {
    id: String(m.id),
    authorId,
    author: people.get(authorId) ?? null,
    body: m.body ?? '',
    createdAt: new Date(m.created_at),
    generated: !!m.generated,
    attachments: m.attachments ?? [],
    media: m.media_comment ? toMedia(m.media_comment) : null,
    forwarded: (m.forwarded_messages ?? []).map((f) => toMessage(f, people)),
    participantIds: (m.participating_user_ids ?? []).map(String),
  };
}

function toDetail(c: CanvasConversation, userId: string): ConversationDetail {
  const summary = toConversation(c, userId);
  const people = new Map(summary.participants.map((p) => [p.id, p]));
  return { ...summary, messages: (c.messages ?? []).map((m) => toMessage(m, people)) };
}

function inScope(c: Conversation, scope: ConversationScope): boolean {
  switch (scope) {
    case 'unread':
      return c.unread;
    case 'starred':
      return c.starred;
    case 'archived':
      return c.archived;
    case 'sent':
      return true;
    default:
      return !c.archived;
  }
}

// MARK: Fetchers and hooks

export async function fetchConversations(
  client: CanvasClient,
  userId: string,
  scope: ConversationScope,
  courseId: string | null,
  signal?: AbortSignal,
): Promise<Conversation[]> {
  const list = await client.getAll<CanvasConversation>(
    '/api/v1/conversations',
    {
      scope: scope === 'inbox' ? undefined : scope,
      filter: courseId ? [`course_${courseId}`] : undefined,
      include: ['participant_avatars'],
    },
    { signal, maxPages: 3 },
  );
  return list.map((c) => toConversation(c, userId));
}

/** One page of scope plus course filter (INBOX-1). `courseId` null means every course. */
export function useConversations(scope: ConversationScope, courseId: string | null, enabled = true) {
  const { account } = useCanvas();
  return useCanvasQuery(
    ['conversations', scope, courseId ?? 'all'],
    (client, signal) => fetchConversations(client, account.user.id, scope, courseId, signal),
    { enabled },
  );
}

/** Applies a change to a conversation in every cached inbox list, dropping it from scopes it left. */
function patchLists(
  queryClient: QueryClient,
  accountKey: string,
  id: string,
  patch: ((c: Conversation) => Conversation) | 'remove',
) {
  for (const [key, list] of queryClient.getQueriesData<Conversation[]>({
    queryKey: [accountKey, 'conversations'],
  })) {
    if (!list) continue;
    const scope = (key as QueryKey)[2] as ConversationScope;
    const next =
      patch === 'remove'
        ? list.filter((c) => c.id !== id)
        : list.map((c) => (c.id === id ? patch(c) : c)).filter((c) => c.id !== id || inScope(c, scope));
    queryClient.setQueryData(key, next);
  }
}

export async function fetchConversation(
  client: CanvasClient,
  userId: string,
  id: string,
  signal?: AbortSignal,
): Promise<ConversationDetail> {
  const c = await client.get<CanvasConversation>(
    `/api/v1/conversations/${id}`,
    { auto_mark_as_read: true, include: ['participant_avatars'] },
    signal,
  );
  return toDetail(c, userId);
}

/** A conversation with its messages, newest first. Opening it marks it read in Canvas and in the lists. */
export function useConversation(id: string | undefined) {
  const { account } = useCanvas();
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  const query = useCanvasQuery(
    ['conversation', id ?? 'none'],
    (client, signal) => fetchConversation(client, account.user.id, id!, signal),
    { enabled: !!id },
  );
  const loaded = !!query.data;
  useEffect(() => {
    if (!loaded || !id) return;
    patchLists(queryClient, accountKey, id, (c) => (c.unread ? { ...c, unread: false } : c));
    queryClient.setQueriesData<ActivityItem[]>({ queryKey: [accountKey, 'activity'] }, (items) =>
      items?.map((i) => (i.conversationId === id && i.unread ? { ...i, unread: false } : i)),
    );
  }, [loaded, queryClient, accountKey, id]);
  return query;
}

type ConversationChange = { id: string; starred?: boolean; state?: 'read' | 'unread' | 'archived' };

/** Star, mark read or unread, archive, and unarchive (INBOX-6). Lists update before Canvas answers. */
export function useUpdateConversation() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    (client, { id, starred, state }: ConversationChange) =>
      client.put<CanvasConversation>(`/api/v1/conversations/${id}`, {
        conversation: { ...(starred !== undefined && { starred }), ...(state && { workflow_state: state }) },
      }),
    {
      onMutate: ({ id, starred, state }) => {
        const apply = (c: Conversation): Conversation => ({
          ...c,
          ...(starred !== undefined && { starred }),
          ...(state && { unread: state === 'unread', archived: state === 'archived' }),
        });
        patchLists(queryClient, accountKey, id, apply);
        queryClient.setQueryData<ConversationDetail>([accountKey, 'conversation', id], (d) =>
          d ? { ...d, ...apply(d) } : d,
        );
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: [accountKey, 'conversations'] }),
    },
  );
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation((client, id: string) => client.delete<unknown>(`/api/v1/conversations/${id}`), {
    onSuccess: (_data, id) => {
      patchLists(queryClient, accountKey, id, 'remove');
      queryClient.removeQueries({ queryKey: [accountKey, 'conversation', id] });
    },
  });
}

/** Deletes single messages for the student only. */
export function useRemoveMessages() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    (client, { id, messageIds }: { id: string; messageIds: string[] }) =>
      client.post<unknown>(`/api/v1/conversations/${id}/remove_messages`, { remove: messageIds }),
    {
      onSuccess: (_data, { id }) =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: [accountKey, 'conversation', id] }),
          queryClient.invalidateQueries({ queryKey: [accountKey, 'conversations'] }),
        ]),
    },
  );
}

export type NewMessage = {
  body: string;
  /** User IDs. */
  recipients: string[];
  attachmentIds?: string[];
};

/**
 * Reply, reply all, and forward all add a message to the conversation (INBOX-2).
 * Forwarding adds recipients and includes the forwarded messages.
 */
export function useAddMessage() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    (
      client,
      {
        id,
        body,
        recipients,
        attachmentIds,
        includedMessages,
      }: NewMessage & { id: string; includedMessages?: string[] },
    ) =>
      client.post<CanvasConversation>(`/api/v1/conversations/${id}/add_message`, {
        body,
        recipients,
        included_messages: includedMessages,
        attachment_ids: attachmentIds,
      }),
    {
      onSuccess: (_data, { id }) =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: [accountKey, 'conversation', id] }),
          queryClient.invalidateQueries({ queryKey: [accountKey, 'conversations'] }),
        ]),
    },
  );
}

/**
 * New conversation (INBOX-3). With `individually`, each recipient gets a
 * private copy (Canvas `bulk_message`), and replies come back separately.
 */
export function useCreateConversation() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    (
      client,
      {
        courseId,
        subject,
        body,
        recipients,
        attachmentIds,
        individually,
      }: NewMessage & { courseId: string; subject: string; individually: boolean },
    ) =>
      client.post<CanvasConversation[]>('/api/v1/conversations', {
        recipients,
        subject,
        body,
        context_code: `course_${courseId}`,
        attachment_ids: attachmentIds,
        // Mirrors the official apps: always a group conversation, split by bulk_message.
        group_conversation: true,
        bulk_message: individually,
        mode: 'sync',
      }),
    { onSuccess: () => queryClient.invalidateQueries({ queryKey: [accountKey, 'conversations'] }) },
  );
}

function toRecipient(r: CanvasRecipient, courseId: string | null): Recipient {
  const isUser = !r.type || r.type === 'user';
  return {
    id: String(r.id),
    name: (isUser && r.full_name) || r.name,
    avatarUrl: isUser ? (r.avatar_url ?? null) : null,
    kind: isUser ? 'user' : 'context',
    roles: isUser && courseId ? (r.common_courses?.[courseId] ?? []) : [],
    userCount: isUser ? null : (r.user_count ?? null),
  };
}

const courseOfContext = (context: string) => context.match(/^course_(\d+)/)?.[1] ?? null;

/** People the student can message in a context (a course, section, or group), by name. */
export async function fetchRecipientPeople(
  client: CanvasClient,
  context: string,
  search: string,
  signal?: AbortSignal,
): Promise<Recipient[]> {
  const list = await client.getAll<CanvasRecipient>(
    '/api/v1/search/recipients',
    { search: search || undefined, context, type: 'user', per_page: 100 },
    { signal, maxPages: search ? 1 : 2 },
  );
  const courseId = courseOfContext(context);
  return list.filter((r) => !r.type || r.type === 'user').map((r) => toRecipient(r, courseId));
}

export type RecipientContexts = { contexts: Recipient[]; folders: RecipientFolder[] };

/**
 * Groups of people in a context: roles (Teachers, Students) and the course's
 * section and group folders at the top, the sections or groups inside a folder,
 * or the sections and groups whose names match a search.
 */
export async function fetchRecipientContexts(
  client: CanvasClient,
  context: string,
  search: string,
  signal?: AbortSignal,
): Promise<RecipientContexts> {
  const list = await client.getAll<CanvasRecipient>(
    '/api/v1/search/recipients',
    { search: search || undefined, context, type: 'context', synthetic_contexts: true, per_page: 100 },
    { signal, maxPages: 3 },
  );
  const contexts: Recipient[] = [];
  const folders: RecipientFolder[] = [];
  for (const r of list) {
    if (!r.type || r.type === 'user') continue;
    const folder = String(r.id).match(/_(sections|groups)$/)?.[1] as RecipientFolder['kind'] | undefined;
    if (folder && r.item_count != null) {
      folders.push({ id: String(r.id), kind: folder, name: r.name, count: r.item_count });
    } else if ((r.user_count ?? 0) > 0) {
      contexts.push(toRecipient(r, null));
    }
  }
  return { contexts, folders };
}

/**
 * While a new search loads, keep showing the last results for the same context,
 * so the list doesn't flash empty on every keystroke. Key: [account, 'recipients', kind, context, search].
 */
const sameContext =
  (context: string | null) =>
  <T>(previous: T | undefined, query: { queryKey: QueryKey } | undefined): T | undefined =>
    query?.queryKey[3] === (context ?? 'none') ? previous : undefined;

/** People in a course, section, or group. An empty search lists everyone. */
export function useRecipientPeople(context: string | null, search: string) {
  return useCanvasQuery(
    ['recipients', 'people', context ?? 'none', search],
    (client, signal) => fetchRecipientPeople(client, context!, search, signal),
    { enabled: !!context, staleTime: 5 * 60_000, placeholderData: sameContext(context) },
  );
}

/** Roles, sections, and groups the student can message as a whole (INBOX-3). */
export function useRecipientContexts(context: string | null, search: string) {
  return useCanvasQuery(
    ['recipients', 'contexts', context ?? 'none', search],
    (client, signal) => fetchRecipientContexts(client, context!, search, signal),
    { enabled: !!context, staleTime: 5 * 60_000, placeholderData: sameContext(context) },
  );
}

// MARK: Signature (INBOX-7, SET-7)

/** `GET /api/v1/settings/environment` (accounts_controller.rb#environment): only keys the school set. */
type CanvasEnvironment = {
  enable_inbox_signature_block?: boolean;
  disable_inbox_signature_block_for_students?: boolean;
};

/** Types::InboxSettingsType */
type CanvasInboxSettings = {
  useSignature: boolean;
  signature: string | null;
  useOutOfOffice: boolean;
  outOfOfficeFirstDate: string | null;
  outOfOfficeLastDate: string | null;
  outOfOfficeSubject: string | null;
  outOfOfficeMessage: string | null;
};

export type InboxSignature =
  /** The school doesn't offer signatures, or doesn't to students. */
  | { available: false }
  | { available: true; enabled: boolean; text: string; settings: CanvasInboxSettings };

/** Canvas's limit, enforced by the web's settings form. */
export const SIGNATURE_MAX = 255;

const INBOX_SETTINGS_FIELDS =
  'useSignature signature useOutOfOffice outOfOfficeFirstDate outOfOfficeLastDate outOfOfficeSubject outOfOfficeMessage';

/**
 * The student's inbox signature, stored the way Canvas stores it: per user and
 * school in inbox settings (GraphQL `myInboxSettings`). Schools turn the
 * feature on (`enable_inbox_signature_block`) and can keep it from students
 * (`disable_inbox_signature_block_for_students`), as conversations_controller.rb
 * checks for the web inbox.
 */
export async function fetchInboxSignature(client: CanvasClient, signal?: AbortSignal): Promise<InboxSignature> {
  const env = await client
    .get<CanvasEnvironment>('/api/v1/settings/environment', undefined, signal)
    .catch((): CanvasEnvironment => ({}));
  if (!env.enable_inbox_signature_block || env.disable_inbox_signature_block_for_students) return { available: false };
  const data = await graphql<{ myInboxSettings: CanvasInboxSettings | null }>(
    client,
    'EaselInboxSettings',
    `query EaselInboxSettings { myInboxSettings { ${INBOX_SETTINGS_FIELDS} } }`,
    {},
    signal,
  ).catch(() => ({ myInboxSettings: null }));
  const settings = data.myInboxSettings;
  // Null while Canvas's inbox settings feature is off for the whole site.
  if (!settings) return { available: false };
  return { available: true, enabled: !!settings.useSignature, text: settings.signature ?? '', settings };
}

export function useInboxSignature() {
  return useCanvasQuery(['inbox', 'signature'], fetchInboxSignature, { staleTime: 10 * 60_000 });
}

/** What compose and replies add to the end of a message: Canvas's own separator, then the signature. */
export function signatureBlock(signature: InboxSignature | undefined): string | null {
  if (!signature?.available || !signature.enabled || !signature.text.trim()) return null;
  return `\n\n---\n${signature.text.trim()}`;
}

const UPDATE_INBOX_SETTINGS = `mutation EaselUpdateInboxSettings($useSignature: Boolean!, $signature: String, $useOutOfOffice: Boolean!, $outOfOfficeFirstDate: String, $outOfOfficeLastDate: String, $outOfOfficeSubject: String, $outOfOfficeMessage: String) {
  updateMyInboxSettings(input: { useSignature: $useSignature, signature: $signature, useOutOfOffice: $useOutOfOffice, outOfOfficeFirstDate: $outOfOfficeFirstDate, outOfOfficeLastDate: $outOfOfficeLastDate, outOfOfficeSubject: $outOfOfficeSubject, outOfOfficeMessage: $outOfOfficeMessage }) {
    myInboxSettings { ${INBOX_SETTINGS_FIELDS} }
    errors { attribute message }
  }
}`;

/**
 * Saves the signature. Canvas overwrites every inbox setting on each save, so
 * the out-of-office fields go back exactly as they were.
 */
export function useSaveSignature() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    async (client, { enabled, text, settings }: { enabled: boolean; text: string; settings: CanvasInboxSettings }) => {
          const data = await graphql<{
        updateMyInboxSettings: {
          myInboxSettings: CanvasInboxSettings | null;
          errors?: { message: string }[] | null;
        } | null;
      }>(client, 'EaselUpdateInboxSettings', UPDATE_INBOX_SETTINGS, {
        ...settings,
        useSignature: enabled,
        signature: text.trim().slice(0, SIGNATURE_MAX),
      });
      const error = data.updateMyInboxSettings?.errors?.[0];
      if (error) throw new Error(error.message);
      return data.updateMyInboxSettings?.myInboxSettings ?? null;
    },
    { onSuccess: () => queryClient.invalidateQueries({ queryKey: [accountKey, 'inbox', 'signature'] }) },
  );
}

// MARK: Submission comments (INBOX-8)

/** One node of `User.viewableSubmissionsConnection` (user_type.rb), as the web inbox reads it. */
type GraphQLViewableSubmission = {
  _id: string;
  readState?: string | null;
  commentsConnection?: {
    nodes: {
      _id: string;
      createdAt: string;
      comment?: string | null;
      read?: boolean | null;
      author?: { _id: string; name?: string | null; avatarUrl?: string | null } | null;
      assignment?: { _id: string; name?: string | null } | null;
      course?: { _id: string; name?: string | null } | null;
    }[];
  } | null;
};

export type SubmissionThread = {
  /** The submission's ID. */
  id: string;
  courseId: string;
  courseName: string | null;
  assignmentId: string;
  assignmentName: string;
  unread: boolean;
  count: number;
  latest: { authorId: string | null; author: string; avatarUrl: string | null; text: string; at: Date };
};

const SUBMISSION_COMMENTS_QUERY = `query EaselSubmissionComments($userId: ID!, $filter: [String!]) {
  legacyNode(_id: $userId, type: User) {
    ... on User {
      viewableSubmissionsConnection(first: 30, filter: $filter) {
        nodes {
          _id
          readState
          commentsConnection(sortOrder: desc, filter: { allComments: true }) {
            nodes {
              _id createdAt comment read
              author { _id name avatarUrl }
              assignment { _id name }
              course { _id name }
            }
          }
        }
      }
    }
  }
}`;

/**
 * The web inbox's "Submission comments" view: submissions with comments, newest
 * comment first. Canvas builds it from the student's own submission stream.
 */
export async function fetchSubmissionThreads(
  client: CanvasClient,
  userId: string,
  courseId: string | null,
  signal?: AbortSignal,
): Promise<SubmissionThread[]> {
  const data = await graphql<{
    legacyNode: { viewableSubmissionsConnection?: { nodes: GraphQLViewableSubmission[] } | null } | null;
  }>(
    client,
    'EaselSubmissionComments',
    SUBMISSION_COMMENTS_QUERY,
    { userId, filter: courseId ? [`course_${courseId}`] : null },
    signal,
  );
  const threads: SubmissionThread[] = [];
  for (const s of data.legacyNode?.viewableSubmissionsConnection?.nodes ?? []) {
    const comments = s.commentsConnection?.nodes ?? [];
    const latest = comments[0];
    if (!latest?.assignment || !latest.course) continue;
    threads.push({
      id: String(s._id),
      courseId: String(latest.course._id),
      courseName: latest.course.name ?? null,
      assignmentId: String(latest.assignment._id),
      assignmentName: latest.assignment.name ?? 'Assignment',
      unread: s.readState === 'unread' || comments.some((c) => c.read === false),
      count: comments.length,
      latest: {
        authorId: latest.author?._id ? String(latest.author._id) : null,
        author: latest.author?.name ?? 'Someone',
        avatarUrl: latest.author?.avatarUrl ?? null,
        text: (latest.comment ?? '').replace(/\s+/g, ' ').trim(),
        at: new Date(latest.createdAt),
      },
    });
  }
  return threads.sort((a, b) => b.latest.at.getTime() - a.latest.at.getTime());
}

export function useSubmissionThreads(courseId: string | null, enabled = true) {
  const { account } = useCanvas();
  return useCanvasQuery(
    ['inbox', 'submission-comments', courseId ?? 'all'],
    (client, signal) => fetchSubmissionThreads(client, account.user.id, courseId, signal),
    { enabled },
  );
}

/** Marks a submission's comments read (`updateSubmissionsReadState`), clearing the dot right away. */
export function useMarkSubmissionRead() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    async (client, submissionId: string) => {
          await graphql(
        client,
        'EaselMarkSubmissionsRead',
        `mutation EaselMarkSubmissionsRead($ids: [ID!]!) {
          updateSubmissionsReadState(input: { submissionIds: $ids, read: true }) { errors { message } }
        }`,
        { ids: [submissionId] },
      );
    },
    {
      onMutate: (submissionId) => {
        queryClient.setQueriesData<SubmissionThread[]>(
          { queryKey: [accountKey, 'inbox', 'submission-comments'] },
          (list) => list?.map((t) => (t.id === submissionId ? { ...t, unread: false } : t)),
        );
      },
    },
  );
}
