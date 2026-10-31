/**
 * Student groups, their pages and conferences, and people profiles (owned by the
 * Course content and communication workstream: COURSE-7, CONTENT-8, CONTENT-10,
 * CONTENT-11). Group discussions and announcements live in discussions.mjs with
 * every other topic.
 *
 * Shapes: lib/api/v1/group.rb, group_category.rb, group_membership_json,
 * wiki_page.rb (and revisions), conferences.rb, user.rb (bio, enrollments),
 * section.rb.
 *
 * Cases worth knowing:
 *   group 501   "Osmosis Lab Group" in BIO 201: the student is in it. Self sign-up set
 *               "Lab groups" (9001), so the student can leave or move to 502.
 *   group 502   room for one more (3 of 4). Group 503 is full (4 of 4).
 *   set 9002    "Final project teams" in CS 225: self sign-up, the student is in none yet.
 *   group 5201  "Quiz 3 study group" in MATH 241: instructor-made, no leaving.
 *   pages       group 501's "Lab plan" is editable by members (editing_roles: members).
 *   conferences BIO 201 has a live room and a past one with a recording, CS 225 a past
 *               one with a recording, group 501 a scheduled one. IDs match conferences.mjs,
 *               which serves Home's live banner and the join pages.
 *   profiles    GET /api/v1/courses/:id/users/:id with include[]=bio for the roster in
 *               course-content.mjs; a few people have bios, titles, and sections.
 *
 * Membership and page edits live on globalThis, so they survive this file reloading.
 */
import { at, BASE, user } from '../data.mjs';
import { paginate } from './core.mjs';

const ME = user.id;

/** Who's who in the fixtures (IDs match discussions.mjs and conversations.mjs). */
const names = {
  [ME]: user.name,
  1101: 'Maya Chen',
  1102: 'Jordan Lee',
  1103: 'Sofia Alvarez',
  1104: 'Noah Williams',
  1105: 'Priya Shah',
  1106: 'Liam O’Connor',
  1107: 'Ava Thompson',
  1108: 'Kenji Watanabe',
  1109: 'Amelia Brooks',
};

const sortable = (name) => {
  const parts = name.split(' ');
  return parts.length > 1 ? `${parts.at(-1)}, ${parts.slice(0, -1).join(' ')}` : name;
};

const categories = {
  9001: { id: '9001', name: 'Lab groups', course: '201', self_signup: 'enabled', group_limit: 4 },
  9002: { id: '9002', name: 'Final project teams', course: '225', self_signup: 'restricted', group_limit: 3 },
  9003: { id: '9003', name: 'Study groups', course: '241', self_signup: null, group_limit: null },
};

const groupFixtures = [
  { id: '501', name: 'Osmosis Lab Group', category: '9001', members: [ME, '1101', '1103', '1105'], leader: '1101' },
  { id: '502', name: 'Lab group B', category: '9001', members: ['1102', '1104', '1107'] },
  { id: '503', name: 'Lab group C', category: '9001', members: ['1106', '1108', '1109', '1102'] },
  { id: '5221', name: 'Team Hashbrowns', category: '9002', members: ['1106'] },
  { id: '5222', name: 'Team Collision', category: '9002', members: ['1102', '1108'] },
  { id: '5201', name: 'Quiz 3 study group', category: '9003', members: [ME, '1101', '1102', '1103'] },
];

const store = (globalThis.__fakeCanvasGroups ??= {
  members: Object.fromEntries(groupFixtures.map((g) => [g.id, [...g.members]])),
  pageEdits: {},
});

const membersOf = (g) => store.members[g.id] ?? g.members;
const groupById = (id) => groupFixtures.find((g) => g.id === String(id));
const courseOfGroup = (g) => categories[g.category].course;
const inGroup = (g) => membersOf(g).includes(ME);

const notFound = () => ({ status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } });
const unauthorized = () => ({
  status: 403,
  body: { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] },
});

function categoryJson(c) {
  return {
    id: c.id,
    name: c.name,
    role: null,
    self_signup: c.self_signup,
    self_signup_end_at: null,
    group_limit: c.group_limit,
    auto_leader: null,
    created_at: at(-60, 9),
    context_type: 'Course',
    course_id: c.course,
    protected: false,
    allows_multiple_memberships: false,
    is_member: groupFixtures.some((g) => g.category === c.id && inGroup(g)),
  };
}

