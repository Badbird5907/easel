import type { CalendarItem } from '@/canvas/api/calendar';
import {
  dayBoundary,
  displayTimeZone,
  fromDayKey,
  fromWallTime,
} from '@/lib/dates';

import { allDayDateKey } from './eventDates';

/** The next four Canvas calendar weeks, including today's events. */
export function exportRange(now = new Date(), timeZone = displayTimeZone()) {
  const start = dayBoundary(now, 0, timeZone);
  return { start, end: dayBoundary(start, 28, timeZone) };
}

/** Serialize civil dates according to each native calendar's all-day contract. */
export function deviceEventDates(
  item: CalendarItem,
  platform: string,
  localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
) {
  if (!item.allDay) {
    return {
      startDate: item.start,
      endDate: item.end ?? item.start,
      allDay: false,
      timeZone: displayTimeZone(),
    };
  }

  const key = allDayDateKey(item.allDayDate, item.start);
  const [year, month, day] = key.split('-').map(Number);
  // Android requires UTC midnight. EventKit uses floating local calendar dates
  // (nil timeZone), with the next civil midnight as the exclusive end.
  const zone = platform === 'android' ? 'UTC' : localZone;
  return {
    startDate: fromDayKey(key, zone),
    endDate: fromWallTime({ year, month, day: day + 1 }, zone),
    allDay: true,
    timeZone: platform === 'android' ? 'UTC' : null,
  };
}
