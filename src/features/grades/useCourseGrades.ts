import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  currentPeriodId,
  type GradeAssignment,
  type GradeGroup,
  resetWhatIfRequest,
  savedWhatIfKey,
  useAssignmentGroups,
  useSavedWhatIf,
  useCustomGradeStatuses,
  useEnrollmentGrades,
  useGradesCourse,
  useGradingPeriods,
  whatIfScoreRequest,
} from '@/canvas/api/grades';
import { useCanvas } from '@/canvas/session';
import type { QueueLabelDescriptor } from '@/features/offline/presentation';
import { addNotice } from '@/features/offline/queue';
import { sendOrQueue } from '@/features/offline/requests';

import {
  applyWhatIf,
  type CalcGroup,
  calculateCourseGrade,
  type CourseGrade,
  scoreToLetter,
  totalPercent,
} from './calculate';
import { settleGradesRefresh, useGradeLifetime, useGradeState } from './lifetime';
import { setSaveWhatIf, useSaveWhatIf } from './whatIfSaving';

function toCalcGroups(groups: GradeGroup[]): CalcGroup[] {
  return groups.map((g) => ({
    id: g.id,
    weight: g.weight,
    rules: { dropLowest: g.dropLowest, dropHighest: g.dropHighest, neverDrop: g.neverDrop },
    assignments: g.assignments.map((a) => ({
      id: a.id,
      pointsPossible: a.pointsPossible,
      counts: a.counts,
      submission: a.submission
        ? {
            score: a.submission.score,
            excused: a.submission.excused,
            pendingReview: a.submission.pendingReview,
            hidden: a.submission.hidden,
            gradingPeriodId: a.submission.gradingPeriodId,
          }
        : null,
    })),
  }));
}

/** What the course total card shows. */
export type TotalState =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  /** The course turns off the total across all grading periods. */
  | { kind: 'no-overall' }
  | {
      kind: 'grade';
      /** Percentage, or null when nothing is graded yet. */
      percent: number | null;
      letter: string | null;
      /** With what-if scores on: the real total, for comparison. */
      actual: { percent: number | null; letter: string | null } | null;
    };

export type GradeMode = 'current' | 'final';

/**
 * Everything the course grades screen needs: course rules, periods, groups,
 * the total (from Canvas, or recalculated with what-if scores), and refresh.
 */
