import { useSyncExternalStore } from 'react';
import { createTranslator, normalizeLocale, displayLocale, subscribeLocale, t } from '@/i18n/runtime';

/*
 * Dates and times as the student reads them (SET-14). Canvas keeps a time zone
 * per student (`users/self/profile` `time_zone`), and due dates mean that
 * zone's clock: "due 11:59 PM" is 11:59 PM where the school says the student
 * is, even when the phone is somewhere else. Every formatter and calendar-day
 * helper here follows that zone once it's set with `setDisplayTimeZone`;
 * until then, and when it matches the device, they use the device's own.
 */

const DAY_MS = 86_400_000;

const deviceZone: string = (() => {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

/** Null while the Canvas zone is unknown or is the device's: plain local time, the fast path. */
let zone: string | null = null;
let version = 0;
const listeners = new Set<() => void>();

/** Whether this runtime knows `name` as an IANA time zone. */
export function isValidTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * Formats and calendar days follow `name` from now on: the student's Canvas
 * time zone, as an IANA name. Null, unknown names, and the device's own zone
 * all mean local time. Returns whether the zone changed.
 */
export function setDisplayTimeZone(name: string | null | undefined): boolean {
  const next = name && name !== deviceZone && isValidTimeZone(name) ? name : null;
  if (next === zone) return false;
  zone = next;
  version += 1;
  formatters.clear();
  for (const listener of listeners) listener();
  return true;
}

/** The IANA zone dates are shown in right now. */
export function displayTimeZone(): string {
  return zone ?? deviceZone;
}

/** The phone's own zone, for "matches this device" labels. */
export function deviceTimeZone(): string {
  return deviceZone;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The display zone, re-rendering when it changes. Screens that format dates
 * call it so a time zone change in Settings shows up without a relaunch.
 */
export function useDisplayTimeZone(): string {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return displayTimeZone();
}

const formatters = new Map<string, Intl.DateTimeFormat>();
subscribeLocale(() => {
  formatters.clear();
  version += 1;
  for (const listener of listeners) listener();
});

/** A cached formatter in the Canvas display zone and effective locale. */
function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = formatters.get(key);
  if (!f) {
    // Canvas planner dates are Gregorian; localize labels without changing the calendar grid.
    f = new Intl.DateTimeFormat(displayLocale(), { calendar: 'gregory', ...options, ...(zone ? { timeZone: zone } : {}) });
    formatters.set(key, f);
  }
  return f;
}

/** Any date format, in the display zone. Prefer the named helpers below where one fits. */
export function formatDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  return formatter(options).format(date);
}

// --- Wall-clock math in another zone ------------------------------------------------

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partFormatters.set(timeZone, f);
  }
  return f;
}

/** The wall clock in `timeZone` at `date`. */
function zonedParts(date: Date, timeZone: string): Parts {
  const f = partsFormatter(timeZone);
  let parts: Parts | null = null;
  if (typeof f.formatToParts === 'function') {
    const values: Record<string, number> = {};
    for (const part of f.formatToParts(date))
      if (part.type !== 'literal') values[part.type] = Number(part.value);
    parts = {
      year: values.year,
      month: values.month,
      day: values.day,
      hour: values.hour,
      minute: values.minute,
      second: values.second,
    };
  } else {
    // "10/30/2026, 23:59:00"
    const m = f.format(date).match(/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+):(\d+)/);
    if (m) parts = { month: +m[1], day: +m[2], year: +m[3], hour: +m[4], minute: +m[5], second: +m[6] };
  }
  if (!parts || Number.isNaN(parts.year)) {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }
  // Some engines write midnight as 24:00.
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

