import { useLayoutEffect, useMemo, useState } from 'react';
import { openBrowserAsync } from 'expo-web-browser';
import type { Assignment } from '@/canvas/api/assignments';
import { useCanvas } from '@/canvas/session';
import { sessionUrl } from '@/features/content/browser';
import { formDate, formRules, formTypeLabel } from '@/features/submissions/formPresentation';
import { submitBlocker } from '@/features/submissions/rules';
import { useTranslation } from '@/i18n';
import { createDateContext, useDisplayTimeZone } from '@/lib/dates';
import { formatGrade } from './format';

export function useAssignmentPresentation() {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const dates = createDateContext(locale, zone);
  const number = (n: number) =>
    new Intl.NumberFormat(locale, {
      useGrouping: false,
      maximumFractionDigits: 20,
    }).format(n);
  const rounded = (n: number) => number(Number.isInteger(n) ? (n === 0 ? 0 : n) : Number(n.toFixed(2)));
  return {
    t,
    locale,
    dates,
    number,
    list: (values: string[]) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(values),
    date: (d: Date, now?: Date) => formDate(d, dates, now),
    shortDate: (d: Date, now?: Date) =>
      t('date.at', {
        day: dates.formatShortDate(d, now),
        time: dates.formatTime(d),
      }),
    type: (type: string) => formTypeLabel(type, t),
    rules: formRules(t, dates),
    points: (n: number | null | undefined) =>
      n == null
        ? null
        : t(n === 1 ? 'assignmentPresentation.pointOne' : 'assignmentPresentation.pointCount', {
            value: rounded(n),
          }),
    grade: (
      score: number | null,
      grade: string | null,
      a: Pick<Assignment, 'points' | 'gradingType' | 'restricted'>,
    ) => {
      // The legacy helper remains authoritative for restrictions and letter conversion.
      const legacy = formatGrade(score, grade, a);
      if (a.gradingType === 'pass_fail' && grade)
        return t(
          grade === 'complete' ? 'assignmentPresentation.complete' : 'assignmentPresentation.incomplete',
        );
      if (a.restricted) return legacy;
      if (['letter_grade', 'gpa_scale', 'percent'].includes(a.gradingType) && grade) return grade;
      if (score == null) return grade;
      return a.points != null ? `${rounded(score)}/${number(a.points === 0 ? 0 : a.points)}` : rounded(score);
    },
  };
}
export type AssignmentPresentation = ReturnType<typeof useAssignmentPresentation>;

/** Semantic action identity excludes presentation and progress objects. */
export function assignmentActionKey(a: Assignment) {
  return JSON.stringify([
    a.courseId,
    a.id,
    a.kind,
    a.quizId,
    a.discussionTopicId,
    a.htmlUrl,
    a.locked,
    a.canSubmit,
    a.lockAt?.getTime(),
    a.allowedAttempts,
    a.submission?.attempt,
    a.submission?.extraAttempts,
    a.submissionTypes,
    a.groupCategoryId,
  ]);
}
export function canEnterSubmission(a: Assignment) {
  return a.kind === 'assignment' && submitBlocker(a) === null;
}

class AssignmentOwner {
  constructor(
    readonly key: string,
    readonly client: object,
    readonly account: string,
  ) {}
  active = false;
  generation = 0;
  pending = false;
  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.pending = false;
    this.generation++;
  }
  claim() {
    if (!this.active || this.pending) return null;
    this.pending = true;
    return ++this.generation;
  }
  owns(generation: number) {
    return this.active && generation === this.generation;
  }
}
/** Only committed effects activate/revoke callbacks, including during discarded renders. */
export function useAssignmentOwner(key: string) {
  const { client, account } = useCanvas();
  const owner = useMemo(() => new AssignmentOwner(key, client, account.id), [key, client, account.id]);
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.dispose();
  }, [owner]);
  return owner;
}

/** Synchronous claim plus post-await ownership for retry/browser/tool entry. */
export function useAssignmentAction(key: string) {
  const { client } = useCanvas();
  const owner = useAssignmentOwner(key);
  const [state, setState] = useState<{
    owner: AssignmentOwner;
    pending: boolean;
    failed: boolean;
  } | null>(null);
  const run = async (work: (valid: () => boolean) => unknown, eligible = () => true) => {
    if (!owner.active || !eligible()) return;
    const generation = owner.claim();
    if (generation === null) return;
    const valid = () => owner.owns(generation) && eligible();
    setState({ owner, pending: true, failed: false });
    try {
      await work(valid);
      if (valid()) setState({ owner, pending: false, failed: false });
    } catch {
      if (valid()) setState({ owner, pending: false, failed: true });
    } finally {
      if (owner.owns(generation)) {
        owner.pending = false;
        if (!valid()) setState({ owner, pending: false, failed: false });
      }
    }
  };
  return {
    owner,
    run,
    pending: state?.owner === owner && state.pending,
    failed: state?.owner === owner && state.failed,
    browser: (url: string, eligible = () => true) =>
      run(async (valid) => {
        const signed = await sessionUrl(client, url);
        if (valid()) await openBrowserAsync(signed);
      }, eligible),
  };
}
