/**
 * Discussion topics, announcements, and threaded entries (owned by the
 * Announcements, activity, and inbox workstream).
 *
 * Announcements are discussion topics with `is_announcement`, so every topic
 * lives here: `/api/v1/announcements` reads the same read state that opening a
 * topic changes. Mutations (read state, replies, likes) live in module scope and
 * reset when this file reloads.
 *
 * Shapes: lib/api/v1/discussion_topics.rb, the `view` action in
 * app/controllers/discussion_topics_api_controller.rb. Easel's GraphQL calls for
 * discussions (entry create and edit, mentionable users, entry permissions) are
 * answered by `POST /fake/graphql/discussions`, which routes/graphql.mjs forwards
 * to, so all discussion state stays in this file.
 */
import { announcements as baseAnnouncements, at, BASE, courseById, user, work } from '../data.mjs';
import { assetString, paginate } from './core.mjs';

/** Everyone who posts in the fixtures. Teachers match data.mjs course teachers. */
const people = {
  1001: { name: user.name, short: user.short_name },
  2001: { name: 'Dr. Amara Osei', short: 'Amara Osei' },
  2002: { name: 'Prof. Daniel Reyes', short: 'Daniel Reyes' },
  2003: { name: 'Dr. Hannah Kim', short: 'Hannah Kim' },
  2004: { name: 'Prof. Lucas Moreau', short: 'Lucas Moreau' },
  2005: { name: 'Prof. Priya Natarajan', short: 'Priya Natarajan' },
  2006: { name: 'Marco Bellini', short: 'Marco Bellini' },
  2101: { name: 'Ben Carter', short: 'Ben Carter' },
  1101: { name: 'Maya Chen', short: 'Maya Chen' },
  1102: { name: 'Jordan Lee', short: 'Jordan Lee' },
  1103: { name: 'Sofia Alvarez', short: 'Sofia Alvarez' },
  1104: { name: 'Noah Williams', short: 'Noah Williams' },
  1105: { name: 'Priya Shah', short: 'Priya Shah' },
  1106: { name: 'Liam O’Connor', short: 'Liam O’Connor' },
  1107: { name: 'Ava Thompson', short: 'Ava Thompson' },
  2102: { name: 'Grace Liu', short: 'Grace Liu' },
};

/** Who can be @-mentioned in each course: its teachers, TAs, and students. */
const roster = {
  201: ['2001', '2102', '1001', '1101', '1102', '1103', '1104', '1105', '1107'],
  225: ['2005', '2101', '1001', '1102', '1106'],
  241: ['2002', '1001', '1101', '1102', '1103'],
  110: ['2003', '1001', '1103', '1106'],
  150: ['2004', '1001', '1104', '1105'],
  101: ['2006', '1001', '1104', '1105'],
};

/**
 * Course settings students feel (GET /api/v1/courses/:id/settings): attachments on
 * replies, editing their own posts, and starting their own topics (CONTENT-5).
 * CS 225 and BIO 201 let students start discussions; the others don't.
 */
const courseSettings = {
  150: {
    allowStudentForumAttachments: true,
    allowStudentDiscussionEditing: false,
    allowStudentDiscussionTopics: false,
  },
  110: { allowStudentDiscussionTopics: false },
  241: { allowStudentDiscussionTopics: false },
  101: { allowStudentDiscussionTopics: false },
};
const settingsFor = (courseId) => ({
  allowStudentForumAttachments: true,
  allowStudentDiscussionEditing: true,
  allowStudentDiscussionTopics: true,
  lockAllAnnouncements: false,
  ...courseSettings[courseId],
});

/**
 * Student groups with their own discussions and announcements (COURSE-7). Group IDs
 * match routes/group-content.mjs, which owns the groups themselves.
 */
const groupCourse = { 501: '201', 502: '201', 503: '201', 5201: '241' };
/** The course a topic's settings come from: its own, or its group's. */
const courseOf = (t) => t.course ?? groupCourse[t.group];
const contextCodeOf = (t) => (t.group ? `group_${t.group}` : assetString(t.course));

/** The HTML Canvas's editor writes for an @-mention (ui/shared/rce/plugins/canvas_mentions). */
const mention = (id) =>
  `<span class="mceNonEditable mention" data-mention="${id}">@${people[id]?.short ?? 'Unknown'}</span>`;

const idForName = (name) =>
  Object.keys(people).find((id) => people[id].short === name || people[id].name === name) ?? '2001';

/** user_display_json (lib/api/v1/user.rb) */
function displayUser(id) {
  const p = people[id] ?? { short: 'Unknown user' };
  return {
    id: String(id),
    anonymous_id: Number(id).toString(36),
    display_name: p.short,
    avatar_image_url: null,
    html_url: `${BASE}/users/${id}`,
    pronouns: null,
  };
}

/** Attachment JSON for a file in routes/files.mjs (same ID, verifier, and thumbnail). */
function attachment(id, name, type, size) {
  const verifier = `fakeuuid${id}`;
  return {
    id,
    uuid: verifier,
    folder_id: '1',
    display_name: name,
    filename: name.replace(/\s+/g, '+'),
    'content-type': type,
    url: `${BASE}/files/${id}/download?download_frd=1&verifier=${verifier}`,
    size,
    created_at: at(-3, 9),
    updated_at: at(-3, 9),
    modified_at: at(-3, 9),
    locked: false,
    hidden: false,
    thumbnail_url: type.startsWith('image/') ? `${BASE}/images/thumbnails/${id}/${verifier}` : null,
    preview_url: null,
    mime_class: type === 'application/pdf' ? 'pdf' : type.startsWith('image/') ? 'image' : 'file',
    locked_for_user: false,
  };
}

/**
 * Attachment JSON for an uploaded file ID. routes/files.mjs owns uploads, so ask
 * it over HTTP, the way Canvas looks up the attachment record.
 */
async function uploadedFile(id, req) {
  try {
    const res = await fetch(`${BASE}/api/v1/files/${id}`, {
      headers: { Authorization: req.headers.authorization ?? '' },
    });
    if (res.ok) return await res.json();
  } catch {
    // Fall through.
  }
  return null;
}

