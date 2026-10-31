import { useMemo } from 'react';
import { createTranslator, useTranslation } from '@/i18n';
import { createDateContext, useDisplayTimeZone } from '@/lib/dates';

export function createBrowsingPresentation(locale: string, zone: string) {
  const t = createTranslator(locale);
  const dates = createDateContext(locale, zone);
  return {
    t,
    dates,
    people(people: { name: string }[], max = 2) {
      if (!people.length) return t('inboxBrowse.onlyYou');
      const names = people
        .slice(0, max)
        .map((p) => p.name)
        .join(', ');
      return people.length > max ? t('inboxBrowse.peopleMore', { names, count: people.length - max }) : names;
    },
    messageDate(date: Date, now: Date) {
      return dates.daysFrom(date, now) === 0 ? dates.formatTime(date) : dates.dayLabel(date, now);
    },
  };
}
export function useBrowsingPresentation() {
  const { locale } = useTranslation();
  const zone = useDisplayTimeZone();
  return useMemo(() => createBrowsingPresentation(locale, zone), [locale, zone]);
}
