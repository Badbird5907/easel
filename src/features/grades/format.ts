import { EyeOff, Flag, type LucideIcon } from 'lucide-react-native';

import type { GradeAssignment, GradeGroup } from '@/canvas/api/grades';
import type { BadgeTone } from '@/design';
import { createTranslator } from '@/i18n/runtime';
import { createDateContext, formatShortDate } from '@/lib/dates';

import { type GradingSchemeRow, scoreToLetter } from './calculate';

export type GradePresentation = ReturnType<typeof createGradePresentation>;
export function createGradePresentation(locale: string, zone: string) {
  return { locale, t: createTranslator(locale), dates: createDateContext(locale, zone) };
}
const english = createTranslator('en');

/** 45 -> "45", 18.25 -> "18.25". */
export const formatPoints = (value: number, locale?: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);

/** 92.4 (already a percentage) -> "92.4%". */
export const formatPercent = (percent: number, locale?: string) =>
  `${formatPoints(percent, locale)}%`;

/** Canvas shows letter grades with a true minus sign: "A−". */
export const displayLetter = (grade: string, p?: GradePresentation) =>
  !p || /^[A-F]-$/.test(grade) ? grade.replace(/-$/, '−') : grade;

/** "A-" -> "A minus", so screen readers don't say "dash". */
export const spokenLetter = (grade: string, p?: GradePresentation) => {
  if (!p) return grade.replace(/-$/, ' minus').replace(/\+$/, ' plus');
  // Custom scheme names remain opaque. Only conventional letter suffixes have speech aliases.
  return /^[A-F][+-]$/.test(grade)
    ? p.t(grade.endsWith('-') ? 'grades.minus' : 'grades.plus', { grade: grade.slice(0, -1) })
    : grade;
};

const passFail: Record<string, string> = {
  complete: 'Complete',
  incomplete: 'Incomplete',
  pass: 'Complete',
  fail: 'Incomplete',
};

/** What the score column shows for one assignment. */
export type ScoreDisplay = {
  /** Main value: "45", "A−", "Complete". Null when there's nothing to show (ungraded, hidden, excused). */
  value: string | null;
  /** "/ 50" after the value, for point-based assignments. Never shown under restricted data. */
  outOf: string | null;
  /** Not graded yet: show a dash where the score will go. */
  ungraded: boolean;
  /** What a screen reader says. */
  spoken: string;
};

type DisplayOptions = {
  /** Course or assignment restricts quantitative data: letters only. */
  restricted: boolean;
  scheme: GradingSchemeRow[];
  /** A what-if score replaces the real one. */
  whatIf?: number;
};

export function describeScore(
  assignment: GradeAssignment,
  options: DisplayOptions,
  p?: GradePresentation,
): ScoreDisplay {
  const t = p?.t ?? english;
  const pointsText = (n: number) => formatPoints(n, p?.locale);
  const s = assignment.submission;
  const restricted = options.restricted || assignment.restricted;
  // A stale override must never bypass hidden/excused or quantitative policy.
  const whatIf = restricted || s?.hidden || s?.excused ? undefined : options.whatIf;
  const points = assignment.pointsPossible;
  const pointBased = assignment.gradingType === 'points' || assignment.gradingType === 'percent';
  const outOf = !restricted && pointBased && points > 0 ? `/ ${pointsText(points)}` : null;

  if (whatIf === undefined) {
    if (s?.hidden)
      return { value: null, outOf: null, ungraded: false, spoken: t('grades.notPostedSpoken') };
    if (s?.excused)
      return { value: null, outOf: null, ungraded: false, spoken: t('grades.excused') };
  }

  // A submission waiting on a grader may carry a partial score (a quiz's auto-graded part).
  // The web's grade summary doesn't show it, and neither does Easel.
  const pending = !!s?.pendingReview && whatIf === undefined;
  const score = whatIf ?? (pending ? null : (s?.score ?? null));
  if (score === null) {
    const state = t(pending ? 'grades.waiting' : 'grades.ungraded');
    return {
      value: null,
      outOf,
      ungraded: true,
      spoken:
        points > 0 && !restricted
          ? t('grades.waitingOutOf', { state, points: pointsText(points) })
          : state,
    };
  }

  const scoreSpoken =
    points > 0
      ? t('grades.outOf', { value: pointsText(score), points: pointsText(points) })
      : t(score === 1 ? 'grades.point' : 'grades.points', { value: pointsText(score) });
  if (whatIf !== undefined)
    return {
      value: pointsText(score),
      outOf,
      ungraded: false,
      spoken: t('grades.whatIfScoreSpoken', { score: scoreSpoken }),
    };

  const grade = s?.grade ?? null;
  if (assignment.gradingType === 'pass_fail') {
    const label =
      (grade &&
        (Object.hasOwn(passFail, grade.toLowerCase())
          ? t(
              passFail[grade.toLowerCase()] === 'Complete'
                ? 'grades.complete'
                : 'grades.incomplete',
            )
          : p && (!restricted || /\p{L}/u.test(grade))
            ? grade
            : null)) ||
      t(score > 0 ? 'grades.complete' : 'grades.incomplete');
    return { value: label, outOf: null, ungraded: false, spoken: label };
  }

  const isLetter = !!grade && (p ? /\p{L}/u.test(grade) : /[a-z]/i.test(grade));
  if (restricted) {
    // Canvas doesn't strip numbers under restricted data, so convert here.
    const letter = isLetter
      ? grade
      : points > 0
        ? scoreToLetter((score / points) * 100, options.scheme)
        : null;
    return letter
      ? {
          value: displayLetter(letter, p),
          outOf: null,
          ungraded: false,
          spoken: spokenLetter(letter, p),
        }
      : { value: null, outOf: null, ungraded: false, spoken: t('grades.graded') };
  }

  if (
    (assignment.gradingType === 'letter_grade' || assignment.gradingType === 'gpa_scale') &&
    grade
  ) {
    return {
      value: displayLetter(grade, p),
      outOf: null,
      ungraded: false,
      spoken: spokenLetter(grade, p),
    };
  }
  if (assignment.gradingType === 'percent' && grade) {
    return {
      value: grade,
      outOf: null,
      ungraded: false,
      spoken: p ? grade : grade.replace('%', ' percent'),
    };
  }
  return {
    value: pointsText(score),
    outOf,
    ungraded: false,
    spoken: scoreSpoken,
  };
}

