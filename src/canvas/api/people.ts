import { useInfiniteQuery } from '@tanstack/react-query';
import { CanvasAuthError } from '../client';
import { useCanvas, markAccountExpired } from '../session';
import { noteRequestError, reportReachable } from '@/features/offline/connectivity';
import type { CanvasClient } from '../client';
import { useCanvasQuery } from '../query';

/** `GET /api/v1/courses/:id/users` with `include[]=enrollments,avatar_url` (lib/api/v1/user.rb) */
type CanvasCourseUser = {
  id: string;
  name: string;
  sortable_name?: string;
  short_name?: string;
  avatar_url?: string | null;
  pronouns?: string | null;
  enrollments?: {
    type: string;
    role?: string;
    enrollment_state?: string;
    course_section_id?: string | null;
  }[];
  /** `include[]=bio`, `title`, and `pronunciation`, when the school turns on profiles. */
  bio?: string | null;
  title?: string | null;
  pronunciation?: string | null;
};

/** `GET /api/v1/courses/:id/sections` (lib/api/v1/section.rb) */
type CanvasSection = { id: string; name: string };

export type CourseRole = 'teacher' | 'ta' | 'designer' | 'student' | 'observer';

export type Person = {
  id: string;
  name: string;
  sortableName: string;
  avatarUrl: string | null;
  pronouns: string | null;
  /** The person's most senior role in the course. */
  role: CourseRole;
  /** A custom role name from the school, when it differs from the base role. */
  customRole: string | null;
};

const roleOf: Record<string, CourseRole> = {
  TeacherEnrollment: 'teacher',
  TaEnrollment: 'ta',
  DesignerEnrollment: 'designer',
  StudentEnrollment: 'student',
  StudentViewEnrollment: 'student',
  ObserverEnrollment: 'observer',
};

const enrollmentRole = (type: string): CourseRole => Object.hasOwn(roleOf, type) ? roleOf[type] : 'student';

/** Teachers first, observers last. */
export const roleOrder: CourseRole[] = ['teacher', 'ta', 'designer', 'student', 'observer'];

/** Canvas's default avatar is a silhouette; show initials instead. */
const isDefaultAvatar = (url?: string | null) => !url || /avatar-50\.png|images\/messages\/avatar/.test(url);

export function toPerson(u: CanvasCourseUser): Person {
  const enrollments = u.enrollments ?? [];
  const roles = enrollments.map((e) => ({
    role: enrollmentRole(e.type),
    label: e.role ?? null,
    type: e.type,
  }));
  roles.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));
  const top = roles[0];
  return {
    id: String(u.id),
    name: u.name,
    sortableName: u.sortable_name ?? u.name,
    avatarUrl: isDefaultAvatar(u.avatar_url) ? null : u.avatar_url!,
    pronouns: u.pronouns ?? null,
    role: top?.role ?? 'student',
    customRole: top?.label && top.label !== top.type ? top.label : null,
  };
}

/** Built-in role names for a profile, in Canvas's words. */
export const roleLabels: Record<CourseRole, string> = {
  teacher: 'Teacher',
  ta: 'Teaching assistant',
  designer: 'Course designer',
  student: 'Student',
  observer: 'Observer',
};

/** A profile card (CONTENT-10): who someone is in the course. */
export type PersonProfile = Person & {
  shortName: string;
  /** Roles in this course, most senior first, with the school's custom names. */
  roles: string[];
  /** Parallel to roles; null identifies school-authored text. Absent on old caches. */
  builtinRoles?: (CourseRole | null)[];
  /** The sections they're enrolled in. */
  sections: string[];
  bio: string | null;
  title: string | null;
  pronunciation: string | null;
};

