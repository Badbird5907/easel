import type { EnrolledCourse } from '@/canvas/api/enrollments';
import { courseColors, type CourseColor } from '@/design/tokens/colors';
import type { Translate } from '@/i18n';
import type { DateContext } from '@/lib/dates';

export const byName = (a: EnrolledCourse, b: EnrolledCourse) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** Lowercase without accents, so "psych" finds "Psychologie" and "e" finds "é". */
export const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export function matches(course: EnrolledCourse, query: string): boolean {
  const haystack = fold([course.name, course.code, course.term?.name ?? ''].join(' '));
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

type TermGroup = { key: string; title: string | null; courses: EnrolledCourse[] };

/** Past courses by term, the most recent term first. */
export function pastByTerm(courses: EnrolledCourse[]): TermGroup[] {
  const terms = new Map<string, TermGroup & { end: number }>();
  for (const c of courses) {
    const key = c.term?.id ?? 'none';
    const group = terms.get(key) ?? {
      key,
      title: c.term?.name ?? null,
      courses: [],
      end: c.term?.endAt?.getTime() ?? 0,
    };
    group.courses.push(c);
    terms.set(key, group);
  }
  return [...terms.values()]
    .sort((a, b) => b.end - a.end)
    .map(({ end: _end, ...group }) => ({ ...group, courses: group.courses.sort(byName) }));
}

export function subtitleFor(course: EnrolledCourse, now: Date, t: Translate, dates: DateContext): string {
  const parts = [course.code];
  if (course.timing === 'current') parts.push(course.term?.name ?? '');
  if (course.timing === 'future')
    parts.push(
      course.term?.startAt && course.term.startAt > now
        ? t('courses.starts', {
            date: new Intl.DateTimeFormat(dates.locale, {
              timeZone: dates.timeZone, calendar: 'gregory', month: 'short', day: 'numeric', year: 'numeric',
            }).format(course.term.startAt),
          })
        : (course.term?.name ?? ''),
    );
  return parts.filter(Boolean).join(' · ');
}


/** Stable developer-owned palette IDs; source/custom values are never interpreted as English. */
export const paletteLabel = (id: CourseColor['id'], t: Translate) => t(`customize.palette.${id}`);
export function colorName(color: string, t: Translate): string {
  const token = courseColors.find(c => c.light.toUpperCase() === color.toUpperCase());
  return token ? paletteLabel(token.id, t) : `${t('customize.customColor')} (${color})`;
}
