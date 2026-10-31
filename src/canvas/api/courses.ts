import { useQueryClient } from '@tanstack/react-query';

import { courseColors } from '@/design/tokens/colors';

import type { CanvasClient } from '../client';
import type { Course } from '../models';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';
import { useCanvas } from '../session';
import type { CanvasCourse, CanvasCustomColors, CanvasDashboardCard } from '../types';

/** Canvas assigns a palette color when the student never picked one. */
function fallbackColor(index: number) {
  return courseColors[index % (courseColors.length - 1)].light;
}

export async function fetchDashboardCourses(client: CanvasClient, signal?: AbortSignal): Promise<Course[]> {
  const [cards, colors] = await Promise.all([
    client.get<CanvasDashboardCard[]>('/api/v1/dashboard/dashboard_cards', undefined, signal),
    client
      .get<CanvasCustomColors>('/api/v1/users/self/colors', undefined, signal)
      .catch((): CanvasCustomColors => ({ custom_colors: {} })),
  ]);
  return cards.map((card, index) => ({
    id: String(card.id),
    code: card.courseCode,
    name: card.shortName || card.originalName,
    originalName: card.originalName,
    color: colors.custom_colors[card.assetString] ?? card.color ?? fallbackColor(index),
    imageUrl: card.image ?? null,
    isFavorite: card.isFavorited ?? false,
    term: card.term ?? null,
  }));
}

/** The courses on the student's Canvas dashboard: favorites, or all current courses. */
export function useDashboardCourses() {
  return useCanvasQuery(['courses', 'dashboard'], fetchDashboardCourses);
}

/** Lookup by course ID, for rows that only carry a course ID. */
export function useCourseLookup(): (courseId: string | null | undefined) => Course | undefined {
  const { data } = useDashboardCourses();
  return (courseId) => (courseId ? data?.find((c) => c.id === courseId) : undefined);
}

export type CourseDetail = {
  id: string;
  code: string;
  name: string;
  defaultView: string | null;
  /** Current score as a percentage (0 to 100), or null when hidden, restricted, or ungraded. */
  score: number | null;
  grade: string | null;
  hideFinalGrades: boolean;
  /** Restricted quantitative data: show letters, never points or percentages. */
  restricted: boolean;
  teachers: string[];
  term: string | null;
};

