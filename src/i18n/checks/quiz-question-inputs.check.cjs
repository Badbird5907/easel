/* global __dirname */
// Production controls and locale runtime. Synthetic staged hooks/native/animation
// boundaries only: no React reconciliation, native acceptance, HTTP or storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
let scope;
const effect = (kind) => (fn, deps) => {
  const s = scope,
    i = s.cursor++,
    old = s.slots[i];
  if (!old || !deps || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
    const slot = { deps, fn, kind, cleanup: null };
    s.slots[i] = slot;
    s[kind].push(() => {
      old?.cleanup?.();
      slot.cleanup = fn();
    });
  }
};
const react = {
  useState(initial) {
    const s = scope,
      i = s.cursor++;
    if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [
      s.slots[i],
      (value) => {
        assert.ok(s.mounted, 'setState after unmount');
        const next = typeof value === 'function' ? value(s.slots[i]) : value;
        if (!Object.is(next, s.slots[i])) {
          s.slots[i] = next;
          s.dirty = true;
        }
      },
    ];
  },
  useRef(initial) {
    const s = scope,
      i = s.cursor++;
    return (s.slots[i] ??= { current: initial });
  },
  useMemo(fn, deps) {
    const s = scope,
      i = s.cursor++,
      old = s.slots[i];
    if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) s.slots[i] = { deps, value: fn() };
    return s.slots[i].value;
  },
  useCallback(fn, deps) {
    return react.useMemo(() => fn, deps);
  },
  useLayoutEffect: effect('layouts'),
  useEffect: effect('effects'),
  useSyncExternalStore(subscribe, snapshot) {
    const [, update] = react.useState(0);
    react.useLayoutEffect(() => subscribe(() => update((n) => n + 1)), [subscribe]);
    return snapshot();
  },
};
react.useImperativeHandle = (ref, create, deps) =>
  react.useLayoutEffect(() => {
    if (!ref) return;
    const value = create();
    if (typeof ref === 'function') ref(value);
    else ref.current = value;
    return () => {
      if (typeof ref === 'function') ref(null);
      else ref.current = null;
    };
  }, deps);

function mount(fn) {
  const s = {
    cursor: 0,
    slots: [],
    layouts: [],
    effects: [],
    mounted: true,
    dirty: false,
  };
  let previous;
  const m = {
    get dirty() {
      return s.dirty;
    },
    renderOnly() {
      assert.ok(s.mounted);
      previous ??= s.slots.slice();
      s.cursor = 0;
      s.dirty = false;
      const old = scope;
      scope = s;
      try {
        return fn();
      } finally {
        scope = old;
      }
    },
    abandon() {
      s.slots = previous;
      previous = undefined;
      s.layouts = [];
      s.effects = [];
      s.dirty = false;
    },
    commit() {
      previous = undefined;
      for (const key of ['layouts', 'effects']) while (s[key].length) s[key].shift()();
    },
    render() {
      let tree = m.renderOnly();
      m.commit();
      let limit = 15;
      while (s.dirty) {
        assert.ok(limit--);
        tree = m.renderOnly();
        m.commit();
      }
      return tree;
    },
    replayEffects() {
      for (const slot of s.slots) slot?.cleanup?.();
      for (const kind of ['layouts', 'effects'])
        for (const slot of s.slots) if (slot?.kind === kind) slot.cleanup = slot.fn();
    },
    unmount() {
      for (const slot of s.slots) slot?.cleanup?.();
      s.mounted = false;
    },
  };
  return m;
}

const root = path.resolve(__dirname, '../..');
const cache = new Map();
const allowed = new Set([
  'i18n',
  'i18n/runtime',
  'i18n/en',
  'i18n/fr',
  'i18n/ar',
  'canvas/html',
  'features/quizzes/answers',
  'features/quizzes/questionInputOwner',
  'features/quizzes/QuestionView',
  'features/quizzes/FileUploadAnswer',
]);
const events = [],
  calls = [],
  queue = [];
const session = { account: { id: 'A' }, client: {} };
let account = session.account,
  client = session.client;
