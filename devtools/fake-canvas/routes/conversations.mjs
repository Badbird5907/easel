/**
 * Inbox: conversations, messages, and recipient search (owned by the
 * Announcements, activity, and inbox workstream).
 *
 * Shapes: lib/api/v1/conversation.rb, ConversationParticipant#as_json,
 * ConversationMessage#as_json, and search_controller.rb (recipients).
 * Mutations live in module scope and reset when this file reloads.
 */
import { at, BASE, courseById, courses, user } from '../data.mjs';
import { paginate } from './core.mjs';

const ME = user.id;

/** Course people, keyed by user ID. `roles` maps course ID to enrollment types. */
const people = {
  [ME]: {
    name: user.short_name,
    full: user.name,
    roles: Object.fromEntries(courses.map((c) => [c.id, ['StudentEnrollment']])),
  },
  2001: { name: 'Amara Osei', full: 'Dr. Amara Osei', roles: { 201: ['TeacherEnrollment'] } },
  2002: { name: 'Daniel Reyes', full: 'Prof. Daniel Reyes', roles: { 241: ['TeacherEnrollment'] } },
  2003: { name: 'Hannah Kim', full: 'Dr. Hannah Kim', roles: { 110: ['TeacherEnrollment'] } },
  2004: { name: 'Lucas Moreau', full: 'Prof. Lucas Moreau', roles: { 150: ['TeacherEnrollment'] } },
  2005: { name: 'Priya Natarajan', full: 'Prof. Priya Natarajan', roles: { 225: ['TeacherEnrollment'] } },
  2006: { name: 'Marco Bellini', full: 'Marco Bellini', roles: { 101: ['TeacherEnrollment'] } },
  2101: { name: 'Ben Carter', full: 'Ben Carter', roles: { 225: ['TaEnrollment'] } },
  2102: { name: 'Grace Liu', full: 'Grace Liu', roles: { 201: ['TaEnrollment'] } },
  1101: {
    name: 'Maya Chen',
    full: 'Maya Chen',
    roles: { 201: ['StudentEnrollment'], 241: ['StudentEnrollment'] },
  },
  1102: {
    name: 'Jordan Lee',
    full: 'Jordan Lee',
    roles: { 201: ['StudentEnrollment'], 241: ['StudentEnrollment'], 225: ['StudentEnrollment'] },
  },
  1103: {
    name: 'Sofia Alvarez',
    full: 'Sofia Alvarez',
    roles: { 201: ['StudentEnrollment'], 241: ['StudentEnrollment'], 110: ['StudentEnrollment'] },
  },
  1104: {
    name: 'Noah Williams',
    full: 'Noah Williams',
    roles: { 201: ['StudentEnrollment'], 150: ['StudentEnrollment'] },
  },
  1105: {
    name: 'Priya Shah',
    full: 'Priya Shah',
    roles: { 201: ['StudentEnrollment'], 150: ['StudentEnrollment'] },
  },
  1106: {
    name: 'Liam O’Connor',
    full: 'Liam O’Connor',
    roles: { 225: ['StudentEnrollment'], 110: ['StudentEnrollment'] },
  },
};

/**
 * Sections and student groups, for recipient search by section and group.
 * Every course has a default section named after it, like Canvas.
 */
const sections = [
  {
    id: '20100',
    course: '201',
    name: 'Cell Biology',
    members: ['2001', '2102', ME, '1101', '1102', '1103', '1104', '1105'],
  },
  {
    id: '20111',
    course: '201',
    name: 'Lab section L1 (Tuesday)',
    members: ['2001', '2102', ME, '1101', '1102', '1103'],
  },
  {
    id: '20112',
    course: '201',
    name: 'Lab section L2 (Thursday)',
    members: ['2001', '2102', '1104', '1105'],
  },
  {
    id: '24100',
    course: '241',
    name: 'Multivariable Calculus',
    members: ['2002', ME, '1101', '1102', '1103'],
  },
  { id: '24111', course: '241', name: 'Discussion AD1', members: ['2002', ME, '1101'] },
  { id: '24112', course: '241', name: 'Discussion AD2', members: ['2002', '1102', '1103'] },
];