let nextEntryId = 61000;
function entry(userId, message, created, replies = [], extra = {}) {
  return { id: String(nextEntryId++), user_id: String(userId), message, created, replies, ...extra };
}

/** Anonymous participant IDs, base-36 like Canvas's DiscussionTopicParticipant ids. */
const anonymousId = (userId) => (Number(userId) * 7 + 13).toString(36);

const announcementTopics = [
  ...baseAnnouncements.map((a) => ({
    id: a.id,
    course: a.course,
    title: a.title,
    message: a.message,
    posted: a.posted,
    author: idForName(a.author),
    unread: a.unread,
    announcement: true,
    entries: [],
  })),
  {
    id: '7003',
    course: '241',
    title: 'Quiz 3 covers 14.1 to 14.4',
    author: '2002',
    posted: at(-2, 10),
    unread: true,
    announcement: true,
    message:
      '<p>Quiz 3 on Friday covers sections <strong>14.1 through 14.4</strong>. Expect one Lagrange multiplier problem.</p><p>Practice problems are on the course page. Solutions go up Thursday night.</p>',
    entries: [],
  },
  {
    id: '7004',
    course: '110',
    title: 'Essay 2 rubric posted',
    author: '2003',
    posted: at(-3, 9),
    unread: true,
    announcement: true,
    allowReplies: true,
    attachments: [
      attachment(
        '6013',
        'Essay 2 guidelines.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        18_432,
      ),
      attachment(
        '6014',
        'Peer review form.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        14_208,
      ),
    ],
    message:
      '<p>The rubric for Essay 2 is now on the assignment page. Read the “Counterargument” row closely; that is where most points were lost on Essay 1.</p>',
    entries: [
      entry('1103', '<p>Will the rubric be the same for the final essay?</p>', at(-3, 11), [
        entry('2003', '<p>Mostly. The final adds a research row.</p>', at(-3, 13)),
      ]),
    ],
  },
  {
    id: '7005',
    course: '150',
    title: 'No class Monday',
    author: '2004',
    posted: at(-6, 12),
    unread: false,
    announcement: true,
    message: '<p>Campus is closed Monday. Use the time to start Reading Response 5.</p>',
    entries: [],
  },
  {
    id: '7006',
    course: '101',
    title: 'Bring charcoal on Thursday',
    author: '2006',
    posted: at(-9, 14),
    unread: false,
    announcement: true,
    message:
      '<p>We start figure studies Thursday. Bring <em>vine and compressed charcoal</em>, a kneaded eraser, and newsprint.</p><ul><li>18×24 newsprint pad</li><li>Vine charcoal, soft</li><li>Compressed charcoal, 2B</li></ul>',
    entries: [],
  },
  {
    id: '7007',
    course: '225',
    title: 'Welcome to CS 225',
    author: '2005',
    posted: at(-45, 9),
    unread: false,
    announcement: true,
    message: '<p>Welcome! The syllabus, lab schedule, and office hours are on the course home page.</p>',
    entries: [],
  },
];

const dueFor = (id) => work.find((w) => w.id === id)?.due ?? null;

