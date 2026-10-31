import { formatNumber } from '@/i18n/runtime';
import { createDateContext } from '@/lib/dates';

/** The existing page conflict age thresholds, scoped to the invoking viewer. */
export function pageRevisionAge(date: Date, locale: string, timeZone: string, now = new Date()): string {
  const dates = createDateContext(locale, timeZone);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return dates.t('date.now');
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 7) return dates.formatShortDate(date, now);
  const [value, unit] = minutes < 60 ? [minutes, 'minute'] as const :
    hours < 24 ? [hours, 'hour'] as const : [days, 'day'] as const;
  return new Intl.RelativeTimeFormat(dates.locale, { numeric: 'always' }).format(-value, unit);
}

/** Syllabus-only presentation; retain the course formatter's year and precision rules. */
export function createSyllabusPresentation(locale: string, timeZone: string) {
  const dates = createDateContext(locale, timeZone);
  const format = (date: Date, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(dates.locale, { calendar: 'gregory', ...options, timeZone: dates.timeZone }).format(date);
  function day(date: Date, now = new Date()) {
    const sameYear = format(date, { year: 'numeric' }) === format(now, { year: 'numeric' });
    return format(date, { weekday: 'short', month: 'short', day: 'numeric', ...(!sameYear && { year: 'numeric' }) });
  }
  function dateTime(date: Date, now = new Date()) {
    return dates.t('date.at', { day: day(date, now), time: dates.formatTime(date) });
  }
  function points(value: number | null | undefined) {
    if (value == null) return null;
    // Keep the prior two-decimal presentation; grammar uses the actual numeric count.
    const params = {
      count: value,
      value: formatNumber(Number.isInteger(value) ? value : Number(value.toFixed(2)), {
        useGrouping: false, maximumFractionDigits: 2,
      }, dates.locale),
    };
    return dates.t('syllabus.points', params);
  }
  return { day, dateTime, points };
}
