import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { courseColors } from '@/design/tokens/colors';

import type { CanvasClient } from '../client';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';
import type { CanvasCustomColors } from '../types';

/*
 * The student's enrollments: pending course invitations (HOME-6) and every
 * course they're in, were in, or will be in (COURSE-1).
 */

// MARK: Raw API shapes

/** `GET /api/v1/users/self/enrollments` (enrollment_json in lib/api/v1/user.rb), trimmed. */
export type CanvasEnrollment = {
  id: string;
  course_id: string;
  course_section_id?: string | null;
  /** `StudentEnrollment`, `TeacherEnrollment`, `TaEnrollment`, `ObserverEnrollment`, `DesignerEnrollment`. */
  type: string;
  /** The role's name: the type for built-in roles, or a custom role's name. */
  role?: string;
  enrollment_state:
    'active' | 'invited' | 'creation_pending' | 'completed' | 'inactive' | 'rejected' | 'deleted';
};

/** `GET /api/v1/courses` (lib/api/v1/course_json.rb), trimmed to what these screens read. */
export type CanvasEnrolledCourse = {
  id: string;
  name?: string;
  course_code?: string;
  workflow_state?: 'unpublished' | 'available' | 'completed' | 'deleted';
  /** Present with `include[]=concluded`. */
  concluded?: boolean;
  /** Present with `include[]=favorites`. */
  is_favorite?: boolean;
  /** Outside its dates at a school that closes courses then. Canvas sends only the ID. */
  access_restricted_by_date?: boolean;
  term?: { id: string; name: string; start_at?: string | null; end_at?: string | null } | null;
  /** `include[]=sections`: the sections the student is enrolled in. */
  sections?: { id: string; name: string; enrollment_role?: string }[];
  enrollments?: { type: string; role?: string; enrollment_state?: string }[];
};

// MARK: Models

export type Term = { id: string; name: string; startAt: Date | null; endAt: Date | null };

export type BuiltInEnrollmentRole =
  | 'StudentEnrollment'
  | 'TeacherEnrollment'
  | 'TaEnrollment'
  | 'ObserverEnrollment'
  | 'DesignerEnrollment';

export type Invitation = {
  enrollmentId: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  sectionName: string | null;
  /** "Student", "TA", or a custom role's name. */
  role: string;
  /** Only set when Canvas explicitly returns a reserved built-in role name matching its type. */
  builtInRole?: BuiltInEnrollmentRole;
  term: Term | null;
  /** Set right away when the student answers, before Canvas confirms. */
  outcome: 'accepted' | 'declined' | null;
};

export type CourseTiming = 'current' | 'future' | 'past';

export type EnrolledCourse = {
  id: string;
  code: string;
  name: string;
  /** The student's Canvas color, or Canvas's palette color when they haven't picked one. */
  color: string;
  term: Term | null;
  timing: CourseTiming;
  isFavorite: boolean;
};

export type EnrolledCourses = {
  courses: EnrolledCourse[];
  /**
   * Courses Canvas lists but won't open, because the school closes courses to
   * students outside their dates. Canvas doesn't send their names.
   */
  restrictedCount: number;
};

// MARK: Mapping

const toDate = (value?: string | null) => (value ? new Date(value) : null);

function toTerm(term: CanvasEnrolledCourse['term']): Term | null {
  return term
    ? { id: String(term.id), name: term.name, startAt: toDate(term.start_at), endAt: toDate(term.end_at) }
    : null;
}

const roleNames: Record<BuiltInEnrollmentRole, string> = {
  StudentEnrollment: 'Student',
  TeacherEnrollment: 'Teacher',
  TaEnrollment: 'TA',
  ObserverEnrollment: 'Observer',
  DesignerEnrollment: 'Course designer',
};

function isBuiltInRole(value: string | undefined): value is BuiltInEnrollmentRole {
  return !!value && Object.hasOwn(roleNames, value);
}

function roleLabel(e: CanvasEnrollment): string {
  // Custom roles carry their own name; built-in ones repeat the type.
  if (e.role && !isBuiltInRole(e.role)) return e.role;
  return isBuiltInRole(e.type) ? roleNames[e.type] : isBuiltInRole(e.role) ? roleNames[e.role] : 'Member';
}

