/**
 * Course grade math, ported from canvas-lms `ui/shared/grading/CourseGradeCalculator.ts`
 * and `AssignmentGroupGradeCalculator.ts` so what-if totals match the web.
 *
 * Pure functions only: no React, no app imports. `calculate.check.ts` runs it
 * against hand-computed examples (`pnpm exec tsx src/features/grades/calculate.check.ts`).
 *
 * Semantics kept from Canvas:
 * - Excused submissions are left out entirely.
 * - "Current" counts only graded work. "Final" counts ungraded work as zero.
 * - Submitted work waiting on a grader (`pending_review`) is left out of
 *   "current"; "final" counts whatever partial score it has.
 * - A grade that isn't posted counts as ungraded: left out of "current", zero
 *   in "final". The student's grade summary has no score for it, and Canvas's
 *   posted totals (GradeCalculator with `ignore_muted`) treat it the same way.
 * - Assignments that are omitted from the final grade, ungraded (`not_graded`),
 *   or unpublished don't count at all.
 * - Drop rules (drop lowest, drop highest, never drop) use the Kane & Kane
 *   algorithm, which picks the drops that give the best group grade.
 * - Weighted groups: groups with nothing possible are skipped, and the rest are
 *   scaled up when their weights total less than 100.
 * - Weighted grading periods combine period totals by period weight.
 */

export type DropRules = {
  dropLowest?: number;
  dropHighest?: number;
  /** Assignment IDs that are never dropped. */
  neverDrop?: string[];
};

export type CalcSubmission = {
  /** Null when ungraded. */
  score: number | null;
  excused: boolean;
  /** Submitted and waiting on a grader (`workflow_state: pending_review`). */
  pendingReview?: boolean;
  /** Grade not posted to the student yet. Counts as ungraded, whatever `score` and `excused` say. */
  hidden?: boolean;
  gradingPeriodId?: string | null;
};

export type CalcAssignment = {
  id: string;
  pointsPossible: number;
  /** False for omit-from-final-grade, not-graded, and unpublished assignments. */
  counts: boolean;
  /** Null when the student has no submission record (not assigned to them). */
  submission: CalcSubmission | null;
};

export type CalcGroup = {
  id: string;
  /** Group weight as a percentage (`group_weight`). */
  weight: number;
  rules?: DropRules;
  assignments: CalcAssignment[];
};

export type CalcGradingPeriod = { id: string; weight: number };

export type CalcOptions = {
  /** The course weights assignment groups (`apply_assignment_group_weights`). */
  weightGroups: boolean;
  /**
   * Set only for an "all grading periods" total in a course whose periods are
   * weighted. Each submission's `gradingPeriodId` places it in a period.
   */
  weightedPeriods?: CalcGradingPeriod[];
};

/** One assignment group's total under one rule (current or final). */
export type GroupAggregate = {
  score: number;
  possible: number;
  /** Graded, non-excused submissions. */
  submissionCount: number;
  /** Assignment IDs the drop rules removed. */
  dropped: string[];
};

export type GroupGrade = { id: string; weight: number; current: GroupAggregate; final: GroupAggregate };

/**
 * A course total. With weighted groups or periods, `score` is already a
 * percentage and `possible` is 100 (or 0 when nothing counts yet).
 * Otherwise both are points.
 */
export type CourseTotal = { score: number | null; possible: number };

export type CourseGrade = {
  groups: Record<string, GroupGrade>;
  current: CourseTotal;
  final: CourseTotal;
  unit: 'percentage' | 'points';
};

// MARK: - Numbers

/** Half-up rounding without binary noise: 89.995 rounds to 90, not 89.99. */
export function roundHalfUp(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return value;
  const clean = Number(value.toPrecision(12));
  const shifted = Math.round(Number(`${clean}e${digits}`));
  return Number(`${shifted}e-${digits}`);
}

const sum = (values: number[]) => values.reduce((total, v) => total + (v || 0), 0);

/** Canvas's `parseScore`: anything non-numeric counts as 0. */
const parseScore = (score: number | null | undefined) =>
  typeof score === 'number' && Number.isFinite(score) ? score : 0;

// MARK: - Drop rules (Kane & Kane, "Dropping Lowest Grades")

type Datum = { id: string; total: number; score: number };

function partition<T>(items: T[], test: (item: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const item of items) (test(item) ? yes : no).push(item);
  return [yes, no];
}

