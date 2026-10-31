import { useListPlaceholder } from './cacheSeed';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';

import { type CanvasClient, CanvasError } from '../client';
import { htmlToText } from '../html';
import type { Announcement } from '../models';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';
import { useCanvas } from '../session';
import type { CanvasAttachment, CanvasDiscussionTopic } from '../types';
import type { ActivityItem } from './activity';

/*
 * Discussion topics and threaded entries. Announcements are discussion topics
 * too, so their detail screen, read state, and replies all come from here.
 *
 * REST or GraphQL (CONTENT-2). Reading uses REST: `/view` returns the whole
 * thread in one request, read state and likes have REST endpoints, and both
 * work with any token. GraphQL (`/api/graphql`) covers what REST can't do:
 * - Posting and editing replies with a file. GraphQL takes the ID of a file
 *   uploaded the normal three-step way, and an edit keeps or removes it
 *   explicitly. REST takes only a raw multipart file, and a REST edit drops
 *   the attachment unless the file is sent again
 *   (discussion_entries_controller.rb#update).
 * - @-mentions: `Discussion.mentionableUsersConnection` lists who can be
 *   mentioned in this topic (section-specific topics included). There's no
 *   REST equivalent; Easel falls back to the course's messageable people.
 * - Whether the student may edit or delete their own posts. Courses can turn
 *   that off, and only GraphQL exposes per-entry permissions.
 */

// MARK: Contexts

/** Where a topic lives: a course, or one of the student's groups (COURSE-7). */
export type DiscussionContext = { type: 'course' | 'group'; id: string };

export const courseContext = (id: string): DiscussionContext => ({ type: 'course', id });
export const groupContext = (id: string): DiscussionContext => ({ type: 'group', id });

/** `/api/v1/courses/201` or `/api/v1/groups/5101`. */
export const contextBase = (c: DiscussionContext) =>
  `/api/v1/${c.type === 'course' ? 'courses' : 'groups'}/${c.id}`;

/** Canvas's asset string: `course_201` or `group_5101`. */
export const contextCode = (c: DiscussionContext) => `${c.type}_${c.id}`;

/** Cache-key segment: a course's ID, as before groups existed, or `group_<id>`. */
export const contextKey = (c: DiscussionContext) => (c.type === 'course' ? c.id : contextCode(c));

/** Reads `course_201` or `group_5101`. */
export function parseContextCode(code: string | null | undefined): DiscussionContext | null {
  const match = code?.match(/^(course|group)_(\w+)$/);
  return match ? { type: match[1] as DiscussionContext['type'], id: match[2] } : null;
}

// MARK: Raw API shapes

/** user_display_json (lib/api/v1/user.rb) */
export type CanvasDisplayUser = {
  id: string;
  display_name?: string;
  avatar_image_url?: string | null;
  html_url?: string;
  pronouns?: string | null;
};

/** `GET /api/v1/courses/:id/discussion_topics/:id` (lib/api/v1/discussion_topics.rb) */
export type CanvasTopic = CanvasDiscussionTopic & {
  author?: CanvasDisplayUser | null;
  created_at?: string | null;
  last_reply_at?: string | null;
  assignment_id?: string | null;
  discussion_type?: 'side_comment' | 'threaded' | 'not_threaded' | 'flat';
  position?: number | null;
  pinned?: boolean;
  /** Closed for comments. */
  locked?: boolean;
  locked_for_user?: boolean;
  lock_explanation?: string;
  allow_rating?: boolean;
  only_graders_can_rate?: boolean;
  sort_by_rating?: boolean;
  require_initial_post?: boolean | null;
  user_can_see_posts?: boolean;
  discussion_subentry_count?: number;
  is_announcement?: boolean;
  /** The student's order for root replies; `sort_order_locked` means the instructor fixed it. */
  sort_order?: 'asc' | 'desc';
  sort_order_locked?: boolean;
  comments_disabled?: boolean;
  published?: boolean;
  permissions?: { attach?: boolean; update?: boolean; reply?: boolean; delete?: boolean };
  assignment?: {
    id: string;
    due_at?: string | null;
    points_possible?: number | null;
    has_sub_assignments?: boolean;
    checkpoints?: CanvasCheckpoint[];
  } | null;
  /** `full_anonymity`: every student posts anonymously. `partial_anonymity`: each student chooses. */
  anonymous_state?: 'full_anonymity' | 'partial_anonymity' | null;
  /** Graded discussions with checkpoints (discussion_topics.rb: is_checkpointed, checkpoints). */
  is_checkpointed?: boolean;
  has_sub_assignments?: boolean;
  reply_to_entry_required_count?: number | null;
  checkpoints?: CanvasCheckpoint[];
  /** A group discussion: each group in the category has its own copy (`group_topic_children`). */
  group_category_id?: string | null;
  group_topic_children?: { id: string; group_id: string }[];
  root_topic_id?: string | null;
};

/** A checkpoint (sub-assignment) of a graded discussion (lib/api/v1/assignment.rb). */
export type CanvasCheckpoint = {
  tag: 'reply_to_topic' | 'reply_to_entry' | string;
  name?: string;
  points_possible?: number | null;
  due_at?: string | null;
  unlock_at?: string | null;
  lock_at?: string | null;
};

/** A node of the materialized view (discussion_entry_api_json, no user context). */
export type CanvasViewEntry = {
  id: string;
  user_id?: string;
  user_name?: string;
  editor_id?: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  rating_count?: number | null;
  rating_sum?: number | null;
  message?: string | null;
  deleted?: boolean;
  attachment?: CanvasAttachment;
  attachments?: CanvasAttachment[];
  replies?: CanvasViewEntry[];
};

/** `GET /api/v1/courses/:id/discussion_topics/:id/view` */
export type CanvasTopicView = {
  unread_entries: string[];
  forced_entries: string[];
  entry_ratings: Record<string, number>;
  participants: CanvasDisplayUser[];
  view: CanvasViewEntry[];
  new_entries?: CanvasViewEntry[] | null;
};

// MARK: Models