const groups = [
  { id: '5101', course: '201', name: 'Osmosis lab group 3', members: [ME, '1101', '1103'] },
  { id: '5102', course: '201', name: 'Osmosis lab group 4', members: ['1102', '1104', '1105'] },
  { id: '5201', course: '241', name: 'Quiz 3 study group', members: [ME, '1101', '1102', '1103'] },
];

const roleTypes = {
  teachers: 'TeacherEnrollment',
  tas: 'TaEnrollment',
  students: 'StudentEnrollment',
  observers: 'ObserverEnrollment',
};
const roleNames = {
  teachers: 'Teachers',
  tas: 'Teaching Assistants',
  students: 'Students',
  observers: 'Observers',
};

const defaultSectionOf = (course) =>
  sections.find((s) => s.course === course && s.name === courseById(course)?.name);

/**
 * People (not the student) a recipient ID reaches: a user, a course, a section,
 * or a group, optionally narrowed to a role (`course_201_teachers`, `section_20111_students`).
 */
function membersOf(id) {
  let m = id.match(/^course_(\d+)(?:_(teachers|tas|students|observers))?$/);
  if (m) {
    const [, course, role] = m;
    return Object.keys(people).filter(
      (uid) =>
        uid !== ME &&
        people[uid].roles[course] &&
        (!role || people[uid].roles[course].includes(roleTypes[role])),
    );
  }
  m = id.match(/^section_(\d+)(?:_(teachers|tas|students|observers))?$/);
  if (m) {
    const section = sections.find((s) => s.id === m[1]);
    if (!section) return [];
    return section.members.filter(
      (uid) => uid !== ME && (!m[2] || people[uid]?.roles[section.course]?.includes(roleTypes[m[2]])),
    );
  }
  m = id.match(/^group_(\d+)$/);
  if (m) return groups.find((g) => g.id === m[1])?.members.filter((uid) => uid !== ME) ?? [];
  return people[id] && id !== ME ? [id] : [];
}

/** The course a recipient context belongs to, for role labels. */
function courseOfContext(id) {
  let m = id.match(/^course_(\d+)/);
  if (m) return m[1];
  m = id.match(/^section_(\d+)/);
  if (m) return sections.find((s) => s.id === m[1])?.course ?? null;
  m = id.match(/^group_(\d+)/);
  if (m) return groups.find((g) => g.id === m[1])?.course ?? null;
  return null;
}

/** Context JSON from SearchHelper#matching_contexts. */
const contextJson = (id, name, extra = {}) => ({
  id,
  name,
  avatar_url: `${BASE}/images/messages/avatar-group-50.png`,
  type: 'context',
  user_count: membersOf(id).length,
  permissions: { send_messages: true },
  ...extra,
});

/** SearchHelper#synthetic_contexts_for: Teachers, Teaching Assistants, Students, Observers. */
function roleContexts(base) {
  return Object.keys(roleTypes)
    .filter((role) => membersOf(`${base}_${role}`).length > 0)
    .map((role) => contextJson(`${base}_${role}`, roleNames[role]));
}

/** What a course offers at the top of the address book: roles, then section and group folders. */
function courseContexts(course) {
  const courseSections = sections.filter((x) => x.course === course);
  const courseGroups = groups.filter((g) => g.course === course);
  const result = roleContexts(`course_${course}`);
  if (courseSections.some((x) => x !== defaultSectionOf(course)))
    result.push({
      id: `course_${course}_sections`,
      name: 'Course Sections',
      item_count: courseSections.length,
      type: 'context',
    });
  if (courseGroups.length)
    result.push({
      id: `course_${course}_groups`,
      name: 'Student Groups',
      item_count: courseGroups.length,
      type: 'context',
    });
  return result;
}