/** group.rb#grants_right?(:join): self sign-up sets, with room. */
function canJoin(g) {
  const c = categories[g.category];
  if (!c.self_signup || inGroup(g)) return false;
  return !c.group_limit || membersOf(g).length < c.group_limit;
}

/** group_json (lib/api/v1/group.rb) */
function groupJson(g, includes) {
  const c = categories[g.category];
  const json = {
    id: g.id,
    name: g.name,
    description: g.id === '501' ? 'Thursday lab, bench 3.' : null,
    is_public: false,
    join_level: c.self_signup ? 'parent_context_auto_join' : 'invitation_only',
    group_category_id: c.id,
    max_membership: c.group_limit,
    created_at: at(-60, 9),
    members_count: membersOf(g).length,
    storage_quota_mb: 50,
    context_type: 'Course',
    course_id: c.course,
    context_name: c.course,
    avatar_url: null,
    role: null,
    leader: g.leader ? { id: g.leader, display_name: names[g.leader], avatar_image_url: null } : null,
    has_submission: false,
    concluded: false,
    non_collaborative: false,
  };
  if (includes.has('permissions'))
    json.permissions = {
      create_discussion_topic: inGroup(g),
      join: canJoin(g),
      create_announcement: inGroup(g),
    };
  if (includes.has('group_category')) json.group_category = categoryJson(c);
  if (includes.has('users'))
    json.users = membersOf(g).map((id) => ({ id, name: names[id], sortable_name: sortable(names[id] ?? '') }));
  return json;
}

const includesOf = (query) => new Set(query.include ?? []);

/** Shared with Calendar's users/self/groups route so Home reflects joins and leaves. */
export function studentGroups(query = {}) {
  return groupFixtures.filter(inGroup).map((g) => groupJson(g, includesOf(query)));
}


// MARK: Group pages (wiki_page.rb)

const groupPages = {
  501: [
    {
      url: 'lab-plan',
      title: 'Lab plan',
      front: true,
      editingRoles: 'members',
      updated: at(-1, 18),
      editor: '1101',
      revision: 4,
      body: '<h3>Thursday plan</h3><ul><li>Maya cuts the potato cores</li><li>Sofia runs the scale</li><li>Evan records the masses</li></ul><p>Bring the data sheet from the lab guide.</p>',
    },
    {
      url: 'meeting-notes',
      title: 'Meeting notes',
      editingRoles: 'members',
      updated: at(-3, 20),
      editor: '1103',
      revision: 2,
      body: '<p>We agreed to rerun the 0.6 M cores; one sample dried out.</p>',
    },
  ],
};

const pagesOf = (groupId) =>
  (groupPages[groupId] ?? []).map((p) => ({ ...p, ...store.pageEdits[`${groupId}:${p.url}`] }));

function pageJson(groupId, p, { body }) {
  return {
    page_id: `g${groupId}-${p.url}`,
    url: p.url,
    title: p.title,
    created_at: at(-20, 9),
    updated_at: p.updated,
    hide_from_students: false,
    editing_roles: p.editingRoles,
    last_edited_by: { id: p.editor, display_name: names[p.editor], avatar_image_url: null },
    published: true,
    front_page: !!p.front,
    html_url: `${BASE}/groups/${groupId}/pages/${p.url}`,
    todo_date: null,
    publish_at: null,
    locked_for_user: false,
    ...(body && { body: p.body }),
  };
}

// MARK: Conferences (lib/api/v1/conferences.rb)

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

/**
 * The same conferences routes/conferences.mjs lists for Home's live banner (same
 * IDs, titles, and times), plus recordings on the ones that ended.
 */
