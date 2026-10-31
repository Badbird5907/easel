const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
/** Fresh production transpilation with synthetic query/client/native boundaries. Hook-slot checks
 * do not establish React reconciliation, Compiler, native focus/RTL/AT, or real Canvas behavior. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..'), cache = new Map();
let scope;
const calls = [], requests = [], queries = [], mutations = [], alerts = [], announcements = [];
const state = { queries: {}, gate: 'visible', params: { courseId: 'c', itemId: 'i' }, pending: false, online: true, mode: 'browser' };
const react = {
  useState(initial) {
    const s = scope, i = s.cursor++;
    if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [s.slots[i], value => { s.slots[i] = typeof value === 'function' ? value(s.slots[i]) : value; }];
  },
  useRef(value) { return react.useState(() => ({ current: value }))[0]; },
  useMemo(fn, deps) {
    const r = react.useRef();
    if (!r.current || deps.some((d, i) => !Object.is(d, r.current.deps[i]))) r.current = { deps, value: fn() };
    return r.current.value;
  },
  useEffect(fn, deps) { react.useMemo(() => { scope.effects.push(fn); }, deps); },
  useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
};
react.useLayoutEffect = (fn, deps) => {
  const s = scope, i = s.cursor++, old = s.slots[i];
  if (!old || !deps || deps.some((v,j) => !Object.is(v, old.deps[j]))) {
    const slot = { deps }; s.slots[i] = slot;
    s.effects.push(() => { old?.cleanup?.(); slot.cleanup = fn(); });
  }
};
const jsx = (type, props, key) => ({ type, props, key });
const qc = {
  getQueryData: () => state.cached,
  setQueryData: (key, data) => { calls.push(['cache', key]); state.cached = data; },
  setQueriesData: (key, fn) => { calls.push(['caches', key]); state.cachedPaths = fn(state.cachedPaths); },
  cancelQueries: x => calls.push(['cancel', x]),
  invalidateQueries: x => calls.push(['invalidate', x]),
  refetchQueries: x => calls.push(['refresh', x]),
};
const client = Object.fromEntries(['put', 'delete', 'post'].map(method => [method, async (...args) => { requests.push([method, ...args]); return {}; }]));
const definitions = [];
function mutation(fn, options) {
  const def = { fn, options }; definitions.push(def);
  // TanStack's mutation functions have stable identity across renders; direct adapter tests
  // outside a component still receive an independent mutation instance.
  const current = scope ? react.useRef(def) : { current: def };
  const methods = scope ? react.useRef(null) : { current: null };
  current.current = def;
  if (!methods.current) {
    const mutate = (value, callbacks) => mutations.push({ ...current.current, value, callbacks });
    const mutateAsync = async value => {
      const active = current.current;
      mutations.push({ ...active, value });
      if (state.wait) await state.wait;
      if (state.error) throw state.error;
      const result = await active.fn(client, value); await active.options?.onSuccess?.(result, value); return result;
    };
    methods.current = { mutate, mutateAsync };
  }
  return { ...methods.current, isPending: state.pending, variables: state.variables };
}
const mock = {
  '@/features/files/FileViewer': { FileViewer: 'FileViewer' },
  '@/features/discussions/TopicView': { TopicView: 'TopicView' },
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': new Proxy({ Alert: { alert: (...args) => alerts.push(args) }, AccessibilityInfo: { announceForAccessibility: s => announcements.push(s) } }, { get: (o, k) => o[k] ?? k }),
  'lucide-react-native': new Proxy({}, { get: (_o, k) => k }),
  'expo-router': { useLocalSearchParams: () => state.params, router: { push: x => calls.push(['push', x]), setParams: x => calls.push(['setParams', x]), canGoBack: () => true, back: () => calls.push('back') } },
  'expo-web-browser': { openBrowserAsync: async url => calls.push(['browser', url]) },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 20 }) },
  '@tanstack/react-query': { useQueryClient: () => qc },
  '@/design': new Proxy({ useTheme: () => ({ colors: {} }), haptics: { success: () => calls.push('success'), error: () => calls.push('error') } }, { get: (o, k) => o[k] ?? k }),
  '@/canvas/session': { useCanvas: () => ({ client, account: { id: 'account', baseUrl: 'https://school.invalid' } }) },
  '@/canvas/query': { useAccountKey: () => state.accountKey ?? 'account', useCanvasMutation: mutation,
    useCanvasQuery: (key, fn, options) => { queries.push({ key, fn, options }); return state.queries[key.join('/')] ?? { isPending: true }; } },
  '@/features/course/CourseScope': { CourseScope: 'CourseScope' },
  '@/features/course/TabGate': { TabDisabled: 'TabDisabled', useTabGate: (...args) => { state.gateArgs = args; return state.gate; } },
  '@/features/course/AssignmentDetails': { AssignmentDetails: 'AssignmentDetails', assignmentKindIcon: { assignment: 'Assignment', quiz: 'Quiz', discussion: 'Discussion' } },
  '@/features/course/QuizDetails': { QuizDetails: 'QuizDetails' },
  '@/features/course/PageContent': { PageContent: 'PageContent' },
  '@/features/quizzes/NewQuizLaunch': { NewQuizLaunch: 'NewQuizLaunch' },
  '@/features/offline/useOnline': { useOnline: () => state.online },
  'expo-network': {},
  '@/features/lti/launch': { predictOpenMode: () => 'browser', useLaunchTool: () => async x => calls.push(['launch', x]) },
  '@/features/lti/preferences': { useToolOpenMode: () => ({ mode: state.mode }) },
  '@/features/lti/ToolOpenChoice': { ToolOpenModeControl: 'ToolOpenModeControl' },
  '@/lib/cn': { cn: (...parts) => parts.filter(Boolean).join(' ') },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  if (isIntlPolyfills(name)) return intlPolyfills;
  const key = name.startsWith('.') ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name)) : name;
  if (mock[key]) return mock[key];
  assert.ok(key.startsWith('@/'), `Unmocked dependency: ${key}`);
  const file = ['.ts', '.tsx', '/index.ts'].map(ext => path.join(root, key.slice(2)) + ext).find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  let source = fs.readFileSync(file, 'utf8');
  if (key === '@/features/course/ModuleList') source += '\nexport { ModuleItemRow, MasteryPathRow, splitAtSubHeaders };';
  if (key === '@/features/course/ModuleItemParts') source += '\nexport { OpenElsewhere, ToolItem, StepButton, OptionAssignments, selectFailure };';
  const js = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', js)(n => load(n, file), module, module.exports);
  return module.exports;
}
function harness(fn) {
  const s = { slots: [], effects: [], cursor: 0 };
  return props => { scope = s; s.cursor = 0; const tree = fn(props); scope = null;
    for (const effect of s.effects.splice(0)) effect(); return tree; };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, type, test = () => true) => nodes(tree).find(n => n.type === type && test(n.props))?.props;
const text = tree => JSON.stringify(tree, (_k, v) => typeof v === 'function' ? undefined : v);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const frozen = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(frozen); } return value; };
const success = data => ({ data, isSuccess: true, isPending: false, isError: false, refetch: async () => { calls.push('refetch'); return { data }; } });
const i18n = load('@/i18n/runtime'), dates = load('@/lib/dates');
const view = (locale, zone = 'UTC') => { i18n.setAccountLocale('account', locale); dates.setDisplayTimeZone(zone); return i18n.createTranslator(locale); };
const api = load('@/canvas/api/modules'), ui = load('@/features/course/ModuleItemParts'), list = load('@/features/course/ModuleList');
const presentation = load('@/features/course/modulePresentation');
const screens = {
  modules: load('@/app/(app)/course/[courseId]/modules').default,
  item: load('@/app/(app)/course/[courseId]/module-item/[itemId]').default,
  paths: load('@/app/(app)/course/[courseId]/module-item/[itemId]/paths').default,
};
const statesUI = load('@/features/course/states');
const { CanvasError, CanvasNetworkError } = load('@/canvas/client');
const { OfflineError } = load('@/features/offline/connectivity');
const raw = frozen({ id: 'i', module_id: 'm', type: 'Assignment', title: 'Choose your path', position: 1, indent: 3, content_id: 'a', html_url: 'https://school.invalid/raw',
  completion_requirement: { type: 'must_mark_done', completed: false }, content_details: { due_at: '2025-01-01T00:30:00Z', points_possible: 2.125, lock_explanation: 'This item is locked.' } });
const item = frozen(api.toModuleItem(raw));
const mod = frozen({ id: 'm', name: 'Module', position: 1, state: 'started', unlockAt: null, sequential: true, requirementType: 'all', prerequisiteIds: [], items: [item] });
const assignment = frozen({ id: 'new', name: 'No due date', kind: 'assignment', points: 0, dueAt: item.dueAt });
const option = frozen({ id: 's1', position: 1, assignments: [assignment, { ...assignment, id: 'new2', name: 'Canvas didn’t accept this choice. Try again.' }] });
const pathData = frozen({ itemId: 'i', moduleId: 'm', locked: false, awaitingChoice: true, processing: false, selectedId: null, options: [option, { id: 's2', position: 2, assignments: [] }] });
const mq = 'courses/c/modules', pq = mq + '/mastery_paths/m', sq = 'courses/c/module_item_sequence/i';
function data(m = mod, p = pathData) { state.queries[mq] = success([m]); state.queries[pq] = success({ i: p }); state.queries[sq] = success({ current: item, prev: { ...item, id: 'prev' }, next: { ...item, id: 'next' }, module: m }); }
(async () => {
  const catalogs = ['en', 'fr', 'ar'].map(l => load(`@/i18n/${l}`)[l]);
  assert.ok(Object.keys(catalogs[0]).length >= 1147, 'retain the integrated catalog while allowing later additive slices');
  for (const c of catalogs.slice(1)) assert.deepEqual(Object.keys(c).sort(), Object.keys(catalogs[0]).sort());
  assert.equal(item.title, raw.title); assert.equal(item.lockExplanation, raw.content_details.lock_explanation);
  const now = new Date('2025-12-31T23:45:00Z');
  const row = harness(list.ModuleItemRow), assignments = harness(ui.OptionAssignments), section = harness(list.ModuleSection);
  const requirement = harness(ui.RequirementCard), screen = harness(screens.modules);
  let chooser = harness(ui.MasteryPathChooser);
  data();
  let previousRow;
  for (const locale of ['en', 'fr', 'ar']) for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const t = view(locale, zone), p = presentation.createModulePresentation(locale, zone);
    for (const date of [item.dueAt, new Date('2026-01-01T00:30:00Z')]) {
      const fmt = options => new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, ...options });
      const sameYear = fmt({ year: 'numeric' }).format(date) === fmt({ year: 'numeric' }).format(now);
      const day = fmt({ month: 'short', day: 'numeric', ...(!sameYear && { year: 'numeric' }) }).format(date);
      assert.equal(p.dateTime(date, now), t('date.at', { day, time: fmt({ hour: 'numeric', minute: '2-digit' }).format(date) }));
    }
    for (const count of [0, 1, 2, 3, 11, 100, 1.125, 2.125, 0.001]) {
      const value = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 2 }).format(Number(count.toFixed(2)));
      assert.equal(p.points(count), t('modules.points', { count, value }));
      const message = load(`@/i18n/${locale}`)[locale]['modules.progressCount'];
      const template = message[new Intl.PluralRules(locale).select(count)] ?? message.other;
      assert.equal(t('modules.progressCount', { done: 0, count }), template.replace('{done}', new Intl.NumberFormat(locale).format(0)).replace('{count}', new Intl.NumberFormat(locale).format(count)));
    }
    assert.equal(p.points(null), null); assert.equal(p.points(undefined), null);
    for (const count of [0, 0.07, 1.125, 99.9999, 100, 1e-21]) {
      assert.equal(p.number(count), new Intl.NumberFormat(locale, { useGrouping: false, maximumSignificantDigits: 21 }).format(count));
      assert.equal(p.percent(count), new Intl.NumberFormat(locale, { style: 'unit', unit: 'percent', unitDisplay: 'narrow', useGrouping: false, maximumSignificantDigits: 21 }).format(count));
    }
    for (const type of ['must_view', 'must_submit', 'must_contribute', 'must_mark_done', 'min_score', 'min_percentage']) for (const completed of [false, true, null]) {
      const req = { type, completed, minScore: 0, minPercentage: 12.125 };
      const tree = requirement({ item: { ...item, requirement: req }, busy: true, onSetDone: x => calls.push(['done', x]) });
      const threshold = type === 'min_score' || type === 'min_percentage';
      assert.equal(p.requirementLabel(req), threshold ? t(completed === true ? 'modules.requirement.threshold.done' : 'modules.requirement.threshold', { value: type === 'min_score' ? p.number(0) : p.percent(12.125) }) : t(`modules.requirement.${type}${completed === true ? '.done' : ''}`));
      if (type === 'must_view' && !completed) assert.equal(tree, null);
      else if (type === 'must_mark_done') {
        assert.equal(find(tree, 'Button').loading, true); find(tree, 'Button').onPress(); assert.deepEqual(calls.pop(), ['done', !completed]);
      } else assert.ok(text(tree).includes(completed ? t('modules.completeRequirement', { requirement: p.requirementLabel(req) }) : p.requirementInstruction(req)));
    }
    const rendered = row({ item, courseId: 'c', marking: true, onMarkDone: x => calls.push(['rowDone', x]) });
    const r = rendered.props;
    assert.equal(r.title, item.title); assert.equal(r.className, 'ps-16'); assert.ok(r.subtitle.includes(p.due(item.dueAt)));
    assert.ok(r.accessibilityLabel.includes(p.kind('Assignment'))); assert.equal(r.trailing.props.loading, true);
    if (previousRow) assert.notEqual(r.subtitle, previousRow); previousRow = r.subtitle;
    r.onAccessibilityAction({ nativeEvent: { actionName: 'markDone' } }); assert.deepEqual(calls.pop(), ['rowDone', item]);
    r.onPress(); assert.deepEqual(calls.pop(), ['push', { pathname: '/course/[courseId]/module-item/[itemId]', params: { courseId: 'c', itemId: 'i' } }]);
    const locked = row({ item: { ...item, locked: true }, courseId: 'c' }).props;
    assert.equal(locked.accessibilityActions, undefined); assert.ok(locked.subtitle.includes(t('modules.locked')));
    const opts = assignments({ option }); assert.equal(find(opts, 'ListItem').title, assignment.name); assert.ok(find(opts, 'ListItem').subtitle.includes(p.due(item.dueAt)));
    assert.ok(text(assignments({ option: pathData.options[1] })).includes(t('modules.emptyOption')));
    const status = list.moduleStatus(mod, [mod], now, p); assert.equal(status.line, `${t('modules.doneCount', { done: 0, count: 1 })} · ${t('modules.sequential')}`);
    assert.equal(list.moduleStatus({ ...mod, requirementType: 'one' }, [], now, p).line, `${t('modules.anyOne')} · ${t('modules.sequential')}`);
    assert.equal(list.moduleStatus({ ...mod, state: 'completed' }, [], now, p).badge.label, t('modules.completed'));
    assert.equal(list.moduleStatus({ ...mod, state: 'locked', unlockAt: new Date('2026-01-01T00:30:00Z') }, [], now, p).line, t('modules.unlocks', { date: p.dateTime(new Date('2026-01-01T00:30:00Z'), now) }));
    const prerequisites = [{ ...mod, id: 'a', name: 'Locked' }, { ...mod, id: 'b', name: 'Modules' }];
    assert.equal(list.moduleStatus({ ...mod, state: 'locked', prerequisiteIds: ['a', 'b'] }, prerequisites, now, p).line, t('modules.prerequisites', { names: new Intl.ListFormat(locale, { type: 'conjunction', style: 'long' }).format(['Locked', 'Modules']) }));
    assert.equal(list.moduleStatus({ ...mod, state: 'locked' }, [], now, p).line, t('modules.instructorLock'));
    const collapsed = section({ module: mod, modules: [mod], expanded: false, courseId: 'c' });
    assert.equal(find(collapsed, 'Pressable').accessibilityState.expanded, false); assert.ok(!text(collapsed).includes(item.title));
    const screenTree = screen(); assert.equal(find(screenTree, 'ProgressBar').value, 0);
    assert.equal(find(screenTree, 'CourseScope').title, t('modules.title'));
    const pathTree = chooser({ courseId: 'c', itemId: 'i' });
    assert.equal(find(pathTree, 'Button').children, t('modules.chooseOption', { position: 1 }));
    assert.deepEqual(nodes(pathTree).filter(n => n.key).map(n => n.key), ['s1', 's2']);
  }
  // Same objects, pending choice, collapsed IDs, cached selection and failures survive relabeling.
  data(); view('en');
  const collapsedScreen = harness(screens.modules);
  let tree = collapsedScreen(); find(tree, list.ModuleSection).onToggle();
  const savedEffects = [calls.length, mutations.length, requests.length];
  for (const locale of ['fr', 'ar', 'en']) {
    const t = view(locale, 'Asia/Tokyo');
    tree = collapsedScreen(); assert.equal(find(tree, list.ModuleSection).expanded, false);
    state.pending = true; state.variables = { setId: 's2', itemId: 'i' };
    const pending = chooser({ courseId: 'c', itemId: 'i' });
    const buttons = nodes(pending).filter(n => n.type === 'Button').map(n => n.props);
    assert.ok(buttons.every(b => b.disabled)); assert.deepEqual(buttons.map(b => b.loading), [false, true]);
    assert.equal(find(tree, list.ModuleSection).module, mod);
    assert.equal(harness(screens.paths)().props.title, t('modules.choosePath'));
  }
  assert.deepEqual([calls.length, mutations.length, requests.length], savedEffects);
  state.pending = false;
  state.online = false; assert.equal(find(chooser({ courseId: 'c', itemId: 'i' }), 'Button').disabled, true); state.online = true;
  // Confirmation and the delayed announcement use the invoking language; no writes just to open it.
  for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale); data();
    chooser = harness(ui.MasteryPathChooser);
    tree = chooser({ courseId: 'c', itemId: 'i' });
    const before = mutations.length; find(tree, 'Button').onPress();
    const alert = alerts.at(-1); assert.equal(mutations.length, before);
    assert.equal(alert[0], t('modules.confirmTitle', { position: 1 })); assert.equal(alert[2][0].style, 'cancel');
    assert.ok(alert[1].includes(new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(option.assignments.map(a => `“${a.name}”`))));
    let release; state.wait = new Promise(resolve => { release = resolve; });
    state.cachedPaths = { i: pathData };
    const choosing = alert[2][1].onPress();
    view(locale === 'ar' ? 'en' : 'ar'); chooser({ courseId: 'c', itemId: 'i' });
    release(); await choosing; state.wait = null;
    assert.equal(announcements.at(-1), t('modules.optionChosen', { position: 1 }));
    assert.deepEqual(requests.at(-1), ['post', '/api/v1/courses/c/modules/m/items/i/select_mastery_path', { assignment_set_id: 's1' }]);
    assert.equal(state.cachedPaths.i.selectedId, 's1'); assert.equal(state.cachedPaths.i.awaitingChoice, false);
    assert.deepEqual(calls.filter(c => c[0] === 'invalidate').slice(-6).map(c => c[1].queryKey), [
      ['account', 'courses', 'c', 'modules'], ['account', 'courses', 'c', 'module_item_sequence'],
      ['account', 'courses', 'c', 'assignment_groups'], ['account', 'courses', 'c', 'syllabus'], ['account', 'grades', 'c'], ['account', 'planner'],
    ]);
  }
  chooser = harness(ui.MasteryPathChooser);
  for (const [error, kind] of [[new OfflineError(), 'offline'], [new CanvasNetworkError(), 'network'], [new CanvasError('raw 404', 404, '/raw'), 'changed'], [new Error('Canvas didn’t accept this choice. Try again.'), 'detail'], [null, 'unknown']]) {
    view('en'); data(); state.error = error;
    // An object without an Error message selects the unknown fallback.
    if (error === null) state.error = {};
    find(chooser({ courseId: 'c', itemId: 'i' }), 'Button').onPress(); await alerts.at(-1)[2][1].onPress();
    const before = [mutations.length, requests.length, calls.length];
    for (const locale of ['en', 'fr', 'ar']) {
      const t = view(locale); const failed = chooser({ courseId: 'c', itemId: 'i' });
      const c = find(failed, 'Callout', p => p.tone === 'danger');
      assert.equal(c.title, t('modules.notChosen'));
      assert.equal(c.children, kind === 'detail' ? t('modules.failure.detail', { detail: error.message }) : t(`modules.failure.${kind}`));
    }
    assert.deepEqual([mutations.length, requests.length, calls.length], before);
  }
  state.error = null;
  // An open confirmation must honor later availability and one-choice state.
  for (const change of ['offline', 'pending', 'selected', 'locked', 'missing', 'optionRemoved', 'moduleChanged', 'routeChanged', 'accountChanged', 'queryError']) {
    data(); state.online = true; state.pending = false; state.accountKey = 'account';
    const render = harness(ui.MasteryPathChooser), props = { courseId: 'c', itemId: 'i' };
    find(render(props), 'Button').onPress(); const confirm = alerts.at(-1)[2][1].onPress;
    if (change === 'offline') state.online = false;
    if (change === 'pending') state.pending = true;
    if (change === 'selected') data(mod, { ...pathData, selectedId: 's2', awaitingChoice: false });
    if (change === 'locked') data(mod, { ...pathData, locked: true });
    if (change === 'missing') state.queries[pq] = success({});
    if (change === 'optionRemoved') data(mod, { ...pathData, options: [{ id: 's3', position: 3, assignments: [] }, pathData.options[1]] });
    if (change === 'moduleChanged') data(mod, { ...pathData, moduleId: 'another' });
    if (change === 'accountChanged') state.accountKey = 'other';
    if (change === 'queryError') state.queries[pq] = { isError: true, error: new Error('raw') };
    render(change === 'routeChanged' ? { ...props, itemId: 'another' } : props);
    const before = [mutations.length, requests.length, announcements.length];
    await confirm(); assert.deepEqual([mutations.length, requests.length, announcements.length], before, change);
  }
  state.online = true; state.pending = false; state.accountKey = 'account'; data();
  const once = harness(ui.MasteryPathChooser), onceProps = { courseId: 'c', itemId: 'i' };
  find(once(onceProps), 'Button').onPress(); const confirmOnce = alerts.at(-1)[2][1].onPress;
  let finishChoice; state.wait = new Promise(resolve => { finishChoice = resolve; });
  const beforeChoice = mutations.length, firstChoice = confirmOnce();
  await confirmOnce(); assert.equal(mutations.length, beforeChoice + 1);
  finishChoice(); await firstChoice; state.wait = null;
  await confirmOnce(); assert.equal(mutations.length, beforeChoice + 1, 'successful choice cannot replay before a query rerender');
  const moving = harness(ui.MasteryPathChooser); find(moving(onceProps), 'Button').onPress();
  state.wait = new Promise(resolve => { finishChoice = resolve; });
  const delayed = alerts.at(-1)[2][1].onPress(); moving({ ...onceProps, itemId: 'another' });
  const beforeLate = [announcements.length, calls.filter(c => c === 'back').length];
  finishChoice(); await delayed; state.wait = null;
  assert.deepEqual([announcements.length, calls.filter(c => c === 'back').length], beforeLate, 'late result cannot navigate a different item');
  data(); chooser = harness(ui.MasteryPathChooser);
  // State decisions: precedence, one-choice restriction, released assignments and missing module.
  for (const [patch, module, expected] of [
    [{ locked: true, processing: true }, mod, 'locked'], [{ processing: true }, mod, 'choose'],
    [{ awaitingChoice: false, processing: true }, mod, 'processing'],
    [{ awaitingChoice: false, selectedId: 's1' }, mod, 'processing'],
    [{ awaitingChoice: false, selectedId: 's1' }, { ...mod, items: [{ ...item, contentId: 'new' }] }, 'released'],
    [{ options: [option] }, mod, 'processing'], [{ options: [option] }, undefined, 'released'],
    [{ options: [], awaitingChoice: false }, mod, 'released'],
  ]) assert.equal(list.masteryPathState({ ...pathData, ...patch }, module), expected);
  for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale);
    for (const selected of [null, 's1']) {
      data(mod, { ...pathData, options: [option], selectedId: selected });
      const single = chooser({ courseId: 'c', itemId: 'i' }); assert.equal(find(single, 'Button'), undefined);
      assert.equal(find(single, 'Callout').title, selected ? t('modules.youChose', { position: 1 }) : t('modules.pathSet'));
    }
    data(mod, { ...pathData, locked: true }); assert.equal(find(chooser({ courseId: 'c', itemId: 'i' }), 'Button'), undefined);
    data(mod, undefined); state.queries[pq] = success({}); assert.equal(find(chooser({ courseId: 'c', itemId: 'i' }), 'Callout').title, t('modules.noPaths'));
    state.queries[pq] = { isPending: true, fetchStatus: 'fetching' }; assert.equal(chooser({ courseId: 'c', itemId: 'i' }).type, statesUI.DetailSkeleton);
    const rawError = new Error('Couldn’t load your paths'); state.queries[pq] = { isError: true, error: rawError };
    const failed = chooser({ courseId: 'c', itemId: 'i' }); assert.equal(failed.props.error, rawError); assert.equal(failed.props.title, t('modules.pathsLoadError'));
    data();
    state.gate = 'hidden'; assert.equal(find(harness(screens.modules)(), 'TabDisabled').label, t('modules.title')); state.gate = 'visible';
    state.queries[mq] = success([]); assert.equal(find(harness(screens.modules)(), 'EmptyState').title, t('modules.empty'));
    data();
  }
  // Subheaders and order are raw; indentation is unchanged. All wrappers preserve content/URLs.
  const groups = list.splitAtSubHeaders([{ ...item, id: 'h', type: 'SubHeader', title: 'This module is empty.' }, item]);
  assert.equal(groups[0].key, 'h'); assert.equal(groups[0].title, 'This module is empty.'); assert.equal(groups[0].items[0], item);
  for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale), content = harness(ui.ModuleItemContent);
    for (const [type, target, idKey] of [['Assignment', 'AssignmentDetails', 'assignmentId'], ['Quiz', 'QuizDetails', 'quizId'], ['Page', 'PageContent', 'pageUrl']]) {
      const result = content({ courseId: 'c', item: { ...item, type, pageUrl: 'raw-slug' } });
      assert.equal(result.type, target); assert.equal(result.props[idKey], type === 'Page' ? 'raw-slug' : 'a');
    }
    assert.equal(content({ courseId: 'c', item: { ...item, quizLti: true } }).type, 'NewQuizLaunch');
    assert.equal(content({ courseId: 'c', item: { ...item, type: 'SubHeader' } }).props.children, item.title);
    for (const [type, pathname] of [['Discussion', '/course/[courseId]/discussion/[topicId]'], ['File', '/file/[fileId]']]) {
      const wrapper = content({ courseId: 'c', item: { ...item, type } }); wrapper.props.onPress();
      assert.equal(calls.at(-1)[1].pathname, pathname);
      assert.equal(wrapper.props.detail, t(`modules.kind.${type}`));
    }
    const external = { ...item, type: 'ExternalUrl', externalUrl: 'https://www.school.invalid/raw?lang=en' };
    const urlWrapper = content({ courseId: 'c', item: external }); await urlWrapper.props.onPress();
    assert.deepEqual(calls.at(-1), ['browser', external.externalUrl]);
    for (const mode of ['browser', 'webview']) {
      state.mode = mode;
      const tool = harness(ui.ToolItem)({ courseId: 'c', item: { ...external, type: 'ExternalTool' } });
      const props = find(tool, ui.OpenElsewhere); await props.onPress();
      assert.deepEqual(calls.at(-1), ['launch', { courseId: 'c', moduleItemId: 'i', moduleId: 'm', url: external.externalUrl, title: item.title, fallbackUrl: item.htmlUrl }]);
      assert.equal(props.action, t(mode === 'browser' ? 'modules.openToolBrowser' : 'modules.openTool'));
    }
    const open = harness(ui.OpenElsewhere);
    assert.equal(find(open({ item: { ...item, locked: true }, detail: 'raw', action: 'raw' }), 'Callout').children, 'This item is locked.');
    assert.equal(find(open({ item: { ...item, locked: true, lockExplanation: null }, detail: 'raw', action: 'raw' }), 'Callout').children, t('modules.itemLocked'));
    assert.equal(find(open({ item: { ...item, locked: true, lockExplanation: '' }, detail: 'raw', action: 'raw' }), 'Callout').children, '');
    let finish; const pendingOpen = open({ item, onPress: () => new Promise(r => { finish = r; }) });
    const opening = find(pendingOpen, 'Button').onPress(); view(locale === 'en' ? 'fr' : 'en');
    assert.equal(find(open({ item }), 'Button').loading, true); finish(); await opening;
    assert.equal(find(open({ item }), 'Button').loading, false);
    const step = harness(ui.StepButton); const next = step({ item, direction: 'next', onPress: x => calls.push(['step', x]) });
    find(next, 'PressableScale').onPress(); assert.deepEqual(calls.pop(), ['step', item]);
    assert.equal(harness(ui.SequenceBar)({ prev: null, next: null }), null);
  }
  // Exact existing completion/viewed payloads, cache updates/rollback and invalidation.
  data(); state.cached = [mod]; view('en');
  api.useMarkModuleItemDone('c'); const done = definitions.at(-1);
  for (const complete of [true, false]) {
    const vars = { moduleId: 'm', itemId: 'i', done: complete }, before = state.cached;
    const context = await done.options.onMutate(vars);
    assert.equal(state.cached[0].items[0].requirement.completed, complete); assert.equal(context.previous, before);
    await done.fn(client, vars); assert.deepEqual(requests.at(-1), [complete ? 'put' : 'delete', '/api/v1/courses/c/modules/m/items/i/done']);
    done.options.onError(new Error('raw'), vars, context); assert.equal(state.cached, before);
    await done.options.onSettled(); assert.deepEqual(calls.at(-1), ['invalidate', { queryKey: ['account', 'courses', 'c', 'modules'] }]);
  }
  api.useMarkModuleItemViewed('c'); const viewed = definitions.at(-1);
  await viewed.fn(client, { moduleId: 'm', itemId: 'i' }); await viewed.options.onSuccess();
  assert.deepEqual(requests.at(-1), ['post', '/api/v1/courses/c/modules/m/items/i/mark_read']);
  assert.deepEqual(calls.at(-1), ['invalidate', { queryKey: ['account', 'courses', 'c', 'modules'] }]);
  const viewedItem = { ...item, requirement: { type: 'must_view', completed: false } };
  const viewedModule = { ...mod, items: [viewedItem] };
  const beforeManual = mutations.length;
  harness(screens.item)();
  assert.equal(mutations.length, beforeManual, 'manual completion does not mark an item viewed');
  data(viewedModule);
  const itemScreen = harness(screens.item); const first = itemScreen(); await flush(); const visited = mutations.length;
  assert.equal(find(first, 'Screen').children.props.children[0].props.item, viewedItem);
  for (const locale of ['fr', 'ar', 'en']) { view(locale, 'Asia/Tokyo'); itemScreen(); }
  assert.equal(mutations.length, visited); // once per item even if hook callback identity changes
  find(first, ui.SequenceBar).onGo({ ...viewedItem, id: 'next' }); assert.deepEqual(calls.pop(), ['setParams', { itemId: 'next' }]);
  find(first, ui.RequirementCard).onSetDone(false); const undo = mutations.at(-1);
  assert.deepEqual(undo.value, { moduleId: 'm', itemId: 'i', done: false });
  view('fr'); undo.callbacks.onError(new Error('Couldn’t undo')); assert.equal(alerts.at(-1)[0], 'Couldn’t undo'); assert.equal(alerts.at(-1)[1], 'Couldn’t undo');
  for (const patch of [{ locked: true }, { type: 'SubHeader' }]) {
    data({ ...viewedModule, items: [{ ...viewedItem, ...patch }] }); const before = mutations.length; harness(screens.item)(); assert.equal(mutations.length, before);
  }
  // Offline views wait for reconnection, failed attempts can retry, and successful/pending ones deduplicate.
  data(viewedModule); state.online = false;
  const retryView = harness(screens.item), beforeOffline = mutations.length;
  retryView(); assert.equal(mutations.length, beforeOffline);
  let rejectRead; state.wait = new Promise((_resolve, reject) => { rejectRead = reject; });
  state.online = true; retryView(); assert.equal(mutations.length, beforeOffline + 1);
  view('ar'); retryView(); assert.equal(mutations.length, beforeOffline + 1);
  rejectRead(new Error('offline')); await flush(); state.wait = null;
  // Cache objects can be replaced for localized date rendering; that alone must not retry.
  data({ ...viewedModule, items: [{ ...viewedItem }] }); view('fr'); retryView(); await flush();
  assert.equal(mutations.length, beforeOffline + 1);
  state.online = false; retryView(); state.online = true; retryView(); await flush();
  assert.equal(mutations.length, beforeOffline + 2);
  state.online = false; retryView(); state.online = true; retryView(); await flush();
  assert.equal(mutations.length, beforeOffline + 2, 'successful view is not repeated');
  state.accountKey = 'other'; retryView(); await flush();
  assert.equal(mutations.length, beforeOffline + 3, 'another account is tracked independently');
  state.accountKey = 'account';
  const refreshedView = harness(screens.item); state.error = new Error('temporary failure');
  const beforeRefresh = mutations.length; refreshedView(); await flush(); state.error = null;
  const refreshTree = refreshedView(); assert.equal(mutations.length, beforeRefresh + 1);
  await find(refreshTree, 'Screen').refreshControl.props.onRefresh(); refreshedView(); await flush();
  assert.equal(mutations.length, beforeRefresh + 2, 'explicit refresh retries even with the same cached item');
  // Concurrent items settle independently, unlike observer-level mutate callbacks.
  const multiView = harness(screens.item), otherItem = { ...viewedItem, id: 'other' };
  data({ ...viewedModule, items: [viewedItem, otherItem] });
  state.wait = new Promise((_resolve, reject) => { rejectRead = reject; });
  const beforeConcurrent = mutations.length; multiView();
  let finishOther; state.wait = new Promise(resolve => { finishOther = resolve; });
  state.params = { courseId: 'c', itemId: 'other' }; multiView();
  rejectRead(new Error('first failed')); finishOther(); await flush(); state.wait = null;
  state.params = { courseId: 'c', itemId: 'i' }; multiView(); await flush();
  assert.equal(mutations.length, beforeConcurrent + 3, 'revisit retries the failed item');
  state.params = { courseId: 'c', itemId: 'other' }; multiView(); await flush();
  assert.equal(mutations.length, beforeConcurrent + 3, 'successful concurrent item stays recorded');
  state.params = { courseId: 'c', itemId: 'i' }; data(viewedModule);
  // Progress counts tracked modules only; rounding stays at whole percentages.
  for (const locale of ['en', 'fr', 'ar']) {
    const t = view(locale);
    state.queries[mq] = success([{ ...mod, state: 'completed' }, { ...mod, id: 'm2' }, { ...mod, id: 'm3' }, { ...mod, id: 'untracked', state: null, items: [{ ...item, requirement: null }] }]);
    const progress = harness(screens.modules)();
    assert.equal(find(progress, 'ProgressBar').value, 1 / 3);
    assert.ok(text(progress).includes(t('modules.progressCount', { done: 1, count: 3 })));
    assert.ok(text(progress).includes(new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(0.33)));
    state.queries[mq] = success([{ ...mod, state: null, items: [{ ...item, requirement: null }] }]); assert.equal(find(harness(screens.modules)(), 'ProgressBar'), undefined);
    data();
    const card = harness(ui.MasteryPathCard)({ item, courseId: 'c' });
    find(card, 'Button').onPress(); assert.deepEqual(calls.pop(), ['push', { pathname: '/course/[courseId]/module-item/[itemId]/paths', params: { courseId: 'c', itemId: 'i' } }]);
    const pathRow = harness(list.MasteryPathRow)({ item, path: pathData, module: mod, courseId: 'c' });
    assert.equal(pathRow.props.className, 'ps-20'); assert.equal(pathRow.props.subtitle, t('modules.scoreOpened', { title: item.title, count: 2 }));
    pathRow.props.onPress(); assert.equal(calls.pop()[1].params.itemId, 'i');
    data(mod, { ...pathData, awaitingChoice: false, selectedId: 's1' });
    assert.equal(harness(ui.MasteryPathCard)({ item, courseId: 'c' }).props.title, t('modules.addingPath'));
    data({ ...mod, items: [item, { ...item, id: 'added', contentId: 'new' }] }, { ...pathData, awaitingChoice: false, selectedId: 's1' });
    assert.equal(harness(ui.MasteryPathCard)({ item, courseId: 'c' }), null);
    assert.equal(find(chooser({ courseId: 'c', itemId: 'i' }), 'Callout').children, t('modules.addedToModule'));
    data();
    const failed = new Error('Couldn’t load modules'); state.queries[mq] = { isError: true, error: failed };
    const screenError = find(harness(screens.modules)(), statesUI.LoadError); assert.equal(screenError.error, failed); assert.equal(screenError.title, t('modules.loadError'));
    state.queries[mq] = { isPending: true }; assert.ok(find(harness(screens.modules)(), statesUI.ListSkeleton));
    state.queries[mq] = success([]); state.queries[sq] = success({ current: null });
    const missing = find(harness(screens.item)(), statesUI.LoadError);
    assert.equal(missing.title, t('modules.itemMissing')); assert.equal(missing.error.message, t('modules.itemMissingDescription'));
    const before = calls.length; await missing.onRetry(); assert.equal(calls.length, before + 1);
    data();
  }
  // Query keys, enable gates, and request callbacks stay independent of viewing language.
  for (const locale of ['en', 'fr', 'ar']) {
    view(locale); const start = queries.length;
    harness(screens.modules)();
    const q = queries.slice(start);
    assert.deepEqual(q.map(v => v.key), [['courses', 'c', 'modules'], ['courses', 'c', 'modules', 'mastery_paths', 'm']]);
    assert.equal(q[1].options.enabled, true);
    api.useMasteryPaths('c', [{ ...mod, items: [{ ...item, type: 'Page' }] }]); assert.equal(queries.at(-1).options.enabled, false);
  }
  // Production fetchers: raw models, module sorting, sequence and mastery path assignment ordering.
  const signal = new AbortController().signal;
  let args;
  const sequence = await api.fetchModuleItemSequence({ get: async (...a) => { args = a; return { items: [{ current: raw, prev: null, next: { ...raw, id: 'n' } }], modules: [{ id: 'm', name: 'Module', position: 1, unlock_at: null }] }; } }, 'c', 'i', signal);
  assert.deepEqual(args, ['/api/v1/courses/c/module_item_sequence', { asset_type: 'ModuleItem', asset_id: 'i' }, signal]);
  assert.equal(sequence.next.id, 'n'); assert.equal(sequence.module.name, 'Module');
  const fetched = await api.fetchModules({ getAll: async (url, query) => {
    if (url.endsWith('/modules')) return [{ id: 'late', name: 'Locked', position: 2, items_count: 0 }, { id: 'm', name: 'Module', position: 1, items_count: 1 }];
    assert.deepEqual(query, { include: ['content_details'] }); return [raw];
  } }, 'c');
  assert.deepEqual(fetched.map(m => m.id), ['m', 'late']); assert.equal(fetched[0].items[0].title, raw.title);
  const paths = await api.fetchMasteryPaths({ getAll: async (...a) => {
    args = a; return [{ ...raw, mastery_paths: { locked: false, selected_set_id: null, assignment_sets: [
      { id: 's2', position: 2 }, { id: 's1', position: 1, assignment_set_associations: [{ position: 1, model: { id: 'a', course_id: 'c', name: 'Option 1', points_possible: 0, submission_types: [] } }] },
    ] } }];
  } }, 'c', ['m'], signal);
  assert.deepEqual(args, ['/api/v1/courses/c/modules/m/items', { include: ['mastery_paths'] }, { signal }]);
  assert.deepEqual(paths.i.options.map(o => o.id), ['s1', 's2']); assert.equal(paths.i.awaitingChoice, true);
  assert.equal(paths.i.options[0].assignments[0].name, 'Option 1');
  // Explicit dependencies are present at every date-formatting production consumer (static evidence only).
  for (const name of ['ModuleItemRow', 'ModuleSection']) {
    const source = fs.readFileSync(path.join(root, 'features/course/ModuleList.tsx'), 'utf8').split(`function ${name}(`)[1].split('\n}\n')[0];
    assert.ok(source.includes('useTranslation()') && source.includes('useDisplayTimeZone()') && source.includes('createModulePresentation(locale, timeZone)'));
  }
  const partsSource = fs.readFileSync(path.join(root, 'features/course/ModuleItemParts.tsx'), 'utf8');
  assert.ok(partsSource.split('function OptionAssignments(')[1].split('\n}\n')[0].includes('createModulePresentation(locale, timeZone)'));
  assert.ok(!/formatShortDateTime|formatPoints|joinList|moduleItemTypeLabels/.test(partsSource));
  console.log(`modules/mastery checks passed (${process.env.TZ ?? 'host TZ'}): en/fr/ar, scoped dates, raw content, states, routes, synthetic payloads and relabeling`);
})().catch(error => { console.error(error); process.exitCode = 1; });