function attachment(id, name, type, size) {
  return {
    id,
    uuid: `uuid-${id}`,
    folder_id: '2',
    display_name: name,
    filename: name.replace(/\s+/g, '_'),
    'content-type': type,
    url: `${BASE}/files/${id}/download?download_frd=1&verifier=v${id}`,
    size,
    created_at: at(-2, 9),
    updated_at: at(-2, 9),
    modified_at: at(-2, 9),
    locked: false,
    hidden: false,
    thumbnail_url: null,
    preview_url: null,
    mime_class: type === 'application/pdf' ? 'pdf' : type.startsWith('image/') ? 'image' : 'doc',
    locked_for_user: false,
  };
}

/**
 * Attachment JSON for uploaded file IDs. The files fake (routes/files.mjs) owns
 * uploads, so ask it over HTTP, the way Canvas looks up the attachment records.
 */
async function filesFor(ids, req) {
  return Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(`${BASE}/api/v1/files/${id}`, {
          headers: { Authorization: req.headers.authorization ?? '' },
        });
        if (res.ok) return await res.json();
      } catch {
        // Fall through to a placeholder.
      }
      return attachment(id, `Attachment ${id}`, 'application/octet-stream', 0);
    }),
  );
}

/** Media files that media comments play (routes/files.mjs fixtures). */
const mediaFiles = {
  6002: { type: 'video', title: 'Pipetting walkthrough' },
  6009: { type: 'audio', title: 'Office hours recap' },
};

/** media_comment_json (lib/api.rb) for a recorded video or audio message. */
function mediaComment(fileId) {
  const media = mediaFiles[fileId];
  return {
    'content-type': `${media.type}/mp4`,
    display_name: media.title,
    media_id: `m-fake${fileId}`,
    media_type: media.type,
    url: `${BASE}/users/${ME}/media_download?entryId=m-fake${fileId}&type=mp4&redirect=1`,
  };
}

let nextMessageId = 46000;
let nextConversationId = 4100;

function message(author, body, created, extra = {}) {
  return {
    id: String(nextMessageId++),
    author_id: String(author),
    body,
    created_at: created,
    generated: false,
    media_comment: null,
    forwarded_messages: [],
    attachments: [],
    ...extra,
  };
}

