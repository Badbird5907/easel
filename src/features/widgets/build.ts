import type { CourseGradeSummary } from '@/canvas/api/grades';
import { type Announcement, type Course, isDone, type WorkItem } from '@/canvas/models';
import { deriveAccent } from '@/design/theme/accent';
import { paths, plannablePath } from '@/features/notifications/paths';
import { createDateContext, type DateContext, dayBoundary } from '@/lib/dates';
import { summarizeDue } from '@/lib/due';

import { WAITING_MESSAGE, widgetTheme } from './theme';
import type { ListWidgetProps, NextDueProps, WidgetColor, WidgetRow } from './types';

/*
 * Canvas data to widget props (SYS-1). Pure: the app, the query-cache feed,
 * and the background task all build props the same way. Every link is an
 * `easel://` URL that Expo Router opens like any other deep link.
 */

export type WidgetData = {
  items: WorkItem[] | null;
  courses: Course[] | null;
  announcements: Announcement[] | null;
  grades: CourseGradeSummary[] | null;
};

const link = (path: string) => `easel://${path.replace(/^\//, '')}`;

export const widgetLinks = {
  todo: link(paths.todo),
  announcements: link(paths.announcements),
  grades: link(paths.grades),
  storage: link('/storage'),
  home: 'easel://',
};

const neutral: WidgetColor = { light: widgetTheme.light.subtle, dark: widgetTheme.dark.subtle };

function colorOf(course: Course | undefined): WidgetColor {
  if (!course) return neutral;
  return {
    light: deriveAccent(course.color, 'light').accentFg,
    dark: deriveAccent(course.color, 'dark').accentFg,
  };
}

function itemLink(item: WorkItem): string {
  if (item.kind === 'note') return link(`/planner-note/${encodeURIComponent(item.plannableId)}`);
  const path = plannablePath(item.plannableType, item.plannableId, item.courseId);
  return path ? link(path) : widgetLinks.todo;
}

const isWork = (item: WorkItem) => item.kind !== 'event' && item.kind !== 'announcement';

type Lookup = (courseId: string | null) => Course | undefined;

function lookup(courses: Course[] | null): Lookup {
  const byId = new Map((courses ?? []).map((c) => [c.id, c]));
  return (id) => (id ? byId.get(id) : undefined);
}

const contextOf = (item: WorkItem, course: Course | undefined) =>
  course?.code ?? item.contextName ?? (item.kind === 'note' ? 'Personal' : 'Canvas');

function signedOutList(title: string): ListWidgetProps {
  return {
    state: 'signedOut',
    theme: widgetTheme,
    url: widgetLinks.home,
    title,
    summary: '',
    rows: [],
    empty: '',
    message: 'Sign in to Easel to see your work here.',
  };
}

export function signedOutNextDue(): NextDueProps {
  return {
    state: 'signedOut',
    theme: widgetTheme,
    url: widgetLinks.home,
    headline: 'Next due',
    title: null,
    context: null,
    color: null,
    summary: null,
    inline: 'Sign in to Easel',
    rows: [],
    message: 'Sign in to Easel to see your work here.',
  };
}

export function waitingNextDue(): NextDueProps {
  return { ...signedOutNextDue(), state: 'waiting', inline: 'Open Easel', message: WAITING_MESSAGE };
}

export function waitingList(title: string, url: string): ListWidgetProps {
  return { ...signedOutList(title), state: 'waiting', url, message: WAITING_MESSAGE };
}

