import type { ActivityGeneratedPreview } from '@/canvas/api/activity';

/** Both activity endpoints include assignment_json, whose policy is viewer-specific.
 * submission_json's embedded course does NOT request restrict_quantitative_data.
 * Keep the optional course flag for responses that do explicitly provide it.
 */
type ActivityGradeData = {
  score?: number | null;
  grade?: string | null;
  excused?: boolean;
  assignment?: {
    points_possible?: number | null;
    grading_type?: string;
    restrict_quantitative_data?: boolean;
  } | null;
  course?: { restrict_quantitative_data?: boolean } | null;
};

type GradePreview = Exclude<ActivityGeneratedPreview, { kind: 'comment' }>;

/** No text inspection: only an explicit policy can permit quantitative output.
 * Restricted points/percent/GPA grades are numeric too. Canvas converts those with
 * a grading scheme; Activity has no scheme, so it uses the existing neutral label.
 */
export function activityGradePreview(
  data: ActivityGradeData,
  preferCategorical = false,
): GradePreview | undefined {
  if (data.excused) return { kind: 'excused' };
  const assignmentPolicy = data.assignment?.restrict_quantitative_data;
  const coursePolicy = data.course?.restrict_quantitative_data;
  const restricted = assignmentPolicy === true || coursePolicy === true;
  const quantitative = !restricted && (assignmentPolicy === false || coursePolicy === false);
  const categorical =
    data.assignment?.grading_type === 'letter_grade' ||
    data.assignment?.grading_type === 'pass_fail';
  if (data.grade && categorical && (restricted || (quantitative && preferCategorical)))
    return { kind: 'grade', grade: data.grade };
  if (quantitative) {
    const points = data.assignment?.points_possible;
    if (data.score != null && points != null) return { kind: 'scored', score: data.score, points };
    if (data.grade) return { kind: 'grade', grade: data.grade };
  }
  // No grade evidence means the endpoint may have stripped an unposted grade.
  if ((data.score != null && data.assignment?.points_possible != null) || data.grade)
    return { kind: 'graded' };
  return undefined;
}

export function activityGradePreviewText(preview: GradePreview | undefined): string | null {
  if (preview?.kind === 'scored') return `Scored ${preview.score} out of ${preview.points}`;
  if (preview?.kind === 'grade') return `Graded: ${preview.grade}`;
  if (preview?.kind === 'excused') return 'Excused';
  return preview?.kind === 'graded' ? 'Graded' : null;
}
