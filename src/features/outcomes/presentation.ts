import type { OutcomeMastery } from '@/canvas/api/outcomes';
import { createTranslator, formatNumber } from '@/i18n/runtime';

/** Only explicitly tagged authored text is translated. Legacy caches stay verbatim. */
export function outcomePresentation(outcome: OutcomeMastery, locale: string) {
  const t = createTranslator(locale);
  const metadata = outcome.explanationMetadata;
  let explanation = outcome.explanation;
  if (metadata?.reason === 'hidden' || metadata?.reason === 'unassessed' || metadata?.reason === 'unknown') {
    explanation = t(`outcomes.explain.${metadata.reason}`);
  } else if (metadata?.reason === 'rollup') {
    let policy: string;
    // A switch is deliberate: untrusted method IDs must never read Object.prototype.
    switch (metadata.method) {
      case 'highest': case 'latest': case 'average': policy = t(`outcomes.policy.${metadata.method}`); break;
      case 'decaying_average': case 'standard_decaying_average': policy = t('outcomes.policy.decaying'); break;
      case 'weighted_average': policy = t('outcomes.policy.weighted'); break;
      case 'n_mastery': policy = typeof metadata.count === 'number' && Number.isFinite(metadata.count)
        ? t('outcomes.policy.count', { count: metadata.count }) : t('outcomes.policy.repeated'); break;
      default: policy = t('outcomes.policy.default');
    }
    explanation = metadata.pending ? t('outcomes.explain.pending', { policy }) : policy;
  }
  // Preserve Canvas precision so rounding cannot make a below-threshold score look mastered.
  const number = (value: number) => formatNumber(value, { maximumSignificantDigits: 21 }, locale);
  return {
    title: outcome.titleFallback === 'untitled' ? t('outcomes.untitled') : outcome.title,
    status: t(`outcomes.${outcome.status}`),
    score: outcome.score === null ? null : outcome.possible === null
      ? t('outcomes.score', { score: number(outcome.score) })
      : t('outcomes.scorePossible', { score: number(outcome.score), possible: number(outcome.possible) }),
    threshold: outcome.threshold === null ? null : t('outcomes.threshold', { threshold: number(outcome.threshold) }),
    explanation,
  };
}