/** Conversations from the student's side. Messages are newest first, like Canvas. */
const conversations = [
  {
    id: '4007',
    subject: 'Pipetting technique before Thursday',
    course: '201',
    participants: [ME, '2001', '1101', '1103'],
    state: 'unread',
    starred: false,
    messages: [
      message(
        '2001',
        'I recorded a short walkthrough of the pipetting technique. Watch it before Thursday’s lab so we can start right away.',
        at(0, 8, 30),
        { media_comment: mediaComment('6002') },
      ),
    ],
  },
  {
    id: '4008',
    subject: 'Office hours recap: hash functions',
    course: '225',
    participants: [ME, '2101'],
    state: 'read',
    starred: false,
    messages: [
      message(
        '2101',
        'Here’s a quick audio recap of what we covered at office hours, in case you missed it.',
        at(-2, 17, 10),
        { media_comment: mediaComment('6009') },
      ),
    ],
  },
  {
    id: '4001',
    subject: 'MP3 extension request',
    course: '225',
    participants: [ME, '2005'],
    state: 'unread',
    starred: false,
    messages: [
      message('2005', 'Granted. Your new deadline is Saturday at 11:59 PM. Feel better!', at(-1, 16, 20)),
      message(
        ME,
        'Hi Professor Natarajan,\n\nI’ve been sick since Monday and fell behind on MP3. Could I have a 24-hour extension? I can send a note from McKinley.\n\nThanks,\nEvan',
        at(-2, 9, 5),
      ),
    ],
  },
  {
    id: '4002',
    subject: 'Lab report feedback',
    course: '201',
    participants: [ME, '2001'],
    state: 'read',
    starred: true,
    messages: [
      message(
        '2001',
        'Nice work on lab report 2. I marked up your discussion section; the main thing is to tie each result back to your hypothesis. Comments are in the attached PDF.',
        at(-4, 14),
        { attachments: [attachment('6032', 'Lab report 2.pdf', 'application/pdf', 512_004)] },
      ),
    ],
  },
  {
    id: '4003',
    subject: 'Study group for Quiz 3',
    course: '241',
    participants: [ME, '1101', '1102', '1103'],
    state: 'unread',
    starred: false,
    messages: [
      message(
        '1103',
        'Grainger 2nd floor has open tables after 6. I’ll grab one. Here’s the whiteboard from last time.',
        at(0, 11, 40),
        {
          attachments: [attachment('6031', 'Whiteboard photo.jpg', 'image/jpeg', 204_800)],
        },
      ),
      message('1102', 'Thursday works. Can we do the Lagrange problems first?', at(0, 10, 15)),
      message(ME, 'I’m in. Thursday evening?', at(-1, 21)),
      message('1101', 'Anyone want to review together before Friday?', at(-1, 19, 30)),
    ],
  },
  {
    id: '4004',
    subject: 'Essay 2 peer review pairs',
    course: '110',
    participants: [ME, '2003', '1103', '1106'],
    state: 'archived',
    starred: false,
    messages: [
      message(
        '2003',
        'Pairs for peer review are posted on the assignment page. Exchange drafts by Wednesday at noon.',
        at(-10, 9),
      ),
    ],
  },
  {
    id: '4005',
    subject: 'Question about the Hobsbawm reading',
    course: '150',
    participants: [ME, '2004'],
    state: 'read',
    starred: false,
    messages: [
      message(
        ME,
        'Professor Moreau, for Reading Response 5, should we cite page numbers from the course reader or the original edition?',
        at(-3, 13),
      ),
    ],
  },
  {
    id: '4006',
    subject: 'Welcome to Drawing I',
    course: '101',
    participants: [ME, '2006', '1104', '1105'],
    state: 'read',
    starred: false,
    messages: [
      message(
        '2006',
        'Welcome! Our first critique is in week 3. The bookstore has a supply kit for this class.',
        at(-50, 10),
      ),
    ],
  },
];

const notFound = () => ({
  status: 404,
  body: { errors: [{ message: 'The specified resource does not exist.' }] },
});

function userJson(id, { avatars = true } = {}) {
  const p = people[id] ?? { name: 'Unknown user', full: 'Unknown user', roles: {} };
  const json = { id: String(id), name: p.name, full_name: p.full, pronouns: null };
  json.common_courses = id === ME ? {} : p.roles;
  json.common_groups = {};
  if (avatars) json.avatar_url = `${BASE}/images/messages/avatar-50.png`;
  return json;
}

const visibleMessages = (c) => c.messages.filter((m) => !m.deleted);

function truncate(text, n = 100) {
  if (!text) return null;
  return text.length > n ? `${text.slice(0, n - 3)}...` : text;
}

/** conversation_json */
function conversationJson(c, { messages = false, visible = true } = {}) {
  const list = visibleMessages(c);
  const latest = list[0];
  const authored = list.find((m) => m.author_id === ME);
  const audience = c.participants.filter((p) => p !== ME);
  const course = courseById(c.course);
  const json = {
    id: c.id,
    subject: c.subject,
    workflow_state: c.state,
    last_message: truncate(latest?.body),
    last_message_at: latest?.created_at ?? null,
    last_authored_message: truncate(authored?.body),
    last_authored_message_at: authored?.created_at ?? null,
    message_count: list.length,
    subscribed: true,
    private: audience.length === 1,
    starred: c.starred,
    properties: [
      ...(latest?.author_id === ME ? ['last_author'] : []),
      ...(list.some((m) => m.attachments.length) ? ['attachments'] : []),
      ...(list.some((m) => m.media_comment) ? ['media_objects'] : []),
    ],
    audience,
    audience_contexts: { courses: { [c.course]: [] }, groups: {} },
    avatar_url: `${BASE}/images/messages/avatar-${audience.length > 1 ? 'group-' : ''}50.png`,
    participants: c.participants.map((id) => userJson(id)),
    visible,
    context_code: `course_${c.course}`,
    context_name: course?.name ?? null,
  };
  if (messages) {
    json.messages = list.map((m) => ({
      ...m,
      participating_user_ids: m.participating ?? c.participants,
      participating: undefined,
      deleted: undefined,
    }));
  }
  return json;
}

