/**
 * Course content (owned by the Course content workstream): tabs, assignments and
 * submissions, grading periods, modules and module progress, pages, people. Quizzes and
 * their routes live in quizzes.mjs; external tool launches in lti.mjs.
 *
 * Shapes follow canvas-lms: lib/api/v1/tab.rb, assignment.rb, assignment_group.rb,
 * submission.rb, submission_comment.rb, context_module.rb, wiki_page.rb,
 * app/serializers/quizzes/quiz_serializer.rb, lib/api/v1/quiz_submission.rb, user.rb.
 *
 * IDs line up with data.mjs `work` (9001 to 9008) so planner links resolve, and
 * attachments reuse files.mjs IDs (6001, 6004, 6006, 6013, 6030, 6032).
 *
 * Cases worth knowing:
 *   course 201 tabs     Quizzes is hidden; "Panopto Recordings" is an external tool
 *   course 110 tabs     Files is hidden; Collaborations opens on the web
 *   course 201 modules  Week 1 complete, Week 2 open (mark done, view, submit,
 *                       contribute), Week 3 locked behind Week 2 with sequential progress
 *   assignment 9102     locked until next week (lock_explanation)
 *   assignment 9101     two attempts, file upload, rubric assessment, comments (one is an
 *                       audio media comment), attempt 2's PDF has instructor annotations (preview_url)
 *   assignment 9007     text entry, resubmitted, waiting for a grade
 *   assignment 9112     website URL submission, graded
 *   assignment 9003     file upload limited to PDF and Word, two attempts allowed
 *   assignment 9117     file upload with any file type
 *   assignment 9115     text entry only, unlimited attempts
 *   assignment 9116     text entry, file upload, or website URL
 *   assignment 9005     website URL, unlimited attempts
 *   assignment 9113     external tool (can_submit false; launches the tool)
 *   assignment 9118     media recording (submit in the browser)
 *   assignment 9119     student annotation of file 6003 (submit in the browser)
 *   assignment 9120     past due and missing, still open
 *   assignment 9121     one attempt allowed and used (attempts exhausted)
 *   assignment 9122     closed: lock_at passed, nothing submitted
 *   assignment 9123     ENGL 110 (restricted quantitative data): letter grade, rubric, comment
 *   course 110          restricts quantitative data, so its assignments send
 *                       restrict_quantitative_data: true (the course flag lives in grades.mjs)
 *   assignment 9130     New Quizzes (external tool, is_quiz_lti_assignment), module 711 item 7113
 *   page lecture-6-media-and-tools  embedded Panopto and Studio tools, Canvas media,
 *                       YouTube, Vimeo, and math (module 702 item 7207)
 *   course 201          has grading periods; the others don't
 *   course 101          no modules and no pages (empty states)
 *   default views       201/225 modules, 241 assignments, 110 front page, 150 syllabus, 101 activity
 *   course 241 module 714  mastery paths: the graded pre-check (9147) offers path A (9148, 9149)
 *                       or path B (9150); `POST /fake/mastery/reset` forgets the choice
 * Module progress (mark done, mark read) lives in memory and resets when this file reloads.
 * Submissions and comments made through submissions.mjs live on globalThis
 * (`__easelFakeSubmissions`), so they survive reloads until the server restarts.
 */
import { at, BASE, courseById, NOW, user } from '../data.mjs';
import { paginate } from './core.mjs';

// core.mjs serves `default_view` from the shared course records, which data.mjs leaves
// unset. Set one per course here so the course home's Home row covers every kind.
const defaultViews = {
  201: 'modules',
  241: 'assignments',
  110: 'wiki',
  150: 'syllabus',
  225: 'modules',
  101: 'feed',
};
for (const [id, view] of Object.entries(defaultViews)) {
  const course = courseById(id);
  if (course) course.defaultView = view;
}

const notFound = () => ({
  status: 404,
  body: { errors: [{ message: 'The specified resource does not exist.' }] },
});

const canvasDateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
/** Canvas's `datetime_string`, e.g. "Nov 5 at 12:00 AM". */
const canvasDate = (iso) => canvasDateFormat.format(new Date(iso)).replace(', ', ' at ');
const isFuture = (iso) => !!iso && new Date(iso) > NOW;
const isPast = (iso) => !!iso && new Date(iso) < NOW;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const classmates = [
  ['2001', 'Maya Chen', 'Chen, Maya', 'she/her'],
  ['2002', 'Jordan Alvarez', 'Alvarez, Jordan', null],
  ['2003', 'Sam Okafor', 'Okafor, Sam', 'they/them'],
  ['2004', 'Priya Shah', 'Shah, Priya', null],
  ['2005', 'Liam O’Connor', 'O’Connor, Liam', 'he/him'],
  ['2006', 'Ava Rossi', 'Rossi, Ava', null],
];

const tas = {
  201: ['3201', 'Noah Fischer', 'Fischer, Noah'],
  241: ['3241', 'Elena Petrova', 'Petrova, Elena'],
  225: ['3225', 'Marcus Lee', 'Lee, Marcus'],
};

function sortable(name) {
  const parts = name.replace(/^(Dr\.|Prof\.)\s+/, '').split(' ');
  return parts.length > 1 ? `${parts.at(-1)}, ${parts.slice(0, -1).join(' ')}` : name;
}

function roster(courseId) {
  const c = courseById(courseId);
  const people = [
    { id: `t${courseId}`, name: c.teacher, sortable: sortable(c.teacher), type: 'TeacherEnrollment' },
  ];
  if (tas[courseId]) {
    const [id, name, sort] = tas[courseId];
    people.push({ id, name, sortable: sort, type: 'TaEnrollment' });
  }
  people.push({ id: user.id, name: user.name, sortable: user.sortable_name, type: 'StudentEnrollment' });
  const count = 3 + (Number(courseId) % 4);
  for (const [id, name, sort, pronouns] of classmates.slice(0, count)) {
    people.push({ id, name, sortable: sort, pronouns, type: 'StudentEnrollment' });
  }
  if (courseId === '101')
    people.push({ id: '4101', name: 'Rosa Bellini', sortable: 'Bellini, Rosa', type: 'ObserverEnrollment' });
  return people;
}

const personById = (courseId, id) => roster(courseId).find((p) => p.id === id);

function userJson(p, courseId, includes) {
  const json = {
    id: p.id,
    name: p.name,
    created_at: at(-400, 9),
    sortable_name: p.sortable,
    short_name: p.name.replace(/^(Dr\.|Prof\.)\s+/, '').split(' ')[0],
    pronouns: p.pronouns ?? null,
  };
  if (includes.has('avatar_url')) json.avatar_url = null;
  if (includes.has('enrollments'))
    json.enrollments = [
      {
        id: `e${courseId}${p.id}`,
        course_id: courseId,
        type: p.type,
        role: p.type,
        enrollment_state: 'active',
        user_id: p.id,
      },
    ];
  return json;
}

const authorJson = (p) => ({
  id: p.id,
  anonymous_id: p.id,
  display_name: p.name,
  avatar_image_url: null,
  html_url: `${BASE}/users/${p.id}`,
  pronouns: p.pronouns ?? null,
});

// ---------------------------------------------------------------------------
// Tabs (lib/api/v1/tab.rb)
// ---------------------------------------------------------------------------

const tabLabels = {
  home: 'Home',
  announcements: 'Announcements',
  assignments: 'Assignments',
  discussions: 'Discussions',
  grades: 'Grades',
  people: 'People',
  pages: 'Pages',
  files: 'Files',
  syllabus: 'Syllabus',
  outcomes: 'Outcomes',
  quizzes: 'Quizzes',
  modules: 'Modules',
  collaborations: 'Collaborations',
  conferences: 'BigBlueButton',
  search: 'Search',
};

const tabPaths = {
  home: '',
  announcements: '/announcements',
  assignments: '/assignments',
  discussions: '/discussion_topics',
  grades: '/grades',
  people: '/users',
  pages: '/wiki',
  files: '/files',
  syllabus: '/assignments/syllabus',
  outcomes: '/outcomes',
  quizzes: '/quizzes',
  modules: '/modules',
  collaborations: '/collaborations',
  conferences: '/conferences',
  search: '/search',
};

/** Canvas order per course. `{ id, hidden }` hides a tab; `{ tool, label }` is an external tool. */
const tabSpecs = {
  201: [
    'home',
    'announcements',
    'syllabus',
    'modules',
    'assignments',
    'discussions',
    'grades',
    'people',
    'pages',
    'files',
    'conferences',
    'search',
    'outcomes',
    { id: 'quizzes', hidden: true },
    { tool: '801', label: 'Panopto Recordings' },
  ],
  241: [
    'home',
    'announcements',
    'modules',
    'assignments',
    'quizzes',
    'grades',
    'syllabus',
    'files',
    'people',
    'outcomes',
    { tool: '802', label: 'Gradescope' },
  ],
  110: [
    'home',
    'announcements',
    'assignments',
    'discussions',
    'grades',
    'pages',
    'people',
    'collaborations',
    'outcomes',
    'syllabus',
    { id: 'files', hidden: true },
  ],
  150: [
    'home',
    'announcements',
    'syllabus',
    'modules',
    'assignments',
    'discussions',
    'grades',
    'people',
    'files',
  ],
  225: [
    'home',
    'announcements',
    'modules',
    'assignments',
    'discussions',
    'grades',
    'pages',
    'people',
    'syllabus',
    'outcomes',
    { tool: '803', label: 'PrairieLearn' },
  ],
  101: ['home', 'announcements', 'assignments', 'modules', 'pages', 'people', 'files'],
};

function tabsJson(courseId) {
  return (tabSpecs[courseId] ?? ['home', 'announcements', 'syllabus', 'modules', 'grades', 'people']).map((spec, index) => {
    const s = typeof spec === 'string' ? { id: spec } : spec;
    if (s.tool) {
      const path = `/courses/${courseId}/external_tools/${s.tool}`;
      return {
        id: `context_external_tool_${s.tool}`,
        html_url: path,
        full_url: `${BASE}${path}`,
        position: index + 1,
        visibility: 'public',
        label: s.label,
        type: 'external',
        url: `${BASE}/api/v1/courses/${courseId}/external_tools/sessionless_launch?id=${s.tool}&launch_type=course_navigation`,
      };
    }
    const path = `/courses/${courseId}${tabPaths[s.id]}`;
    return {
      id: s.id,
      html_url: path,
      full_url: `${BASE}${path}`,
      position: index + 1,
      ...(s.hidden && { hidden: true }),
      visibility: s.hidden ? 'admins' : 'public',
      label: tabLabels[s.id],
      type: 'internal',
    };
  });
}

// ---------------------------------------------------------------------------
// Assignment groups, grading periods, assignments, submissions
// ---------------------------------------------------------------------------

const groups = {
  201: [
    { id: '401', name: 'Lab reports', weight: 40 },
    { id: '402', name: 'Quizzes', weight: 30 },
    { id: '403', name: 'Participation', weight: 30 },
  ],
  241: [
    { id: '411', name: 'Problem sets', weight: 40 },
    { id: '412', name: 'Quizzes', weight: 20 },
    { id: '413', name: 'Exams', weight: 40 },
  ],
  110: [
    { id: '421', name: 'Essays', weight: 70 },
    { id: '422', name: 'Peer review', weight: 30 },
  ],
  150: [
    { id: '431', name: 'Reading responses', weight: 50 },
    { id: '432', name: 'Exams', weight: 50 },
  ],
  225: [
    { id: '441', name: 'Machine problems', weight: 60 },
    { id: '442', name: 'Labs', weight: 40 },
  ],
  101: [{ id: '451', name: 'Studio work', weight: 100 }],
};

const gradingPeriods = {
  201: [
    { id: '91', title: 'First half', start: at(-66, 0), end: at(-10, 23, 59), close: at(-3, 23, 59) },
    { id: '92', title: 'Second half', start: at(-10, 23, 59), end: at(50, 23, 59), close: at(57, 23, 59) },
  ],
};