const discussionTopics = [
  {
    id: '8101',
    course: '201',
    title: 'Week 9: Membrane transport questions',
    author: '2001',
    posted: at(-5, 9),
    pinned: true,
    position: 1,
    allowRating: true,
    unread: true,
    message:
      '<p>Post questions about this week’s reading here. Answer each other too; I’ll check in every evening.</p><p>Hint for the problem set: think about which direction water moves when the solute <em>can’t</em> cross.</p>',
    entries: [
      entry(
        '1101',
        '<p>Why does the cell swell in a hypotonic solution if the membrane lets water go both ways?</p>',
        at(-4, 15),
        [
          entry(
            '1102',
            '<p>It does go both ways, but more water moves in than out because the inside has more solute.</p>',
            at(-4, 16),
            [entry('1101', '<p>That makes sense, thanks!</p>', at(-4, 17))],
            { rating_sum: 2 },
          ),
          entry(
            '2001',
            '<p>Exactly right, Jordan. Net movement is what matters. See <a href="https://en.wikipedia.org/wiki/Osmosis">osmosis</a>, and the diagram from lecture is attached.</p>',
            at(-3, 9),
            [],
            { rating_sum: 4, attachment: attachment('6003', 'Cell diagram.png', 'image/png', 48_210) },
          ),
        ],
        { rating_sum: 3 },
      ),
      entry('1001', '<p>Is the lab report due before or after the quiz?</p>', at(-2, 20), [
        entry('1103', `<p>${mention('1001')} Before. Lab report is due tomorrow at 9.</p>`, at(-1, 8), [], {
          unread: true,
        }),
      ]),
      entry(
        '1104',
        '<p>Does anyone have notes from Tuesday? I missed the part about sodium-potassium pumps.</p>',
        at(-1, 10),
        [],
        { unread: true },
      ),
      entry('1105', '<p>The pump moves 3 Na⁺ out and 2 K⁺ in per ATP.</p>', at(0, 8), [], { unread: true }),
    ],
  },
  {
    id: '8102',
    course: '201',
    title: 'Lab partners for the osmosis lab',
    author: '2001',
    posted: at(-2, 12),
    position: null,
    noAttachments: true,
    unread: false,
    message: '<p>Reply with who you’re working with so I can set up groups.</p>',
    entries: [],
  },
  {
    id: '9203',
    course: '201',
    title: 'Lab partner check-in',
    author: '2001',
    posted: at(-2, 12),
    unread: false,
    assignment: { id: '9103', due: at(2, 17), points: 5 },
    message:
      '<p>Post who your lab partner is and one thing you want to improve in the next lab.</p>',
    entries: [],
  },
  {
    id: '8103',
    course: '201',
    title: 'Introductions',
    author: '2001',
    posted: at(-60, 9),
    lastReply: at(-55, 12),
    locked: true,
    unread: false,
    message: '<p>Tell us your name, your major, and one thing you’re curious about in biology.</p>',
    entries: [
      entry(
        '1001',
        '<p>I’m Evan, a sophomore in bioengineering. I want to understand CRISPR better.</p>',
        at(-59, 10),
      ),
      entry('1101', '<p>Maya, chemistry major. Curious about protein folding.</p>', at(-58, 11)),
    ],
  },
  {
    // A long debate: replies nest seven levels deep, with likes, mentions, and unread replies.
    id: '8104',
    course: '201',
    title: 'Debate: is a virus alive?',
    author: '2001',
    posted: at(-3, 8),
    allowRating: true,
    unread: true,
    message:
      '<p>Take a side and defend it with one property of life from Chapter 1. Reply to each other; I want to see the argument develop.</p>',
    entries: [
      entry(
        '1102',
        '<p>Not alive. Viruses can’t reproduce without a host cell, and they have no metabolism of their own.</p>',
        at(-3, 10),
        [
          entry(
            '1101',
            `<p>${mention('1102')} Parasites can’t reproduce without a host either, and we call them alive.</p>`,
            at(-3, 12),
            [
              entry(
                '1102',
                '<p>A tapeworm still has its own metabolism. A virus outside a cell is basically a crystal.</p>',
                at(-3, 14),
                [
                  entry(
                    '1104',
                    '<p>Giant viruses like mimivirus carry genes for translation machinery, though. The line is blurry.</p>',
                    at(-2, 9),
                    [
                      entry(
                        '1101',
                        '<p>That’s my point. Life is a spectrum, not a yes or no.</p>',
                        at(-2, 11),
                        [
                          entry(
                            '2001',
                            `<p>Good thread. ${mention('1101')}, which property from Chapter 1 does a spectrum view drop?</p>`,
                            at(-2, 15),
                            [
                              entry(
                                '1101',
                                '<p>Homeostasis, probably. Viruses don’t regulate anything.</p>',
                                at(-1, 9),
                                [
                                  entry(
                                    '1107',
                                    `<p>${mention('1001')} you argued this in lab. Want to jump in?</p>`,
                                    at(0, 7),
                                    [],
                                    { unread: true },
                                  ),
                                ],
                                { unread: true, rating_sum: 2 },
                              ),
                            ],
                            { rating_sum: 5 },
                          ),
                        ],
                        { rating_sum: 1 },
                      ),
                    ],
                    { rating_sum: 3 },
                  ),
                ],
              ),
              entry('1103', '<p>Parasites still make their own proteins. Different thing.</p>', at(-3, 13)),
            ],
            { rating_sum: 4 },
          ),
          entry('1105', '<p>Agree. No cells, no life. Cell theory settles it.</p>', at(-3, 11), [], {
            attachment: attachment('6004', 'Osmosis lab photo.jpg', 'image/jpeg', 31_784),
          }),
        ],
        { rating_sum: 6 },
      ),
      entry(
        '1103',
        '<p>Alive, sort of. They evolve by natural selection, which is the property I care about most.</p>',
        at(-2, 8),
        [
          entry('1104', '<p>Evolution alone isn’t enough. Prions change too.</p>', at(-1, 18), [], {
            unread: true,
          }),
        ],
        { unread: true },
      ),
    ],
  },
  {
    id: '8201',
    course: '225',
    title: 'MP3 questions',
    author: '2005',
    posted: at(-6, 10),
    pinned: true,
    position: 1,
    allowRating: true,
    unread: false,
    message: '<p>Ask MP3 questions here. Don’t post code from your solution.</p>',
    entries: [
      entry(
        '1106',
        '<p>Should <code>remove()</code> shrink the table when the load factor drops?</p>',
        at(-1, 22),
        [entry('2101', '<p>No resizing on remove for this MP.</p>', at(0, 9), [], { unread: true })],
        { unread: true },
      ),
      entry('1102', '<p>Is the autograder using the same seed as the provided tests?</p>', at(0, 7), [], {
        unread: true,
      }),
    ],
  },
  {
    id: '8301',
    course: '241',
    title: 'Study group sign-up',
    author: '2002',
    posted: at(-8, 9),
    unread: false,
    message: '<p>If you want a study group for the midterm, reply with times that work for you.</p>',
    entries: [entry('1103', '<p>Tuesdays after 4 work for me.</p>', at(-7, 14))],
  },
  {
    id: '9002',
    course: '150',
    title: 'Reading Response 5',
    author: '2004',
    posted: at(-8, 9),
    assignment: { id: '9002', due: dueFor('9002'), points: 10 },
    requireInitialPost: true,
    unread: true,
    message:
      '<p>In 300 words, respond to the Hobsbawm reading: what does he mean by the “dual revolution,” and do you find the framing convincing?</p><p>You’ll see classmates’ responses after you post your own.</p>',
    entries: [
      entry(
        '1104',
        '<p>Hobsbawm pairs the French and Industrial Revolutions because each made the other possible…</p>',
        at(-3, 21),
      ),
      entry(
        '1105',
        '<p>I’m not convinced the two revolutions can be separated so cleanly…</p>',
        at(-2, 18),
        [],
        {
          unread: true,
        },
      ),
    ],
  },
  {
    id: '9004',
    course: '110',
    title: 'Peer Review: Essay 2',
    author: '2003',
    posted: at(-4, 9),
    assignment: { id: '9004', due: dueFor('9004'), points: 10 },
    unread: false,
    message:
      '<p>Post your draft’s thesis and the paragraph you’re least sure about. Reply to two classmates with one specific suggestion each.</p>',
    entries: [entry('1101', '<p>Thesis: Social media rewards certainty over curiosity.</p>', at(-1, 19))],
  },
  {
    // Graded with checkpoints (CONTENT-4): reply to the topic, then to two classmates.
    id: '8401',
    course: '110',
    title: 'Debate prep: is rhetoric manipulation?',
    author: '2003',
    posted: at(-3, 9),
    unread: true,
    allowRating: true,
    assignment: {
      id: '9401',
      due: at(4, 23, 59),
      points: 20,
      checkpoints: [
        { tag: 'reply_to_topic', name: 'Debate prep: is rhetoric manipulation?', points: 10, due: at(1, 23, 59) },
        { tag: 'reply_to_entry', name: 'Debate prep: is rhetoric manipulation?', points: 10, due: at(4, 23, 59) },
      ],
      requiredReplies: 2,
    },
    message:
      '<p>Take a position: is persuasive rhetoric a form of manipulation? Post your argument by Friday, then reply to <strong>two</strong> classmates by Monday.</p>',
    entries: [
      entry(
        '1103',
        '<p>Not inherently. Manipulation hides its aims; rhetoric that names its claim openly lets the audience judge it.</p>',
        at(-2, 14),
      ),
      entry(
        '1106',
        '<p>Yes, when it works on emotion before reason. Ads are the obvious case.</p>',
        at(-1, 20),
        [],
        { unread: true },
      ),
    ],
  },
  {
    // Fully anonymous (CONTENT-4): REST won't show it, so Easel reads it through GraphQL.
    id: '8106',
    course: '201',
    title: 'Anonymous feedback: lab format',
    author: '2001',
    posted: at(-4, 10),
    unread: true,
    anonymous: 'full_anonymity',
    message:
      '<p>Tell me honestly what is and isn’t working about the lab sections. Replies are anonymous to everyone, including me.</p>',
    entries: [
      entry('1102', '<p>The pre-lab quiz is useful, but 10 minutes is too short.</p>', at(-3, 18)),
      entry(
        '1104',
        '<p>More time for the write-up in lab would help. I always finish at home.</p>',
        at(-2, 9),
        [entry('1101', '<p>Agreed. Even 15 minutes would make a difference.</p>', at(-2, 13), [], { unread: true })],
      ),
    ],
  },
  {
    // Partially anonymous: each student chooses whether to post with their name.
    id: '8202',
    course: '225',
    title: 'What’s confusing about hash tables?',
    author: '2005',
    posted: at(-2, 9),
    unread: true,
    allowRating: true,
    anonymous: 'partial_anonymity',
    message:
      '<p>Post the part of hashing you find least clear. You can post anonymously if you like.</p>',
    entries: [
      entry('1106', '<p>Why is the table size usually prime?</p>', at(-1, 15), [], { anonymousAuthor: true }),
      entry('1102', '<p>How do you pick a good load factor?</p>', at(-1, 17), [
        entry('2101', '<p>Around 0.7 for linear probing is a common rule of thumb.</p>', at(0, 8), [], {
          unread: true,
        }),
      ]),
    ],
  },
  {
    // A group discussion (CONTENT-4): this copy only introduces it; each lab group replies in its own.
    id: '8105',
    course: '201',
    title: 'Lab group check-in: osmosis results',
    author: '2001',
    posted: at(-2, 8),
    unread: false,
    groupCategory: '9001',
    groupChildren: [
      { id: '8501', group_id: '501' },
      { id: '8502', group_id: '502' },
      { id: '8503', group_id: '503' },
    ],
    message:
      '<p>With your lab group, compare your mass-change curves. Where do your groups’ numbers disagree, and why?</p>',
    entries: [],
  },
  {
    id: '8501',
    group: '501',
    rootTopic: '8105',
    title: 'Lab group check-in: osmosis results',
    author: '2001',
    posted: at(-2, 8),
    unread: true,
    message:
      '<p>With your lab group, compare your mass-change curves. Where do your groups’ numbers disagree, and why?</p>',
    entries: [
      entry('1101', '<p>Our 0.4 M cores lost more mass than the class average. Maybe we cut them thinner?</p>', at(-1, 16), [], {
        unread: true,
      }),
    ],
  },
  {
    id: '8502',
    group: '502',
    rootTopic: '8105',
    title: 'Lab group check-in: osmosis results',
    author: '2001',
    posted: at(-2, 8),
    unread: false,
    message:
      '<p>With your lab group, compare your mass-change curves. Where do your groups’ numbers disagree, and why?</p>',
    entries: [],
  },
  {
    id: '8503',
    group: '503',
    rootTopic: '8105',
    title: 'Lab group check-in: osmosis results',
    author: '2001',
    posted: at(-2, 8),
    unread: false,
    message:
      '<p>With your lab group, compare your mass-change curves. Where do your groups’ numbers disagree, and why?</p>',
    entries: [],
  },
  {
    // A discussion the lab group started itself.
    id: '8510',
    group: '501',
    title: 'Who brings the scale on Thursday?',
    author: '1103',
    posted: at(-1, 19),
    unread: true,
    message: '<p>I can bring mine, but it only goes to 0.1 g. Does anyone have a better one?</p>',
    entries: [entry('1101', '<p>The lab has two 0.01 g scales. Let’s just grab one early.</p>', at(0, 7))],
  },
  {
    id: '8520',
    group: '501',
    announcement: true,
    title: 'Group meeting moved to Wednesday',
    author: '1101',
    posted: at(-1, 12),
    unread: true,
    allowReplies: true,
    message: '<p>We’re meeting Wednesday at 4 in the library instead of Tuesday. Same room as last time.</p>',
    entries: [],
  },
];

