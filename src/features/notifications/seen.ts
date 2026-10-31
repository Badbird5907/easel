import * as Notifications from 'expo-notifications';

import { getSettings } from './settings';
import { JsonStore, keysWithPrefix } from './storage';

/*
 * What the student has already seen or been told about, per account, so a
 * background check never alerts twice or about something already on screen
 * (NOTIF-3). A watermark per category (and per course where it matters):
 * anything at or before it is old news. Screens raise it as they load data;
 * the check raises it as it posts.
 */

export type SeenCategory = 'grades' | 'comments' | 'announcements' | 'messages';

export type SeenState = {
  /** The first check for this account. Nothing from before it ever alerts. */
  baseline: number | null;
  /** The last check that reached Canvas. */
  checkedAt: number | null;
  /** Newest event time already seen or notified, by `category` or `category:courseId`. */
  marks: Record<string, number>;
  /** Planner work Easel has shown or announced, by reminder ID, with when it was first seen. */
  known: Record<string, number>;
  /** Grades announced but not opened yet, for the app icon badge. */
  unseenGrades: { assignmentId: string; courseId: string | null }[];
  /** From the last check, or from the inbox when it loads. */
  unreadMessages: number;
};

const PREFIX = 'seen:';
const stores = new Map<string, JsonStore<SeenState>>();

const empty = (): SeenState => ({
  baseline: null,
  checkedAt: null,
  marks: {},
  known: {},
  unseenGrades: [],
  unreadMessages: 0,
});

export function seenFor(accountId: string): JsonStore<SeenState> {
  let store = stores.get(accountId);
  if (!store) {
    store = new JsonStore<SeenState>(`${PREFIX}${accountId}`, empty, (stored) => ({ ...empty(), ...stored }));
    stores.set(accountId, store);
  }
  return store;
}

const markKey = (category: SeenCategory, courseId?: string | null) =>
  courseId === undefined ? category : `${category}:${courseId ?? 'none'}`;

/** Events at or before this are old news. */
export function watermark(state: SeenState, category: SeenCategory, courseId?: string | null): number {
  return Math.max(
    state.baseline ?? Number.MAX_SAFE_INTEGER,
    state.marks[category] ?? 0,
    courseId === undefined ? 0 : (state.marks[markKey(category, courseId)] ?? 0),
  );
}

/** Raises a watermark. Never lowers one. */
export function raiseMark(
  accountId: string,
  category: SeenCategory,
  courseId: string | null | undefined,
  at: number,
) {
  if (!Number.isFinite(at) || at <= 0) return;
  const store = seenFor(accountId);
  const key = markKey(category, courseId);
  const state = store.get();
  if ((state.marks[key] ?? 0) >= at) return;
  store.set({ ...state, marks: { ...state.marks, [key]: at } });
}

/** Remembers planner work the student has been shown, so it never alerts as new. */
export function markKnown(accountId: string, ids: string[]) {
  const store = seenFor(accountId);
  const state = store.get();
  const fresh = ids.filter((id) => !(id in state.known));
  if (!fresh.length) return;
  const now = Date.now();
  // Forget work first seen over four months ago; it has long left the planner window.
  const cutoff = now - 120 * 24 * 60 * 60_000;
  const known = Object.fromEntries(Object.entries(state.known).filter(([, at]) => at > cutoff));
  for (const id of fresh) known[id] = now;
  store.set({ ...state, known });
}

export function clearUnseenGrades(accountId: string, match: { courseId?: string; assignmentId?: string }) {
  const store = seenFor(accountId);
  const state = store.get();
  const unseenGrades = state.unseenGrades.filter(
    (g) =>
      !(
        (match.assignmentId === undefined || g.assignmentId === match.assignmentId) &&
        (match.courseId === undefined || g.courseId === match.courseId)
      ),
  );
  if (unseenGrades.length === state.unseenGrades.length) return;
  store.set({ ...state, unseenGrades });
  void updateBadge();
}

export function setUnreadMessages(accountId: string, count: number) {
  const store = seenFor(accountId);
  const state = store.get();
  if (state.unreadMessages === count) return;
  store.set({ ...state, unreadMessages: count });
  void updateBadge();
}

export function removeAccountSeen(accountId: string) {
  seenFor(accountId).clear();
  stores.delete(accountId);
}

export function reloadSeen() {
  for (const store of stores.values()) store.reload();
}

/**
 * The app icon badge (NOTIF-5): unread inbox messages plus grades announced
 * but not opened yet, across every account. Categories that are turned off
 * don't count.
 */
export function badgeCount(): number {
  const { updates } = getSettings();
  let count = 0;
  for (const key of keysWithPrefix(PREFIX)) {
    const state = seenFor(key.slice(PREFIX.length)).get();
    if (updates.messages) count += state.unreadMessages;
    if (updates.grades) count += state.unseenGrades.length;
  }
  return count;
}

let lastBadge: number | null = null;

export async function updateBadge() {
  const count = badgeCount();
  if (count === lastBadge) return;
  lastBadge = count;
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {
    lastBadge = null;
  }
}