// MARK: Invitations (HOME-6)

/**
 * Pending invitations, the way the official apps find them: the student's
 * invited enrollments, joined with the invited-or-pending course list for names
 * and sections. Most students have none, so the course list is only fetched
 * when there's something to show.
 */
export async function fetchCourseInvitations(
  client: CanvasClient,
  signal?: AbortSignal,
): Promise<Invitation[]> {
  const enrollments = await client.getAll<CanvasEnrollment>(
    '/api/v1/users/self/enrollments',
    { state: ['invited', 'current_and_future'] },
    { signal, maxPages: 5 },
  );
  const invited = enrollments.filter((e) => e.enrollment_state === 'invited');
  if (invited.length === 0) return [];

  const courses = await client.getAll<CanvasEnrolledCourse>(
    '/api/v1/courses',
    { enrollment_state: 'invited_or_pending', include: ['sections', 'term'] },
    { signal, maxPages: 5 },
  );
  const byId = new Map(courses.map((c) => [String(c.id), c]));
  return invited.flatMap((e): Invitation[] => {
    // Canvas leaves out courses the student can't see yet, such as unpublished ones.
    const course = byId.get(String(e.course_id));
    if (!course?.name) return [];
    const section = course.sections?.find((s) => String(s.id) === String(e.course_section_id));
    return [
      {
        enrollmentId: String(e.id),
        courseId: String(course.id),
        courseName: course.name,
        courseCode: course.course_code ?? '',
        sectionName: section?.name ?? null,
        role: roleLabel(e),
        // user.rb serializes role.name; Role validates custom names against the reserved types.
        // A missing role can be a trimmed/legacy payload, so type alone must not identify a custom role.
        builtInRole: isBuiltInRole(e.role) && e.role === e.type ? e.role : undefined,
        term: toTerm(course.term),
        outcome: null,
      },
    ];
  });
}

const invitationsKey = ['enrollments', 'invitations'];

/** Course invitations waiting for the student's answer. */
export function useCourseInvitations() {
  return useCanvasQuery(invitationsKey, fetchCourseInvitations, { staleTime: 60_000 });
}

type InvitationRef = Pick<Invitation, 'courseId' | 'enrollmentId'>;

function useAnswerInvitation(outcome: 'accepted' | 'declined') {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  const key = [accountKey, ...invitationsKey];
  return useCanvasMutation(
    (client, { courseId, enrollmentId }: InvitationRef) =>
      client.post<{ success?: boolean }>(
        `/api/v1/courses/${courseId}/enrollments/${enrollmentId}/${outcome === 'accepted' ? 'accept' : 'reject'}`,
      ),
    {
      // The card answers right away; it goes back to Accept and Decline if Canvas refuses.
      onMutate: async ({ enrollmentId }) => {
        await queryClient.cancelQueries({ queryKey: key });
        queryClient.setQueryData<Invitation[]>(key, (list) =>
          list?.map((i) => (i.enrollmentId === enrollmentId ? { ...i, outcome } : i)),
        );
      },
      // Only this card goes back; others may have been answered in the meantime.
      onError: (_error, { enrollmentId }) => {
        queryClient.setQueryData<Invitation[]>(key, (list) =>
          list?.map((i) => (i.enrollmentId === enrollmentId ? { ...i, outcome: null } : i)),
        );
      },
      onSuccess: async () => {
        // A new course: the dashboard, All courses, and course screens all change.
        if (outcome === 'accepted')
          await queryClient.invalidateQueries({ queryKey: [accountKey, 'courses'] });
      },
    },
  );
}

export function useAcceptInvitation() {
  return useAnswerInvitation('accepted');
}

export function useDeclineInvitation() {
  return useAnswerInvitation('declined');
}

/** Removes an answered invitation's card. Stable across renders, for timers. */
export function useDismissInvitation() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCallback(
    (enrollmentId: string) =>
      queryClient.setQueryData<Invitation[]>([accountKey, ...invitationsKey], (list) =>
        list?.filter((i) => i.enrollmentId !== enrollmentId),
      ),
    [queryClient, accountKey],
  );
}

// MARK: All courses (COURSE-1)