export const signedOut = {
  todo: () => signedOutList('To Do'),
  announcements: () => signedOutList('Announcements'),
  grades: () => signedOutList('Grades'),
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The next deadline, what's missing, and what else is due this week (HOME-1 on the home screen). */
export function buildNextDue(
  items: WorkItem[],
  courses: Course[] | null,
  now: Date,
  display: DateContext = createDateContext(),
): NextDueProps {
  const courseFor = lookup(courses);
  const { next, overdue, later } = summarizeDue(items, now);
  const laterThisWeek = later.filter((a) => display.daysFrom(a.dueAt, now) < 7).length;
  const summary =
    [
      overdue.length ? plural(overdue.length, 'missing', 'missing') : null,
      laterThisWeek ? `${laterThisWeek} more due this week` : null,
    ]
      .filter(Boolean)
      .join(' · ') || null;

  if (!next) {
    return {
      state: 'ready',
      theme: widgetTheme,
      url: widgetLinks.todo,
      headline: overdue.length ? plural(overdue.length, 'missing item', 'missing items') : 'Nothing due',
      title: overdue.length ? null : 'No upcoming work.',
      context: null,
      color: null,
      summary: overdue.length ? 'No other upcoming work.' : null,
      inline: overdue.length ? plural(overdue.length, 'missing item', 'missing items') : 'Nothing due',
      rows: [],
      message: '',
    };
  }

  const course = courseFor(next.courseId);
  const context = contextOf(next, course);
  return {
    state: 'ready',
    theme: widgetTheme,
    url: itemLink(next),
    headline: display.t('background.due', { when: display.dueIn(next.dueAt, now) }),
    title: next.title,
    context,
    color: colorOf(course),
    summary,
    inline: display.t('background.contextDue', { context, when: display.dueIn(next.dueAt, now) }),
    rows: later.slice(0, 3).map((item) => ({
      id: item.id,
      title: item.title,
      context: contextOf(item, courseFor(item.courseId)),
      color: colorOf(courseFor(item.courseId)),
      detail: display.formatDueDate(item.dueAt, now),
      flag: null,
      url: itemLink(item),
    })),
    message: '',
  };
}

/**
 * Moments when the Next due widget's text changes: each deadline passing, the
 * minutes and hours counting down, and midnight. iOS shows each entry at its
 * time without waking Easel.
 */
export function nextDueTimeline(
  items: WorkItem[],
  courses: Course[] | null,
  now: Date,
  display: DateContext = createDateContext(),
) {
  const horizon = now.getTime() + 24 * 60 * 60_000;
  const times = new Set<number>([now.getTime()]);
  const open = items.filter(
    (i) => isWork(i) && !isDone(i) && !i.dismissed && i.dueAt.getTime() > now.getTime(),
  );
  for (const item of open) {
    const due = item.dueAt.getTime();
    if (due > horizon) continue;
    times.add(due + 1_000);
    // "in 40 minutes" counts down through the last hour in 10-minute steps.
    for (let m = 60; m > 0; m -= 10) if (due - m * 60_000 > now.getTime()) times.add(due - m * 60_000);
  }
  // "in 5 hours" changes on the hour.
  for (let h = 1; h <= 12; h += 1) {
    const t = new Date(now);
    t.setMinutes(0, 0, 0);
    t.setHours(t.getHours() + h);
    times.add(t.getTime());
  }
  const midnight = dayBoundary(now, 1, display.timeZone);
  midnight.setTime(midnight.getTime() + 1_000);
  times.add(midnight.getTime());
  return [...times]
    .sort((a, b) => a - b)
    .slice(0, 48)
    .map((t) => ({ date: new Date(t), props: buildNextDue(items, courses, new Date(t), display) }));
}

/** Missing work, then what's due today and tomorrow. */
export function buildTodo(
  items: WorkItem[],
  courses: Course[] | null,
  now: Date,
  display: DateContext = createDateContext(),
): ListWidgetProps {
  const courseFor = lookup(courses);
  const open = items
    .filter((i) => isWork(i) && !isDone(i) && !i.dismissed)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const missing = open.filter((i) => i.status === 'missing' || i.dueAt < now);
  const soon = open.filter((i) => !missing.includes(i) && display.daysFrom(i.dueAt, now) <= 1);
  const today = soon.filter((i) => display.daysFrom(i.dueAt, now) === 0).length;
  const tomorrow = soon.length - today;

  const row = (item: WorkItem, flag: WidgetRow['flag']): WidgetRow => {
    const course = courseFor(item.courseId);
    const days = display.daysFrom(item.dueAt, now);
    return {
      id: item.id,
      title: item.title,
      context: contextOf(item, course),
      color: colorOf(course),
      detail: days === 0 ? display.formatTime(item.dueAt) : display.dayLabel(item.dueAt, now),
      flag,
      url: itemLink(item),
    };
  };

  const summary = today
    ? `${today} due today`
    : tomorrow
      ? `${tomorrow} due tomorrow`
      : missing.length
        ? `${missing.length} missing`
        : '';

  return {
    state: 'ready',
    theme: widgetTheme,
    url: widgetLinks.todo,
    title: 'To Do',
    summary,
    rows: [...missing.map((i) => row(i, 'missing')), ...soon.map((i) => row(i, null))],
    empty: 'Nothing due today or tomorrow.',
    message: '',
  };
}

export function buildAnnouncements(
  announcements: Announcement[],
  courses: Course[] | null,
  now: Date,
  display: DateContext = createDateContext(),
): ListWidgetProps {
  const courseFor = lookup(courses);
  const sorted = [...announcements].sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
  const unread = sorted.filter((a) => a.unread).length;
  return {
    state: 'ready',
    theme: widgetTheme,
    url: widgetLinks.announcements,
    title: 'Announcements',
    summary: unread ? `${unread} unread` : '',
    rows: sorted.slice(0, 7).map((a) => {
      const course = courseFor(a.courseId);
      return {
        id: a.id,
        title: a.title,
        context: course?.code ?? (a.authorNameFallback === 'unknown' ? display.t('discussions.unknownAuthor') : a.author.name),
        color: colorOf(course),
        detail: display.relativeAge(a.postedAt, now),
        flag: a.unread ? 'unread' : null,
        url: a.courseId ? link(paths.discussion(a.courseId, a.id)) : widgetLinks.announcements,
      };
    }),
    empty: 'No announcements in the last two weeks.',
    message: '',
  };
}

const percent = (score: number) => `${Number.isInteger(score) ? score : score.toFixed(1)}%`;

/** Current grades, only when the student turned the widget on. Hidden totals stay hidden. */
export function buildGrades(
  grades: CourseGradeSummary[] | null,
  courses: Course[] | null,
  enabled: boolean,
): ListWidgetProps {
  if (!enabled) {
    return {
      state: 'off',
      theme: widgetTheme,
      url: widgetLinks.storage,
      title: 'Grades',
      summary: '',
      rows: [],
      empty: '',
      message: 'Turn on in Easel to show your grades here.',
    };
  }
  if (!grades) {
    return {
      state: 'waiting',
      theme: widgetTheme,
      url: widgetLinks.grades,
      title: 'Grades',
      summary: '',
      rows: [],
      empty: '',
      message: WAITING_MESSAGE,
    };
  }
  const courseFor = lookup(courses);
  // Dashboard courses first, in their order; then the rest.
  const order = new Map((courses ?? []).map((c, i) => [c.id, i]));
  const sorted = [...grades].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  return {
    state: 'ready',
    theme: widgetTheme,
    url: widgetLinks.grades,
    title: 'Grades',
    summary: '',
    rows: sorted.map((g) => {
      const course = courseFor(g.id);
      const detail = g.hidden
        ? 'Hidden'
        : g.restricted
          ? (g.grade ?? 'No grade')
          : [g.grade, g.score !== null ? percent(g.score) : null].filter(Boolean).join(' · ') || 'No grade';
      return {
        id: g.id,
        title: course?.code ?? g.code,
        context: course?.name ?? g.name,
        color: course
          ? colorOf(course)
          : { light: deriveAccent(g.color, 'light').accentFg, dark: deriveAccent(g.color, 'dark').accentFg },
        detail,
        flag: null,
        url: link(`/course/${encodeURIComponent(g.id)}/grades`),
      };
    }),
    empty: 'No active courses.',
    message: '',
  };
}