const files = {
  6001: { name: 'Syllabus.pdf', type: 'application/pdf', size: 48213 },
  6004: { name: 'Osmosis lab photo.jpg', type: 'image/jpeg', size: 214877 },
  6006: { name: 'Lab data.csv', type: 'text/csv', size: 1204 },
  6013: {
    name: 'Essay 2 guidelines.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 18542,
  },
  6030: {
    name: 'Essay 1 final.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 18542,
  },
  6032: { name: 'Lab report 2.pdf', type: 'application/pdf', size: 48213 },
};

/**
 * What students turn in and comment through the app (submissions.mjs). Shared on
 * globalThis because route files reload as separate module instances.
 *   attempts[assignmentId]  attempts after the fixture's, in fixture shape
 *   comments[assignmentId]  comments after the fixture's, plus `files` and `media`
 *   files                   fileId -> { id, name, type, bytes, created } uploaded via preflight
 */
const store = (globalThis.__easelFakeSubmissions ??= {
  attempts: {},
  comments: {},
  files: new Map(),
  uploads: new Map(),
  resubmitted: {},
  nextId: 8000,
});

const mimeClass = (type) =>
  type === 'application/pdf'
    ? 'pdf'
    : /wordprocessingml|msword/.test(type)
      ? 'doc'
      : ['image', 'video', 'audio', 'text'].includes(type.split('/')[0])
        ? type.split('/')[0]
        : 'file';

/**
 * Attachment JSON (lib/api/v1/attachment.rb), enough for submission rows. files.mjs serves
 * the fixture files' details; files uploaded through submissions.mjs download from its storage.
 * `annotated` gives the attachment a DocViewer `preview_url` showing instructor annotations,
 * the way Canvas does for canvadocable submission attachments.
 */
function attachmentJson(id, { annotated = false } = {}) {
  const f = files[id];
  if (!f) {
    const up = store.files.get(String(id));
    if (!up) return null;
    const download = `${BASE}/fake/submission-files/${up.id}/${encodeURIComponent(up.name)}?sig=fakeuuid${up.id}`;
    return {
      id: up.id,
      uuid: `fakeuuid${up.id}`,
      folder_id: '603',
      display_name: up.name,
      filename: up.name.replace(/\s+/g, '+'),
      upload_status: 'success',
      'content-type': up.type,
      url: download,
      size: up.bytes.length,
      created_at: up.created,
      updated_at: up.created,
      unlock_at: null,
      locked: false,
      hidden: false,
      lock_at: null,
      hidden_for_user: false,
      thumbnail_url: up.type.startsWith('image/') ? `${download}&thumbnail=1` : null,
      modified_at: up.created,
      mime_class: mimeClass(up.type),
      media_entry_id: null,
      category: 'uncategorized',
      locked_for_user: false,
      preview_url: annotated ? `${BASE}/fake/annotated/${up.id}` : null,
    };
  }
  return {
    id,
    uuid: `fakeuuid${id}`,
    display_name: f.name,
    filename: f.name.replace(/\s+/g, '+'),
    'content-type': f.type,
    url: `${BASE}/files/${id}/download?download_frd=1&verifier=fakeuuid${id}`,
    size: f.size,
    created_at: at(-11, 23),
    updated_at: at(-11, 23),
    modified_at: at(-11, 23),
    locked: false,
    hidden: false,
    locked_for_user: false,
    thumbnail_url: f.type.startsWith('image/') ? `${BASE}/images/thumbnails/${id}/fakeuuid${id}` : null,
    preview_url: annotated ? `${BASE}/fake/annotated/${id}` : null,
    mime_class: mimeClass(f.type),
  };
}

/**
 * lib/api.rb `media_comment_json`. Canvas serves the bytes through `media_download`; recordings
 * uploaded through the fake Kaltura (submissions.mjs) play from its media storage instead.
 */
const mediaCommentJson = (m) => ({
  'content-type': `${m.type}/mp4`,
  display_name: m.title ?? null,
  media_id: m.id,
  media_type: m.type,
  url: store.kaltura?.entries?.has(m.id)
    ? `${BASE}/fake/kaltura-media/${encodeURIComponent(m.id)}`
    : `${BASE}/users/${user.id}/media_download?entryId=${encodeURIComponent(m.id)}&type=mp4&redirect=1`,
});

const rubrics = {
  lab: [
    {
      id: '_lab1',
      description: 'Hypothesis and method',
      long_description: 'States a testable hypothesis and describes the procedure clearly enough to repeat.',
      points: 15,
      ratings: [
        { id: 'lab1a', description: 'Complete', points: 15 },
        { id: 'lab1b', description: 'Partly there', points: 9 },
        { id: 'lab1c', description: 'Missing', points: 0 },
      ],
    },
    {
      id: '_lab2',
      description: 'Data and figures',
      long_description: 'Tables and graphs are labeled, with units and error bars.',
      points: 20,
      ratings: [
        { id: 'lab2a', description: 'Clear and complete', points: 20 },
        { id: 'lab2b', description: 'Minor gaps', points: 14 },
        { id: 'lab2c', description: 'Hard to read', points: 6 },
      ],
    },
    {
      id: '_lab3',
      description: 'Discussion',
      long_description: 'Explains the results using membrane transport concepts and names sources of error.',
      points: 15,
      ratings: [
        { id: 'lab3a', description: 'Insightful', points: 15 },
        { id: 'lab3b', description: 'Adequate', points: 10 },
        { id: 'lab3c', description: 'Thin', points: 4 },
      ],
    },
  ],
  essay: [
    {
      id: '_es1',
      description: 'Thesis',
      long_description: 'An arguable claim that the essay supports throughout.',
      points: 15,
      ratings: [
        { id: 'es1a', description: 'Strong', points: 15 },
        { id: 'es1b', description: 'Developing', points: 10 },
        { id: 'es1c', description: 'Unclear', points: 5 },
      ],
    },
    {
      id: '_es2',
      description: 'Evidence',
      points: 15,
      ratings: [
        { id: 'es2a', description: 'Well chosen', points: 15 },
        { id: 'es2b', description: 'Some support', points: 10 },
        { id: 'es2c', description: 'Little support', points: 5 },
      ],
    },
    {
      id: '_es3',
      description: 'Style and mechanics',
      points: 10,
      ratings: [
        { id: 'es3a', description: 'Polished', points: 10 },
        { id: 'es3b', description: 'A few errors', points: 7 },
        { id: 'es3c', description: 'Distracting errors', points: 3 },
      ],
    },
  ],
  bibliography: [
    {
      id: '_bib1',
      description: 'Source quality',
      long_description: 'Scholarly, current sources that speak directly to the research question.',
      points: 20,
      ratings: [
        { id: 'bib1a', description: 'Excellent', points: 20 },
        { id: 'bib1b', description: 'Good', points: 15 },
        { id: 'bib1c', description: 'Needs work', points: 8 },
      ],
    },
    {
      id: '_bib2',
      description: 'Annotations',
      long_description: 'Each entry summarizes the source and says how it will be used.',
      points: 20,
      ratings: [
        { id: 'bib2a', description: 'Excellent', points: 20 },
        { id: 'bib2b', description: 'Good', points: 15 },
        { id: 'bib2c', description: 'Needs work', points: 8 },
      ],
    },
    {
      id: '_bib3',
      description: 'MLA format',
      points: 10,
      ratings: [
        { id: 'bib3a', description: 'Correct', points: 10 },
        { id: 'bib3b', description: 'Minor errors', points: 7 },
        { id: 'bib3c', description: 'Many errors', points: 3 },
      ],
    },
  ],
};

rubrics.design = [
  {
    id: '_des1',
    description: 'Data structure choice',
    long_description: 'Names the structures and explains why they fit the access pattern.',
    points: 10,
    ratings: [
      { id: 'des1a', description: 'Clear and justified', points: 10 },
      { id: 'des1b', description: 'Named, not justified', points: 6 },
      { id: 'des1c', description: 'Missing', points: 0 },
    ],
  },
  {
    id: '_des2',
    description: 'Complexity',
    long_description: 'States the time and space cost of the main operations.',
    points: 10,
    ratings: [
      { id: 'des2a', description: 'Correct for every operation', points: 10 },
      { id: 'des2b', description: 'Some operations', points: 5 },
      { id: 'des2c', description: 'None', points: 0 },
    ],
  },
  {
    id: '_des3',
    description: 'Clarity',
    points: 10,
    ratings: [
      { id: 'des3a', description: 'Easy to follow', points: 10 },
      { id: 'des3b', description: 'Mostly clear', points: 7 },
      { id: 'des3c', description: 'Hard to follow', points: 3 },
    ],
  },
];

const rubricTitles = {
  lab: 'Lab report rubric',
  essay: 'Essay rubric',
  bibliography: 'Annotated bibliography rubric',
  design: 'Design doc rubric',
};

const teacherOf = (courseId) => ({ id: `t${courseId}`, name: courseById(courseId).teacher });

/**
 * `sub.attempts` are the student's attempts, oldest first. `score` grades the latest one.
 * Comments carry the attempt they were left on.
 */
