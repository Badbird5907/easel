import type { PlannerRange } from '@/canvas/api/planner';

import { dayBoundary, dateFormatter, dateParts, dayKey, fromWallTime, weekday } from '@/lib/dates';

export { addDays, dayKey, startOfDay } from '@/lib/dates';

export function startOfMonth(date: Date): Date {
  const { year, month } = dateParts(date);
  return fromWallTime({ year, month, day: 1 });
}

export function addMonths(date: Date, delta: number): Date {
  const { year, month } = dateParts(date);
  return fromWallTime({ year, month: month + delta, day: 1 });
}

export function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/** Weeks start on Sunday, as in Canvas. */
export const WEEK_STARTS_ON = 0;

export function startOfWeek(date: Date): Date {
  return dayBoundary(date, -((weekday(date) - WEEK_STARTS_ON + 7) % 7));
}

/** The weeks that show a month: four to six rows of seven days. */
export function monthWeeks(month: Date): Date[][] {
  const first = startOfWeek(startOfMonth(month));
  const last = dayBoundary(addMonths(month, 1), -1);
  const weeks: Date[][] = [];
  for (let start = first; start <= last; start = dayBoundary(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => dayBoundary(start, i)));
  }
  return weeks;
}

/** Every day the month grid shows, from the first cell to the end of the last. */
export function gridRange(month: Date): PlannerRange {
  const weeks = monthWeeks(month);
  const end = dayBoundary(weeks[weeks.length - 1][6], 1);
  end.setMilliseconds(-1);
  return { start: weeks[0][0], end };
}

/** The seven days of the week containing `date`. */
export function weekDays(date: Date): Date[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => dayBoundary(start, i));
}

export const monthTitle = dateFormatter({ month: 'long', year: 'numeric' });
export const fullDay = dateFormatter({ weekday: 'long', month: 'long', day: 'numeric' });
export const narrowWeekday = dateFormatter({ weekday: 'narrow' });
export const longWeekday = dateFormatter({ weekday: 'long' });
