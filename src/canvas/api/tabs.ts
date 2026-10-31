import { courseColors } from '@/design/tokens/colors';

import type { CanvasClient } from '../client';
import { useCanvasQuery } from '../query';
import type { CanvasCustomColors } from '../types';

/** `GET /api/v1/courses/:id/tabs` (lib/api/v1/tab.rb) */
export type CanvasTab = {
  /** `home`, `modules`, `pages`, …, or `context_external_tool_<id>` for tools. */
  id: string;
  html_url: string;
  full_url?: string;
  position: number;
  hidden?: boolean;
  /** Hidden because the tab has no content yet. */
  unused?: boolean;
  visibility?: 'public' | 'members' | 'admins' | 'none';
  label: string;
  type: 'internal' | 'external';
  /** Sessionless launch endpoint, for external tools. */
  url?: string;
};

export type CourseTab = {
  id: string;
  label: string;
  /** Hidden from students by the instructor, or turned off because it's unused. */
  hidden: boolean;
  external: boolean;
  /** Path on the Canvas web, e.g. `/courses/201/modules`. */
  htmlUrl: string;
  /** Absolute web URL. */
  fullUrl: string | null;
  /** Sessionless launch API URL, for external tools. */
  launchUrl: string | null;
};

export async function fetchCourseTabs(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<CourseTab[]> {
  const tabs = await client.getAll<CanvasTab>(`/api/v1/courses/${courseId}/tabs`, undefined, { signal });
  return tabs
    .sort((a, b) => a.position - b.position)
    .map((tab) => ({
      id: tab.id,
      label: tab.label,
      hidden: !!(tab.hidden || tab.unused || tab.visibility === 'admins' || tab.visibility === 'none'),
      external: tab.type === 'external',
      htmlUrl: tab.html_url,
      fullUrl: tab.full_url ?? null,
      launchUrl: tab.url ?? null,
    }));
}

/** The course's navigation tabs, in Canvas order (COURSE-2). */
export function useCourseTabs(courseId: string) {
  return useCanvasQuery(['courses', courseId, 'tabs'], (client, signal) =>
    fetchCourseTabs(client, courseId, signal),
  );
}

// All courses (COURSE-1). Lives here, with course navigation, because courses.ts
// belongs to the dashboard workstream.

/** `GET /api/v1/courses` with `include[]=term` (lib/api/v1/course_json.rb) */
export type CanvasCourseListItem = {
  id: string;
  name?: string;
  course_code?: string;
  workflow_state?: 'unpublished' | 'available' | 'completed' | 'deleted';
  start_at?: string | null;
  end_at?: string | null;
  /** Present with `include[]=concluded`. */
  concluded?: boolean;
  /** Present with `include[]=favorites`. */
  is_favorite?: boolean;
  /** The course is outside its dates; Canvas sends only the ID and name. */
  access_restricted_by_date?: boolean;
  restrict_enrollments_to_course_dates?: boolean;
  term?: { id: string; name: string; start_at?: string | null; end_at?: string | null } | null;
  enrollments?: { type: string; enrollment_state?: string }[];
};

export type CourseTiming = 'current' | 'future' | 'past';

export type CourseListItem = {
  id: string;
  code: string;
  name: string;
  /** The student's Canvas color, or Canvas's palette color when they haven't picked one. */
  color: string;
  term: { id: string; name: string; startAt: Date | null; endAt: Date | null } | null;
  timing: CourseTiming;
  isFavorite: boolean;
  /** Canvas lists it but won't open it yet (or anymore): the course is outside its dates. */
  restricted: boolean;
};

const toDate = (value?: string | null) => (value ? new Date(value) : null);

function timingOf(course: CanvasCourseListItem, now: Date): CourseTiming {
  const termStart = toDate(course.term?.start_at);
  const termEnd = toDate(course.term?.end_at);
  // Course dates win over the term's when the course restricts enrollments to them.
  const start = course.restrict_enrollments_to_course_dates
    ? (toDate(course.start_at) ?? termStart)
    : termStart;
  const end = course.restrict_enrollments_to_course_dates ? (toDate(course.end_at) ?? termEnd) : termEnd;
  const enrollmentState = course.enrollments?.[0]?.enrollment_state;
  if (course.concluded || course.workflow_state === 'completed' || enrollmentState === 'completed')
    return 'past';
  if (end && end < now) return 'past';
  if (start && start > now) return 'future';
  if (enrollmentState === 'invited' || enrollmentState === 'creation_pending') return 'future';
  return 'current';
}

export async function fetchAllCourses(client: CanvasClient, signal?: AbortSignal): Promise<CourseListItem[]> {
  const [courses, colors] = await Promise.all([
    client.getAll<CanvasCourseListItem>(
      '/api/v1/courses',
      {
        include: ['term', 'favorites', 'concluded'],
        state: ['available', 'completed'],
      },
      { signal },
    ),
    client
      .get<CanvasCustomColors>('/api/v1/users/self/colors', undefined, signal)
      .catch((): CanvasCustomColors => ({ custom_colors: {} })),
  ]);
  const now = new Date();
  return courses.map((course, index) => ({
    id: String(course.id),
    code: course.course_code ?? '',
    name: course.name ?? course.course_code ?? 'Untitled course',
    color:
      colors.custom_colors[`course_${course.id}`] ?? courseColors[index % (courseColors.length - 1)].light,
    term: course.term
      ? {
          id: String(course.term.id),
          name: course.term.name,
          startAt: toDate(course.term.start_at),
          endAt: toDate(course.term.end_at),
        }
      : null,
    timing: timingOf(course, now),
    isFavorite: course.is_favorite ?? false,
    restricted: course.access_restricted_by_date ?? false,
  }));
}

/** Every course the student is or was enrolled in: current, future, and past. */
export function useAllCourses(options?: { enabled?: boolean }) {
  return useCanvasQuery(['courses', 'all'], fetchAllCourses, options);
}

/** Grades navigation is authoritative; missing tabs are hidden for students. */
export function hasGradesTab(tabs: CourseTab[]): boolean {
  return tabs.some((tab) => tab.id === 'grades' && !tab.hidden);
}