export type Person = { id: string; name: string; avatarUrl: string | null };

/** A graded discussion's checkpoint: reply to the topic, or reply to classmates. */
export type Checkpoint = {
  kind: 'reply_to_topic' | 'reply_to_entry';
  dueAt: Date | null;
  points: number | null;
  /** Replies to classmates required, for `reply_to_entry`. */
  required: number;
};

export type DiscussionTopic = {
  id: string;
  /** The course or group it belongs to. */
  context: DiscussionContext;
  /** The course's ID for course topics; empty for group topics. */
  courseId: string;
  title: string;
  html: string;
  /** Plain-text excerpt of the body. */
  preview: string;
  htmlUrl: string;
  author: Person | null;
  postedAt: Date | null;
  lastReplyAt: Date | null;
  /** The topic itself hasn't been opened. */
  unread: boolean;
  /** Unread replies. */
  unreadCount: number;
  replyCount: number;
  pinned: boolean;
  /** Closed for comments. */
  locked: boolean;
  isAnnouncement: boolean;
  /** Students must post before they see other replies. */
  requireInitialPost: boolean;
  canSeePosts: boolean;
  canReply: boolean;
  /** Replies may carry a file (the course's "attach files to discussions" setting). */
  canAttach: boolean;
  /** Replies can nest. Flat discussions take replies to the topic only. */
  threaded: boolean;
  /** Root replies: newest first (`desc`) or oldest first. */
  sortOrder: 'asc' | 'desc';
  /** The instructor fixed the order. */
  sortOrderLocked: boolean;
  allowRating: boolean;
  onlyGradersCanRate: boolean;
  attachments: CanvasAttachment[];
  /** Set for graded discussions. */
  assignment: { id: string; dueAt: Date | null; points: number | null } | null;
  /** Graded in parts (CONTENT-4): a reply to the topic, then replies to classmates. Empty otherwise. */
  checkpoints: Checkpoint[];
  /** Students post anonymously: everyone (`full`), or those who choose to (`partial`). */
  anonymity: 'full' | 'partial' | null;
  /** A course topic each group discusses separately; students reply in their group's copy. */
  groupChildren: { topicId: string; groupId: string }[];
  isGroupDiscussion: boolean;
  position: number | null;
};

/** Only adapter-generated labels; supplied/legacy names remain verbatim. */
export type EntryAuthorOrigin = { kind: 'unknown' } | { kind: 'anonymous'; token: string };

export type DiscussionEntry = {
  id: string;
  parentId: string | null;
  /** For anonymous posts, a stand-in like "Anonymous 4f". */
  author: Person | null;
  authorNameOrigin?: EntryAuthorOrigin;
  /** Posted anonymously. */
  anonymous: boolean;
  html: string;
  createdAt: Date;
  updatedAt: Date;
  edited: boolean;
  deleted: boolean;
  unread: boolean;
  likes: number;
  liked: boolean;
  mine: boolean;
  attachments: CanvasAttachment[];
  replies: DiscussionEntry[];
};

export type DiscussionThread =
  | { status: 'visible'; entries: DiscussionEntry[]; count: number; unreadIds: string[] }
  /** `require_initial_post`: replies stay hidden until the student posts. */
  | { status: 'gated' };

// MARK: Mapping

const date = (value: string | null | undefined) => (value ? new Date(value) : null);

function toCheckpoints(topic: CanvasTopic): Checkpoint[] {
  const raw = topic.checkpoints?.length ? topic.checkpoints : (topic.assignment?.checkpoints ?? []);
  const required = Math.max(1, topic.reply_to_entry_required_count ?? 1);
  return raw
    .filter((c) => c.tag === 'reply_to_topic' || c.tag === 'reply_to_entry')
    .map((c) => ({
      kind: c.tag as Checkpoint['kind'],
      dueAt: date(c.due_at),
      points: c.points_possible ?? null,
      required: c.tag === 'reply_to_entry' ? required : 1,
    }))
    .sort((a, b) => (a.kind === 'reply_to_topic' ? -1 : b.kind === 'reply_to_topic' ? 1 : 0));
}

export function toDiscussionTopic(topic: CanvasTopic, fallback: DiscussionContext): DiscussionTopic {
  const html = topic.message ?? '';
  const name = topic.author?.display_name ?? topic.user_name;
  const canReply = topic.permissions?.reply ?? !topic.locked;
  const context = parseContextCode(topic.context_code) ?? fallback;
  const children = (topic.group_topic_children ?? []).map((c) => ({
    topicId: String(c.id),
    groupId: String(c.group_id),
  }));
  return {
    id: String(topic.id),
    context,
    courseId: context.type === 'course' ? context.id : '',
    title: topic.title,
    html,
    preview: htmlToText(html).slice(0, 280),
    htmlUrl: topic.html_url,
    author: name
      ? {
          id: String(topic.author?.id ?? ''),
          name,
          avatarUrl: topic.author?.avatar_image_url ?? null,
        }
      : null,
    postedAt: date(topic.posted_at ?? topic.delayed_post_at ?? topic.created_at),
    lastReplyAt: date(topic.last_reply_at),
    unread: topic.read_state === 'unread',
    unreadCount: topic.unread_count ?? 0,
    replyCount: topic.discussion_subentry_count ?? 0,
    pinned: !!topic.pinned,
    locked: !!topic.locked || topic.comments_disabled === true,
    isAnnouncement: !!topic.is_announcement,
    requireInitialPost: !!topic.require_initial_post,
    canSeePosts: topic.user_can_see_posts ?? true,
    canReply: canReply && !topic.locked_for_user,
    canAttach: !!topic.permissions?.attach && canReply && !topic.locked_for_user,
    threaded: topic.discussion_type !== 'not_threaded' && topic.discussion_type !== 'flat',
    sortOrder: topic.sort_order === 'asc' ? 'asc' : 'desc',
    sortOrderLocked: !!topic.sort_order_locked,
    allowRating: !!topic.allow_rating,
    onlyGradersCanRate: !!topic.only_graders_can_rate,
    attachments: topic.attachments ?? [],
    assignment: topic.assignment
      ? {
          id: String(topic.assignment.id),
          dueAt: date(topic.assignment.due_at),
          points: topic.assignment.points_possible ?? null,
        }
      : null,
    checkpoints: toCheckpoints(topic),
    anonymity:
      topic.anonymous_state === 'full_anonymity'
        ? 'full'
        : topic.anonymous_state === 'partial_anonymity'
          ? 'partial'
          : null,
    groupChildren: children,
    isGroupDiscussion: context.type === 'course' && (!!topic.group_category_id || children.length > 0),
    position: topic.position ?? null,
  };
}

