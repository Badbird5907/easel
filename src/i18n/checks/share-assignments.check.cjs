/* global __dirname */
// Production picker, fit/rule/content/date helpers and unchanged submission preparation.
// Staged hooks simulate commit/abandon/replay; native, queries, uploads, drafts and routing
// are synthetic. No network, storage or native operations. Not a React Compiler test.
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
      props: { ...node.props, children: visit(node.props.children, at + '.children') },
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
  h.commit = () => {
    for (const [at, s] of h.nodes) if (draft.get(at) !== s) retire(s);
    h.nodes = draft;
    for (const kind of ['layout', 'passive'])
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
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
react.useSyncExternalStore = (subscribe, snapshot) => {
  const [, update] = react.useState(0);
  react.useLayoutEffect(() => {
    const unsubscribe = subscribe(() => update((n) => n + 1));
    update((n) => n + 1); // useSyncExternalStore checks changes between render and subscription.
    return unsubscribe;
  }, [subscribe]);
  return snapshot();
};
let env, locale, focused, content, course, query, courseId, retryQueue, refreshQueue;
const calls = { uploads: [], drafts: [], route: [], clear: [], retry: [], refresh: [], order: [] };
const navigation = { isFocused: () => focused };
const queryClient = {
  refetchQueries: (args) => {
    calls.refresh.push(args);
    return refreshQueue.shift() ?? Promise.resolve();
  },
};
const attempt = () => {
  calls.retry.push(true);
  return retryQueue.shift() ?? Promise.resolve();
};
// Execute selected unchanged pure exports directly from the production AST, without
// importing their upload/API/editor modules (which would admit forbidden effects).
function pure(file, names) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statements = ast.statements.filter(
    (s) =>
      ts.isVariableStatement(s) &&
      s.declarationList.declarations.some((d) => names.includes(d.name.getText(ast))),
  );
  assert.equal(statements.length, names.length);
  const code = ts.transpileModule(
    statements.map((s) => s.getText(ast)).join('\n') + '\nexport {' + names.join(',') + '};',
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', code)(m, m.exports);
  return m.exports;
}
const stubs = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'View', RefreshControl: 'RefreshControl' },
  'lucide-react-native': new Proxy({}, { get: (_, key) => key }),
  'expo-router': {
    useIsFocused: () => focused,
    useNavigation: () => navigation,
    router: {
      push: (v) => {
        calls.route.push(v);
        calls.order.push('route');
      },
    },
  },
  'expo-sharing': {
    clearSharedPayloads: () => {
      calls.clear.push(true);
      calls.order.push('clear');
    },
  },
  '@tanstack/react-query': { useQueryClient: () => queryClient },
  '@/canvas/session': { useCanvas: () => env },
  '@/canvas/api/assignments': {
    useAssignmentGroups: (id, period) => {
      assert.equal(id, courseId);
      assert.equal(period, null);
      return query;
    },
  },
  '@/canvas/api/courses': { useCourseLookup: () => () => course },
  '@/features/course/CourseScope': { CourseScope: 'CourseScope' },
  '@/features/course/states': {
    ListSkeleton: 'ListSkeleton',
    LoadError: 'LoadError',
    useRefreshControl: () =>
      jsx('RefreshControl', { refreshing: false, onRefresh: () => queryClient.refetchQueries({}) }),
  },
  '@/design': {
    ...Object.fromEntries(
      ['Card', 'EmptyState', 'IconTile', 'ListGroup', 'ListItem', 'Screen', 'Text'].map((k) => [k, k]),
    ),
    useTheme: () => ({ colors: { fgMuted: 'token' } }),
  },
  '@/i18n': { useTranslation: () => ({ locale, t: runtime.createTranslator(locale) }) },
  '@/canvas/api/submissions': pure('canvas/api/submissions.ts', [
    'nativeSubmissionTypes',
    'isNativeSubmissionType',
    'submissionFilesPath',
  ]),
  '@/features/editor/RichEditor': pure('features/editor/RichEditor.tsx', ['escape', 'textToHtml']),
  '@/features/submissions/drafts': {
    saveDraft: (...args) => {
      calls.drafts.push(args);
      calls.order.push('draft');
    },
  },
  '@/features/submissions/uploadStore': {
    ...pure('features/submissions/uploadStore.ts', ['submissionSlot']),
    addUploads: (...args) => {
      calls.uploads.push(args);
      calls.order.push('upload');
    },
  },
};
function load(file, from = root) {
  if (Object.hasOwn(stubs, file)) return stubs[file];
  let p = file.startsWith('@/') ? path.join(root, file.slice(2)) : path.resolve(from, file);
  if (!path.extname(p)) p += fs.existsSync(p + '.ts') ? '.ts' : '.tsx';
  const alias = '@/' + path.relative(root, p).replace(/\.tsx?$/, '');
  if (Object.hasOwn(stubs, alias)) return stubs[alias];
  assert.ok(p.startsWith(root + '/'), 'unmocked module: ' + file);
  if (cache.has(p)) return cache.get(p);
  const source =
    process.argv.includes('--before') && alias === '@/features/share/AssignmentPicker'
      ? fs.readFileSync('/tmp/easel-scratch/localization/share-assignments-before.tsx', 'utf8')
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
  new Function('require', 'module', 'exports', code)(
    (name) => load(name, path.dirname(p)),
    module,
    module.exports,
  );
  return module.exports;
}
const runtime = load('@/i18n/runtime');
const dates = load('@/lib/dates');
const shared = load('@/features/share/content');
// Real shared store/kindOf, but hook subscription is handled by the staged harness.
const { AssignmentPicker } = load('@/features/share/AssignmentPicker');
const { assignmentFits, startSubmission } = load('@/features/share/submit');
const nodes = (tree, type) => {
  if (Array.isArray(tree)) return tree.flatMap((v) => nodes(v, type));
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree.props] : []), ...nodes(tree.props?.children, type)];
};
const first = (h, type) => nodes(h.tree, type)[0];
const rows = (h) => nodes(h.tree, 'ListItem');
const refresh = (h) => first(h, 'Screen').refreshControl.props;
const tr = (key, args) => runtime.createTranslator(locale)('shareAssignments.' + key, args);
const file = (name) => ({
  name,
  uri: 'file:///raw%20' + name,
  size: 17,
  mimeType: 'application/octet-stream',
  isImage: false,
});
const assignment = (patch = {}) => ({
  id: 'a1',
  courseId: 'c1',
  name: 'Raw اسم devoir',
  kind: 'assignment',
  submissionTypes: ['online_upload', 'online_url', 'online_text_entry'],
  allowedExtensions: [],
  dueAt: null,
  locked: false,
  allowedAttempts: null,
  canSubmit: true,
  lockAt: null,
  submission: null,
  ...patch,
});
function setup() {
  for (const v of Object.values(calls)) v.length = 0;
  locale = 'en';
  focused = true;
  courseId = 'c1';
  env = { account: { id: 'acct', baseUrl: 'https://example.invalid', user: { id: 'u1' } }, client: {} };
  content = { files: [], url: 'https://example.invalid/%D8%A7?x=%26', text: null };
  shared.setSharedContent(content);
  course = { name: 'this course' };
  query = {
    data: { assignments: [assignment()] },
    dataUpdatedAt: 1,
    errorUpdatedAt: 0,
    isPending: false,
    isError: false,
    error: null,
    refetch: attempt,
  };
  retryQueue = [];
  refreshQueue = [];
  const h = mount(() => jsx(AssignmentPicker, { courseId }));
  h.render();
  return h;
}
const tests = [];
const test = (name, fn, regression = false) => tests.push({ name, fn, regression });
test(
  'duplicate selection prepares and clears exactly once before render',
  () => {
    const h = setup(),
      press = rows(h)[0].onPress;
    press();
    press();
    assert.equal(calls.drafts.length, 1);
    assert.equal(calls.clear.length, 1);
    assert.deepEqual(calls.order, ['draft', 'route', 'clear']);
    h.unmount();
  },
  true,
);
test(
  'old source selection is retired after commit',
  () => {
    const h = setup(),
      press = rows(h)[0].onPress;
    env = { ...env, client: {} };
    h.render();
    press();
    assert.equal(calls.drafts.length, 0);
    h.unmount();
  },
  true,
);
test(
  'cached data query error blocks retained selection',
  () => {
    const h = setup(),
      press = rows(h)[0].onPress;
    query = { ...query, isError: true, error: Error('Raw failure') };
    h.render();
    press();
    assert.equal(calls.drafts.length, 0);
    assert.equal(rows(h).length, 0);
    h.unmount();
  },
  true,
);
test(
  'failed refresh is contained and retryable',
  async () => {
    const h = setup();
    refreshQueue.push(Promise.reject(Error('synthetic failure')));
    await refresh(h).onRefresh();
    h.render();
    assert.equal(refresh(h).refreshing, false);
    await refresh(h).onRefresh();
    assert.equal(calls.refresh.length, 2);
    h.unmount();
  },
  true,
);
test('all historical catalog values and startSubmission bytes preserved', () => {
  const baseline = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'share-assignments.baseline.json'), 'utf8'),
  );
  const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2995);
    for (const [key, value] of Object.entries(baseline.catalogs[lang]))
      assert.equal(hash(JSON.stringify(catalog[key])), value, lang + ': ' + key);
    const owned = Object.keys(catalog).filter((k) => k.startsWith('shareAssignments.'));
    assert.ok(owned.length >= 20); // Future additions are allowed.
    const slots = (text) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
    const english = load('@/i18n/en').en;
    for (const key of owned) {
      const expected = slots(typeof english[key] === 'string' ? english[key] : english[key].other);
      for (const value of typeof catalog[key] === 'string' ? [catalog[key]] : Object.values(catalog[key]))
        assert.deepEqual(slots(value), expected, lang + ': ' + key);
    }
  }
  const source = fs.readFileSync(path.join(root, 'features/share/submit.ts'), 'utf8');
  const ast = ts.createSourceFile('submit.ts', source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find((s) => ts.isFunctionDeclaration(s) && s.name.text === 'startSubmission');
  assert.equal(hash(node.getText(ast)), baseline.startSubmission);
});
test('legacy fits preserve ordering, restrictions and payload precedence', () => {
  const h = setup();
  const due = new Date('2027-01-01T00:00Z');
  const a = assignment({ id: 'b', name: 'B', dueAt: due, allowedExtensions: ['pdf', 'docx'] });
  const b = assignment({ id: 'a', name: 'A', dueAt: due });
  const c = assignment({ id: 'c', name: 'C' });
  const input = [
    c,
    a,
    b,
    assignment({ id: 'locked', locked: true }),
    assignment({ id: 'attempts', allowedAttempts: 1, submission: { attempt: 1 } }),
    assignment({ id: 'closed', lockAt: new Date('2000-01-01') }),
    assignment({ id: 'quiz', kind: 'quiz' }),
    assignment({ id: 'denied', canSubmit: false }),
  ];
  const files = { files: [file('raw.txt'), file('ok.PDF')], url: 'raw url', text: 'raw text' };
  const fits = assignmentFits(input, files);
  assert.deepEqual(
    fits.map((f) => f.assignment.id),
    ['a', 'b', 'c'],
  );
  assert.equal(fits[1].problem, 'Only takes PDF or DOCX files, so not raw.txt');
  assert.equal(
    assignmentFits([a], { ...files, files: [file('raw.txt')] })[0].problem,
    'Only takes PDF or DOCX files',
  );
  assert.equal(assignmentFits([a], { ...files, files: [file('ok.PDF')] })[0].problem, null);
  assert.equal(
    assignmentFits([assignment({ allowedExtensions: ['jpg'] })], { ...files, files: [file('photo.JPEG')] })[0]
      .problem,
    null,
  );
  assert.deepEqual(assignmentFits(input, { files: [], url: null, text: '  ' }), []);
  for (const kind of ['url', 'text']) {
    const value = { files: [], url: kind === 'url' ? 'url' : null, text: 'text' };
    assert.deepEqual(assignmentFits([assignment({ submissionTypes: ['online_upload'] })], value), []);
    assert.equal(assignmentFits([a], value)[0].problem, null);
  }
  for (const lang of ['en', 'fr', 'ar']) {
    locale = lang;
    const translated = assignmentFits(input, files, { t: runtime.createTranslator(lang) });
    assert.deepEqual(
      translated.map((f) => f.assignment),
      fits.map((f) => f.assignment),
    );
    assert.equal(translated[1].problem, tr('rejectedFiles', { extensions: 'PDF or DOCX', names: 'raw.txt' }));
    assert.equal(assignmentFits([a], files)[0].problem, fits[1].problem);
  }
  h.unmount();
});
test('actual picker relabels all payloads, raw names, fallback and refusal wrappers', () => {
  const h = setup();
  for (const lang of ['en', 'fr', 'ar']) {
    locale = lang;
    for (const kind of ['none', 'url', 'text', 'files']) {
      content = {
        files: kind === 'files' ? [file('Shared file.txt'), file('اسم.pdf')] : [],
        url: kind === 'url' ? 'raw' : null,
        text: kind === 'text' ? 'Raw text' : null,
      };
      shared.setSharedContent(content);
      query = { ...query, data: { assignments: [] } };
      h.render();
      assert.equal(first(h, 'CourseScope').title, tr('title'));
      const empty = first(h, 'EmptyState');
      assert.equal(empty.title, tr(kind === 'none' ? 'empty' : 'unavailable'));
      if (kind !== 'none') {
        assert.equal(first(h, 'Text').children, 'this course'); // supplied English-looking name stays raw
        assert.equal(
          nodes(h.tree, 'Text')[1].children,
          tr('header.' + kind, { count: content.files.length }),
        );
        assert.equal(
          empty.description,
          tr('unavailable.' + kind, { course: 'this course', count: content.files.length }),
        );
        course = undefined;
        h.render();
        assert.equal(first(h, 'Text').children, tr('courseFallback'));
        course = { name: 'this course' };
      }
    }
    query = { ...query, data: { assignments: [assignment({ allowedExtensions: ['pdf', 'docx'] })] } };
    h.render();
    const problem = tr('rejectedFiles', { extensions: 'PDF or DOCX', names: 'Shared file.txt' });
    assert.equal(rows(h)[0].title, 'Raw اسم devoir');
    assert.equal(rows(h)[0].subtitle, problem);
    assert.equal(rows(h)[0].onPress, undefined);
    assert.equal(
      rows(h)[0].accessibilityLabel,
      tr('rowLabel', { name: 'Raw اسم devoir', description: problem }),
    );
    assert.equal(first(h, 'ListGroup').footer, tr('refusedHelp'));
    for (const count of [1, 2, 3, 11]) {
      content = { ...content, files: Array.from({ length: count }, () => file('raw.txt')) };
      shared.setSharedContent(content);
      h.render();
      assert.equal(nodes(h.tree, 'Text')[1].children, tr('header.files', { count }));
    }
    query = { ...query, isError: true, error: Error('Couldn’t load assignments') };
    h.render();
    assert.equal(first(h, 'LoadError').title, tr('loadError'));
    assert.equal(first(h, 'LoadError').error.message, 'Couldn’t load assignments');
    query = { ...query, isError: false, error: null };
  }
  h.unmount();
});
test('due and resubmission use foreground locale and explicit Canvas zone', () => {
  const h = setup();
  const due = new Date('2027-01-01T00:30Z');
  query = { ...query, data: { assignments: [assignment({ dueAt: due, submission: { attempt: 1 } })] } };
  for (const lang of ['en', 'fr', 'ar'])
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      locale = lang;
      dates.setDisplayTimeZone(zone);
      h.render();
      const fmt = (options) =>
        new Intl.DateTimeFormat(lang, { calendar: 'gregory', ...options, timeZone: zone }).format(due);
      const sameYear =
        fmt({ year: 'numeric' }) ===
        new Intl.DateTimeFormat(lang, { calendar: 'gregory', year: 'numeric', timeZone: zone }).format(
          new Date(),
        );
      const expected = tr('resubmission', {
        due: tr('due', {
          day: fmt({ month: 'short', day: 'numeric', ...(!sameYear && { year: 'numeric' }) }),
          time: fmt({ hour: 'numeric', minute: '2-digit' }),
        }),
      });
      assert.equal(rows(h)[0].subtitle, expected);
      assert.equal(
        rows(h)[0].accessibilityLabel,
        tr('rowLabel', { name: query.data.assignments[0].name, description: expected }),
      );
    }
  h.unmount();
});
test('preparation preserves exact slot/preflight/draft/type/router protocol without submitting', () => {
  const h = setup(),
    a = assignment();
  h.unmount();
  for (const kind of ['files', 'url', 'text', 'none']) {
    for (const v of Object.values(calls)) v.length = 0;
    const input = {
      files: kind === 'files' ? [file('Raw اسم.pdf')] : [],
      url: kind === 'url' ? ' https://example.invalid/%20?x=%26 ' : null,
      text: kind === 'text' ? ' A<&>\nB\n\nعربي ' : null,
    };
    startSubmission({ accountId: 'acct', client: env.client }, a, input);
    if (kind === 'none') {
      assert.deepEqual(calls.order, []);
      continue;
    }
    assert.deepEqual(calls.route, [
      {
        pathname: '/course/[courseId]/assignment/[assignmentId]/submit',
        params: {
          courseId: 'c1',
          assignmentId: 'a1',
          type: { files: 'online_upload', url: 'online_url', text: 'online_text_entry' }[kind],
        },
      },
    ]);
    if (kind === 'files')
      assert.deepEqual(calls.uploads, [
        [
          'submission|acct|c1|a1',
          { client: env.client, preflightPath: '/api/v1/courses/c1/assignments/a1/submissions/self/files' },
          [
            {
              uri: input.files[0].uri,
              name: input.files[0].name,
              size: 17,
              mimeType: 'application/octet-stream',
            },
          ],
        ],
      ]);
    else
      assert.deepEqual(calls.drafts, [
        [
          'acct',
          'c1',
          'a1',
          kind === 'url' ? 'url' : 'text',
          kind === 'url' ? input.url : '<p> A&lt;&amp;&gt;<br>B</p><p>عربي </p>',
        ],
      ]);
    assert.equal(calls.clear.length, 0); // picker owns clearing, never the preparation helper
  }
});
test('picker preserves file, URL and text preparation in every catalog', () => {
  for (const lang of ['en', 'fr', 'ar'])
    for (const kind of ['files', 'url', 'text']) {
      const h = setup();
      locale = lang;
      content = {
        files: kind === 'files' ? [file(' raw اسم.pdf')] : [],
        url: kind === 'url' ? ' https://example.invalid/%26 ' : null,
        text: kind === 'text' ? ' raw<&>\nعربي ' : null,
      };
      shared.setSharedContent(content);
      h.render();
      const press = rows(h)[0].onPress;
      press();
      press();
      h.render();
      assert.equal(calls.route.length, 1);
      assert.equal(calls.clear.length, 1);
      assert.deepEqual(calls.order, [kind === 'files' ? 'upload' : 'draft', 'route', 'clear']);
      if (kind === 'files') assert.equal(calls.uploads[0][2][0].name, ' raw اسم.pdf');
      else
        assert.equal(calls.drafts[0][4], kind === 'url' ? content.url : '<p> raw&lt;&amp;&gt;<br>عربي </p>');
      h.unmount();
    }
});
test('committed source transitions retire selection/retry/refresh, locale does not', async () => {
  const changes = [
    () => {
      env.account.id = 'b';
    },
    () => {
      env.account.user.id = 'u2';
    },
    () => {
      env.account.baseUrl = 'https://other.invalid';
    },
    () => {
      env = { ...env, client: {} };
    },
    () => {
      courseId = 'c2';
    },
    () => {
      shared.setSharedContent({ ...content });
    },
    () => {
      content.url = 'https://new.invalid';
    },
    () => {
      query = { ...query, data: { assignments: [assignment({ id: 'other' })] } };
    },
    () => {
      query.data.assignments[0].allowedExtensions = ['pdf'];
    },
    () => {
      query = { ...query, isPending: true };
    },
    () => {
      focused = false;
    },
  ];
  for (const change of changes) {
    const h = setup(),
      press = rows(h)[0].onPress,
      pull = refresh(h).onRefresh;
    change();
    h.render();
    press();
    await pull();
    assert.equal(calls.route.length, 0);
    assert.equal(calls.refresh.length, 0);
    h.unmount();
    const e = setup();
    query = { ...query, isError: true, error: Error('Raw') };
    e.render();
    const retry = first(e, 'LoadError').onRetry;
    change();
    e.render();
    await retry();
    assert.equal(calls.retry.length, 0);
    e.unmount();
  }
  const h = setup(),
    press = rows(h)[0].onPress;
  locale = 'ar';
  query = { ...query, data: structuredClone(query.data), dataUpdatedAt: 2 };
  h.render();
  press();
  assert.equal(calls.route.length, 1);
  h.unmount();
  const e = setup();
  query = { ...query, isError: true, error: Error('Raw') };
  e.render();
  const retry = first(e, 'LoadError').onRetry;
  locale = 'fr';
  e.render();
  await retry();
  assert.equal(calls.retry.length, 1);
  e.unmount();
});
test('locale and zone Date clones preserve pending refresh and offered controls', async () => {
  const h = setup();
  query = { ...query, data: { assignments: [assignment({ dueAt: new Date('2027-01-01T00:30Z') })] } };
  h.render();
  const press = rows(h)[0].onPress,
    d = deferred();
  refreshQueue.push(d.promise);
  const pending = refresh(h).onRefresh();
  locale = 'ar';
  dates.setDisplayTimeZone('Asia/Tokyo');
  query = { ...query, data: structuredClone(query.data), dataUpdatedAt: 2 };
  h.render();
  assert.equal(refresh(h).refreshing, true);
  d.resolve();
  await pending;
  h.render();
  assert.equal(refresh(h).refreshing, false);
  press();
  assert.equal(calls.route.length, 1);
  h.unmount();
});
test('focus, replay, abandoned render and unmount boundaries', async () => {
  const h = setup();
  const old = rows(h)[0].onPress;
  focused = false;
  old();
  assert.equal(calls.route.length, 0);
  h.render();
  focused = true;
  h.render();
  old();
  assert.equal(calls.route.length, 0);
  const live = rows(h)[0].onPress;
  const previous = env;
  env = { ...env, client: {} };
  h.renderOnly();
  h.abandon();
  env = previous;
  live();
  assert.equal(calls.route.length, 1);
  h.unmount();
  const e = setup(),
    retained = rows(e)[0].onPress;
  e.replay();
  e.render();
  retained();
  assert.equal(calls.route.length, 0);
  const latest = rows(e)[0].onPress,
    pull = refresh(e).onRefresh;
  e.unmount();
  latest();
  await pull();
  assert.equal(calls.route.length, 0);
  assert.equal(calls.refresh.length, 0);
});
test('retry/refresh coalesce, recover rejection and ignore obsolete completion', async () => {
  const h = setup();
  query = { ...query, isError: true, error: Error('Raw') };
  h.render();
  const d = deferred();
  retryQueue.push(d.promise);
  const retry = first(h, 'LoadError').onRetry;
  const pending = retry();
  await retry();
  await refresh(h).onRefresh();
  assert.equal(calls.retry.length, 1);
  assert.equal(calls.refresh.length, 0);
  h.render();
  assert.equal(refresh(h).refreshing, true);
  d.reject(Error('synthetic'));
  await pending;
  h.render();
  assert.equal(refresh(h).refreshing, false);
  await first(h, 'LoadError').onRetry();
  assert.equal(calls.retry.length, 2);
  const old = deferred();
  refreshQueue.push(old.promise);
  const p = refresh(h).onRefresh();
  env = { ...env, client: {} };
  h.render();
  const current = deferred();
  refreshQueue.push(current.promise);
  const q = refresh(h).onRefresh();
  old.resolve();
  await p;
  h.render();
  assert.equal(refresh(h).refreshing, true);
  current.resolve();
  await q;
  h.render();
  assert.equal(refresh(h).refreshing, false);
  assert.deepEqual(calls.refresh.at(-1), {
    queryKey: ['acct', 'courses', 'c1', 'assignment_groups'],
    type: 'active',
  });
  h.unmount();
});
test('selection publication cannot reenter preparation for a superseded share', () => {
  const { ShareAssignmentsOwner } = load('@/features/share/shareAssignmentsLifetime');
  const initial = shared.setSharedContent({ files: [], url: 'https://first.invalid', text: null });
  const owner = new ShareAssignmentsOwner(
    true,
    { isFocused: () => true },
    () => shared.getSharedContentSnapshot() === initial,
  );
  owner.activate();
  const unsubscribe = owner.subscribe(() => {
    if (owner.getSnapshot().selected)
      shared.setSharedContent({ files: [], url: 'https://second.invalid', text: null });
  });
  let preparations = 0;
  owner.choose(owner.getSnapshot().epoch, () => {
    preparations++;
  });
  assert.equal(preparations, 0);
  unsubscribe();
  owner.retire();
});
test('new publication or in-place payload change blocks preparation before React commits', async () => {
  for (const change of ['replace', 'replace-return', 'same-reference', 'mutate']) {
    const h = setup();
    const original = content;
    const press = rows(h)[0].onPress;
    const pull = refresh(h).onRefresh;
    if (change === 'mutate') content.url = 'https://changed-before-commit.invalid';
    else {
      shared.setSharedContent(change === 'same-reference' ? original : { ...original });
      if (change === 'replace-return') shared.setSharedContent(original);
    }
    press();
    await pull();
    assert.equal(calls.drafts.length, 0, change + ' cannot prepare a retired share');
    assert.equal(calls.uploads.length, 0);
    assert.equal(calls.clear.length, 0);
    assert.equal(calls.route.length, 0);
    assert.equal(calls.refresh.length, 0);
    h.render();
    rows(h)[0].onPress();
    assert.equal(calls.drafts.length, 1, change + ' allows the newly committed share');
    assert.equal(calls.clear.length, 1);
    h.unmount();
  }
});
(async () => {
  let failed = 0,
    passed = 0;
  for (const { name, fn, regression } of tests) {
    if (process.argv.includes('--before') && !regression) continue;
    try {
      await fn();
      passed++;
    } catch (error) {
      failed++;
      console.error('FAIL ' + name + ': ' + error.message);
    }
  }
  console.log(
    `share-assignments: ${passed} passed, ${failed} failed; TZ=${process.env.TZ ?? 'default'}; synthetic boundaries only`,
  );
  process.exitCode = failed ? 1 : 0;
})();