const elements = (names) => Object.fromEntries(names.split(' ').map((n) => [n, n]));
const jsx = (type, props, key) => ({ type, props, key });
function boundary(name, args) {
  calls.push([name, args]);
  const next = queue.shift();
  assert.ok(next, 'Unexpected synthetic action ' + name);
  assert.equal(next.name, name);
  return next.value;
}
const mocks = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': {
    ...elements('Pressable View'),
    Platform: { OS: 'ios' },
    Alert: { alert: (...args) => calls.push(['alert', args]) },
  },
  'lucide-react-native': elements('Check ChevronDown Flag Globe Camera FileUp Image Paperclip X'),
  '@/design': {
    ...elements('Button Callout Card Icon OptionGroup Sheet Text TextField IconButton ProgressBar'),
    haptics: { selection: () => events.push(['haptic']) },
  },
  '@/features/content/RichContent': elements('RichContent'),
  '@/features/editor/RichEditor': elements('RichEditor'),
  '@/lib/cn': { cn: (...args) => args.filter(Boolean).join(' ') },
  '@/canvas/session': { useCanvas: () => ({ account, client }) },
  'expo-document-picker': { getDocumentAsync: (...args) => boundary('document', args) },
  'expo-image-picker': {
    requestCameraPermissionsAsync: (...args) => boundary('permission', args),
    launchCameraAsync: (...args) => boundary('camera', args),
    launchImageLibraryAsync: (...args) => boundary('library', args),
  },
  '@/features/quizzes/upload': { uploadQuizFile: (...args) => boundary('upload', args) },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mocks[key]) return mocks[key];
  assert.ok(key.startsWith('@/') && allowed.has(key.slice(2)), 'Unexpected import ' + key);
  const file = ['.ts', '.tsx', '/index.ts'].map((e) => path.join(root, key.slice(2)) + e).find(fs.existsSync);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  new vm.Script(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    { filename: file },
  ).runInNewContext({
    module,
    exports: module.exports,
    require: (n) => load(n, file),
    Intl,
    Date,
    Error,
    URL,
    console,
  });
  return module.exports;
}

const runtime = load('@/i18n/runtime');
const { QuestionView } = load('@/features/quizzes/QuestionView');
const { FileUploadAnswer } = load('@/features/quizzes/FileUploadAnswer');
const { isNumberLike, formatQuestionPoints } = load('@/features/quizzes/answers');
const { htmlToText } = load('@/canvas/html');
const locale = (lang) => {
  runtime.setAccountLocale(account.id, lang);
  return runtime.createTranslator(lang);
};
// Each real local component has its own hooks. Render-only stages all descendants;
// only commit publishes owners. Abandon and removed keyed children run separately.
function mountTree(fn) {
  let committed = new Map(),
    staged,
    seen,
    tree;
  function expand(node, address = 'root') {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n, i) => expand(n, address + '/' + (n?.key ?? i)));
    if (typeof node.type === 'function') {
      const key = address + ':' + node.type.name;
      let entry = committed.get(key);
      if (!entry) {
        entry = { node };
        entry.mount = mount(() => entry.node.type(entry.node.props));
      }
      entry.node = node;
      staged.set(key, entry);
      seen.push(entry.mount);
      return expand(entry.mount.renderOnly(), key);
    }
    return {
      ...node,
      props: { ...node.props, children: expand(node.props?.children, address + '/children') },
    };
  }
  const api = {
    renderOnly() {
      staged = new Map();
      seen = [];
      tree = expand(jsx(fn, {}));
      return tree;
    },
    commit() {
      for (const [k, e] of committed) if (!staged.has(k)) e.mount.unmount();
      seen.forEach((m) => m.commit());
      committed = staged;
    },
    abandon() {
      seen.forEach((m) => m.abandon());
    },
    render() {
      let limit = 15;
      do {
        assert.ok(limit--);
        api.renderOnly();
        api.commit();
      } while (seen.some((m) => m.dirty));
      return tree;
    },
    unmount() {
      for (const e of committed.values()) e.mount.unmount();
      committed.clear();
    },
  };
  return api;
}
const nodes = (tree) =>
  !tree || typeof tree !== 'object'
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(nodes)
      : [tree, ...nodes(tree.props?.children)];
const all = (tree, type) => nodes(tree).filter((n) => n.type === type);
const one = (tree, type) => {
  const ns = all(tree, type);
  assert.equal(ns.length, 1, type);
  return ns[0].props;
};
const texts = (tree) =>
  typeof tree === 'string' || typeof tree === 'number'
    ? [String(tree)]
    : !tree
      ? []
      : Array.isArray(tree)
        ? tree.flatMap(texts)
        : texts(tree.props?.children);
const equal = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const hash = (v) =>
  crypto
    .createHash('sha256')
    .update(typeof v === 'string' ? v : JSON.stringify(v))
    .digest('hex');
