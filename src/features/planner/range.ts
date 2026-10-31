import type { PlannerRange } from '@/canvas/api/planner';
import { dayBoundary, displayTimeZone } from '@/lib/dates';

/** Two weeks back through four weeks ahead, using Canvas calendar days. */
export function upcomingRange(now = new Date(), timeZone = displayTimeZone()): PlannerRange {
  const today = dayBoundary(now, 0, timeZone);
  return { start: dayBoundary(today, -14, timeZone), end: dayBoundary(today, 28, timeZone) };
}