/** A deleted reply stays only as the parent of replies that remain. */
function pruneDeleted(list: DiscussionEntry[]): DiscussionEntry[] {
  return list
    .map((e) => ({ ...e, replies: pruneDeleted(e.replies) }))
    .filter((e) => !e.deleted || e.replies.length > 0);
}

function toEntries(view: CanvasTopicView, userId: string): { entries: DiscussionEntry[]; count: number } {
  const people = new Map(view.participants.map((p) => [String(p.id), p]));
  const unread = new Set(view.unread_entries.map(String));
  let count = 0;

  const map = (raw: CanvasViewEntry): DiscussionEntry => {
    const authorId = raw.user_id ? String(raw.user_id) : null;
    const person = authorId ? people.get(authorId) : undefined;
    if (!raw.deleted) count += 1;
    return {
      id: String(raw.id),
      parentId: raw.parent_id ? String(raw.parent_id) : null,
      author: authorId
        ? {
            id: authorId,
            name: person?.display_name ?? raw.user_name ?? 'Unknown',
            avatarUrl: person?.avatar_image_url ?? null,
          }
        : null,
      ...(authorId && person?.display_name == null && raw.user_name == null
        ? { authorNameOrigin: { kind: 'unknown' as const } } : {}),
      anonymous: false,
      html: raw.message ?? '',
      createdAt: new Date(raw.created_at),
      updatedAt: new Date(raw.updated_at),
      edited: !!raw.editor_id && !raw.deleted && raw.updated_at !== raw.created_at,
      deleted: !!raw.deleted,
      unread: unread.has(String(raw.id)) && !raw.deleted,
      likes: raw.rating_sum ?? 0,
      liked: !!view.entry_ratings[String(raw.id)],
      mine: authorId === userId,
      attachments: raw.attachments ?? (raw.attachment ? [raw.attachment] : []),
      // Replies read top to bottom, oldest first, like a conversation.
      replies: (raw.replies ?? []).map(map).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    };
  };

  // The view is eventually consistent; entries Canvas hasn't folded in yet arrive flat.
  const clone = (n: CanvasViewEntry): CanvasViewEntry => ({ ...n, replies: (n.replies ?? []).map(clone) });
  const tree = view.view.map(clone);
  const byId = new Map<string, CanvasViewEntry>();
  const collect = (nodes: CanvasViewEntry[]) =>
    nodes.forEach((n) => {
      byId.set(String(n.id), n);
      collect(n.replies ?? []);
    });
  collect(tree);
  for (const extra of view.new_entries ?? []) {
    const existing = byId.get(String(extra.id));
    if (existing) {
      // An edit or a delete the view hasn't caught up with.
      const { replies: _replies, ...latest } = extra;
      Object.assign(existing, latest);
      continue;
    }
    const node: CanvasViewEntry = { ...extra, replies: [] };
    const parent = extra.parent_id ? byId.get(String(extra.parent_id)) : undefined;
    if (parent) parent.replies = [...(parent.replies ?? []), node];
    else tree.push(node);
    byId.set(String(extra.id), node);
  }

  // Newest threads first, the Canvas default.
  const entries = pruneDeleted(tree.map(map)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { entries, count };
}

// MARK: GraphQL

type GraphQLResponse<T> = { data?: T | null; errors?: { message: string }[] };

/** Validation errors from a mutation payload (Types::ValidationErrorType). */
type MutationErrors = { attribute?: string | null; message: string }[] | null;

const friendlyErrors: Record<string, string> = {
  'Insufficient Permissions': 'You can’t do that in this discussion.',
  'Insufficient attach permissions': 'This discussion doesn’t take attachments.',
  'not found': 'This post no longer exists. Pull to refresh the discussion.',
};

const graphqlError = (message: string) =>
  new CanvasError(Object.hasOwn(friendlyErrors, message) ? friendlyErrors[message] : message, 400, '/api/graphql');

const noResponseError = () => Object.assign(
  graphqlError('Canvas didn’t answer. Try again.'),
  { reason: 'discussion-no-response' as const },
);

/**
 * Sends one named GraphQL operation. Canvas answers 200 even when a query
 * fails, with `errors`; those throw like REST failures do.
 */
export async function graphql<T>(
  client: CanvasClient,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await client.request<GraphQLResponse<T>>('/api/graphql', {
    method: 'POST',
    body: { operationName, query, variables },
    signal,
  });
  if (response?.errors?.length) throw graphqlError(response.errors[0].message);
  if (!response?.data) throw noResponseError();
  return response.data;
}

function throwIfInvalid(errors: MutationErrors | undefined) {
  if (errors?.length) throw graphqlError(errors[0].message);
}

// MARK: Fetchers

const topicPath = (context: DiscussionContext, topicId: string) =>
  `${contextBase(context)}/discussion_topics/${topicId}`;

/** Every topic in a course or group except announcements, in Canvas's recent-activity order. */
export async function fetchDiscussions(
  client: CanvasClient,
  context: DiscussionContext,
  signal?: AbortSignal,
): Promise<DiscussionTopic[]> {
  const topics = await client.getAll<CanvasTopic>(
    `${contextBase(context)}/discussion_topics`,
    { order_by: 'recent_activity' },
    { signal, maxPages: 10 },
  );
  return topics.map((t) => toDiscussionTopic(t, context));
}

export async function fetchDiscussionTopic(
  client: CanvasClient,
  context: DiscussionContext,
  topicId: string,
  signal?: AbortSignal,
): Promise<DiscussionTopic> {
  try {
    const topic = await client.get<CanvasTopic>(topicPath(context, topicId), undefined, signal);
    return toDiscussionTopic(topic, context);
  } catch (error) {
    // Canvas won't show an anonymous topic on its own (404), but lists it with the rest.
    if (!(error instanceof CanvasError) || error.status !== 404) throw error;
    const list = await fetchDiscussions(client, context, signal);
    const found = list.find((t) => t.id === topicId);
    if (found) return found;
    const announcements = await client.getAll<CanvasTopic>(
      `${contextBase(context)}/discussion_topics`,
      { only_announcements: true },
      { signal, maxPages: 5 },
    );
    const announcement = announcements.find((t) => String(t.id) === topicId);
    if (announcement) return toDiscussionTopic(announcement, context);
    throw error;
  }
}

/** One node of `discussionEntriesConnection`, for anonymous topics (Types::DiscussionEntryType). */
type GraphQLEntry = {
  _id: string;
  parentId?: string | null;
  message?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  editedAt?: string | null;
  deleted?: boolean | null;
  ratingSum?: number | null;
  entryParticipant?: { read?: boolean | null; rating?: boolean | null } | null;
  author?: { _id: string; name?: string | null; avatarUrl?: string | null } | null;
  anonymousAuthor?: { id: string; shortName: string; avatarUrl?: string | null } | null;
  attachment?: {
    _id: string;
    displayName?: string | null;
    url?: string | null;
    contentType?: string | null;
    size?: string | number | null;
    thumbnailUrl?: string | null;
  } | null;
};

const ANONYMOUS_THREAD_QUERY = `query EaselAnonymousThread($topicId: ID!) {
  legacyNode(_id: $topicId, type: Discussion) {
    ... on Discussion {
      initialPostRequiredForCurrentUser
      discussionEntriesConnection(first: 500) {
        nodes {
          _id parentId message createdAt updatedAt editedAt deleted ratingSum
          entryParticipant { read rating }
          author { _id name avatarUrl }
          anonymousAuthor { id shortName avatarUrl }
          attachment { _id displayName url contentType size thumbnailUrl }
        }
      }
    }
  }
}`;

type AnonymousThreadData = {
  legacyNode: {
    initialPostRequiredForCurrentUser?: boolean | null;
    discussionEntriesConnection?: { nodes: GraphQLEntry[] } | null;
  } | null;
};

/** "Anonymous 4f", or "Anonymous (you)" for the student's own posts (Canvas sends `current_user`). */
export function anonymousName(shortName: string): string {
  return shortName === 'current_user' ? 'Anonymous (you)' : `Anonymous ${shortName}`;
}

/**
 * The thread of an anonymous topic. Canvas's REST view hides these (404), so
 * they come from GraphQL, which names each poster by a per-topic stand-in.
 * Instructors keep their names, as on the web.
 */
async function fetchAnonymousThread(
  client: CanvasClient,
  topicId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<DiscussionThread> {
  const data = await graphql<AnonymousThreadData>(
    client,
    'EaselAnonymousThread',
    ANONYMOUS_THREAD_QUERY,
    { topicId },
    signal,
  );
  if (!data.legacyNode) throw graphqlError('not found');
  if (data.legacyNode.initialPostRequiredForCurrentUser) return { status: 'gated' };
  const nodes = data.legacyNode.discussionEntriesConnection?.nodes ?? [];
  const byId = new Map<string, DiscussionEntry>();
  let count = 0;
  for (const n of nodes) {
    const anonymous = !n.author && !!n.anonymousAuthor;
    const mine = anonymous ? n.anonymousAuthor?.shortName === 'current_user' : n.author?._id === userId;
    if (!n.deleted) count += 1;
    byId.set(String(n._id), {
      id: String(n._id),
      parentId: n.parentId ? String(n.parentId) : null,
      author: n.author
        ? { id: String(n.author._id), name: n.author.name ?? 'Unknown', avatarUrl: n.author.avatarUrl ?? null }
        : n.anonymousAuthor
          ? { id: `anonymous_${n.anonymousAuthor.id}`, name: anonymousName(n.anonymousAuthor.shortName), avatarUrl: null }
          : null,
      ...(n.author
        ? n.author.name == null ? { authorNameOrigin: { kind: 'unknown' as const } } : {}
        : n.anonymousAuthor
          ? { authorNameOrigin: { kind: 'anonymous' as const, token: n.anonymousAuthor.shortName } }
          : {}),
      anonymous,
      html: n.message ?? '',
      createdAt: new Date(n.createdAt),
      updatedAt: new Date(n.updatedAt ?? n.createdAt),
      edited: !!n.editedAt && !n.deleted,
      deleted: !!n.deleted,
      unread: n.entryParticipant?.read === false && !n.deleted,
      likes: n.ratingSum ?? 0,
      liked: !!n.entryParticipant?.rating,
      mine,
      attachments: n.attachment
        ? [
            {
              id: String(n.attachment._id),
              display_name: n.attachment.displayName ?? 'Attachment',
              filename: n.attachment.displayName ?? 'attachment',
              'content-type': n.attachment.contentType ?? 'application/octet-stream',
              url: n.attachment.url ?? '',
              size: Number(n.attachment.size ?? 0),
              thumbnail_url: n.attachment.thumbnailUrl ?? null,
            },
          ]
        : [],
      replies: [],
    });
  }
  const roots: DiscussionEntry[] = [];
  for (const e of byId.values()) {
    const parent = e.parentId ? byId.get(e.parentId) : undefined;
    if (parent) parent.replies.push(e);
    else roots.push(e);
  }
  const oldestFirst = (list: DiscussionEntry[]): DiscussionEntry[] =>
    list
      .map((e) => ({ ...e, replies: oldestFirst(e.replies) }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const entries = pruneDeleted(oldestFirst(roots)).reverse();
  const unreadIds = [...byId.values()].filter((e) => e.unread).map((e) => e.id);
  return { status: 'visible', entries, count, unreadIds };
}

export async function fetchDiscussionThread(
  client: CanvasClient,
  context: DiscussionContext,
  topicId: string,
  userId: string,
  anonymous: boolean,
  signal?: AbortSignal,
): Promise<DiscussionThread> {
  if (anonymous) return fetchAnonymousThread(client, topicId, userId, signal);
  try {
    const view = await client.get<CanvasTopicView>(
      `${topicPath(context, topicId)}/view`,
      { include_new_entries: 1 },
      signal,
    );
    const { entries, count } = toEntries(view, userId);
    return { status: 'visible', entries, count, unreadIds: view.unread_entries.map(String) };
  } catch (error) {
    // Canvas answers 403 "require_initial_post" until the student has posted.
    if (error instanceof CanvasError && error.status === 403) return { status: 'gated' };
    throw error;
  }
}

/** What the student may do with their own posts. Courses can turn editing and deleting off. */
export type OwnPostPermissions = {
  /** Entry IDs the student may edit and delete. */
  manageable: string[];
  /** Entry IDs they may not. */
  locked: string[];
  /** Partially anonymous topics: whether the student may post without their name. */
  canReplyAnonymously: boolean;
};

const PERMISSIONS_QUERY = `query EaselDiscussionPermissions($topicId: ID!, $userId: String) {
  legacyNode(_id: $topicId, type: Discussion) {
    ... on Discussion {
      permissions { attach reply rate }
      canReplyAnonymously
      discussionEntriesConnection(userSearchId: $userId, first: 100) {
        nodes { _id permissions { update delete } }
      }
    }
  }
}`;

type PermissionsData = {
  legacyNode: {
    canReplyAnonymously?: boolean | null;
    discussionEntriesConnection?: {
      nodes: { _id: string; permissions?: { update?: boolean | null; delete?: boolean | null } | null }[];
    } | null;
  } | null;
};

export async function fetchOwnPostPermissions(
  client: CanvasClient,
  topicId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<OwnPostPermissions> {
  const data = await graphql<PermissionsData>(
    client,
    'EaselDiscussionPermissions',
    PERMISSIONS_QUERY,
    { topicId, userId },
    signal,
  );
  const nodes = data.legacyNode?.discussionEntriesConnection?.nodes ?? [];
  const manageable = nodes.filter((n) => n.permissions?.update && n.permissions?.delete).map((n) => n._id);
  return {
    manageable,
    locked: nodes.filter((n) => !manageable.includes(n._id)).map((n) => n._id),
    canReplyAnonymously: !!data.legacyNode?.canReplyAnonymously,
  };
}

/** Someone who can be @-mentioned in a topic. */
export type MentionableUser = { id: string; name: string; shortName: string; pronouns: string | null };

const MENTIONABLE_QUERY = `query EaselMentionableUsers($topicId: ID!, $search: String, $first: Int) {
  legacyNode(_id: $topicId, type: Discussion) {
    ... on Discussion {
      mentionableUsersConnection(searchTerm: $search, first: $first) {
        nodes { _id name shortName pronouns }
      }
    }
  }
}`;

type MentionableData = {
  legacyNode: {
    mentionableUsersConnection?: {
      nodes: { _id: string; name: string; shortName: string; pronouns?: string | null }[];
    } | null;
  } | null;
};

const MENTION_LIMIT = 8;

export async function fetchMentionableUsers(
  client: CanvasClient,
  context: DiscussionContext,
  topicId: string,
  search: string,
  signal?: AbortSignal,
): Promise<MentionableUser[]> {
  try {
    const data = await graphql<MentionableData>(
      client,
      'EaselMentionableUsers',
      MENTIONABLE_QUERY,
      { topicId, search: search || null, first: MENTION_LIMIT },
      signal,
    );
    return (data.legacyNode?.mentionableUsersConnection?.nodes ?? []).map((u) => ({
      id: String(u._id),
      name: u.name,
      shortName: u.shortName || u.name,
      pronouns: u.pronouns ?? null,
    }));
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    // Without GraphQL (scoped developer keys), the course's messageable people are close.
    const people = await client.get<{ id: string; name: string; full_name?: string; type?: string | null }[]>(
      '/api/v1/search/recipients',
      { search, context: contextCode(context), type: 'user', per_page: MENTION_LIMIT },
      signal,
    );
    return people
      .filter((p) => !p.type || p.type === 'user')
      .map((p) => ({ id: String(p.id), name: p.full_name || p.name, shortName: p.name, pronouns: null }));
  }
}

// MARK: Hooks

/** Every topic in a course or group except announcements, in Canvas's recent-activity order. */
export function useDiscussions(context: DiscussionContext) {
  return useCanvasQuery(['discussions', contextKey(context)], (client, signal) =>
    fetchDiscussions(client, context, signal),
  );
}

export function useCourseDiscussions(courseId: string) {
  return useDiscussions(courseContext(courseId));
}

export function useDiscussionTopic(context: DiscussionContext, topicId: string) {
  const discussion = useListPlaceholder<DiscussionTopic[], DiscussionTopic>(
    ['discussions', contextKey(context)], (list) => list.find((item) => item.id === topicId),
  );
  const announcement = useListPlaceholder<Announcement[], DiscussionTopic>(['announcements'], (list) => {
    const item = list.find((item) => item.id === topicId &&
      (context.type === 'course' ? item.courseId === context.id : item.htmlUrl.includes(`/groups/${context.id}/`)));
    return item ? { ...toDiscussionTopic({ id: item.id, title: item.title, message: item.html,
      author: { display_name: item.author.name, avatar_image_url: item.author.avatarUrl },
      posted_at: item.postedAt.toISOString(), html_url: item.htmlUrl, is_announcement: true } as CanvasTopic, context),
      canReply: false, canAttach: false, canSeePosts: false } : undefined;
  });
  return useCanvasQuery<DiscussionTopic>(['discussion', contextKey(context), topicId], (client, signal) =>
    fetchDiscussionTopic(client, context, topicId, signal),
    { placeholderData: () => discussion() ?? announcement() },
  );
}

export function useDiscussionThread(
  context: DiscussionContext,
  topicId: string,
  options: { enabled: boolean; anonymous: boolean },
) {
  const { account } = useCanvas();
  return useCanvasQuery(
    ['discussion', contextKey(context), topicId, 'view'],
    (client, signal) =>
      fetchDiscussionThread(client, context, topicId, account.user.id, options.anonymous, signal),
    { enabled: options.enabled },
  );
}

/**
 * Edit and delete rights for the student's own posts. When GraphQL isn't
 * available this errors, and screens offer the actions and let Canvas decide.
 */
export function useOwnPostPermissions(context: DiscussionContext, topicId: string, enabled = true) {
  const { account } = useCanvas();
  return useCanvasQuery(
    ['discussion', contextKey(context), topicId, 'permissions'],
    (client, signal) => fetchOwnPostPermissions(client, topicId, account.user.id, signal),
    { enabled, retry: false, staleTime: 5 * 60_000 },
  );
}

/** People matching an @-mention as it's typed. `search` null means no mention is being typed. */
export function useMentionableUsers(context: DiscussionContext, topicId: string, search: string | null) {
  return useCanvasQuery(
    ['discussion', contextKey(context), topicId, 'mentionable', search ?? ''],
    (client, signal) => fetchMentionableUsers(client, context, topicId, search ?? '', signal),
    { enabled: search !== null, staleTime: 5 * 60_000, placeholderData: (previous) => previous },
  );
}

// MARK: Cache updates

type Patch<T> = (item: T) => T;

/** Applies a change to one topic everywhere it's cached: lists, feeds, and its detail. */
export function patchTopicEverywhere(
  queryClient: QueryClient,
  accountKey: string,
  context: DiscussionContext,
  topicId: string,
  patch: { topic?: Patch<DiscussionTopic>; announcement?: Patch<Announcement> },
) {
  if (patch.announcement) {
    const apply = patch.announcement;
    queryClient.setQueriesData<Announcement[]>({ queryKey: [accountKey, 'announcements'] }, (list) =>
      list?.map((a) => (a.id === topicId ? apply(a) : a)),
    );
  }
  if (patch.topic) {
    const apply = patch.topic;
    const key = contextKey(context);
    queryClient.setQueryData<DiscussionTopic[]>([accountKey, 'discussions', key], (list) =>
      list?.map((t) => (t.id === topicId ? apply(t) : t)),
    );
    queryClient.setQueryData<DiscussionTopic>([accountKey, 'discussion', key, topicId], (t) =>
      t ? apply(t) : t,
    );
  }
}

function mapEntries(entries: DiscussionEntry[], patch: Patch<DiscussionEntry>): DiscussionEntry[] {
  return entries.map((e) => patch({ ...e, replies: mapEntries(e.replies, patch) }));
}

function patchEntry(
  entries: DiscussionEntry[],
  id: string,
  patch: Patch<DiscussionEntry>,
): DiscussionEntry[] {
  return entries.map((e) =>
    e.id === id ? patch(e) : e.replies.length ? { ...e, replies: patchEntry(e.replies, id, patch) } : e,
  );
}

const threadKey = (accountKey: string, context: DiscussionContext, topicId: string) => [
  accountKey,
  'discussion',
  contextKey(context),
  topicId,
  'view',
];

/** Changes the cached thread and returns a function that puts it back. */
function patchThread(
  queryClient: QueryClient,
  accountKey: string,
  { context, topicId }: TopicRef,
  patch: (entries: DiscussionEntry[]) => DiscussionEntry[],
): () => void {
  const key = threadKey(accountKey, context, topicId);
  const previous = queryClient.getQueryData<DiscussionThread>(key);
  queryClient.setQueryData<DiscussionThread>(key, (thread) =>
    thread?.status === 'visible' ? { ...thread, entries: patch(thread.entries) } : thread,
  );
  return () => queryClient.setQueryData(key, previous);
}

type Rollback = { rollback?: () => void } | undefined;

// MARK: Mutations

export type TopicRef = { context: DiscussionContext; topicId: string };

/**
 * Marks a topic read when it opens, and clears its unread state in every cached
 * list right away, so Home's unread dot is gone by the time the student goes back.
 */
export function useMarkTopicRead() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    (client, { context, topicId }: TopicRef) => client.put<void>(`${topicPath(context, topicId)}/read`),
    {
      onMutate: ({ context, topicId }) => {
        patchTopicEverywhere(queryClient, accountKey, context, topicId, {
          topic: (t) => ({ ...t, unread: false }),
          announcement: (a) => ({ ...a, unread: false }),
        });
        queryClient.setQueriesData<ActivityItem[]>({ queryKey: [accountKey, 'activity'] }, (items) =>
          items?.map((i) => (i.topicId === topicId ? { ...i, unread: false } : i)),
        );
      },
    },
  );
}

/**
 * Marks replies read as the student scrolls past them. Lists update now; the
 * thread keeps its unread markers for this visit so new replies stay findable.
 */
export function useMarkEntriesRead() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    async (client, { context, topicId, entryIds }: TopicRef & { entryIds: string[] }) => {
      await Promise.all(
        entryIds.map((id) => client.put<void>(`${topicPath(context, topicId)}/entries/${id}/read`)),
      );
    },
    {
      onMutate: ({ context, topicId, entryIds }) => {
        patchTopicEverywhere(queryClient, accountKey, context, topicId, {
          topic: (t) => ({ ...t, unreadCount: Math.max(0, t.unreadCount - entryIds.length) }),
        });
      },
    },
  );
}

/** "Mark all as read": the post and every reply, with the markers cleared right away. */
export function useMarkAllRead() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    (client, { context, topicId }: TopicRef) => client.put<void>(`${topicPath(context, topicId)}/read_all`),
    {
      onMutate: (ref) => {
        const rollback = patchThread(queryClient, accountKey, ref, (entries) =>
          mapEntries(entries, (e) => (e.unread ? { ...e, unread: false } : e)),
        );
        patchTopicEverywhere(queryClient, accountKey, ref.context, ref.topicId, {
          topic: (t) => ({ ...t, unread: false, unreadCount: 0 }),
          announcement: (a) => ({ ...a, unread: false }),
        });
        queryClient.setQueriesData<ActivityItem[]>({ queryKey: [accountKey, 'activity'] }, (items) =>
          items?.map((i) => (i.topicId === ref.topicId ? { ...i, unread: false } : i)),
        );
        return { rollback };
      },
      onError: (_error, _ref, context) => (context as Rollback)?.rollback?.(),
    },
  );
}

