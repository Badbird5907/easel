/* global __dirname */
/** Code/API checks only. Run: node --test src/features/outcomes/content-readonly.test.cjs
 * React Native/Expo imports are stubbed; the actual CanvasClient and fetchers run.
 * Synthetic fake Canvas only: localhost:3030 by default, or FAKE_CANVAS_URL for an isolated server.
 * Token dev. No fixture state is mutated.
 */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
const queryCalls = [];
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => {
    if (name === '../query') return { useCanvasQuery: (...args) => { queryCalls.push(args); return args; } };
    if (name === 'expo-router') return { router: {} };
    if (name === 'expo-web-browser') return {};
    if (name === 'react-native') return {};
    if (name === '@/canvas/api/pages') return { FRONT_PAGE: '__front_page__' };
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`)));
    throw new Error(`Unexpected dependency: ${name}`);
  };
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  cache.set(filename, module.exports);
  return module.exports;
}
const { CanvasClient, CanvasError } = load('canvas/client.ts');
const outcomes = load('canvas/api/outcomes.ts');
const portfolios = load('canvas/api/eportfolios.ts');
const links = load('features/content/links.ts');
const navigation = load('features/course/navigation.ts');
const fakeUrl = process.env.FAKE_CANVAS_URL ?? 'http://localhost:3030';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(fakeUrl).hostname), 'Only loopback fake Canvas is allowed');
const client = () => new CanvasClient(fakeUrl, 'dev');

test('native navigation routes only the Outcomes list and own portfolio dashboard', () => {
  const tab = { id: 'outcomes', htmlUrl: '/courses/241/outcomes', label: 'Outcomes', external: false };
  assert.equal(navigation.tabAction(tab, '241', 'modules').target.pathname, '/course/[courseId]/outcomes');
  assert.equal(navigation.tabAction({ ...tab, external: true }, '241', 'modules').kind, 'tool');
  assert.equal(links.resolveCanvasLink('/courses/241/outcomes', 'https://school.test').params.courseId, '241');
  assert.equal(links.resolveCanvasPath('/dashboard/eportfolios'), '/eportfolios');
  assert.equal(links.resolveCanvasLink('https://other.test/courses/241/outcomes', 'https://school.test'), null);
  // A portfolio or outcome detail must not be silently replaced with the list.
  assert.equal(links.resolveCanvasPath('/eportfolios/92001'), null);
  assert.equal(links.resolveCanvasPath('/courses/241/outcomes/91101'), null);
});

const outcomeLink = links.resolveCanvasLink('/courses/241/outcomes', 'https://school.test');
test('content Outcomes URLs open the native screen', () => {
  assert.equal(outcomeLink.pathname, '/course/[courseId]/outcomes');
});

test('account-aware query wrapper is used with distinct feature keys', () => {
  outcomes.useOutcomes('241'); portfolios.useEPortfolios();
  assert.deepEqual(queryCalls.map((call) => call[0]), [['outcomes', '241'], ['eportfolios', 'self']]);
  assert.match(readFileSync(path.join(root, 'canvas/query.tsx'), 'utf8'), /\[account\.id, \.\.\.key\]/);
});

test('mastery preserves zero, absent scales, hidden points and pending n-mastery', () => {
  const o = { id: '1', title: 'Outcome', mastery_points: 0, points_possible: 5 };
  const score = { score: 0, count: 1, links: { outcome: '1' } };
  assert.equal(outcomes.outcomeMastery(o, score).status, 'mastered');
  assert.equal(outcomes.outcomeMastery({ ...o, mastery_points: null }, score).status, 'unknown');
  const hidden = outcomes.outcomeMastery(o, { ...score, hide_points: true });
  assert.equal(hidden.status, 'hidden'); assert.equal(hidden.score, null); assert.equal(hidden.threshold, null);
  const pending = outcomes.outcomeMastery({ ...o, calculation_method: 'n_mastery', calculation_int: 3 }, { ...score, score: null });
  assert.equal(pending.status, 'pending'); assert.match(pending.explanation, /3 scores/);
  assert.equal(outcomes.outcomeMastery(o).status, 'unassessed');
});

test('disabled feature stops before requesting any grades', async () => {
  const c = { getAll: async () => [], get: () => { throw new Error('Must not fetch grades'); } };
  assert.deepEqual(await outcomes.fetchOutcomes(c, '241'), { kind: 'disabled' });
});

test('live outcomes map all mastery states, deduplicate sections and use the course scale', async () => {
  const result = await outcomes.fetchOutcomes(client(), '241');
  assert.deepEqual(result.outcomes.map((o) => o.status), ['mastered', 'not-mastered', 'unassessed', 'pending', 'hidden', 'not-mastered']);
  assert.equal(result.outcomes[5].score, 0);
  const scaled = await outcomes.fetchOutcomes(client(), '225');
  assert.equal(scaled.outcomes[0].threshold, 8);
  assert.equal(scaled.outcomes[0].possible, 10);
  assert.equal(scaled.outcomes[0].status, 'not-mastered');
  assert.deepEqual((await outcomes.fetchOutcomes(client(), '110')).outcomes, []);
});

test('live outcome permission denial, missing endpoint, and unscoped/other-user rejection', async () => {
  await assert.rejects(outcomes.fetchOutcomes(client(), '201'), outcomes.outcomeUnavailable);
  assert.deepEqual(await outcomes.fetchOutcomes(client(), '150'), { kind: 'disabled' });
  const self = await client().get('/api/v1/users/self');
  await assert.rejects(client().get('/api/v1/courses/999/outcome_rollups', { user_ids: [self.id] }), outcomes.outcomeUnavailable);
  for (const query of [undefined, { user_ids: ['other'] }, { user_ids: ['1001', 'other'] }])
    await assert.rejects(client().get('/api/v1/courses/241/outcome_rollups', query), (e) => e.status === 403);
  assert.equal(outcomes.outcomeUnavailable(new CanvasError('invalid token', 401, '/')), false);
});

test('own identity is resolved from self and other-user rollups are discarded', async () => {
  const signal = new AbortController().signal;
  const c = {
    getAll: async (_p, _q, opts) => { assert.equal(opts.signal, signal); return ['student_outcome_gradebook']; },
    get: async (p, q, s) => {
      assert.equal(s, signal);
      if (p.endsWith('/users/self')) return { id: 'owner' };
      assert.deepEqual(q.user_ids, ['owner']); assert.equal(q.aggregate, undefined); assert.equal(q.include_hidden, undefined);
      return { rollups: [{ links: { user: 'other' }, scores: [{ links: { outcome: '1' }, score: 5, count: 1 }] }], linked: { outcomes: [{ id: '1', title: 'Outcome', mastery_points: 3 }] } };
    },
  };
  assert.equal((await outcomes.fetchOutcomes(c, '241', signal)).outcomes[0].status, 'unassessed');
});

test('live portfolio pagination, private metadata, and signed-in browser destination', async () => {
  const c = client();
  const first = await fetch(`${c.baseUrl}/api/v1/users/self/eportfolios`, { headers: c.authHeaders });
  assert.ok(first.headers.get('Link')?.includes('rel="next"'));
  assert.equal((await first.json()).length, 2);
  const result = await portfolios.fetchEPortfolios(c);
  assert.equal(result.length, 3);
  assert.equal(result.filter((p) => !p.public).length, 2);
  assert.equal(result[0].title, 'Writing & reflection');
  const token = await c.get('/api/v1/login/session_token', { return_to: c.baseUrl + result[0].path });
  assert.equal(token.session_url, c.baseUrl + '/eportfolios/92003');
  assert.equal((await fetch(token.session_url)).status, 200); // HTML placeholder, not real session verification.
});

test('live portfolio empty/denied scenarios and own-user filtering', async () => {
  assert.deepEqual(await client().get('/api/v1/users/self/eportfolios', { scenario: 'empty' }), []);
  await assert.rejects(client().get('/api/v1/users/self/eportfolios', { scenario: 'denied' }), portfolios.ePortfoliosUnavailable);
  await assert.rejects(client().get('/api/v1/users/other/eportfolios'), portfolios.ePortfoliosUnavailable);
  const signal = new AbortController().signal;
  const c = {
    get: async (p, _q, s) => { assert.equal(p, '/api/v1/users/self'); assert.equal(s, signal); return { id: 'owner' }; },
    getAll: async (p, _q, opts) => {
      assert.equal(p, '/api/v1/users/self/eportfolios'); assert.equal(opts.signal, signal);
      return [{ id: '1', user_id: 'other', name: 'Secret' }, { id: '2', user_id: 'owner', workflow_state: 'deleted' }, { id: '3', user_id: 'owner', name: 'Mine', public: false }];
    },
  };
  assert.deepEqual((await portfolios.fetchEPortfolios(c, signal)).map((p) => p.title), ['Mine']);
});

test('CanvasClient abort signals reach the live API', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(portfolios.fetchEPortfolios(client(), controller.signal), (e) => e.name === 'AbortError');
});