function inScope(c, scope) {
  switch (scope) {
    case 'unread':
      return c.state === 'unread';
    case 'starred':
      return c.starred;
    case 'archived':
      return c.state === 'archived';
    case 'sent':
      return visibleMessages(c).some((m) => m.author_id === ME);
    default:
      return c.state !== 'archived';
  }
}

function matchesFilter(c, filters) {
  if (!filters?.length) return true;
  return filters.some(
    (f) => f === `course_${c.course}` || f === `user_${c.participants.find((p) => p !== ME)}`,
  );
}

const list = (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String);
const asBool = (value) => value === true || value === 'true' || value === '1' || value === 1;

/** Expands users, courses, sections, groups, and role contexts (course_201_teachers) into user IDs. */
function expandRecipients(ids) {
  return [...new Set(ids.flatMap(membersOf))];
}

function latestFirst(a, b) {
  return (visibleMessages(b)[0]?.created_at ?? '').localeCompare(visibleMessages(a)[0]?.created_at ?? '');
}

// MARK: Inbox settings and submission comments (GraphQL, forwarded from routes/graphql.mjs)

/**
 * The student's inbox settings (Types::InboxSettingsType). The school turns
 * signatures on for students in /api/v1/settings/environment below. State lives
 * on globalThis so a reload keeps the student's signature.
 */
const inboxSettings = (globalThis.__fakeCanvasInboxSettings ??= {
  useSignature: false,
  signature: '',
  useOutOfOffice: false,
  outOfOfficeFirstDate: null,
  outOfOfficeLastDate: null,
  outOfOfficeSubject: null,
  outOfOfficeMessage: null,
});

const teacherFor = { 201: '2001', 241: '2002', 110: '2003', 150: '2004', 225: '2005' };
const courseNames = Object.fromEntries(courses.map((c) => [c.id, c.name]));

/**
 * Submissions with comments, as User.viewableSubmissionsConnection lists them
 * (newest comment first). Texts and IDs match course-content.mjs, so each opens
 * the same comments on the submission screen.
 */
const submissionThreads = [
  {
    id: '77101',
    course: '201',
    assignment: { id: '9101', name: 'Lab Report: Diffusion' },
    unread: true,
    comments: [
      { id: 'c7', author: teacherFor[201], at: at(-8, 14, 9), text: 'I recorded a quick note on your discussion section.' },
      {
        id: 'c2',
        author: teacherFor[201],
        at: at(-8, 14, 5),
        text: 'Clear figures. Your discussion would be stronger with a sentence on why the smallest cube equilibrated so quickly.',
      },
      { id: 'c1', author: ME, at: at(-13, 22, 45), text: 'I uploaded only the data by mistake. The full report is coming in attempt 2.' },
    ],
  },
  {
    id: '77007',
    course: '110',
    assignment: { id: '9007', name: 'Essay Draft 2' },
    unread: false,
    comments: [
      { id: 'c5', author: ME, at: at(-2, 22, 50), text: 'Added the Seattle study and a counterargument paragraph.' },
      { id: 'c4', author: teacherFor[110], at: at(-3, 9), text: 'Your thesis is clear. Add a specific study in paragraph two.' },
    ],
  },
  {
    id: '77112',
    course: '225',
    assignment: { id: '9112', name: 'MP2: Linked Lists' },
    unread: true,
    comments: [{ id: 'c9', author: '2101', at: at(-6, 9, 1), text: 'The iterator fails on an empty list. Otherwise nice work.' }],
  },
  {
    id: '77106',
    course: '241',
    assignment: { id: '9106', name: 'Problem Set 6: Partial Derivatives' },
    unread: false,
    comments: [
      { id: 'c3', author: teacherFor[241], at: at(-5, 10, 2), text: 'Good. Next time type up every problem; I can only grade what you submit.' },
    ],
  },
  {
    id: '77123',
    course: '110',
    assignment: { id: '9123', name: 'Annotated bibliography' },
    unread: false,
    comments: [
      {
        id: 'c6',
        author: teacherFor[110],
        at: at(-12, 10, 4),
        text: 'Strong sources. Two annotations summarize without saying how you will use the source.',
      },
    ],
  },
];

