import { createTranslator, formatNumber } from '@/i18n/runtime';
import { scriptJson } from '@/features/content/presentation';

/** Display only: preserve the player's floor, minute rollover and hour rules. */
export function previewClock(seconds: number, locale: string) {
  const value = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const t = createTranslator(locale);
  const number = (n: number, minimumIntegerDigits = 1) =>
    formatNumber(n, { useGrouping: false, minimumIntegerDigits }, locale);
  const hours = Math.floor(value / 3600);
  return hours > 0
    ? t('files.previews.clockHours', {
        hours: number(hours),
        minutes: number(Math.floor(value / 60) % 60, 2),
        seconds: number(Math.floor(value % 60), 2),
      })
    : t('files.previews.clockMinutes', {
        minutes: number(Math.floor(value / 60) % 60),
        seconds: number(Math.floor(value % 60), 2),
      });
}

/** Spoken durations retain total minutes (including beyond one hour). */
export function previewSpokenTime(seconds: number, locale: string) {
  const t = createTranslator(locale);
  const minutes = Math.floor(seconds / 60);
  const rest = t('files.previews.seconds', { count: Math.floor(seconds % 60) });
  return minutes > 0
    ? t('files.previews.minuteSeconds', {
        minutes: t('files.previews.minutes', { count: minutes }),
        seconds: rest,
      })
    : rest;
}

/** Preformat digits on the native side; no dependency on WebView Intl support. */
export function pdfPresentation(locale: string) {
  return {
    page: createTranslator(locale)('files.previews.pageLabel', {
      current: '{current}',
      total: '{total}',
    }),
    digits: Array.from({ length: 10 }, (_, n) => formatNumber(n, { useGrouping: false }, locale)),
  };
}

/** May arrive before document initialization; the document consumes the pending value. */
export function pdfPresentationScript(value: ReturnType<typeof pdfPresentation>) {
  return `window.easelPdfLabels = ${scriptJson(value)}; window.easelUpdatePdfLabels && window.easelUpdatePdfLabels(); true;`;
}