/** Every topic, with mutable read state and entries. */
const topics = [...announcementTopics, ...discussionTopics].map((t) => ({
  pinned: false,
  locked: false,
  allowRating: false,
  requireInitialPost: false,
  attachments: [],
  position: null,
  ...t,
}));

/** Entry ratings by the student: entryId -> 1. */
const ratings = new Map();

function walk(entries, fn, parent = null) {
  for (const e of entries) {
    fn(e, parent);
    walk(e.replies, fn, e);
  }
}

function allEntries(topic) {
  const out = [];
  walk(topic.entries, (e) => out.push(e));
  return out;
}

function findEntry(topic, id) {
  return allEntries(topic).find((e) => e.id === String(id));
}

/** DiscussionEntry policy: authors update and delete their own posts when the course allows it. */
const canManage = (topic, e) =>
  e.user_id === user.id && settingsFor(courseOf(topic)).allowStudentDiscussionEditing;

const hasPosted = (topic) => allEntries(topic).some((e) => e.user_id === user.id && !e.deleted);
const canSeePosts = (topic) => !topic.requireInitialPost || hasPosted(topic);

function lastReplyAt(topic) {
  const dates = allEntries(topic)
    .filter((e) => !e.deleted)
    .map((e) => e.created);
  return dates.sort().at(-1) ?? topic.lastReply ?? null;
}