const readSubmissions = (globalThis.__fakeCanvasReadSubmissions ??= new Set());

function resolveInboxGraphql({ operationName, variables = {} }) {
  switch (operationName) {
    case 'EaselInboxSettings':
      return { data: { myInboxSettings: { _id: '1', ...inboxSettings } } };
    case 'EaselUpdateInboxSettings': {
      // update_my_inbox_settings.rb: every field is replaced.
      if (typeof variables.useSignature !== 'boolean' || typeof variables.useOutOfOffice !== 'boolean')
        return { data: null, errors: [{ message: 'useSignature and useOutOfOffice are required' }] };
      for (const key of Object.keys(inboxSettings)) inboxSettings[key] = variables[key] ?? null;
      inboxSettings.signature = inboxSettings.signature ?? '';
      return { data: { updateMyInboxSettings: { myInboxSettings: { _id: '1', ...inboxSettings }, errors: null } } };
    }
    case 'EaselSubmissionComments': {
      if (String(variables.userId) !== ME) return { data: { legacyNode: null } };
      const filters = [].concat(variables.filter ?? []).filter(Boolean);
      const nodes = submissionThreads
        .filter((t) => filters.every((f) => !f.startsWith('course_') || f === `course_${t.course}`))
        .sort((a, b) => b.comments[0].at.localeCompare(a.comments[0].at))
        .map((t) => {
          const unread = t.unread && !readSubmissions.has(t.id);
          return {
            _id: t.id,
            readState: unread ? 'unread' : 'read',
            commentsConnection: {
              nodes: t.comments.map((c) => ({
                _id: c.id,
                createdAt: c.at,
                comment: c.text,
                read: !(unread && c.author !== ME),
                author: { _id: c.author, name: people[c.author]?.full ?? 'Unknown', avatarUrl: null },
                assignment: { _id: t.assignment.id, name: t.assignment.name },
                course: { _id: t.course, name: courseNames[t.course] },
              })),
            },
          };
        });
      return { data: { legacyNode: { viewableSubmissionsConnection: { nodes } } } };
    }
    case 'EaselMarkSubmissionsRead': {
      for (const id of [].concat(variables.ids ?? [])) readSubmissions.add(String(id));
      return { data: { updateSubmissionsReadState: { errors: null } } };
    }
    default:
      return null;
  }
}