/** Marks one reply unread again, so the student can come back to it. */
export function useMarkEntryUnread() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    (client, { context, topicId, entryId }: TopicRef & { entryId: string }) =>
      client.delete<void>(`${topicPath(context, topicId)}/entries/${entryId}/read`),
    {
      onMutate: (ref) => {
        const rollback = patchThread(queryClient, accountKey, ref, (entries) =>
          patchEntry(entries, ref.entryId, (e) => ({ ...e, unread: true })),
        );
        patchTopicEverywhere(queryClient, accountKey, ref.context, ref.topicId, {
          topic: (t) => ({ ...t, unreadCount: t.unreadCount + 1 }),
        });
        return { rollback };
      },
      onError: (_error, _ref, context) => (context as Rollback)?.rollback?.(),
    },
  );
}

function useRefreshTopic() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return (context: DiscussionContext, topicId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [accountKey, 'discussion', contextKey(context), topicId] }),
      queryClient.invalidateQueries({ queryKey: [accountKey, 'discussions', contextKey(context)] }),
    ]);
}

const CREATE_ENTRY = `mutation EaselCreateDiscussionEntry($topicId: ID!, $message: String!, $parentId: ID, $fileId: ID, $anonymous: Boolean) {
  createDiscussionEntry(input: { discussionTopicId: $topicId, message: $message, parentEntryId: $parentId, fileId: $fileId, isAnonymousAuthor: $anonymous }) {
    discussionEntry { _id }
    errors { attribute message }
  }
}`;

