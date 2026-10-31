import type { EPortfolio } from '@/canvas/api/eportfolios';
import { createTranslator } from '@/i18n/runtime';
import { createDateContext } from '@/lib/dates';

export function portfolioPresentation(item: EPortfolio, locale: string, timeZone: string) {
  const t = createTranslator(locale);
  const dates = createDateContext(locale, timeZone);
  const timestamp = item.updatedAt ?? item.createdAt;
  const title = item.titleFallback === 'untitled' ? t('portfolios.untitled') : item.title;
  return {
    title,
    visibility: item.public ? t('portfolios.public') : t('portfolios.private'),
    date: timestamp ? t(item.updatedAt ? 'portfolios.updated' : 'portfolios.created', {
      date: new Intl.DateTimeFormat(dates.locale, { calendar: 'gregory', timeZone: dates.timeZone, year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(timestamp)),
    }) : null,
    openLabel: t('portfolios.openNamed', { title }),
  };
}