export const routes = [
  {
    // Internal: routes/graphql.mjs forwards inbox operations here.
    method: 'POST',
    path: '/fake/graphql/inbox',
    handler: ({ body }) => resolveInboxGraphql(body ?? {}) ?? { status: 404, body: null },
  },
  {
    // accounts_controller.rb#environment: only the keys the school set. Signatures are on for students.
    path: '/api/v1/settings/environment',
    handler: () => ({
      calendar_contexts_limit: 10,
      open_registration: false,
      enable_inbox_signature_block: true,
      disable_inbox_signature_block_for_students: false,
      enable_inbox_auto_response: false,
    }),
  },
  {
    path: '/api/v1/conversations',
    handler: ({ query, url }) => {
      const scope = query.scope;
      const items = conversations
        .filter((c) => visibleMessages(c).length > 0)
        .filter((c) => inScope(c, scope))
        .filter((c) => matchesFilter(c, list(query.filter)))
        .sort(latestFirst)
        .map((c) => conversationJson(c));
      return paginate(items, query, url);
    },
  },
  {
    path: '/api/v1/conversations/unread_count',
    handler: () => ({ unread_count: String(conversations.filter((c) => c.state === 'unread').length) }),
  },
  {
    method: 'POST',
    path: '/api/v1/conversations',
    handler: async ({ body = {}, req }) => {
      const recipients = expandRecipients(list(body.recipients));
      const text = String(body.body ?? '').trim();
      if (!recipients.length)
        return { status: 400, body: [{ attribute: 'recipients', message: 'Invalid recipients' }] };
      if (!text) return { status: 400, body: [{ attribute: 'body', message: 'Message body is required' }] };
      const course = String(body.context_code ?? '').replace(/^course_/, '') || courses[0].id;
      const attachments = await filesFor(list(body.attachment_ids), req);
      const groups = asBool(body.bulk_message) ? recipients.map((r) => [r]) : [recipients];
      const created = groups.map((group) => {
        const c = {
          id: String(nextConversationId++),
          subject: String(body.subject ?? '').trim() || null,
          course,
          participants: [ME, ...group],
          state: 'read',
          starred: false,
          messages: [message(ME, text, new Date().toISOString(), { attachments })],
        };
        conversations.unshift(c);
        return conversationJson(c, { messages: true });
      });
      return { status: 201, body: created };
    },
  },
  {
    path: '/api/v1/conversations/:id',
    handler: ({ params, query }) => {
      const c = conversations.find((x) => x.id === params.id);
      if (!c || !visibleMessages(c).length) return notFound();
      if (query.auto_mark_as_read !== 'false' && c.state === 'unread') c.state = 'read';
      return conversationJson(c, { messages: true });
    },
  },
  {
    method: 'PUT',
    path: '/api/v1/conversations/:id',
    handler: ({ params, body = {} }) => {
      const c = conversations.find((x) => x.id === params.id);
      if (!c) return notFound();
      const changes = body.conversation ?? {};
      if (['read', 'unread', 'archived'].includes(changes.workflow_state)) c.state = changes.workflow_state;
      if (changes.starred !== undefined) c.starred = asBool(changes.starred);
      return conversationJson(c);
    },
  },
  {
    method: 'DELETE',
    path: '/api/v1/conversations/:id',
    handler: ({ params }) => {
      const c = conversations.find((x) => x.id === params.id);
      if (!c) return notFound();
      for (const m of c.messages) m.deleted = true;
      return conversationJson(c, { visible: false });
    },
  },
  {
    method: 'POST',
    path: '/api/v1/conversations/:id/add_message',
    handler: async ({ params, body = {}, req }) => {
      const c = conversations.find((x) => x.id === params.id);
      if (!c) return notFound();
      const text = String(body.body ?? '').trim();
      if (!text) return { status: 400, body: [{ attribute: 'body', message: 'Message body is required' }] };
      const recipients = expandRecipients(list(body.recipients));
      const added = recipients.filter((r) => !c.participants.includes(r));
      c.participants.push(...added);
      // Included messages travel as forwarded copies to recipients who didn't have them.
      const included = list(body.included_messages);
      const forwarded = c.messages.filter((m) => included.includes(m.id) && !m.deleted);
      const attachments = await filesFor(list(body.attachment_ids), req);
      const m = message(ME, text, new Date().toISOString(), {
        attachments,
        forwarded_messages: forwarded.map((f) => ({ ...f, participating_user_ids: c.participants })),
        participating: recipients.length ? [ME, ...recipients] : c.participants,
      });
      c.messages.unshift(m);
      if (c.state === 'archived') c.state = 'read';
      const json = conversationJson(c);
      json.messages = [{ ...m, participating_user_ids: m.participating, participating: undefined }];
      return { status: 201, body: json };
    },
  },
  {
    method: 'POST',
    path: '/api/v1/conversations/:id/remove_messages',
    handler: ({ params, body = {} }) => {
      const c = conversations.find((x) => x.id === params.id);
      if (!c) return notFound();
      const remove = list(body.remove);
      for (const m of c.messages) if (remove.includes(m.id)) m.deleted = true;
      return conversationJson(c);
    },
  },
  {
    // GET /api/v1/search/recipients (search_controller.rb, SearchHelper#search_contexts_and_users).
    // `context` scopes the search (course_201, course_201_sections, section_20111, group_5101);
    // `synthetic_contexts` adds role contexts; `type` is "user" or "context".
    path: '/api/v1/search/recipients',
    handler: ({ query, url }) => {
      const term = String(query.search ?? '')
        .trim()
        .toLowerCase();
      const terms = term.split(/\s+/).filter(Boolean);
      const matches = (name) => terms.every((t) => name.toLowerCase().includes(t));
      const context = String(query.context ?? '');
      const synthetic = asBool(query.synthetic_contexts);
      const types = list(query.types ?? query.type);
      const wantUsers = !types.length || types.includes('user');
      const wantContexts =
        !types.length || types.some((t) => ['context', 'course', 'section', 'group'].includes(t));

      let contexts = [];
      let skipUsers = false;
      const course = context.match(/^course_(\d+)(?:_(sections|groups))?$/);
      const section = context.match(/^section_(\d+)$/);
      if (wantContexts && synthetic && course) {
        const [, id, folder] = course;
        const courseSections = sections.filter((x) => x.course === id);
        const courseGroups = groups.filter((g) => g.course === id);
        if (folder === 'sections') {
          contexts = courseSections.map((x) => contextJson(`section_${x.id}`, x.name));
          skipUsers = true;
        } else if (folder === 'groups') {
          contexts = courseGroups.map((g) => contextJson(`group_${g.id}`, g.name));
          skipUsers = true;
        } else if (terms.length) {
          contexts = [
            ...courseSections.map((x) => contextJson(`section_${x.id}`, x.name)),
            ...courseGroups.map((g) => contextJson(`group_${g.id}`, g.name)),
          ];
        } else {
          contexts = courseContexts(id);
          skipUsers = true;
        }
      } else if (wantContexts && synthetic && section && !terms.length) {
        contexts = roleContexts(context);
        skipUsers = true;
      }
      contexts = contexts.filter((c) => matches(c.name));

      const courseId = courseOfContext(context);
      const users =
        wantUsers && !skipUsers
          ? (context ? membersOf(context) : Object.keys(people).filter((id) => id !== ME))
              .filter((id) => matches(people[id].full))
              .sort((a, b) => people[a].full.localeCompare(people[b].full))
              .map((id) => ({
                ...userJson(id),
                common_courses: courseId
                  ? { [courseId]: people[id].roles[courseId] ?? [] }
                  : people[id].roles,
                common_groups: Object.fromEntries(
                  groups.filter((g) => g.members.includes(id)).map((g) => [g.id, ['Member']]),
                ),
              }))
          : [];
      return paginate([...contexts, ...users], query, url);
    },
  },
  {
    // Media comment playback (users_controller#media_download): redirects to the media file.
    path: '/users/:userId/media_download',
    handler: ({ query }) => {
      const id = String(query.entryId ?? '').replace(/^m-fake/, '');
      if (!mediaFiles[id]) return notFound();
      return {
        status: 302,
        body: '',
        headers: { Location: `${BASE}/files/${id}/download?download_frd=1&verifier=fakeuuid${id}` },
      };
    },
  },
];