const assignments = [
  // BIO 201
  {
    id: '9003',
    course: '201',
    group: '401',
    name: 'Lab Report: Osmosis',
    due: at(1, 9),
    unlock: at(-7, 0),
    lock: at(4, 23, 59),
    points: 50,
    types: ['online_upload'],
    extensions: ['pdf', 'docx'],
    attempts: 2,
    rubric: 'lab',
    description: `<p>Write up the potato-core osmosis lab using the <a href="/courses/201/pages/osmosis-lab-guide">lab guide</a>. Include your data table and one graph of mass change against sucrose concentration.</p>
<h3>Checklist</h3><ul><li>Hypothesis and method</li><li>Data table with units</li><li>Graph with error bars</li><li>Discussion of at least two sources of error</li></ul>
<p>Upload a PDF or Word document. You get two attempts; the second one counts.</p>`,
  },
  {
    id: '9101',
    course: '201',
    group: '401',
    name: 'Lab Report: Diffusion',
    due: at(-12, 9),
    points: 50,
    types: ['online_upload'],
    extensions: ['pdf', 'docx'],
    attempts: 2,
    rubric: 'lab',
    description:
      '<p>Report on the agar cube diffusion lab. Compare diffusion time across the three cube sizes and relate it to surface area to volume ratio.</p>',
    sub: {
      attempts: [
        { attempt: 1, submitted: at(-13, 22, 40), type: 'online_upload', files: ['6006'] },
        {
          attempt: 2,
          submitted: at(-12, 8, 15),
          type: 'online_upload',
          files: ['6032', '6004'],
          // The instructor marked up the PDF in DocViewer.
          annotated: ['6032'],
        },
      ],
      score: 46,
      grade: '46',
      graded: at(-8, 14),
      comments: [
        {
          id: 'c1',
          author: 'self',
          at: at(-13, 22, 45),
          attempt: 1,
          text: 'I uploaded only the data by mistake. The full report is coming in attempt 2.',
        },
        {
          id: 'c2',
          author: 'teacher',
          at: at(-8, 14, 5),
          attempt: 2,
          text: 'Clear figures. Your discussion would be stronger with a sentence on why the smallest cube equilibrated so quickly.',
        },
        {
          id: 'c7',
          author: 'teacher',
          at: at(-8, 14, 9),
          attempt: 2,
          text: 'I recorded a quick note on your discussion section.',
          // conversations.mjs serves media_download for m-fake<fileId> (6009 is an m4a).
          media: { id: 'm-fake6009', type: 'audio' },
        },
      ],
      rubric: {
        _lab1: { rating: 'lab1a', points: 15, comments: '' },
        _lab2: { rating: 'lab2a', points: 20, comments: 'Great error bars.' },
        _lab3: {
          rating: 'lab3b',
          points: 11,
          comments: 'Connect the result back to surface area to volume ratio.',
        },
      },
    },
  },
  {
    id: '9102',
    course: '201',
    group: '401',
    name: 'Lab Report: Photosynthesis',
    due: at(14, 9),
    unlock: at(7, 0),
    points: 50,
    types: ['online_upload'],
    extensions: ['pdf'],
    attempts: 1,
    rubric: 'lab',
    description: '<p>Measure oxygen production by <em>Elodea</em> under three light intensities.</p>',
  },
  {
    id: '9608',
    course: '201',
    group: '402',
    name: 'Quiz 4: Membrane Transport',
    due: at(-4, 10),
    points: 25,
    types: ['online_quiz'],
    quiz: '9008',
    description: '<p>Twelve questions on passive and active transport.</p>',
    sub: {
      attempts: [{ attempt: 1, submitted: at(-4, 9, 42), type: 'online_quiz' }],
      score: 22,
      grade: '22',
      graded: at(-4, 9, 42),
    },
  },
  {
    id: '9103',
    course: '201',
    group: '403',
    name: 'Lab partner check-in',
    due: at(2, 17),
    points: 5,
    types: ['discussion_topic'],
    topic: '9203',
    description: '<p>Post who your lab partner is and one thing you want to improve in the next lab.</p>',
  },
  {
    id: '9104',
    course: '201',
    group: '403',
    name: 'Lab safety sign-off',
    due: at(-50, 17),
    points: 5,
    types: ['on_paper'],
    description: '<p>Sign the lab safety form in your first lab section.</p>',
    sub: { score: 5, grade: '5', graded: at(-49, 10) },
  },
  {
    id: '9105',
    course: '201',
    group: '403',
    name: 'Field notebook check',
    points: 10,
    types: ['on_paper'],
    description: '<p>Bring your field notebook to any lab section before the end of the term.</p>',
  },
  {
    id: '9115',
    course: '201',
    group: '403',
    name: 'Lab safety reflection',
    due: at(3, 23, 59),
    points: 5,
    types: ['online_text_entry'],
    description:
      '<p>In a short paragraph, describe one hazard in the osmosis lab and how you controlled it. Type your answer in the text box.</p>',
  },
  {
    id: '9116',
    course: '201',
    group: '403',
    name: 'Field observation journal',
    due: at(5, 17),
    points: 10,
    types: ['online_text_entry', 'online_upload', 'online_url'],
    description:
      '<p>Record three observations of living cells from the campus pond samples. Type them, upload photos of your notebook, or link to a shared document.</p>',
  },
  {
    id: '9119',
    course: '201',
    group: '403',
    name: 'Annotate the cell diagram',
    due: at(8, 9),
    points: 10,
    types: ['student_annotation'],
    annotatable: '6003',
    description: '<p>Label the nucleus, mitochondria, and cell membrane directly on the diagram.</p>',
  },
  // MATH 241
  {
    id: '9001',
    course: '241',
    group: '411',
    name: 'Problem Set 7: Lagrange Multipliers',
    due: at(0, 23, 59),
    points: 20,
    types: ['online_upload'],
    extensions: ['pdf'],
    description:
      '<p>Problems 14.8: 3, 7, 11, 19, 24, 31. Show your work.</p><p>Find the extrema of \\(f(x,y) = x^2 + 2y^2\\) on the circle \\(x^2 + y^2 = 1\\).</p>',
  },
  {
    id: '9106',
    course: '241',
    group: '411',
    name: 'Problem Set 6: Partial Derivatives',
    due: at(-7, 23, 59),
    points: 20,
    types: ['online_text_entry', 'online_upload'],
    description: '<p>Problems 14.3: 5, 9, 15, 33 and 14.4: 1, 11.</p>',
    sub: {
      attempts: [
        {
          attempt: 1,
          submitted: at(-7, 21, 3),
          type: 'online_text_entry',
          body: '<p><strong>14.3 #5.</strong> f<sub>x</sub> = 2xy<sup>3</sup>, f<sub>y</sub> = 3x<sup>2</sup>y<sup>2</sup>.</p><p><strong>14.3 #9.</strong> f<sub>x</sub> = e<sup>y</sup>, f<sub>y</sub> = xe<sup>y</sup>.</p><p>The rest are in my notebook; I can bring them to office hours.</p>',
        },
      ],
      score: 18,
      grade: '18',
      graded: at(-5, 10),
      comments: [
        {
          id: 'c3',
          author: 'teacher',
          at: at(-5, 10, 2),
          attempt: 1,
          text: 'Good. Next time type up every problem; I can only grade what you submit.',
        },
      ],
    },
  },
  {
    id: '9108',
    course: '241',
    group: '411',
    name: 'Problem Set 8: Double Integrals',
    due: at(7, 23, 59),
    unlock: at(-1, 0),
    points: 20,
    types: ['online_upload'],
    extensions: ['pdf'],
    description: '<p>Problems 15.1: 9, 13, 21 and 15.2: 7, 19, 27.</p>',
  },
  {
    id: '9606',
    course: '241',
    group: '412',
    name: 'Quiz 3: Partial Derivatives',
    due: at(5, 10),
    points: 15,
    types: ['online_quiz'],
    quiz: '9006',
    description: '<p>Covers 14.3 to 14.5.</p>',
  },
  {
    id: '9107',
    course: '241',
    group: '413',
    name: 'Midterm 2',
    due: at(12, 9),
    points: 100,
    types: ['on_paper'],
    description: '<p>In class. Bring a pencil and one handwritten note sheet.</p>',
  },
  {
    id: '9120',
    course: '241',
    group: '411',
    name: 'Problem Set 5: Vectors and Planes',
    due: at(-4, 23, 59),
    points: 20,
    types: ['online_upload'],
    extensions: ['pdf'],
    description:
      '<p>Problems 12.4: 3, 17, 25 and 12.5: 9, 31. Late work is accepted with a 10% penalty per day.</p>',
  },
  {
    // New Quizzes: an external tool assignment launched with launch_type=assessment (lti.mjs).
    id: '9130',
    course: '241',
    group: '412',
    name: 'Unit 4 check-in',
    due: at(4, 10),
    points: 10,
    types: ['external_tool'],
    tool: 'https://quiz-lti-iad-prod.instructure.com/lti/launch',
    quizLti: true,
    description: '<p>Five questions on optimization. Opens in New Quizzes.</p>',
  },
  // ENGL 110
  {
    id: '9007',
    course: '110',
    group: '421',
    name: 'Essay Draft 2',
    due: at(-2, 23, 59),
    points: 40,
    types: ['online_text_entry'],
    rubric: 'essay',
    description: '<p>Revise your argument essay using your peer feedback. 1,200 to 1,500 words.</p>',
    sub: {
      attempts: [
        {
          attempt: 1,
          submitted: at(-4, 20, 11),
          type: 'online_text_entry',
          body: '<h2>The Case for Later School Start Times</h2><p>Teenagers are not lazy; they are biologically out of sync with a 7:30 AM bell. Districts that moved start times past 8:30 saw attendance and grades rise.</p>',
        },
        {
          attempt: 2,
          submitted: at(-2, 22, 48),
          type: 'online_text_entry',
          body: '<h2>The Case for Later School Start Times</h2><p>Teenagers are not lazy; they are biologically out of sync with a 7:30 AM bell. When Seattle moved high school start times to 8:45, students slept a median of 34 minutes more and their grades rose.</p><p>Critics point to bus costs and after-school jobs. Those costs are real, but they are smaller than the cost of a generation that learns while exhausted.</p>',
        },
      ],
      comments: [
        {
          id: 'c4',
          author: 'teacher',
          at: at(-3, 9),
          attempt: 1,
          text: 'Your thesis is clear. Add a specific study in paragraph two.',
        },
        {
          id: 'c5',
          author: 'self',
          at: at(-2, 22, 50),
          attempt: 2,
          text: 'Added the Seattle study and a counterargument paragraph.',
        },
      ],
    },
  },
  {
    id: '9109',
    course: '110',
    group: '421',
    name: 'Essay 1: Literacy Narrative',
    due: at(-30, 23, 59),
    points: 40,
    types: ['online_upload'],
    extensions: ['docx', 'pdf'],
    rubric: 'essay',
    description: '<p>Tell the story of how you learned to read, write, or speak in a way that mattered.</p>',
    sub: {
      attempts: [{ attempt: 1, submitted: at(-30, 22, 5), type: 'online_upload', files: ['6030'] }],
      score: 38,
      grade: '38',
      graded: at(-24, 15),
      rubric: {
        _es1: { rating: 'es1a', points: 15, comments: '' },
        _es2: { rating: 'es2a', points: 15, comments: '' },
        _es3: { rating: 'es3b', points: 8, comments: 'Watch comma splices in the last section.' },
      },
    },
  },
  {
    id: '9504',
    course: '110',
    group: '422',
    name: 'Peer Review: Essay 2',
    due: at(1, 17),
    points: 10,
    types: ['discussion_topic'],
    topic: '9004',
    description: '<p>Reply to two classmates’ drafts using the peer review form.</p>',
  },
  {
    id: '9117',
    course: '110',
    group: '421',
    name: 'Research poster draft',
    due: at(6, 23, 59),
    points: 20,
    types: ['online_upload'],
    description:
      '<p>Upload a draft of your research poster in any format: a PDF, slides, an image, or a design file.</p>',
  },
  {
    id: '9118',
    course: '110',
    group: '421',
    name: 'Elevator pitch recording',
    due: at(9, 17),
    points: 10,
    types: ['media_recording'],
    description: '<p>Record a 60-second pitch for your research project. Audio or video is fine.</p>',
  },
  {
    id: '9123',
    course: '110',
    group: '421',
    name: 'Annotated bibliography',
    due: at(-16, 23, 59),
    points: 50,
    gradingType: 'letter_grade',
    types: ['online_upload'],
    extensions: ['docx', 'pdf'],
    rubric: 'bibliography',
    description: '<p>Six sources for your research essay, each with a 150-word annotation, in MLA format.</p>',
    sub: {
      // 7990 is seeded into the shared upload store by submissions.mjs.
      attempts: [{ attempt: 1, submitted: at(-16, 21, 30), type: 'online_upload', files: ['7990'] }],
      score: 46,
      grade: 'A-',
      graded: at(-12, 10),
      comments: [
        {
          id: 'c8',
          author: 'teacher',
          at: at(-12, 10, 4),
          attempt: 1,
          text: 'Strong sources. Two annotations summarize without saying how you will use the source.',
        },
      ],
      rubric: {
        _bib1: { rating: 'bib1a', points: 20, comments: '' },
        _bib2: { rating: 'bib2b', points: 16, comments: 'Say how each source supports your argument.' },
        _bib3: { rating: 'bib3a', points: 10, comments: '' },
      },
    },
  },
  // HIST 150
  {
    id: '9502',
    course: '150',
    group: '431',
    name: 'Reading Response 5',
    due: at(-1, 17),
    points: 10,
    types: ['discussion_topic'],
    topic: '9002',
    description: '<p>Respond to Hobsbawm, chapter 3, in 300 words.</p>',
  },
  {
    id: '9110',
    course: '150',
    group: '431',
    name: 'Reading Response 4',
    due: at(-8, 17),
    points: 10,
    types: ['online_text_entry'],
    description: '<p>Respond to Hobsbawm, chapter 2, in 300 words.</p>',
    sub: {
      attempts: [
        {
          attempt: 1,
          submitted: at(-8, 16, 20),
          type: 'online_text_entry',
          late: false,
          body: '<p>Hobsbawm frames the dual revolution as two engines of one machine.</p>',
        },
      ],
      score: 9,
      grade: '9',
      graded: at(-6, 12),
    },
  },
  {
    id: '9111',
    course: '150',
    group: '432',
    name: 'Midterm Exam',
    due: at(9, 10),
    points: 100,
    types: ['on_paper'],
    description: '<p>In class, closed book.</p>',
  },
  {
    id: '9122',
    course: '150',
    group: '432',
    name: 'Map quiz retake form',
    due: at(-6, 17),
    lock: at(-3, 17),
    points: 5,
    types: ['online_upload'],
    description: '<p>Upload the signed retake form before the window closes.</p>',
  },
  // CS 225
  {
    id: '9005',
    course: '225',
    group: '441',
    name: 'MP3: Hash Tables',
    due: at(3, 23, 59),
    points: 100,
    types: ['online_url'],
    attempts: -1,
    description:
      '<p>Implement separate chaining and linear probing. Starter code is in <a href="/courses/225/files/6011">starter-code.zip</a>.</p><p>Submit the URL of your GitHub repository.</p>',
  },
  {
    id: '9112',
    course: '225',
    group: '441',
    name: 'MP2: Linked Lists',
    due: at(-11, 23, 59),
    points: 100,
    types: ['online_url'],
    description: '<p>Implement a doubly linked list with an iterator.</p>',
    sub: {
      attempts: [
        {
          attempt: 1,
          submitted: at(-11, 19, 37),
          type: 'online_url',
          url: 'https://github.com/evanstudent/cs225-mp2',
        },
      ],
      score: 92,
      grade: '92',
      graded: at(-6, 9),
      comments: [
        {
          id: 'c6',
          author: 'ta',
          at: at(-6, 9, 1),
          attempt: 1,
          text: 'The iterator fails on an empty list. Otherwise nice work.',
        },
      ],
    },
  },
  {
    id: '9113',
    course: '225',
    group: '442',
    name: 'Lab 8: Heaps',
    due: at(6, 23, 59),
    points: 20,
    types: ['external_tool'],
    tool: 'https://prairielearn.example.edu/pl/course_instance/225/assessment/8',
    description: '<p>Complete the heap exercises in PrairieLearn.</p>',
  },
  {
    id: '9121',
    course: '225',
    group: '442',
    name: 'Lab 7: Trees',
    due: at(-1, 23, 59),
    points: 20,
    types: ['online_text_entry'],
    attempts: 1,
    description: '<p>Explain, in your own words, why an AVL rotation keeps the tree balanced. One attempt.</p>',
    sub: {
      attempts: [
        {
          attempt: 1,
          submitted: at(-2, 20, 12),
          type: 'online_text_entry',
          body: '<p>A rotation moves the taller subtree up one level and the shorter one down, so the heights differ by at most one again. The in-order sequence never changes, so it is still a search tree.</p>',
        },
      ],
    },
  },
  // ART 101
  {
    id: '9114',
    course: '101',
    group: '451',
    name: 'Still life sketch',
    due: at(4, 17),
    points: null,
    gradingType: 'pass_fail',
    types: ['online_upload'],
    extensions: ['jpg', 'jpeg', 'png', 'heic'],
    description: '<p>Photograph your still life sketch in good light and upload it.</p>',
  },
  // Wave 3 (assignments, sharing, and links workstream).
  {
    // Media recording or a file: submissions.mjs serves Kaltura; `POST /fake/kaltura/off`
    // turns it off to test the file upload fallback.
    id: '9140',
    course: '201',
    group: '403',
    name: 'Pipetting technique video',
    due: at(6, 17),
    points: 10,
    types: ['media_recording', 'online_upload'],
    description:
      '<p>Record yourself pipetting 100 µL into a microcentrifuge tube. Narrate each step. Audio or video works; a file upload is fine too.</p>',
  },
  {
    // Online upload or URL, with homework_submission tools (submissions.mjs): Drive Picker returns
    // a file or a link, Studio returns an LTI resource link.
    id: '9141',
    course: '201',
    group: '401',
    name: 'Lab notebook export',
    due: at(10, 23, 59),
    points: 15,
    types: ['online_upload', 'online_url'],
    description:
      '<p>Export this week’s pages from your lab notebook. Pick them from Google Drive, link to a shared notebook, or upload a PDF.</p>',
  },
  {
    // Peer reviews with a rubric: the student submitted, and reviews Maya Chen and Jordan Alvarez
    // (peer-reviews.mjs holds their submissions and the assessment requests).
    id: '9144',
    course: '225',
    group: '441',
    name: 'MP1 design doc',
    due: at(-3, 23, 59),
    points: 30,
    types: ['online_text_entry', 'online_upload'],
    rubric: 'design',
    peerReviews: { anonymous: false, due: at(2, 23, 59) },
    description:
      '<p>Write a one-page design for MP1: the data structures you chose and why. After the deadline, review two classmates’ designs with the rubric.</p>',
    sub: {
      attempts: [
        {
          attempt: 1,
          submitted: at(-4, 21, 5),
          type: 'online_text_entry',
          body: '<h2>MP1 design</h2><p>I store the grid as a flat vector with row-major indexing, so neighbors are index arithmetic and the cache stays warm.</p>',
        },
      ],
    },
  },
  {
    // Anonymous peer review, no rubric: a comment completes it.
    id: '9145',
    course: '225',
    group: '442',
    name: 'Lab reflection',
    due: at(-2, 23, 59),
    points: 10,
    types: ['online_text_entry'],
    peerReviews: { anonymous: true, due: at(3, 23, 59) },
    description:
      '<p>Reflect on Lab 7 in 200 words. Then give one anonymous classmate a specific suggestion.</p>',
    sub: {
      attempts: [
        {
          attempt: 1,
          submitted: at(-2, 20, 40),
          type: 'online_text_entry',
          body: '<p>Rotations finally clicked when I drew the subtrees as boxes instead of nodes.</p>',
        },
      ],
    },
  },
  {
    // Group assignment: group category 1 is calendar.mjs's "Osmosis Lab Group" (501).
    id: '9146',
    course: '201',
    group: '401',
    name: 'Group lab report: Enzyme kinetics',
    due: at(9, 23, 59),
    points: 40,
    types: ['online_upload', 'online_url'],
    groupCategory: '1',
    description:
      '<p>One report per lab group. Whoever submits turns it in for the whole group, and everyone gets the same grade.</p>',
  },
  // Mastery paths (ASSIGN-15): module 714 in course 241. The pre-check is graded 7 of 10, which
  // falls in the 70% to 100% range; that range offers a choice of path A or path B. Path
  // assignments stay hidden until the student picks their path (`masteryPath`).
  {
    id: '9147',
    course: '241',
    group: '412',
    name: 'Unit 6 pre-check',
    due: at(-5, 10),
    points: 10,
    types: ['online_text_entry'],
    description: '<p>Five short questions on double integrals. Your score opens the practice paths in Unit 6.</p>',
    sub: {
      attempts: [{ attempt: 1, submitted: at(-6, 19, 30), type: 'online_text_entry', body: '<p>Answers attached in order: 1) 4/3, 2) π, 3) 0, 4) 12, 5) 1/2.</p>' }],
      score: 7,
      grade: '7',
      graded: at(-4, 9),
    },
  },
  {
    id: '9148',
    course: '241',
    group: '411',
    name: 'Path A: Guided practice set',
    due: at(8, 23, 59),
    points: 10,
    types: ['online_upload'],
    extensions: ['pdf'],
    masteryPath: { trigger: '9147', set: '61' },
    description: '<p>Ten worked problems with hints. Upload your work as a PDF.</p>',
  },
  {
    id: '9149',
    course: '241',
    group: '411',
    name: 'Path A: Reflection',
    due: at(8, 23, 59),
    points: 5,
    types: ['online_text_entry'],
    masteryPath: { trigger: '9147', set: '61' },
    description: '<p>Which hint helped most, and why?</p>',
  },
  {
    id: '9150',
    course: '241',
    group: '411',
    name: 'Path B: Challenge problems',
    due: at(8, 23, 59),
    points: 15,
    types: ['online_upload'],
    extensions: ['pdf'],
    masteryPath: { trigger: '9147', set: '62' },
    description: '<p>Four proof-style problems on changing the order of integration.</p>',
  },
];

