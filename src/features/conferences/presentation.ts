import { ConferencesUnavailableError, type Conference, type Recording } from '@/canvas/api/conferences';
import { createTranslator } from '@/i18n';
import { createDateContext } from '@/lib/dates';

/** Explicit viewing inputs keep same-object rows live under React Compiler memoization. */
export function createConferencePresentation(locale: string, zone: string) {
  const t = createTranslator(locale);
  const dates = createDateContext(locale, zone);
  const when = (date: Date, now: Date) => dates.formatDueDate(date, now);
  function minutes(n: number): string {
    if (n < 60) return t('conferences.minutes', { count: n });
    const h = Math.floor(n / 60);
    const m = n % 60;
    const hours = t('conferences.hours', { count: h });
    return m ? t('conferences.hoursMinutes', { hours, minutes: t('conferences.minutes', { count: m }) }) : hours;
  }
  function statusLine(c: Conference, now: Date): string {
    if (c.status === 'live') return c.startedAt ? t('conferences.started', { when: when(c.startedAt, now) }) : t('conferences.progress');
    if (c.status === 'ended') return c.endedAt ? t('conferences.endedAt', { when: when(c.endedAt, now) }) : t('conferences.ended');
    if (c.longRunning) return t('conferences.unlimited');
    return c.durationMinutes ? t('conferences.notStartedDuration', { duration: minutes(c.durationMinutes) }) : t('conferences.notStarted');
  }
  return {
    minutes, statusLine, dayLabel: dates.dayLabel,
    conferenceTitle: (c: Conference) => c.fallbackTitle ? t('conferences.untitled') : c.title,
    recordingTitle: (r: Recording) => r.fallbackTitleNumber !== undefined ? t('conferences.recording', { count: r.fallbackTitleNumber }) : r.title,
    formatLabel: (f: Recording['formats'][number]) => f.fallbackType ? t(`conferences.format.${f.fallbackType}`) : f.label,
    errorMessage: (error: Error) => error instanceof ConferencesUnavailableError ? t('conferences.notSetup') : error.message,
  };
}
