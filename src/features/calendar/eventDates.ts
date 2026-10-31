import type { CalendarItem, PersonalEventInput, SeriesScope } from '@/canvas/api/calendar';
import { addDays, dayKey, displayTimeZone, fromDayKey, startOfDay } from '@/lib/dates';

/** Retain Canvas's civil date separately from the instant used to lay it out. */
export function allDayDateKey(date: string | null | undefined, fallback: Date): string {
  return date?.match(/^\d{4}-\d{2}-\d{2}$/) ? date : dayKey(fallback);
}

export function projectAllDay<T extends { allDay: boolean; allDayDate?: string | null; start: Date | null }>(
  item: T,
  zone = displayTimeZone(),
): T {
  return item.allDay && item.allDayDate ? { ...item, start: fromDayKey(item.allDayDate, zone) } : item;
}

/** All-day civil dates never move; timed spans occupy every Canvas day they touch. */
export function daysOf(item: CalendarItem): string[] {
  if (item.allDay) return [item.allDayDate ?? dayKey(item.start)];
  const first = startOfDay(item.start);
  if (!item.end || item.end <= item.start) return [dayKey(first)];
  const last = startOfDay(new Date(item.end.getTime() - 1));
  const keys: string[] = [];
  for (let day = first, n = 0; day <= last && n < 42; day = addDays(day, 1), n++) keys.push(dayKey(day));
  return keys;
}

/** Canvas uses time_zone_edited for both recurrence and all_day_date (CalendarEvent#edited_in_zone). */
export function eventBody(input: PersonalEventInput, contextCode?: string, scope?: SeriesScope) {
  const start = input.allDay ? fromDayKey(input.allDayDate ?? dayKey(input.start)) : input.start;
  const end = input.allDay ? start : input.end;
  const rrule = scope === 'one' ? undefined : input.rrule;
  return {
    calendar_event: {
      ...(contextCode ? { context_code: contextCode } : {}),
      title: input.title,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      all_day: input.allDay,
      location_name: input.location,
      ...(input.details !== undefined ? { description: input.details } : {}),
      ...(rrule !== undefined ? { rrule: rrule ?? '' } : {}),
      time_zone_edited: displayTimeZone(),
    },
    ...(scope ? { which: scope } : {}),
  };
}