/**
 * Mastery path choices (ASSIGN-15), shared with the modules section and survives reloads:
 * `selected[triggerAssignmentId]` is the assignment set the student chose.
 */
const mastery = (globalThis.__easelFakeMastery ??= { selected: {} });
/** Path assignments are only visible to the student once their set is chosen (only_visible_to_overrides). */
const visibleToStudent = (a) => !a.masteryPath || mastery.selected[a.masteryPath.trigger] === a.masteryPath.set;

const assignmentById = (courseId, id) => assignments.find((a) => a.course === courseId && a.id === id);

const submittable = (a) => !a.types.some((t) => ['on_paper', 'none', 'not_graded'].includes(t));
/** Fixture attempts, then any made through submissions.mjs. */
const attemptsOf = (a) => [...(a.sub?.attempts ?? []), ...(store.attempts[a.id] ?? [])];
const commentsOf = (a) => [...(a.sub?.comments ?? []), ...(store.comments[a.id] ?? [])];
const isGraded = (a) => a.sub?.score !== undefined;
/** The attempt the fixture's grade belongs to: its last fixture attempt. */
const gradedAttemptNumber = (a) => (isGraded(a) ? (a.sub.attempts?.at(-1)?.attempt ?? null) : null);
// Assignment#expects_submission?: on paper and external tools are turned in elsewhere.
const expectsSubmission = (a) =>
  submittable(a) && !(a.types.length === 1 && ['on_paper', 'external_tool'].includes(a.types[0]));
// Course-level restricted quantitative data (grades.mjs flags the shared course record).
const restrictsQuantitativeData = (a) => !!(a.rqd || courseById(a.course)?.restrictQuantitativeData);

function lockFor(a) {
  const moduleLock = moduleLockForContent(a.course, a.quiz ? 'Quiz' : 'Assignment', a.quiz ?? a.id);
  if (isFuture(a.unlock))
    return {
      locked_for_user: true,
      lock_info: { asset_string: `assignment_${a.id}`, unlock_at: a.unlock },
      lock_explanation: `This assignment is locked until ${canvasDate(a.unlock)}.`,
    };
  if (isPast(a.lock))
    return {
      locked_for_user: true,
      lock_info: { asset_string: `assignment_${a.id}`, lock_at: a.lock, can_view: true },
      lock_explanation: `This assignment was locked ${canvasDate(a.lock)}.`,
    };
  if (moduleLock) return { ...moduleLock, lock_explanation: moduleLock.lock_explanation('assignment') };
  return { locked_for_user: false };
}

/**
 * One version of the submission (lib/api/v1/submission.rb submission_attempt_json).
 * The fixture grade sits on the attempt it graded. A later attempt (a resubmission)
 * carries the old score with `workflow_state: submitted` and
 * `grade_matches_current_submission: false`, as Canvas does.
 */
function submissionAttemptJson(a, att, { latest }) {
  const gradedNumber = gradedAttemptNumber(a);
  const gradedHere = isGraded(a) && (att ? att.attempt === gradedNumber : latest);
  const carried = latest && isGraded(a) && !gradedHere;
  const scored = gradedHere || carried;
  const secondsLate =
    att?.late && a.due ? Math.max(0, Math.round((Date.parse(att.submitted) - Date.parse(a.due)) / 1000)) : 0;
  return {
    id: `s${a.id}`,
    assignment_id: a.id,
    user_id: user.id,
    attempt: att?.attempt ?? null,
    body: att?.body ?? null,
    url: att?.url ?? null,
    submission_type: att?.type ?? null,
    submitted_at: att?.submitted ?? null,
    score: scored ? a.sub.score : null,
    grade: scored ? a.sub.grade : null,
    entered_score: scored ? a.sub.score : null,
    entered_grade: scored ? a.sub.grade : null,
    graded_at: scored ? a.sub.graded : null,
    grader_id: scored ? `t${a.course}` : null,
    posted_at: scored ? a.sub.graded : null,
    workflow_state: gradedHere ? 'graded' : att ? 'submitted' : 'unsubmitted',
    grade_matches_current_submission: !carried,
    late: att?.late ?? false,
    missing: !att && !gradedHere && submittable(a) && isPast(a.due),
    excused: false,
    late_policy_status: null,
    points_deducted: null,
    seconds_late: secondsLate,
    extra_attempts: null,
    redo_request: false,
    cached_due_date: a.due ?? null,
    grading_period_id: gradingPeriodFor(a)?.id ?? null,
    preview_url: `${BASE}/courses/${a.course}/assignments/${a.id}/submissions/${user.id}?preview=1${att ? `&version=${att.attempt - 1}` : ''}`,
    ...(att?.files && {
      attachments: att.files
        .map((id) => attachmentJson(id, { annotated: att.annotated?.includes(id) ?? false }))
        .filter(Boolean),
    }),
    ...(att?.media && { media_comment: mediaCommentJson(att.media) }),
  };
}

