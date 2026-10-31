/** Snapshot Canvas-shaped GET responses in Node; no dev-server code enters the app. */
import { Buffer } from 'node:buffer';
import { readdir, writeFile } from 'node:fs/promises';
import { courses, user, NOW } from '../devtools/fake-canvas/data.mjs';
user.name = 'Demo Student';
user.short_name = 'Demo';
user.sortable_name = 'Student, Demo';
courses.splice(4);
const routes = [];
for (const file of (await readdir(new URL('../devtools/fake-canvas/routes/', import.meta.url))).sort()) {
  if (!file.endsWith('.mjs')) continue;
  const mod = await import(`../devtools/fake-canvas/routes/${file}`);
  routes.push(
    ...(mod.routes ?? []).filter(
      (r) =>
        (!r.method || r.method === 'GET') &&
        r.path.startsWith('/api/v1/') &&
        !/login|preview|upload|oauth/.test(r.path),
    ),
  );
}
const snapshots = {};
const imageData = 'DEMO_CELL_IMAGE';
const allowedCourses = new Set(['201', '241', '110', '150']);
const ids = new Set(['self', '1001']);
function scan(value) {
  if (Array.isArray(value)) return value.forEach(scan);
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (
      (k === 'id' || k.endsWith('_id') || k === 'url') &&
      (typeof v === 'string' || typeof v === 'number') &&
      !String(v).includes('/')
    )
      ids.add(String(v));
    scan(v);
  }
}
function curate(value) {
  if (Array.isArray(value))
    return value
      .filter(
        (v) =>
          !/\bQA[: -]|qa-layout|931[0-9]|999901/.test(JSON.stringify(v)) &&
          (!v?.course_id || allowedCourses.has(String(v.course_id))) &&
          (!v ||
            typeof v !== 'object' ||
            (![
              '301',
              '302',
              '303',
              '304',
              '305',
              '401',
              '402',
              '501',
              '502',
              '999901',
              '306',
              '225',
              '101',
              '9310',
              '9311',
              '9312',
              '9313',
              '9314',
              '9315',
            ].includes(String(v.id)) &&
              !String(v.url ?? '').includes('qa-') &&
              !String(v.title ?? v.name ?? '').match(/QA|fixture|stress|mastery/i))),
      )
      .map(curate);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(avatar_url|thumbnail_url|image_download_url|preview_url)$/.test(k)
          ? null
          : k === 'hide_final_grades'
            ? false
            : curate(v),
      ]),
    );
  if (typeof value === 'string')
    return value
      .replace(
        /<(?:iframe|video|audio)\b[\s\S]*?<\/(?:iframe|video|audio)>/gi,
        '<p>Not available in demo mode.</p>',
      )
      .replace(/<img\b[^>]*>/gi, '')
      .replaceAll('Evan Student', 'Demo Student')
      .replaceAll('Evan', 'Demo')
      .replaceAll('http://localhost:3030', 'https://demo.easel.invalid');
  return value;
}
async function capture(route, params) {
  const path = route.path.replace(/:(\w+)/g, (_, k) => encodeURIComponent(params[k]));
  if (path in snapshots) return;
  try {
    const url = new URL(path, 'https://demo.easel.invalid');
    const query = {
      per_page: '100',
      context_codes: courses.map((c) => `course_${c.id}`),
      start_date: '2000-01-01',
      end_date: '2100-01-01',
      include: [
        'assignments',
        'submission',
        'score_statistics',
        'total_scores',
        'email',
        'teachers',
        'term',
        'items',
        'content_details',
        'submission_history',
        'submission_comments',
        'rubric_assessment',
        'can_submit',
        'grading_scheme',
        'student_entered_score',
      ],
      all_events: 'true',
    };
    const result = await route.handler({
      params,
      query,
      url,
      req: { headers: { host: 'demo.easel.invalid' } },
    });
    if (result?.status >= 400) return;
    const body =
      result && 'body' in result && ('status' in result || 'headers' in result) ? result.body : result;
    if (body == null || Buffer.isBuffer(body)) return;
    snapshots[path] = curate(body);
    scan(snapshots[path]);
  } catch {
    /* Unsupported server-only route, deliberately excluded. */
  }
}
// Collections first, then their discovered detail IDs. Three passes discover nested module items.
for (let pass = 0; pass < 3; pass++) {
  for (const route of routes) {
    const keys = [...route.path.matchAll(/:(\w+)/g)].map((m) => m[1]);
    const walk = async (index, params) => {
      if (index === keys.length) return capture(route, params);
      const key = keys[index];
      const values =
        key === 'courseId'
          ? ['201', '241', '110', '150']
          : key === 'userId'
            ? ['self', '1001']
            : [...ids].filter((id) => !id.includes(':'));
      // Nested generic IDs are resolved from URLs recorded in parent responses below.
      if (keys.filter((k) => !['courseId', 'userId'].includes(k)).length > 1) return;
      for (const value of values) await walk(index + 1, { ...params, [key]: value });
    };
    await walk(0, {});
  }
}
for (const courseId of allowedCourses) {
  const modules = snapshots[`/api/v1/courses/${courseId}/modules`] ?? [];
  for (const module of modules) {
    for (const route of routes.filter(
      (r) => r.path.includes('/:moduleId/items') && !r.path.includes(':itemId'),
    ))
      await capture(route, { courseId, moduleId: module.id });
  }
}
for (const courseId of allowedCourses) {
  const base = `/api/v1/courses/${courseId}`;
  snapshots[`${base}/front_page`] ??= {
    page_id: courseId,
    url: 'welcome',
    title: 'Welcome to the course',
    published: true,
    body: '<h2>Welcome</h2><p>Read the weekly material, discuss your ideas, and check the assignments before your next class.</p>',
  };
  snapshots[`${base}/pages/welcome`] = snapshots[`${base}/front_page`];
  const pages = (snapshots[`${base}/pages`] ??= []);
  if (!pages.length) pages.push(snapshots[`${base}/front_page`]);
  const files = (snapshots[`${base}/files`] ??= []);
  for (const [prefix, name, type] of [
    ['96', 'Course guide.pdf', 'application/pdf'],
    ['97', 'Cell diagram.png', 'image/png'],
  ]) {
    const id = prefix + courseId;
    const file = {
      id,
      display_name: name,
      filename: name,
      'content-type': type,
      size: 3500,
      url: `https://demo.easel.invalid/files/${id}/download`,
      locked: false,
      locked_for_user: false,
      hidden: false,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    };
    files.push(file);
    snapshots[`/api/v1/files/${id}`] = file;
  }
  const quizzes = (snapshots[`${base}/quizzes`] ??= []);
  if (!quizzes.length) {
    const id = '95' + courseId;
    const quiz = {
      id,
      title: 'Weekly knowledge check',
      description: '<p>Review this week’s ideas with a short practice quiz.</p>',
      quiz_type: 'practice_quiz',
      published: true,
      question_count: 1,
      points_possible: 1,
      time_limit: null,
      allowed_attempts: -1,
      shuffle_answers: false,
      one_question_at_a_time: false,
      html_url: `https://demo.easel.invalid/courses/${courseId}/quizzes/${id}`,
      due_at: null,
      locked_for_user: false,
    };
    quizzes.push(quiz);
    snapshots[`${base}/quizzes/${id}`] = quiz;
    snapshots[`${base}/quizzes/${id}/submissions`] = { quiz_submissions: [] };
  }
  const modules = (snapshots[`${base}/modules`] ??= []);
  if (!modules.length) {
    const id = '98' + courseId;
    const items = [
      {
        id: '99' + courseId,
        module_id: id,
        title: 'Welcome to the course',
        type: 'Page',
        page_url: 'welcome',
        position: 1,
        indent: 0,
        completion_requirement: { type: 'must_mark_done', completed: false },
      },
    ];
    modules.push({
      id,
      name: 'Start here',
      position: 1,
      items_count: 1,
      items,
      prerequisite_module_ids: [],
      state: 'unlocked',
      published: true,
    });
    snapshots[`${base}/modules/${id}/items`] = items;
  }
}
for (const [path, body] of Object.entries(snapshots)) {
  if (/\/pages\/|\/front_page$/.test(path) && body?.body)
    body.body +=
      '<h2>Cell structure reference</h2><img alt="A labelled cell diagram" src="' +
      imageData +
      '"><table><thead><tr><th>Structure</th><th>Function</th><th>Evidence</th><th>Method</th><th>Notes</th></tr></thead><tbody><tr><td>Nucleus</td><td>Stores DNA</td><td>Microscopy</td><td>Fluorescent staining</td><td>Compare your observations with the diagram above.</td></tr></tbody></table>';
}
// Store duplicate bodies once (many optional endpoints return the same empty collection).
for (const path of Object.keys(snapshots)) {
  const match = path.match(/^\/api\/v1\/courses\/(\d+)/);
  if (match && !allowedCourses.has(match[1])) delete snapshots[path];
}
const bodies = [],
  lookup = new Map(),
  responses = {};
for (const [path, body] of Object.entries(snapshots)) {
  const key = JSON.stringify(body);
  if (!lookup.has(key)) {
    lookup.set(key, bodies.length);
    bodies.push(body);
  }
  responses[path] = lookup.get(key);
}
await writeFile(
  new URL('../src/features/demo/data.json', import.meta.url),
  JSON.stringify({ anchor: NOW.toISOString(), responses, bodies }),
);
console.log(`Demo: ${Object.keys(snapshots).length} snapshots`);
