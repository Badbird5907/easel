import { useQueryClient } from '@tanstack/react-query';

import { type CanvasClient, CanvasError } from '../client';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';
import type { CourseTab } from './tabs';

/*
 * Student groups. Two workstreams share this file:
 * - Home's group list (HOME-7): `Group`, `fetchGroups`, `useGroups`.
 * - Group home, tabs, people, and self sign-up (COURSE-7): `GroupDetail` and
 *   everything below "Group home". Group content (announcements, discussions,
 *   pages, files) uses the same endpoints as courses under `/api/v1/groups/:id`,
 *   so those screens are shared; see `DiscussionContext` in discussions.ts.
 */

/** group_json (lib/api/v1/group.rb) */
type CanvasGroup = {
  id: string;
  name: string;
  description?: string | null;
  is_public?: boolean;
  /** `parent_context_auto_join`, `parent_context_request`, or `invitation_only`. */
  join_level?: string;
  members_count?: number;
  avatar_url?: string | null;
  context_type?: 'Course' | 'Account' | string;
  course_id?: string | null;
  account_id?: string | null;
  group_category_id?: string | null;
  /** Null for regular groups, `student_organized` for groups students made. */
  role?: string | null;
  max_membership?: number | null;
  concluded?: boolean;
  leader?: { id: string; display_name?: string } | null;
  /** `include[]=permissions` */
  permissions?: { create_discussion_topic?: boolean; join?: boolean; create_announcement?: boolean };
  /** `include[]=group_category`: students can't read group sets any other way. */
  group_category?: CanvasGroupCategory | null;
};

// MARK: Home's list (HOME-7)

export type Group = {
  id: string;
  name: string;
  memberCount: number | null;
  avatarUrl: string | null;
  /** The course the group belongs to, when it's a course group. */
  courseId: string | null;
};

