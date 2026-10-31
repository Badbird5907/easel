import { useQueryClient } from '@tanstack/react-query';

import type { CanvasClient } from '../client';
import { htmlToText } from '../html';
import type { Announcement } from '../models';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';
import type { CanvasDiscussionTopic } from '../types';

export function toAnnouncement(topic: CanvasDiscussionTopic): Announcement {
  const courseId = topic.context_code?.startsWith('course_')
    ? topic.context_code.slice('course_'.length)
    : null;
  return {
    id: String(topic.id),
    courseId,
    title: topic.title,
    author: {
      name: topic.author?.display_name ?? topic.user_name ?? 'Unknown',
      avatarUrl: topic.author?.avatar_image_url ?? null,
    },
    ...(topic.author?.display_name == null && topic.user_name == null
      ? { authorNameFallback: 'unknown' as const } : {}),
    postedAt: new Date(topic.posted_at ?? topic.delayed_post_at ?? Date.now()),
    preview: htmlToText(topic.message ?? '').slice(0, 280),
    html: topic.message ?? '',
    unread: topic.read_state === 'unread',
    htmlUrl: topic.html_url,
  };
}

export async function fetchAnnouncements(
  client: CanvasClient,
  courseIds: string[],
  options: { days?: number; signal?: AbortSignal } = {},
): Promise<Announcement[]> {
  if (courseIds.length === 0) return [];
  const start = new Date();
  start.setDate(start.getDate() - (options.days ?? 30));
  const topics = await client.getAll<CanvasDiscussionTopic>(
    '/api/v1/announcements',
    {
      context_codes: courseIds.map((id) => `course_${id}`),
      start_date: start.toISOString(),
      end_date: new Date().toISOString(),
    },
    { signal: options.signal, maxPages: 5 },
  );
  return topics.map(toAnnouncement).sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
}

/** Recent announcements across the given courses, newest first. */
export function useAnnouncements(courseIds: string[] | undefined, days = 30) {
  return useCanvasQuery(
    ['announcements', days, ...(courseIds ?? [])],
    (client, signal) => fetchAnnouncements(client, courseIds ?? [], { days, signal }),
    { enabled: courseIds !== undefined },
  );
}

/** How far back the combined feed reaches: about a semester. */
export const FEED_DAYS = 180;

/** Every announcement in one course, newest first. Uses the course's topic list, so it isn't date-limited. */
export async function fetchCourseAnnouncements(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<Announcement[]> {
  const topics = await client.getAll<CanvasDiscussionTopic>(
    `/api/v1/courses/${courseId}/discussion_topics`,
    { only_announcements: true },
    { signal, maxPages: 5 },
  );
  return topics
    .map((t) => toAnnouncement({ ...t, context_code: t.context_code ?? `course_${courseId}` }))
    .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
}

export function useCourseAnnouncements(courseId: string) {
  return useCanvasQuery(['announcements', 'course', courseId], (client, signal) =>
    fetchCourseAnnouncements(client, courseId, signal),
  );
}

/** A group's announcements, newest first. Group topics carry `group_<id>` context codes, so no course. */
export async function fetchGroupAnnouncements(
  client: CanvasClient,
  groupId: string,
  signal?: AbortSignal,
): Promise<Announcement[]> {
  const topics = await client.getAll<CanvasDiscussionTopic>(
    `/api/v1/groups/${groupId}/discussion_topics`,
    { only_announcements: true },
    { signal, maxPages: 5 },
  );
  return topics.map(toAnnouncement).sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
}

/** A course's or group's announcements (ANN-2, COURSE-7). */
export function useContextAnnouncements(context: { type: 'course' | 'group'; id: string }) {
  return useCanvasQuery(['announcements', context.type, context.id], (client, signal) =>
    context.type === 'course'
      ? fetchCourseAnnouncements(client, context.id, signal)
      : fetchGroupAnnouncements(client, context.id, signal),
  );
}

// MARK: Global announcements (ANN-5, HOME-5)

/** `GET /api/v1/accounts/self/account_notifications` (lib/api/v1/account_notifications.rb) */
export type CanvasAccountNotification = {
  id: string;
  subject: string;
  message: string;
  start_at: string | null;
  end_at: string | null;
  icon?: 'warning' | 'information' | 'question' | 'error' | 'calendar';
};

export type AccountNotification = {
  id: string;
  subject: string;
  html: string;
  kind: NonNullable<CanvasAccountNotification['icon']>;
  startAt: Date | null;
  endAt: Date | null;
};

export function toAccountNotification(n: CanvasAccountNotification): AccountNotification {
  return {
    id: String(n.id),
    subject: n.subject,
    html: n.message ?? '',
    kind: n.icon ?? 'information',
    startAt: n.start_at ? new Date(n.start_at) : null,
    endAt: n.end_at ? new Date(n.end_at) : null,
  };
}

export async function fetchAccountNotifications(
  client: CanvasClient,
  signal?: AbortSignal,
): Promise<AccountNotification[]> {
  const list = await client.getAll<CanvasAccountNotification>(
    '/api/v1/accounts/self/account_notifications',
    undefined,
    { signal, maxPages: 2 },
  );
  return list.map(toAccountNotification);
}

/** Active school-wide announcements the student hasn't dismissed. */
export function useAccountNotifications() {
  return useCanvasQuery(['account-notifications'], fetchAccountNotifications);
}

/** Dismisses one for this student only. The card leaves right away and comes back if Canvas refuses. */
export function useDismissAccountNotification() {
  const queryClient = useQueryClient();
  const key = [useAccountKey(), 'account-notifications'];
  return useCanvasMutation(
    (client, id: string) => client.delete<unknown>(`/api/v1/accounts/self/account_notifications/${id}`),
    {
      onMutate: async (id) => {
        await queryClient.cancelQueries({ queryKey: key });
        const previous = queryClient.getQueryData<AccountNotification[]>(key);
        queryClient.setQueryData<AccountNotification[]>(key, (list) => list?.filter((n) => n.id !== id));
        return { previous };
      },
      onError: (_error, _id, context) => {
        const previous = (context as { previous?: AccountNotification[] } | undefined)?.previous;
        if (previous) queryClient.setQueryData(key, previous);
      },
    },
  );
}
