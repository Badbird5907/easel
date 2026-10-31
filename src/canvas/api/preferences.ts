import { useQueryClient } from '@tanstack/react-query';

import type { CanvasClient } from '../client';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';

/*
 * Canvas notification preferences (SET-4): how often Canvas emails, texts, or
 * pushes each kind of notification. Canvas stores one frequency per
 * notification and channel (notification_preferences_controller.rb); the
 * official apps and Canvas web show them grouped by category, so Easel does too.
 */

/** `GET /api/v1/users/self/communication_channels` (lib/api/v1/communication_channel.rb). */
type CanvasChannel = {
  id: string;
  address: string;
  type: 'email' | 'sms' | 'push' | string;
  position: number;
  user_id: string;
  workflow_state: 'unconfirmed' | 'active' | 'retired' | string;
};

/** `GET .../notification_preferences` (lib/api/v1/notification_policy.rb). */
type CanvasNotificationPreference = {
  href?: string;
  notification: string;
  category: string;
  frequency: Frequency;
};

export type Frequency = 'immediately' | 'daily' | 'weekly' | 'never';

export type ChannelType = 'email' | 'sms' | 'push';

export type Channel = {
  id: string;
  type: ChannelType;
  address: string;
  confirmed: boolean;
};

export type PreferenceCategory = {
  /** Canvas's category slug, e.g. `due_date`. */
  id: string;
  title: string;
  /** Verbatim Canvas label for an unknown category; legacy title remains compatible. */
  rawTitle?: string;
  description: string;
  group: string;
  /** Stable presentation group; optional for previously cached query data. */
  groupId?: PreferenceGroupId;
  /** What Canvas uses for the category: the first notification's frequency, as the official apps show it. */
  frequency: Frequency;
  /** Every notification in the category, for updating them together. */
  notifications: string[];
};

export type PreferenceGroupId = 'course' | 'discussions' | 'inbox' | 'scheduling' | 'groups' | 'conferences' | 'other';

export type PreferenceGroup = { id?: PreferenceGroupId; title: string; categories: PreferenceCategory[] };

const channelOrder: ChannelType[] = ['email', 'sms', 'push'];

export async function fetchChannels(client: CanvasClient, signal?: AbortSignal): Promise<Channel[]> {
  const channels = await client.getAll<CanvasChannel>(
    '/api/v1/users/self/communication_channels',
    undefined,
    {
      signal,
    },
  );
  return channels
    .filter((c): c is CanvasChannel & { type: ChannelType } => channelOrder.includes(c.type as ChannelType))
    .filter((c) => c.workflow_state !== 'retired')
    .sort((a, b) => channelOrder.indexOf(a.type) - channelOrder.indexOf(b.type) || a.position - b.position)
    .map((c) => ({
      id: String(c.id),
      type: c.type,
      address: c.address,
      confirmed: c.workflow_state === 'active',
    }));
}

export function useChannels() {
  return useCanvasQuery(['preferences', 'channels'], fetchChannels, { staleTime: 10 * 60_000 });
}

/**
 * Titles, descriptions, and order follow the official apps
 * (`NotificationPreferenceUtils.kt`), which match Canvas web. Categories only
 * instructors and admins see are left out.
 */
const categoryInfo: Record<string, { groupId: PreferenceGroupId; group: string; title: string; description: string }> = {
  due_date: {
    groupId: 'course',
    group: 'Course activities',
    title: 'Due dates',
    description: 'When an assignment’s due date changes.',
  },
  grading_policies: {
    groupId: 'course',
    group: 'Course activities',
    title: 'Grading policies',
    description: 'When a course’s grading policies change.',
  },
  course_content: {
    groupId: 'course',
    group: 'Course activities',
    title: 'Course content',
    description: 'When pages, quizzes, and assignments change.',
  },
  files: { groupId: 'course', group: 'Course activities', title: 'Files', description: 'When a file is added to a course.' },
  announcement: {
    groupId: 'course',
    group: 'Course activities',
    title: 'Announcements',
    description: 'New announcements in your courses.',
  },
  announcement_created_by_you: {
    groupId: 'course',
    group: 'Course activities',
    title: 'Your announcements',
    description: 'Announcements you post, and replies to them.',
  },
  grading: {
    groupId: 'course',
    group: 'Course activities',
    title: 'Grading',
    description: 'When work is graded or a grade changes.',
  },
  invitation: {
    groupId: 'course',
    group: 'Course activities',
    title: 'Invitations',
    description: 'Invitations to conferences, groups, collaborations, and peer reviews.',
  },
  submission_comment: {
    groupId: 'course',
    group: 'Course activities',
    title: 'Submission comments',
    description: 'When someone comments on your work.',
  },
  discussion: {
    groupId: 'discussions',
    group: 'Discussions',
    title: 'New discussions',
    description: 'New discussion topics in your courses.',
  },
  discussion_entry: {
    groupId: 'discussions',
    group: 'Discussions',
    title: 'Discussion replies',
    description: 'New replies in discussions you follow.',
  },
  discussion_mention: {
    groupId: 'discussions',
    group: 'Discussions',
    title: 'Mentions',
    description: 'When someone mentions you in a discussion.',
  },
  added_to_conversation: {
    groupId: 'inbox',
    group: 'Inbox',
    title: 'Added to a conversation',
    description: 'When someone adds you to a conversation.',
  },
  conversation_message: { groupId: 'inbox', group: 'Inbox', title: 'New messages', description: 'New messages in your Inbox.' },
  conversation_created: {
    groupId: 'inbox',
    group: 'Inbox',
    title: 'Messages you send',
    description: 'Copies of conversations you start.',
  },
  appointment_signups: {
    groupId: 'scheduling',
    group: 'Scheduling',
    title: 'Appointment sign-ups',
    description: 'New sign-ups on your calendar.',
  },
  appointment_cancelations: {
    groupId: 'scheduling',
    group: 'Scheduling',
    title: 'Appointment cancellations',
    description: 'When an appointment is canceled.',
  },
  appointment_availability: {
    groupId: 'scheduling',
    group: 'Scheduling',
    title: 'Appointment availability',
    description: 'When an appointment slot opens up.',
  },
  calendar: { groupId: 'scheduling', group: 'Scheduling', title: 'Calendar', description: 'New and changed calendar events.' },
  membership_update: {
    groupId: 'groups',
    group: 'Groups',
    title: 'Group membership',
    description: 'When a group membership is accepted or declined.',
  },
  recording_ready: {
    groupId: 'conferences',
    group: 'Conferences',
    title: 'Recordings',
    description: 'When a conference recording is ready.',
  },
  other: {
    groupId: 'other',
    group: 'Other',
    title: 'Administrative',
    description: 'Account and course administration messages.',
  },
};

