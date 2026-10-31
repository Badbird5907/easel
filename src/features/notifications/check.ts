import {
  type AnnouncementChange,
  type CommentChange,
  fetchCourseNames,
  fetchPlannedWork,
  fetchStreamChanges,
  fetchUnreadCount,
  fetchUnreadMessages,
  type GradeChange,
  type MessageChange,
  type PlannedWork,
} from '@/canvas/api/notifications';
import { CanvasAuthError, type CanvasClient } from '@/canvas/client';
import { type Account, isStoredAccountClient, loadStoredClients, markAccountExpired } from '@/canvas/session';
import { applyDefaultReminders, refreshItems, reloadReminders } from '@/features/reminders/store';
import { syncReminders } from '@/features/reminders/schedule';
import { refreshAccountDisplay } from '@/i18n/account-display';
import { accountDateContext } from '@/i18n/account-preferences';

import { bridgeLive } from './canvasBridge';

import { paths, plannablePath } from './paths';
import { type NotificationData, type NotificationText, presentNow } from './platform';
import { reloadSeen, seenFor, type SeenState, updateBadge, watermark } from './seen';
import {
  getSettings,
  metaStore,
  type NotificationSettings,
  settingsStore,
  type UpdateCategory,
} from './settings';

/*
 * Background refresh (NOTIF-3): for every saved account, asks Canvas what
 * changed since the last look and posts local notifications for what the
 * student hasn't seen. The background task, the app's return to the
 * foreground, and the developer menu all run this same check.
 */

export type CheckReason = 'background' | 'foreground' | 'manual';

export type CheckResult = {
  accounts: number;
  posted: number;
  failed: number;
  /** Skipped because a check ran moments ago. */
  throttled?: boolean;
};

/** Returning to the app checks at most this often. */
const FOREGROUND_INTERVAL_MS = 10 * 60_000;
/** More than this many changes of one kind become one summary notification. */
const MAX_INDIVIDUAL = 3;
/** Allowance for the device clock disagreeing with Canvas's. */
const CLOCK_SLACK_MS = 5 * 60_000;

let running: Promise<CheckResult> | null = null;

export function checkForUpdates(reason: CheckReason): Promise<CheckResult> {
  if (reason === 'foreground') {
    const last = metaStore.get().lastCheckAt;
    if (last && Date.now() - last < FOREGROUND_INTERVAL_MS) {
      return Promise.resolve({ accounts: 0, posted: 0, failed: 0, throttled: true });
    }
  }
  running ??= run(reason).finally(() => {
    running = null;
  });
  return running;
}

async function run(reason: CheckReason): Promise<CheckResult> {
  // The background task may share this JS runtime with the app, or not: read fresh.
  settingsStore.reload();
  metaStore.reload();
  reloadSeen();
  reloadReminders();
  const settings = getSettings();
  const reducePolling = reason !== 'manual' && settings.bridgeEnabled && bridgeLive();
  const stored = await loadStoredClients();
  let posted = 0;
  let failed = 0;
  for (const { account, client } of stored) {
    try {
      posted += await checkAccount(account, client, settings, stored.length > 1, reducePolling);
    } catch (error) {
      failed += 1;
      // A rejected token: show "Sign in again" next time the app opens (AUTH-8).
      if (error instanceof CanvasAuthError) await markAccountExpired(account.id, client).catch(() => {});
    }
  }
  await syncReminders();
  await updateBadge();
  metaStore.set({ lastCheckAt: Date.now(), lastResult: { posted, accounts: stored.length, failed } });
  return { accounts: stored.length, posted, failed };
}

type Changes = {
  grades: GradeChange[];
  comments: CommentChange[];
  announcements: AnnouncementChange[];
  messages: MessageChange[];
  assignments: PlannedWork[];
};

function settled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