const notFound = () => ({
  status: 404,
  body: { errors: [{ message: 'The specified resource does not exist.' }] },
});

/** A topic in a course (`courses`) or group (`groups`). */
function findTopic(contextId, topicId, type = 'courses') {
  return topics.find(
    (t) =>
      t.id === String(topicId) && (type === 'groups' ? t.group === String(contextId) : t.course === String(contextId)),
  );
}

/** Canvas hides anonymous topics from REST show, view, and entries (discussion_topics_api_controller.rb#is_not_anonymous). */
const hiddenFromRest = (t) => !!t.anonymous;

/** discussion_topic_api_json */
function topicJson(t, { contextCode = false } = {}) {
  const entries = allEntries(t).filter((e) => !e.deleted);
  const unread = canSeePosts(t) ? entries.filter((e) => e.unread).length : 0;
  const url = t.group
    ? `${BASE}/groups/${t.group}/discussion_topics/${t.id}`
    : `${BASE}/courses/${t.course}/discussion_topics/${t.id}`;
  const repliesOpen = t.announcement ? !!t.allowReplies : !t.locked;
  const teacherAuthor = String(t.author).startsWith('2');
  const json = {
    id: t.id,
    title: t.title,
    message: t.message,
    html_url: url,
    url,
    assignment_id: t.assignment?.id ?? null,
    delayed_post_at: null,
    lock_at: null,
    created_at: t.posted,
    posted_at: t.posted,
    last_reply_at: lastReplyAt(t),
    root_topic_id: t.rootTopic ?? null,
    podcast_has_student_posts: false,
    discussion_type: t.threaded === false ? 'not_threaded' : 'threaded',
    position: t.position,
    allow_rating: t.allowRating,
    only_graders_can_rate: false,
    sort_by_rating: false,
    is_section_specific: false,
    anonymous_state: t.anonymous ?? null,
    summary_enabled: false,
    // Anonymous topics hide the author unless they're an instructor (discussion_topic.rb#user_name).
    user_name: t.anonymous && !teacherAuthor ? null : people[t.author]?.name,
    discussion_subentry_count: entries.length,
    permissions: {
      attach: repliesOpen && settingsFor(courseOf(t)).allowStudentForumAttachments && !t.noAttachments,
      update: false,
      reply: repliesOpen,
      delete: false,
    },
    require_initial_post: t.requireInitialPost,
    user_can_see_posts: canSeePosts(t),
    podcast_url: null,
    read_state: t.unread ? 'unread' : 'read',
    unread_count: unread,
    subscribed: true,
    attachments: t.attachments,
    published: true,
    can_unpublish: false,
    locked: t.announcement ? !t.allowReplies : t.locked,
    can_lock: false,
    comments_disabled: t.announcement ? !t.allowReplies : false,
    author: t.anonymous ? null : displayUser(t.author),
    pinned: t.pinned,
    group_category_id: t.groupCategory ?? null,
    can_group: false,
    topic_children: (t.groupChildren ?? []).map((c) => c.id),
    group_topic_children: t.groupChildren ?? [],
    locked_for_user: false,
    todo_date: null,
    is_announcement: !!t.announcement,
    sort_order: 'desc',
    sort_order_locked: false,
    expanded: true,
    expanded_locked: false,
  };
  if (contextCode) json.context_code = contextCodeOf(t);
  if (t.assignment) {
    json.assignment = {
      id: t.assignment.id,
      name: t.title,
      due_at: t.assignment.due,
      points_possible: t.assignment.points,
      html_url: `${BASE}/courses/${t.course}/assignments/${t.assignment.id}`,
      submission_types: ['discussion_topic'],
    };
    if (t.assignment.checkpoints) {
      // lib/api/v1/assignment.rb with include_checkpoints; lib/checkpoint.rb.
      json.assignment.has_sub_assignments = true;
      json.assignment.checkpoints = t.assignment.checkpoints.map((c) => ({
        tag: c.tag,
        name: c.name,
        points_possible: c.points,
        due_at: c.due,
        unlock_at: null,
        lock_at: null,
        only_visible_to_overrides: false,
        overrides: [],
      }));
      json.reply_to_entry_required_count = t.assignment.requiredReplies;
      json.is_checkpointed = true;
    }
  }
  return json;
}

/** One node of the materialized view (discussion_entry_api_json with no user). */
function viewEntry(e) {
  const json = {
    id: e.id,
    created_at: e.created,
    updated_at: e.updated ?? e.created,
    parent_id: e.parent_id ?? null,
    rating_count: e.rating_sum ? e.rating_sum : null,
    rating_sum: e.rating_sum ?? null,
  };
  if (e.deleted) {
    json.deleted = true;
    json.editor_id = e.user_id;
  } else {
    json.user_id = e.user_id;
    json.message = e.message;
    if (e.editor_id) json.editor_id = e.editor_id;
  }
  if (e.attachment) {
    json.attachment = e.attachment;
    json.attachments = [e.attachment];
  }
  json.replies = e.replies.map(viewEntry);
  return json;
}

/** Entry JSON as returned by POST/PUT (includes user_name and read state). */
function entryJson(e) {
  return {
    ...viewEntry(e),
    user_name: people[e.user_id]?.name,
    user: displayUser(e.user_id),
    read_state: e.unread ? 'unread' : 'read',
    forced_read_state: false,
    replies: undefined,
    recent_replies: e.replies.map(viewEntry),
    has_more_replies: false,
  };
}

// Parent IDs once, so view nodes can report them.
for (const t of topics) walk(t.entries, (e, parent) => (e.parent_id = parent?.id ?? null));

function sortTopics(list) {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned) return (a.position ?? 0) - (b.position ?? 0);
    return (lastReplyAt(b) ?? b.posted).localeCompare(lastReplyAt(a) ?? a.posted);
  });
}

const messageOf = (body) => {
  const raw = body?.message ?? '';
  return typeof raw === 'string' ? raw : String(raw);
};

// MARK: GraphQL (forwarded from routes/graphql.mjs)

const findTopicById = (id) => topics.find((t) => t.id === String(id));

function findEntryAnywhere(id) {
  for (const t of topics) {
    const e = findEntry(t, id);
    if (e) return { topic: t, entry: e };
  }
  return null;
}