const conferences = {
  'courses:201': [
    {
      id: '33010',
      title: 'Office Hours: Osmosis Lab Q&A',
      conference_type: 'BigBlueButton',
      description: 'Drop in with questions about the osmosis lab report.',
      duration: 60,
      started_at: minutesAgo(12),
      ended_at: null,
      long_running: false,
      recordings: [],
    },
    {
      id: '33002',
      title: 'Review session: membranes',
      conference_type: 'BigBlueButton',
      description: 'A walkthrough of the membrane transport problems before Quiz 4.',
      duration: 90,
      started_at: minutesAgo(60 * 24 * 6),
      ended_at: minutesAgo(60 * 24 * 6 - 85),
      long_running: false,
      recordings: [
        {
          recording_id: 'rec-33002-a',
          title: 'Review session: membranes',
          duration_minutes: 82,
          playback_url: null,
          playback_formats: [
            { type: 'presentation', translated_type: 'Presentation', url: `${BASE}/fake/conference-recording/33002`, length: '82', show_to_students: true },
            { type: 'statistics', translated_type: 'Statistics', url: `${BASE}/fake/conference-recording/33002/stats`, length: null, show_to_students: false },
          ],
          created_at: Date.now() - (60 * 24 * 6 - 90) * 60_000,
        },
      ],
    },
  ],
  'courses:225': [
    {
      id: '33001',
      title: 'MP3 Review Session',
      conference_type: 'BigBlueButton',
      description: 'Walkthrough of the hash table starter code.',
      duration: 90,
      started_at: minutesAgo(60 * 26),
      ended_at: minutesAgo(60 * 24),
      long_running: false,
      recordings: [
        {
          recording_id: 'rec-33001-a',
          title: 'MP3 Review Session',
          duration_minutes: 118,
          playback_url: null,
          playback_formats: [
            { type: 'video', translated_type: 'Video', url: `${BASE}/fake/conference-recording/33001`, length: '118', show_to_students: true },
          ],
          created_at: Date.now() - (60 * 24 - 5) * 60_000,
        },
      ],
    },
  ],
  'groups:501': [
    {
      id: '33020',
      title: 'Lab Group Check-in',
      conference_type: 'BigBlueButton',
      description: null,
      duration: 30,
      started_at: null,
      ended_at: null,
      long_running: false,
      recordings: [],
    },
  ],
};

function conferenceJson(type, contextId, c) {
  const contextType = type === 'groups' ? 'Group' : 'Course';
  return {
    ...c,
    conference_key: `fake-${c.id}`,
    context_type: contextType,
    context_id: contextId,
    start_at: null,
    end_at: null,
    has_advanced_settings: false,
    has_calendar_event: false,
    user_settings: {},
    users: [ME],
    invitees: [],
    attendees: [],
    url: `${BASE}/${type}/${contextId}/conferences/${c.id}`,
    // conferences.rb never fills this in for the API.
    join_url: null,
  };
}

// MARK: People profiles (CONTENT-10)

/** Profile fields for the course-content.mjs roster (IDs there: t<course>, 3xxx TAs, 1001, classmates). */
const profiles = {
  t201: {
    bio: 'I study how cells sense and respond to osmotic stress. Office hours are Tuesdays at 2 in Bio 3108.',
    title: 'Associate Professor of Biology',
    pronunciation: 'ah-MAR-ah oh-SAY',
  },
  t225: { bio: 'Ask me about hash functions, bad puns, and good test cases.', title: 'Teaching Professor' },
  t110: { bio: 'I teach writing as a way of thinking. Bring drafts, not finished essays.' },
  3201: { bio: 'PhD student in cell biology. I run the Tuesday lab section.' },
  [ME]: { bio: 'Sophomore in bioengineering.' },
};

const sectionsFor = (courseId) => [
  { id: `${courseId}0`, name: `Section 1`, course_id: courseId },
  { id: `${courseId}1`, name: 'Lab section L1 (Tuesday)', course_id: courseId },
];

/** The roster lives in course-content.mjs; ask it over HTTP like Canvas would load the user. */
async function rosterUser(courseId, userId, req) {
  try {
    const res = await fetch(
      `${BASE}/api/v1/courses/${courseId}/users?per_page=100&include[]=enrollments&include[]=avatar_url`,
      { headers: { Authorization: req.headers.authorization ?? '' } },
    );
    if (!res.ok) return null;
    const list = await res.json();
    return list.find((u) => String(u.id) === String(userId)) ?? null;
  } catch {
    return null;
  }
}

// MARK: Routes

