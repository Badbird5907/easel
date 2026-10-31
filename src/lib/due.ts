import { isDone, type WorkItem } from '@/canvas/models';

import { dayLabel, startOfDay } from './dates';

export type DueGroup = { key: string; title: string; items: WorkItem[] };

/** Calendar events have a time but nothing to turn in; they belong to the calendar. */
const isWork = (item: WorkItem) => item.kind !== 'event' && item.kind !== 'announcement';

/**
 * Overdue first, then one group per due day, then finished work. The group
 * title carries the day, so rows only need to show the time.
 */
export function groupByDue(items: WorkItem[], now: Date = new Date()): DueGroup[] {
  const sorted = items.filter(isWork).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const overdue: WorkItem[] = [];
  const done: WorkItem[] = [];
  const days = new Map<number, DueGroup>();

  for (const item of sorted) {
    if (isDone(item)) {
      done.unshift(item);
    } else if (item.status === 'missing' || item.dueAt < now) {
      overdue.push(item);
    } else {
      const day = startOfDay(item.dueAt).getTime();
      const group = days.get(day) ?? { key: String(day), title: dayLabel(item.dueAt, now), items: [] };
      group.items.push(item);
      days.set(day, group);
    }
  }

  return [
    ...(overdue.length ? [{ key: 'overdue', title: 'Overdue', items: overdue }] : []),
    ...days.values(),
    ...(done.length ? [{ key: 'done', title: 'Done', items: done }] : []),
  ];
}

export type DueSummary = {
  /** The nearest deadline that hasn't passed. */
  next: WorkItem | undefined;
  /** Missing or past due, oldest first. */
  overdue: WorkItem[];
  /** Everything after `next`, soonest first. */
  later: WorkItem[];
};

export function summarizeDue(items: WorkItem[], now: Date = new Date()): DueSummary {
  const open = items
    .filter((a) => isWork(a) && !isDone(a) && !a.dismissed)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const overdue = open.filter((a) => a.status === 'missing' || a.dueAt < now);
  const [next, ...later] = open.filter((a) => !overdue.includes(a));
  return { next, overdue, later };
}
