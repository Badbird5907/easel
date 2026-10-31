import type { Assignment, AssignmentKind } from '@/canvas/api/assignments';
import type { CompletionRequirement, ModuleItemType } from '@/canvas/api/modules';
import { defaultGradingScheme, scoreToLetter } from '@/features/grades/calculate';
import { displayLetter } from '@/features/grades/format';
import { formatDate, formatShortDate, formatTime } from '@/lib/dates';

/** "Tue, Nov 4", with the year when it isn't this year, in the Canvas time zone. */
export function formatDay(date: Date, now = new Date()): string {
  const sameYear = formatDate(date, { year: 'numeric' }) === formatDate(now, { year: 'numeric' });
  return formatDate(date, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(!sameYear && { year: 'numeric' }),
  });
}

/** "Nov 4", with the year when it isn't this year. */
export function formatShortDay(date: Date, now = new Date()): string {
  return formatShortDate(date, now);
}

/** "Tue, Nov 4 at 11:59 PM". */
export function formatDateTime(date: Date, now = new Date()): string {
  return `${formatDay(date, now)} at ${formatTime(date)}`;
}

/** "Nov 4 at 11:59 PM", for dense rows. */
export function formatShortDateTime(date: Date, now = new Date()): string {
  return `${formatShortDay(date, now)} at ${formatTime(date)}`;
}

/** "50 pts", "1 pt", "2.5 pts". */
export function formatPoints(points: number | null | undefined): string | null {
  if (points == null) return null;
  const value = Number.isInteger(points) ? String(points) : points.toFixed(2).replace(/\.?0+$/, '');
  return `${value} ${points === 1 ? 'pt' : 'pts'}`;
}

/** "46/50", or the letter grade Canvas sends for non-point grading types. */
export function formatScore(
  score: number | null,
  grade: string | null,
  points: number | null,
  gradingType?: Assignment['gradingType'],
): string | null {
  if (gradingType === 'pass_fail' && grade) return grade === 'complete' ? 'Complete' : 'Incomplete';
  if (gradingType && ['letter_grade', 'gpa_scale', 'percent'].includes(gradingType) && grade) return grade;
  if (score == null) return grade;
  const value = Number.isInteger(score) ? String(score) : score.toFixed(2).replace(/\.?0+$/, '');
  return points != null ? `${value}/${points}` : value;
}

/**
 * A grade for display, honoring restricted quantitative data (GRADE-4): under
 * it, only a letter (or Complete / Incomplete) ever shows. Canvas still sends
 * scores then, so points-based grades convert with the default scheme.
 */
export function formatGrade(
  score: number | null,
  grade: string | null,
  a: Pick<Assignment, 'points' | 'gradingType' | 'restricted'>,
): string | null {
  if (!a.restricted) return formatScore(score, grade, a.points, a.gradingType);
  if (a.gradingType === 'pass_fail' && grade) return grade === 'complete' ? 'Complete' : 'Incomplete';
  if (grade && /^[A-Za-z]/.test(grade)) return displayLetter(grade);
  if (score != null && a.points) {
    const letter = scoreToLetter((score / a.points) * 100, defaultGradingScheme);
    return letter ? displayLetter(letter) : null;
  }
  return null;
}

/** "1.2 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** "30 minutes", "1 hour 30 minutes". */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [
    hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : null,
    rest ? `${rest} ${rest === 1 ? 'minute' : 'minutes'}` : null,
  ];
  return parts.filter(Boolean).join(' ') || '0 minutes';
}

const submissionTypeLabels: Record<string, string> = {
  online_upload: 'File upload',
  online_text_entry: 'Text entry',
  online_url: 'Website URL',
  media_recording: 'Media recording',
  student_annotation: 'Annotation',
  online_quiz: 'Quiz',
  discussion_topic: 'Discussion post',
  external_tool: 'External tool',
  basic_lti_launch: 'External tool',
  on_paper: 'On paper',
  none: 'No submission',
  not_graded: 'Not graded',
  wiki_page: 'Page',
};

export function submissionTypeLabel(type: string): string {
  return submissionTypeLabels[type] ?? type.replace(/_/g, ' ');
}

export const kindLabels: Record<AssignmentKind, string> = {
  assignment: 'Assignments',
  quiz: 'Quizzes',
  discussion: 'Discussions',
  external_tool: 'External tools',
  offline: 'Nothing to turn in online',
};

export const moduleItemTypeLabels: Record<ModuleItemType, string> = {
  Assignment: 'Assignment',
  Quiz: 'Quiz',
  Discussion: 'Discussion',
  Page: 'Page',
  File: 'File',
  ExternalUrl: 'Link',
  ExternalTool: 'External tool',
  SubHeader: 'Heading',
};

/** What the student has to do to complete a module item, as a short phrase. */
export function requirementLabel(req: CompletionRequirement): string {
  const done = req.completed === true;
  switch (req.type) {
    case 'must_view':
      return done ? 'Viewed' : 'View';
    case 'must_mark_done':
      return done ? 'Marked done' : 'Mark done';
    case 'must_submit':
      return done ? 'Submitted' : 'Submit';
    case 'must_contribute':
      return done ? 'Contributed' : 'Contribute';
    case 'min_score':
      return `${done ? 'Scored' : 'Score'} at least ${req.minScore ?? 0}`;
    case 'min_percentage':
      return `${done ? 'Scored' : 'Score'} at least ${req.minPercentage ?? 0}%`;
  }
}

/** The same requirement as an instruction: "Submit to complete this item." */
export function requirementInstruction(req: CompletionRequirement): string {
  switch (req.type) {
    case 'must_view':
      return 'Open this item to complete it.';
    case 'must_mark_done':
      return 'Mark this item done when you finish it.';
    case 'must_submit':
      return 'Submit this item to complete it.';
    case 'must_contribute':
      return 'Post in this item to complete it.';
    case 'min_score':
      return `Score at least ${req.minScore ?? 0} to complete this item.`;
    case 'min_percentage':
      return `Score at least ${req.minPercentage ?? 0}% to complete this item.`;
  }
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}
