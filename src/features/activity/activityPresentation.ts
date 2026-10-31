import type { ActivityItem } from '@/canvas/api/activity';
import { useTranslation, type Translate } from '@/i18n';
import { createDateContext, dayKey, type DateContext, useDisplayTimeZone } from '@/lib/dates';

export function useActivityPresentation() {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  return { t, dates: createDateContext(locale, zone) };
}

export function activityPresentationText(item: ActivityItem, t: Translate, locale: string) {
  const generated = item.generatedTitle;
  let title = item.title;
  if (generated?.kind === 'mention')
    title = generated.author
      ? t('activityPresentation.mentionAuthor', { author: generated.author })
      : t('activityPresentation.mention');
  else if (generated?.kind === 'untitled') title = t('activityPresentation.untitled');
  else if (generated?.kind === 'assignment') title = t('activityPresentation.assignment');
  let preview = item.preview;
  const p = item.generatedPreview;
  if (p?.kind === 'comment')
    preview = `${t('activityPresentation.comment')}: ${p.body}`
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 200);
  else if (p?.kind === 'scored') {
    const number = new Intl.NumberFormat(locale, {
      useGrouping: false,
      maximumFractionDigits: 20,
    });
    preview = t('activityPresentation.scored', {
      score: number.format(p.score),
      points: number.format(p.points),
    });
  } else if (p?.kind === 'grade') preview = t('activityPresentation.grade', { grade: p.grade });
  else if (p?.kind === 'graded') preview = t('activityPresentation.graded');
  else if (p?.kind === 'excused') preview = t('activityPresentation.excused');
  return { title, preview };
}

export function activityPresentationDays(items: ActivityItem[], now: Date, dates: DateContext) {
  const groups = new Map<string, { key: string; title: string; items: ActivityItem[] }>();
  for (const item of items) {
    const key = dayKey(item.updatedAt, dates.timeZone);
    const group = groups.get(key) ?? {
      key,
      title: dates.dayLabel(item.updatedAt, now),
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}
