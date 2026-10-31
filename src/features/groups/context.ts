import { useDashboardCourses } from '@/canvas/api/courses';
import type { DiscussionContext } from '@/canvas/api/discussions';
import { useGroup } from '@/canvas/api/groups';
import { useAllCourses } from '@/canvas/api/tabs';
import { useCourseColor } from '@/features/course/CourseScope';

export type ContextLabel = {
  /** The course's name (or nickname) or the group's name; null until known. */
  name: string | null;
  /** The course code, shown beside dates; for groups, the group's course code. */
  code: string | null;
  /** The course color, which a group borrows from its course. */
  color: string | null;
  /** The course a group belongs to. */
  courseId: string | null;
};

/** What to call a course or group in a header, and its color. */
export function useContextLabel(context: DiscussionContext): ContextLabel {
  const group = useGroup(context.type === 'group' ? context.id : null);
  const courseId = context.type === 'course' ? context.id : (group.data?.courseId ?? null);
  const dashboard = useDashboardCourses();
  const card = courseId ? dashboard.data?.find((c) => c.id === courseId) : undefined;
  const all = useAllCourses({ enabled: dashboard.isSuccess && !card && !!courseId });
  const listed = courseId ? all.data?.find((c) => c.id === courseId) : undefined;
  const color = useCourseColor(courseId ?? '');
  const courseName = card?.name ?? listed?.name ?? null;
  const code = card?.code ?? listed?.code ?? null;
  return {
    name: context.type === 'course' ? courseName : (group.data?.name ?? null),
    code,
    color: courseId ? color : null,
    courseId,
  };
}