/** lib/api/v1/submission_comment.rb */
function commentJson(a, c) {
  const author =
    c.author === 'self'
      ? { id: user.id, name: user.name }
      : c.author === 'ta'
        ? personById(a.course, tas[a.course][0])
        : teacherOf(a.course);
  const json = {
    id: c.id,
    author_id: author.id,
    author_name: author.name,
    created_at: c.at,
    edited_at: null,
    comment: c.text ?? '',
    attempt: c.attempt ?? null,
    avatar_path: null,
    author: authorJson(author),
  };
  if (c.media) json.media_comment = mediaCommentJson(c.media);
  if (c.files?.length) json.attachments = c.files.map((id) => attachmentJson(id)).filter(Boolean);
  return json;
}

/** lib/api/v1/rubric_assessment.rb full_rubric_assessment_json_for_submissions */
function fullRubricAssessmentJson(a) {
  const criteria = rubrics[a.rubric] ?? [];
  const data = Object.entries(a.sub.rubric).map(([criterionId, r]) => {
    const criterion = criteria.find((c) => c.id === criterionId);
    const rating = criterion?.ratings.find((x) => x.id === r.rating);
    return {
      id: r.rating,
      points: r.points,
      criterion_id: criterionId,
      learning_outcome_id: null,
      description: rating?.description ?? null,
      comments_enabled: true,
      comments: r.comments,
      comments_html: r.comments,
    };
  });
  const teacher = teacherOf(a.course);
  return {
    id: `ra${a.id}`,
    rubric_id: `rub_${a.rubric}`,
    rubric_association_id: `rua${a.id}`,
    score: data.reduce((sum, d) => sum + (d.points ?? 0), 0),
    artifact_type: 'Submission',
    artifact_id: `s${a.id}`,
    artifact_attempt: gradedAttemptNumber(a),
    assessment_type: 'grading',
    assessor_id: teacher.id,
    data,
    rubric_association: { id: `rua${a.id}`, hide_points: false, hide_score_total: false, use_for_grading: true },
    assessor_name: teacher.name,
    assessor_avatar_url: null,
  };
}

function submissionJson(a, includes = new Set()) {
  const attempts = attemptsOf(a);
  const json = submissionAttemptJson(a, attempts.at(-1), { latest: true });
  if (includes.has('submission_history')) {
    json.submission_history = attempts.length
      ? attempts.map((att, i) => submissionAttemptJson(a, att, { latest: i === attempts.length - 1 }))
      : [submissionAttemptJson(a, undefined, { latest: true })];
  }
  if (includes.has('submission_comments'))
    json.submission_comments = commentsOf(a).map((c) => commentJson(a, c));
  if (includes.has('rubric_assessment') && a.sub?.rubric)
    json.rubric_assessment = Object.fromEntries(
      Object.entries(a.sub.rubric).map(([id, r]) => [
        id,
        { rating_id: r.rating, comments: r.comments, points: r.points },
      ]),
    );
  if (includes.has('full_rubric_assessment') && a.sub?.rubric)
    json.full_rubric_assessment = fullRubricAssessmentJson(a);
  return json;
}

function gradingPeriodFor(a) {
  const periods = gradingPeriods[a.course];
  if (!periods) return null;
  // Undated work falls in the last grading period, as in Canvas.
  if (!a.due) return periods.at(-1);
  return periods.find((p) => a.due >= p.start && a.due <= p.end) ?? null;
}

function assignmentJson(a, includes = new Set(), excludes = new Set()) {
  const json = {
    id: a.id,
    name: a.name,
    description: a.description ?? null,
    course_id: a.course,
    assignment_group_id: a.group,
    position: assignments.filter((x) => x.group === a.group).indexOf(a) + 1,
    points_possible: a.points,
    grading_type: a.gradingType ?? 'points',
    created_at: at(-70, 9),
    updated_at: at(-20, 9),
    due_at: a.due ?? null,
    unlock_at: a.unlock ?? null,
    lock_at: a.lock ?? null,
    submission_types: a.types,
    has_submitted_submissions: attemptsOf(a).length > 0,
    due_date_required: false,
    allowed_attempts: a.attempts ?? -1,
    html_url: `${BASE}/courses/${a.course}/assignments/${a.id}`,
    published: true,
    workflow_state: 'published',
    muted: false,
    omit_from_final_grade: false,
    hide_in_gradebook: false,
    only_visible_to_overrides: !!a.masteryPath,
    visible_to_everyone: !a.masteryPath,
    peer_reviews: !!a.peerReviews,
    anonymous_peer_reviews: !!a.peerReviews?.anonymous,
    automatic_peer_reviews: false,
    intra_group_peer_reviews: false,
    ...(a.peerReviews && { peer_reviews_due_at: a.peerReviews.due ?? null }),
    group_category_id: a.groupCategory ?? null,
    grade_group_students_individually: false,
    anonymous_grading: false,
    post_manually: false,
    is_quiz_assignment: !!a.quiz,
    is_quiz_lti_assignment: !!a.quizLti,
    require_lockdown_browser: false,
    restrict_quantitative_data: restrictsQuantitativeData(a),
    ...lockFor(a),
  };
  if (a.extensions) json.allowed_extensions = a.extensions;
  if (a.annotatable) json.annotatable_attachment_id = a.annotatable;
  if (a.quiz) json.quiz_id = a.quiz;
  if (a.topic)
    json.discussion_topic = {
      id: a.topic,
      title: a.name,
      html_url: `${BASE}/courses/${a.course}/discussion_topics/${a.topic}`,
    };
  if (a.tool) json.external_tool_tag_attributes = { url: a.tool, new_tab: false };
  if (a.rubric) {
    const rubric = rubrics[a.rubric];
    json.rubric = rubric.map((c) => ({
      ...c,
      long_description: c.long_description ?? '',
      criterion_use_range: false,
      ratings: c.ratings.map((r) => ({ ...r, long_description: r.long_description ?? '' })),
    }));
    json.rubric_settings = {
      id: `rub_${a.rubric}`,
      title: rubricTitles[a.rubric] ?? 'Rubric',
      points_possible: rubric.reduce((sum, r) => sum + r.points, 0),
      free_form_criterion_comments: false,
      hide_score_total: false,
      hide_points: false,
    };
    json.has_rubric = true;
    json.use_rubric_for_grading = true;
    json.free_form_criterion_comments = false;
  }
  if (includes.has('submission')) json.submission = submissionJson(a);
  // lib/api/v1/assignment.rb: expects_submission? && !locked_for? && attempts_left > 0 (not for quizzes)
  if (includes.has('can_submit') && !a.quiz)
    json.can_submit =
      expectsSubmission(a) &&
      !json.locked_for_user &&
      (json.allowed_attempts === -1 || attemptsOf(a).length < json.allowed_attempts);
  for (const field of excludes) delete json[field];
  return json;
}

// submissions.mjs builds its responses with these. Each reload of this file refreshes them.
store.course = {
  assignmentById,
  personById,
  rubrics,
  visibleToStudent,
  assignmentJson,
  submissionJson,
  attachmentJson,
  attemptsOf,
  isGraded,
  lockFor,
  isPast,
  teacherOf,
};

// ---------------------------------------------------------------------------
// Quizzes
// ---------------------------------------------------------------------------

// Quizzes and their routes live in quizzes.mjs, which keeps attempts on globalThis.
// Module requirements read completed attempts through it; it reads module locks from here.
const quizById = (courseId, id) => globalThis.__easelFakeQuizzes?.api?.quizById(courseId, id);

// ---------------------------------------------------------------------------
// Pages (lib/api/v1/wiki_page.rb)
// ---------------------------------------------------------------------------

const pages = [
  {
    url: 'welcome-to-cell-biology',
    course: '201',
    title: 'Welcome to Cell Biology',
    front: true,
    updated: at(-60, 10),
    body: `<p>Welcome! This course covers the structure and function of cells, from membranes to metabolism.</p>
<h3>Where things are</h3>
<ul>
<li>The <a href="/courses/201/assignments/syllabus">syllabus</a> has the grading policy and schedule.</li>
<li>Work is organized by week in <a href="/courses/201/modules">Modules</a>.</li>
<li>Quizzes open from each week’s module. The <a href="/courses/201/quizzes">quiz list</a> is turned off for this course.</li>
</ul>
<p>Lab sections meet Thursdays in Room 214.</p>`,
  },
  {
    url: 'osmosis-lab-guide',
    course: '201',
    title: 'Osmosis lab guide',
    editingRoles: 'teachers,students',
    updated: at(-8, 9),
    body: `<p>You will measure the change in mass of potato cores after 30 minutes in sucrose solutions.</p>
<table><thead><tr><th>Solution</th><th>Sucrose (M)</th><th>Cores</th></tr></thead>
<tbody><tr><td>A</td><td>0.0</td><td>3</td></tr><tr><td>B</td><td>0.2</td><td>3</td></tr><tr><td>C</td><td>0.4</td><td>3</td></tr><tr><td>D</td><td>0.6</td><td>3</td></tr></tbody></table>
<p>Record initial and final mass to 0.01 g. When you finish, write it up in <a href="/courses/201/assignments/9003">Lab Report: Osmosis</a>.</p>`,
  },
  {
    url: 'reading-checklist',
    course: '201',
    title: 'Week 2 reading checklist',
    updated: at(-9, 9),
    body: '<ul><li>Chapter 7.1 to 7.3: membrane structure</li><li>Chapter 7.4: passive transport</li><li>Chapter 7.5: active transport</li></ul><p>Mark this item done in the module once you’ve read all three.</p>',
  },
  {
    url: 'photosynthesis-overview',
    course: '201',
    title: 'Photosynthesis overview',
    updated: at(-2, 9),
    body: '<p>Light reactions happen in the thylakoid membranes; the Calvin cycle runs in the stroma.</p>',
  },
  {
    url: 'lab-safety-rules',
    course: '201',
    title: 'Lab safety rules',
    updated: at(-61, 9),
    body: '<ol><li>Goggles on whenever chemicals are out.</li><li>No food or drink at the bench.</li><li>Report every spill, however small.</li></ol>',
  },
  {
    url: 'course-home',
    course: '110',
    title: 'Rhetoric & Composition',
    front: true,
    updated: at(-40, 9),
    body: '<p>This course teaches you to read arguments closely and write your own with purpose.</p><p>Start with the <a href="/courses/110/assignments/syllabus">syllabus</a>, then read <a href="/courses/110/pages/essay-2-guide">the Essay 2 guide</a>.</p>',
  },
  {
    url: 'essay-2-guide',
    course: '110',
    title: 'Essay 2 guide',
    updated: at(-15, 9),
    body: '<p>Essay 2 is an argument essay. Choose a policy question you care about and argue for an answer.</p><blockquote>A thesis is a claim a reasonable person could disagree with.</blockquote>',
  },
  {
    url: 'office-hours',
    course: '225',
    title: 'Office hours',
    updated: at(-30, 9),
    body: '<p>Office hours run Monday to Thursday, 4 to 6 PM, in Siebel 0216 and online.</p>',
  },
  {
    url: 'style-guide',
    course: '225',
    title: 'C++ style guide',
    updated: at(-50, 9),
    body: '<p>Use <code>snake_case</code> for functions and <code>PascalCase</code> for classes.</p><pre><code>class HashTable {\n  void insert(const Key&amp; key);\n};</code></pre>',
  },
  {
    // Embedded media and tools (HTML-4, LTI-5): served by lti.mjs.
    url: 'lecture-6-media-and-tools',
    course: '201',
    title: 'Lecture 6: Media and tools',
    updated: at(-6, 16),
    body: `<p>Watch the recording before Thursday’s lab. Each video plays here; tools open full screen from their button.</p>
<h3>Saved for offline study</h3>
<p><img src="/fake/offline-media/image.png" srcset="/fake/offline-media/image.png 1x, fake/offline-media/redirect 2x" alt="Cell diagram" /></p>
<video controls poster="/fake/offline-media/image.png"><source src="/fake/offline-media/video.mp4" type="video/mp4" /><track src="/fake/offline-media/captions.vtt" kind="captions" srclang="en" label="English" /></video>
<audio controls src="/fake/offline-media/audio.m4a"></audio>
<h3>Lecture recording</h3>
<p><iframe src="/courses/201/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpanopto.example.edu%2Fembed%2Flecture-6" title="Lecture 6 recording (Panopto)" width="100%" height="320" allowfullscreen="allowfullscreen" allow="autoplay; fullscreen"></iframe></p>
<h3>Osmosis demo</h3>
<p><iframe style="width: 320px; height: 240px; display: inline-block;" title="Video player for osmosis-demo.mp4" data-media-type="video" src="/media_objects_iframe/m-fake6?type=video" allowfullscreen="allowfullscreen" allow="fullscreen" data-media-id="m-fake6"></iframe></p>
<h3>Membrane channels walkthrough</h3>
<p><iframe class="lti-embed" style="width: 560px; height: 315px;" title="Membrane channels walkthrough (Studio)" src="/courses/201/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Ffake.instructuremedia.com%2Flti%2Flaunch%3Fcustom_arc_media_id%3Dfake-studio-6%26custom_arc_launch_type%3Dembed" width="560" height="315" allowfullscreen="allowfullscreen" allow="autoplay; fullscreen"></iframe></p>
<h3>Background videos</h3>
<p><iframe width="560" height="315" src="https://www.youtube.com/embed/aqz-KE-bpKQ" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></p>
<p><iframe src="https://player.vimeo.com/video/76979871" width="640" height="360" title="Vimeo video player" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></p>
<h3>The math</h3>
<p>Water moves toward lower water potential, \\(\\Psi = \\Psi_s + \\Psi_p\\). At equilibrium, \\(\\Delta \\Psi = 0\\) and net flow stops.</p>`,
  },
];