type EntryPayload = { discussionEntry: { _id: string } | null; errors?: MutationErrors };

export type EntryDraft = TopicRef & {
  /** HTML from the rich editor, mentions included. */
  html: string;
  parentId?: string | null;
  /** An uploaded file (see `useAttachmentUploads`). Canvas allows one per post. */
  fileId?: string | null;
  /** Post without the student's name, in partially anonymous topics. */
  anonymous?: boolean;
};

/** Replies to the topic, or to an entry when `parentId` is set (CONTENT-3). */
export function usePostEntry() {
  const refresh = useRefreshTopic();
  return useCanvasMutation(
    async (client, { topicId, parentId, html, fileId, anonymous }: EntryDraft) => {
      const data = await graphql<{ createDiscussionEntry: EntryPayload | null }>(
        client,
        'EaselCreateDiscussionEntry',
        CREATE_ENTRY,
        {
          topicId,
          message: html,
          parentId: parentId ?? null,
          fileId: fileId ?? null,
          anonymous: anonymous ? true : null,
        },
      );
      throwIfInvalid(data.createDiscussionEntry?.errors);
      return data.createDiscussionEntry?.discussionEntry?._id ?? null;
    },
    { onSuccess: (_id, { context, topicId }) => refresh(context, topicId) },
  );
}

