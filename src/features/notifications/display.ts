import { androidPickerValue } from '@/features/planner/pickerDates';
import type { DateContext } from '@/lib/dates';

/** Abstract device-local clock, not today's instant: a DST gap today must not change saved minutes. */
export function quietHourValue(minutes: number): Date {
  return androidPickerValue(new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)), 'time', 'UTC');
}

export const quietHourMinutes = (date: Date) => date.getHours() * 60 + date.getMinutes();

/** Standalone elapsed wording with explicit viewing locale/zone dependencies. */
export function checkAge(date: Date, display: DateContext, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return display.t('date.now');
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 7) return display.formatShortDate(date, now);
  const [value, unit] = minutes < 60 ? [minutes, 'minute'] as const
    : hours < 24 ? [hours, 'hour'] as const : [days, 'day'] as const;
  return new Intl.RelativeTimeFormat(display.locale, { numeric: 'always' }).format(-value, unit);
}
