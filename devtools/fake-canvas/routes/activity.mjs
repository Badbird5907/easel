/**
 * Activity stream (owned by the Announcements, activity, and inbox workstream).
 *
 * Shapes: lib/api/v1/stream_item.rb. IDs point at fixtures in discussions.mjs,
 * conversations.mjs, and data.mjs so every row opens something real. Hidden
 * items live in module scope and reset when this file reloads.
 */
import { at, BASE } from '../data.mjs';
import { paginate } from './core.mjs';

const course = (id) => ({ context_type: 'Course', course_id: id });

const items = [
  {
    id: '90001',
    type: 'Conversation',
    title: 'Study group for Quiz 3',
    message: null,
    created_at: at(-1, 19, 30),
    updated_at: at(0, 11, 40),
    read_state: false,
    ...course('241'),
    conversation_id: '4003',
    private: false,
    participant_count: 4,
    html_url: `${BASE}/conversations/4003`,
    latest_messages: [
      {
        id: '46010',
        created_at: at(0, 11, 40),
        body: 'Grainger 2nd floor has open tables after 6. I’ll grab one.',
        author_id: '1103',
      },
    ],
  },
  {
    id: '90002',
    type: 'Announcement',
    title: 'MP3 autograder is live',
    message:
      '<p>You can now submit <strong>MP3</strong> for feedback. The final run happens Friday night, so push early.</p>',
    created_at: at(0, -2 + new Date().getHours()),
    updated_at: at(0, -2 + new Date().getHours()),
    read_state: false,
    ...course('225'),
    announcement_id: '7001',
    html_url: `${BASE}/courses/225/announcements/7001`,
    total_root_discussion_entries: 0,
    require_initial_post: false,
    user_has_posted: false,
    root_discussion_entries: [],
  },
  {
    id: '90003',
    type: 'DiscussionTopic',
    title: 'MP3 questions',
    message: '<p>Ask MP3 questions here. Don’t post code from your solution.</p>',
    created_at: at(-6, 10),
    updated_at: at(0, 9),
    read_state: false,
    ...course('225'),
    discussion_topic_id: '8201',
    html_url: `${BASE}/courses/225/discussion_topics/8201`,
    total_root_discussion_entries: 2,
    require_initial_post: false,
    user_has_posted: false,
    root_discussion_entries: [
      {
        user: { user_id: '1102', user_name: 'Jordan Lee' },
        message: '<p>Is the autograder using the same seed as the provided tests?</p>',
      },
    ],
  },
  {
    id: '90004',
    type: 'Conversation',
    title: 'MP3 extension request',
    message: null,
    created_at: at(-2, 9, 5),
    updated_at: at(-1, 16, 20),
    read_state: false,
    ...course('225'),
    conversation_id: '4001',
    private: true,
    participant_count: 2,
    html_url: `${BASE}/conversations/4001`,
  },
  {
    id: '90005',
    type: 'Submission',
    title: 'Quiz 4: Membrane Transport',
    message: null,
    created_at: at(-3, 15),
    updated_at: at(-3, 15),
    read_state: false,
    ...course('201'),
    submission_id: '77008',
    assignment_id: '9008',
    user_id: '1001',
    grade: '23',
    score: 23,
    submitted_at: at(-4, 9, 40),
    workflow_state: 'graded',
    html_url: `${BASE}/courses/201/assignments/9008/submissions/1001`,
    assignment: {
      id: '9008',
      name: 'Quiz 4: Membrane Transport',
      title: 'Quiz 4: Membrane Transport',
      points_possible: 25,
    },
    submission_comments: [],
  },
  {
    id: '90006',
    type: 'Message',
    title: 'Assignment Created: MP3: Hash Tables, CS 225',
    message:
      'A new assignment has been created for your course, CS 225: MP3: Hash Tables. Due in 3 days at 11:59 PM.',
    created_at: at(-3, 8),
    updated_at: at(-3, 8),
    read_state: true,
    ...course('225'),
    message_id: '88001',
    notification_category: 'Due Date',
    html_url: `${BASE}/courses/225/assignments/9005`,
    url: `${BASE}/courses/225/assignments/9005`,
  },
  {
    id: '90007',
    type: 'Submission',
    title: 'Essay Draft 2',
    message: null,
    created_at: at(-1, 14),
    updated_at: at(-1, 14),
    read_state: true,
    ...course('110'),
    submission_id: '77007',
    assignment_id: '9007',
    user_id: '1001',
    grade: null,
    score: null,
    submitted_at: at(-2, 22),
    workflow_state: 'submitted',
    html_url: `${BASE}/courses/110/assignments/9007/submissions/1001`,
    assignment: { id: '9007', name: 'Essay Draft 2', title: 'Essay Draft 2', points_possible: 40 },
    submission_comments: [
      {
        id: '66001',
        author_id: '2003',
        author_name: 'Dr. Hannah Kim',
        comment: 'Strong thesis. Your second body paragraph needs a source.',
        body: 'Strong thesis. Your second body paragraph needs a source.',
        created_at: at(-1, 14),
      },
    ],
  },
  {
    id: '90008',
    type: 'Announcement',
    title: 'Lab section moved to Room 214',
    message: '<p>Thursday’s lab meets in Room 214 while the main lab is being renovated.</p>',
    created_at: at(-1, 15),
    updated_at: at(-1, 15),
    read_state: true,
    ...course('201'),
    announcement_id: '7002',
    html_url: `${BASE}/courses/201/announcements/7002`,
    total_root_discussion_entries: 0,
    require_initial_post: false,
    user_has_posted: false,
    root_discussion_entries: [],
  },
  {
    id: '90009',
    type: 'DiscussionTopic',
    title: 'Reading Response 5',
    message: '<p>In 300 words, respond to the Hobsbawm reading.</p>',
    created_at: at(-8, 9),
    updated_at: at(-2, 18),
    read_state: true,
    ...course('150'),
    discussion_topic_id: '9002',
    html_url: `${BASE}/courses/150/discussion_topics/9002`,
    total_root_discussion_entries: 2,
    require_initial_post: true,
    user_has_posted: false,
    root_discussion_entries: [],
  },
  {
    id: '90010',
    type: 'WebConference',
    title: 'Office hours',
    message: 'Drop in with MP3 questions.',
    created_at: at(-4, 16),
    updated_at: at(-4, 16),
    read_state: true,
    ...course('225'),
    web_conference_id: '33001',
    html_url: `${BASE}/courses/225/conferences/33001`,
  },
  {
    // A mention in a reply. Canvas sends these as DiscussionEntry items with no URL or topic ID.
    id: '90011',
    type: 'DiscussionEntry',
    title: null,
    message: '<p>@Evan you argued this in lab. Want to jump in?</p>',
    author_name: 'Ava Thompson',
    created_at: at(0, 7),
    updated_at: at(0, 7),
    read_state: false,
    ...course('201'),
  },
  {
    id: '90012',
    type: 'AssessmentRequest',
    title: 'Peer Review for Essay Draft 2',
    message: null,
    created_at: at(-1, 9),
    updated_at: at(-1, 9),
    read_state: false,
    ...course('110'),
    assessment_request_id: '55001',
    html_url: `${BASE}/courses/110/assignments/9007/submissions/1106`,
  },
  {
    id: '90013',
    type: 'Collaboration',
    title: 'Lab 5 shared data sheet',
    message: 'A shared sheet for everyone’s osmosis measurements.',
    created_at: at(-6, 13),
    updated_at: at(-6, 13),
    read_state: true,
    ...course('201'),
    collaboration_id: '44001',
    html_url: `${BASE}/courses/201/collaborations/44001`,
  },
];

