import { refreshAccountDisplay } from '@/i18n/account-display';
import { accountDateContext, onDisplayPreferencesChanged } from '@/i18n/account-preferences';
import { createDateContext, type DateContext } from '@/lib/dates';
import type { Query, QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { fetchAnnouncements } from '@/canvas/api/announcements';
import { fetchDashboardCourses } from '@/canvas/api/courses';
import { type CourseGradeSummary, fetchGradesOverview } from '@/canvas/api/grades';
import { fetchPlannerItems, upcomingRange } from '@/canvas/api/planner';
import type { CanvasClient } from '@/canvas/client';
import type { Announcement, Course, WorkItem } from '@/canvas/models';
import { type Account, isStoredAccountClient, loadStoredClients, useSession } from '@/canvas/session';

import {
  buildAnnouncements,
  buildGrades,
  buildNextDue,
  buildTodo,
  nextDueTimeline,
  signedOut,
  signedOutNextDue,
  waitingNextDue,
  waitingList,
  type WidgetData,
} from './build';
import { AnnouncementsWidget, GradesWidget, NextDueWidget, TodoWidget } from './layouts';
import { plistSafe } from './theme';
import { widgetMetaStore, widgetSettingsStore } from './settings';

/*
 * Feeds the home screen widgets (SYS-1). Two sources, one builder:
 *   - the app's query cache: whenever To Do, Home, or Grades load data for the
 *     active account, the widgets update from it, with no extra requests
 *   - Canvas directly, from the background task (and when the cache lacks
 *     something a widget needs)
 * Identical props aren't sent twice, so widgets reload only when they change.
 */

/** Announcements the widget shows: the same two weeks Home shows. */
const ANNOUNCEMENT_DAYS = 14;

const sent = new Map<string, string>();
let lastPublished: { accountId: string; client: CanvasClient; data: WidgetData } | null = null;
function publishAccountWidgets(accountId: string, client: CanvasClient, data: WidgetData) {
  if (!isStoredAccountClient(accountId, client)) return;
  if (lastPublished?.accountId === accountId && lastPublished.client === client) {
    const previous = lastPublished.data;
    data = {
      items: data.items ?? previous.items,
      courses: data.courses ?? previous.courses,
      announcements: data.announcements ?? previous.announcements,
      grades: data.grades ?? previous.grades,
    };
  }
  lastPublished = { accountId, client, data };
  publishWidgets(data, new Date(), accountDateContext(accountId));
}
// Also reformat a network-fed snapshot when the foreground cache has no widget data yet.
onDisplayPreferencesChanged((id) => {
  const last = lastPublished;
  if (last?.accountId !== id) return;
  if (!isStoredAccountClient(id, last.client)) {
    lastPublished = null;
    if (widgetMetaStore.get().accountId === id) publishWidgets(null);
  } else if (widgetMetaStore.get().accountId === id) publishAccountWidgets(id, last.client, last.data);
});

function send(name: string, props: object, write: () => void) {
  const json = JSON.stringify(props);
  if (sent.get(name) === json) return;
  try {
    write();
    sent.set(name, json);
  } catch {
    // A build without the widget extension: nothing to update.
  }
}

/** Pushes new props to every widget whose data is known. `null` means signed out. */
export function publishWidgets(
  data: WidgetData | null,
  now = new Date(),
  display: DateContext = createDateContext(),
) {
  if (!NextDueWidget || !TodoWidget || !AnnouncementsWidget || !GradesWidget) return;
  const next = NextDueWidget;
  const todo = TodoWidget;
  const announcements = AnnouncementsWidget;
  const grades = GradesWidget;
  const { gradesEnabled } = widgetSettingsStore.get();

  if (!data) {
    lastPublished = null;
    send('next', { signedOut: true }, () => next.updateSnapshot(plistSafe(signedOutNextDue())));
    send('todo', { signedOut: true }, () => todo.updateSnapshot(plistSafe(signedOut.todo())));
    send('announcements', { signedOut: true }, () =>
      announcements.updateSnapshot(plistSafe(signedOut.announcements())),
    );
    send('grades', { signedOut: true }, () => grades.updateSnapshot(plistSafe(signedOut.grades())));
    return;
  }

  if (data.items === null) {
    const props = waitingNextDue();
    send('next', props, () => next.updateSnapshot(plistSafe(props)));
    const todoProps = waitingList('To Do', props.url);
    send('todo', todoProps, () => todo.updateSnapshot(plistSafe(todoProps)));
  }
  if (data.items) {
    const items = data.items;
    if (Platform.OS === 'ios') {
      const timeline = nextDueTimeline(items, data.courses, now, display);
      // The first entry stands for the rest: later ones follow from the same data.
      send(
        'next',
        {
          first: timeline[0]?.props,
          count: timeline.length,
          at: Math.floor(now.getTime() / 60_000),
          locale: display.locale,
          timeZone: display.timeZone,
        },
        () =>
          next.updateTimeline(timeline.map((entry) => ({ date: entry.date, props: plistSafe(entry.props) }))),
      );
    } else {
      const props = buildNextDue(items, data.courses, now, display);
      send('next', props, () => next.updateSnapshot(plistSafe(props)));
    }
    const todoProps = buildTodo(items, data.courses, now, display);
    send('todo', todoProps, () => todo.updateSnapshot(plistSafe(todoProps)));
  }
  if (data.announcements === null) {
    const props = waitingList('Announcements', 'easel://announcements');
    send('announcements', props, () => announcements.updateSnapshot(plistSafe(props)));
  }
  if (data.announcements) {
    const props = buildAnnouncements(data.announcements, data.courses, now, display);
    send('announcements', props, () => announcements.updateSnapshot(plistSafe(props)));
  }
  {
    const props = buildGrades(data.grades, data.courses, gradesEnabled);
    send('grades', props, () => grades.updateSnapshot(plistSafe(props)));
  }
}

/** Fetches what the widgets show for one account, straight from Canvas. */
export async function fetchWidgetData(
  client: CanvasClient,
  display: DateContext = createDateContext(),
): Promise<WidgetData> {
  const { gradesEnabled } = widgetSettingsStore.get();
  const [items, courses, grades] = await Promise.allSettled([
    fetchPlannerItems(client, upcomingRange(new Date(), display.timeZone)),
    fetchDashboardCourses(client),
    gradesEnabled ? fetchGradesOverview(client) : Promise.resolve(null),
  ]);
  const courseList = courses.status === 'fulfilled' ? courses.value : null;
  const announcements = courseList
    ? await fetchAnnouncements(
        client,
        courseList.map((c) => c.id),
        { days: ANNOUNCEMENT_DAYS },
      ).catch(() => null)
    : null;
  return {
    items: items.status === 'fulfilled' ? items.value : null,
    courses: courseList,
    announcements,
    grades: grades.status === 'fulfilled' ? grades.value : null,
  };
}

/**
 * Background refresh: the account the widgets last showed (or the first one),
 * fetched and published. Safe to call from the background task.
 */
export async function refreshWidgets(): Promise<void> {
  if (!NextDueWidget) return;
  widgetSettingsStore.reload();
  widgetMetaStore.reload();
  const stored = await loadStoredClients();
  if (stored.length === 0) {
    publishWidgets(null);
    return;
  }
  const { accountId } = widgetMetaStore.get();
  const target = stored.find((s) => s.account.id === accountId) ?? stored[0];
  if (target.account.id !== accountId) publishWidgets(null);
  const display = await refreshAccountDisplay(target.account, target.client);
  widgetMetaStore.reload();
  if (widgetMetaStore.get().accountId !== accountId || !isStoredAccountClient(target.account.id, target.client))
    return;
  const data = await fetchWidgetData(target.client, display);
  // A foreground account switch or sign-out may have happened during the fetch.
  widgetMetaStore.reload();
  if (widgetMetaStore.get().accountId !== accountId) return;
  if (!(await loadStoredClients()).some((s) => s.account.id === target.account.id)) return;
  if (!isStoredAccountClient(target.account.id, target.client)) return;
  publishAccountWidgets(target.account.id, target.client, data);
  widgetMetaStore.set({ accountId: target.account.id, fetchedAt: data.items ? Date.now() : null });
}

// --- From the query cache ---------------------------------------------------------------

function latest<T>(queries: Query[]): T | null {
  let best: Query | null = null;
  for (const query of queries) {
    if (query.state.status !== 'success' || query.state.data === undefined) continue;
    if (!best || query.state.dataUpdatedAt > best.state.dataUpdatedAt) best = query;
  }
  return (best?.state.data as T | undefined) ?? null;
}

/** Everything the widgets need that the cache already holds for this account. */
export function widgetDataFromCache(client: QueryClient, accountId: string): WidgetData {
  const cache = client.getQueryCache();
  const range = upcomingRange(new Date(), accountDateContext(accountId).timeZone);
  // A successful day/month query cannot prove there is no work in Home's window.
  // Use the same full window as Home, rather than merging stale, unrelated ranges.
  const plannerQueries = cache.findAll({ queryKey: [accountId, 'planner', 'items'] })
    .filter((query) =>
      query.state.status === 'success' && Array.isArray(query.state.data) &&
      new Date(String(query.queryKey[3])).getTime() <= range.start.getTime() &&
      new Date(String(query.queryKey[4])).getTime() >= range.end.getTime(),
    );
  const announcementQueries = cache
    .findAll({ queryKey: [accountId, 'announcements'] })
    // The combined feeds: ['announcements', days, ...courseIds].
    .filter((q) => typeof q.queryKey[2] === 'number' && (q.queryKey[2] as number) <= 30);
  return {
    items: latest<WorkItem[]>(plannerQueries),
    courses: latest<Course[]>(cache.findAll({ queryKey: [accountId, 'courses', 'dashboard'], exact: true })),
    announcements: latest<Announcement[]>(announcementQueries),
    grades: latest<CourseGradeSummary[]>(
      cache.findAll({ queryKey: [accountId, 'grades', 'overview'], exact: true }),
    ),
  };
}

/** Keys whose data a widget shows. */
function feedsWidgets(key: readonly unknown[]) {
  const [, area, sub] = key;
  return (
    (area === 'planner' && sub === 'items') ||
    (area === 'courses' && sub === 'dashboard') ||
    area === 'announcements' ||
    (area === 'grades' && sub === 'overview')
  );
}

/** Canvas data older than this gets fetched for the widgets when the app opens. */
const STALE_MS = 30 * 60_000;

/**
 * Keeps the widgets in step with the app: publishes from the query cache as
 * data loads, follows account switches and sign-out, and fetches from Canvas
 * when the app opens and the widgets haven't been fed for a while. Render once,
 * inside the query provider (CanvasQueryProvider does).
 */
export function useWidgetFeed(queryClient: QueryClient) {
  const { status, active, client } = useSession();
  const accountId = active && !active.expired ? active.id : null;

  useEffect(() => {
    if (!NextDueWidget || status !== 'ready') return;
    if (!accountId) {
      widgetMetaStore.set({ accountId: null, fetchedAt: null });
      publishWidgets(null);
      return;
    }
    if (widgetMetaStore.get().accountId !== accountId) {
      // Clear all four widgets before publishing any partial cache for the new account.
      publishWidgets(null);
      widgetMetaStore.set({ accountId, fetchedAt: null });
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const publishSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (
          !client ||
          !isStoredAccountClient(accountId, client) ||
          widgetMetaStore.get().accountId !== accountId
        )
          return;
        publishAccountWidgets(accountId, client, widgetDataFromCache(queryClient, accountId));
      }, 800);
    };
    // Turning the Grades widget on needs grades even if the Grades screen never loaded them.
    const ensureGrades = () => {
      if (!client || !widgetSettingsStore.get().gradesEnabled) return;
      const key = [accountId, 'grades', 'overview'];
      const state = queryClient.getQueryState(key);
      if (state?.status === 'success' && Date.now() - state.dataUpdatedAt < STALE_MS) return;
      queryClient
        .prefetchQuery({ queryKey: key, queryFn: ({ signal }) => fetchGradesOverview(client, signal) })
        .catch(() => {});
    };
    const unsubscribeDisplay = onDisplayPreferencesChanged((id) => {
      if (id === accountId) publishSoon();
    });
    publishSoon();
    ensureGrades();
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      const key = event.query.queryKey;
      if (key[0] === accountId && feedsWidgets(key)) publishSoon();
    });
    const unsubscribeSettings = widgetSettingsStore.subscribe(() => {
      publishSoon();
      ensureGrades();
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      unsubscribeSettings();
      unsubscribeDisplay();
    };
  }, [queryClient, status, accountId, client]);

  // Opening the app tops up whatever the cache lacks, such as grades for the Grades widget.
  useEffect(() => {
    if (!NextDueWidget || !accountId || !client) return;
    const account = active as Account;
    let disposed = false;
    const topUp = async () => {
      const meta = widgetMetaStore.get();
      if (meta.fetchedAt && Date.now() - meta.fetchedAt < STALE_MS &&
        lastPublished?.accountId === accountId && lastPublished.data.items !== null) return;
      try {
        const display = await refreshAccountDisplay(account, client);
        if (disposed || !isStoredAccountClient(account.id, client) || widgetMetaStore.get().accountId !== account.id)
          return;
        const data = await fetchWidgetData(client, display);
        if (
          disposed ||
          !isStoredAccountClient(account.id, client) ||
          widgetMetaStore.get().accountId !== account.id
        )
          return;
        const cached = widgetDataFromCache(queryClient, account.id);
        // Use the complete network planner window; cache fills gaps if it failed.
        publishAccountWidgets(account.id, client, {
          items: data.items ?? cached.items,
          courses: cached.courses ?? data.courses,
          announcements: cached.announcements ?? data.announcements,
          grades: data.grades ?? cached.grades,
        });
        widgetMetaStore.set({ accountId: account.id, fetchedAt: data.items ? Date.now() : null });
      } catch {
        // Offline: the widgets keep what they show.
      }
    };
    void topUp();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void topUp();
    });
    return () => {
      disposed = true;
      sub.remove();
    };
  }, [queryClient, accountId, client, active]);
}