/** Canvas compares string IDs numerically to keep sorting stable. */
const idOrder = (a: Datum, b: Datum) => Number(a.id) - Number(b.id);

function estimateQHigh(pointed: Datum[], unpointed: Datum[], grades: number[]): number {
  if (unpointed.length > 0) {
    const pointsPossible = sum(pointed.map((d) => d.total));
    const bestPointedScore = Math.max(pointsPossible, sum(pointed.map((d) => d.score)));
    const unpointedScore = sum(unpointed.map((d) => d.score));
    return (bestPointedScore + unpointedScore) / pointsPossible;
  }
  return grades[grades.length - 1];
}

function buildBigF(keepCount: number, cannotDrop: Datum[], sortAsc: boolean) {
  return (q: number, items: Datum[]): [number, Datum[]] => {
    const ranked = items
      .map((d) => ({ rated: d.score - q * d.total, d }))
      .sort((a, b) => {
        const diff = sortAsc ? a.rated - b.rated : b.rated - a.rated;
        return diff !== 0 ? diff : idOrder(a.d, b.d);
      });
    const kept = ranked.slice(0, keepCount);
    const qKept = sum(kept.map((k) => k.rated));
    const qCannotDrop = sum(cannotDrop.map((d) => d.score - q * d.total));
    return [qKept + qCannotDrop, kept.map((k) => k.d)];
  };
}

function keepHelper(
  items: Datum[],
  initialKeepCount: number,
  sortAsc: boolean,
  cannotDrop: Datum[],
  maxTotal: number,
): Datum[] {
  const keepCount = Math.max(1, initialKeepCount);
  if (items.length <= keepCount) return items;

  const [unpointed, pointed] = partition([...items, ...cannotDrop], (d) => d.total === 0);
  // Canvas sorts these with the default (string) comparator; numeric order is
  // what it means and gives the same bracket for any realistic score.
  const grades = pointed.map((d) => d.score / d.total).sort((a, b) => a - b);
  let qHigh = estimateQHigh(pointed, unpointed, grades);
  let qLow = grades[0];
  let qMid = (qLow + qHigh) / 2;

  const bigF = buildBigF(keepCount, cannotDrop, sortAsc);
  let [x, keep] = bigF(qMid, items);
  const threshold = 1 / (2 * keepCount * maxTotal ** 2);
  while (qHigh - qLow >= threshold) {
    if (x < 0) qHigh = qMid;
    else qLow = qMid;
    qMid = (qLow + qHigh) / 2;
    if (qMid === qHigh || qMid === qLow) break;
    [x, keep] = bigF(qMid, items);
  }
  return keep;
}

function dropPointed(droppable: Datum[], cannotDrop: Datum[], keepHighest: number, keepLowest: number) {
  const maxTotal = Math.max(...droppable.map((d) => d.total));
  const withLowestDropped = keepHelper(droppable, keepHighest, false, cannotDrop, maxTotal);
  return keepHelper(withLowestDropped, keepLowest, true, cannotDrop, maxTotal);
}

function dropUnpointed(droppable: Datum[], keepHighest: number, keepLowest: number) {
  const sorted = [...droppable].sort((a, b) => (a.score - b.score !== 0 ? a.score - b.score : idOrder(a, b)));
  return sorted.slice(-keepHighest).slice(0, keepLowest);
}

/** Returns what to keep and which IDs were dropped. */
function applyDropRules(data: Datum[], rules: DropRules = {}): { keep: Datum[]; dropped: string[] } {
  let dropLowest = rules.dropLowest || 0;
  let dropHighest = rules.dropHighest || 0;
  const neverDrop = rules.neverDrop ?? [];
  if (!(dropLowest || dropHighest)) return { keep: data, dropped: [] };

  let cannotDrop: Datum[] = [];
  let droppable = data;
  if (neverDrop.length > 0) [cannotDrop, droppable] = partition(data, (d) => neverDrop.includes(d.id));
  if (droppable.length === 0) return { keep: cannotDrop, dropped: [] };

  dropLowest = Math.min(dropLowest, droppable.length - 1);
  dropHighest = dropLowest + dropHighest >= droppable.length ? 0 : dropHighest;
  const keepHighest = droppable.length - dropLowest;
  const keepLowest = keepHighest - dropHighest;
  const hasPointed = droppable.some((d) => d.total > 0);

  const kept = hasPointed
    ? dropPointed(droppable, cannotDrop, keepHighest, keepLowest)
    : dropUnpointed(droppable, keepHighest, keepLowest);
  const keep = [...kept, ...cannotDrop];
  const dropped = droppable.filter((d) => !keep.includes(d)).map((d) => d.id);
  return { keep, dropped };
}