const UPDATE_ENTRY = `mutation EaselUpdateDiscussionEntry($entryId: ID!, $message: String, $fileId: ID, $removeAttachment: Boolean) {
  updateDiscussionEntry(input: { discussionEntryId: $entryId, message: $message, fileId: $fileId, removeAttachment: $removeAttachment }) {
    discussionEntry { _id }
    errors { attribute message }
  }
}`;

export type EntryEdit = TopicRef & {
  entryId: string;
  html: string;
  /** A newly uploaded file to attach, replacing any current one. */
  fileId?: string | null;
  removeAttachment?: boolean;
  /** The attachments the post will show, for the update before Canvas answers. */
  attachments: CanvasAttachment[];
};

/** Edits the student's own post. The thread shows the change before Canvas answers. */
export function useUpdateEntry() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  const refresh = useRefreshTopic();
  return useCanvasMutation(
    async (client, { entryId, html, fileId, removeAttachment }: EntryEdit) => {
      const data = await graphql<{ updateDiscussionEntry: EntryPayload | null }>(
        client,
        'EaselUpdateDiscussionEntry',
        UPDATE_ENTRY,
        { entryId, message: html, fileId: fileId ?? null, removeAttachment: removeAttachment ?? null },
      );
      throwIfInvalid(data.updateDiscussionEntry?.errors);
    },
    {
      onMutate: (edit) => {
        const rollback = patchThread(queryClient, accountKey, edit, (entries) =>
          patchEntry(entries, edit.entryId, (e) => ({
            ...e,
            html: edit.html,
            edited: true,
            updatedAt: new Date(),
            attachments: edit.attachments,
          })),
        );
        return { rollback };
      },
      onError: (_error, _edit, context) => (context as Rollback)?.rollback?.(),
      onSettled: (_data, _error, { context, topicId }) => refresh(context, topicId),
    },
  );
}

