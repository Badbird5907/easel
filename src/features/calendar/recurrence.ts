import { t as currentTranslation } from '@/i18n/runtime';
import type { Translate } from '@/i18n/types';
import {
  addDays,
  dateFormatter,
  dateParts,
  dayBoundary,
  dayKey,
  fromWallTime,
  weekday,
  withTime,
} from '@/lib/dates';
import { addMonths } from './month';

/**
 * Repeating personal events (CAL-5). Canvas stores a series as an iCalendar
 * RRULE and creates every event up front, so a rule must end: COUNT or UNTIL,
 * at most 400 events (rrule_helper.rb). The presets match the Canvas web
 * calendar's (FrequencyPicker/utils.ts); anything else made on the web is
 * kept as it is.
 */

export type RepeatKind = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export type Recurrence =
  | { kind: RepeatKind; until: Date }
  /** A rule Easel doesn't offer, made on the Canvas web. Saved untouched. */
  | { kind: 'custom'; rule: string; text: string | null };

/** Canvas creates every event of a series and stops at this many (RruleHelper::RECURRING_EVENT_LIMIT). */
export const MAX_OCCURRENCES = 400;

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const WEEKDAYS = 'MO,TU,WE,TH,FR';
const monthlyLabels = [
  'repeat.monthly.first',
  'repeat.monthly.second',
  'repeat.monthly.third',
  'repeat.monthly.fourth',
  'repeat.monthly.fifth',
] as const;

const weekdayName = dateFormatter({ weekday: 'long' });
const monthDay = dateFormatter({ month: 'long', day: 'numeric' });
const shortDate = dateFormatter({ month: 'short', day: 'numeric', year: 'numeric' });

/** Which occurrence of its weekday a date is in its month: the 2nd Tuesday, or the last. */
function weekdayPosition(date: Date): { pos: number; last: boolean } {
  const pos = Math.ceil(dateParts(date).day / 7);
  return { pos, last: dateParts(addDays(date, 7)).month !== dateParts(date).month };
}

/** Monthly rules use "last" for a 5th weekday, so they fire every month. */
function monthlyPosition(date: Date): number {
  const { pos, last } = weekdayPosition(date);
  return last && pos >= 4 ? -1 : pos;
}

/** "Every week on Tuesday", for the picker and the event screen. */
export function describeRepeat(kind: RepeatKind, start: Date, t: Translate = currentTranslation): string {
  switch (kind) {
    case 'none':
      return t('repeat.none');
    case 'daily':
      return t('repeat.daily');
    case 'weekdays':
      return t('repeat.weekdays');
    case 'weekly':
      return t('repeat.weekly', { weekday: weekdayName.format(start) });
    case 'biweekly':
      return t('repeat.biweekly', { weekday: weekdayName.format(start) });
    case 'monthly': {
      const pos = monthlyPosition(start);
      return t(pos === -1 ? 'repeat.monthly.last' : monthlyLabels[pos - 1], {
        weekday: weekdayName.format(start),
      });
    }
    case 'yearly':
      return t('repeat.yearly', { date: monthDay.format(start) });
  }
}

const shortLabels = {
  none: 'repeat.short.none',
  daily: 'repeat.short.daily',
  weekdays: 'repeat.short.weekdays',
  weekly: 'repeat.short.weekly',
  biweekly: 'repeat.short.biweekly',
  monthly: 'repeat.short.monthly',
  yearly: 'repeat.short.yearly',
} as const;

/** Short form for the form's row value: "Weekly". */
export function repeatValue(recurrence: Recurrence, t: Translate = currentTranslation): string {
  if (recurrence.kind === 'custom') return recurrence.text ?? t('event.custom');
  return t(shortLabels[recurrence.kind]);
}

export const repeatKinds: RepeatKind[] = [
  'none',
  'daily',
  'weekdays',
  'weekly',
  'biweekly',
  'monthly',
  'yearly',
];

function endOfDay(date: Date): Date {
  return new Date(dayBoundary(date, 1).getTime() - 1000);
}