const repliesOpen = (t) => (t.announcement ? !!t.allowReplies : !t.locked);
const canAttach = (t) =>
  repliesOpen(t) && settingsFor(courseOf(t)).allowStudentForumAttachments && !t.noAttachments;

/** The DiscussionEntry fields Easel selects after a create or an edit. */
function entryNode(e) {
  return {
    _id: e.id,
    message: e.message,
    createdAt: e.created,
    updatedAt: e.updated ?? e.created,
    attachment: e.attachment ? { _id: e.attachment.id, displayName: e.attachment.display_name } : null,
  };
}

/** Mutation payloads report problems as `errors: [{ attribute, message }]` (Mutations::BaseMutation). */
const validation = (field, message) => ({
  data: { [field]: { discussionEntry: null, errors: [{ attribute: 'message', message }] } },
});
const executionError = (message) => ({ data: null, errors: [{ message }] });

async function resolveGraphql({ operationName, variables = {} }, req) {
  switch (operationName) {
    case 'EaselDiscussionPermissions': {
      // Types::DiscussionPermissionsType and DiscussionEntryPermissionsType for the student's own posts.
      const t = findTopicById(variables.topicId);
      if (!t) return { data: { legacyNode: null } };
      const mine = canSeePosts(t) ? allEntries(t).filter((e) => e.user_id === user.id && !e.deleted) : [];
      return {
        data: {
          legacyNode: {
            permissions: { attach: canAttach(t), reply: repliesOpen(t), rate: t.allowRating },
            // discussion_type.rb#can_reply_anonymously: anyone but instructors, in courses.
            canReplyAnonymously: !t.group,
            discussionEntriesConnection: {
              nodes: mine.map((e) => ({
                _id: e.id,
                permissions: { update: canManage(t, e), delete: canManage(t, e) },
              })),
            },
          },
        },
      };
    }
    case 'EaselMentionableUsers': {
      // Discussion.mentionableUsersConnection: MessageableUser search in the topic's context.
      const t = findTopicById(variables.topicId);
      if (!t) return { data: { legacyNode: null } };
      const term = String(variables.search ?? '')
        .trim()
        .toLowerCase();
      const nodes = (roster[courseOf(t)] ?? [])
        .map((id) => ({ id, ...people[id] }))
        .filter((p) => !term || p.name.toLowerCase().includes(term) || p.short.toLowerCase().includes(term))
        .sort((a, b) => a.short.localeCompare(b.short))
        .slice(0, Number(variables.first ?? 10))
        .map((p) => ({ _id: p.id, name: p.name, shortName: p.short, pronouns: null }));
      return { data: { legacyNode: { mentionableUsersConnection: { nodes } } } };
    }
    case 'EaselCreateDiscussionEntry': {
      const t = findTopicById(variables.topicId);
      if (!t) return executionError('not found');
      if (!repliesOpen(t)) return validation('createDiscussionEntry', 'Insufficient Permissions');
      const message = String(variables.message ?? '');
      if (!message.trim()) return validation('createDiscussionEntry', 'Message can’t be blank');
      let parent = null;
      if (variables.parentId) {
        parent = findEntry(t, variables.parentId);
        if (!parent || !canSeePosts(t)) return executionError('not found');
      }
      let file = null;
      if (variables.fileId) {
        if (!canAttach(t)) return validation('createDiscussionEntry', 'Insufficient attach permissions');
        file = await uploadedFile(variables.fileId, req);
        if (!file) return executionError('not found');
      }
      const e = entry(user.id, message, new Date().toISOString(), [], {
        parent_id: parent?.id ?? null,
        ...(file && { attachment: file }),
        ...(t.anonymous === 'partial_anonymity' && variables.anonymous && { anonymousAuthor: true }),
      });
      (parent ? parent.replies : t.entries).push(e);
      return { data: { createDiscussionEntry: { discussionEntry: entryNode(e), errors: null } } };
    }
    case 'EaselUpdateDiscussionEntry': {
      const found = findEntryAnywhere(variables.entryId);
      if (!found || found.entry.deleted) return executionError('not found');
      const { topic: t, entry: e } = found;
      if (!canManage(t, e)) return validation('updateDiscussionEntry', 'Insufficient Permissions');
      if (variables.message != null) {
        if (!String(variables.message).trim())
          return validation('updateDiscussionEntry', 'Message can’t be blank');
        e.message = String(variables.message);
      }
      if (variables.removeAttachment) delete e.attachment;
      if (variables.fileId && e.attachment?.id !== String(variables.fileId)) {
        if (!canAttach(t)) return validation('updateDiscussionEntry', 'Insufficient attach permissions');
        const file = await uploadedFile(variables.fileId, req);
        if (!file) return executionError('not found');
        e.attachment = file;
      }
      e.updated = new Date().toISOString();
      e.editor_id = user.id;
      return { data: { updateDiscussionEntry: { discussionEntry: entryNode(e), errors: null } } };
    }
    case 'EaselAnonymousThread': {
      // Discussion.discussionEntriesConnection for anonymous topics (discussion_entry_type.rb#author, #anonymous_author).
      const t = findTopicById(variables.topicId);
      if (!t) return { data: { legacyNode: null } };
      const gated = !canSeePosts(t);
      const nodes = gated
        ? []
        : allEntries(t).map((e) => {
            const instructor = String(e.user_id).startsWith('2');
            const hidden = t.anonymous === 'full_anonymity' ? !instructor : !!e.anonymousAuthor;
            return {
              _id: e.id,
              parentId: e.parent_id ?? null,
              message: e.deleted ? null : e.message,
              createdAt: e.created,
              updatedAt: e.updated ?? e.created,
              editedAt: e.editor_id ? e.updated : null,
              deleted: !!e.deleted,
              ratingSum: e.rating_sum ?? null,
              entryParticipant: { read: !e.unread, rating: ratings.has(e.id) },
              author: hidden || e.deleted ? null : { _id: e.user_id, name: people[e.user_id]?.name, avatarUrl: null },
              anonymousAuthor: hidden
                ? {
                    id: anonymousId(e.user_id),
                    shortName: e.user_id === user.id ? 'current_user' : anonymousId(e.user_id),
                    avatarUrl: null,
                  }
                : null,
              attachment: e.attachment
                ? {
                    _id: e.attachment.id,
                    displayName: e.attachment.display_name,
                    url: e.attachment.url,
                    contentType: e.attachment['content-type'],
                    size: String(e.attachment.size),
                    thumbnailUrl: e.attachment.thumbnail_url,
                  }
                : null,
            };
          });
      return {
        data: {
          legacyNode: {
            initialPostRequiredForCurrentUser: gated,
            discussionEntriesConnection: { nodes },
          },
        },
      };
    }
    case 'EaselCreateDiscussionTopic': {
      // Mutations::CreateDiscussionTopic for a student (create_discussion_topic.rb).
      const type = variables.contextType === 'Group' ? 'groups' : 'courses';
      const contextId = String(variables.contextId ?? '');
      const courseId = type === 'groups' ? groupCourse[contextId] : contextId;
      if (!courseId) return executionError('not found');
      if (type === 'courses' && !settingsFor(courseId).allowStudentDiscussionTopics)
        return { data: { createDiscussionTopic: { discussionTopic: null, errors: [{ attribute: 'base', message: 'Insufficient permissions' }] } } };
      const title = String(variables.title ?? '').trim();
      if (!title)
        return { data: { createDiscussionTopic: { discussionTopic: null, errors: [{ attribute: 'title', message: 'Title can’t be blank' }] } } };
      let file = null;
      if (variables.fileId) {
        if (!settingsFor(courseId).allowStudentForumAttachments)
          return executionError('Insufficient attach permissions');
        file = await uploadedFile(variables.fileId, req);
      }
      const t = {
        id: String(nextTopicId++),
        ...(type === 'groups' ? { group: contextId } : { course: contextId }),
        title,
        author: user.id,
        posted: new Date().toISOString(),
        unread: false,
        pinned: false,
        locked: false,
        allowRating: !!variables.allowRating,
        requireInitialPost: !!variables.requireInitialPost,
        threaded: variables.discussionType !== 'not_threaded',
        attachments: file ? [file] : [],
        position: null,
        message: String(variables.message ?? ''),
        entries: [],
      };
      topics.push(t);
      return { data: { createDiscussionTopic: { discussionTopic: { _id: t.id }, errors: null } } };
    }
    default:
      return null;
  }
}

