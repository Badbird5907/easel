/**
 * Placeholder data for building screens before the Canvas API client exists.
 * Shapes are trimmed versions of the Canvas REST resources they stand in for.
 */

export type Course = {
  id: string;
  code: string;
  name: string;
  /** Canvas custom color for the course (users/self/colors). */
  color: string;
  instructor: string;
  /** Current score as a fraction, or null when grades are hidden. */
  score: number | null;
  letter: string | null;
};

export type AssignmentStatus = 'dueToday' | 'upcoming' | 'submitted' | 'missing' | 'graded';
export type AssignmentKind = 'assignment' | 'quiz' | 'discussion' | 'lab';

export type Assignment = {
  id: string;
  courseId: string;
  title: string;
  kind: AssignmentKind;
  dueLabel: string;
  points: number;
  status: AssignmentStatus;
};

export type Announcement = {
  id: string;
  courseId: string;
  author: string;
  title: string;
  preview: string;
  postedLabel: string;
  unread: boolean;
};

export const courses: Course[] = [
  {
    id: 'bio201',
    code: 'BIO 201',
    name: 'Cell Biology',
    color: '#2573DF',
    instructor: 'Dr. Amara Osei',
    score: 0.924,
    letter: 'A-',
  },
  {
    id: 'math241',
    code: 'MATH 241',
    name: 'Multivariable Calculus',
    color: '#9E58BD',
    instructor: 'Prof. Daniel Reyes',
    score: 0.871,
    letter: 'B+',
  },
  {
    id: 'engl110',
    code: 'ENGL 110',
    name: 'Rhetoric & Composition',
    color: '#048660',
    instructor: 'Dr. Hannah Kim',
    score: 0.953,
    letter: 'A',
  },
  {
    id: 'hist150',
    code: 'HIST 150',
    name: 'The Modern World',
    color: '#BF5811',
    instructor: 'Prof. Lucas Moreau',
    score: 0.786,
    letter: 'C+',
  },
  {
    id: 'cs225',
    code: 'CS 225',
    name: 'Data Structures',
    color: '#A31C73',
    instructor: 'Prof. Priya Natarajan',
    score: 0.902,
    letter: 'A-',
  },
  {
    id: 'art101',
    code: 'ART 101',
    name: 'Drawing I',
    color: '#996E00',
    instructor: 'Marco Bellini',
    score: null,
    letter: null,
  },
];

export const assignments: Assignment[] = [
  {
    id: 'a1',
    courseId: 'math241',
    title: 'Problem Set 7: Lagrange Multipliers',
    kind: 'assignment',
    dueLabel: 'Today, 11:59 PM',
    points: 20,
    status: 'dueToday',
  },
  {
    id: 'a2',
    courseId: 'hist150',
    title: 'Reading Response 5',
    kind: 'discussion',
    dueLabel: 'Yesterday, 5:00 PM',
    points: 10,
    status: 'missing',
  },
  {
    id: 'a3',
    courseId: 'bio201',
    title: 'Lab Report: Osmosis',
    kind: 'lab',
    dueLabel: 'Tomorrow, 9:00 AM',
    points: 50,
    status: 'upcoming',
  },
  {
    id: 'a4',
    courseId: 'cs225',
    title: 'MP3: Hash Tables',
    kind: 'assignment',
    dueLabel: 'Fri, 11:59 PM',
    points: 100,
    status: 'upcoming',
  },
  {
    id: 'a5',
    courseId: 'engl110',
    title: 'Essay Draft 2',
    kind: 'assignment',
    dueLabel: 'Submitted Mon',
    points: 40,
    status: 'submitted',
  },
  {
    id: 'a6',
    courseId: 'bio201',
    title: 'Quiz 4: Membrane Transport',
    kind: 'quiz',
    dueLabel: 'Graded',
    points: 25,
    status: 'graded',
  },
];

export const announcements: Announcement[] = [
  {
    id: 'n1',
    courseId: 'cs225',
    author: 'Priya Natarajan',
    title: 'MP3 autograder is live',
    preview: 'You can now submit MP3 for feedback. The final run happens Friday night, so push early.',
    postedLabel: '2h',
    unread: true,
  },
  {
    id: 'n2',
    courseId: 'bio201',
    author: 'Amara Osei',
    title: 'Lab section moved to Room 214',
    preview: 'Thursday’s lab meets in Room 214 while the main lab is being renovated.',
    postedLabel: '1d',
    unread: false,
  },
];

export const courseById = (id: string) => courses.find((c) => c.id === id);
export const assignmentsFor = (courseId: string) => assignments.filter((a) => a.courseId === courseId);

/** Items that need attention: what the To Do tab badge counts. */
export const actionableCount = assignments.filter(
  (a) => a.status === 'dueToday' || a.status === 'missing' || a.status === 'upcoming',
).length;
