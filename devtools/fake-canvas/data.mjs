/**
 * Shared fixture data. Dates are relative to server start so "due today"
 * stays true. Feature route files import from here and add their own data.
 */

export const NOW = new Date();

/** A date `days` from today at hh:mm local time, as an ISO string. */
export function at(days, hours, minutes = 0) {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

export const BASE = `http://localhost:${process.env.PORT ?? 3030}`;

export const user = {
  id: '1001',
  name: 'Evan Student',
  short_name: 'Evan',
  sortable_name: 'Student, Evan',
  avatar_url: null,
  locale: null,
  effective_locale: 'en',
  primary_email: 'student@example.edu',
  login_id: 'student',
};

export const courses = [
  {
    id: '201',
    code: 'BIO 201',
    name: 'Cell Biology',
    color: '#2573DF',
    teacher: 'Dr. Amara Osei',
    score: 92.4,
    grade: 'A-',
  },
  {
    id: '241',
    code: 'MATH 241',
    name: 'Multivariable Calculus',
    color: '#9E58BD',
    teacher: 'Prof. Daniel Reyes',
    score: 87.1,
    grade: 'B+',
  },
  {
    id: '110',
    code: 'ENGL 110',
    name: 'Rhetoric & Composition',
    color: '#048660',
    teacher: 'Dr. Hannah Kim',
    score: 95.3,
    grade: 'A',
  },
  {
    id: '150',
    code: 'HIST 150',
    name: 'The Modern World',
    color: '#BF5811',
    teacher: 'Prof. Lucas Moreau',
    score: 78.6,
    grade: 'C+',
  },
  {
    id: '225',
    code: 'CS 225',
    name: 'Data Structures',
    color: '#A31C73',
    teacher: 'Prof. Priya Natarajan',
    score: 90.2,
    grade: 'A-',
  },
  {
    id: '101',
    code: 'ART 101',
    name: 'Drawing I',
    color: '#996E00',
    teacher: 'Marco Bellini',
    score: null,
    grade: null,
  },
  // Every grade state in one course; fixtures and totals in routes/assignment-grading.mjs.
  // `score` is the all-periods current score that file computes.
  {
    id: '306',
    code: 'STAT 306',
    name: 'Statistical Inference',
    color: '#00828E',
    teacher: 'Prof. Ines Duarte',
    score: 76.43,
    grade: 'C',
  },
];

export const courseById = (id) => courses.find((c) => c.id === String(id));

/** Assignments and other gradable items, as planner-ready fixtures. */
export const work = [
  {
    id: '9001',
    course: '241',
    type: 'assignment',
    title: 'Problem Set 7: Lagrange Multipliers',
    due: at(0, 23, 59),
    points: 20,
    sub: {},
  },
  {
    id: '9002',
    course: '150',
    type: 'discussion_topic',
    title: 'Reading Response 5',
    due: at(-1, 17),
    points: 10,
    sub: { missing: true },
  },
  {
    id: '9003',
    course: '201',
    type: 'assignment',
    title: 'Lab Report: Osmosis',
    due: at(1, 9),
    points: 50,
    sub: {},
  },
  {
    id: '9004',
    course: '110',
    type: 'discussion_topic',
    title: 'Peer Review: Essay 2',
    due: at(1, 17),
    points: 10,
    sub: {},
  },
  {
    id: '9005',
    course: '225',
    type: 'assignment',
    title: 'MP3: Hash Tables',
    due: at(3, 23, 59),
    points: 100,
    sub: {},
  },
  {
    id: '9006',
    course: '241',
    type: 'quiz',
    title: 'Quiz 3: Partial Derivatives',
    due: at(5, 10),
    points: 15,
    sub: {},
  },
  {
    id: '9007',
    course: '110',
    type: 'assignment',
    title: 'Essay Draft 2',
    due: at(-2, 23, 59),
    points: 40,
    sub: { submitted: true },
  },
  {
    id: '9008',
    course: '201',
    type: 'quiz',
    title: 'Quiz 4: Membrane Transport',
    due: at(-4, 10),
    points: 25,
    sub: { submitted: true, graded: true },
  },
];

export const announcements = [
  {
    id: '7001',
    course: '225',
    title: 'MP3 autograder is live',
    author: 'Priya Natarajan',
    posted: at(0, -2 + new Date().getHours()),
    unread: true,
    message:
      '<p>You can now submit <strong>MP3</strong> for feedback. The final run happens Friday night, so push early.</p><p>Office hours move to <a href="https://example.edu/oh">Siebel 0216</a> this week.</p>',
  },
  {
    id: '7002',
    course: '201',
    title: 'Lab section moved to Room 214',
    author: 'Amara Osei',
    posted: at(-1, 15),
    unread: false,
    message: '<p>Thursday’s lab meets in Room 214 while the main lab is being renovated.</p>',
  },
];
