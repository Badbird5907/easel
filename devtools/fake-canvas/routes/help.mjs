/**
 * The school's help menu and problem reports (SET-11).
 *
 * `GET /api/v1/accounts/:id/help_links` (accounts_controller#help_links,
 * app/models/account/help_links.rb) and `POST /api/v1/error_reports`
 * (errors_controller#create). Fake University customized its menu, so
 * `custom_help_links` replaces Canvas's defaults, as it does for real schools.
 * Reports are kept in memory; read them at /fake/error_reports.
 */
const defaults = [
  {
    available_to: ['student'],
    text: 'Ask Your Instructor a Question',
    subtext: 'Questions are submitted to your instructor.',
    url: '#teacher_feedback',
    type: 'default',
    id: 'instructor_question',
    is_featured: false,
    is_new: false,
    feature_headline: '',
  },
  {
    available_to: ['user', 'student', 'teacher', 'admin', 'observer', 'unenrolled'],
    text: 'Search the Canvas Guides',
    subtext: 'Find answers to common questions.',
    url: 'https://community.canvaslms.com/t5/Canvas/ct-p/canvas',
    type: 'default',
    id: 'search_the_canvas_guides',
    is_featured: true,
    is_new: false,
    feature_headline: 'Little lost? Try here first.',
  },
  {
    available_to: ['user', 'student', 'teacher', 'admin', 'observer', 'unenrolled'],
    text: 'Report a Problem',
    subtext: 'If Canvas misbehaves, tell us about it.',
    url: '#create_ticket',
    type: 'default',
    id: 'report_a_problem',
    is_featured: false,
    is_new: false,
    feature_headline: '',
  },
];

const custom = [
  { ...defaults[1] },
  { ...defaults[0] },
  {
    available_to: ['student', 'user'],
    text: 'Fake University IT Help Desk',
    subtext: 'Passwords, Wi-Fi, and campus accounts. Open 8 AM to 8 PM.',
    url: 'https://example.edu/it-help',
    type: 'custom',
    id: 'link_it_help',
    is_featured: false,
    is_new: true,
    feature_headline: '',
  },
  {
    available_to: ['student'],
    text: 'Writing Help',
    subtext: 'The ENGL 110 guide to essays. A Canvas page, so it opens in the app.',
    url: 'http://localhost:3030/courses/110/pages/essay-2-guide',
    type: 'custom',
    id: 'link_writing_center',
    is_featured: false,
    is_new: false,
    feature_headline: '',
  },
  {
    available_to: ['teacher', 'admin'],
    text: 'Instructor Resources',
    subtext: 'Only instructors see this one.',
    url: 'https://example.edu/teaching',
    type: 'custom',
    id: 'link_teaching',
    is_featured: false,
    is_new: false,
    feature_headline: '',
  },
  { ...defaults[2] },
];

const reports = (globalThis.__fakeCanvasErrorReports ??= []);

export const routes = [
  {
    path: '/api/v1/accounts/:accountId/help_links',
    handler: () => ({
      help_link_name: 'Help',
      help_link_icon: 'help',
      custom_help_links: custom,
      default_help_links: defaults,
    }),
  },
  {
    method: 'POST',
    path: '/api/v1/error_reports',
    handler: ({ body }) => {
      const error = body?.error ?? {};
      if (!error.subject) return { status: 400, body: { errors: [{ message: 'subject is required' }] } };
      const report = { id: String(9000 + reports.length + 1), created_at: new Date().toISOString(), ...error };
      reports.push(report);
      console.log(`Error report ${report.id}: ${report.subject} (${report.user_perceived_severity ?? 'no severity'})`);
      return { logged: true, id: report.id };
    },
  },
];