export async function fetchCourse(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<CourseDetail> {
  const course = await client.get<CanvasCourse>(
    `/api/v1/courses/${courseId}`,
    { include: ['total_scores', 'teachers', 'term'] },
    signal,
  );
  const enrollment = course.enrollments?.find((e) => e.type === 'student') ?? course.enrollments?.[0];
  const hidden = course.hide_final_grades ?? false;
  const restricted = course.restrict_quantitative_data ?? false;
  return {
    id: String(course.id),
    code: course.course_code,
    name: course.name,
    defaultView: course.default_view ?? null,
    score: hidden || restricted ? null : (enrollment?.computed_current_score ?? null),
    grade: hidden ? null : (enrollment?.computed_current_grade ?? null),
    hideFinalGrades: hidden,
    restricted,
    teachers: course.teachers?.map((t) => t.display_name) ?? [],
    term: course.term?.name ?? null,
  };
}

export function useCourse(courseId: string) {
  return useCanvasQuery(['courses', courseId], (client, signal) => fetchCourse(client, courseId, signal));
}

// --- Customizing Home (HOME-4) ---------------------------------------------------------

/** `GET /api/v1/users/self/course_nicknames` (course_nicknames_controller.rb). */
type CanvasCourseNickname = { course_id: string; name: string; nickname: string };

/** A current course, with everything the student can change about how Home shows it. */
export type CustomizableCourse = {
  id: string;
  code: string;
  /** The nickname if set, otherwise the course name. */
  name: string;
  originalName: string;
  nickname: string | null;
  color: string;
  /** Starred by the student. With no stars at all, Canvas shows every current course on Home. */
  isFavorite: boolean;
  onHome: boolean;
};

/** Canvas caps nicknames below 60 characters (course_nicknames_controller#update). */
export const NICKNAME_MAX = 59;

export async function fetchCustomizableCourses(
  client: CanvasClient,
  signal?: AbortSignal,
): Promise<CustomizableCourse[]> {
  const [current, cards, colors, nicknames] = await Promise.all([
    client.getAll<CanvasCourse & { access_restricted_by_date?: boolean }>(
      '/api/v1/courses',
      { enrollment_state: 'active', state: ['available'], include: ['term'] },
      { signal },
    ),
    client.get<CanvasDashboardCard[]>('/api/v1/dashboard/dashboard_cards', undefined, signal),
    client
      .get<CanvasCustomColors>('/api/v1/users/self/colors', undefined, signal)
      .catch((): CanvasCustomColors => ({ custom_colors: {} })),
    client
      .get<CanvasCourseNickname[]>('/api/v1/users/self/course_nicknames', undefined, signal)
      .catch((): CanvasCourseNickname[] => []),
  ]);
  const nicknameFor = new Map(nicknames.map((n) => [String(n.course_id), n.nickname]));
  const cardIndex = new Map(cards.map((card, index) => [String(card.id), index]));
  const cardFor = new Map(cards.map((card) => [String(card.id), card]));
  const byId = new Map<string, CustomizableCourse>();
  const add = (id: string, code: string, originalName: string, fallbackIndex: number) => {
    const card = cardFor.get(id);
    const nickname =
      nicknameFor.get(id) ?? (card && card.shortName !== card.originalName ? card.shortName : null);
    byId.set(id, {
      id,
      code,
      name: nickname || originalName,
      originalName,
      nickname: nickname || null,
      color: colors.custom_colors[`course_${id}`] ?? card?.color ?? fallbackColor(fallbackIndex),
      isFavorite: card?.isFavorited ?? false,
      onHome: !!card,
    });
  };
  cards.forEach((card, index) => add(String(card.id), card.courseCode, card.originalName, index));
  current.forEach((course, index) => {
    const id = String(course.id);
    if (byId.has(id) || course.access_restricted_by_date || !course.name) return;
    add(id, course.course_code, course.original_name ?? course.name, cards.length + index);
  });
  return [...byId.values()].sort((a, b) => {
    const ai = cardIndex.get(a.id);
    const bi = cardIndex.get(b.id);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return a.name.localeCompare(b.name);
  });
}

const CUSTOMIZE_KEY = ['courses', 'customize'] as const;

export function useCustomizableCourses() {
  return useCanvasQuery([...CUSTOMIZE_KEY], fetchCustomizableCourses);
}

/** `POST` or `DELETE /api/v1/users/self/favorites/courses/:id` (favorites_controller.rb). */
export async function setFavorite(client: CanvasClient, courseId: string, favorite: boolean) {
  if (favorite) await client.post(`/api/v1/users/self/favorites/courses/${courseId}`);
  else await client.delete(`/api/v1/users/self/favorites/courses/${courseId}`);
}

/** `PUT` or `DELETE /api/v1/users/self/course_nicknames/:course_id`. An empty nickname clears it. */
export async function setNickname(client: CanvasClient, courseId: string, nickname: string) {
  const trimmed = nickname.trim();
  if (trimmed) await client.put(`/api/v1/users/self/course_nicknames/${courseId}`, { nickname: trimmed });
  else await client.delete(`/api/v1/users/self/course_nicknames/${courseId}`);
}

/** `PUT /api/v1/users/self/colors/course_:id` (users_controller#set_custom_color). */
export async function setCourseColor(client: CanvasClient, courseId: string, color: string) {
  await client.put(`/api/v1/users/self/colors/course_${courseId}`, { hexcode: color.replace(/^#/, '') });
}

/** `PUT /api/v1/users/:id/dashboard_positions`: Home's card order, top first. */
export async function setDashboardOrder(client: CanvasClient, userId: string, courseIds: string[]) {
  await client.put(`/api/v1/users/${userId}/dashboard_positions`, {
    dashboard_positions: Object.fromEntries(courseIds.map((id, index) => [`course_${id}`, index])),
  });
}

export type CourseCustomization =
  | { kind: 'favorite'; courseId: string; favorite: boolean }
  | { kind: 'nickname'; courseId: string; nickname: string }
  | { kind: 'color'; courseId: string; color: string }
  | { kind: 'order'; courseIds: string[] };

function applyLocally(courses: CustomizableCourse[], change: CourseCustomization): CustomizableCourse[] {
  switch (change.kind) {
    case 'nickname':
      return courses.map((c) =>
        c.id === change.courseId
          ? { ...c, nickname: change.nickname.trim() || null, name: change.nickname.trim() || c.originalName }
          : c,
      );
    case 'color':
      return courses.map((c) => (c.id === change.courseId ? { ...c, color: change.color } : c));
    case 'favorite':
      return courses.map((c) => (c.id === change.courseId ? { ...c, isFavorite: change.favorite } : c));
    case 'order': {
      const rank = new Map(change.courseIds.map((id, i) => [id, i]));
      return [...courses].sort((a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6));
    }
  }
}

/**
 * One mutation for every Home customization. The Customize list updates at
 * once and rolls back if Canvas refuses; Home's cards refresh afterwards.
 */
export function useCustomizeCourse() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  const { account } = useCanvas();
  const listKey = [accountKey, ...CUSTOMIZE_KEY];
  return useCanvasMutation(
    async (client, change: CourseCustomization) => {
      switch (change.kind) {
        case 'favorite':
          return setFavorite(client, change.courseId, change.favorite);
        case 'nickname':
          return setNickname(client, change.courseId, change.nickname);
        case 'color':
          return setCourseColor(client, change.courseId, change.color);
        case 'order':
          return setDashboardOrder(client, account.user.id, change.courseIds);
      }
    },
    {
      onMutate: async (change) => {
        await queryClient.cancelQueries({ queryKey: listKey });
        const previous = queryClient.getQueryData<CustomizableCourse[]>(listKey);
        if (previous) queryClient.setQueryData(listKey, applyLocally(previous, change));
        return { previous };
      },
      onError: (_error, _change, context) => {
        const previous = (context as { previous?: CustomizableCourse[] } | undefined)?.previous;
        if (previous) queryClient.setQueryData(listKey, previous);
      },
      onSettled: (_data, _error, change) => {
        // Favorites change which courses Home lists, so the list reloads; the rest only refresh Home.
        if (change.kind === 'favorite') queryClient.invalidateQueries({ queryKey: listKey });
        queryClient.invalidateQueries({ queryKey: [accountKey, 'courses', 'dashboard'] });
      },
    },
  );
}