async function checkAccount(
  account: Account,
  client: CanvasClient,
  settings: NotificationSettings,
  multipleAccounts: boolean,
  reducePolling = false,
): Promise<number> {
  if (!isStoredAccountClient(account.id, client)) return 0;
  const results = await Promise.allSettled([
    reducePolling ? Promise.resolve(null) : fetchStreamChanges(client),
    reducePolling ? Promise.resolve(null) : fetchUnreadMessages(client),
    reducePolling ? Promise.resolve(null) : fetchUnreadCount(client),
    fetchPlannedWork(client),
    refreshAccountDisplay(account, client),
  ]);
  if (!isStoredAccountClient(account.id, client)) return 0;
  const dataResults = results.slice(0, 4);
  const failure = dataResults.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  // A dead token or no answer at all: nothing to compare against.
  if (
    failure &&
    (failure.reason instanceof CanvasAuthError || dataResults.every((r) => r.status === 'rejected'))
  ) {
    throw failure.reason;
  }
  const [stream, messages, unreadCount, work] = [
    settled(results[0]),
    settled(results[1]),
    settled(results[2]),
    settled(results[3]),
  ] as const;

  if (work) followPlannedWork(account.id, work, settings);

  const store = seenFor(account.id);
  const state = store.get();
  const now = Date.now();

  if (state.baseline === null) {
    // First look at this account: everything until now is old news. Without the
    // planner there's nothing to tell new work from old, so wait for a full answer.
    if (!work) return 0;
    store.set({
      ...state,
      baseline: now,
      checkedAt: now,
      known: Object.fromEntries(work.map((w) => [w.reminderId, now])),
      unreadMessages: unreadCount ?? 0,
    });
    return 0;
  }

  const changes = findChanges(account, state, { stream, messages, work }, now);
  // Keep planner metadata for reminders, but Canvas Student supplies new-work alerts.
  if (reducePolling) changes.assignments = [];
  const posted = await announce(account, client, changes, settings, multipleAccounts);

  // Raise every watermark, even for categories that are off, so turning one on doesn't replay old news.
  if (!isStoredAccountClient(account.id, client)) return posted;
  const latest = store.get();
  const marks = { ...latest.marks };
  const raise = (key: string, at: number) => {
    if (at > (marks[key] ?? 0)) marks[key] = at;
  };
  for (const g of changes.grades) raise(`grades:${g.courseId ?? 'none'}`, g.at);
  for (const c of changes.comments) raise(`comments:${c.courseId ?? 'none'}`, c.at);
  for (const a of changes.announcements) raise(`announcements:${a.courseId ?? 'none'}`, a.at);
  for (const m of changes.messages) raise('messages', m.at);
  const known = { ...latest.known };
  for (const w of work ?? []) known[w.reminderId] ??= now;
  const unseenGrades = settings.updates.grades
    ? [
        ...latest.unseenGrades.filter((u) => !changes.grades.some((g) => g.assignmentId === u.assignmentId)),
        ...changes.grades.map((g) => ({ assignmentId: g.assignmentId, courseId: g.courseId })),
      ]
    : latest.unseenGrades;
  store.set({
    ...latest,
    marks,
    known,
    unseenGrades,
    checkedAt: now,
    unreadMessages: unreadCount ?? latest.unreadMessages,
  });
  return posted;
}

/** Reminders follow changed due dates, and new work gets the default reminder (SET-5). */
function followPlannedWork(accountId: string, work: PlannedWork[], settings: NotificationSettings) {
  refreshItems(
    accountId,
    work.flatMap((w) =>
      [w.reminderId, w.assignmentReminderId]
        .filter((id): id is string => !!id)
        .map((id) => ({ id, title: w.title, dueAt: w.dueAt })),
    ),
  );
  applyDefaultReminders(
    accountId,
    work
      .filter((w) => w.gradable)
      .map((w) => ({
        id: w.reminderId,
        title: w.title,
        dueAt: w.dueAt,
        courseId: w.courseId,
        url: plannablePath(w.plannableType, w.plannableId, w.courseId) ?? w.htmlUrl,
        done: w.done,
      })),
    settings.defaultReminderMinutes,
  );
}

function findChanges(
  account: Account,
  state: SeenState,
  fetched: {
    stream: Awaited<ReturnType<typeof fetchStreamChanges>> | null;
    messages: MessageChange[] | null;
    work: PlannedWork[] | null;
  },
  now: number,
): Changes {
  const { stream, messages, work } = fetched;
  const lastLook = (state.checkedAt ?? state.baseline ?? now) - CLOCK_SLACK_MS;
  return {
    grades: (stream?.grades ?? []).filter((g) => g.at > watermark(state, 'grades', g.courseId)),
    comments: (stream?.comments ?? []).filter(
      (c) => c.authorId !== account.user.id && c.at > watermark(state, 'comments', c.courseId),
    ),
    announcements: (stream?.announcements ?? []).filter(
      (a) => a.unread && a.at > watermark(state, 'announcements', a.courseId),
    ),
    // Canvas marks a conversation read once the student opens it, anywhere.
    messages: (messages ?? []).filter((m) => m.at > watermark(state, 'messages')),
    assignments: (work ?? []).filter(
      (w) =>
        w.gradable &&
        !(w.reminderId in state.known) &&
        !w.done &&
        (w.dueAt === null || w.dueAt > now) &&
        // Work that drifted into the planner's window by date alone isn't news.
        (w.updatedAt === null || w.updatedAt > lastLook),
    ),
  };
}

const number = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '');

function gradeLine(g: GradeChange): string {
  if (g.excused) return 'Excused';
  if (g.score !== null && g.pointsPossible !== null) {
    const letter = g.grade && Number.isNaN(Number(g.grade)) ? ` (${g.grade})` : '';
    return `Graded: ${number(g.score)} out of ${number(g.pointsPossible)}${letter}`;
  }
  return g.grade ? `Graded: ${g.grade}` : 'Graded';
}

function listTitles(titles: string[]): string {
  const shown = titles.slice(0, 2);
  const rest = titles.length - shown.length;
  return rest > 0 ? `${shown.join(', ')}, and ${rest} more` : shown.join(' and ');
}

type Notice = { text: NotificationText; data: NotificationData };