export function useCourseGrades(courseId: string) {
  const course = useGradesCourse(courseId);
  const periods = useGradingPeriods(courseId);
  const { account, client } = useCanvas();
  const owner = useGradeLifetime(JSON.stringify([account.id, courseId]), client);
  const [chosenPeriod, setChosenPeriod] = useGradeState<string | null | undefined>(
    owner,
    () => undefined,
  );
  const [basedOnGraded, setBasedOnGraded] = useGradeState(owner, () => true);
  const queryClient = useQueryClient();
  const saving = useSaveWhatIf();

  // Default to the current grading period, like the official apps. Without
  // periods (or if they fail to load) everything is one "all" view.
  const periodList = useMemo(() => periods.data ?? [], [periods.data]);
  const defaultPeriod = periods.isError
    ? null
    : course.data && periods.data
      ? currentPeriodId(periods.data, course.data.currentGradingPeriodId)
      : undefined;
  const selectedPeriod = chosenPeriod !== undefined ? chosenPeriod : defaultPeriod;

  const periodOwner = useGradeLifetime(JSON.stringify([selectedPeriod]), client, owner);
  const [whatIf, setWhatIf] = useGradeState<Record<string, number | null>>(periodOwner, () => ({}));

  const groups = useAssignmentGroups(courseId, selectedPeriod);
  const enrollment = useEnrollmentGrades(courseId, selectedPeriod);
  const needsStatuses =
    groups.data?.some((g) => g.assignments.some((a) => a.submission?.customStatusId)) ?? false;
  const statuses = useCustomGradeStatuses(courseId, needsStatuses);

  const policyReady = !!course.data && !course.isPending && !course.isFetching && !course.isError && !course.failureReason;
  const settings = course.data;
  const mode: GradeMode = basedOnGraded ? 'current' : 'final';
  const restricted = !policyReady || (settings?.restrictQuantitativeData ?? true);
  const noOverall =
    periodList.length > 0 && selectedPeriod === null && settings?.totalsForAllPeriods === false;
  const whatIfAllowed =
    policyReady && !!settings && !restricted && !settings.hideFinalGrades && !noOverall;

  const visibleGroups = useMemo(
    () => (groups.data ?? []).filter((g) => g.assignments.length > 0),
    [groups.data],
  );
  const actionKey = JSON.stringify([selectedPeriod, whatIfAllowed, visibleGroups]);
  const actionOwner = useGradeLifetime(actionKey, client, owner);
  const calcGroups = useMemo(() => toCalcGroups(visibleGroups), [visibleGroups]);

  const calcOptions = useMemo(
    () => ({
      weightGroups: settings?.weightGroups ?? false,
      weightedPeriods:
        selectedPeriod === null && settings?.weightedPeriods
          ? periodList.map((p) => ({ id: p.id, weight: p.weight ?? 0 }))
          : undefined,
    }),
    [settings?.weightGroups, settings?.weightedPeriods, selectedPeriod, periodList],
  );

  const base = useMemo(
    () => calculateCourseGrade(calcGroups, calcOptions),
    [calcGroups, calcOptions],
  );

  // Only what-if scores on assignments in view count, so switching periods can't leave stale ones active.
  // GRADE-5: with saving on, what-if scores saved in Canvas start out applied, as on the web.
  const saved = useSavedWhatIf(courseId, saving && whatIfAllowed);
  const activeWhatIf = useMemo(() => {
    if (!whatIfAllowed) return {};
    const ids = new Set(
      visibleGroups.flatMap((g) =>
        g.assignments
          .filter(
            (a) =>
              a.counts &&
              !a.restricted &&
              a.pointsPossible > 0 &&
              a.submission &&
              !a.submission.hidden &&
              !a.submission.excused,
          )
          .map((a) => a.id),
      ),
    );
    const merged = { ...(saving ? saved.data : undefined), ...whatIf };
    return Object.fromEntries(
      Object.entries(merged).filter(
        (entry): entry is [string, number] => ids.has(entry[0]) && entry[1] !== null,
      ),
    );
  }, [whatIf, visibleGroups, saving, saved.data, whatIfAllowed]);
  const whatIfCount = Object.keys(activeWhatIf).length;
  const whatIfActive = whatIfAllowed && whatIfCount > 0;

  const shown: CourseGrade = useMemo(
    () =>
      whatIfActive
        ? calculateCourseGrade(applyWhatIf(calcGroups, activeWhatIf), calcOptions)
        : base,
    [whatIfActive, calcGroups, activeWhatIf, calcOptions, base],
  );

  const letterFor = (percent: number | null, serverLetter?: string | null) => {
    if (serverLetter) return serverLetter;
    if (!settings?.usesLetterGrades) return null;
    return scoreToLetter(percent, settings.scheme);
  };

  // Canvas's own total wins; the local calculation is the fallback and the what-if engine.
  const server =
    enrollment.data ?? (selectedPeriod === null && !enrollment.isPending ? settings?.totals : null);
  const actual = (() => {
    if (server) {
      const percent = mode === 'current' ? server.currentScore : server.finalScore;
      const letter = mode === 'current' ? server.currentGrade : server.finalGrade;
      return { percent, letter: letterFor(percent, letter) };
    }
    const percent = totalPercent(base[mode], base.unit);
    return { percent, letter: letterFor(percent) };
  })();

  let total: TotalState;
  if (!policyReady) {
    total = { kind: 'loading' };
  } else if (settings?.hideFinalGrades) {
    total = { kind: 'hidden' };
  } else if (!settings || selectedPeriod === undefined || enrollment.isPending) {
    // A disabled query (period not chosen yet) also reports pending.
    total = { kind: 'loading' };
  } else if (noOverall) {
    total = { kind: 'no-overall' };
  } else if (whatIfActive) {
    const percent = totalPercent(shown[mode], shown.unit);
    total = { kind: 'grade', percent, letter: letterFor(percent), actual };
  } else {
    total = { kind: 'grade', ...actual, actual: null };
  }

  const canWhatIf = (a: GradeAssignment) =>
    whatIfAllowed &&
    visibleGroups.some((g) => g.assignments.includes(a)) &&
    a.counts &&
    !a.restricted &&
    a.pointsPossible > 0 &&
    !!a.submission &&
    !a.submission.hidden &&
    !a.submission.excused;

  /** Saves to Canvas now, or once back online. Failures leave the score on this screen. */
  const save = (
    request: { method: 'PUT'; path: string; body?: unknown },
    label: string,
    labelDescriptor: QueueLabelDescriptor = { kind: 'what-if-score', title: label },
  ) => {
    sendOrQueue(account.id, client, {
      ...request,
      key: request.path,
      label: `What-if score: ${label}`,
      labelDescriptor,
      invalidate: savedWhatIfKey(courseId),
    })
      .then(() =>
        queryClient.invalidateQueries({ queryKey: [account.id, ...savedWhatIfKey(courseId)] }),
      )
      .catch(() => {
        if (actionOwner.valid())
          addNotice(
            account.id,
            `Couldn’t save the what-if score for “${label}”. Try applying it again.`,
            labelDescriptor.kind === 'what-if-reset'
              ? { kind: 'what-if-reset-failed' }
              : { kind: 'what-if-failed', title: label },
          );
      });
  };

  const refresh = () =>
    actionOwner.valid()
      ? settleGradesRefresh(
          [course.refetch, periods.refetch, groups.refetch, enrollment.refetch],
          () => actionOwner.valid(),
        )
      : Promise.resolve([]);

  return {
    owner,
    actionOwner,
    policyReady,
    course,
    settings,
    periods: periodList,
    selectedPeriod,
    selectPeriod: (id: string | null) => {
      if (actionOwner.valid()) setChosenPeriod(id);
    },
    groups,
    visibleGroups,
    customStatuses: statuses.data ?? {},
    mode,
    basedOnGraded,
    setBasedOnGraded: (on: boolean) => {
      if (actionOwner.valid()) setBasedOnGraded(on);
    },
    total,
    /** Group subtotals and drops, including what-if scores when they're on. */
    grade: shown,
    restricted,
    whatIf: activeWhatIf,
    whatIfAllowed,
    whatIfCount: whatIfActive ? whatIfCount : 0,
    canWhatIf,
    setWhatIf: (assignment: GradeAssignment, score: number | null) => {
      if (
        !actionOwner.valid() ||
        !canWhatIf(assignment) ||
        (score !== null && (!Number.isFinite(score) || score < 0))
      )
        return;
      if (!actionOwner.claim(`score:${assignment.id}`)) return;
      queueMicrotask(() => actionOwner.pending.delete(`score:${assignment.id}`));
      setWhatIf((current) => ({ ...current, [assignment.id]: score }));
      if (saving && assignment.submission?.id)
        save(whatIfScoreRequest(assignment.submission.id, score), assignment.name);
    },
    resetWhatIf: () => {
      if (!whatIfAllowed || !actionOwner.claim('reset')) return;
      queueMicrotask(() => actionOwner.pending.delete('reset'));
      setWhatIf(
        saving ? Object.fromEntries(Object.keys(saved.data ?? {}).map((id) => [id, null])) : {},
      );
      if (saving)
        save(resetWhatIfRequest(courseId), 'Reset what-if scores', { kind: 'what-if-reset' });
    },
    /** Whether what-if scores are saved to Canvas (GRADE-5). */
    saving: saving && whatIfAllowed,
    setSaving: (on: boolean) => {
      if (!whatIfAllowed || !actionOwner.claim('saving')) return;
      queueMicrotask(() => actionOwner.pending.delete('saving'));
      setSaveWhatIf(on);
      if (on) {
        // Keep what's already on screen.
        for (const group of visibleGroups)
          for (const a of group.assignments) {
            const score = activeWhatIf[a.id];
            if (score !== undefined && a.submission?.id)
              save(whatIfScoreRequest(a.submission.id, score), a.name);
          }
      } else {
        // Off means Canvas keeps none; the scores stay on this screen until it closes.
        setWhatIf(activeWhatIf);
        save(resetWhatIfRequest(courseId), 'Reset what-if scores', { kind: 'what-if-reset' });
      }
    },
    refresh,
  };
}
