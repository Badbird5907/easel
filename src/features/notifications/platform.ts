import * as Notifications from 'expo-notifications';
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications';
import { Platform } from 'react-native';

import { palettes } from '@/design/tokens/colors';

import { inQuietHours, type UpdateCategory } from './settings';

/*
 * The device side of notifications: Android channels, permission, the
 * foreground handler, and posting. Every notification carries its account and
 * an in-app destination (NOTIF-5).
 */

export type NotificationKind = 'reminder' | UpdateCategory | 'test';

export type NotificationData = {
  kind: NotificationKind;
  accountId: string | null;
  /** In-app route, like `/course/201/assignment/9008`. */
  path: string | null;
  /** Canvas URL, resolved at tap time when there's no path. */
  url?: string | null;
  courseId?: string | null;
  assignmentId?: string | null;
  conversationId?: string | null;
  topicId?: string | null;
  /** Arrived during quiet hours, so it made no sound. */
  quiet?: boolean;
};

type Channel = { name: string; description: string; importance: Notifications.AndroidImportance };

const channels: Record<NotificationKind | 'quiet', Channel> = {
  reminder: {
    name: 'Due date reminders',
    description: 'Reminders you set before work is due',
    importance: AndroidImportance.HIGH,
  },
  grades: {
    name: 'Grades',
    description: 'New and changed grades',
    importance: AndroidImportance.DEFAULT,
  },
  comments: {
    name: 'Submission comments',
    description: 'Feedback on your work',
    importance: AndroidImportance.DEFAULT,
  },
  announcements: {
    name: 'Announcements',
    description: 'New announcements in your courses',
    importance: AndroidImportance.DEFAULT,
  },
  messages: {
    name: 'Inbox messages',
    description: 'New messages in your Canvas inbox',
    importance: AndroidImportance.DEFAULT,
  },
  assignments: {
    name: 'New assignments',
    description: 'Work that just appeared in your courses',
    importance: AndroidImportance.DEFAULT,
  },
  discussions: { name: 'Discussions', description: 'Discussions and mentions', importance: AndroidImportance.DEFAULT },
  calendar: { name: 'Calendar', description: 'Calendar updates', importance: AndroidImportance.DEFAULT },
  other: { name: 'Other Canvas alerts', description: 'Other updates', importance: AndroidImportance.DEFAULT },
  test: {
    name: 'Developer tests',
    description: 'Test notifications from the developer settings',
    importance: AndroidImportance.DEFAULT,
  },
  quiet: {
    name: 'Quiet hours',
    description: 'Notifications that arrive during quiet hours, without sound',
    importance: AndroidImportance.LOW,
  },
};

/** Channel IDs. `reminders` is the default channel in app.json. */
const channelId = (kind: NotificationKind | 'quiet') => (kind === 'reminder' ? 'reminders' : kind);

let channelsReady: Promise<void> | null = null;

/** Creates Android's notification channels. Android 13 needs one before it shows the permission prompt. */
export function setUpChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelsReady ??= Promise.all(
    Object.entries(channels).map(([kind, channel]) =>
      Notifications.setNotificationChannelAsync(channelId(kind as NotificationKind | 'quiet'), {
        name: channel.name,
        description: channel.description,
        importance: channel.importance,
        lightColor: palettes.light.accent,
        showBadge: kind !== 'quiet',
      }),
    ),
  )
    .then(() => {})
    .catch(() => {
      channelsReady = null;
    });
  return channelsReady;
}

let handlerSet = false;

/**
 * Shows notifications that arrive while Easel is open as banners, silently:
 * the student is already in the app. Reminders still make their sound.
 */
export function setForegroundHandler() {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data as Partial<NotificationData> | undefined;
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: data?.kind === 'reminder' && !data.quiet,
        shouldSetBadge: true,
      };
    },
  });
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

function toState(status: Notifications.NotificationPermissionsStatus): PermissionState {
  if (status.granted || status.ios?.status === IosAuthorizationStatus.PROVISIONAL) return 'granted';
  // Android 13+ reports "denied" before it has ever asked; it can still ask.
  return status.canAskAgain ? 'undetermined' : 'denied';
}

export async function getPermission(): Promise<PermissionState> {
  try {
    return toState(await Notifications.getPermissionsAsync());
  } catch {
    return 'undetermined';
  }
}

/** Shows the system prompt when the student hasn't been asked yet. Never re-prompts after a "Don't allow". */
export async function requestPermission(): Promise<PermissionState> {
  const current = await getPermission();
  if (current !== 'undetermined') return current;
  await setUpChannels();
  try {
    return toState(
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      }),
    );
  } catch {
    return 'denied';
  }
}

export type NotificationText = { title: string; body: string; subtitle?: string | null };

function contentFor(
  text: NotificationText,
  data: NotificationData,
  at: Date,
): Notifications.NotificationContentInput {
  const quiet = inQuietHours(at);
  return {
    title: text.title,
    subtitle: text.subtitle ?? undefined,
    body: text.body,
    data: { ...data, quiet },
    sound: quiet ? false : 'default',
    // Quiet hours: straight to Notification Center, no sound, no lit screen.
    interruptionLevel: quiet ? 'passive' : 'active',
    threadIdentifier: `${data.accountId ?? 'easel'}:${data.kind}`,
  };
}

function triggerChannel(data: NotificationData, at: Date) {
  return channelId(inQuietHours(at) ? 'quiet' : data.kind);
}

/** Posts while the caller's account lifetime remains valid; retracts a late native completion. */
export async function presentNow(
  text: NotificationText,
  data: NotificationData,
  current: () => boolean,
): Promise<boolean> {
  const now = new Date();
  try {
    if (!current()) return false;
    await setUpChannels();
    if (!current()) return false;
    const identifier = await Notifications.scheduleNotificationAsync({
      content: contentFor(text, data, now),
      trigger: Platform.OS === 'android' ? { channelId: triggerChannel(data, now) } : null,
    });
    if (!current()) {
      await Promise.allSettled([
        Notifications.cancelScheduledNotificationAsync(identifier),
        Notifications.dismissNotificationAsync(identifier),
      ]);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Schedules a notification for a date, under a stable identifier. */
export async function scheduleAt(
  identifier: string,
  at: Date,
  text: NotificationText,
  data: NotificationData,
) {
  await setUpChannels();
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: contentFor(text, data, at),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: triggerChannel(data, at),
    },
  });
}

/** Removes delivered notifications that match, e.g. once the student has opened what they point to. */
export async function dismissPresented(match: (data: Partial<NotificationData>) => boolean) {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => match((n.request.content.data ?? {}) as Partial<NotificationData>))
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    // Nothing to dismiss.
  }
}