/** Deletes the student's own post. Replies to it stay, under "Deleted reply". */
export function useDeleteEntry() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  const refresh = useRefreshTopic();
  return useCanvasMutation(
    (client, { context, topicId, entryId }: TopicRef & { entryId: string }) =>
      client.delete<void>(`${topicPath(context, topicId)}/entries/${entryId}`),
    {
      onMutate: (ref) => {
        const rollback = patchThread(queryClient, accountKey, ref, (entries) =>
          pruneDeleted(
            patchEntry(entries, ref.entryId, (e) => ({
              ...e,
              deleted: true,
              html: '',
              attachments: [],
              unread: false,
            })),
          ),
        );
        return { rollback };
      },
      onError: (_error, _ref, context) => (context as Rollback)?.rollback?.(),
      onSettled: (_data, _error, { context, topicId }) => refresh(context, topicId),
    },
  );
}

/** Likes (rating 1) or unlikes (rating 0) an entry, updating the count right away. */
export function useRateEntry() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    (client, { context, topicId, entryId, liked }: TopicRef & { entryId: string; liked: boolean }) =>
      client.post<void>(`${topicPath(context, topicId)}/entries/${entryId}/rating`, {
        rating: liked ? 1 : 0,
      }),
    {
      onMutate: (ref) => {
        const rollback = patchThread(queryClient, accountKey, ref, (entries) =>
          patchEntry(entries, ref.entryId, (e) =>
            e.liked === ref.liked
              ? e
              : { ...e, liked: ref.liked, likes: Math.max(0, e.likes + (ref.liked ? 1 : -1)) },
          ),
        );
        return { rollback };
      },
      onError: (_error, _ref, context) => (context as Rollback)?.rollback?.(),
    },
  );
}

