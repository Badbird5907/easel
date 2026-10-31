import { formatNumber } from '@/i18n';

/** Preserve the rubric's original toFixed(2) rounding, then localize its digits.
 * Intl's default rounding of the original float is not equivalent (e.g. 1.005).
 */
export function feedbackNumber(value: number, locale: string) {
  const rounded = Number.isInteger(value) ? (value === 0 ? 0 : value) : Number(value.toFixed(2));
  return formatNumber(rounded, { useGrouping: false, maximumFractionDigits: 2 }, locale);
}