const pageBy = (courseId, url) => pages.find((p) => p.course === courseId && p.url === url);

// Keep student edits across fixture hot reloads, like group-content.mjs.
const pageEdits = (globalThis.__easelFakeCoursePageEdits ??= {});
const pageState = (p) => ({ ...p, revision: 1, ...pageEdits[`${p.course}:${p.url}`] });

function pageJson(p, { body }) {
  const current = pageState(p);
  const teacher = teacherOf(p.course);
  const moduleLock = moduleLockForContent(p.course, 'Page', p.url);
  const json = {
    page_id: `${p.course}${pages.indexOf(p)}`,
    url: p.url,
    title: p.title,
    created_at: at(-70, 9),
    updated_at: current.updated,
    hide_from_students: false,
    editing_roles: p.editingRoles ?? 'teachers',
    last_edited_by: current.editor ?? authorJson(teacher),
    published: true,
    front_page: !!p.front,
    html_url: `${BASE}/courses/${p.course}/pages/${p.url}`,
    todo_date: null,
    publish_at: null,
    locked_for_user: !!moduleLock,
    ...(moduleLock && {
      lock_info: moduleLock.lock_info,
      lock_explanation: moduleLock.lock_explanation('page'),
    }),
  };
  if (body && !moduleLock) json.body = current.body;
  return json;
}

// ---------------------------------------------------------------------------
// Modules (lib/api/v1/context_module.rb)
// ---------------------------------------------------------------------------

/** `content` is the content ID, or the page URL for pages. */
const modules = [
  {
    id: '799', course: '101', name: 'Course materials',
    items: [
      { id: '7991', type: 'File', content: '6001', title: 'Syllabus.pdf' },
      { id: '7992', type: 'File', content: '6004', title: 'Course image' },
    ],
  },
  {
    id: '701',
    course: '201',
    name: 'Week 1: Cells and membranes',
    items: [
      { id: '7101', type: 'SubHeader', title: 'Start here' },
      {
        id: '7102',
        type: 'Page',
        content: 'welcome-to-cell-biology',
        title: 'Welcome to Cell Biology',
        req: { type: 'must_view' },
      },
      { id: '7103', type: 'File', content: '6001', title: 'Syllabus.pdf', req: { type: 'must_view' } },
      { id: '7104', type: 'Page', content: 'lab-safety-rules', title: 'Lab safety rules', indent: 1 },
      { id: '7105', type: 'SubHeader', title: 'Lab' },
      {
        id: '7106',
        type: 'Assignment',
        content: '9101',
        title: 'Lab Report: Diffusion',
        req: { type: 'must_submit' },
      },
      {
        id: '7107',
        type: 'Quiz',
        content: '9008',
        title: 'Quiz 4: Membrane Transport',
        req: { type: 'min_score', min_score: 18 },
      },
    ],
  },
  {
    id: '702',
    course: '201',
    name: 'Week 2: Transport',
    prereqs: ['701'],
    items: [
      {
        id: '7201',
        type: 'Page',
        content: 'osmosis-lab-guide',
        title: 'Osmosis lab guide',
        req: { type: 'must_view' },
      },
      {
        id: '7202',
        type: 'Page',
        content: 'reading-checklist',
        title: 'Week 2 reading checklist',
        req: { type: 'must_mark_done' },
      },
      {
        id: '7203',
        type: 'ExternalUrl',
        title: 'PhET osmosis simulation',
        url: 'https://phet.colorado.edu/en/simulations/membrane-channels',
        req: { type: 'must_view' },
      },
      {
        id: '7204',
        type: 'Assignment',
        content: '9003',
        title: 'Lab Report: Osmosis',
        req: { type: 'must_submit' },
      },
      {
        id: '7205',
        type: 'Discussion',
        content: '9203',
        title: 'Lab partner check-in',
        req: { type: 'must_contribute' },
      },
      {
        id: '7206',
        type: 'ExternalTool',
        content: '801',
        title: 'Lecture 6 recording',
        url: 'https://panopto.example.edu/lecture-6',
      },
      { id: '7207', type: 'Page', content: 'lecture-6-media-and-tools', title: 'Lecture 6: Media and tools' },
    ],
  },
  {
    id: '703',
    course: '201',
    name: 'Week 3: Energy',
    prereqs: ['702'],
    sequential: true,
    items: [
      {
        id: '7301',
        type: 'Page',
        content: 'photosynthesis-overview',
        title: 'Photosynthesis overview',
        req: { type: 'must_view' },
      },
      {
        id: '7302',
        type: 'Assignment',
        content: '9102',
        title: 'Lab Report: Photosynthesis',
        req: { type: 'must_submit' },
      },
      {
        id: '7303',
        type: 'Quiz',
        content: '9302',
        title: 'Quiz 5: Cellular Respiration',
        req: { type: 'min_score', min_score: 18 },
      },
    ],
  },
  {
    id: '711',
    course: '241',
    name: 'Unit 3: Partial derivatives',
    items: [
      {
        id: '7111',
        type: 'Assignment',
        content: '9106',
        title: 'Problem Set 6: Partial Derivatives',
        req: { type: 'must_submit' },
      },
      {
        id: '7112',
        type: 'Quiz',
        content: '9006',
        title: 'Quiz 3: Partial Derivatives',
        req: { type: 'must_submit' },
      },
      { id: '7113', type: 'Assignment', content: '9130', title: 'Unit 4 check-in' },
    ],
  },
  {
    id: '712',
    course: '241',
    name: 'Unit 4: Optimization',
    unlock: at(-3, 0),
    requirementType: 'one',
    items: [
      {
        id: '7121',
        type: 'Assignment',
        content: '9001',
        title: 'Problem Set 7: Lagrange Multipliers',
        req: { type: 'must_submit' },
      },
      {
        id: '7122',
        type: 'ExternalUrl',
        title: 'Paul’s Online Notes: Lagrange multipliers',
        url: 'https://tutorial.math.lamar.edu/classes/calciii/lagrangemultipliers.aspx',
        req: { type: 'must_view' },
      },
    ],
  },
  {
    id: '713',
    course: '241',
    name: 'Unit 5: Multiple integrals',
    unlock: at(6, 0),
    items: [
      {
        id: '7131',
        type: 'Assignment',
        content: '9108',
        title: 'Problem Set 8: Double Integrals',
        req: { type: 'must_submit' },
      },
    ],
  },
  {
    // Mastery paths (ASSIGN-15): the pre-check's score offers a choice of path A or B.
    // Path items list once their assignment set is chosen (`masteryRules`, `itemsOf`).
    id: '714',
    course: '241',
    name: 'Unit 6: Double integrals',
    items: [
      {
        id: '7141',
        type: 'Assignment',
        content: '9147',
        title: 'Unit 6 pre-check',
        req: { type: 'must_submit' },
      },
      { id: '7142', type: 'Assignment', content: '9148', title: 'Path A: Guided practice set', indent: 1 },
      { id: '7143', type: 'Assignment', content: '9149', title: 'Path A: Reflection', indent: 1 },
      { id: '7144', type: 'Assignment', content: '9150', title: 'Path B: Challenge problems', indent: 1 },
    ],
  },
  {
    id: '721',
    course: '150',
    name: 'Part I: The dual revolution',
    items: [
      {
        id: '7211',
        type: 'Assignment',
        content: '9110',
        title: 'Reading Response 4',
        req: { type: 'must_submit' },
      },
      {
        id: '7212',
        type: 'Discussion',
        content: '9002',
        title: 'Reading Response 5',
        req: { type: 'must_contribute' },
      },
    ],
  },
  {
    id: '731',
    course: '225',
    name: 'Machine problems',
    items: [
      { id: '7311', type: 'Page', content: 'style-guide', title: 'C++ style guide' },
      {
        id: '7312',
        type: 'Assignment',
        content: '9112',
        title: 'MP2: Linked Lists',
        req: { type: 'min_score', min_score: 70 },
      },
      {
        id: '7313',
        type: 'Assignment',
        content: '9005',
        title: 'MP3: Hash Tables',
        req: { type: 'min_score', min_score: 70 },
      },
    ],
  },
  {
    id: '732',
    course: '225',
    name: 'Labs',
    items: [
      {
        id: '7321',
        type: 'Assignment',
        content: '9113',
        title: 'Lab 8: Heaps',
        req: { type: 'must_submit' },
      },
      {
        id: '7322',
        type: 'ExternalTool',
        content: '803',
        title: 'PrairieLearn',
        url: 'https://prairielearn.example.edu',
      },
    ],
  },
];

/** Requirements met by viewing or marking done. Seeds the student's history. */
const viewed = new Set(['7102', '7103', '7104']);
const markedDone = new Set();
const contributed = new Set();

const modulesFor = (courseId) => modules.filter((m) => m.course === courseId);
const moduleById = (courseId, id) => modulesFor(courseId).find((m) => m.id === id);

/**
 * Items the student sees: Canvas leaves out items whose assignment isn't visible to them, such
 * as mastery path assignments before their set is chosen (content_tags_visible_to).
 */
const itemsOf = (m) =>
  m.items.filter((i) => {
    if (i.type !== 'Assignment') return true;
    const a = assignmentById(m.course, i.content);
    return !a || visibleToStudent(a);
  });

/**
 * Conditional release rules (app/models/conditional_release/rule.rb): the trigger assignment's
 * score, as a fraction of its points, picks a scoring range; a range with more than one assignment
 * set asks the student to choose. Sets hold the assignments whose `masteryPath.set` matches.
 */