export const routes = [
  {
    path: '/api/v1/groups/:groupId',
    handler: ({ params, query }) => {
      const g = groupById(params.groupId);
      return g ? groupJson(g, includesOf(query)) : notFound();
    },
  },
  {
    // GET /api/v1/courses/:id/groups: every collaborative group, or only the student's.
    path: '/api/v1/courses/:courseId/groups',
    handler: ({ params, query, url }) => {
      const own = query.only_own_groups === 'true' || query.only_own_groups === '1';
      const list = groupFixtures
        .filter((g) => courseOfGroup(g) === params.courseId)
        .filter((g) => !own || inGroup(g))
        .map((g) => groupJson(g, includesOf(query)));
      return paginate(list, query, url);
    },
  },
  {
    // Students can't list group sets (group_categories_controller.rb needs manage rights).
    path: '/api/v1/courses/:courseId/group_categories',
    handler: unauthorized,
  },
  {
    path: '/api/v1/group_categories/:categoryId/groups',
    handler: unauthorized,
  },
  {
    // group_memberships_controller.rb#create with user_id=self.
    method: 'POST',
    path: '/api/v1/groups/:groupId/memberships',
    handler: ({ params, body }) => {
      const g = groupById(params.groupId);
      if (!g) return notFound();
      if (body?.user_id !== 'self' && body?.user_id !== ME) return unauthorized();
      const c = categories[g.category];
      if (inGroup(g))
        return { id: `m${g.id}`, group_id: g.id, user_id: ME, workflow_state: 'accepted', moderator: false, just_created: false };
      if (!c.self_signup) return unauthorized();
      if (c.group_limit && membersOf(g).length >= c.group_limit)
        return {
          status: 400,
          body: { errors: { group_id: [{ attribute: 'group_id', type: 'The group is full.', message: 'The group is full.' }] } },
        };
      // One group per set: joining moves the student (group_membership.rb).
      for (const other of groupFixtures.filter((x) => x.category === g.category && x.id !== g.id))
        store.members[other.id] = membersOf(other).filter((id) => id !== ME);
      store.members[g.id] = [...membersOf(g), ME];
      return {
        id: `m${g.id}`,
        group_id: g.id,
        user_id: ME,
        workflow_state: 'accepted',
        moderator: false,
        created_at: new Date().toISOString(),
        just_created: true,
      };
    },
  },
  ...['memberships', 'users'].map((segment) => ({
    method: 'DELETE',
    path: `/api/v1/groups/:groupId/${segment}/:userId`,
    handler: ({ params }) => {
      const g = groupById(params.groupId);
      if (!g) return notFound();
      if (params.userId !== 'self' && params.userId !== ME) return unauthorized();
      if (!categories[g.category].self_signup) return unauthorized();
      store.members[g.id] = membersOf(g).filter((id) => id !== ME);
      return { ok: true };
    },
  })),
  {
    path: '/api/v1/groups/:groupId/tabs',
    handler: ({ params }) => {
      const g = groupById(params.groupId);
      if (!g) return notFound();
      const tabs = [
        ['home', 'Home', ''],
        ['announcements', 'Announcements', '/announcements'],
        ['pages', 'Pages', '/pages'],
        ['people', 'People', '/users'],
        ['discussions', 'Discussions', '/discussion_topics'],
        ['files', 'Files', '/files'],
        ...(g.id === '501' ? [['conferences', 'BigBlueButton', '/conferences']] : []),
        ['collaborations', 'Collaborations', '/collaborations'],
      ];
      return tabs.map(([id, label, path], index) => ({
        id,
        html_url: `/groups/${g.id}${path}`,
        full_url: `${BASE}/groups/${g.id}${path}`,
        position: index + 1,
        visibility: 'public',
        label,
        type: 'internal',
      }));
    },
  },
  {
    path: '/api/v1/groups/:groupId/users',
    handler: ({ params, query, url }) => {
      const g = groupById(params.groupId);
      if (!g) return notFound();
      const withAvatars = includesOf(query).has('avatar_url');
      const list = membersOf(g).map((id) => ({
        id,
        name: names[id] ?? 'Unknown',
        created_at: at(-200, 9),
        sortable_name: sortable(names[id] ?? 'Unknown'),
        short_name: (names[id] ?? 'Unknown').split(' ')[0],
        ...(id === '1103' && { pronouns: 'she/her' }),
        ...(withAvatars && { avatar_url: null }),
      }));
      return paginate(list, query, url);
    },
  },

  // Group pages
  {
    path: '/api/v1/groups/:groupId/pages',
    handler: ({ params, query, url }) =>
      paginate(
        pagesOf(params.groupId).map((p) => pageJson(params.groupId, p, { body: false })),
        query,
        url,
      ),
  },
  {
    path: '/api/v1/groups/:groupId/front_page',
    handler: ({ params }) => {
      const p = pagesOf(params.groupId).find((x) => x.front);
      return p ? pageJson(params.groupId, p, { body: true }) : notFound();
    },
  },
  {
    path: '/api/v1/groups/:groupId/pages/:pageUrl',
    handler: ({ params }) => {
      const p = pagesOf(params.groupId).find((x) => x.url === params.pageUrl);
      return p ? pageJson(params.groupId, p, { body: true }) : notFound();
    },
  },
  {
    path: '/api/v1/groups/:groupId/pages/:pageUrl/revisions/latest',
    handler: ({ params, query }) => {
      const p = pagesOf(params.groupId).find((x) => x.url === params.pageUrl);
      if (!p) return notFound();
      return {
        revision_id: p.revision,
        updated_at: p.updated,
        latest: true,
        edited_by: { id: p.editor, display_name: names[p.editor], avatar_image_url: null },
        ...(query.summary !== 'true' && { url: p.url, title: p.title, body: p.body }),
      };
    },
  },
  {
    // wiki_pages_api_controller.rb#update: members may change the body of pages open to members.
    method: 'PUT',
    path: '/api/v1/groups/:groupId/pages/:pageUrl',
    handler: ({ params, body }) => {
      const g = groupById(params.groupId);
      const p = pagesOf(params.groupId).find((x) => x.url === params.pageUrl);
      if (!g || !p) return notFound();
      if (!inGroup(g)) return { status: 401, body: { status: 'unauthorized' } };
      const change = body?.wiki_page ?? {};
      if (change.title !== undefined && change.title !== p.title)
        return {
          status: 401,
          body: {
            errors: {
              title: [{ attribute: 'title', type: 'unauthorized', message: 'You are not allowed to update the title of this wiki page' }],
            },
          },
        };
      const key = `${params.groupId}:${p.url}`;
      store.pageEdits[key] = {
        ...store.pageEdits[key],
        body: String(change.body ?? p.body),
        updated: new Date().toISOString(),
        editor: ME,
        revision: p.revision + 1,
      };
      const next = pagesOf(params.groupId).find((x) => x.url === params.pageUrl);
      return pageJson(params.groupId, next, { body: true });
    },
  },
  {
    // Development only: another member saves a page, to try the edit conflict check.
    method: 'POST',
    path: '/fake/groups/:groupId/pages/:pageUrl/someone-edits',
    handler: ({ params }) => {
      const p = pagesOf(params.groupId).find((x) => x.url === params.pageUrl);
      if (!p) return notFound();
      const key = `${params.groupId}:${p.url}`;
      store.pageEdits[key] = {
        ...store.pageEdits[key],
        body: `${p.body}<p>Sofia: I added the 0.8 M solution to the plan.</p>`,
        updated: new Date().toISOString(),
        editor: '1103',
        revision: p.revision + 1,
      };
      return { ok: true };
    },
  },

  // Conferences
  ...['courses', 'groups'].map((type) => ({
    path: `/api/v1/${type}/:contextId/conferences`,
    handler: ({ params }) => ({
      conferences: (conferences[`${type}:${params.contextId}`] ?? []).map((c) =>
        conferenceJson(type, params.contextId, c),
      ),
    }),
  })),
  {
    path: '/fake/conference-recording/:id',
    public: true,
    handler: () => ({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<!doctype html><meta name="viewport" content="width=device-width"><h1>Recording playback</h1><p>The fake Canvas stands in for BigBlueButton here.</p>',
    }),
  },
  // People profiles and sections
  {
    path: '/api/v1/courses/:courseId/users/:userId',
    handler: async ({ params, query, req }) => {
      const u = await rosterUser(params.courseId, params.userId, req);
      if (!u) return notFound();
      const includes = includesOf(query);
      const profile = profiles[params.userId] ?? {};
      const json = { ...u };
      if (!includes.has('enrollments')) delete json.enrollments;
      else
        json.enrollments = (u.enrollments ?? []).flatMap((e) => [
          { ...e, course_section_id: `${params.courseId}0` },
          ...(e.type === 'StudentEnrollment' && ['1001', '1101'].includes(String(u.id))
            ? [{ ...e, id: `${e.id}b`, course_section_id: `${params.courseId}1` }]
            : []),
        ]);
      // user.rb: bio, title, and pronunciation only when the school turns on profiles.
      if (includes.has('bio')) json.bio = profile.bio ?? null;
      if (includes.has('title')) json.title = profile.title ?? null;
      if (includes.has('pronunciation')) json.pronunciation = profile.pronunciation ?? null;
      return json;
    },
  },
  {
    path: '/api/v1/courses/:courseId/sections',
    handler: ({ params, query, url }) => paginate(sectionsFor(params.courseId), query, url),
  },
];
