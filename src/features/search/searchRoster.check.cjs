/* global __dirname */
/* API regression checks with synthetic, read-only clients. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const sources = {
  './assignments': { fetchAssignmentGroups: async () => ({ assignments: [] }) },
  './pages': { fetchPages: async () => { throw new Error('Forbidden'); } },
  './modules': { fetchModules: async () => [{ id: 'm', name: 'Review', items: [{ id: 'i', type: 'Page', pageUrl: 'midterm', title: 'Midterm practice' }] }] },
  './discussions': { fetchDiscussions: async () => [] },
  './tabs': {}, '../query': {}, '../session': {}, '@tanstack/react-query': {},
  '@/features/offline/connectivity': {}, '../client': { CanvasError: class extends Error {} },
};
function load(file) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', js)((name) => { assert.ok(name in sources, name); return sources[name]; }, module, module.exports);
  return module.exports;
}
(async () => {
  const search = load('canvas/api/search.ts');
  const index = await search.fetchSearchIndex({ get: async (url) => url.endsWith('front_page') ? { body: '<a href="/courses/42/pages/review">Review</a><a href="/courses/99/pages/private">Other course</a>' } : { page_id: 'p', url: 'review', title: 'Midterm review' } }, '42');
  assert.deepEqual(index.unavailable, ['page']);
  assert.equal(search.searchTitles(index.results, 'midterm').length, 2);
  assert.ok(!index.results.some((r) => r.pageUrl === 'private'));
  const people = load('canvas/api/people.ts');
  const requests = [];
  const client = { getPage: async (_url, query) => { query ??= { page: 2 }; requests.push(query); return { next: query.page === 1 ? '/next' : null, items: Array.from({ length: query.page === 1 ? 50 : 7 }, (_, i) => ({ id: `${query.page}-${i}`, name: 'Person' })) }; } };
  const first = await people.fetchPeoplePage(client, '42', 'Person', 1);
  assert.equal(first.people.length, 50); assert.equal(first.next, '/next');
  const second = await people.fetchPeoplePage(client, '42', 'Person', first.next);
  assert.equal(second.next, undefined); assert.equal(requests[0].search_term, 'Person');
  console.log('Search partial coverage, reachable pages, and bounded server-side roster search passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
