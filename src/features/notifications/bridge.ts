import { type QueryCacheNotifyEvent, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';

import type { ActivityItem } from '@/canvas/api/activity';
import type { Conversation } from '@/canvas/api/conversations';
import { type Announcement, isDone, type WorkItem } from '@/canvas/models';
import { applyDefaultReminders, refreshItems } from '@/features/reminders/store';

import { plannablePath } from './paths';
import { dismissPresented } from './platform';
import { clearUnseenGrades, markKnown, raiseMark, setUnreadMessages } from './seen';
import { getSettings } from './settings';

/*
 * "Seen in the app" from the screens' own data (NOTIF-3): whenever a screen
 * loads fresh data, what it shows stops being news. Watching the query cache
 * means screens don't have to report anything. Only queries a mounted screen
 * is using count, and only while Easel is in the foreground.
 */

const ms = (date: unknown) => (date instanceof Date ? date.getTime() : 0);
const latest = (dates: unknown[]) => dates.reduce<number>((max, d) => Math.max(max, ms(d)), 0);

const GRADABLE = new Set(['assignment', 'sub_assignment', 'quiz', 'discussion_topic']);

function plannerSeen(accountId: string, items: WorkItem[]) {
  markKnown(
    accountId,
    items.map((i) => `${i.plannableType}_${i.plannableId}`),
  );
  followPlanner(accountId, items);
}

/** Reminders follow changed due dates, and new work gets the default reminder (SET-5). */
function followPlanner(accountId: string, items: WorkItem[]) {
  if (accountId === 'easel_demo') return;
  refreshItems(
    accountId,
    items.map((i) => ({
      id: `${i.plannableType}_${i.plannableId}`,
      title: i.title,
      dueAt: ms(i.dueAt) || null,
    })),
  );
  applyDefaultReminders(
    accountId,
    items
      .filter((i) => GRADABLE.has(i.plannableType))
      .map((i) => ({
        id: `${i.plannableType}_${i.plannableId}`,
        title: i.title,
        dueAt: ms(i.dueAt) || null,
        courseId: i.courseId,
        url: plannablePath(i.plannableType, i.plannableId, i.courseId) ?? i.htmlUrl,
        done: isDone(i) || i.dismissed,
      })),
    getSettings().defaultReminderMinutes,
  );
}

function noteSeen(accountId: string, key: unknown[], data: unknown, fetchedAt: number) {
  const [kind, a, b, c] = key;
  switch (kind) {
    case 'activity': {
      if (!Array.isArray(data)) return;
      for (const item of data as ActivityItem[]) {
        const at = ms(item.updatedAt);
        if (item.kind === 'announcement') raiseMark(accountId, 'announcements', item.courseId, at);
        if (item.kind === 'submission') {
          raiseMark(accountId, 'grades', item.courseId, at);
          raiseMark(accountId, 'comments', item.courseId, at);
        }
      }
      return;
    }
    case 'announcements': {
      if (!Array.isArray(data)) return;
      const byCourse = new Map<string | null, number>();
      for (const item of data as Announcement[])
        byCourse.set(item.courseId, Math.max(byCourse.get(item.courseId) ?? 0, ms(item.postedAt)));
      for (const [courseId, at] of byCourse) raiseMark(accountId, 'announcements', courseId, at);
      return;
    }
    case 'conversations': {
      // Only the full inbox: a filtered list says nothing about the rest.
      if (b !== 'all' || !Array.isArray(data)) return;
      const list = data as Conversation[];
      if (a === 'inbox') {
        raiseMark(accountId, 'messages', undefined, latest(list.map((x) => x.lastMessageAt)));
        setUnreadMessages(accountId, list.filter((x) => x.unread).length);
      } else if (a === 'unread') {
        setUnreadMessages(accountId, list.length);
      }
      return;
    }
    case 'conversation': {
      if (typeof a === 'string')
        void dismissPresented((d) => d.accountId === accountId && d.conversationId === a);
      return;
    }
    case 'grades': {
      if (typeof a !== 'string' || a === 'overview') return;
      raiseMark(accountId, 'grades', a, fetchedAt);
      clearUnseenGrades(accountId, { courseId: a });
      void dismissPresented((d) => d.accountId === accountId && d.kind === 'grades' && d.courseId === a);
      return;
    }
    case 'courses': {
      // An assignment, or its submission: ['courses', courseId, 'assignments', assignmentId, 'submission'?].
      if (b !== 'assignments' || typeof c !== 'string' || !(key.length === 4 || key[4] === 'submission'))
        return;
      clearUnseenGrades(accountId, { assignmentId: c });
      void dismissPresented(
        (d) =>
          d.accountId === accountId && (d.kind === 'grades' || d.kind === 'comments') && d.assignmentId === c,
      );
      return;
    }
    case 'discussion': {
      if (typeof b === 'string' && key.length === 3)
        void dismissPresented(
          (d) => d.accountId === accountId && d.kind === 'announcements' && d.topicId === b,
        );
      return;
    }
    case 'planner': {
      if (a === 'items' && Array.isArray(data)) plannerSeen(accountId, data as WorkItem[]);
      return;
    }
  }
}

/** Applies the default reminder to planner data already loaded, e.g. right after the setting changes. */
export function useApplyDefaultReminders(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    const cached = queryClient.getQueriesData<WorkItem[]>({
      predicate: (query) => query.queryKey[1] === 'planner' && query.queryKey[2] === 'items',
    });
    for (const [key, data] of cached) {
      if (typeof key[0] === 'string' && Array.isArray(data)) followPlanner(key[0], data);
    }
  }, [queryClient]);
}

/** Watches the query cache for data screens just loaded. */
export function useSeenFromScreens() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event: QueryCacheNotifyEvent) => {
        if (event.type !== 'updated' || event.action.type !== 'success') return;
        const { query } = event;
        if (AppState.currentState !== 'active' || query.getObserversCount() === 0) return;
        const [accountId, ...key] = query.queryKey as unknown[];
        if (typeof accountId !== 'string') return;
        try {
          noteSeen(accountId, key, query.state.data, query.state.dataUpdatedAt);
        } catch {
          // A screen's data in an unexpected shape: nothing to learn from it.
        }
      }),
    [queryClient],
  );
}
