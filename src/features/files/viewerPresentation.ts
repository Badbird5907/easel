import { createTranslator, formatNumber } from '@/i18n';

import { formatSize } from './kinds';

/** Presentation only: retain rounded percentages and the distinction between zero and unknown. */
export function downloadPresentation(fraction: number | null, bytes: number, locale: string) {
  const t = createTranslator(locale);
  if (fraction === null) {
    return {
      label: t('files.downloading'),
      text: t('files.downloadBytes', { size: formatSize(bytes, locale) ?? '' }),
    };
  }
  const percent = formatNumber(
    Math.round(fraction * 100) / 100,
    { style: 'percent', maximumFractionDigits: 0 },
    locale,
  );
  return {
    label: t('files.downloadLabelPercent', { percent }),
    text: t('files.downloadPercent', { percent }),
  };
}