let nextTopicId = 8900;

export const routes = [
  {
    // Internal: routes/graphql.mjs forwards discussion operations here. Answers null for others.
    method: 'POST',
    path: '/fake/graphql/discussions',
    handler: async ({ body, req }) => (await resolveGraphql(body ?? {}, req)) ?? { status: 404, body: null },
  },
  {
    // GET /api/v1/announcements: context_codes[], start_date, end_date.
    path: '/api/v1/announcements',
    handler: ({ query, url }) => {
      const codes = new Set(query.context_codes ?? []);
      const start = query.start_date ? new Date(query.start_date) : new Date(Date.now() - 14 * 86_400_000);
      const end = query.end_date ? new Date(query.end_date) : new Date(8.64e15);
      const items = topics
        .filter((t) => t.announcement && codes.has(contextCodeOf(t)))
        .filter((t) => new Date(t.posted) >= start && new Date(t.posted) <= end)
        .sort((a, b) => b.posted.localeCompare(a.posted))
        .map((t) => topicJson(t, { contextCode: true }));
      return paginate(items, query, url);
    },
  },
];

/** Topic routes for a course or a group: Canvas serves both from the same controller. */
function topicRoutes(type) {
  const prefix = `/api/v1/${type}/:contextId`;
  return [
    {
      // only_announcements=true lists a course's announcements; otherwise its discussions.
      path: `${prefix}/discussion_topics`,
      handler: ({ params, query, url }) => {
        if (type === 'courses' ? !courseById(params.contextId) : !groupCourse[params.contextId]) return notFound();
        const announcements = query.only_announcements === 'true' || query.only_announcements === '1';
        let list = topics.filter(
          (t) =>
            (type === 'courses' ? t.course === params.contextId : t.group === params.contextId) &&
            !!t.announcement === announcements,
        );
        list = announcements ? list.sort((a, b) => b.posted.localeCompare(a.posted)) : sortTopics(list);
        if (query.scope === 'pinned') list = list.filter((t) => t.pinned);
        if (query.scope === 'locked') list = list.filter((t) => t.locked);
        return paginate(
          list.map((t) => topicJson(t)),
          query,
          url,
        );
      },
    },
    {
      path: `${prefix}/discussion_topics/:topicId`,
      handler: ({ params }) => {
        const t = findTopic(params.contextId, params.topicId, type);
        return t && !hiddenFromRest(t) ? topicJson(t) : notFound();
      },
    },
    {
      path: `${prefix}/discussion_topics/:topicId/view`,
      handler: ({ params }) => {
        const t = findTopic(params.contextId, params.topicId, type);
        if (!t || hiddenFromRest(t)) return notFound();
        if (!canSeePosts(t)) return { status: 403, body: JSON.stringify('require_initial_post') };
        const entries = allEntries(t);
        const participantIds = [...new Set(entries.filter((e) => !e.deleted).map((e) => e.user_id))];
        return {
          unread_entries: entries.filter((e) => e.unread && !e.deleted).map((e) => e.id),
          forced_entries: [],
          entry_ratings: Object.fromEntries(entries.filter((e) => ratings.has(e.id)).map((e) => [e.id, 1])),
          participants: participantIds.map(displayUser),
          view: t.entries.map(viewEntry),
          new_entries: [],
        };
      },
    },
    {
      method: 'PUT',
      path: `${prefix}/discussion_topics/:topicId/read`,
      handler: ({ params }) => {
        const t = findTopic(params.contextId, params.topicId, type);
        if (!t) return notFound();
        t.unread = false;
        return { status: 204, body: '' };
      },
    },
    {
      method: 'DELETE',
      path: `${prefix}/discussion_topics/:topicId/read`,
      handler: ({ params }) => {
        const t = findTopic(params.contextId, params.topicId, type);
        if (!t) return notFound();
        t.unread = true;
        return { status: 204, body: '' };
      },
    },
    {
      method: 'PUT',
      path: `${prefix}/discussion_topics/:topicId/read_all`,
      handler: ({ params }) => {
        const t = findTopic(params.contextId, params.topicId, type);
        if (!t) return notFound();
        t.unread = false;
        walk(t.entries, (e) => (e.unread = false));
        return { status: 204, body: '' };
      },
    },
    {
      method: 'PUT',
      path: `${prefix}/discussion_topics/:topicId/entries/:entryId/read`,
      handler: ({ params }) => {
        const t = findTopic(params.contextId, params.topicId, type);
        const e = t && findEntry(t, params.entryId);
        if (!e) return notFound();
        e.unread = false;
        return { status: 204, body: '' };
      },
    },
    {
      method: 'DELETE',
      path: `${prefix}/discussion_topics/:topicId/entries/:entryId/read`,
      handler: ({ params }) => {
        const t = findTopic(params.contextId, params.topicId, type);
        const e = t && findEntry(t, params.entryId);
        if (!e) return notFound();
        e.unread = true;
        return { status: 204, body: '' };
      },
    },
    {
      method: 'POST',
      path: `${prefix}/discussion_topics/:topicId/entries/:entryId/rating`,
      handler: ({ params, body }) => {
        const t = findTopic(params.contextId, params.topicId, type);
        const e = t && findEntry(t, params.entryId);
        if (!e) return notFound();
        if (!t.allowRating) return { status: 401, body: { status: 'unauthorized' } };
        const rating = Number(body?.rating ?? 0);
        if (rating !== 0 && rating !== 1) return { status: 400, body: { message: 'Invalid rating given' } };
        const had = ratings.has(e.id);
        if (rating === 1 && !had) {
          ratings.set(e.id, 1);
          e.rating_sum = (e.rating_sum ?? 0) + 1;
        } else if (rating === 0 && had) {
          ratings.delete(e.id);
          e.rating_sum = Math.max(0, (e.rating_sum ?? 1) - 1);
        }
        return { status: 204, body: '' };
      },
    },
    {
      method: 'POST',
      path: `${prefix}/discussion_topics/:topicId/entries`,
      handler: ({ params, body }) => {
        const t = findTopic(params.contextId, params.topicId, type);
        if (!t) return notFound();
        const message = messageOf(body);
        if (!message.trim()) return { status: 400, body: { errors: { message: 'Message can’t be blank' } } };
        const e = entry(user.id, message, new Date().toISOString(), [], { parent_id: null });
        t.entries.push(e);
        return { status: 201, body: entryJson(e) };
      },
    },
    {
      method: 'POST',
      path: `${prefix}/discussion_topics/:topicId/entries/:entryId/replies`,
      handler: ({ params, body }) => {
        const t = findTopic(params.contextId, params.topicId, type);
        const parent = t && findEntry(t, params.entryId);
        if (!parent) return notFound();
        if (!canSeePosts(t)) return { status: 403, body: JSON.stringify('require_initial_post') };
        const message = messageOf(body);
        if (!message.trim()) return { status: 400, body: { errors: { message: 'Message can’t be blank' } } };
        const e = entry(user.id, message, new Date().toISOString(), [], { parent_id: parent.id });
        parent.replies.push(e);
        return { status: 201, body: entryJson(e) };
      },
    },
    {
      method: 'PUT',
      path: `${prefix}/discussion_topics/:topicId/entries/:entryId`,
      handler: ({ params, body }) => {
        const t = findTopic(params.contextId, params.topicId, type);
        const e = t && findEntry(t, params.entryId);
        if (!e || e.deleted) return notFound();
        if (!canManage(t, e)) return { status: 401, body: { status: 'unauthorized' } };
        e.message = messageOf(body);
        e.updated = new Date().toISOString();
        e.editor_id = user.id;
        // discussion_entries_controller.rb#update clears the attachment unless the edit re-sends it.
        if (!body?.attachment) delete e.attachment;
        return entryJson(e);
      },
    },
    {
      method: 'DELETE',
      path: `${prefix}/discussion_topics/:topicId/entries/:entryId`,
      handler: ({ params }) => {
        const t = findTopic(params.contextId, params.topicId, type);
        const e = t && findEntry(t, params.entryId);
        if (!e || e.deleted) return notFound();
        if (!canManage(t, e)) return { status: 401, body: { status: 'unauthorized' } };
        e.deleted = true;
        e.message = null;
        e.updated = new Date().toISOString();
        return { status: 204, body: '' };
      },
    },
  ];
}