/** Canvas assigns a palette color when the student never picked one. */
const fallbackColor = (index: number) => courseColors[index % (courseColors.length - 1)].light;

/**
 * Every course the student is in, was in, or has accepted for a later term,
 * as the official apps load them: one request per enrollment state, because
 * only Canvas knows each enrollment's state by date (term, course, and section
 * dates all count). Pending invitations are left out; they're answered first.
 */
export async function fetchEnrolledCourses(
  client: CanvasClient,
  signal?: AbortSignal,
): Promise<EnrolledCourses> {
  const list = (enrollmentState: 'active' | 'invited_or_pending' | 'completed') =>
    client.getAll<CanvasEnrolledCourse>(
      '/api/v1/courses',
      {
        enrollment_state: enrollmentState,
        state: ['current_and_concluded'],
        include: ['term', 'favorites', 'concluded'],
      },
      { signal },
    );
  const [current, future, past, colors] = await Promise.all([
    list('active'),
    list('invited_or_pending'),
    list('completed'),
    client
      .get<CanvasCustomColors>('/api/v1/users/self/colors', undefined, signal)
      .catch((): CanvasCustomColors => ({ custom_colors: {} })),
  ]);

  const seen = new Set<string>();
  const restricted = new Set<string>();
  const courses: EnrolledCourse[] = [];
  const add = (raw: CanvasEnrolledCourse, timing: CourseTiming) => {
    const id = String(raw.id);
    if (seen.has(id)) return;
    if (raw.access_restricted_by_date || !raw.name) {
      restricted.add(id);
      return;
    }
    // Only invited, not yet accepted: that's an invitation, not a course to open.
    if (
      timing === 'future' &&
      raw.enrollments?.length &&
      raw.enrollments.every((e) => e.enrollment_state === 'invited')
    )
      return;
    seen.add(id);
    restricted.delete(id);
    courses.push({
      id,
      code: raw.course_code ?? '',
      name: raw.name,
      color: colors.custom_colors[`course_${id}`] ?? fallbackColor(courses.length),
      term: toTerm(raw.term),
      timing,
      isFavorite: raw.is_favorite ?? false,
    });
  };
  // A course with enrollments in more than one state counts once, current first.
  current.forEach((c) => add(c, 'current'));
  future.forEach((c) => add(c, 'future'));
  past.forEach((c) => add(c, 'past'));
  return { courses, restrictedCount: [...restricted].filter((id) => !seen.has(id)).length };
}

/** Current, upcoming, and past courses for All courses. */
export function useEnrolledCourses() {
  return useCanvasQuery(['courses', 'enrolled'], fetchEnrolledCourses);
}

// MARK: Join a course (COURSE-8)

/**
 * A join code and, when the input carried it, the course. Students paste a
 * code (`ABC123`), a join link (`…/enroll/ABC123`), or the course's link with
 * the code (`…/courses/42?…self_enrollment_code=ABC123`).
 */
export type JoinRequest = { code: string; courseId: string | null };

export function parseJoinInput(input: string): JoinRequest | null {
  const text = input.trim();
  if (!text) return null;
  const enroll = text.match(/\/enroll\/([A-Za-z0-9]+)/);
  if (enroll) return { code: enroll[1].toUpperCase(), courseId: null };
  const course = text.match(/\/courses\/(\d+)/);
  const codeParam = text.match(/self_enrollment_code(?:%5D|\])?=([A-Za-z0-9]+)/i);
  if (course && codeParam) return { code: codeParam[1].toUpperCase(), courseId: course[1] };
  if (/^[A-Za-z0-9]{4,}$/.test(text)) return { code: text.toUpperCase(), courseId: null };
  return null;
}

export type JoinErrorReason = 'network' | 'code' | 'already' | 'full' | 'unknownCourse' | 'concluded' | 'invalid' | 'blank' | 'account_required' | 'notOpen' | 'input' | 'status';

export class JoinError extends Error {
  constructor(message: string, public readonly presentation?: { reason: JoinErrorReason; status?: number; detail?: string }) {
    super(message);
    this.name = 'JoinError';
  }
}

/**
 * The course a join code belongs to. Canvas has no API for this: its join page
 * (`GET /enroll/:code`, self_enrollments_controller.rb) is HTML, and its form
 * posts to the course's enrollments API, so the course ID is read from there.
 */