/** A sensible end for a new series: a semester of weekly events, a month of daily ones. */
export function defaultUntil(kind: RepeatKind, start: Date): Date {
  switch (kind) {
    case 'daily':
    case 'weekdays':
      return endOfDay(addDays(start, 27));
    case 'monthly': {
      const p = dateParts(start);
      const d = fromWallTime({ ...p, month: p.month + 5 });
      return endOfDay(d);
    }
    case 'yearly': {
      const p = dateParts(start);
      const d = fromWallTime({ ...p, year: p.year + 4 });
      return endOfDay(d);
    }
    default:
      return endOfDay(addDays(start, 7 * 14));
  }
}

/** `20261212T055959Z`: UNTIL in UTC, as Canvas's web calendar writes it. */
function icalUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function fromIcal(value: string): Date | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, h = '23', mi = '59', s = '59', z] = m;
  return z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
    : fromWallTime({ year: +y, month: +mo, day: +d, hour: +h, minute: +mi, second: +s });
}

/** The RRULE Canvas stores for a preset ending on `until` (inclusive). Null for "Doesn't repeat". */
export function buildRule(kind: RepeatKind, start: Date, until: Date): string | null {
  const end = `UNTIL=${icalUtc(endOfDay(until))}`;
  const day = DAY_CODES[weekday(start)];
  switch (kind) {
    case 'none':
      return null;
    case 'daily':
      return `FREQ=DAILY;INTERVAL=1;${end}`;
    case 'weekdays':
      return `FREQ=WEEKLY;BYDAY=${WEEKDAYS};INTERVAL=1;${end}`;
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${day};INTERVAL=1;${end}`;
    case 'biweekly':
      return `FREQ=WEEKLY;BYDAY=${day};INTERVAL=2;${end}`;
    case 'monthly':
      return `FREQ=MONTHLY;BYSETPOS=${monthlyPosition(start)};BYDAY=${day};INTERVAL=1;${end}`;
    case 'yearly': {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `FREQ=YEARLY;BYMONTH=${pad(dateParts(start).month)};BYMONTHDAY=${pad(dateParts(start).day)};INTERVAL=1;${end}`;
    }
  }
}

function parseFields(rule: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of rule.replace(/^RRULE:/i, '').split(';')) {
    const [key, value] = part.split('=');
    if (key && value !== undefined) fields[key.toUpperCase()] = value;
  }
  return fields;
}

/** The preset a rule matches for an event starting at `start`, or null. */
function presetOf(fields: Record<string, string>, start: Date): RepeatKind | null {
  const interval = Number(fields.INTERVAL ?? '1');
  const day = DAY_CODES[weekday(start)];
  const extra = Object.keys(fields).filter(
    (k) =>
      !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYSETPOS', 'BYMONTH', 'BYMONTHDAY', 'WKST'].includes(
        k,
      ),
  );
  if (extra.length) return null;
  switch (fields.FREQ) {
    case 'DAILY':
      return interval === 1 && !fields.BYDAY ? 'daily' : null;
    case 'WEEKLY':
      if (fields.BYDAY === WEEKDAYS && interval === 1) return 'weekdays';
      if ((fields.BYDAY ?? day) !== day) return null;
      return interval === 1 ? 'weekly' : interval === 2 ? 'biweekly' : null;
    case 'MONTHLY':
      return interval === 1 &&
        fields.BYDAY === day &&
        Number(fields.BYSETPOS) === monthlyPosition(start) &&
        !fields.BYMONTHDAY
        ? 'monthly'
        : null;
    case 'YEARLY':
      return interval === 1 &&
        Number(fields.BYMONTH) === dateParts(start).month &&
        Number(fields.BYMONTHDAY) === dateParts(start).day
        ? 'yearly'
        : null;
    default:
      return null;
  }
}

/**
 * Each date a preset falls on, from `start` through `until`, up to `limit`.
 * Enough of RRULE for Easel's presets: the count check and COUNT-to-date.
 */
export function occurrences(kind: RepeatKind, start: Date, until: Date, limit = MAX_OCCURRENCES + 1): Date[] {
  if (kind === 'none') return [start];
  const last = endOfDay(until).getTime();
  const out: Date[] = [];
  const push = (d: Date) => {
    // Keep an existing first event in the later half of an overlap intact.
    if (dayKey(d) === dayKey(start)) d = start;
    if (d.getTime() >= start.getTime() - 60_000 && d.getTime() <= last) out.push(d);
  };
  const clock = dateParts(start);
  const atStartTime = (d: Date) => withTime(d, clock.hour, clock.minute, clock.second);
  for (let i = 0; out.length < limit && i < 4000; i++) {
    let candidate: Date | null = null;
    switch (kind) {
      case 'daily':
        candidate = addDays(start, i);
        break;
      case 'weekdays': {
        const d = addDays(start, i);
        if (weekday(d) !== 0 && weekday(d) !== 6) candidate = d;
        break;
      }
      case 'weekly':
        candidate = addDays(start, i * 7);
        break;
      case 'biweekly':
        candidate = addDays(start, i * 14);
        break;
      case 'monthly': {
        const pos = monthlyPosition(start);
        const first = addMonths(start, i);
        if (pos === -1) {
          const lastDay = addDays(addMonths(first, 1), -1);
          candidate = atStartTime(addDays(lastDay, -((weekday(lastDay) - weekday(start) + 7) % 7)));
        } else {
          const d = addDays(first, ((weekday(start) - weekday(first) + 7) % 7) + (pos - 1) * 7);
          if (dateParts(d).month === dateParts(first).month) candidate = atStartTime(d);
        }
        break;
      }
      case 'yearly': {
        const d = fromWallTime({ ...clock, year: clock.year + i });
        if (dateParts(d).day === clock.day) candidate = d;
        break;
      }
    }
    if (candidate && candidate.getTime() > last) break;
    if (candidate) push(candidate);
  }
  return out;
}

/** Reads a stored rule for the form: a preset with its end date, or a custom rule kept as is. */
export function parseRule(rule: string | null, start: Date, text: string | null): Recurrence {
  if (!rule) return { kind: 'none', until: defaultUntil('weekly', start) };
  const fields = parseFields(rule);
  const kind = presetOf(fields, start);
  if (!kind) return { kind: 'custom', rule, text };
  if (fields.UNTIL) {
    const until = fromIcal(fields.UNTIL);
    if (until) return { kind, until };
  }
  const count = Number(fields.COUNT);
  if (count > 0) {
    const dates = occurrences(kind, start, new Date(start.getTime() + 20 * 365 * 86_400_000), count);
    if (dates.length) return { kind, until: dates[dates.length - 1] };
  }
  return { kind: 'custom', rule, text };
}

/** The rule to save, or null when it doesn't repeat. */
export function ruleFor(recurrence: Recurrence, start: Date): string | null {
  if (recurrence.kind === 'custom') return recurrence.rule;
  return buildRule(recurrence.kind, start, recurrence.until);
}

/** Why a preset can't be saved, if it can't. */
export function recurrenceProblem(
  recurrence: Recurrence,
  start: Date,
  t: Translate = currentTranslation,
): string | null {
  if (recurrence.kind === 'none' || recurrence.kind === 'custom') return null;
  if (endOfDay(recurrence.until).getTime() < start.getTime()) return t('repeat.endBefore');
  const count = occurrences(recurrence.kind, start, recurrence.until).length;
  if (count > MAX_OCCURRENCES) return t('repeat.tooMany', { count: MAX_OCCURRENCES });
  return null;
}

/** "Every week on Tuesday, until Dec 12, 2026", for the event screen when Canvas has no wording. */
export function describeRecurrence(
  recurrence: Recurrence,
  start: Date,
  t: Translate = currentTranslation,
): string | null {
  if (recurrence.kind === 'none') return null;
  if (recurrence.kind === 'custom') return recurrence.text;
  return t('repeat.until', {
    repeat: describeRepeat(recurrence.kind, start, t),
    date: shortDate.format(recurrence.until),
  });
}

/** How many events a preset makes, for the form's helper text. */
export function occurrenceCount(recurrence: Recurrence, start: Date): number | null {
  if (recurrence.kind === 'none' || recurrence.kind === 'custom') return null;
  return occurrences(recurrence.kind, start, recurrence.until).length;
}