function toProfile(u: CanvasCourseUser, sections: CanvasSection[]): PersonProfile {
  const person = toPerson(u);
  const names = new Map(sections.map((s) => [String(s.id), s.name]));
  const enrollments = u.enrollments ?? [];
  const roleEntries = [...enrollments]
    .sort((a, b) => roleOrder.indexOf(enrollmentRole(a.type)) - roleOrder.indexOf(enrollmentRole(b.type)))
    .map((e) => {
      const builtin = enrollmentRole(e.type);
      const custom = !!e.role && e.role !== e.type;
      return { label: custom ? e.role! : roleLabels[builtin], builtin: custom ? null : builtin };
    });
  // Keep legacy string deduplication/order. A colliding custom role must remain verbatim.
  const roles = [...new Set(roleEntries.map((e) => e.label))];
  const builtinRoles = roles.map((label) => {
    const entries = roleEntries.filter((e) => e.label === label);
    return entries.some((e) => e.builtin === null) ? null : entries[0].builtin;
  });
  const sectionNames = [
    ...new Set(
      enrollments
        .map((e) => (e.course_section_id ? names.get(String(e.course_section_id)) : undefined))
        .filter((n): n is string => !!n),
    ),
  ];
  return {
    ...person,
    shortName: u.short_name || u.name,
    roles: roles.length ? roles : [roleLabels[person.role]],
    builtinRoles: roles.length ? builtinRoles : [person.role],
    sections: sectionNames,
    bio: u.bio?.trim() || null,
    title: u.title?.trim() || null,
    pronunciation: u.pronunciation?.trim() || null,
  };
}

/** One person's card in a course, with their sections. Bios show where the school turns on profiles. */
export async function fetchPersonProfile(
  client: CanvasClient,
  courseId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<PersonProfile> {
  const [user, sections] = await Promise.all([
    client.get<CanvasCourseUser>(
      `/api/v1/courses/${courseId}/users/${userId}`,
      { include: ['enrollments', 'avatar_url', 'bio', 'title', 'pronunciation'] },
      signal,
    ),
    client
      .getAll<CanvasSection>(`/api/v1/courses/${courseId}/sections`, undefined, { signal, maxPages: 3 })
      .catch((): CanvasSection[] => []),
  ]);
  return toProfile(user, sections);
}

export function usePersonProfile(courseId: string, userId: string | null) {
  return useCanvasQuery(
    ['courses', courseId, 'people', userId ?? 'none'],
    (client, signal) => fetchPersonProfile(client, courseId, userId!, signal),
    { enabled: !!userId, staleTime: 5 * 60_000 },
  );
}

export async function fetchPeople(client: CanvasClient, courseId: string, signal?: AbortSignal) {
  const users = await client.getAll<CanvasCourseUser>(
    `/api/v1/courses/${courseId}/users`,
    { include: ['enrollments', 'avatar_url'], sort: 'sortable_name' },
    { signal },
  );
  return users.map(toPerson);
}

/** The course roster with roles (CONTENT-10). */
export function usePeople(courseId: string) {
  return useCanvasQuery(['courses', courseId, 'people'], (client, signal) =>
    fetchPeople(client, courseId, signal),
  );
}

/** A bounded roster page. Canvas supports page/per_page on the users endpoint. */
export async function fetchPeoplePage(client: CanvasClient, courseId: string, search: string, page: number | string, signal?: AbortSignal) {
  const result = await client.getPage<CanvasCourseUser>(typeof page === 'string' ? page : `/api/v1/courses/${courseId}/users`, typeof page === 'string' ? undefined : {
    include: ['enrollments', 'avatar_url'], sort: 'sortable_name', per_page: 50, page,
    ...(search.length >= 2 ? { search_term: search } : {}),
  }, signal);
  return { people: result.items.map(toPerson), next: result.next ?? undefined };
}

export function usePeoplePages(courseId: string, search: string) {
  const { account, client } = useCanvas();
  return useInfiniteQuery({
    queryKey: [account.id, 'courses', courseId, 'people', 'pages', search],
    initialPageParam: 1 as number | string,
    queryFn: async ({ pageParam, signal }) => {
      try {
        const page = await fetchPeoplePage(client, courseId, search, pageParam, signal);
        reportReachable();
        return page;
      } catch (error) {
        noteRequestError(error, account.baseUrl);
        if (error instanceof CanvasAuthError) void markAccountExpired(account.id, client).catch(() => {});
        throw error;
      }
    },
    getNextPageParam: (last) => last.next,
    enabled: search.length !== 1,
  });
}