async function announce(
  account: Account,
  client: CanvasClient,
  changes: Changes,
  settings: NotificationSettings,
  multipleAccounts: boolean,
): Promise<number> {
  const enabled = (category: keyof Changes) => settings.updates[category] && changes[category].length > 0;
  const categories = (Object.keys(changes) as (keyof Changes)[]).filter(enabled);
  if (!categories.length) return 0;

  const names: Record<string, string> = await fetchCourseNames(client).catch(() => ({}));
  if (!isStoredAccountClient(account.id, client)) return 0;
  const display = accountDateContext(account.id);
  const subtitle = (courseId: string | null, fallback?: string | null) =>
    [(courseId && names[courseId]) || fallback, multipleAccounts ? account.host : null]
      .filter(Boolean)
      .join(' · ') || null;
  const base = { accountId: account.id } as const;
  const notices: Notice[] = [];

  const add = <T>(
    category: UpdateCategory,
    items: T[],
    one: (item: T) => Notice,
    summary: { title: string; titles: string[]; path: string },
  ) => {
    if (!settings.updates[category] || !items.length) return;
    if (items.length <= MAX_INDIVIDUAL) {
      notices.push(...items.map(one));
      return;
    }
    notices.push({
      text: {
        title: summary.title,
        body: listTitles(summary.titles),
        subtitle: multipleAccounts ? account.host : null,
      },
      data: { ...base, kind: category, path: summary.path },
    });
  };

  add(
    'grades',
    changes.grades,
    (g) => ({
      text: { title: g.title, body: gradeLine(g), subtitle: subtitle(g.courseId) },
      data: {
        ...base,
        kind: 'grades',
        path: g.courseId ? paths.assignment(g.courseId, g.assignmentId) : paths.grades,
        courseId: g.courseId,
        assignmentId: g.assignmentId,
      },
    }),
    {
      title: `${changes.grades.length} new grades`,
      titles: changes.grades.map((g) => g.title),
      path: paths.grades,
    },
  );

  add(
    'comments',
    changes.comments,
    (c) => ({
      text: {
        title: `Comment on ${c.title}`,
        body: `${c.author}: ${c.text}`,
        subtitle: subtitle(c.courseId),
      },
      data: {
        ...base,
        kind: 'comments',
        path: c.courseId ? paths.submission(c.courseId, c.assignmentId) : paths.activity,
        courseId: c.courseId,
        assignmentId: c.assignmentId,
      },
    }),
    {
      title: `${changes.comments.length} new comments`,
      titles: [...new Set(changes.comments.map((c) => c.title))],
      path: paths.activity,
    },
  );

  add(
    'announcements',
    changes.announcements,
    (a) => ({
      text: { title: a.title, body: a.preview || 'New announcement', subtitle: subtitle(a.courseId) },
      data: {
        ...base,
        kind: 'announcements',
        path: a.courseId ? paths.discussion(a.courseId, a.topicId) : paths.announcements,
        courseId: a.courseId,
        topicId: a.topicId,
      },
    }),
    {
      title: `${changes.announcements.length} new announcements`,
      titles: changes.announcements.map((a) => a.title),
      path: paths.announcements,
    },
  );

  add(
    'messages',
    changes.messages,
    (m) => ({
      text: { title: m.subject || 'New message', body: m.preview, subtitle: subtitle(null, m.contextName) },
      data: {
        ...base,
        kind: 'messages',
        path: paths.conversation(m.conversationId),
        conversationId: m.conversationId,
      },
    }),
    {
      title: `${changes.messages.length} new messages`,
      titles: changes.messages.map((m) => m.subject || 'No subject'),
      path: paths.inbox,
    },
  );

  add(
    'assignments',
    changes.assignments,
    (w) => ({
      text: {
        title: w.title,
        body:
          w.dueAt === null
            ? 'New assignment'
            : display.t('background.newAssignmentDue', { when: display.dueIn(new Date(w.dueAt)) }),
        subtitle: subtitle(w.courseId, w.contextName),
      },
      data: {
        ...base,
        kind: 'assignments',
        path: plannablePath(w.plannableType, w.plannableId, w.courseId),
        url: w.htmlUrl,
        courseId: w.courseId,
        assignmentId: w.plannableType === 'assignment' ? w.plannableId : null,
      },
    }),
    {
      title: `${changes.assignments.length} new assignments`,
      titles: changes.assignments.map((w) => w.title),
      path: paths.todo,
    },
  );

  let posted = 0;
  for (const notice of notices) {
    if (!isStoredAccountClient(account.id, client)) break;
    if (await presentNow(notice.text, notice.data, () => isStoredAccountClient(account.id, client))) posted += 1;
  }
  return posted;
}

/**
 * Developer tool: forgets what this device has announced for these accounts,
 * as if the last week happened after the first check, so the next check
 * alerts about it again.
 */
export function replayLastWeek(accountIds: string[]) {
  reloadSeen();
  const since = Date.now() - 7 * 24 * 60 * 60_000;
  for (const id of accountIds) {
    const store = seenFor(id);
    store.set({ ...store.get(), baseline: since, checkedAt: since, marks: {}, known: {}, unseenGrades: [] });
  }
}
