/* global __dirname */
/** Fresh production transpilation. Synthetic hooks, clients, native props, preferences,
 * session and browser boundaries only: no real launch, auth or React Compiler claim. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..'), cache = new Map();
let scope;
const calls = [], queries = [], alerts = [];
const state = { queries: {}, online: true, mode: undefined, gate: 'open' };
const react = {
  useState(initial) {
    const s = scope, i = s.cursor++;
    if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [s.slots[i], v => { s.slots[i] = typeof v === 'function' ? v(s.slots[i]) : v; }];
  },
  useRef(value) { return react.useState(() => ({ current: value }))[0]; },
  useMemo(fn, deps) {
    const r = react.useRef();
    if (!r.current || deps.some((d, i) => !Object.is(d, r.current.deps[i]))) r.current = { deps, value: fn() };
    return r.current.value;
  },
  useLayoutEffect(fn, deps) {
    const s = scope, i = s.cursor++, old = s.slots[i];
    if (!old || !deps || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
      const slot = { deps }; s.slots[i] = slot;
      s.effects.push(() => { old?.cleanup?.(); slot.cleanup = fn(); });
    }
  },
  useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
  useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
};
const jsx = (type, props, key) => ({ type, props, key });
const client = {
  baseUrl: 'https://school.invalid',
  async get(...args) {
    calls.push(['get', ...args]);
    if (state.wait) await state.wait;
    if (state.launchError) throw state.launchError;
    return args[0].includes('module_item_sequence') ? { items: [{ current: { module_id: 'resolved' } }] } : state.target;
  },
  async post(...args) { calls.push(['post', ...args]); },
};
async function signed(...args) { calls.push(['signed', ...args]); if (state.openWait) await state.openWait; if (state.openError) throw state.openError; }
const listNavigation = { isFocused: () => true, getState: () => ({ index: 0, routes: [{ key: 'list' }] }), addListener: () => () => {} };
const mock = {
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': new Proxy({ Platform: { OS: 'ios' }, Alert: { alert: (...args) => alerts.push(args) } }, { get: (o, k) => o[k] ?? k }),
  'lucide-react-native': new Proxy({}, { get: (_o, k) => k }),
  'expo-image': { Image: 'Image' },
  'expo-router': { useNavigation: () => listNavigation, useRoute: () => ({ key: 'list' }), useIsFocused: () => true, Stack: { Screen: 'Stack.Screen' }, useLocalSearchParams: () => ({ courseId: 'c /' }) },
  'expo-web-browser': { WebBrowserPresentationStyle: { FULL_SCREEN: 'full' }, openBrowserAsync: async (...args) => { calls.push(['browser', ...args]); if (state.browserError) throw state.browserError; } },
  '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: x => calls.push(['invalidate', x]) }) },
  '@/design': new Proxy({ useTheme: () => ({ colors: { accentFg: 'accent', bg: 'bg' } }) }, { get: (o, k) => o[k] ?? k }),
  '@/canvas/session': { useCanvas: () => ({ client, account: { id: 'account', baseUrl: client.baseUrl } }) },
  '@/canvas/query': { useCanvasQuery: (key, fn, options) => { queries.push({ key, fn, options }); return state.queries[key.join('/')] ?? { isPending: true }; } },
  '@/features/course/CourseScope': { CourseScope: 'CourseScope' },
  '@/features/course/TabGate': { TabDisabled: 'TabDisabled', useTabGate: (courseId, tab) => { state.gateArgs = [courseId, tab]; return state.gate; } },
  '@/features/course/states': { ListSkeleton: 'ListSkeleton', LoadError: 'LoadError', useRefreshControl: keys => ({ keys }) },
  '@/features/offline/useOnline': { useOnline: () => state.online },
  '@/features/content/browser': { useOpenSignedIn: () => signed, openSignedIn: signed, sessionUrl: async (...args) => { await signed(...args); return 'https://signed.invalid/fallback'; } },
  '@/features/web/open': { QUIZ_LEAVE_GUARD: 'original guard', openWebView: x => calls.push(['webview', x]) },
  '@/features/lti/preferences': { toolOpenMode: async (...args) => { calls.push(['mode', ...args]); return state.mode; }, useToolOpenMode: (...args) => ({ mode: state.mode ?? args[2], setMode: value => { calls.push(['setMode', ...args.slice(0, 2), value]); state.mode = value; } }) },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.') ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name)) : name;
  if (mock[key]) return mock[key];
  assert.ok(key.startsWith('@/'), `Unmocked dependency: ${key}`);
  const file = ['.ts', '.tsx', '/index.ts'].map(ext => path.join(root, key.slice(2)) + ext).find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  let source = fs.readFileSync(file, 'utf8');
  if (key === '@/features/outcomes/OutcomeList') source += '\nexport { OutcomeRow };';
  if (key === '@/app/(app)/tools') source += '\nexport { ToolRow, ToolLaunchRow };';
  const js = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', js)(n => load(n, file), module, module.exports);
  return module.exports;
}
function harness(fn) { const s = { slots: [], cursor: 0, effects: [] }; return props => { scope = s; s.cursor = 0; try { const result = fn(props); while (s.effects.length) s.effects.shift()(); return result; } finally { scope = null; } }; }
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, type, test = () => true) => nodes(tree).find(n => n.type === type && test(n.props))?.props;
const text = tree => JSON.stringify(tree);
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const success = data => ({ data, isPending: false, isError: false, refetch: async () => { calls.push(['refetch']); return { data }; } });
const i18n = load('@/i18n/runtime'), dates = load('@/lib/dates');
const view = (locale, zone = 'UTC') => { i18n.setAccountLocale('account', locale); dates.setDisplayTimeZone(zone); return i18n.createTranslator(locale); };
const outcomes = load('@/canvas/api/outcomes'), portfolios = load('@/canvas/api/eportfolios'), lti = load('@/canvas/api/lti');
const op = load('@/features/outcomes/presentation').outcomePresentation;
const pp = load('@/features/eportfolios/presentation').portfolioPresentation;
const outcomeUI = load('@/features/outcomes/OutcomeList'), portfolioUI = load('@/features/eportfolios/EPortfolioList');
const launchAPI = load('@/features/lti/launch'), toolUI = load('@/app/(app)/tools');
const { CanvasError, CanvasNetworkError } = load('@/canvas/client');
const rawOutcome = { id: 'o', title: 'Untitled outcome', mastery_points: 3.5, points_possible: 1000.5, calculation_method: 'n_mastery', calculation_int: 3 };
const result = { score: 4.25, count: 1, links: { outcome: 'o' } };
const outcome = Object.freeze(outcomes.outcomeMastery(rawOutcome, result));
const portfolio = Object.freeze(portfolios.toEPortfolio({ id: 'p /', user_id: 'self', name: 'Untitled ePortfolio', public: false, updated_at: '2026-01-01T00:30:00Z' }));
const tool = Object.freeze(lti.toGlobalTool({ definition_id: '42', definition_type: 'ContextExternalTool', name: 'Tool', description: 'Opens in Easel', domain: 'example.invalid', placements: { global_navigation: { html_url: '/accounts/7/external_tools/42?launch_type=global_navigation' } } }, client.baseUrl));
(async () => {
  const catalogs = ['en', 'fr', 'ar'].map(l => load(`@/i18n/${l}`)[l]);
  assert.ok(Object.keys(catalogs[0]).length >= 1222);
  for (const c of catalogs.slice(1)) assert.deepEqual(Object.keys(c).sort(), Object.keys(catalogs[0]).sort());
  const row = harness(outcomeUI.OutcomeRow), list = harness(outcomeUI.OutcomeList), plist = harness(portfolioUI.EPortfolioList), trow = harness(toolUI.ToolRow);
  const screen = harness(toolUI.default), launch = harness(launchAPI.useLaunchTool);
  const oscreen = harness(load('@/app/(app)/course/[courseId]/outcomes').default), pscreen = harness(load('@/app/(app)/eportfolios').default);
  for (const locale of ['en', 'fr', 'ar']) for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const t = view(locale, zone), before = calls.length;
    const labels = op(outcome, locale);
    assert.equal(labels.title, rawOutcome.title);
    assert.ok(labels.score.includes(new Intl.NumberFormat(locale).format(result.score)));
    assert.ok(labels.score.includes(new Intl.NumberFormat(locale).format(rawOutcome.points_possible)));
    assert.ok(labels.threshold.includes(new Intl.NumberFormat(locale).format(rawOutcome.mastery_points)));
    // Do not round a below-mastery score up to the displayed mastery threshold.
    for (const [score, threshold, possible] of [[3.9999, 4, 5], [4, 4.0001, 5.00001], [0.00001, 0.00002, 0.00003], [1e-21, 2e-21, 3e-21]]) {
      const mapped = outcomes.outcomeMastery({ ...rawOutcome, mastery_points: threshold, points_possible: possible }, { ...result, score });
      const shown = op(mapped, locale), number = value => new Intl.NumberFormat(locale, { maximumSignificantDigits: 21 }).format(value);
      assert.equal(mapped.status, 'not-mastered');
      assert.equal(shown.score, t('outcomes.scorePossible', { score: number(score), possible: number(possible) }));
      assert.equal(shown.threshold, t('outcomes.threshold', { threshold: number(threshold) }));
    }
    assert.equal(labels.explanation, t('outcomes.policy.count', { count: 3 }));
    assert.ok(text(row({ outcome })).includes(labels.score));
    const legacy = { ...outcome, explanationMetadata: undefined, explanation: 'Canvas uses your highest score.' };
    assert.equal(op(legacy, locale).explanation, legacy.explanation);
    assert.equal(op({ ...legacy, explanationMetadata: { reason: 'future' } }, locale).explanation, legacy.explanation);
    assert.equal(op(outcomes.outcomeMastery({ ...rawOutcome, title: ' ', display_name: ' ' }), locale).title, t('outcomes.untitled'));
    assert.equal(op(outcomes.outcomeMastery({ ...rawOutcome, display_name: 'Untitled outcome' }), locale).title, 'Untitled outcome');
    for (const [status, raw, score] of [
      ['mastered', rawOutcome, result], ['not-mastered', rawOutcome, { ...result, score: 0 }],
      ['unknown', { ...rawOutcome, mastery_points: null }, result], ['unassessed', rawOutcome, undefined],
      ['pending', rawOutcome, { ...result, score: null }], ['hidden', rawOutcome, { ...result, hide_points: true }],
    ]) {
      const mapped = outcomes.outcomeMastery(raw, score), label = op(mapped, locale);
      assert.equal(mapped.status, status); assert.equal(label.status, t(`outcomes.${status}`));
      if (['hidden', 'unassessed', 'unknown'].includes(status)) assert.deepEqual(mapped.explanationMetadata, { reason: status });
      if (status === 'hidden') {
        assert.equal(mapped.score, null); assert.equal(mapped.possible, null); assert.equal(mapped.threshold, null);
        assert.equal(label.score, null); assert.equal(label.threshold, null);
        assert.equal(label.explanation, t('outcomes.explain.hidden'));
        assert.ok(!text(row({ outcome: mapped })).includes('1000'));
      }
      if (status === 'pending') assert.equal(label.explanation, t('outcomes.explain.pending', { policy: t('outcomes.policy.count', { count: 3 }) }));
    }
    assert.equal(outcomes.outcomeMastery({ ...rawOutcome, mastery_points: 0 }, { ...result, score: 0 }).status, 'mastered');
    for (const bad of [null, undefined, NaN, Infinity, '3']) {
      const m = outcomes.outcomeMastery({ ...rawOutcome, mastery_points: bad, points_possible: bad }, { ...result, score: bad });
      assert.equal(m.score, null); assert.equal(m.possible, null); assert.equal(m.threshold, null);
    }
    for (const [method, key] of [['highest','highest'], ['latest','latest'], ['average','average'], ['decaying_average','decaying'], ['standard_decaying_average','decaying'], ['weighted_average','weighted'], ['__proto__','default'], ['constructor','default'], ['toString','default'], ['future','default']]) {
      const m = outcomes.outcomeMastery({ ...rawOutcome, calculation_method: method }, result);
      assert.equal(op(m, locale).explanation, t(`outcomes.policy.${key}`));
      assert.equal(typeof m.explanation, 'string'); assert.ok(!m.explanation.includes('function'));
    }
    for (const count of [0, 1, 2, 3, 11, 101, 2.5, null, NaN]) {
      const m = outcomes.outcomeMastery({ ...rawOutcome, calculation_int: count }, result);
      assert.equal(op(m, locale).explanation, typeof count === 'number' && Number.isFinite(count) ? t('outcomes.policy.count', { count }) : t('outcomes.policy.repeated'));
    }
    const p = pp(portfolio, locale, zone);
    assert.equal(p.title, 'Untitled ePortfolio'); assert.equal(p.visibility, t('portfolios.private'));
    assert.equal(p.date, t('portfolios.updated', { date: new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(portfolio.updatedAt)) }));
    assert.equal(pp({ ...portfolio, public: true }, locale, zone).visibility, t('portfolios.public'));
    assert.equal(pp({ ...portfolio, updatedAt: null, createdAt: portfolio.updatedAt }, locale, zone).date, t('portfolios.created', { date: new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(portfolio.updatedAt)) }));
    assert.equal(pp({ ...portfolio, updatedAt: null, createdAt: null }, locale, zone).date, null);
    assert.equal(pp(portfolios.toEPortfolio({ id: 'blank', name: ' ' }), locale, zone).title, t('portfolios.untitled'));
    state.queries['outcomes/c /'] = success({ kind: 'available', outcomes: [outcome] }); state.queries['eportfolios/self'] = success([portfolio]);
    let otree = list({ courseId: 'c /' }), ptree = plist();
    assert.equal(otree.props.data[0], outcome); assert.equal(ptree.props.data[0], portfolio);
    assert.equal(otree.props.keyExtractor(outcome), 'o'); assert.equal(ptree.props.keyExtractor(portfolio), 'p /');
    assert.ok(text(ptree.props.renderItem({ item: portfolio })).includes(p.date));
    for (const code of [403, 404, 405, 501]) {
      for (const key of ['outcomes/c /', 'eportfolios/self']) state.queries[key] = { ...state.queries[key], isError: true, error: new CanvasError('secret server', code, '/') };
      assert.deepEqual(list({ courseId: 'c /' }).props.data, []); assert.deepEqual(plist().props.data, []);
      assert.ok(!text(list({ courseId: 'c /' }).props.ListHeaderComponent).includes('secret server'));
    }
    state.queries['outcomes/c /'] = success({ kind: 'disabled' });
    assert.deepEqual(list({ courseId: 'c /' }).props.data, []);
    for (const code of [401, 500]) {
      const error = new CanvasError('Couldn’t load outcomes', code, '/');
      state.queries['outcomes/c /'] = { ...success({ kind: 'available', outcomes: [outcome] }), isError: true, error };
      otree = list({ courseId: 'c /' }); assert.equal(otree.props.data[0], outcome);
      assert.equal(find(otree.props.ListHeaderComponent, 'LoadError').error, error);
    }
    for (const cached of [false, true]) {
      state.online = false;
      state.queries['outcomes/c /'] = success(cached ? { kind: 'available', outcomes: [outcome] } : undefined);
      state.queries['eportfolios/self'] = success(cached ? [portfolio] : undefined);
      assert.ok(text(list({ courseId: 'c /' }).props.ListHeaderComponent).includes(t(cached ? 'outcomes.offlineCached' : 'outcomes.offlineEmpty')));
      ptree = plist(); assert.ok(text(ptree.props.ListHeaderComponent).includes(t(cached ? 'portfolios.offlineCached' : 'portfolios.offlineEmpty')));
      assert.equal(find(ptree.props.ListHeaderComponent, 'Button').disabled, true);
      assert.equal(find(ptree.props.renderItem({ item: portfolio }), 'Button').disabled, true);
    }
    state.online = true;
    state.queries['outcomes/c /'] = success({ kind: 'available', outcomes: [] }); state.queries['eportfolios/self'] = success([]);
    assert.equal(list({ courseId: 'c /' }).props.ListEmptyComponent.props.title, t('outcomes.empty'));
    assert.equal(plist().props.ListEmptyComponent.props.title, t('portfolios.empty'));
    state.queries['outcomes/c /'] = { isPending: true }; state.queries['eportfolios/self'] = { isPending: true };
    assert.equal(list({ courseId: 'c /' }).props.ListEmptyComponent.type, 'ListSkeleton'); assert.equal(plist().props.ListEmptyComponent.type, 'ListSkeleton');
    assert.equal(find(pscreen(), 'Stack.Screen').options.title, t('portfolios.title'));
    for (const gate of ['open', 'hidden', 'loading']) {
      state.gate = gate; const tree = oscreen(); assert.equal(tree.props.title, t('outcomes.title')); assert.deepEqual(state.gateArgs, ['c /', 'outcomes']);
      if (gate === 'hidden') assert.equal(find(tree, 'TabDisabled').label, t('outcomes.title'));
    }
    for (const mode of ['app', 'browser']) {
      state.mode = mode; const tree = trow({ tool, launching: false, onLaunch() {} }), props = find(tree, 'ListItem');
      assert.equal(props.title, 'Tool'); assert.equal(props.subtitle, 'Opens in Easel');
      assert.equal(props.accessibilityHint, t(mode === 'app' ? 'tools.opensApp' : 'tools.opensBrowser'));
      assert.equal(props.accessibilityActions[0].name, 'choose');
      assert.equal(props.chevron, mode === 'app');
      const busy = find(trow({ tool, launching: true, onLaunch() {} }), 'ListItem');
      assert.equal(busy.disabled, true); assert.equal(busy.trailing.props.accessibilityLabel, t('tools.opening', { name: 'Tool' }));
    }
    state.queries['lti/global'] = success([]); assert.equal(find(screen(), 'EmptyState').title, t('tools.empty'));
    state.queries['lti/global'] = { isPending: true }; assert.ok(find(screen(), 'Skeleton'));
    state.queries['lti/global'] = { isError: true, error: new Error('No tools from your school') }; assert.equal(find(screen(), 'Callout').children, 'No tools from your school');
    assert.equal(calls.length, before, 'viewing locale/zone causes no client calls, invalidation, preference writes or launches');
  }
  // Same hook slots retain opening/error/choice state across language changes.
  state.queries['eportfolios/self'] = success([portfolio]); view('en');
  let release; state.openWait = new Promise(r => { release = r; });
  const pendingOpen = find(plist().props.renderItem({ item: portfolio }), 'Button').onPress();
  view('ar'); let busyPortfolio = plist();
  assert.equal(find(busyPortfolio.props.renderItem({ item: portfolio }), 'Button').loading, true);
  assert.equal(find(busyPortfolio.props.ListHeaderComponent, 'Button').disabled, true);
  assert.equal(calls.at(-1)[1], '/eportfolios/p%20%2F');
  state.openError = new Error('Couldn’t open Canvas'); release(); await pendingOpen; state.openWait = null;
  for (const locale of ['fr', 'ar', 'en']) {
    const t = view(locale); const error = find(plist().props.ListHeaderComponent, 'Callout', p => p.tone === 'danger');
    assert.equal(error.title, t('contentLists.openError')); assert.equal(error.children, 'Couldn’t open Canvas');
  }
  state.openError = null;
  await find(plist().props.ListHeaderComponent, 'Button').onPress(); assert.equal(calls.at(-1)[1], '/dashboard/eportfolios');
  await find(list({ courseId: 'c /' }).props.ListHeaderComponent, 'Button').onPress(); assert.equal(calls.at(-1)[1], '/courses/c%20%2F/outcomes');
  const choice = harness(load('@/features/lti/ToolOpenChoice').useToolOpenChoice.bind(null, '42', 'Tool', 'browser'));
  view('en'); choice().choose(); view('ar'); const openChoice = choice();
  assert.equal(openChoice.sheet.props.visible, true); assert.equal(openChoice.sheet.props.title, i18n.t('tool.where', { name: 'Tool' }));
  find(openChoice.sheet, 'ListItem', p => p.title === i18n.t('tool.openApp')).onPress();
  assert.deepEqual(calls.at(-1), ['setMode', 'account', '42', 'app']); assert.equal(choice().sheet.props.visible, false);

  // Fetcher boundaries: scope, filters, signal, inherited Canvas scales, no added pagination requests.
  const signal = new AbortController().signal, fetchCalls = [];
  const c = { getAll: async (...args) => { fetchCalls.push(['all', ...args]); return ['student_outcome_gradebook']; }, get: async (...args) => {
    fetchCalls.push(['get', ...args]); if (args[0].endsWith('/users/self')) return { id: 'owner' };
    return { rollups: [{ links: { user: 'other' }, scores: [{ ...result, score: 99 }] }, { links: { user: 'owner' }, scores: [result] }], linked: { outcomes: [rawOutcome, rawOutcome, { id: 'unassessed', title: 'Mastered' }] } };
  } };
  assert.deepEqual(await outcomes.fetchOutcomes({ getAll: async () => [], get: () => assert.fail('disabled grades fetched') }, 'c'), { kind: 'disabled' });
  const fetched = await outcomes.fetchOutcomes(c, 'c /', signal);
  assert.equal(fetched.outcomes.length, 2); assert.equal(fetched.outcomes[0].score, 4.25); assert.equal(fetched.outcomes[0].threshold, 3.5); assert.equal(fetched.outcomes[1].status, 'unassessed');
  assert.deepEqual(fetchCalls, [
    ['all', '/api/v1/courses/c%20%2F/features/enabled', undefined, { signal }], ['get', '/api/v1/users/self', undefined, signal],
    ['get', '/api/v1/courses/c%20%2F/outcome_rollups', { user_ids: ['owner'], include: ['outcomes'], per_page: 100 }, signal],
  ]);
  await assert.rejects(outcomes.fetchOutcomes({ ...c, get: async p => p.endsWith('/users/self') ? { id: 'owner' } : {} }, 'c'), outcomes.outcomeUnavailable);
  const portfolioCalls = [];
  const owned = await portfolios.fetchEPortfolios({
    get: async (...args) => { portfolioCalls.push(['get', ...args]); return { id: 'owner' }; },
    getAll: async (...args) => { portfolioCalls.push(['all', ...args]); return [
      { id: 'old', user_id: 'owner', name: 'Untitled ePortfolio', public: false, created_at: '2025-01-01' },
      { id: 'other', user_id: 'other', name: 'secret' }, { id: 'deleted', user_id: 'owner', workflow_state: 'deleted' },
      { id: 'new', user_id: 'owner', name: null, public: true, updated_at: '2026-01-01' },
      { id: 'deleted2', user_id: 'owner', deleted_at: '2026-01-01' },
    ]; },
  }, signal);
  assert.deepEqual(owned.map(p => p.id), ['new', 'old']); assert.equal(owned[0].titleFallback, 'untitled'); assert.equal(owned[1].titleFallback, undefined);
  assert.deepEqual(portfolioCalls, [['get', '/api/v1/users/self', undefined, signal], ['all', '/api/v1/users/self/eportfolios', undefined, { signal }]]);
  assert.equal(portfolios.toEPortfolio({ id: 'bad', created_at: 'invalid', updated_at: 'invalid' }).createdAt, null);

  const request = { courseId: 'c', accountId: 'a', toolId: 'context_external_tool_42', launchType: 'course_navigation', assignmentId: 'as', moduleItemId: 'it', moduleId: 'm', resourceLinkLookupUuid: 'lookup', url: 'https://tool.invalid/raw' };
  const req = launchAPI.launchRequest(request, client.baseUrl);
  assert.deepEqual(req, { courseId: 'c', accountId: undefined, toolId: 'context_external_tool_42', launchType: 'module_item', assignmentId: 'as', moduleItemId: 'it', resourceLinkLookupUuid: 'lookup' });
  assert.equal(launchAPI.launchRequest({ assignmentId: 'as', courseId: 'c' }, client.baseUrl).launchType, 'assessment');
  assert.equal(launchAPI.launchRequest({ url: '/api/v1/accounts/7/external_tools/sessionless_launch?id=42' }, client.baseUrl).endpoint, '/api/v1/accounts/7/external_tools/sessionless_launch?id=42');
  assert.equal(launchAPI.launchRequest({ url: '/courses/c/external_tools/42' }, client.baseUrl).toolId, '42');
  assert.equal(launchAPI.launchRequest({ courseId: 'c', url: '/courses/c/external_tools/retrieve?url=https%3A%2F%2Ftool.invalid&resource_link_lookup_uuid=x' }, client.baseUrl).resourceLinkLookupUuid, 'x');
  assert.equal(launchAPI.launchRequest({ url: 'https://tool.invalid' }, client.baseUrl).launchType, undefined);
  assert.equal(lti.toolWebUrl(client.baseUrl, req), 'https://school.invalid/courses/c/modules/items/it');
  assert.equal(lti.toolWebUrl(client.baseUrl, { courseId: 'c', assignmentId: 'as' }), 'https://school.invalid/courses/c/assignments/as');
  assert.equal(lti.toolWebUrl(client.baseUrl, { accountId: 'a', toolId: '42', launchType: 'global_navigation' }), 'https://school.invalid/accounts/a/external_tools/42?launch_type=global_navigation');
  assert.equal(lti.toolWebUrl(client.baseUrl, {}), null);
  for (const locale of ['en', 'fr', 'ar']) {
    view(locale); calls.length = 0; state.target = { id: 42, name: 'Tool', url: '/launch?session_token=synthetic#hash' };
    const target = await launchAPI.launchTarget(client, request);
    assert.deepEqual(calls, [['get', '/api/v1/courses/c/external_tools/sessionless_launch', { id: '42', launch_type: 'module_item', url: undefined, assignment_id: 'as', module_item_id: 'it', resource_link_lookup_uuid: 'lookup' }]]);
    assert.deepEqual(target, { target: { toolId: '42', name: 'Tool', url: 'https://school.invalid/launch?session_token=synthetic#hash', lti13: true }, url: 'https://school.invalid/launch?session_token=synthetic&platform=mobile#hash' });
    mock['react-native'].Platform.OS = 'android'; assert.equal((await launchAPI.launchTarget(client, request)).url, target.target.url); mock['react-native'].Platform.OS = 'ios';
    state.target.url = '/launch?session_token=x&platform=existing'; assert.equal((await launchAPI.launchTarget(client, request)).url, 'https://school.invalid/launch?session_token=x&platform=existing');
    state.target.url = '/launch?verifier=x'; assert.equal((await launchAPI.launchTarget(client, request)).url, 'https://school.invalid/launch?verifier=x');
    calls.length = 0; await lti.fetchSessionlessLaunch(client, { endpoint: '/api/v1/accounts/7/external_tools/sessionless_launch?id=42' });
    assert.deepEqual(calls, [['get', '/api/v1/accounts/7/external_tools/sessionless_launch?id=42']]);
    const t = i18n.createTranslator(locale);
    for (const [err, key] of [[new CanvasNetworkError(), 'network'], [new lti.ToolLaunchError('raw',404),'missing'], [new lti.ToolLaunchError('raw',401),'denied'], [new lti.ToolLaunchError('raw',403),'denied'], [new lti.ToolLaunchError('raw',500),'generic'], [new Error('raw'),'generic']]) {
      state.launchError = err; await launch()({ toolId: '42', title: 'Tool' });
      assert.equal(alerts.at(-1)[0], t('tools.failure.title', { name: 'Tool' }));
      assert.equal(alerts.at(-1)[1], t('tools.failure.fallback', { reason: t(`tools.failure.${key}`) }));
      assert.equal(alerts.at(-1)[2][0].text, t('common.cancel'));
    }
    state.launchError = null;
    for (const server of [null, 'Canvas couldn’t find the settings for this tool.', 'arbitrary server detail']) {
      state.target = server === null ? {} : { errors: { message: server } };
      await assert.rejects(lti.fetchSessionlessLaunch(client, {}), e => e.reason === (server === null ? 'missing-settings' : undefined));
      await launch()({});
      assert.equal(alerts.at(-1)[1], server ?? t('tools.failure.settings')); assert.equal(alerts.at(-1)[2].length, 1);
      assert.equal(alerts.at(-1)[2][0].text, t('tools.ok'));
    }
    state.launchError = new lti.ToolLaunchError('Canvas couldn’t find the settings for this tool.'); await launch()({});
    assert.equal(alerts.at(-1)[1], 'Canvas couldn’t find the settings for this tool.'); state.launchError = null;
    // App launch preserves raw names and guard decisions; generic fallback translated only when absent.
    state.mode = 'app';
    for (const name of [null, 'Tool', 'New Quizzes']) {
      state.target = { id: 42, name, url: '/launch?session_token=x' };
      calls.length = 0; await launch()({ courseId: 'c', toolId: '42' });
      const opened = calls.find(c => c[0] === 'webview')[1];
      assert.equal(opened.title, name ?? t('tools.tool')); assert.equal(opened.guard, name === 'New Quizzes' ? t('quizEntry.leave') : undefined);
      assert.equal(opened.signed, true); assert.deepEqual(opened.tool, { id: '42', name }); assert.equal(opened.courseId, 'c');
      assert.deepEqual(opened.launch, { courseId: 'c', toolId: '42', fallbackUrl: 'https://school.invalid/courses/c/external_tools/42' });
    }
    // Module view behavior remains independent of locale, including lookup when moduleId omitted.
    for (const moduleId of ['m', undefined]) {
      calls.length = 0; await launch()({ courseId: 'c', moduleItemId: 'it', moduleId, guard: 'raw guard', title: 'Quiz' }); await flush();
      assert.ok(calls.some(c => c[0] === 'post' && c[1] === `/api/v1/courses/c/modules/${moduleId ?? 'resolved'}/items/it/mark_read`));
      assert.deepEqual(calls.find(c => c[0] === 'invalidate'), ['invalidate', { queryKey: ['account', 'courses', 'c', 'modules'] }]);
      if (!moduleId) assert.ok(calls.some(c => c[0] === 'get' && c[1].endsWith('/module_item_sequence') && c[2].asset_id === 'it'));
      assert.equal(calls.find(c => c[0] === 'webview')[1].guard, 'raw guard');
    }
    state.mode = 'browser'; state.target = { id: 42, name: 'Raw', url: 'https://tool.invalid/one-time' };
    calls.length = 0; await launch()({ toolId: '42' });
    assert.deepEqual(calls.find(c => c[0] === 'browser'), ['browser', 'https://tool.invalid/one-time', { controlsColor: 'accent', toolbarColor: 'bg', secondaryToolbarColor: 'bg', dismissButtonStyle: 'done', presentationStyle: 'full', enableBarCollapsing: true, showTitle: true }]);
    state.browserError = new Error('synthetic browser failure'); calls.length = 0; await launch()({ toolId: '42', fallbackUrl: '/trusted-fallback' });
    assert.deepEqual(calls.find(c => c[0] === 'signed'), ['signed', client, '/trusted-fallback']); state.browserError = null;
  }
  // Native Alerts keep the invoking translator even if locale changes during network work.
  view('fr'); state.wait = new Promise(r => { release = r; }); state.launchError = new CanvasNetworkError();
  const captured = launch()({ toolId: '42' }); view('ar'); release(); await captured; state.wait = null; state.launchError = null;
  assert.equal(alerts.at(-1)[0], i18n.createTranslator('fr')('tools.failure.title', { name: i18n.createTranslator('fr')('tools.thisTool') }));
  calls.length = 0; await alerts.at(-1)[2][1].onPress(); assert.deepEqual(calls, [['signed', client, 'https://school.invalid/accounts/self/external_tools/42'], ['browser', 'https://signed.invalid/fallback']]);
  // ToolsScreen passes the original global launch input, preserves busy state across locale changes.
  state.queries['lti/global'] = success([tool]); state.target = { id: 42, name: 'Tool', url: '/launch' }; state.mode = 'app'; view('en');
  state.wait = new Promise(r => { release = r; });
  const rowControl = harness(toolUI.ToolLaunchRow);
  const element = rowControl(nodes(screen()).find(n => n.type === toolUI.ToolLaunchRow).props); calls.length = 0;
  const pendingLaunch = element.props.onLaunch(); view('fr');
  assert.equal(rowControl(nodes(screen()).find(n => n.type === toolUI.ToolLaunchRow).props).props.launching, true);
  release(); await pendingLaunch; state.wait = null;
  assert.equal(rowControl(nodes(screen()).find(n => n.type === toolUI.ToolLaunchRow).props).props.launching, false);
  assert.deepEqual(calls.find(c => c[0] === 'get'), ['get', '/api/v1/accounts/7/external_tools/sessionless_launch', { id: '42', launch_type: 'global_navigation', url: undefined, assignment_id: undefined, module_item_id: undefined, resource_link_lookup_uuid: undefined }]);
  assert.deepEqual(calls.find(c => c[0] === 'webview')[1].launch, { toolId: '42', accountId: '7', launchType: 'global_navigation', title: 'Tool', fallbackUrl: tool.webUrl });
  for (const [name, url, session, expected] of [['New Quizzes', null, false, 'app'], ['Studio', null, false, 'app'], ['Custom', 'https://school.invalid/tool', false, 'app'], ['Custom', 'https://x.instructure.com', false, 'app'], ['Custom', 'https://external.invalid', false, 'browser'], [null, null, true, 'app']]) assert.equal(launchAPI.predictOpenMode(name, url, client.baseUrl, session), expected);
  assert.ok(queries.every(q => !q.key.some(k => ['en', 'fr', 'ar'].includes(k))), 'query keys never contain locales');
  console.log(`outcomes/portfolios/tools checks passed (${process.env.TZ ?? 'host TZ'}; en/fr/ar × three Canvas zones; mocked native/session/browser/client boundaries)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