const masteryRules = {
  9147: {
    ranges: [
      { id: '51', lower: 0.7, upper: 1, sets: ['61', '62'] },
      { id: '52', lower: 0, upper: 0.7, sets: ['63'] },
    ],
  },
};

/** The student's scoring range for a trigger assignment, or null until it's graded. */
function masteryRange(trigger) {
  const rule = masteryRules[trigger.id];
  if (!rule || !isGraded(trigger) || !trigger.points) return null;
  const relative = trigger.sub.score / trigger.points;
  return rule.ranges.find((r) => relative >= r.lower && (relative < r.upper || r.upper >= 1)) ?? null;
}

const setAssignments = (trigger, setId) =>
  assignments.filter((a) => a.masteryPath?.trigger === trigger.id && a.masteryPath.set === setId);

/**
 * `mastery_paths` on a module item (app/helpers/cyoe_helper.rb conditional_release_json with
 * build_path_data and check_if_processing), or null when the item triggers no rule.
 */
function masteryPathsJson(m, item) {
  if (item.type !== 'Assignment' || !masteryRules[item.content]) return null;
  const trigger = assignmentById(m.course, item.content);
  if (!trigger) return null;
  const range = masteryRange(trigger);
  const sets = (range?.sets ?? []).map((setId, index) => ({
    id: setId,
    scoring_range_id: range.id,
    created_at: at(-40, 9),
    updated_at: at(-40, 9),
    position: index + 1,
    assignment_set_associations: setAssignments(trigger, setId).map((a, i) => ({
      id: `${setId}${i + 1}`,
      assignment_set_id: setId,
      assignment_id: a.id,
      position: i + 1,
      created_at: at(-40, 9),
      updated_at: at(-40, 9),
      model: assignmentJson(a),
    })),
  }));
  // One set in the range is assigned automatically; more than one waits for the student.
  const selected = sets.length === 1 ? sets[0].id : (mastery.selected[trigger.id] ?? null);
  const awaiting = selected === null && sets.length > 0;
  const json = {
    locked: range === null,
    assignment_sets: sets,
    selected_set_id: selected,
    is_student: true,
    awaiting_choice: awaiting,
    modules_url: `${BASE}/courses/${m.course}/modules`,
    choose_url: `${BASE}/courses/${m.course}/modules/items/${item.id}/choose`,
    modules_tab_disabled: false,
  };
  if (!awaiting && sets.length === 1) json.still_processing = false;
  return json;
}

function requirementMet(m, item) {
  const req = item.req;
  if (!req) return false;
  switch (req.type) {
    case 'must_view':
      return viewed.has(item.id);
    case 'must_mark_done':
      return markedDone.has(item.id);
    case 'must_contribute':
      return contributed.has(item.id);
    case 'must_submit': {
      if (item.type === 'Quiz') return (quizById(m.course, item.content)?.taken.length ?? 0) > 0;
      const a = assignmentById(m.course, item.content);
      return !!a && (attemptsOf(a).length > 0 || isGraded(a));
    }
    case 'min_score': {
      if (item.type === 'Quiz') {
        const q = quizById(m.course, item.content);
        const best = Math.max(-1, ...(q?.taken ?? []).map((t) => t.score));
        return best >= req.min_score;
      }
      const a = assignmentById(m.course, item.content);
      return !!a && isGraded(a) && a.sub.score >= req.min_score;
    }
    default:
      return false;
  }
}

const requirements = (m) => m.items.filter((i) => i.req);

function moduleComplete(m) {
  const reqs = requirements(m);
  if (reqs.length === 0) return true;
  return m.requirementType === 'one'
    ? reqs.some((i) => requirementMet(m, i))
    : reqs.every((i) => requirementMet(m, i));
}

function moduleLocked(m) {
  if (isFuture(m.unlock)) return true;
  return (m.prereqs ?? []).some((id) => {
    const p = moduleById(m.course, id);
    return p && (moduleLocked(p) || !moduleComplete(p));
  });
}

function moduleState(m) {
  if (moduleLocked(m)) return 'locked';
  if (moduleComplete(m)) return 'completed';
  const started = m.items.some((i) => requirementMet(m, i) || viewed.has(i.id));
  return started ? 'started' : 'unlocked';
}

/** Locked by its module, or by sequential progress inside an unlocked module. */
function itemLocked(m, item) {
  if (moduleLocked(m)) return true;
  if (!m.sequential) return false;
  for (const earlier of m.items) {
    if (earlier === item) return false;
    if (earlier.req && !requirementMet(m, earlier)) return true;
  }
  return false;
}

const typeNames = { assignment: 'assignment', quiz: 'quiz', page: 'page', topic: 'topic', file: 'file' };

/** Lock info for content that sits in a locked module item, or null. */
function moduleLockForContent(courseId, type, contentId) {
  for (const m of modulesFor(courseId)) {
    const item = m.items.find((i) => i.type === type && i.content === contentId);
    if (item && itemLocked(m, item)) {
      return {
        locked_for_user: true,
        lock_info: {
          asset_string: `${type.toLowerCase()}_${contentId}`,
          context_module: { id: m.id, name: m.name, unlock_at: m.unlock ?? null },
          ...(m.unlock && isFuture(m.unlock) && { unlock_at: m.unlock }),
        },
        lock_explanation: (kind) =>
          m.unlock && isFuture(m.unlock)
            ? `This ${typeNames[kind] ?? 'content'} is locked until ${canvasDate(m.unlock)}.`
            : `This ${typeNames[kind] ?? 'content'} is part of the module <b>${m.name}</b> and hasn't been unlocked yet.<br/><a href='/courses/${courseId}/modules#module_${m.id}'>Visit the modules page for information on how to unlock this content.</a>`,
      };
    }
  }
  return null;
}

// quizzes.mjs locks quizzes by module, and lti.mjs resolves module item launches, through this.
globalThis.__easelFakeModules = {
  lockForContent: moduleLockForContent,
  moduleItem: (courseId, itemId) => {
    for (const m of modulesFor(String(courseId))) {
      const item = m.items.find((i) => i.id === String(itemId));
      if (item) return { ...item, moduleId: m.id, locked: itemLocked(m, item) };
    }
    return null;
  },
};

const itemKind = { Assignment: 'assignment', Quiz: 'quiz', Page: 'page', Discussion: 'topic', File: 'file' };

function contentDetails(m, item) {
  const details = {};
  const kind = itemKind[item.type];
  if (item.type === 'Assignment' || item.type === 'Discussion') {
    const a =
      item.type === 'Assignment'
        ? assignmentById(m.course, item.content)
        : assignments.find((x) => x.course === m.course && x.topic === item.content);
    if (a) {
      if (a.points != null) details.points_possible = a.points;
      if (a.due) details.due_at = a.due;
      if (a.unlock) details.unlock_at = a.unlock;
      if (a.lock) details.lock_at = a.lock;
    }
  }
  if (item.type === 'Quiz') {
    const q = quizById(m.course, item.content);
    if (q) {
      details.points_possible = q.points;
      if (q.due) details.due_at = q.due;
      if (q.unlock) details.unlock_at = q.unlock;
    }
  }
  if (item.type === 'File') details.display_name = item.title;
  const locked = itemLocked(m, item) || (details.unlock_at && isFuture(details.unlock_at));
  details.locked_for_user = !!locked;
  if (locked) {
    const lock = moduleLockForContent(m.course, item.type, item.content);
    if (lock) {
      details.lock_info = lock.lock_info;
      details.lock_explanation = lock.lock_explanation(kind);
    } else if (details.unlock_at) {
      details.lock_info = { unlock_at: details.unlock_at };
      details.lock_explanation = `This ${typeNames[kind] ?? 'content'} is locked until ${canvasDate(details.unlock_at)}.`;
    } else {
      details.lock_explanation = `This ${typeNames[kind] ?? 'content'} is part of the module <b>${m.name}</b> and hasn't been unlocked yet.`;
    }
  }
  return details;
}

function itemJson(m, item, { progression = true, includes = new Set() } = {}) {
  const c = m.course;
  const json = {
    id: item.id,
    position: m.items.indexOf(item) + 1,
    title: item.title,
    indent: item.indent ?? 0,
    type: item.type,
    module_id: m.id,
    quiz_lti: item.type === 'Assignment' && !!assignmentById(m.course, item.content)?.quizLti,
  };
  if (item.type !== 'SubHeader') json.html_url = `${BASE}/courses/${c}/modules/items/${item.id}`;
  if (!['Page', 'SubHeader', 'ExternalUrl'].includes(item.type)) json.content_id = item.content;
  if (item.type === 'Page') json.page_url = item.content;
  const api = {
    Assignment: `/api/v1/courses/${c}/assignments/${item.content}`,
    Quiz: `/api/v1/courses/${c}/quizzes/${item.content}`,
    Discussion: `/api/v1/courses/${c}/discussion_topics/${item.content}`,
    Page: `/api/v1/courses/${c}/pages/${item.content}`,
    File: `/api/v1/courses/${c}/files/${item.content}`,
    ExternalTool: `/api/v1/courses/${c}/external_tools/sessionless_launch?launch_type=module_item&module_item_id=${item.id}`,
  }[item.type];
  if (api) json.url = `${BASE}${api}`;
  if (item.type === 'ExternalUrl' || item.type === 'ExternalTool') {
    json.external_url = item.url;
    json.new_tab = false;
  }
  if (item.req) {
    json.completion_requirement = { type: item.req.type };
    if (item.req.min_score !== undefined) json.completion_requirement.min_score = item.req.min_score;
    if (progression) json.completion_requirement.completed = requirementMet(m, item);
  }
  if (includes.has('content_details')) json.content_details = contentDetails(m, item);
  if (includes.has('mastery_paths')) json.mastery_paths = masteryPathsJson(m, item);
  return json;
}

function moduleJson(m, { includes = new Set(), progression = true } = {}) {
  const state = moduleState(m);
  const json = {
    id: m.id,
    position: modulesFor(m.course).indexOf(m) + 1,
    name: m.name,
    unlock_at: m.unlock ?? null,
    require_sequential_progress: !!m.sequential,
    requirement_type: m.requirementType ?? 'all',
    publish_final_grade: false,
    prerequisite_module_ids: m.prereqs ?? [],
    items_count: itemsOf(m).length,
    items_url: `${BASE}/api/v1/courses/${m.course}/modules/${m.id}/items`,
  };
  if (progression) {
    json.state = state;
    json.completed_at = state === 'completed' ? at(-9, 12) : null;
  }
  // The modules index passes only content_details through to items, never mastery_paths.
  const itemIncludes = new Set([...includes].filter((i) => i === 'content_details'));
  if (includes.has('items')) json.items = itemsOf(m).map((i) => itemJson(m, i, { includes: itemIncludes }));
  return json;
}

function findItem(courseId, moduleId, itemId) {
  const m = moduleById(courseId, moduleId);
  const item = m && itemsOf(m).find((i) => i.id === itemId);
  return m && item ? { m, item } : null;
}

const assetTypes = {
  Assignment: 'Assignment',
  Quiz: 'Quiz',
  Page: 'Page',
  Discussion: 'Discussion',
  File: 'File',
  ExternalTool: 'ExternalTool',
};

function sequenceJson(courseId, assetType, assetId) {
  const sequence = modulesFor(courseId).flatMap((m) =>
    itemsOf(m)
      .filter((i) => i.type !== 'SubHeader')
      .map((item) => ({ m, item })),
  );
  const matches = sequence
    .map((entry, index) => ({ ...entry, index }))
    .filter(({ item }) =>
      assetType === 'ModuleItem'
        ? item.id === assetId
        : item.type === assetTypes[assetType] && item.content === assetId,
    )
    .slice(0, 10);
  const json = (entry) => (entry ? itemJson(entry.m, entry.item, { progression: false }) : null);
  const used = new Set();
  const items = matches.map(({ index }) => {
    for (const e of [sequence[index - 1], sequence[index], sequence[index + 1]]) if (e) used.add(e.m);
    return {
      prev: json(sequence[index - 1]),
      current: json(sequence[index]),
      next: json(sequence[index + 1]),
      mastery_path: null,
    };
  });
  return { items, modules: [...used].map((m) => moduleJson(m, { progression: false })) };
}

