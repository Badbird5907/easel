import { createTranslator, normalizeLocale } from '@/i18n/runtime';

/** Seconds remain numeric; only the displayed clock and spoken labels use locale. */
export function mediaMessagePresentation(locale: string) {
  const t = createTranslator(locale);
  const digits = new Intl.NumberFormat(normalizeLocale(locale), { useGrouping: false });
  const pair = new Intl.NumberFormat(normalizeLocale(locale), {
    useGrouping: false,
    minimumIntegerDigits: 2,
  });
  const valid = (seconds: number) => (Number.isFinite(seconds) && seconds >= 0 ? seconds : 0);
  return {
    clock(seconds: number) {
      const value = valid(seconds);
      return `${digits.format(Math.floor(value / 60))}:${pair.format(Math.floor(value % 60))}`;
    },
    spokenTime(seconds: number) {
      const value = valid(seconds);
      const minutes = Math.floor(value / 60);
      const secondsLabel = t('inboxMedia.seconds', { count: Math.floor(value % 60) });
      return minutes > 0
        ? t('inboxMedia.duration', {
            minutes: t('inboxMedia.minutes', { count: minutes }),
            seconds: secondsLabel,
          })
        : secondsLabel;
    },
  };
}