const baseline = require('./quiz-question-inputs.baseline.json');
for (const lang of ['en', 'fr', 'ar']) {
  const catalog = load('@/i18n/' + lang)[lang];
  const historical = require('./tool-launch-consumers.baseline.json').catalogs[lang];
  const results = require('./quiz-controls.baseline.json').catalogs[lang];
  assert.equal(Object.keys(historical).length, 2330);
  assert.equal(Object.keys(results).length, 35);
  assert.equal(Object.keys(baseline.catalogs[lang]).length, 25);
  for (const [k, v] of Object.entries(historical)) assert.equal(hash(JSON.stringify(catalog[k])), v, k);
  for (const [k, v] of Object.entries(results)) assert.equal(hash(catalog[k]), v, k);
  for (const [k, v] of Object.entries(baseline.catalogs[lang])) equal(catalog[k], v);
  assert.equal(Object.keys(catalog).filter((k) => k.startsWith('quizPresentation.')).length, 85);
}
for (const [file, digest] of Object.entries(baseline.sources)) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  // Authorized full parent migration: quiz-attempt-screen.check.cjs executes the actual
  // screen/route interface, protocols and lifetimes. Historical digest remains in baseline.
  if (file.endsWith('QuizAttemptScreen.tsx')) continue;
  // QUIZ-2/4 explicitly supersedes engine/storage freezes with real protocol/race
  // checks in quiz-engine.check.cjs. Original historical hashes remain untouched.
  if (file.endsWith('useQuizAttempt.ts') || file.endsWith('storage.ts')) continue;

  assert.equal(hash(source), digest, file);
}
// Execute the actual parent JSX call site in isolation: no attempt engine is loaded.
{
  const source = fs.readFileSync(path.join(root, 'features/quizzes/QuizAttemptScreen.tsx'), 'utf8');
  const ast = ts.createSourceFile('parent.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites = [];
  const visit = (n) => {
    if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === 'QuestionView') sites.push(n);
    ts.forEachChild(n, visit);
  };
  visit(ast);
  assert.equal(sites.length, 1);
  const code = ts.transpileModule(
    'const wired = (' + sites[0].getText(ast) + '); globalThis.wired = wired;',
    { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const context = {
    exports: {},
    require: (n) => {
      assert.equal(n, 'react/jsx-runtime');
      return { jsx };
    },
    QuestionView: 'QuestionView',
    controlsAttemptKey: 'serialized-attempt',
    question: { id: 'q', answer: { kind: 'none' } },
    answers: {},
    flags: {},
    numbers: new Map(),
    total: 1,
    courseId: 'c',
    quizId: 'quiz',
    status: { kind: 'ready' },
    openWeb: () => {},
  };
  vm.runInNewContext(code, context);
  assert.equal(context.wired.props.attemptKey, 'serialized-attempt');
  assert.equal(context.wired.props.question.id, 'q');
  assert.match(
    fs.readFileSync(path.join(root, 'features/quizzes/QuestionView.tsx'), 'utf8'),
    /attemptKey\?: string/,
  );
}
const choice = (id, text = id) => ({ id, text, html: null });
const question = (type = 'multiple_choice_question', extra = {}) => ({
  id: 'q',
  type,
  html: '<p>RAW العربية</p>',
  points: 1.005,
  variables: [{ name: 'raw-x', value: '01.00' }],
  answers: [choice('a', 'True'), choice('b', 'False')],
  matches: [
    { id: 'm1', text: 'RAW match' },
    { id: 'm2', text: 'RAW other' },
  ],
  blanks: [
    { id: 'b1', number: 1, options: [choice('o1'), choice('o2')] },
    { id: 'b2', number: 2, options: [choice('o3')] },
  ],
  ...extra,
});
const props = (type, answer = { kind: 'none' }) => ({
  question: question(type),
  answer,
  flagged: false,
  number: 1,
  total: 1200,
  courseId: 'c',
  quizId: 'quiz',
  attemptKey: 'attempt',
  onChange: (a) => events.push(['answer', a]),
  onToggleFlag: () => events.push(['flag']),
  onOpenWeb: () => events.push(['web']),
});
const reset = () => {
  account = session.account;
  client = session.client;
  locale('en');
  events.length = 0;
  calls.length = 0;
  assert.equal(queue.length, 0);
};
const pressables = (tree) => all(tree, 'Pressable').map((n) => n.props);
const rows = (tree) => pressables(tree).filter((p) => 'expanded' in p.accessibilityState);
const options = (tree) => all(tree, 'OptionGroup').map((n) => n.props);
const sheets = (tree) => all(tree, 'Sheet').map((n) => n.props);
const lastAnswer = () => events.filter((e) => e[0] === 'answer').at(-1)?.[1];
// All question branches, raw content, number precision, plurals and language transitions.
for (const type of [
  'multiple_choice_question',
  'true_false_question',
  'multiple_answers_question',
  'matching_question',
  'multiple_dropdowns_question',
  'fill_in_multiple_blanks_question',
  'short_answer_question',
  'numerical_question',
  'calculated_question',
  'essay_question',
  'file_upload_question',
  'text_only_question',
  'unsupported',
]) {
  reset();
  let p = props(type, { kind: 'text', value: '<p>raw one two</p>' });
  const m = mountTree(() => QuestionView(p));
  for (const lang of ['en', 'fr', 'ar', 'en-US-u-nu-arab']) {
    const t = locale(lang),
      tree = m.render();
    assert.equal(all(tree, 'RichContent')[0].props.html, p.question.html);
    assert.ok(texts(tree).includes(t('quizInputs.heading', { number: 1, total: 1200 })));
    assert.ok(
      texts(tree).includes(
        t('submissionFeedback.points', {
          value: new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(1.005),
        }),
      ),
    );
    assert.ok(texts(tree).includes('raw-x'));
    assert.ok(texts(tree).includes(' = 01.00'));
    const flag = pressables(tree)[0];
    flag.onPress();
    equal(events.slice(-2), [['haptic'], ['flag']]);
    assert.equal(flag.accessibilityHint, t('quizInputs.flagHint'));
    if (type === 'true_false_question')
      equal(
        pressables(tree)
          .slice(1)
          .map((p) => p.accessibilityLabel),
        ['True', 'False'],
      );
    if (type === 'essay_question') {
      const editor = one(tree, 'RichEditor');
      assert.equal(editor.value, p.answer.value);
      assert.equal(editor.minHeight, 200);
      assert.ok(texts(tree).includes(t('quizInputs.words', { count: 3 })));
      editor.onChange('<p>RAW <img src="raw-url"/></p>');
      equal(lastAnswer(), { kind: 'text', value: '<p>RAW <img src="raw-url"/></p>' });
    }
    if (type === 'unsupported') {
      one(tree, 'Callout').action.onPress();
      equal(events.at(-1), ['web']);
    }
    if (type === 'text_only_question')
      assert.equal(
        all(tree, 'TextField').length + all(tree, 'OptionGroup').length + all(tree, 'Button').length,
        0,
      );
  }
  m.unmount();
}
reset();
let p = props('short_answer_question'),
  m = mountTree(() => QuestionView(p));
for (const points of [null, 0, 1, 1.005, 1.015, 12345.675, -1, NaN, Infinity]) {
  p = { ...p, question: { ...p.question, points } };
  const tree = m.render();
  if (points === null) assert.ok(!texts(tree).some((s) => s.endsWith('pts')));
  else assert.ok(texts(tree).includes(formatQuestionPoints(points)), String(points));
}
p = { ...p, number: null };
let tree = m.render();
assert.equal(all(tree, 'Pressable').length, 0);
assert.ok(texts(tree).includes('Information'));
m.unmount();
for (const type of ['short_answer_question', 'numerical_question', 'calculated_question', 'essay_question']) {
  reset();
  p = props(type);
  m = mountTree(() => QuestionView(p));
  for (const value of [
    '',
    ' ',
    '1',
    '-3.5',
    '-1,5e2',
    '1.2e3',
    '1.005',
    'not a number',
    '<p>a &amp; b</p>',
  ]) {
    p = { ...p, answer: { kind: 'text', value } };
    for (const lang of ['en', 'fr', 'ar']) {
      const t = locale(lang);
      tree = m.render();
      const field = one(tree, type === 'essay_question' ? 'RichEditor' : 'TextField');
      assert.equal(field.value, value);
      assert.equal(field.label, t('quizInputs.answer'));
      (field.onChangeText ?? field.onChange)(value);
      equal(lastAnswer(), { kind: 'text', value });
      if (type === 'numerical_question' || type === 'calculated_question') {
        assert.equal(
          field.error,
          value.trim() !== '' && !isNumberLike(value) ? t('quizInputs.invalidNumber') : null,
        );
        assert.equal(field.keyboardType, 'numbers-and-punctuation');
        assert.equal(field.autoCorrect, false);
        assert.equal(field.returnKeyType, 'done');
      }
      if (type === 'essay_question')
        assert.ok(
          texts(tree).includes(
            t('quizInputs.words', { count: htmlToText(value).split(/\s+/).filter(Boolean).length }),
          ),
        );
    }
  }
  if (type === 'numerical_question') {
    mocks['react-native'].Platform.OS = 'android';
    assert.equal(one(m.render(), 'TextField').keyboardType, 'numeric');
    mocks['react-native'].Platform.OS = 'ios';
  }
  m.unmount();
}
// Retained callbacks merge with latest COMMITTED answer, never their old render.
for (const type of [
  'multiple_choice_question',
  'true_false_question',
  'multiple_answers_question',
  'fill_in_multiple_blanks_question',
]) {
  reset();
  p = props(type);
  m = mountTree(() => QuestionView(p));
  tree = m.render();
  const handler =
    type === 'fill_in_multiple_blanks_question'
      ? all(tree, 'TextField')[0].props.onChangeText
      : pressables(tree)[1].onPress;
  p = {
    ...p,
    answer:
      type === 'fill_in_multiple_blanks_question'
        ? { kind: 'blanks', values: { b2: 'keep' } }
        : { kind: 'choices', ids: ['b'] },
    onChange: (a) => events.push(['answer', a]),
  };
  m.render();
  handler('RAW');
  equal(
    lastAnswer(),
    type === 'fill_in_multiple_blanks_question'
      ? { kind: 'blanks', values: { b2: 'keep', b1: 'RAW' } }
      : type === 'multiple_answers_question'
        ? { kind: 'choices', ids: ['b', 'a'] }
        : { kind: 'choice', id: 'a' },
  );
  p = { ...p, answer: lastAnswer() };
  m.render();
  handler('');
  if (type === 'multiple_answers_question') equal(lastAnswer(), { kind: 'choices', ids: ['b'] });
  if (type === 'fill_in_multiple_blanks_question')
    equal(lastAnswer(), { kind: 'blanks', values: { b2: 'keep', b1: '' } });
  m.unmount();
}
// Sheet identity is semantic, independent of raw labels and locale; stale close/select
// cannot touch a newly opened sheet. Matching clears retain the null pair payload.
for (const type of ['matching_question', 'multiple_dropdowns_question']) {
  reset();
  p = props(type);
  m = mountTree(() => QuestionView(p));
  tree = m.render();
  rows(tree)[0].onPress();
  tree = m.render();
  const retained = options(tree)[0].onSelect,
    close = sheets(tree)[0].onClose;
  for (const lang of ['fr', 'ar', 'en']) {
    locale(lang);
    p = {
      ...p,
      question: {
        ...p.question,
        answers: p.question.answers.map((a) => ({ ...a, text: 'RAW changed ' + a.id })),
      },
    };
    tree = m.render();
    assert.equal(sheets(tree)[0].visible, true);
    equal(
      options(tree)[0].options.map((o) => o.value),
      type === 'matching_question' ? ['m1', 'm2'] : ['o1', 'o2'],
    );
  }
  p = {
    ...p,
    answer:
      type === 'matching_question'
        ? { kind: 'matching', pairs: [{ answerId: 'b', matchId: 'm2' }] }
        : { kind: 'blanks', values: { b2: 'o3' } },
  };
  m.render();
  retained('removed');
  assert.equal(lastAnswer(), undefined);
  retained(type === 'matching_question' ? 'm1' : 'o1');
  equal(
    lastAnswer(),
    type === 'matching_question'
      ? {
          kind: 'matching',
          pairs: [
            { answerId: 'b', matchId: 'm2' },
            { answerId: 'a', matchId: 'm1' },
          ],
        }
      : { kind: 'blanks', values: { b2: 'o3', b1: 'o1' } },
  );
  p = { ...p, answer: lastAnswer() };
  tree = m.render();
  assert.equal(sheets(tree)[0].visible, false);
  rows(tree)[0].onPress();
  tree = m.render();
  events.length = 0;
  close();
  retained(type === 'matching_question' ? 'm2' : 'o2');
  tree = m.render();
  assert.equal(sheets(tree)[0].visible, true);
  assert.equal(events.length, 0);
  if (type === 'matching_question') {
    all(tree, 'Button')[0].props.onPress();
    equal(lastAnswer(), {
      kind: 'matching',
      pairs: [
        { answerId: 'b', matchId: 'm2' },
        { answerId: 'a', matchId: null },
      ],
    });
  } else assert.equal(all(tree, 'Button').length, 0); // no invented dropdown clear
  m.unmount();
}
// Current callbacks and flags publish on commit; rich choice HTML stays raw.
reset();
p = props('multiple_choice_question');
m = mountTree(() => QuestionView(p));
tree = m.render();
const retainedFlag = pressables(tree)[0].onPress;
p = {
  ...p,
  flagged: true,
  onToggleFlag: () => events.push(['latest-flag']),
  question: {
    ...p.question,
    answers: [{ id: 'a', text: '', html: '<img src="raw://image" />' }, choice('b')],
  },
};
tree = m.render();
retainedFlag();
equal(events.slice(-2), [['haptic'], ['latest-flag']]);
assert.equal(pressables(tree)[0].accessibilityState.selected, true);
assert.ok(all(tree, 'RichContent').some((n) => n.props.html === '<img src="raw://image" />'));
m.unmount();
function actions(tree) {
  return [
    ...pressables(tree).map((p) => () => p.onPress()),
    ...all(tree, 'TextField').map((n) => () => n.props.onChangeText('stale')),
    ...all(tree, 'RichEditor').map((n) => () => n.props.onChange('stale')),
    ...options(tree).map((p) => () => p.onSelect('m1')),
    ...sheets(tree).map((p) => p.onClose),
    ...all(tree, 'Callout').map((n) => n.props.action.onPress),
  ];
}
for (const type of [
  'multiple_answers_question',
  'fill_in_multiple_blanks_question',
  'matching_question',
  'multiple_dropdowns_question',
  'essay_question',
  'unsupported',
])
  for (const mode of [
    'account',
    'client',
    'course',
    'quiz',
    'attempt',
    'question',
    'type',
    'membership',
    'disabled',
    'unmount',
  ]) {
    reset();
    p = props(type);
    m = mountTree(() => QuestionView(p));
    tree = m.render();
    if (rows(tree).length) {
      rows(tree)[0].onPress();
      tree = m.render();
    }
    const old = p,
      stale = actions(tree);
    p = { ...p, attemptKey: 'discard', onChange: () => events.push(['discard']) };
    const discarded = actions(m.renderOnly());
    m.abandon();
    p = old;
    events.length = 0;
    discarded.forEach((f) => f());
    assert.equal(events.length, 0);
    // Same-identity speculative callback publication is also forbidden.
    p = { ...p, onChange: () => events.push(['discard']), onOpenWeb: () => events.push(['discard']) };
    m.renderOnly();
    m.abandon();
    p = old;
    if (mode === 'account') account = { id: 'B' };
    if (mode === 'client') client = {};
    if (mode === 'course') p = { ...p, courseId: 'C' };
    if (mode === 'quiz') p = { ...p, quizId: 'Q' };
    if (mode === 'attempt') p = { ...p, attemptKey: 'B' };
    if (mode === 'question') p = { ...p, question: { ...p.question, id: 'new' } };
    if (mode === 'type') p = { ...p, question: { ...p.question, type: 'short_answer_question' } };
    if (mode === 'membership')
      p = { ...p, question: { ...p.question, answers: [choice('new')], matches: [], blanks: [] } };
    if (mode === 'disabled') p = { ...p, disabled: true };
    if (mode === 'unmount') m.unmount();
    else m.render();
    events.length = 0;
    stale.forEach((f) => f());
    assert.equal(events.length, 0, type + ' ' + mode);
    if (mode === 'unmount') continue;
    if (mode === 'disabled' && type === 'unsupported') {
      one(m.render(), 'Callout').action.onPress();
      equal(events.at(-1), ['web']);
    }
    p = old;
    account = session.account;
    client = session.client;
    m.render();
    events.length = 0;
    stale.forEach((f) => f());
    assert.equal(events.length, 0, 'away/back ' + mode);
    m.unmount();
  }
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const expect = (name, value) => queue.push({ name, value });
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const doc = {
  canceled: false,
  assets: [{ uri: 'raw://uri', name: 'RAW العربية.pdf', size: 123, mimeType: 'application/pdf' }],
};
const image = {
  canceled: false,
  assets: [{ uri: 'raw://image', fileName: 'RAW.mov', fileSize: 99, mimeType: 'video/quicktime' }],
};
const fileProps = () => ({
  courseId: 'c',
  quizId: 'quiz',
  attemptKey: 'attempt',
  questionId: 'q',
  answer: { kind: 'file', attachmentId: null },
  onChange: (a) => events.push(['answer', a]),
});
const fileButtons = (tree) => all(tree, 'Button').map((n) => n.props);
async function fileTests() {
  for (const source of ['document', 'camera', 'library']) {
    reset();
    let fp = fileProps();
    const fm = mountTree(() => FileUploadAnswer(fp));
    let ft = fm.render();
    const pick = deferred(),
      upload = deferred();
    if (source === 'camera') expect('permission', { granted: true });
    expect(source, pick.promise);
    const index = ['document', 'camera', 'library'].indexOf(source),
      retained = fileButtons(ft)[index].onPress;
    retained();
    retained();
    fileButtons(ft)[(index + 1) % 3].onPress();
    await flush();
    assert.equal(calls.filter((c) => c[0] === source).length, 1);
    assert.equal(fileButtons(fm.render())[0].disabled, true);
    for (const lang of ['fr', 'ar', 'en']) {
      locale(lang);
      ft = fm.render();
      assert.equal(fileButtons(ft)[0].disabled, true);
      assert.equal(all(ft, 'ProgressBar').length, 0);
    }
    expect('upload', upload.promise);
    pick.resolve(source === 'document' ? doc : image);
    await flush();
    const args = calls.find((c) => c[0] === 'upload')[1];
    assert.equal(args[0], client);
    equal(args.slice(1, 3), ['c', 'quiz']);
    equal(
      args[3],
      source === 'document'
        ? { uri: 'raw://uri', name: 'RAW العربية.pdf', size: 123, mimeType: 'application/pdf' }
        : { uri: 'raw://image', name: 'RAW.mov', size: 99, mimeType: 'video/quicktime' },
    );
    equal(
      calls.find((c) => c[0] === source)[1],
      source === 'document'
        ? [{ copyToCacheDirectory: true }]
        : [{ mediaTypes: ['images', 'videos'], quality: 0.85 }],
    );
    for (const progress of [0, 0.25, null, 0.95]) {
      args[4](progress);
      assert.equal(one(fm.render(), 'ProgressBar').value, progress ?? 0.1);
    }
    locale('ar');
    fp = {
      ...fp,
      answer: { ...fp.answer, name: 'presentation name' },
      onChange: (a) => events.push(['latest', a]),
    };
    fm.render();
    upload.resolve({ id: 'file-id', name: 'RAW SERVER name' });
    await flush();
    equal(events.at(-1), ['latest', { kind: 'file', attachmentId: 'file-id', name: 'RAW SERVER name' }]);
    args[4](0.5);
    ft = fm.render();
    assert.equal(all(ft, 'ProgressBar').length, 0);
    assert.equal(fileButtons(ft)[0].disabled, false);
    fm.unmount();
    retained();
    assert.equal(queue.length, 0);
  }
  // Production QuestionView forwards question/attempt ownership into the actual file child.
  reset();
  let qp = props('file_upload_question', { kind: 'file', attachmentId: null });
  const qm = mountTree(() => QuestionView(qp));
  let qt = qm.render();
  const pending = deferred();
  expect('document', pending.promise);
  fileButtons(qt)[0].onPress();
  qp = { ...qp, attemptKey: 'replacement' };
  qm.render();
  pending.resolve(doc);
  await flush();
  assert.equal(calls.filter((c) => c[0] === 'upload').length, 0);
  qm.unmount();
  // Cancellation, picker/permission rejection and denial all release the synchronous claim.
  for (const source of ['document', 'camera', 'library'])
    for (const outcome of ['cancel', 'error', 'emptyError', 'unknown', 'deny']) {
      if (outcome === 'deny' && source !== 'camera') continue;
      reset();
      const fp = fileProps(),
        fm = mountTree(() => FileUploadAnswer(fp));
      let ft = fm.render();
      const action = fileButtons(ft)[['document', 'camera', 'library'].indexOf(source)].onPress;
      const d = deferred();
      if (source === 'camera') expect('permission', outcome === 'deny' ? d.promise : { granted: true });
      if (outcome !== 'deny') expect(source, d.promise);
      action();
      await flush();
      locale('fr');
      fm.render();
      if (outcome === 'cancel') d.resolve({ canceled: true, assets: null });
      if (outcome === 'deny') d.resolve({ granted: false });
      if (outcome === 'error') d.reject(new Error('RAW server <x>'));
      if (outcome === 'emptyError') d.reject(new Error(''));
      if (outcome === 'unknown') d.reject(null);
      await flush();
      ft = fm.render();
      assert.equal(fileButtons(ft)[0].disabled, false);
      assert.equal(calls.filter((c) => c[0] === 'upload').length, 0);
      if (outcome === 'deny')
        equal(calls.find((c) => c[0] === 'alert')[1], [
          runtime.createTranslator('en')('quizInputs.cameraTitle'),
          runtime.createTranslator('en')('quizInputs.cameraHelp'),
        ]);
      if (['error', 'emptyError', 'unknown'].includes(outcome))
        for (const lang of ['fr', 'ar', 'en']) {
          const t = locale(lang);
          ft = fm.render();
          assert.ok(
            texts(ft).includes(
              t('quizInputs.fileError', {
                detail:
                  outcome === 'error'
                    ? 'RAW server <x>'
                    : outcome === 'emptyError'
                      ? ''
                      : t('quizInputs.pickFailed'),
              }),
            ),
          );
        }
      expect('document', { canceled: true, assets: null });
      fileButtons(ft)[0].onPress();
      await flush();
      fm.unmount();
    }
  reset();
  let fp = fileProps(),
    fm = mountTree(() => FileUploadAnswer(fp));
  let ft = fm.render();
  expect('permission', Promise.reject(new Error('RAW permission failure')));
  fileButtons(ft)[1].onPress();
  await flush();
  assert.ok(texts(fm.render()).some((s) => s.includes('RAW permission failure')));
  fm.unmount();
  // Original fallback name protocol, including absent MIME (no localized filename).
  for (const mimeType of [undefined, 'image/png']) {
    reset();
    fp = fileProps();
    fm = mountTree(() => FileUploadAnswer(fp));
    ft = fm.render();
    expect('library', { canceled: false, assets: [{ uri: 'raw', fileName: null, mimeType, fileSize: 7 }] });
    expect('upload', { id: 'new', name: 'server' });
    fileButtons(ft)[2].onPress();
    await flush();
    const file = calls.find((c) => c[0] === 'upload')[1][3];
    assert.match(file.name, new RegExp('^photo-[0-9]+\\.' + (mimeType ? 'png' : 'jpg') + '$'));
    equal({ uri: file.uri, size: file.size, mimeType: file.mimeType }, { uri: 'raw', size: 7, mimeType });
    fm.unmount();
  }
  // Error is a reason + raw detail, localized at render, never a captured translation.
  for (const reason of [new Error('raw-upload'), null, new Error(''), 'raw rejection']) {
    reset();
    fp = fileProps();
    fm = mountTree(() => FileUploadAnswer(fp));
    ft = fm.render();
    const upload = deferred();
    expect('document', doc);
    expect('upload', upload.promise);
    fileButtons(ft)[0].onPress();
    await flush();
    upload.reject(reason);
    await flush();
    for (const lang of ['en', 'fr', 'ar']) {
      const t = locale(lang);
      assert.ok(
        texts(fm.render()).includes(
          t('quizInputs.fileError', {
            detail: typeof reason === 'string' ? reason : (reason?.message ?? t('quizInputs.uploadFailed')),
          }),
        ),
      );
    }
    expect('document', doc);
    expect('upload', { id: 'recovered', name: 'raw' });
    fileButtons(fm.render())[0].onPress();
    await flush();
    equal(lastAnswer(), { kind: 'file', attachmentId: 'recovered', name: 'raw' });
    fm.unmount();
  }
  // Each committed identity turn retires pending permission/picker/upload work.
  // New owner can recover while old work completes; old finally cannot release its claim.
  for (const stage of ['permission', 'picker', 'upload'])
    for (const mode of [
      'account',
      'client',
      'course',
      'quiz',
      'attempt',
      'question',
      'disabled',
      'answer',
      'unmount',
    ])
      for (const outcome of ['success', 'failure']) {
        reset();
        fp = fileProps();
        fm = mountTree(() => FileUploadAnswer(fp));
        ft = fm.render();
        const old = fp,
          d = deferred();
        if (stage === 'permission') {
          expect('permission', d.promise);
          fileButtons(ft)[1].onPress();
        }
        if (stage === 'picker') {
          expect('document', d.promise);
          fileButtons(ft)[0].onPress();
        }
        if (stage === 'upload') {
          expect('document', doc);
          expect('upload', d.promise);
          fileButtons(ft)[0].onPress();
        }
        await flush();
        const stale = fileButtons(ft).map((b) => b.onPress),
          progress = calls.find((c) => c[0] === 'upload')?.[1][4];
        if (mode === 'account') account = { id: 'B' };
        if (mode === 'client') client = {};
        if (mode === 'course') fp = { ...fp, courseId: 'new' };
        if (mode === 'quiz') fp = { ...fp, quizId: 'new' };
        if (mode === 'attempt') fp = { ...fp, attemptKey: 'new' };
        if (mode === 'question') fp = { ...fp, questionId: 'new' };
        if (mode === 'disabled') fp = { ...fp, disabled: true };
        if (mode === 'answer')
          fp = { ...fp, answer: { kind: 'file', attachmentId: 'external', name: 'new file' } };
        if (mode === 'unmount') fm.unmount();
        else fm.render();
        const before = calls.length;
        stale.forEach((f) => f());
        assert.equal(calls.length, before);
        let fresh;
        if (mode !== 'unmount') {
          // away/back never revives old callbacks or operation
          fp = old;
          account = session.account;
          client = session.client;
          ft = fm.render();
          stale.forEach((f) => f());
          assert.equal(calls.length, before);
          fresh = deferred();
          expect('document', fresh.promise);
          fileButtons(ft)[0].onPress();
        }
        progress?.(0.8);
        if (outcome === 'failure') d.reject(new Error('retired error'));
        else
          d.resolve(
            stage === 'permission'
              ? { granted: true }
              : stage === 'picker'
                ? doc
                : { id: 'retired', name: 'retired' },
          );
        await flush();
        assert.equal(events.length, 0);
        if (mode !== 'unmount') {
          ft = fm.render();
          assert.equal(fileButtons(ft)[0].disabled, true);
          assert.equal(all(ft, 'ProgressBar').length, 0);
          assert.ok(!texts(ft).some((s) => s.includes('retired')));
          const beforeDuplicate = calls.length;
          fileButtons(ft)[0].onPress();
          assert.equal(calls.length, beforeDuplicate);
          fresh.resolve({ canceled: true, assets: null });
          await flush();
          assert.equal(fileButtons(fm.render())[0].disabled, false);
          fm.unmount();
        }
      }
  // Raw filename and removals; stale remove cannot erase a newer file answer.
  reset();
  fp = { ...fileProps(), answer: { kind: 'file', attachmentId: 'id', name: 'RAW file' } };
  fm = mountTree(() => FileUploadAnswer(fp));
  ft = fm.render();
  const remove = one(ft, 'IconButton').onPress;
  for (const lang of ['en', 'fr', 'ar']) {
    const t = locale(lang);
    ft = fm.render();
    assert.ok(texts(ft).includes('RAW file'));
    assert.equal(one(ft, 'IconButton').accessibilityLabel, t('quizInputs.removeFile'));
    assert.ok(
      all(ft, 'Card').some(
        (n) => n.props.accessibilityLabel === t('quizInputs.uploadedLabel', { name: 'RAW file' }),
      ),
    );
  }
  remove();
  equal(lastAnswer(), { kind: 'file', attachmentId: null });
  fp = { ...fp, answer: { kind: 'file', attachmentId: 'new' } };
  ft = fm.render();
  events.length = 0;
  remove();
  assert.equal(events.length, 0);
  expect('document', { canceled: true, assets: null });
  const newRemove = one(ft, 'IconButton').onPress;
  fileButtons(ft)[0].onPress();
  newRemove();
  assert.equal(events.length, 0);
  await flush();
  newRemove();
  equal(lastAnswer(), { kind: 'file', attachmentId: null });
  fp = { ...fp, disabled: true };
  ft = fm.render();
  events.length = 0;
  one(ft, 'IconButton').onPress();
  fileButtons(ft).forEach((b) => b.onPress());
  assert.equal(events.length, 0);
  fm.unmount();
  // Discarded owner/callback publications cannot start native work or hijack adoption.
  reset();
  fp = fileProps();
  fm = mountTree(() => FileUploadAnswer(fp));
  ft = fm.render();
  const saved = fp;
  fp = { ...fp, questionId: 'discard' };
  const discarded = fileButtons(fm.renderOnly());
  fm.abandon();
  fp = saved;
  discarded.forEach((b) => b.onPress());
  assert.equal(calls.length, 0);
  fp = { ...fp, onChange: () => events.push(['discard']) };
  fm.renderOnly();
  fm.abandon();
  fp = saved;
  expect('document', doc);
  expect('upload', { id: 'good', name: 'good' });
  fileButtons(ft)[0].onPress();
  await flush();
  equal(lastAnswer(), { kind: 'file', attachmentId: 'good', name: 'good' });
  fm.unmount();
  assert.equal(queue.length, 0);
  console.log(
    'quiz-question-inputs: real components/helpers, staged lifetimes, all input types, synthetic picker/upload races; 2390 historical values preserved; ' +
      Object.keys(load('@/i18n/en').en).length +
      ' current keys (' +
      process.env.TZ +
      ')',
  );
}
fileTests().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
