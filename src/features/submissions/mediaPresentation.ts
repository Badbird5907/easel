import type { Translate } from '@/i18n';

/** Total minutes, floor seconds: inline players intentionally show 60:00. */
export function mediaClock(seconds: number, locale: string) {
  const total = Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : 0;
  const minutes = new Intl.NumberFormat(locale, { useGrouping: false }).format(
    Math.floor(total / 60),
  );
  const rest = new Intl.NumberFormat(locale, {
    useGrouping: false,
    minimumIntegerDigits: 2,
  }).format(total % 60);
  return `${minutes}:${rest}`;
}
export function mediaSpoken(seconds: number, t: Translate) {
  const total = Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(total / 60);
  const rest = t('inlineMedia.seconds', { count: total % 60 });
  return minutes > 0
    ? t('inlineMedia.duration', {
        minutes: t('inlineMedia.minutes', { count: minutes }),
        seconds: rest,
      })
    : rest;
}
