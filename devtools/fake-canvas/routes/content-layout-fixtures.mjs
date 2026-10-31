/** Layout stress page, isolated from the normal fake course fixtures. */
import { BASE, at } from '../data.mjs';

const body = `<h2>Tutorial Sections and Assigned TAs</h2>
<p>Please verify tutorial locations on ACORN. Tutorial locations may change due to ongoing construction or other reasons.</p>
<p>Have questions about tutorials? Please contact your assigned TA directly.</p>
<table style="width:100%;table-layout:fixed"><thead><tr>${['Lec', 'Sctn', 'Day', 'Begin', 'Ends', 'Building', 'Room', 'TA'].map((s) => `<th>${s}</th>`).join('')}</tr></thead>
<tbody>${Array.from({ length: 8 }, (_, i) => `<tr><td>TUT</td><td>${101 + i}</td><td>Wed</td><td>10:00</td><td>11:00</td><td>${i % 2 ? 'UC' : 'SS'}</td><td>2114</td><td>${i % 2 ? 'AT Craig' : 'Magdalee Brunache'}</td></tr>`).join('')}</tbody></table>
<h3>A narrow table</h3><table><tr><th>Week</th><th>Topic</th></tr><tr><td>1</td><td>Democracy</td></tr></table>
<h3>Wide code</h3><pre><code>const tutorial = { lecture: 'POL106H1', section: 'TUT101', day: 'Wednesday', begin: '10:00', ends: '11:00', building: 'SS', room: '2114' };</code></pre>
<h3>Large image</h3><img width="1600" height="400" alt="Wide layout sample" src="${BASE}/fake/layout-image.svg" />
<p>End of page. Vertical scrolling should remain independent of the table.</p>`;

export const routes = [
  // A separate course keeps long-title QA from changing the shared course fixtures.
  { path: '/api/v1/courses/999901', handler: () => ({
    id: '999901', course_code: 'POL106H1 F LEC5101',
    name: 'POL106H1 F LEC5101 20269: Contemporary Challenges to Democracy: Democracy in the Social Media Age',
    workflow_state: 'available', default_view: 'modules',
    term: { id: '1', name: '2026 Fall' },
    teachers: [{ id: '999901', display_name: 'Layout QA instructor' }],
    enrollments: [{ type: 'student', enrollment_state: 'active' }],
  }) },
  { path: '/api/v1/courses/999901/tabs', handler: () => [
    { id: 'modules', label: 'Modules', type: 'internal', position: 1, hidden: false,
      html_url: `${BASE}/courses/999901/modules` },
  ] },
  { path: '/api/v1/courses/999901/modules', handler: () => [] },
  { path: '/api/v1/courses/:courseId/pages/qa-layout', handler: ({ params }) => ({
    page_id: '999901', url: 'qa-layout', title: 'Tutorial sections and assigned teaching assistants for Contemporary Challenges to Democracy',
    body, created_at: at(-10, 9), updated_at: at(-1, 9), front_page: false, published: true,
    html_url: `${BASE}/courses/${params.courseId}/pages/qa-layout`, editing_roles: 'teachers', locked_for_user: false,
  }) },
  { path: '/fake/layout-image.svg', public: true, handler: () => ({ headers: { 'Content-Type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><rect width="1600" height="400" fill="lightgray"/><text x="40" y="200" font-size="80">Wide image: scales to page width</text></svg>' }) },
];