/** Milliseconds `timeZone` is ahead of UTC at `instant`. */
function offsetAt(instant: number, timeZone: string): number {
  const p = zonedParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

/** Wall-clock fields use a one-based month, independent of the device zone. */
export type WallTime = Parts;

export function dateParts(date: Date, timeZone = displayTimeZone()): WallTime {
  return zonedParts(date, timeZone);
}

/**
 * Resolve a civil clock reading. Overlaps choose the earlier instant; gaps
 * advance by the size of the jump (02:30 becomes 03:30 for a one-hour gap).
 * This is the Date/Temporal "compatible" policy, applied even when device and
 * Canvas zones differ. Do not iterate offset guesses: gaps can oscillate.
 */
export function fromWallTime(
  {
    year,
    month,
    day,
    hour = 0,
    minute = 0,
    second = 0,
  }: Pick<Parts, 'year' | 'month' | 'day'> & Partial<Parts>,
  timeZone = displayTimeZone(),
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // Probe both sides of a transition, including half-hour and date-line jumps.
  const offsets = new Set([-2, -1, 0, 1, 2].map((d) => offsetAt(wall + d * DAY_MS, timeZone)));
  const candidates = [...offsets].map((offset) => wall - offset).sort((a, b) => a - b);
  const exact = candidates.find((at) => at + offsetAt(at, timeZone) === wall);
  if (exact !== undefined) return new Date(exact);
  const after = candidates
    .map((at) => ({ at, delta: at + offsetAt(at, timeZone) - wall }))
    .filter(({ delta }) => delta > 0)
    .sort((a, b) => a.delta - b.delta)[0];
  return new Date(after?.at ?? candidates[0]);
}

/** Stable civil date in the active Canvas zone. */
export function dayKey(date: Date, timeZone = displayTimeZone()): string {
  const p = dateParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Interpret a date-only value as a Canvas civil date, never as UTC midnight. */
export function fromDayKey(key: string, timeZone = displayTimeZone()): Date {
  const [year, month, day] = key.split('-').map(Number);
  return fromWallTime({ year, month, day }, timeZone);
}

/** Calendar-day addition preserves the wall clock across 23/25-hour days. */
export function addDays(date: Date, days: number): Date {
  const p = dateParts(date);
  return fromWallTime({ ...p, day: p.day + days });
}

export function weekday(date: Date): number {
  const p = dateParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

export function withTime(date: Date, hour: number, minute = 0, second = 0): Date {
  return fromWallTime({ ...dateParts(date), hour, minute, second });
}

/** Merge only the requested picker fields, retaining the other Canvas-clock half. */
export function mergeDateTime(
  current: Date,
  picked: Date,
  mode: 'date' | 'time',
  pickedZone = displayTimeZone(),
): Date {
  const p = dateParts(picked, pickedZone);
  const c = dateParts(current);
  const next =
    mode === 'date'
      ? { ...c, year: p.year, month: p.month, day: p.day }
      : { ...c, hour: p.hour, minute: p.minute, second: 0 };
  // A no-op must not move an existing event in the second half of a DST overlap.
  if (Object.keys(c).every((key) => c[key as keyof Parts] === next[key as keyof Parts])) return current;
  return fromWallTime(next);
}

/** A live formatter facade for existing consumers of `.format(date)`. */
export function dateFormatter(options: Intl.DateTimeFormatOptions) {
  return { format: (date: Date) => formatDate(date, options) };
}

/** UTC offset label for a zone right now: "GMT-5", "GMT+5:30". */
export function offsetLabel(timeZone: string, at: Date = new Date()): string {
  const minutes = Math.round(offsetAt(at.getTime(), timeZone) / 60_000);
  if (minutes === 0) return 'GMT';
  const sign = minutes < 0 ? '-' : '+';
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

// --- Calendar days -------------------------------------------------------------------

/** Midnight at the start of `date`'s day, in the display zone. */
export function startOfDay(date: Date): Date {
  return dayBoundary(date, 0);
}

/** Midnight `days` civil days away, including zones whose DST jump is at midnight. */
export function dayBoundary(date: Date, days: number, timeZone = displayTimeZone()): Date {
  const p = dateParts(date, timeZone);
  return fromWallTime({ ...p, day: p.day + days, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** A day count that only changes at midnight in the display zone. */
function dayNumber(date: Date): number {
  if (!zone) return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
  const p = zonedParts(date, zone);
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS);
}

/** Calendar days from `now` to `date`: 0 today, 1 tomorrow, -1 yesterday. */
export function daysFrom(date: Date, now: Date): number {
  return dayNumber(date) - dayNumber(now);
}

/** "Today", "Tomorrow", "Friday", or "Tue, Nov 11" past the coming week. */
export function dayLabel(date: Date, now: Date = new Date()): string {
  const days = daysFrom(date, now);
  if (days === 0) return t('date.today');
  if (days === 1) return t('date.tomorrow');
  if (days === -1) return t('date.yesterday');
  if (days > 1 && days < 7) return formatter({ weekday: 'long' }).format(date);
  return formatter({ weekday: 'short', month: 'short', day: 'numeric' }).format(date);
}

/** "9:00 AM", or the device's 24-hour equivalent. */
export function formatTime(date: Date): string {
  return formatter({ hour: 'numeric', minute: '2-digit' }).format(date);
}

/** "Nov 11", with the year when it isn't this year: "Nov 11, 2025". */
export function formatShortDate(date: Date, now: Date = new Date()): string {
  const sameYear = formatter({ year: 'numeric' }).format(date) === formatter({ year: 'numeric' }).format(now);
  return formatter(
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
  ).format(date);
}

/** "Tue, Nov 11 at 9:00 AM": a full due date and time. */
export function formatDueDate(date: Date, now: Date = new Date()): string {
  return t('date.at', { day: dayLabel(date, now), time: formatTime(date) });
}

/** Phrase that completes "Due …": "in 25 minutes", "in 5 hours", "tomorrow at 9:00 AM", "Friday at 11:59 PM". */
export function dueIn(date: Date, now: Date = new Date()): string {
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  const days = daysFrom(date, now);
  if (minutes >= 0 && minutes < 60) {
    const m = Math.max(minutes, 1);
    return t('date.inMinutes', { count: m });
  }
  if (minutes >= 0 && days === 0) {
    const hours = Math.round(minutes / 60);
    return t('date.inHours', { count: hours });
  }
  const relative: Record<number, string> = { [-1]: t('date.yesterdayLower'), 0: t('date.todayLower'), 1: t('date.tomorrowLower') };
  return t('date.at', { day: relative[days] ?? dayLabel(date, now), time: formatTime(date) });
}

/** Compact age for feeds: "now", "5m", "2h", "3d", then "Oct 12". */
export function relativeAge(date: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return t('date.now');
  if (minutes < 60) return t('date.minutesShort', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('date.hoursShort', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('date.daysShort', { count: days });
  return formatter({ month: 'short', day: 'numeric' }).format(date);
}

/** Standalone elapsed wording, never parse a translated compact age to recover units. */
export function relativeAgeLabel(date: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return t('date.now');
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 7) return formatShortDate(date, now);
  const [value, unit] = minutes < 60 ? [minutes, 'minute'] as const :
    hours < 24 ? [hours, 'hour'] as const : [days, 'day'] as const;
  return new Intl.RelativeTimeFormat(displayLocale(), { numeric: 'always' }).format(-value, unit);
}

/** Immutable presentation context. No reads/writes to foreground locale or zone.
 * Missing metadata deliberately means English and the device zone.
 * Calendar-day arithmetic delegates to the same civil fields used above.
 */
export function createDateContext(effectiveLocale?: string | null, timeZone?: string | null) {
  const locale = normalizeLocale(effectiveLocale);
  const resolvedZone = timeZone && isValidTimeZone(timeZone) ? timeZone : deviceTimeZone();
  const t = createTranslator(locale);
  const cache = new Map<string, Intl.DateTimeFormat>();
  function formatter(options: Intl.DateTimeFormatOptions) {
    const key = JSON.stringify(options);
    let value = cache.get(key);
    if (!value) {
      value = new Intl.DateTimeFormat(locale, { calendar: 'gregory', ...options, timeZone: resolvedZone });
      cache.set(key, value);
    }
    return value;
  }
  function daysFrom(date: Date, now: Date): number {
    const number = (at: Date) => {
      const p = dateParts(at, resolvedZone);
      return Math.round(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS);
    };
    return number(date) - number(now);
  }
  /** "Today", "Tomorrow", "Friday", or "Tue, Nov 11" past the coming week. */
  function dayLabel(date: Date, now: Date = new Date()): string {
    const days = daysFrom(date, now);
    if (days === 0) return t('date.today');
    if (days === 1) return t('date.tomorrow');
    if (days === -1) return t('date.yesterday');
    if (days > 1 && days < 7) return formatter({ weekday: 'long' }).format(date);
    return formatter({ weekday: 'short', month: 'short', day: 'numeric' }).format(date);
  }

  /** "9:00 AM", or the device's 24-hour equivalent. */
  function formatTime(date: Date): string {
    return formatter({ hour: 'numeric', minute: '2-digit' }).format(date);
  }

  /** "Nov 11", with the year when it isn't this year: "Nov 11, 2025". */
  function formatShortDate(date: Date, now: Date = new Date()): string {
    const sameYear =
      formatter({ year: 'numeric' }).format(date) === formatter({ year: 'numeric' }).format(now);
    return formatter(
      sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
    ).format(date);
  }

  /** "Tue, Nov 11 at 9:00 AM": a full due date and time. */
  function formatDueDate(date: Date, now: Date = new Date()): string {
    return t('date.at', { day: dayLabel(date, now), time: formatTime(date) });
  }

  /** Phrase that completes "Due …": "in 25 minutes", "in 5 hours", "tomorrow at 9:00 AM", "Friday at 11:59 PM". */
  function dueIn(date: Date, now: Date = new Date()): string {
    const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
    const days = daysFrom(date, now);
    if (minutes >= 0 && minutes < 60) {
      const m = Math.max(minutes, 1);
      return t('date.inMinutes', { count: m });
    }
    if (minutes >= 0 && days === 0) {
      const hours = Math.round(minutes / 60);
      return t('date.inHours', { count: hours });
    }
    const relative: Record<number, string> = {
      [-1]: t('date.yesterdayLower'),
      0: t('date.todayLower'),
      1: t('date.tomorrowLower'),
    };
    return t('date.at', { day: relative[days] ?? dayLabel(date, now), time: formatTime(date) });
  }

  /** Compact age for feeds: "now", "5m", "2h", "3d", then "Oct 12". */
  function relativeAge(date: Date, now: Date = new Date()): string {
    const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
    if (minutes < 1) return t('date.now');
    if (minutes < 60) return t('date.minutesShort', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('date.hoursShort', { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t('date.daysShort', { count: days });
    return formatter({ month: 'short', day: 'numeric' }).format(date);
  }

  return Object.freeze({
    locale,
    timeZone: resolvedZone,
    t,
    daysFrom,
    dayLabel,
    formatTime,
    formatShortDate,
    formatDueDate,
    dueIn,
    relativeAge,
  });
}
export type DateContext = ReturnType<typeof createDateContext>;