export type StatusDisplay = {
  label: string;
  tone: BadgeTone;
  icon?: LucideIcon;
  /** A second state the badge can't show, for the row's subtitle: "Dropped" behind "Missing". */
  detail?: string;
};

/**
 * One badge per row. After what-if, unposted, and excused, the order is the web grade
 * summary's status pill (custom status, missing, late, extended). The web marks a dropped
 * row separately, so "Dropped" is the badge only when there's no other status; otherwise
 * it rides along as `detail`.
 */
export function describeStatus(
  assignment: GradeAssignment,
  options: { dropped: boolean; whatIf: boolean; customStatuses: Record<string, string> },
  p?: GradePresentation,
): StatusDisplay | null {
  const t = p?.t ?? english;
  const s = assignment.submission;
  const dropped: StatusDisplay | null = options.dropped
    ? { label: t('grades.dropped'), tone: 'neutral' }
    : null;
  const withDropped = (status: StatusDisplay): StatusDisplay =>
    dropped ? { ...status, detail: dropped.label } : status;

  if (options.whatIf) return withDropped({ label: t('grades.whatIf'), tone: 'accent' });
  if (!s) return dropped;
  if (s.hidden) return { label: t('grades.notPosted'), tone: 'neutral', icon: EyeOff };
  if (s.excused) return { label: t('grades.excused'), tone: 'neutral' };
  if (s.customStatusId) {
    return withDropped({
      // Names come from GraphQL; if that call fails, say what kind of status it is.
      label:
        (Object.hasOwn(options.customStatuses, s.customStatusId)
          ? options.customStatuses[s.customStatusId]
          : undefined) ?? t('grades.instructorStatus'),
      tone: 'info',
      icon: Flag,
    });
  }
  if (s.missing) return withDropped({ label: t('grades.missing'), tone: 'danger' });
  if (s.late) return withDropped({ label: t('grades.late'), tone: 'warning' });
  if (dropped) return dropped;
  if (s.extended) return { label: t('grades.extended'), tone: 'info' };
  return null;
}

/** Row subtitle uses the Canvas display zone, without changing the due instant. */
export function describeMeta(
  assignment: GradeAssignment,
  restricted: boolean,
  now = new Date(),
  p?: GradePresentation,
): string {
  const t = p?.t ?? english;
  const s = assignment.submission;
  const parts = [
    assignment.dueAt
      ? t('grades.due', {
          date: p
            ? p.dates.formatShortDate(assignment.dueAt, now)
            : formatShortDate(assignment.dueAt, now),
        })
      : t('grades.noDue'),
  ];
  const waiting = s && !s.hidden && !s.excused && (s.score === null || s.pendingReview);
  if (waiting && (s.submitted || s.pendingReview)) parts.push(t('grades.submitted'));
  if (
    !restricted &&
    !assignment.restricted &&
    s &&
    !s.hidden &&
    !s.excused &&
    s.pointsDeducted &&
    s.pointsDeducted > 0
  ) {
    parts.push(
      t('grades.penalty', {
        points: t(s.pointsDeducted === 1 ? 'grades.point' : 'grades.points', {
          value: formatPoints(s.pointsDeducted, p?.locale),
        }),
      }),
    );
  }
  if (!assignment.counts) parts.push(t('grades.notCounted'));
  return parts.join(' · ');
}

export function describeGroup(
  group: GradeGroup,
  options: { weighted: boolean; restricted: boolean },
  p?: GradePresentation,
): string | null {
  const t = p?.t ?? english;
  const parts: string[] = [];
  if (options.weighted && !options.restricted)
    parts.push(t('grades.weight', { weight: formatPoints(group.weight, p?.locale) }));
  if (group.dropLowest > 0)
    parts.push(
      group.dropLowest === 1
        ? t('grades.lowest')
        : p
          ? t('grades.lowestMany', { count: group.dropLowest })
          : `Lowest ${group.dropLowest} scores dropped`,
    );
  if (group.dropHighest > 0)
    parts.push(
      group.dropHighest === 1
        ? t('grades.highest')
        : p
          ? t('grades.highestMany', { count: group.dropHighest })
          : `Highest ${group.dropHighest} scores dropped`,
    );
  return parts.length ? parts.join(' · ') : null;
}
