import { useLayoutEffect, useMemo } from 'react';
import { useCanvas } from '@/canvas/session';
import { useTranslation } from '@/i18n';
import { createDateContext, useDisplayTimeZone } from '@/lib/dates';
import { formatGrade } from '@/features/course/format';

/** Explicit subscribed inputs keep compiler-memoized presentation current. */
export function useQuizPresentation() {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const dates = createDateContext(locale, zone);
  const number = (n: number) =>
    new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 20 }).format(n === 0 ? 0 : n);
  const rounded = (n: number) =>
    Number.isInteger(n)
      ? number(n)
      : new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 2 }).format(
          Number(n.toFixed(2)),
        );
  const minutes = (n: number): string => {
    const h = Math.floor(n / 60),
      m = n % 60;
    const hours = t('quizPresentation.hours', { count: h });
    const rest = t('quizPresentation.minutes', { count: m });
    return h ? (m ? t('quizPresentation.hoursMinutes', { hours, minutes: rest }) : hours) : rest;
  };
  return {
    t,
    number,
    minutes,
    duration: (seconds: number) =>
      Math.round(seconds / 60) < 1 ? t('quizPresentation.underMinute') : minutes(Math.round(seconds / 60)),
    points: (n: number | null | undefined) => {
      if (n == null) return null;
      const params = { count: n, value: rounded(n) };
      return t('quizPresentation.points', params);
    },
    score: (score: number | null, points: number | null, restricted: boolean | undefined) => {
      if (score === null || restricted === undefined) return null;
      if (restricted) return formatGrade(score, null, { points, gradingType: 'points', restricted: true });
      return points !== null ? `${rounded(score)}/${number(points)}` : rounded(score);
    },
    percent: (fraction: number) =>
      new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
        Math.round(fraction * 100) / 100,
      ),
    date: (date: Date, now = new Date(), short = false) => {
      const format = (d: Date, options: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(locale, { calendar: 'gregory', ...options, timeZone: zone }).format(d);
      const sameYear = format(date, { year: 'numeric' }) === format(now, { year: 'numeric' });
      return t('date.at', {
        day: short
          ? dates.formatShortDate(date, now)
          : format(date, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              ...(!sameYear && { year: 'numeric' }),
            }),
        time: dates.formatTime(date),
      });
    },
    type: (type: string) => {
      switch (type) {
        case 'assignment':
        case 'practice_quiz':
        case 'graded_survey':
        case 'survey':
          return t(`quizPresentation.${type}`);
        default:
          return type;
      }
    },
    scoring: (policy: string) => {
      switch (policy) {
        case 'keep_highest':
        case 'keep_latest':
        case 'keep_average':
          return t(`quizPresentation.${policy}`);
        default:
          return policy;
      }
    },
  };
}
/** Unknown/custom metadata must not establish that a quiz is not a survey. */
export const scoredQuiz = (quiz: { type: string }) =>
  quiz.type === 'assignment' || quiz.type === 'practice_quiz';

export type QuizPresentation = ReturnType<typeof useQuizPresentation>;

class QuizOwner<T> {
  constructor(
    readonly key: string,
    readonly account: string,
    readonly client: object,
  ) {}
  active = false;
  current: T | null = null;
  retry: object | null = null;
  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.current = null;
    this.retry = null;
  }
  publish(snapshot: T) {
    this.current = snapshot;
  }
  claim(value: object | null) {
    this.retry = value;
  }
}
/** No render-time publication. Locale and query result object identity are not resource identities. */
export function useQuizOwner<T>(key: string, snapshot: T) {
  const { account, client } = useCanvas();
  const owner = useMemo(() => new QuizOwner<T>(key, account.id, client), [key, account.id, client]);
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.dispose();
  }, [owner]);
  useLayoutEffect(() => {
    owner.publish(snapshot);
  });
  return owner;
}
/** Claim before scheduling; keep the batch claimed through every rejection/settlement. */
export function useQuizRetry(key: string, requests: (() => unknown)[]) {
  const owner = useQuizOwner(key, requests);
  return async () => {
    if (!owner.active || owner.retry) return;
    const claim = {};
    owner.claim(claim);
    try {
      await Promise.allSettled(
        owner.current!.map((request) =>
          Promise.resolve().then(() => {
            if (owner.active && owner.retry === claim) return request();
          }),
        ),
      );
    } finally {
      if (owner.active && owner.retry === claim) owner.claim(null);
    }
  };
}
