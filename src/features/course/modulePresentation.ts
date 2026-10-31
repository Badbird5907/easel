import type { CompletionRequirement, ModuleItemType } from '@/canvas/api/modules';
import { formatNumber } from '@/i18n/runtime';
import { createDateContext } from '@/lib/dates';

/** Scoped to each rendering consumer, including same-object locale/Canvas-zone updates. */
export function createModulePresentation(locale: string, timeZone: string) {
  const dates = createDateContext(locale, timeZone);
  const { t } = dates;
  const number = (value: number) =>
    formatNumber(value, { useGrouping: false, maximumSignificantDigits: 21 }, dates.locale);
  // Thresholds previously used String(number); retain their precision, unlike points (two decimals).
  // Canvas thresholds are already percentages. Unit formatting avoids dividing/re-multiplying
  // the value (which can expose floating-point artifacts or round tiny thresholds to zero).
  const percent = (value: number) =>
    formatNumber(
      value,
      {
        style: 'unit',
        unit: 'percent',
        unitDisplay: 'narrow',
        useGrouping: false,
        maximumSignificantDigits: 21,
      },
      dates.locale,
    );
  const list = (names: string[]) =>
    new Intl.ListFormat(dates.locale, { style: 'long', type: 'conjunction' }).format(names);
  const dateTime = (date: Date, now = new Date()) =>
    t('date.at', {
      day: dates.formatShortDate(date, now),
      time: dates.formatTime(date),
    });
  const due = (date: Date, now = new Date()) => t('modules.due', { date: dateTime(date, now) });
  function points(value: number | null | undefined) {
    if (value == null) return null;
    const params = {
      count: value,
      value: formatNumber(
        Number.isInteger(value) ? value : Number(value.toFixed(2)),
        {
          useGrouping: false,
          maximumFractionDigits: 2,
        },
        dates.locale,
      ),
    };
    return t('modules.points', params);
  }
  const kind = (type: ModuleItemType) => t(`modules.kind.${type}`);
  const threshold = (req: CompletionRequirement) =>
    req.type === 'min_percentage' ? percent(req.minPercentage ?? 0) : number(req.minScore ?? 0);
  function requirementLabel(req: CompletionRequirement): string {
    if (req.type === 'min_score' || req.type === 'min_percentage')
      return t(
        req.completed === true
          ? 'modules.requirement.threshold.done'
          : 'modules.requirement.threshold',
        { value: threshold(req) },
      );
    return req.completed === true
      ? t(`modules.requirement.${req.type}.done`)
      : t(`modules.requirement.${req.type}`);
  }
  function requirementInstruction(req: CompletionRequirement): string {
    if (req.type === 'min_score' || req.type === 'min_percentage')
      return t('modules.instruction.threshold', { value: threshold(req) });
    return t(`modules.instruction.${req.type}`);
  }
  return {
    t,
    number,
    percent,
    list,
    dateTime,
    due,
    points,
    kind,
    requirementLabel,
    requirementInstruction,
  };
}
