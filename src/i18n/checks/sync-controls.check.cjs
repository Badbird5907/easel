const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
// Actual sync components/helpers, settings metadata, dates, file sizes and catalogs.
// Synthetic hooks/native/session/storage boundaries; runner mocked except for the
// explicit actual-runner/card unseen-replacement regression below. No actual effects.
// The reconciler models commits, abandoned renders and effect replay, not React Compiler.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
let scope;
const depsEqual = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const effect = (kind) => (fn, deps) => {
  const s = scope,
    i = s.cursor++,
    old = s.slots[i];
  if (!old || !depsEqual(old.deps, deps)) {
    const slot = { deps, fn, kind, cleanup: null };
    s.slots[i] = slot;
    s.jobs[kind].push(() => {
      old?.cleanup?.();
      slot.cleanup = fn();
    });
  }
};
const react = {
  useState(initial) {
    const s = scope,
      i = s.cursor++;
    if (!s.slots[i]) {
      const slot = { value: typeof initial === 'function' ? initial() : initial };
      slot.set = (value) => {
        // React ignores updates to unmounted components (including retained Expo event callbacks).
        assert.ok(s.mounted, 'update after unmount');
        const next = typeof value === 'function' ? value(slot.value) : value;
        if (!Object.is(next, slot.value)) {
          slot.value = next;
          s.host.dirty = true;
        }
      };
      s.slots[i] = slot;
    }
    return [s.slots[i].value, s.slots[i].set];
  },
  useRef(value) {
    const s = scope,
      i = s.cursor++;
    return (s.slots[i] ??= { current: value });
  },
  useMemo(fn, deps) {
    const s = scope,
      i = s.cursor++,
      old = s.slots[i];
    if (!old || !depsEqual(old.deps, deps)) s.slots[i] = { value: fn(), deps };
    return s.slots[i].value;
  },
  useCallback(fn, deps) {
    return react.useMemo(() => fn, deps);
  },
  useLayoutEffect: effect('layout'),
  useEffect: effect('passive'),
};
const jsx = (type, props, key) => ({ type, props, key });
function mount(fn) {
  const h = { nodes: new Map(), dirty: false, tree: null };
  let draft, saved, stateValues;
  function retire(s) {
    for (const slot of s.slots) slot?.cleanup?.();
    s.mounted = false;
  }
  function visit(node, at) {
    if (Array.isArray(node)) return node.map((v, i) => visit(v, `${at}.${i}`));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      let s = h.nodes.get(at);
      if (!s || s.type !== node.type || s.key !== node.key)
        s = { type: node.type, key: node.key, slots: [], host: h, mounted: true };
      saved.set(s, s.slots.slice());
      for (const slot of s.slots) if (slot?.set) stateValues.set(slot, slot.value);
      s.cursor = 0;
      s.jobs = { layout: [], passive: [] };
      draft.set(at, s);
      const old = scope;
      scope = s;
      let result;
      try {
        result = node.type(node.props);
      } finally {
        scope = old;
      }
      return visit(result, at + '.child');
    }
    return {
      ...node,
      props: {
        ...node.props,
        children: visit(node.props.children, at + '.children'),
        trailing: visit(node.props.trailing, at + '.trailing'),
      },
    };
  }
  h.renderOnly = () => {
    draft = new Map();
    saved = new Map();
    stateValues = new Map();
    h.dirty = false;
    return visit(fn(), 'root');
  };
  h.abandon = () => {
    for (const [slot, value] of stateValues) slot.value = value;
    for (const [s, slots] of saved) s.slots = slots;
    draft = saved = null;
  };
  h.commit = (passive = true) => {
    for (const [at, s] of h.nodes) if (draft.get(at) !== s) retire(s);
    h.nodes = draft;
    for (const kind of passive ? ['layout', 'passive'] : ['layout'])
      for (const s of [...draft.values()].reverse()) for (const job of s.jobs[kind]) job();
    draft = saved = null;
  };
  h.render = () => {
    let limit = 20;
    do {
      assert.ok(limit--, 'render loop');
      h.tree = h.renderOnly();
      h.commit();
    } while (h.dirty);
    return h.tree;
  };
  h.replay = () => {
    for (const s of h.nodes.values()) for (const slot of s.slots) slot?.cleanup?.();
    for (const kind of ['layout', 'passive'])
      for (const s of [...h.nodes.values()].reverse())
        for (const slot of s.slots) if (slot?.kind === kind) slot.cleanup = slot.fn();
  };
  h.unmount = () => {
    for (const s of h.nodes.values()) retire(s);
    h.nodes.clear();
  };
  return h;
}