/**
 * Recent grades (GRADE-7): `GET /api/v1/users/:id/graded_submissions`, newest
 * first (users_controller.rb#user_graded_submissions). IDs and scores match the
 * assignments in course-content.mjs. Quiz 4 (9008) is also in the stream above.
 */
const graded = [
  { id: '77101', assignment: '9101', course: '201', name: 'Lab Report: Diffusion', score: 46, grade: '46', points: 50, at: at(-8, 14) },
  { id: '77112', assignment: '9112', course: '225', name: 'MP2: Linked Lists', score: 92, grade: '92', points: 100, at: at(-6, 9) },
  { id: '77106', assignment: '9106', course: '241', name: 'Problem Set 6: Partial Derivatives', score: 18, grade: '18', points: 20, at: at(-5, 10) },
  { id: '77008', assignment: '9008', course: '201', name: 'Quiz 4: Membrane Transport', score: 23, grade: '23', points: 25, at: at(-3, 15) },
  { id: '77060', assignment: '9060', course: '150', name: 'Map quiz', score: 9, grade: '9', points: 10, at: at(-40, 9) },
];

function gradedJson(g, includes) {
  const json = {
    id: g.id,
    assignment_id: g.assignment,
    user_id: '1001',
    attempt: 1,
    score: g.score,
    grade: g.grade,
    entered_score: g.score,
    entered_grade: g.grade,
    excused: false,
    late: false,
    missing: false,
    workflow_state: 'graded',
    grade_matches_current_submission: true,
    graded_at: g.at,
    posted_at: g.at,
    submitted_at: g.at,
    html_url: `${BASE}/courses/${g.course}/assignments/${g.assignment}/submissions/1001`,
    preview_url: `${BASE}/courses/${g.course}/assignments/${g.assignment}/submissions/1001?preview=1`,
  };
  if (includes.has('assignment'))
    json.assignment = {
      id: g.assignment,
      name: g.name,
      course_id: g.course,
      points_possible: g.points,
      grading_type: 'points',
      html_url: `${BASE}/courses/${g.course}/assignments/${g.assignment}`,
    };
  if (includes.has('course')) json.course = { id: g.course, restrict_quantitative_data: false };
  return json;
}

const hidden = new Set();

export const routes = [
  {
    path: '/api/v1/users/:userId/graded_submissions',
    handler: ({ params, query, url }) => {
      if (params.userId !== 'self' && params.userId !== '1001')
        return { status: 401, body: { status: 'unauthorized' } };
      const includes = new Set(query.include ?? []);
      return paginate(
        [...graded].sort((a, b) => b.at.localeCompare(a.at)).map((g) => gradedJson(g, includes)),
        query,
        url,
      );
    },
  },
  {
    // GET /api/v1/users/self/activity_stream (and the course-scoped variant).
    path: '/api/v1/users/self/activity_stream',
    handler: ({ query, url }) =>
      paginate(
        items.filter((i) => !hidden.has(i.id)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        query,
        url,
      ),
  },
  {
    path: '/api/v1/users/self/activity_stream/summary',
    handler: () => {
      const counts = new Map();
      for (const i of items.filter((x) => !hidden.has(x.id))) {
        const row = counts.get(i.type) ?? { type: i.type, unread_count: 0, count: 0 };
        row.count += 1;
        if (!i.read_state) row.unread_count += 1;
        counts.set(i.type, row);
      }
      return [...counts.values()];
    },
  },
  {
    method: 'DELETE',
    path: '/api/v1/users/self/activity_stream/:id',
    handler: ({ params }) => {
      hidden.add(params.id);
      return {};
    },
  },
];