const categoryOrder = Object.keys(categoryInfo);
const groupOrder = [...new Set(Object.values(categoryInfo).map((c) => c.groupId))];

/** Falls back to Canvas's own slug, readable, for categories newer than this list. */
function titleFromSlug(slug: string) {
  const words = slug.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const hiddenCategories = new Set([
  // Instructor and admin only (NotificationPreferenceUtils.kt descriptions).
  'all_submissions',
  'late_grading',
  'student_appointment_signups',
  // Canvas doesn't let anyone change these.
  'registration',
  'summaries',
  'migration',
]);

export async function fetchPreferences(
  client: CanvasClient,
  channelId: string,
  signal?: AbortSignal,
): Promise<PreferenceGroup[]> {
  const { notification_preferences: list } = await client.get<{
    notification_preferences: CanvasNotificationPreference[];
  }>(`/api/v1/users/self/communication_channels/${channelId}/notification_preferences`, undefined, signal);
  const byCategory = new Map<string, CanvasNotificationPreference[]>();
  for (const pref of list ?? []) {
    if (!pref.category || hiddenCategories.has(pref.category)) continue;
    const items = byCategory.get(pref.category) ?? [];
    items.push(pref);
    byCategory.set(pref.category, items);
  }
  const categories: PreferenceCategory[] = [...byCategory.entries()].map(([id, prefs]) => {
    const info = Object.prototype.hasOwnProperty.call(categoryInfo, id) ? categoryInfo[id] : undefined;
    return {
      id,
      title: info?.title ?? titleFromSlug(id),
      rawTitle: info ? undefined : id,
      description: info?.description ?? '',
      group: info?.group ?? 'Other',
      groupId: info?.groupId ?? 'other',
      frequency: prefs[0].frequency,
      notifications: prefs.map((p) => p.notification),
    };
  });
  const rank = (id: string) => {
    const index = categoryOrder.indexOf(id);
    return index < 0 ? categoryOrder.length : index;
  };
  categories.sort((a, b) => rank(a.id) - rank(b.id) || a.title.localeCompare(b.title));
  return groupOrder
    .map((id) => ({
      id,
      title: Object.values(categoryInfo).find((c) => c.groupId === id)!.group,
      categories: categories.filter((c) => c.groupId === id),
    }))
    .filter((g) => g.categories.length > 0);
}

const preferencesKey = (channelId: string) => ['preferences', 'channel', channelId] as const;

export function useNotificationPreferences(channelId: string | undefined) {
  return useCanvasQuery(
    [...preferencesKey(channelId ?? 'none')],
    (client, signal) => fetchPreferences(client, channelId!, signal),
    { enabled: !!channelId },
  );
}

/**
 * `PUT /api/v1/users/self/communication_channels/:id/notification_preferences`
 * with every notification in the category. The category endpoint guesses the
 * category's name from its slug and misses some (`discussion_entry`), so
 * Easel names each notification instead.
 */
export async function updateCategory(
  client: CanvasClient,
  channelId: string,
  category: PreferenceCategory,
  frequency: Frequency,
) {
  const notification_preferences = Object.fromEntries(category.notifications.map((n) => [n, { frequency }]));
  await client.put(`/api/v1/users/self/communication_channels/${channelId}/notification_preferences`, {
    notification_preferences,
  });
}

/** Changes a category's frequency right away on screen, and puts it back if Canvas says no. */
export function useUpdatePreference(channelId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = [useAccountKey(), ...preferencesKey(channelId ?? 'none')];
  return useCanvasMutation(
    (client, { category, frequency }: { category: PreferenceCategory; frequency: Frequency }) =>
      updateCategory(client, channelId!, category, frequency),
    {
      onMutate: async ({ category, frequency }) => {
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData<PreferenceGroup[]>(queryKey);
        queryClient.setQueryData<PreferenceGroup[]>(queryKey, (groups) =>
          groups?.map((g) => ({
            ...g,
            categories: g.categories.map((c) => (c.id === category.id ? { ...c, frequency } : c)),
          })),
        );
        return { previous };
      },
      onError: (_error, _variables, context) => {
        const previous = (context as { previous?: PreferenceGroup[] } | undefined)?.previous;
        if (previous) queryClient.setQueryData(queryKey, previous);
      },
    },
  );
}

/** Text and push only go out right away or not at all; email can also be a daily or weekly summary. */
export function frequenciesFor(type: ChannelType): Frequency[] {
  return type === 'email' ? ['immediately', 'daily', 'weekly', 'never'] : ['immediately', 'never'];
}

export const frequencyLabels: Record<Frequency, string> = {
  immediately: 'Right away',
  daily: 'Daily summary',
  weekly: 'Weekly summary',
  never: 'Off',
};