async function courseForCode(baseUrl: string, code: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/enroll/${encodeURIComponent(code)}`, { headers: { Accept: 'text/html' } });
  } catch {
    throw new JoinError('Couldn’t reach your school’s Canvas. Check your connection and try again.', { reason: 'network' });
  }
  if (response.status === 404)
    throw new JoinError('That join code doesn’t match a course. Check it with your instructor and try again.', { reason: 'code' });
  const html = await response.text().catch(() => '');
  const id = html.match(/\/api\/v1\/courses\/(\d+)\/enrollments/)?.[1];
  if (id) return id;
  if (/already enrolled/i.test(html)) throw new JoinError('You’re already in this course.', { reason: 'already' });
  if (/course is full|enrollment limit/i.test(html)) throw new JoinError('This course is full. Ask your instructor about a spot.', { reason: 'full' });
  throw new JoinError(
    'Your school’s Canvas didn’t say which course this code is for. Open the join link in a browser to join.', { reason: 'unknownCourse' },
  );
}

type SelfEnrollError = {
  message?: string;
  user?: { errors?: { self_enrollment_code?: { type?: string; message?: string }[] } };
};

const joinErrors: Record<string, string> = {
  full: 'This course is full. Ask your instructor about a spot.',
  concluded: 'This course has ended, so it isn’t taking new students.',
  invalid: 'This course isn’t taking new students right now.',
  blank: 'Enter a join code.',
  account_required: 'Sign in with your school account to join this course.',
};

/**
 * Self-enrolls with a join code (enrollments_api_controller.rb#create_self_enrollment):
 * `POST /courses/:id/enrollments` with the code and `user_id=self`. Returns the
 * course ID. "Already enrolled" counts as joined, as on the web.
 */
export async function joinCourse(client: CanvasClient, request: JoinRequest): Promise<string> {
  const courseId = request.courseId ?? (await courseForCode(client.baseUrl, request.code));
  let response: Response;
  try {
    response = await fetch(client.url(`/api/v1/courses/${courseId}/enrollments`), {
      method: 'POST',
      headers: {
        ...(await client.freshAuthHeaders()),
        Accept: 'application/json+canvas-string-ids',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enrollment: { self_enrollment_code: request.code, user_id: 'self' } }),
    });
  } catch {
    throw new JoinError('Couldn’t reach your school’s Canvas. Check your connection and try again.', { reason: 'network' });
  }
  if (response.ok) return courseId;
  let body: SelfEnrollError = {};
  try {
    body = JSON.parse((await response.text()).replace(/^while\(1\);/, '')) as SelfEnrollError;
  } catch {
    // Not JSON.
  }
  const type = body.user?.errors?.self_enrollment_code?.[0]?.type;
  if (type === 'already_enrolled') return courseId;
  if (type && Object.hasOwn(joinErrors, type))
    throw new JoinError(joinErrors[type], {
      reason: type as JoinErrorReason,
      detail: body.user?.errors?.self_enrollment_code?.[0]?.message ?? body.message,
    });
  if (/self_enrollment_code\] is invalid/.test(body.message ?? ''))
    throw new JoinError('That join code doesn’t match a course. Check it with your instructor and try again.', { reason: 'code', detail: body.message });
  if (/no open sections/i.test(body.message ?? '')) throw new JoinError('This course isn’t open for students yet.', { reason: 'notOpen', detail: body.message });
  if (/not open for self-enrollment/i.test(body.message ?? '')) throw new JoinError(joinErrors.invalid, { reason: 'invalid', detail: body.message });
  throw new JoinError(`Canvas couldn’t add you to the course (${response.status}). Try again later.`, { reason: 'status', status: response.status, detail: body.message ?? body.user?.errors?.self_enrollment_code?.[0]?.message });
}

/** Joins a course from a code or link, then refreshes every course list. */
export function useJoinCourse() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    (client, input: string) => {
      const request = parseJoinInput(input);
      if (!request)
        return Promise.reject(
          new JoinError('Enter the join code your instructor shared, or paste the join link.', { reason: 'input' }),
        );
      return joinCourse(client, request);
    },
    {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [accountKey, 'courses'] }),
    },
  );
}