// MARK: Starting a discussion (CONTENT-5)

/** What the student may do when starting a topic here. */
export type TopicCreation = {
  canCreate: boolean;
  /** The course lets students attach files to discussions (`allow_student_forum_attachments`). */
  canAttach: boolean;
};

type CourseSettings = {
  allow_student_discussion_topics?: boolean;
  allow_student_forum_attachments?: boolean;
};

async function courseCreation(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<TopicCreation> {
  const [course, settings] = await Promise.all([
    client.get<{ permissions?: { create_discussion_topic?: boolean } }>(
      `/api/v1/courses/${courseId}`,
      { include: ['permissions'] },
      signal,
    ),
    client
      .get<CourseSettings>(`/api/v1/courses/${courseId}/settings`, undefined, signal)
      .catch((): CourseSettings => ({})),
  ]);
  const canAttach = settings.allow_student_forum_attachments ?? true;
  // course.rb#serialize_permissions: the forum right plus the course setting.
  const direct = course.permissions?.create_discussion_topic;
  if (typeof direct === 'boolean') return { canCreate: direct, canAttach };
  if (settings.allow_student_discussion_topics === false) return { canCreate: false, canAttach };
  const rights = await client
    .get<{ create_forum?: boolean }>(`/api/v1/courses/${courseId}/permissions`, { permissions: ['create_forum'] }, signal)
    .catch(() => ({ create_forum: false }));
  return { canCreate: !!rights.create_forum, canAttach };
}

export async function fetchTopicCreation(
  client: CanvasClient,
  context: DiscussionContext,
  signal?: AbortSignal,
): Promise<TopicCreation> {
  if (context.type === 'course') return courseCreation(client, context.id, signal);
  const group = await client.get<{ course_id?: string | null; permissions?: { create_discussion_topic?: boolean } }>(
    `/api/v1/groups/${context.id}`,
    { include: ['permissions'] },
    signal,
  );
  let canAttach = true;
  if (group.course_id) {
    const settings = await client
      .get<CourseSettings>(`/api/v1/courses/${group.course_id}/settings`, undefined, signal)
      .catch((): CourseSettings => ({}));
    canAttach = settings.allow_student_forum_attachments ?? true;
  }
  return { canCreate: !!group.permissions?.create_discussion_topic, canAttach };
}

/** Whether "Start a discussion" shows, and whether it takes a file. */
export function useTopicCreation(context: DiscussionContext) {
  return useCanvasQuery(
    ['discussions', contextKey(context), 'creation'],
    (client, signal) => fetchTopicCreation(client, context, signal),
    { staleTime: 10 * 60_000 },
  );
}

export type NewTopic = {
  context: DiscussionContext;
  title: string;
  /** HTML from the rich editor. */
  html: string;
  /** An uploaded file's ID. */
  fileId: string | null;
  /** Replies can nest. Off makes a flat discussion. */
  threaded: boolean;
  /** Classmates' replies stay hidden until each student posts. */
  requireInitialPost: boolean;
  allowRating: boolean;
};

const CREATE_TOPIC = `mutation EaselCreateDiscussionTopic($contextId: ID!, $contextType: DiscussionTopicContextType!, $title: String!, $message: String, $fileId: ID, $discussionType: DiscussionTopicDiscussionType, $requireInitialPost: Boolean, $allowRating: Boolean) {
  createDiscussionTopic(input: { contextId: $contextId, contextType: $contextType, title: $title, message: $message, fileId: $fileId, discussionType: $discussionType, requireInitialPost: $requireInitialPost, allowRating: $allowRating, published: true }) {
    discussionTopic { _id }
    errors { attribute message }
  }
}`;

type TopicPayload = { discussionTopic: { _id: string } | null; errors?: MutationErrors };

/**
 * Starts a discussion (CONTENT-5). GraphQL, because it takes an uploaded file's
 * ID; REST only takes raw multipart bytes. Students' topics must be published
 * (create_discussion_topic.rb), and Canvas may drop options the school reserves
 * for instructors (`default_discussion_options`).
 */
export function useCreateTopic() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    async (client, topic: NewTopic) => {
      const data = await graphql<{ createDiscussionTopic: TopicPayload | null }>(
        client,
        'EaselCreateDiscussionTopic',
        CREATE_TOPIC,
        {
          contextId: topic.context.id,
          contextType: topic.context.type === 'course' ? 'Course' : 'Group',
          title: topic.title,
          message: topic.html,
          fileId: topic.fileId,
          discussionType: topic.threaded ? 'threaded' : 'not_threaded',
          requireInitialPost: topic.requireInitialPost,
          allowRating: topic.allowRating,
        },
      );
      throwIfInvalid(data.createDiscussionTopic?.errors);
      const id = data.createDiscussionTopic?.discussionTopic?._id;
      if (!id) throw noResponseError();
      return String(id);
    },
    {
      onSuccess: (_id, { context }) =>
        queryClient.invalidateQueries({ queryKey: [accountKey, 'discussions', contextKey(context)] }),
    },
  );
}
