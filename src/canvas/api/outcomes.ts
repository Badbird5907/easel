import { CanvasError, type CanvasClient } from '../client';
import { useCanvasQuery } from '../query';

/** Api::V1::Outcome, resolved in the course context (including account mastery scales). */
export type CanvasOutcome = {
  id: string;
  title: string;
  display_name?: string | null;
  mastery_points?: number | null;
  points_possible?: number | null;
  calculation_method?: string | null;
  calculation_int?: number | null;
};

/** Api::V1::OutcomeResults#serialize_rollup_score. There is no mastery boolean here. */
export type CanvasOutcomeScore = {
  score: number | null;
  count: number;
  hide_points?: boolean;
  links: { outcome: string };
};

type RollupResponse = {
  rollups: { links: { user: string }; scores: CanvasOutcomeScore[] }[];
  linked: { outcomes: CanvasOutcome[] };
};

/** Authored presentation only; never carries restricted numeric data. Old caches omit it. */
export type OutcomeExplanation =
  | { reason: 'hidden' | 'unassessed' | 'unknown' }
  | { reason: 'rollup'; pending: boolean; method: string | null; count?: number };

export type OutcomeMastery = {
  id: string;
  title: string;
  score: number | null;
  possible: number | null;
  threshold: number | null;
  status: 'mastered' | 'not-mastered' | 'unassessed' | 'pending' | 'unknown' | 'hidden';
  explanation: string;
  titleFallback?: 'untitled';
  explanationMetadata?: OutcomeExplanation;
};

export type Outcomes = { kind: 'available'; outcomes: OutcomeMastery[] } | { kind: 'disabled' };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function outcomeMastery(outcome: CanvasOutcome, result?: CanvasOutcomeScore): OutcomeMastery {
  const score = finite(result?.score) ? result.score : null;
  const threshold = finite(outcome.mastery_points) ? outcome.mastery_points : null;
  const possible = finite(outcome.points_possible) ? outcome.points_possible : null;
  const hidden = result?.hide_points === true;
  const status = hidden ? 'hidden' : score === null
    ? result && result.count > 0 ? 'pending' : 'unassessed'
    : threshold === null ? 'unknown' : score >= threshold ? 'mastered' : 'not-mastered';
  const methods: Record<string, string> = {
    highest: 'Canvas uses your highest score.',
    latest: 'Canvas uses your most recent score.',
    average: 'Canvas uses your average score.',
    // These names change meaning behind a Canvas feature flag. Do not recompute or guess weights.
    decaying_average: 'Canvas applies the course’s decaying average policy.',
    standard_decaying_average: 'Canvas applies the course’s decaying average policy.',
    weighted_average: 'Canvas applies the course’s weighted average policy.',
    n_mastery: finite(outcome.calculation_int)
      ? `Canvas requires ${outcome.calculation_int} scores at or above mastery before reporting a rollup.`
      : 'Canvas requires repeated mastery before reporting a rollup.',
  };
  const explanation = status === 'hidden' ? 'Your instructor has hidden points for this outcome.'
    : status === 'unassessed' ? 'No outcome result has been shared with you yet.'
    : status === 'unknown' ? 'Canvas has not supplied a mastery threshold for this outcome.'
    : `${status === 'pending' ? 'Canvas has not calculated a rollup yet. ' : ''}${(Object.prototype.hasOwnProperty.call(methods, outcome.calculation_method ?? '') ? methods[outcome.calculation_method!] : undefined) ?? 'This rollup is calculated by Canvas using the course’s outcome policy.'}`;
  return {
    id: String(outcome.id),
    title: outcome.display_name?.trim() || outcome.title?.trim() || 'Untitled outcome',
    // Strip hidden numbers before they reach the screen or cache.
    score: hidden ? null : score,
    possible: hidden ? null : possible,
    threshold: hidden ? null : threshold,
    status,
    explanation,
    ...(!(outcome.display_name?.trim() || outcome.title?.trim()) ? { titleFallback: 'untitled' as const } : {}),
    explanationMetadata: status === 'hidden' || status === 'unassessed' || status === 'unknown'
      ? { reason: status }
      : { reason: 'rollup', pending: status === 'pending', method: outcome.calculation_method ?? null,
          ...(outcome.calculation_method === 'n_mastery' && finite(outcome.calculation_int)
            ? { count: outcome.calculation_int } : {}) },
  };
}

export function outcomeUnavailable(error: unknown): boolean {
  return error instanceof CanvasError && [403, 404, 405, 501].includes(error.status);
}

export async function fetchOutcomes(client: CanvasClient, courseId: string, signal?: AbortSignal): Promise<Outcomes> {
  const path = `/api/v1/courses/${encodeURIComponent(courseId)}`;
  const features = await client.getAll<string>(`${path}/features/enabled`, undefined, { signal });
  if (!features.includes('student_outcome_gradebook')) return { kind: 'disabled' };
  // Resolve identity from the authenticated client, never a URL parameter or roster.
  const self = await client.get<{ id: string }>('/api/v1/users/self', undefined, signal);
  const data = await client.get<RollupResponse>(`${path}/outcome_rollups`, {
    user_ids: [self.id], include: ['outcomes'], per_page: 100,
  }, signal);
  // This endpoint paginates USERS, not outcomes. Exactly one requested user fits on one page,
  // including duplicate section rows. linked.outcomes includes unassessed outcomes.
  if (!Array.isArray(data?.rollups) || !Array.isArray(data?.linked?.outcomes))
    throw new CanvasError('This school’s outcome response is not supported. Open Canvas to view your outcomes.', 501, path);
  const scores = new Map<string, CanvasOutcomeScore>();
  for (const rollup of data.rollups) {
    if (String(rollup.links.user) !== String(self.id)) continue;
    for (const score of rollup.scores) scores.set(String(score.links.outcome), score);
  }
  return {
    kind: 'available',
    outcomes: [...new Map(data.linked.outcomes.map((outcome) => [String(outcome.id), outcome])).values()]
      .map((outcome) => outcomeMastery(outcome, scores.get(String(outcome.id)))),
  };
}

export function useOutcomes(courseId: string) {
  return useCanvasQuery(['outcomes', courseId], (client, signal) => fetchOutcomes(client, courseId, signal));
}
