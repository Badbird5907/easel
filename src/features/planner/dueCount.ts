import { isDone, type WorkItem } from '@/canvas/models';
import { dayBoundary } from '@/lib/dates';

/** Open work that's overdue or due today. Calendar events have nothing to turn in. */
export function countDueNow(items: WorkItem[], now: Date): number {
  const tomorrow = dayBoundary(now, 1);
  return items.filter(
    (item) =>
      item.kind !== 'event' &&
      item.kind !== 'announcement' &&
      !item.dismissed &&
      !isDone(item) &&
      (item.status === 'missing' || item.dueAt < tomorrow),
  ).length;
}