react.useSyncExternalStore = (subscribe, snapshot) => {
  const [, update] = react.useState(0);
  react.useLayoutEffect(() => subscribe(() => update((n) => n + 1)), [subscribe]);
  return snapshot();
};
let env,
  locale = 'en',
  online = true,
  run = null,
  course;
let startWork, removeWork, onSet;
const calls = [],
  alerts = [];
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': { View: 'View', Alert: { alert: (...args) => alerts.push(args) } },
  'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
  '@/canvas/session': { useCanvas: () => env, registerAccountCleanup() {} },
  '@/features/offline/useOnline': { useOnline: () => online },
  '@/features/offline/store': {
    LocalStore: class {
      constructor(_, defaults) {
        this.value = defaults();
      }
      get() {
        return this.value;
      }
      update(fn) {
        this.value = fn(this.value);
      }
    },
    useLocalStore: (store) => store.get(),
  },
  '@/features/sync/runner': {
    useSyncRun: () => run,
    startSync: (args) => {
      calls.push(['start', args]);
      return startWork();
    },
    removeCourseSync: (...args) => {
      calls.push(['remove', ...args]);
      return removeWork();
    },
    cancelSyncRun: (...args) => calls.push(['cancel', ...args]),
  },
  '@/design': Object.fromEntries(
    [
      'AccentScope',
      'Button',
      'Card',
      'ListGroup',
      'ListItem',
      'OptionGroup',
      'ProgressBar',
      'Sheet',
      'Switch',
      'Text',
    ].map((v) => [v, v]),
  ),
};
const allowed = new Set([
  'features/sync/components.tsx',
  'features/sync/syncControlsLifetime.ts',
  'features/sync/settings.ts',
  'features/files/kinds.ts',
  'lib/dates.ts',
  'i18n/runtime.ts',
  'i18n/en.ts',
  'i18n/fr.ts',
  'i18n/ar.ts',
]);
function load(file, from = root) {
  if (isIntlPolyfills(file)) return intlPolyfills;
  if (Object.hasOwn(stubs, file)) return stubs[file];
  let p = file.startsWith('@/') ? path.join(root, file.slice(2)) : path.resolve(from, file);
  if (!path.extname(p)) p += fs.existsSync(p + '.ts') ? '.ts' : '.tsx';
  const alias = '@/' + path.relative(root, p).replace(/\.tsx?$/, '');
  if (Object.hasOwn(stubs, alias)) return stubs[alias];
  assert.ok(allowed.has(path.relative(root, p)), 'unmocked import: ' + file);
  if (cache.has(p)) return cache.get(p);
  const source =
    process.env.SYNC_CONTROLS_BEFORE && p.endsWith('/sync/components.tsx')
      ? fs.readFileSync(process.env.SYNC_CONTROLS_BEFORE, 'utf8')
      : fs.readFileSync(p, 'utf8');
  const code = ts.transpileModule(source, {
    fileName: p,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  cache.set(p, module.exports);
  const denied = () => {
    throw Error('Unexpected network');
  };
  new Function('require', 'module', 'exports', '__DEV__', 'fetch', 'WebSocket', 'XMLHttpRequest', code)(
    (name) => load(name, path.dirname(p)),
    module,
    module.exports,
    false,
    denied,
    denied,
    denied,
  );
  return module.exports;
}
const runtime = load('@/i18n/runtime');
stubs['@/i18n'] = { ...runtime, useTranslation: () => ({ locale, t: runtime.createTranslator(locale) }) };
const dates = load('@/lib/dates');
const settings = load('@/features/sync/settings');
const originalSet = settings.setCourseContent;
settings.setCourseContent = (...args) => {
  calls.push(['set', ...args]);
  originalSet(...args);
  onSet?.();
};
const { CourseSyncSheet, CourseSyncList, SyncProgressCard, syncedLabel, describeRun } = load(
  '@/features/sync/components',
);
const nodes = (tree, type) =>
  Array.isArray(tree)
    ? tree.flatMap((v) => nodes(v, type))
    : !tree || typeof tree !== 'object'
      ? []
      : [
          ...(tree.type === type ? [tree.props] : []),
          ...nodes(tree.props.children, type),
          ...nodes(tree.props.trailing, type),
        ];
const first = (h, type) => nodes(h.tree, type)[0];
const t = (key, args) => runtime.createTranslator(locale)('syncControls.' + key, args);
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function reset() {
  calls.length = alerts.length = 0;
  onSet = undefined;
  locale = 'en';
  online = true;
  run = null;
  env = {
    account: { id: 'a', user: { id: 'u' }, baseUrl: 'https://school.invalid', host: 'school.invalid' },
    client: {},
  };
  course = { id: 'c', code: 'Pages <&>{raw} العربية', name: 'Getting ready', color: 'raw' };
  settings.syncSettingsStore.value = {
    schedule: 'off',
    wifiOnly: true,
    courses: { a: { c: ['pages', 'files'] } },
  };
  settings.syncStatusStore.value = {
    courses: {
      a: { c: { syncedAt: 1000, bytes: 1200, skipped: 2, unsupportedEmbeds: 1, error: null, fileIds: [] } },
    },
    autoSyncedAt: {},
  };
  startWork = () => Promise.resolve();
  removeWork = () => Promise.resolve();
}
function sheet() {
  const h = mount(() => jsx(CourseSyncSheet, { course, onClose: () => calls.push(['close']) }));
  h.render();
  return h;
}
function sampleRun() {
  return {
    accountId: 'a',
    reason: 'manual',
    startedAt: 123,
    courses: [{ id: 'c', name: 'Pages' }],
    index: 0,
    progress: {
      courseId: 'c',
      courseName: 'Pages',
      step: 'Files',
      stepKey: 'files',
      done: 12,
      total: 40,
      bytes: 1200,
    },
  };
}
let passed = 0,
  failed = 0;
async function check(name, fn) {
  reset();
  try {
    await fn();
    passed++;
  } catch (error) {
    failed++;
    console.error('FAIL ' + name + ': ' + error.stack);
  }
}
(async () => {
  await check('3051 reviewed hashes per language preserved, peer additions excluded', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'sync-controls.baseline.json')));
    for (const lang of ['en', 'fr', 'ar']) {
      const catalog = load('@/i18n/' + lang)[lang];
      assert.equal(Object.keys(baseline.catalogs[lang]).length, 3051);
      for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
        assert.equal(
          crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
          hash,
          lang + '/' + key,
        );
      assert.equal(Object.keys(catalog).filter((k) => k.startsWith('syncControls.')).length, 57);
      assert.ok(
        !Object.keys(baseline.catalogs[lang]).some((k) =>
          /^(syncControls|settingsStorage|shareFolders)\./.test(k),
        ),
      );
    }
  });
  await check('exact omitted-argument helper compatibility and fraction extremes', () => {
    runtime.setAccountLocale('en');
    const now = new Date('2026-11-01T06:30:00Z');
    for (const delta of [0, 60000, 3600000, 86400000, 8 * 86400000])
      assert.equal(
        syncedLabel(+now - delta, now),
        'Synced ' + dates.relativeAgeLabel(new Date(+now - delta), now),
      );
    let r = sampleRun();
    assert.deepEqual(describeRun(r), {
      title: 'Syncing Pages',
      detail: 'Files, 12 of 40 · 1.2 KB',
      fraction: 0.3,
    });
    for (const [done, total, fraction] of [
      [80, 40, 1],
      [-1, 40, -0.025],
      [2, 0, 0],
    ]) {
      r.progress = { ...r.progress, done, total };
      assert.equal(describeRun(r).fraction, fraction);
    }
    r = {
      ...r,
      courses: [
        { id: 'c', name: 'X' },
        { id: 'd', name: 'Y' },
      ],
      index: 1,
      progress: null,
    };
    assert.deepEqual(describeRun(r), { title: 'Syncing Y (2 of 2)', detail: 'Getting ready', fraction: 0 });
    r.courses = [];
    assert.deepEqual(describeRun(r), { title: 'Syncing courses', detail: 'Getting ready', fraction: 0 });
  });
  for (const lang of ['en', 'fr', 'ar'])
    await check(lang + ' actual option metadata, raw errors and generated/legacy progress', () => {
      locale = lang;
      const h = sheet();
      const opts = first(h, 'OptionGroup').options;
      assert.deepEqual(
        opts.map((o) => o.value),
        settings.syncContentTypes.map((o) => o.value),
      );
      for (const o of opts) {
        assert.equal(o.label, t('stage.' + o.value));
        assert.ok(o.subtitle.length);
      }
      assert.equal(first(h, 'Sheet').title, t('offlineCourse', { course: course.code }));
      assert.equal(first(h, 'Switch').accessibilityLabel, t('keepLabel', { course: course.code }));
      const r = sampleRun(),
        context = dates.createDateContext(lang, 'Asia/Tokyo');
      assert.ok(describeRun(r, context).detail.includes(t('stage.files')));
      delete r.progress.stepKey;
      assert.ok(describeRun(r, context).detail.includes('Files'));
      r.progress.step = 'Getting ready <&>';
      assert.ok(describeRun(r, context).detail.includes(r.progress.step));
      const now = new Date('2026-11-01T06:30:00Z');
      assert.equal(
        syncedLabel(+now - 8 * 86400000, now, context),
        t('synced', { age: context.formatShortDate(new Date(+now - 8 * 86400000), now) }),
      );
      const list = mount(() =>
        jsx(CourseSyncList, { courses: [course], onOpen: (id) => calls.push(['open', id]) }),
      );
      list.render();
      assert.equal(first(list, 'ListGroup').header, t('courses'));
      assert.ok(first(list, 'ListItem').subtitle.includes(t('skipped', { count: 2 })));
      settings.syncStatusStore.value.courses.a.c.error = 'Not synced yet <&>';
      list.render();
      assert.ok(first(list, 'ListItem').subtitle.includes('Not synced yet <&>'));
      h.unmount();
      list.unmount();
    });
  await check(
    'locale-only rerender preserves selection and retained sync action; exact request and duplicate admission',
    async () => {
      const d = deferred();
      startWork = () => d.promise;
      const h = sheet();
      const old = first(h, 'Button').onPress;
      locale = 'ar';
      h.render();
      assert.deepEqual([...first(h, 'OptionGroup').selected], ['pages', 'files']);
      assert.equal(first(h, 'Button').children, t('now'));
      old();
      old();
      first(h, 'Button').onPress();
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], [
        'start',
        { account: env.account, client: env.client, courseIds: ['c'], names: new Map([['c', course.code]]) },
      ]);
      d.resolve();
      await settle();
      assert.deepEqual(calls.slice(1), [['close']]);
      h.unmount();
    },
  );
  for (const change of [
    'account',
    'user',
    'client',
    'course',
    'sheet',
    'settings',
    'online',
    'run',
    'unmount',
  ])
    await check(change + ' retires retained sync, selection, keep and removal confirmation', () => {
      const h = sheet();
      const sync = first(h, 'Button').onPress,
        toggle = first(h, 'OptionGroup').onSelect,
        keep = first(h, 'Switch').onValueChange;
      keep(false);
      assert.equal(alerts.length, 1);
      const remove = alerts[0][2][1].onPress;
      if (change === 'account') env = { ...env, account: { ...env.account, id: 'b' } };
      if (change === 'user') env.account = { ...env.account, user: { id: 'other' } };
      if (change === 'client') env = { ...env, client: {} };
      if (change === 'course') course = { ...course, id: 'd' };
      if (change === 'sheet') course = null;
      if (change === 'settings')
        settings.syncSettingsStore.value = { ...settings.syncSettingsStore.value, wifiOnly: false };
      if (change === 'online') online = false;
      if (change === 'run') run = sampleRun();
      if (change === 'unmount') h.unmount();
      else h.render();
      remove();
      sync();
      toggle('grades');
      keep(true);
      assert.deepEqual(calls, []);
      if (change !== 'unmount') h.unmount();
    });
  await check(
    'locale-only pending confirmation survives, is single use, order and captured IDs exact',
    async () => {
      const d = deferred();
      removeWork = () => d.promise;
      const h = sheet();
      const keep = first(h, 'Switch').onValueChange;
      keep(false);
      keep(false);
      assert.equal(alerts.length, 1);
      const remove = alerts[0][2][1].onPress;
      locale = 'fr';
      h.render();
      remove();
      remove();
      first(h, 'Switch').onValueChange(false);
      assert.deepEqual(calls, [
        ['set', 'a', 'c', []],
        ['remove', 'a', 'c'],
      ]);
      d.resolve();
      await settle();
      h.unmount();
    },
  );
  await check('cancelled/dismissed alerts cannot remove; fresh choice can re-prompt', () => {
    const h = sheet();
    first(h, 'Switch').onValueChange(false);
    const a = alerts[0];
    a[2][0].onPress();
    a[2][1].onPress();
    assert.deepEqual(calls, []);
    h.render();
    first(h, 'Switch').onValueChange(false);
    assert.equal(alerts.length, 2);
    alerts[1][3].onDismiss();
    alerts[1][2][1].onPress();
    assert.deepEqual(calls, []);
    h.unmount();
  });
  await check('generated course labels can relabel without retiring a valid confirmation', async () => {
    course = { ...course, code: 'Course c', name: 'Not on your dashboard' };
    const h = sheet();
    first(h, 'Switch').onValueChange(false);
    const remove = alerts[0][2][1].onPress;
    locale = 'fr';
    course = { ...course, code: 'Cours c', name: 'Absent de votre tableau de bord' };
    h.render();
    remove();
    assert.deepEqual(calls, [['set', 'a', 'c', []], ['remove', 'a', 'c']]);
    await settle();
    h.unmount();
  });
  await check('retained sync uses current generated course display name after locale change', async () => {
    course = { ...course, code: 'Course c', name: 'Not on your dashboard' };
    const h = sheet();
    const sync = first(h, 'Button').onPress;
    locale = 'fr';
    course = { ...course, code: 'Cours c', name: 'Absent de votre tableau de bord' };
    h.render();
    sync();
    assert.equal(calls[0]?.[0], 'start');
    assert.equal(calls[0][1].names.get('c'), 'Cours c');
    await settle();
    h.unmount();
  });
  await check(
    'admitted removal finishes original obligation through synchronous account replacement',
    async () => {
      const d = deferred();
      removeWork = () => d.promise;
      const h = sheet();
      first(h, 'Switch').onValueChange(false);
      onSet = () => {
        env = { account: { ...env.account, id: 'b' }, client: {} };
        course = { ...course, id: 'd' };
        h.render();
      };
      alerts[0][2][1].onPress();
      assert.deepEqual(calls, [
        ['set', 'a', 'c', []],
        ['remove', 'a', 'c'],
      ]);
      d.reject(Error('raw native'));
      await settle();
      h.render();
      assert.equal(
        nodes(h.tree, 'Text').some((n) => n.accessibilityRole === 'alert'),
        false,
      );
      h.unmount();
    },
  );
  await check('defaultContent and toggle values exact; unsynced removal bypasses Alert', async () => {
    settings.syncSettingsStore.value.courses = {};
    const h = sheet();
    first(h, 'Switch').onValueChange(true);
    assert.deepEqual(calls[0], ['set', 'a', 'c', settings.defaultContent]);
    h.render();
    first(h, 'OptionGroup').onSelect('media');
    assert.deepEqual(calls[1], ['set', 'a', 'c', [...settings.defaultContent, 'media']]);
    settings.syncStatusStore.value.courses = {};
    h.render();
    first(h, 'Switch').onValueChange(false);
    assert.deepEqual(calls.slice(2), [
      ['set', 'a', 'c', []],
      ['remove', 'a', 'c'],
    ]);
    assert.equal(alerts.length, 0);
    await settle();
    h.unmount();
  });
  for (const kind of ['start', 'remove'])
    await check(kind + ' rejection handled, relabels current feedback, never reports success', async () => {
      const d = deferred();
      if (kind === 'start') startWork = () => d.promise;
      else removeWork = () => d.promise;
      const h = sheet();
      if (kind === 'start') first(h, 'Button').onPress();
      else {
        first(h, 'Switch').onValueChange(false);
        alerts[0][2][1].onPress();
      }
      locale = 'fr';
      h.render();
      d.reject(Error('RAW native'));
      await settle();
      h.render();
      assert.ok(
        nodes(h.tree, 'Text').some((n) => n.children === t(kind === 'start' ? 'startError' : 'removeError')),
      );
      assert.ok(!calls.some((c) => c[0] === 'close'));
      locale = 'ar';
      h.render();
      assert.ok(
        nodes(h.tree, 'Text').some((n) => n.children === t(kind === 'start' ? 'startError' : 'removeError')),
      );
      h.unmount();
    });
  await check('late start completion cannot close replacement sheet or set its error', async () => {
    const d = deferred();
    startWork = () => d.promise;
    const h = sheet();
    first(h, 'Button').onPress();
    course = { ...course, id: 'd' };
    h.render();
    d.resolve();
    await settle();
    assert.ok(!calls.some((c) => c[0] === 'close'));
    h.unmount();
  });
  await check('closed sheet immediately retires retained actions before parent render', () => {
    const h = sheet(),
      go = first(h, 'Button').onPress,
      keep = first(h, 'Switch').onValueChange;
    first(h, 'Sheet').onClose();
    go();
    keep(false);
    assert.deepEqual(calls, [['close']]);
    assert.equal(alerts.length, 0);
    h.unmount();
  });
  await check(
    'observed run replacement retires old cancel, current cancel passes exact snapshot',
    () => {
      run = sampleRun();
      let shown = run;
      const h = mount(() => jsx(SyncProgressCard, { run: shown }));
      h.render();
      const old = first(h, 'Button').onPress;
      run = { ...sampleRun(), startedAt: 456 };
      shown = run;
      h.render();
      old();
      assert.deepEqual(calls, []);
      const current = first(h, 'Button').onPress;
      locale = 'ar';
      h.render();
      current();
      first(h, 'Button').onPress();
      assert.deepEqual(calls, [['cancel', run]]);
      assert.equal(calls[0][1], run, 'targeted cancel receives the exact published object');
      h.unmount();
    },
  );
  await check('card refuses supplied obsolete run when runner observation already differs', () => {
    const shown = sampleRun();
    run = { ...shown, startedAt: 456 };
    const h = mount(() => jsx(SyncProgressCard, { run: shown }));
    h.render();
    first(h, 'Button').onPress();
    assert.deepEqual(calls, []);
    h.unmount();
  });
  await check('actual runner/card: unseen replacement refuses stale cancel; same-run progress permits it', async () => {
    const { createRunnerHarness } = require('./sync-run-ownership.check.cjs');
    const actual = createRunnerHarness();
    actual.select();
    actual.select('b');
    const boundary = stubs['@/features/sync/runner'];
    const saved = { ...boundary };
    Object.assign(boundary, actual.runner);
    let h;
    try {
      // All three publications use exactly the same frozen wall-clock time.
      const a = actual.runner.startSync(actual.request());
      let shown = actual.snapshot();
      const original = shown;
      h = mount(() => jsx(SyncProgressCard, { run: shown }));
      h.render();
      const old = first(h, 'Button').onPress;
      actual.jobs[0].work.resolve({ ok: true });
      await a;
      // Finish B then return to account A without committing any card update.
      const b = actual.runner.startSync(actual.request('b'));
      actual.jobs[1].work.resolve({ ok: true });
      await b;
      const replacement = actual.runner.startSync(actual.request());
      const job = actual.jobs[2];
      assert.equal(actual.snapshot().startedAt, original.startedAt);
      old();
      assert.equal(job.context.signal.aborted, false, 'stale A control cannot abort replacement A');
      assert.equal(actual.runner.startSync(actual.request()), replacement);
      shown = actual.snapshot();
      h.render();
      const current = first(h, 'Button').onPress;
      job.context.onProgress({ step: 'Files', stepKey: 'files', done: 1, total: 2, bytes: 0 });
      shown = actual.snapshot();
      locale = 'ar';
      h.render();
      current();
      assert.equal(job.context.signal.aborted, true, 'same-run progress/locale commit keeps cancel valid');
      job.work.resolve({ ok: true });
      await replacement;
      assert.equal(actual.snapshot(), null);
      assert.deepEqual(calls, [], 'no stubbed runner answer participates');
    } finally {
      h?.unmount();
      for (const key of Object.keys(boundary)) delete boundary[key];
      Object.assign(boundary, saved);
    }
  });
  await check('row callbacks retire on course/account replacement and unmount', () => {
    const h = mount(() =>
      jsx(CourseSyncList, { courses: [course], onOpen: (id) => calls.push(['open', id]) }),
    );
    h.render();
    const old = first(h, 'ListItem').onPress;
    locale = 'fr';
    h.render();
    old();
    assert.deepEqual(calls, [['open', 'c']]);
    env = { ...env, account: { ...env.account, id: 'b' } };
    h.render();
    old();
    assert.equal(calls.length, 1);
    const current = first(h, 'ListItem').onPress;
    h.unmount();
    current();
    assert.equal(calls.length, 1);
  });
  await check('abandoned render cannot activate actions or retire committed ones', () => {
    const h = sheet();
    const old = first(h, 'Button').onPress;
    course = { ...course, id: 'd' };
    const draft = h.renderOnly();
    nodes(draft, 'Button')[0].onPress();
    h.abandon();
    assert.deepEqual(calls, []);
    old();
    assert.equal(calls[0][1].courseIds[0], 'c');
    h.unmount();
  });
  await check('content selection keeps sheet usable while old setting callbacks retire', () => {
    const h = sheet();
    const old = first(h, 'OptionGroup').onSelect;
    const oldClose = first(h, 'Sheet').onClose;
    old('grades');
    h.render();
    assert.equal(first(h, 'Sheet').visible, true);
    assert.deepEqual([...first(h, 'OptionGroup').selected], ['pages', 'files', 'grades']);
    old('modules');
    oldClose();
    assert.equal(calls.length, 1);
    first(h, 'OptionGroup').onSelect('files');
    h.render();
    assert.deepEqual([...first(h, 'OptionGroup').selected], ['pages', 'grades']);
    first(h, 'Switch').onValueChange(false);
    alerts[0][2][0].onPress();
    first(h, 'Switch').onValueChange(false);
    assert.equal(alerts.length, 2);
    h.unmount();
  });
  await check('confirmation captures primitive IDs even if source objects mutate without render', () => {
    const h = sheet();
    first(h, 'Switch').onValueChange(false);
    const remove = alerts[0][2][1].onPress;
    env.account.id = 'replacement';
    course.id = 'replacement';
    remove();
    assert.deepEqual(calls, []);
    h.unmount();
  });
  await check(
    'late successful start cannot close sheet after observed run/settings replacement',
    async () => {
      for (const replace of ['run', 'settings']) {
        reset();
        const d = deferred();
        startWork = () => d.promise;
        const h = sheet();
        first(h, 'Button').onPress();
        if (replace === 'run') run = sampleRun();
        else settings.syncSettingsStore.value = { ...settings.syncSettingsStore.value, wifiOnly: false };
        h.render();
        d.resolve();
        await settle();
        assert.ok(!calls.some((c) => c[0] === 'close'));
        h.unmount();
      }
    },
  );
  await check('settings store replacement before render rejects retained sync and removal', () => {
    const h = sheet();
    const sync = first(h, 'Button').onPress;
    first(h, 'Switch').onValueChange(false);
    const remove = alerts[0][2][1].onPress;
    settings.syncSettingsStore.value = { ...settings.syncSettingsStore.value, wifiOnly: false };
    sync();
    remove();
    assert.deepEqual(calls, []);
    h.unmount();
  });
  console.log(
    `sync controls: ${passed} groups passed, ${failed} failed (${process.env.TZ || 'device zone'})`,
  );
  if (failed) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