const moduleItemLockedResponse = { status: 403, body: { message: 'The module item is locked.' } };

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const courseExists = (courseId) =>
  !!courseById(courseId) ||
  !!globalThis.__fakeCanvasEnrollments?.otherCourses?.some((c) => c.id === String(courseId) && !c.restricted);

export const routes = [
  {
    path: '/api/v1/courses/:courseId/tabs',
    handler: ({ params }) => (courseExists(params.courseId) ? tabsJson(params.courseId) : notFound()),
  },

  // Assignments
  {
    // GET assignment groups (app/controllers/assignment_groups_controller.rb#index)
    path: '/api/v1/courses/:courseId/assignment_groups',
    handler: ({ params, query, url }) => {
      if (!courseExists(params.courseId)) return notFound();
      const includes = new Set(query.include ?? []);
      const excludes = new Set(query.exclude_response_fields ?? []);
      const period = query.grading_period_id;
      const list = (groups[params.courseId] ?? []).map((g, index) => {
        const json = {
          id: g.id,
          name: g.name,
          position: index + 1,
          group_weight: g.weight,
          sis_source_id: null,
          integration_data: {},
          rules: {},
        };
        if (includes.has('assignments'))
          json.assignments = assignments
            .filter((a) => a.group === g.id && visibleToStudent(a))
            .filter((a) => !period || gradingPeriodFor(a)?.id === period)
            .map((a) => assignmentJson(a, includes, excludes));
        return json;
      });
      return paginate(list, query, url);
    },
  },
  {
    path: '/api/v1/courses/:courseId/grading_periods',
    handler: ({ params }) => {
      if (!courseExists(params.courseId)) return notFound();
      return {
        grading_periods: (gradingPeriods[params.courseId] ?? []).map((p) => ({
          id: p.id,
          grading_period_group_id: '90',
          start_date: p.start,
          end_date: p.end,
          close_date: p.close,
          weight: null,
          title: p.title,
          permissions: { read: true, create: false, update: false, delete: false },
          is_closed: isPast(p.close),
        })),
        meta: { primaryCollection: 'grading_periods' },
      };
    },
  },
  {
    path: '/api/v1/courses/:courseId/assignments',
    handler: ({ params, query, url }) => {
      if (!courseExists(params.courseId)) return notFound();
      const includes = new Set(query.include ?? []);
      const excludes = new Set(query.exclude_response_fields ?? []);
      let list = assignments.filter((a) => a.course === params.courseId && visibleToStudent(a));
      if (query.order_by === 'due_at')
        list = [...list].sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
      return paginate(
        list.map((a) => assignmentJson(a, includes, excludes)),
        query,
        url,
      );
    },
  },
  {
    path: '/api/v1/courses/:courseId/assignments/:assignmentId',
    handler: ({ params, query }) => {
      const a = assignmentById(params.courseId, params.assignmentId);
      return a && visibleToStudent(a) ? assignmentJson(a, new Set(query.include ?? [])) : notFound();
    },
  },
  {
    // Single submission (app/controllers/submissions_api_controller.rb#show)
    path: '/api/v1/courses/:courseId/assignments/:assignmentId/submissions/:userId',
    handler: ({ params, query }) => {
      const a = assignmentById(params.courseId, params.assignmentId);
      if (!a) return notFound();
      // A classmate's submission: peer-reviews.mjs answers for the reviews assigned to the student.
      if (params.userId !== 'self' && params.userId !== user.id)
        return globalThis.__easelFakePeerReviews?.submissionFor?.(a, params.userId, query) ?? notFound();
      return submissionJson(a, new Set(query.include ?? []));
    },
  },

  // Pages
  {
    path: '/api/v1/courses/:courseId/pages',
    handler: ({ params, query, url }) => {
      if (!courseExists(params.courseId)) return notFound();
      const list = pages.filter((p) => p.course === params.courseId);
      const order = query.order === 'desc' ? -1 : 1;
      const sorted = [...list].sort((a, b) =>
        query.sort === 'updated_at'
          ? pageState(a).updated.localeCompare(pageState(b).updated) * order
          : a.title.localeCompare(b.title) * order,
      );
      return paginate(
        sorted.map((p) => pageJson(p, { body: (query.include ?? []).includes('body') })),
        query,
        url,
      );
    },
  },
  {
    path: '/api/v1/courses/:courseId/front_page',
    handler: ({ params }) => {
      const p = pages.find((x) => x.course === params.courseId && x.front);
      return p
        ? pageJson(p, { body: true })
        : { status: 404, body: { errors: [{ message: 'No front page has been set' }] } };
    },
  },
  {
    path: '/api/v1/courses/:courseId/pages/:pageUrl',
    handler: ({ params }) => {
      const p = pageBy(params.courseId, params.pageUrl);
      return p ? pageJson(p, { body: true }) : notFound();
    },
  },

  {
    path: '/api/v1/courses/:courseId/pages/:pageUrl/revisions/latest',
    handler: ({ params, query }) => {
      const p = pageBy(params.courseId, params.pageUrl);
      if (!p) return notFound();
      if (moduleLockForContent(p.course, 'Page', p.url))
        return { status: 401, body: { status: 'unauthorized' } };
      const current = pageState(p);
      return {
        revision_id: current.revision,
        updated_at: current.updated,
        latest: true,
        edited_by: current.editor ?? authorJson(teacherOf(p.course)),
        ...(query.summary !== 'true' && { url: p.url, title: p.title, body: current.body }),
      };
    },
  },
  {
    // WikiPagesApiController#update: student update_content permission permits body edits.
    method: 'PUT',
    path: '/api/v1/courses/:courseId/pages/:pageUrl',
    handler: ({ params, body }) => {
      const p = pageBy(params.courseId, params.pageUrl);
      if (!p) return notFound();
      if (!p.editingRoles?.split(',').includes('students') || moduleLockForContent(p.course, 'Page', p.url))
        return { status: 401, body: { status: 'unauthorized' } };
      const change = body?.wiki_page ?? {};
      if (Object.keys(change).some((key) => key !== 'body'))
        return { status: 401, body: { message: 'You may only update the body of this wiki page.' } };
      const current = pageState(p);
      pageEdits[`${p.course}:${p.url}`] = {
        body: String(change.body ?? current.body),
        updated: new Date().toISOString(),
        revision: current.revision + 1,
        editor: { id: user.id, display_name: user.name, avatar_image_url: user.avatar_url ?? null },
      };
      return pageJson(p, { body: true });
    },
  },

  // Modules
  {
    path: '/api/v1/courses/:courseId/modules',
    handler: ({ params, query, url }) => {
      if (!courseExists(params.courseId)) return notFound();
      const includes = new Set(query.include ?? []);
      return paginate(
        modulesFor(params.courseId).map((m) => moduleJson(m, { includes })),
        query,
        url,
      );
    },
  },
  {
    path: '/api/v1/courses/:courseId/modules/:moduleId/items',
    handler: ({ params, query, url }) => {
      const m = moduleById(params.courseId, params.moduleId);
      if (!m) return notFound();
      const includes = new Set(query.include ?? []);
      return paginate(
        itemsOf(m).map((i) => itemJson(m, i, { includes })),
        query,
        url,
      );
    },
  },
  {
    // Show module item (ContextModuleItemsApiController#show)
    path: '/api/v1/courses/:courseId/modules/:moduleId/items/:itemId',
    handler: ({ params, query }) => {
      const found = findItem(params.courseId, params.moduleId, params.itemId);
      if (!found) return notFound();
      return itemJson(found.m, found.item, { includes: new Set(query.include ?? []) });
    },
  },
  {
    // ContextModuleItemsApiController#select_mastery_path. OverrideHandler answers 404 for a set
    // outside the student's scoring range.
    path: '/api/v1/courses/:courseId/modules/:moduleId/items/:itemId/select_mastery_path',
    method: 'POST',
    handler: ({ params, query, body }) => {
      const found = findItem(params.courseId, params.moduleId, params.itemId);
      if (!found) return notFound();
      const input = { ...(query ?? {}), ...(body && typeof body === 'object' && !(body instanceof Uint8Array) ? body : {}) };
      const setId = input.assignment_set_id == null ? '' : String(input.assignment_set_id);
      if (!setId) return { status: 400, body: { message: 'assignment_set_id required' } };
      if (found.item.type !== 'Assignment')
        return { status: 400, body: { message: 'requested item is not an assignment' } };
      const trigger = assignmentById(found.m.course, found.item.content);
      const range = trigger ? masteryRange(trigger) : null;
      if (!range || !range.sets.includes(setId)) return notFound();
      mastery.selected[trigger.id] = setId;
      const chosen = setAssignments(trigger, setId);
      const items = itemsOf(found.m).filter(
        (i) => i.type === 'Assignment' && chosen.some((a) => a.id === i.content),
      );
      return {
        meta: { primaryCollection: 'assignments' },
        items: items.map((i) => itemJson(found.m, i)),
        assignments: chosen.map((a) => assignmentJson(a)),
      };
    },
  },
  {
    // Development only: forget the chosen paths.
    path: '/fake/mastery/reset',
    method: 'POST',
    public: true,
    handler: () => {
      mastery.selected = {};
      return { ok: true };
    },
  },
  {
    path: '/api/v1/courses/:courseId/modules/:moduleId/items/:itemId/done',
    method: 'PUT',
    handler: ({ params }) => {
      const found = findItem(params.courseId, params.moduleId, params.itemId);
      if (!found) return notFound();
      if (itemLocked(found.m, found.item)) return moduleItemLockedResponse;
      markedDone.add(found.item.id);
      return { message: 'OK' };
    },
  },
  {
    path: '/api/v1/courses/:courseId/modules/:moduleId/items/:itemId/done',
    method: 'DELETE',
    handler: ({ params }) => {
      const found = findItem(params.courseId, params.moduleId, params.itemId);
      if (!found) return notFound();
      markedDone.delete(found.item.id);
      return { message: 'OK' };
    },
  },
  {
    path: '/api/v1/courses/:courseId/modules/:moduleId/items/:itemId/mark_read',
    method: 'POST',
    handler: ({ params }) => {
      const found = findItem(params.courseId, params.moduleId, params.itemId);
      if (!found) return notFound();
      if (itemLocked(found.m, found.item)) return moduleItemLockedResponse;
      viewed.add(found.item.id);
      return { message: 'OK' };
    },
  },
  {
    path: '/api/v1/courses/:courseId/module_item_sequence',
    handler: ({ params, query }) => {
      if (!courseExists(params.courseId)) return notFound();
      if (!query.asset_type || !(query.asset_type === 'ModuleItem' || assetTypes[query.asset_type]))
        return { status: 400, body: { message: 'invalid asset_type' } };
      if (!query.asset_id) return { status: 400, body: { message: 'missing asset_id' } };
      return sequenceJson(params.courseId, query.asset_type, query.asset_id);
    },
  },

  // People
  {
    path: '/api/v1/courses/:courseId/users',
    handler: ({ params, query, url }) => {
      if (!courseExists(params.courseId)) return notFound();
      const includes = new Set(query.include ?? []);
      const types = query.enrollment_type;
      const term = (query.search_term ?? '').toLowerCase();
      const list = roster(params.courseId)
        .filter((p) => !types || types.some((t) => p.type.toLowerCase().startsWith(t.toLowerCase())))
        .filter((p) => !term || p.name.toLowerCase().includes(term))
        .sort((a, b) => a.sortable.localeCompare(b.sortable));
      return paginate(
        list.map((p) => userJson(p, params.courseId, includes)),
        query,
        url,
      );
    },
  },
];