/** The student's groups (HOME-7). Concluded groups stay in Canvas but drop off Home. */
export async function fetchGroups(client: CanvasClient, signal?: AbortSignal): Promise<Group[]> {
  const groups = await client.getAll<CanvasGroup>('/api/v1/users/self/groups', undefined, { signal });
  return groups
    .filter((g) => !g.concluded)
    .map((g) => ({
      id: String(g.id),
      name: g.name,
      memberCount: typeof g.members_count === 'number' ? g.members_count : null,
      avatarUrl: g.avatar_url ?? null,
      courseId: g.context_type === 'Course' && g.course_id ? String(g.course_id) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function useGroups() {
  return useCanvasQuery(['groups', 'self'], fetchGroups, { staleTime: 10 * 60_000 });
}

// MARK: Group home (COURSE-7): raw shapes

/** group_category_json (lib/api/v1/group_category.rb) */
type CanvasGroupCategory = {
  id: string;
  name: string;
  role?: string | null;
  /** `enabled`: anyone in the course; `restricted`: only with others in their section. */
  self_signup?: 'enabled' | 'restricted' | null;
  group_limit?: number | null;
  auto_leader?: string | null;
  context_type?: string;
  course_id?: string | null;
  protected?: boolean;
  allows_multiple_memberships?: boolean;
};

/** group_membership_json */
type CanvasMembership = { id: string; group_id: string; user_id: string; workflow_state: string };

/** `GET /api/v1/groups/:id/users` (user_json) */
type CanvasGroupUser = {
  id: string;
  name: string;
  sortable_name?: string;
  short_name?: string;
  avatar_url?: string | null;
  pronouns?: string | null;
};

// MARK: Group home: models

export type GroupDetail = {
  id: string;
  name: string;
  description: string | null;
  courseId: string | null;
  categoryId: string | null;
  membersCount: number;
  /** How many people it holds, if the instructor set a limit. */
  maxMembers: number | null;
  avatarUrl: string | null;
  /** Students started it themselves. */
  studentOrganized: boolean;
  concluded: boolean;
  leaderId: string | null;
  canCreateDiscussion: boolean;
  canCreateAnnouncement: boolean;
  /** Canvas lets the student join it: self sign-up, or an open group. */
  canJoin: boolean;
  /**
   * The student may leave it themselves: self sign-up sets, sets that allow
   * several groups, and groups students made (group.rb, `:leave`). Needs
   * `include[]=group_category`; false without it.
   */
  canLeave: boolean;
};

export type GroupCategory = {
  id: string;
  name: string;
  /** Students may join and leave groups in it themselves. */
  selfSignup: 'enabled' | 'restricted' | null;
  /** The instructor's limit per group, if any. */
  groupLimit: number | null;
  /** Students may be in more than one group of the set. */
  multipleMemberships: boolean;
};

export type GroupMember = {
  id: string;
  name: string;
  sortableName: string;
  avatarUrl: string | null;
  pronouns: string | null;
};

/** A category the student can sign up in, with its groups and which one they're in. */
export type SignupCategory = GroupCategory & { groups: GroupDetail[]; joinedGroupId: string | null };

const isDefaultAvatar = (url?: string | null) => !url || /avatar-50\.png|images\/messages\/avatar/.test(url);

function toGroupDetail(g: CanvasGroup): GroupDetail {
  return {
    id: String(g.id),
    name: g.name,
    description: g.description?.trim() || null,
    courseId: g.course_id ? String(g.course_id) : null,
    categoryId: g.group_category_id ? String(g.group_category_id) : null,
    membersCount: g.members_count ?? 0,
    maxMembers: g.max_membership ?? null,
    avatarUrl: isDefaultAvatar(g.avatar_url) ? null : g.avatar_url!,
    studentOrganized: g.role === 'student_organized',
    concluded: !!g.concluded,
    leaderId: g.leader?.id ? String(g.leader.id) : null,
    canCreateDiscussion: !!g.permissions?.create_discussion_topic,
    canCreateAnnouncement: !!g.permissions?.create_announcement,
    canJoin: !!g.permissions?.join,
    canLeave:
      g.role === 'student_organized' ||
      !!g.group_category?.self_signup ||
      !!g.group_category?.allows_multiple_memberships,
  };
}

function toCategory(c: CanvasGroupCategory): GroupCategory {
  return {
    id: String(c.id),
    name: c.name,
    selfSignup: c.self_signup === 'enabled' || c.self_signup === 'restricted' ? c.self_signup : null,
    groupLimit: c.group_limit ?? null,
    multipleMemberships: !!c.allows_multiple_memberships,
  };
}

function toMember(u: CanvasGroupUser): GroupMember {
  return {
    id: String(u.id),
    name: u.name,
    sortableName: u.sortable_name ?? u.name,
    avatarUrl: isDefaultAvatar(u.avatar_url) ? null : u.avatar_url!,
    pronouns: u.pronouns ?? null,
  };
}

// MARK: Group home: fetchers and hooks

/** The student's groups in one course (`only_own_groups`), so sign-ups show up right away. */
export async function fetchMyCourseGroups(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<GroupDetail[]> {
  const groups = await client.getAll<CanvasGroup>(
    `/api/v1/courses/${courseId}/groups`,
    { only_own_groups: true, include: ['permissions'] },
    { signal, maxPages: 5 },
  );
  return groups.map(toGroupDetail);
}

export function useMyCourseGroups(courseId: string | null | undefined, options?: { enabled?: boolean }) {
  return useCanvasQuery(
    ['groups', 'course', courseId ?? 'none', 'mine'],
    (client, signal) => fetchMyCourseGroups(client, courseId!, signal),
    { ...options, enabled: !!courseId && (options?.enabled ?? true) },
  );
}

export async function fetchGroup(client: CanvasClient, groupId: string, signal?: AbortSignal) {
  return toGroupDetail(
    await client.get<CanvasGroup>(
      `/api/v1/groups/${groupId}`,
      { include: ['permissions', 'group_category'] },
      signal,
    ),
  );
}

export function useGroup(groupId: string | null | undefined) {
  return useCanvasQuery(
    ['groups', groupId ?? 'none'],
    (client, signal) => fetchGroup(client, groupId!, signal),
    { enabled: !!groupId },
  );
}

/** `GET /api/v1/groups/:id/tabs` (lib/api/v1/tab.rb), in Canvas order. */
export async function fetchGroupTabs(client: CanvasClient, groupId: string, signal?: AbortSignal) {
  const tabs = await client.getAll<{
    id: string;
    label: string;
    html_url: string;
    full_url?: string;
    position: number;
    hidden?: boolean;
    unused?: boolean;
    type: 'internal' | 'external';
    url?: string;
  }>(`/api/v1/groups/${groupId}/tabs`, undefined, { signal });
  return tabs
    .sort((a, b) => a.position - b.position)
    .map((tab): CourseTab => ({
      id: tab.id,
      label: tab.label,
      hidden: !!(tab.hidden || tab.unused),
      external: tab.type === 'external',
      htmlUrl: tab.html_url,
      fullUrl: tab.full_url ?? null,
      launchUrl: tab.url ?? null,
    }));
}

export function useGroupTabs(groupId: string) {
  return useCanvasQuery(['groups', groupId, 'tabs'], (client, signal) =>
    fetchGroupTabs(client, groupId, signal),
  );
}

export async function fetchGroupMembers(client: CanvasClient, groupId: string, signal?: AbortSignal) {
  const users = await client.getAll<CanvasGroupUser>(
    `/api/v1/groups/${groupId}/users`,
    { include: ['avatar_url'] },
    { signal },
  );
  return users.map(toMember).sort((a, b) => a.sortableName.localeCompare(b.sortableName));
}

export function useGroupMembers(groupId: string) {
  return useCanvasQuery(['groups', groupId, 'people'], (client, signal) =>
    fetchGroupMembers(client, groupId, signal),
  );
}

/**
 * Group sets in a course that let students sign up themselves, each with its
 * groups and the one the student is in. Students can't read group sets
 * directly (group_categories_controller.rb needs manage rights), so they come
 * from the course's groups with `include[]=group_category`. Sets without self
 * sign-up are left out: the instructor places students in those.
 */
export async function fetchSignupCategories(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<SignupCategory[]> {
  const [groups, mine] = await Promise.all([
    client.getAll<CanvasGroup>(
      `/api/v1/courses/${courseId}/groups`,
      { include: ['group_category', 'permissions'] },
      { signal, maxPages: 10 },
    ),
    fetchMyCourseGroups(client, courseId, signal),
  ]);
  const mineIds = new Set(mine.map((g) => g.id));
  const categories = new Map<string, SignupCategory>();
  for (const raw of groups) {
    const category = raw.group_category ? toCategory(raw.group_category) : null;
    if (!category?.selfSignup) continue;
    const entry = categories.get(category.id) ?? { ...category, groups: [], joinedGroupId: null };
    const group = toGroupDetail(raw);
    entry.groups.push(group);
    if (mineIds.has(group.id)) entry.joinedGroupId = group.id;
    categories.set(category.id, entry);
  }
  return [...categories.values()].map((c) => ({
    ...c,
    groups: c.groups.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
  }));
}

export function useSignupCategories(courseId: string) {
  return useCanvasQuery(['groups', 'course', courseId, 'signup'], (client, signal) =>
    fetchSignupCategories(client, courseId, signal),
  );
}

// MARK: Group home: mutations

/** Optional presentation metadata; legacy message and original server error are retained. */
export class GroupMembershipError extends Error {
  constructor(message: string, readonly reason: 'full' | 'section' | 'permission', readonly serverError: Error) {
    super(message);
  }
}

const friendlyMembershipError = (error: unknown): Error => {
  if (!(error instanceof CanvasError)) return error as Error;
  if (/full/i.test(error.message)) return new GroupMembershipError('This group is full. Choose another group.', 'full', error);
  if (/share a section/i.test(error.message))
    return new GroupMembershipError('You can only join a group with classmates from your section.', 'section', error);
  if (error.status === 401 || error.status === 403)
    return new GroupMembershipError('Your instructor doesn’t let students change groups in this set.', 'permission', error);
  return error;
};

function useRefreshGroups() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return () => queryClient.invalidateQueries({ queryKey: [accountKey, 'groups'] });
}

/**
 * Joins a group in a self sign-up set (`POST /groups/:id/memberships`). Canvas
 * moves the student out of any other group in the same set.
 */
export function useJoinGroup() {
  const refresh = useRefreshGroups();
  return useCanvasMutation(
    async (client, groupId: string) => {
      try {
        return await client.post<CanvasMembership>(`/api/v1/groups/${groupId}/memberships`, {
          user_id: 'self',
        });
      } catch (error) {
        throw friendlyMembershipError(error);
      }
    },
    { onSettled: refresh },
  );
}

/** Leaves a group (`DELETE /groups/:id/memberships/self`). */
export function useLeaveGroup() {
  const refresh = useRefreshGroups();
  return useCanvasMutation(
    async (client, groupId: string) => {
      try {
        await client.delete<unknown>(`/api/v1/groups/${groupId}/memberships/self`);
      } catch (error) {
        throw friendlyMembershipError(error);
      }
    },
    { onSettled: refresh },
  );
}