// MARK: - Assignment groups

function aggregate(group: CalcGroup, includeUngraded: boolean): GroupAggregate {
  const data = group.assignments
    // An unposted grade reaches the student with no score and no excused flag (gradebooks_controller
    // grade_summary, Submission#filter_attributes_for_user), so it's ungraded here, not excused.
    .filter((a) => a.counts && a.submission && (a.submission.hidden || a.submission.excused !== true))
    .map((a) => {
      const submission = a.submission!;
      const score = submission.hidden ? null : submission.score;
      return {
        id: a.id,
        total: parseScore(a.pointsPossible),
        score: parseScore(score),
        submitted: score !== null && score !== undefined,
        pendingReview: !submission.hidden && submission.pendingReview === true,
      };
    });

  const relevant = includeUngraded ? data : data.filter((d) => d.submitted && !d.pendingReview);
  const { keep, dropped } = applyDropRules(relevant, group.rules);
  return {
    score: sum(keep.map((d) => d.score)),
    possible: sum(keep.map((d) => d.total)),
    submissionCount: data.filter((d) => d.submitted).length,
    dropped,
  };
}

export function calculateGroupGrade(group: CalcGroup): GroupGrade {
  return {
    id: group.id,
    weight: group.weight || 0,
    current: aggregate(group, false),
    final: aggregate(group, true),
  };
}

// MARK: - Course totals

const weightedPercent = (score: number | null, possible: number, weight: number) =>
  score && weight && possible ? (score / possible) * weight : 0;

function combineGroupGrades(
  grades: GroupGrade[],
  includeUngraded: boolean,
  weightGroups: boolean,
): CourseTotal {
  const scoped = grades.map((g) => ({ ...(includeUngraded ? g.final : g.current), weight: g.weight }));

  if (weightGroups) {
    const relevant = scoped.filter((g) => g.possible);
    const fullWeight = sum(relevant.map((g) => g.weight));
    let total: number | null = sum(relevant.map((g) => weightedPercent(g.score, g.possible, g.weight)));
    if (fullWeight === 0) total = null;
    else if (fullWeight < 100) total = weightedPercent(total, fullWeight, 100);

    const submissionCount = sum(relevant.map((g) => g.submissionCount));
    return {
      score: total === null ? null : roundHalfUp(total, 2),
      possible: submissionCount > 0 || includeUngraded ? 100 : 0,
    };
  }

  return { score: sum(scoped.map((g) => g.score)), possible: sum(scoped.map((g) => g.possible)) };
}

function combinePeriodTotals(
  periods: { total: CourseTotal; weight: number }[],
  includeUngraded: boolean,
): CourseTotal {
  const scoped = includeUngraded ? periods : periods.filter((p) => p.total.possible);
  // The web reports 0% when no period has a graded assignment yet; Canvas's stored score
  // (GradeCalculator#scale_and_round_scores) is nil, and that's the total Easel shows otherwise.
  if (!includeUngraded && scoped.length === 0) return { score: null, possible: 0 };
  const scoreSum = sum(scoped.map((p) => weightedPercent(p.total.score, p.total.possible, p.weight)));
  const totalWeight = sum(scoped.map((p) => p.weight));
  const score = totalWeight === 0 ? 0 : (scoreSum * 100) / Math.min(totalWeight, 100);
  return { score: roundHalfUp(score, 2), possible: 100 };
}

function sumAggregates(a: GroupAggregate, b: GroupAggregate): GroupAggregate {
  return {
    score: a.score + b.score,
    possible: a.possible + b.possible,
    submissionCount: a.submissionCount + b.submissionCount,
    dropped: [...a.dropped, ...b.dropped],
  };
}

