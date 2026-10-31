import type { MessageKey } from '@/i18n';
import type { PlannerRange } from '@/canvas/api/planner';
import { dayBoundary, startOfDay } from '@/lib/dates';
import { upcomingRange } from './range';
import { isDone, type WorkItem, type WorkItemKind } from '@/canvas/models';

export type StatusFilter = 'all' | 'open' | 'missing' | 'done';

export const statusFilters: { value: StatusFilter; labelKey: MessageKey; test: (a: WorkItem) => boolean }[] =
  [
    { value: 'all', labelKey: 'planner.all', test: () => true },
    { value: 'open', labelKey: 'planner.open', test: (a) => !isDone(a) && a.status !== 'missing' },
    { value: 'missing', labelKey: 'planner.missing', test: (a) => a.status === 'missing' && !isDone(a) },
    { value: 'done', labelKey: 'common.done', test: isDone },
  ];

/** Shown after the course code. Assignments are the default, so they go unlabeled. */
export const kindLabel: Record<WorkItemKind, MessageKey | null> = {
  assignment: null,
  quiz: 'calendar.kind.quiz',
  discussion: 'calendar.kind.discussion',
  page: 'calendar.kind.page',
  note: 'calendar.kind.note',
  event: 'calendar.kind.event',
  peer_review: 'calendar.kind.peer_review',
  announcement: 'calendar.kind.announcement',
};

/** `null` is every course; `personal` is to-dos without a course. */
export type CourseFilter = string | null;
export const PERSONAL = 'personal';

export function matchesCourse(item: WorkItem, filter: CourseFilter) {
  if (filter === null) return true;
  if (filter === PERSONAL) return item.courseId === null;
  return item.courseId === filter;
}

export type RangePreset = 'week' | 'twoWeeks' | 'upcoming' | 'quarter' | 'past';

/** Forward-looking ranges reach two weeks back too, so missing work stays visible. */
function ahead(days: number, now: Date): PlannerRange {
  const today = startOfDay(now);
  return { start: dayBoundary(today, -14), end: dayBoundary(today, days) };
}

export const rangePresets: {
  value: RangePreset;
  labelKey: MessageKey;
  range: (now: Date) => PlannerRange;
}[] = [
  { value: 'week', labelKey: 'planner.rangeWeek', range: (now) => ahead(7, now) },
  { value: 'twoWeeks', labelKey: 'planner.rangeTwoWeeks', range: (now) => ahead(14, now) },
  // The same range as Home, so both share one cached list.
  { value: 'upcoming', labelKey: 'planner.rangeUpcoming', range: (now) => upcomingRange(now) },
  { value: 'quarter', labelKey: 'planner.rangeQuarter', range: (now) => ahead(91, now) },
  {
    value: 'past',
    labelKey: 'planner.rangePast',
    range: (now) => {
      const today = startOfDay(now);
      return { start: dayBoundary(today, -28), end: dayBoundary(today, 1) };
    },
  },
];

export const DEFAULT_RANGE: RangePreset = 'upcoming';

export function rangeFor(preset: RangePreset, now = new Date()): PlannerRange {
  return (rangePresets.find((p) => p.value === preset) ?? rangePresets[2]).range(now);
}
