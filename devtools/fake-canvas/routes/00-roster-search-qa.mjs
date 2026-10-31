/** ART 101: hidden Pages index, module/home-linked pages, and a large roster. */
import { BASE } from '../data.mjs';
import { paginate } from './core.mjs';
const page = (slug, title) => ({ page_id: slug, url: slug, title, body: '<p>Review course concepts.</p>', html_url: `${BASE}/courses/101/pages/${slug}`, updated_at: '2026-10-01T00:00:00Z', published: true });
const roster = Array.from({ length: 1234 }, (_, i) => ({ id: `qa-${i}`, name: `Roster Person ${String(i).padStart(4, '0')}`, sortable_name: `Roster Person ${String(i).padStart(4, '0')}`, enrollments: [{ type: i === 0 ? 'TeacherEnrollment' : i === 1 ? 'TaEnrollment' : 'StudentEnrollment' }] }));
export const routes = [
  { path: '/api/v1/courses/101/pages', handler: () => ({ status: 403, body: { errors: [{ message: 'Pages navigation disabled' }] } }) },
  { path: '/api/v1/courses/101/front_page', handler: () => ({ ...page('home', 'Course home'), body: '<a href="/courses/101/pages/midterm-review">Midterm review</a>' }) },
  { path: '/api/v1/courses/101/pages/midterm-review', handler: () => page('midterm-review', 'Midterm review') },
  { path: '/api/v1/courses/101/pages/midterm-practice', handler: () => page('midterm-practice', 'Midterm practice') },
  { path: '/api/v1/courses/101/modules', handler: ({ query, url }) => paginate([{ id: 'qa-module', name: 'Midterm preparation', position: 1, items_count: 1, items: [{ id: 'qa-item', module_id: 'qa-module', title: 'Midterm practice', type: 'Page', page_url: 'midterm-practice' }] }], query, url) },
  { path: '/api/v1/courses/101/users', handler: ({ query, url }) => paginate(query.search_term ? roster.filter((p) => p.name.toLowerCase().includes(query.search_term.toLowerCase())) : roster, query, url) },
];