function calculateWithWeightedPeriods(
  groups: CalcGroup[],
  periods: CalcGradingPeriod[],
  weightGroups: boolean,
): CourseGrade {
  // Canvas splits each group by period so a closed period's grades can't move.
  const periodTotals: { total: { current: CourseTotal; final: CourseTotal }; weight: number }[] = [];
  const recombined: Record<string, GroupGrade> = {};

  for (const period of periods) {
    const periodGrades: GroupGrade[] = [];
    for (const group of groups) {
      const assignments = group.assignments.filter((a) => a.submission?.gradingPeriodId === period.id);
      if (assignments.length === 0) continue;
      const grade = calculateGroupGrade({ ...group, assignments });
      periodGrades.push(grade);
      const previous = recombined[group.id];
      recombined[group.id] = previous
        ? {
            ...previous,
            current: sumAggregates(previous.current, grade.current),
            final: sumAggregates(previous.final, grade.final),
          }
        : grade;
    }
    periodTotals.push({
      weight: period.weight || 0,
      total: {
        current: combineGroupGrades(periodGrades, false, weightGroups),
        final: combineGroupGrades(periodGrades, true, weightGroups),
      },
    });
  }

  return {
    groups: recombined,
    current: combinePeriodTotals(
      periodTotals.map((p) => ({ total: p.total.current, weight: p.weight })),
      false,
    ),
    final: combinePeriodTotals(
      periodTotals.map((p) => ({ total: p.total.final, weight: p.weight })),
      true,
    ),
    unit: 'percentage',
  };
}

/** The course total and each group's subtotal, as Canvas computes them. */
export function calculateCourseGrade(groups: CalcGroup[], options: CalcOptions): CourseGrade {
  if (options.weightedPeriods && options.weightedPeriods.length > 0) {
    return calculateWithWeightedPeriods(groups, options.weightedPeriods, options.weightGroups);
  }
  const grades = groups.map(calculateGroupGrade);
  return {
    groups: Object.fromEntries(grades.map((g) => [g.id, g])),
    current: combineGroupGrades(grades, false, options.weightGroups),
    final: combineGroupGrades(grades, true, options.weightGroups),
    unit: options.weightGroups ? 'percentage' : 'points',
  };
}

/** A total as a percentage (0 to 100, two decimals), or null when nothing counts yet. */
export function totalPercent(total: CourseTotal, unit: CourseGrade['unit']): number | null {
  if (total.score === null || !total.possible) return null;
  if (unit === 'percentage') return total.score;
  return roundHalfUp((total.score / total.possible) * 100, 2);
}

/** A group subtotal as a percentage, or null when nothing in it counts yet. */
export function groupPercent(grade: GroupAggregate): number | null {
  return grade.possible ? roundHalfUp((grade.score / grade.possible) * 100, 2) : null;
}

/** Replaces scores with hypothetical ones. A what-if score counts as graded. */
export function applyWhatIf(groups: CalcGroup[], whatIf: Record<string, number>): CalcGroup[] {
  if (Object.keys(whatIf).length === 0) return groups;
  return groups.map((group) => ({
    ...group,
    assignments: group.assignments.map((a) =>
      a.id in whatIf
        ? {
            ...a,
            submission: {
              gradingPeriodId: a.submission?.gradingPeriodId ?? null,
              score: whatIf[a.id],
              excused: false,
              pendingReview: false,
              hidden: false,
            },
          }
        : a,
    ),
  }));
}

// MARK: - Letter grades

/** One row of a grading scheme: the lowest score (0 to 1) that earns `name`. */
export type GradingSchemeRow = { name: string; value: number };

/** Canvas's default scheme, used when a course doesn't send its own. */
export const defaultGradingScheme: GradingSchemeRow[] = [
  { name: 'A', value: 0.94 },
  { name: 'A-', value: 0.9 },
  { name: 'B+', value: 0.87 },
  { name: 'B', value: 0.84 },
  { name: 'B-', value: 0.8 },
  { name: 'C+', value: 0.77 },
  { name: 'C', value: 0.74 },
  { name: 'C-', value: 0.7 },
  { name: 'D+', value: 0.67 },
  { name: 'D', value: 0.64 },
  { name: 'D-', value: 0.61 },
  { name: 'F', value: 0 },
];

/** `scoreToLetterGrade` from canvas-lms `packages/grading-utils`. `percent` is 0 to 100. */
export function scoreToLetter(percent: number | null, scheme: GradingSchemeRow[]): string | null {
  if (percent === null || !Number.isFinite(percent) || scheme.length === 0) return null;
  const rows = [...scheme].sort((a, b) => b.value - a.value);
  const score = Math.max(roundHalfUp(percent, 4), 0);
  const row = rows.find(
    (r, i) => score >= parseFloat((r.value * 100).toPrecision(4)) || i === rows.length - 1,
  );
  return row?.name ?? null;
}