/** Course settings and rights students can read (courses_controller.rb#api_settings, #permissions). */
const settingsRoutes = [
  {
    path: '/api/v1/courses/:courseId/settings',
    handler: ({ params }) => {
      if (!courseById(params.courseId)) return notFound();
      const s = settingsFor(params.courseId);
      return {
        allow_student_discussion_topics: s.allowStudentDiscussionTopics,
        allow_student_forum_attachments: s.allowStudentForumAttachments,
        allow_student_discussion_editing: s.allowStudentDiscussionEditing,
        allow_student_discussion_reporting: true,
        allow_student_anonymous_discussion_topics: false,
        lock_all_announcements: s.lockAllAnnouncements,
        restrict_student_past_view: false,
        restrict_student_future_view: false,
        show_announcements_on_home_page: false,
        home_page_announcement_limit: 3,
        hide_final_grades: false,
        hide_distribution_graphs: false,
        usage_rights_required: false,
        grading_standard_enabled: false,
        grading_standard_id: null,
      };
    },
  },
  {
    // rights_status for the asked-for rights. Students have create_forum and post_to_forum.
    path: '/api/v1/courses/:courseId/permissions',
    handler: ({ params, query }) => {
      if (!courseById(params.courseId)) return notFound();
      const granted = new Set(['read', 'read_forum', 'post_to_forum', 'create_forum', 'read_roster']);
      return Object.fromEntries([].concat(query.permissions ?? []).map((p) => [p, granted.has(p)]));
    },
  },
];

routes.push(...topicRoutes('courses'), ...topicRoutes('groups'), ...settingsRoutes);
