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
  'features/quizzes/quizControls',
  'features/quizzes/QuizTimer',
  'features/quizzes/QuestionNavigator',
  'features/quizzes/ReviewPanel',
  'features/quizzes/attemptScreenOwner',
  'features/quizzes/QuizAttemptScreen',
  'app/(app)/course/[courseId]/quiz/[quizId]/take',
]);
const events = [],
  animations = [];
let reduced = false;
const session = { account: { id: 'A' }, client: {} };
let account = session.account,
  client = session.client;
const elements = (names) => Object.fromEntries(names.split(' ').map((n) => [n, n]));
const jsx = (type, props, key) => ({ type, props, key });
let attempt, quiz, params, prevention;
const alerts = [],
  keyboardEvents = [],
  protocol = [],
  engineCalls = [],
  children = [];
const mocks = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': {
    ...elements('Pressable View ActivityIndicator KeyboardAvoidingView'),
    Platform: { OS: 'ios' },
    Alert: { alert: (...args) => alerts.push(args) },
    Keyboard: {
      dismiss: () => protocol.push(['keyboard']),
      addListener: (name, callback) => {
        const event = { name, callback, removed: false };
        keyboardEvents.push(event);
        return {
          remove: () => {
            event.removed = true;
          },
        };
      },
    },
    AccessibilityInfo: { announceForAccessibility: (text) => events.push(['announce', text]) },
  },
  'lucide-react-native': elements(
    'Clock EyeOff Flag Info CircleCheck ChevronLeft ChevronRight CircleAlert Cloud CloudOff Globe KeyboardOff LayoutGrid Lock TimerOff',
  ),
  '@/design': {
    ...elements(
      'Icon Text Button Sheet Callout Card ListGroup ListItem ProgressBar Section Divider EmptyState IconButton Screen',
    ),
    useTheme: () => ({ colors: { accentFg: 'accent', fgMuted: 'muted' } }),
    useReduceMotion: () => reduced,
    haptics: {
      success: () => protocol.push(['success']),
      selection: () => events.push(['selection']),
      warning: () => events.push(['warning']),
    },
  },
  '@/design/interop': elements('AnimatedView'),
  '@/lib/cn': { cn: (...args) => args.filter(Boolean).join(' ') },
  '@/canvas/session': { useCanvas: () => ({ account, client }) },
  'expo-keep-awake': {
    useKeepAwake: () => {
      react.useEffect(() => {
        protocol.push(['awake']);
        return () => protocol.push(['sleep']);
      }, []);
    },
  },
  'expo-router': {
    Stack: { Screen: 'Stack.Screen' },
    useLocalSearchParams: () => params,
    router: { replace: (value) => protocol.push(['replace', value]), back: () => protocol.push(['back']) },
    usePreventRemove: (enabled, callback) => {
      react.useLayoutEffect(() => {
        prevention = { enabled, callback };
      });
    },
  },
  'expo-router/react-navigation': { useHeaderHeight: () => 44 },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 34 }) },
  '@/canvas/api/quizzes': {
    useQuiz: (...args) => {
      engineCalls.push(['query', args]);
      return { data: quiz };
    },
  },
  '@/features/quizzes/useQuizAttempt': {
    useQuizAttempt: (args) => {
      engineCalls.push(['engine', args]);
      return { ...attempt, isCurrent: () => !attempt.retired, provenance: attempt.explicitProvenance ?? {
        accountId: account.id, client, courseId: args.courseId, quizId: args.quizId,
        submissionId: args.submissionId, attempt: attempt.submission?.attempt ?? null, generation: 1,
      } };
    },
  },
  '@/features/quizzes/TakeQuiz': { openQuizOnWeb: (...args) => protocol.push(['web', args]) },
  '@/features/quizzes/QuestionView': { QuestionView: 'QuestionView' },
  '@/features/course/states': elements('DetailSkeleton LoadError'),
  '@/features/course/CourseScope': elements('CourseScope'),
  'react-native-reanimated': {
    useSharedValue: (initial) =>
      react.useState(() => ({
        value: initial,
        get() {
          return this.value;
        },
        set(value) {
          this.value = value;
          animations.push(['set', value]);
        },
      }))[0],
    useAnimatedStyle: (fn) => fn(),
    cancelAnimation: () => animations.push(['cancel']),
    withTiming: (value, options) => ({ value, options }),
    withSequence: (...sequence) => ({ sequence }),
    withRepeat: (animation, count) => ({ animation, count }),
  },
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
// Execute the real, narrow web adapter with a synthetic WebView boundary.
const webPayloads = [];
{
  const source = fs.readFileSync(path.join(root, 'features/quizzes/TakeQuiz.tsx'), 'utf8');
  const ast = ts.createSourceFile('TakeQuiz.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const adapter = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'openQuizOnWeb');
  assert.ok(adapter);
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(adapter.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } })
      .outputText,
    { exports, QUIZ_LEAVE_GUARD: 'DEFAULT guard sentinel', openWebView: (value) => webPayloads.push(value) },
  );
  mocks['@/features/quizzes/TakeQuiz'].openQuizOnWeb = (...args) => {
    protocol.push(['web', args]);
    return exports.openQuizOnWeb(...args);
  };
  exports.openQuizOnWeb({ title: 'raw', mobileUrl: '', htmlUrl: 'fallback' }, 'c');
  equalWeb(webPayloads.pop(), { url: '', title: 'raw', courseId: 'c', guard: 'DEFAULT guard sentinel' });
  exports.openQuizOnWeb({ title: 'raw', mobileUrl: null, htmlUrl: 'fallback' }, 'c', 'localized');
  equalWeb(webPayloads.pop(), { url: 'fallback', title: 'raw', courseId: 'c', guard: 'localized' });
}
function equalWeb(a, b) {
  assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
}
const runtime = load('@/i18n/runtime');
const { QuizAttemptScreen } = load('@/features/quizzes/QuizAttemptScreen');
const Route = load('@/app/(app)/course/[courseId]/quiz/[quizId]/take').default;
const locale = (lang) => {
  runtime.setAccountLocale(account.id, lang);
  return runtime.createTranslator(lang);
};
function mountTree(fn) {
  let committed = new Map(),
    staged,
    seen,
    tree;
  function expand(node, address = 'root') {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n, i) => expand(n, address + '/' + (n?.key ?? i)));
    if (typeof node.type === 'function') {
      const key = address + ':' + node.type.name + ':' + (node.key ?? '');
      children.push(node);
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
    replayEffects() {
      for (const e of committed.values()) e.mount.replayEffects();
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
for (const lang of ['en', 'fr', 'ar']) {
  const catalog = load('@/i18n/' + lang)[lang];
  const historical = require('./tool-launch-consumers.baseline.json').catalogs[lang];
  assert.equal(Object.keys(historical).length, 2330);
  for (const [key, digest] of Object.entries(historical))
    assert.equal(hash(JSON.stringify(catalog[key])), digest, key);
  for (const [key, digest] of Object.entries(require('./quiz-controls.baseline.json').catalogs[lang]))
    assert.equal(hash(catalog[key]), digest, key);
  for (const name of ['quiz-question-inputs', 'quiz-attempt-screen']) {
    const values = require('./' + name + '.baseline.json').catalogs[lang];
    assert.equal(Object.keys(values).length, name === 'quiz-question-inputs' ? 25 : 45);
    for (const [key, value] of Object.entries(values)) equal(catalog[key], value);
  }
  console.log(lang, Object.keys(catalog).length, 'catalog keys; 2435 historical values preserved');
}
for (const [file, digest] of Object.entries(require('./quiz-question-inputs.baseline.json').sources)) {
  if (file.endsWith('QuizAttemptScreen.tsx')) continue;
  // QUIZ-2/4: original engine/storage hashes remain; executable replacement is quiz-engine.check.cjs.
  if (file.endsWith('useQuizAttempt.ts') || file.endsWith('storage.ts')) continue;
  assert.equal(hash(fs.readFileSync(path.join(root, file), 'utf8')), digest, file);
}
const flushTasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const q = (id, type = 'short_answer_question') => ({
  id,
  type,
  html: '<p>RAW question</p>',
  answer: { kind: 'none' },
  answers: [],
  matches: [],
  blanks: [],
  variables: [],
  points: 1,
});
function reset() {
  account = { id: 'A' };
  client = {};
  locale('en');
  params = { courseId: 'c', quizId: 'q', submissionId: 's' };
  quiz = {
    id: 'q',
    title: 'RAW title',
    htmlUrl: 'RAW url',
    mobileUrl: 'RAW mobile',
    timerAutosubmitDisabled: false,
  };
  attempt = {
    status: { kind: 'ready' },
    submission: { id: 's', attempt: 1 },
    questions: [q('one'), q('info', 'text_only_question'), q('two')],
    answers: {},
    flags: {},
    position: 0,
    secondsLeft: 90,
    saveState: 'saved',
    saveError: null,
    expired: false,
    waitingToSubmit: false,
    setPosition: (n) => protocol.push(['position', n]),
    setAnswer: (...args) => protocol.push(['answer', args]),
    toggleFlag: (id) => protocol.push(['flag', id]),
    retry: () => protocol.push(['retry']),
    flush: async () => {
      protocol.push(['flush']);
    },
    submit: async () => {
      protocol.push(['submit']);
    },
  };
  alerts.length = protocol.length = children.length = engineCalls.length = keyboardEvents.length = 0;
}
const button = (tree, label) => {
  const n = all(tree, 'Button').find((n) => texts(n).join('') === label);
  assert.ok(n, label);
  return n.props;
};
const nav = () => children.filter((n) => n.type.name === 'QuestionNavigator').at(-1).props;
const review = (m) => {
  nav().onReview();
  return m.render();
};
const confirm = () => alerts.at(-1)[2][1].onPress;
const count = (kind) => protocol.filter((p) => p[0] === kind).length;
async function main() {
  reset();
  const m = mountTree(() => QuizAttemptScreen(params));
  let tree = m.render();
  assert.equal(one(tree, 'KeyboardAvoidingView').style.paddingTop, 44);
  assert.equal(one(tree, 'ProgressBar').value, 0);
  assert.ok(texts(tree).includes('0 of 2 answered'));
  const input = one(tree, 'QuestionView');
  assert.equal(input.attemptKey, JSON.stringify(['c', 'q', 's', 1, 1]));
  assert.equal(input.question, attempt.questions[0]);
  assert.equal(input.answer, attempt.questions[0].answer);
  const answer = { kind: 'text', value: 'RAW 1.20' };
  input.onChange(answer);
  input.onToggleFlag();
  input.onOpenWeb();
  equal(
    protocol.filter((p) => ['answer', 'flag', 'web'].includes(p[0])),
    [
      ['answer', ['one', answer]],
      ['flag', 'one'],
      ['web', [quiz, 'c', runtime.t('quizEntry.leave')]],
    ],
  );
  nav().onGo(999);
  equal(protocol.at(-1), ['position', 2]);
  nav().onGo(-2);
  equal(protocol.at(-1), ['position', 0]);
  tree = review(m);
  const submit = button(tree, 'Submit quiz').onPress;
  submit();
  submit();
  prevention.callback({ repeat: () => protocol.push(['repeat']) });
  assert.equal(alerts.length, 1);
  const oldConfirm = confirm();
  assert.match(alerts[0][0], /2 questions/);
  attempt = { ...attempt, answers: { one: answer } };
  m.render();
  oldConfirm();
  assert.equal(alerts.length, 2);
  assert.equal(count('submit'), 0);
  assert.match(alerts[1][0], /1 question/);
  oldConfirm();
  assert.equal(alerts.length, 2);
  const pending = deferred();
  attempt = {
    ...attempt,
    submit: () => {
      protocol.push(['submit']);
      return pending.promise;
    },
  };
  m.render();
  const submitConfirm = confirm();
  submitConfirm();
  submitConfirm();
  assert.equal(count('submit'), 1);
  attempt = { ...attempt, status: { kind: 'submitting', auto: false } };
  m.render();
  attempt = { ...attempt, status: { kind: 'ready' } };
  m.render();
  locale('fr');
  m.render();
  pending.reject(new Error('RAW failure'));
  await flushTasks();
  assert.equal(alerts.at(-1)[0], 'Couldn’t submit yet');
  assert.ok(alerts.at(-1)[1].startsWith('RAW failure'));
  tree = m.render();
  button(tree, runtime.t('quizAttemptScreen.submitQuiz')).onPress();
  assert.equal(alerts.at(-1)[0], runtime.t('quizAttemptScreen.submitMissing', { count: 1 }));
  alerts.at(-1)[2][0].onPress();
  const cancelled = confirm();
  cancelled();
  assert.equal(count('submit'), 1);
  button(tree, runtime.t('quizAttemptScreen.submitQuiz')).onPress();
  const dismissed = confirm();
  alerts.at(-1)[3].onDismiss();
  dismissed();
  assert.equal(count('submit'), 1);
  m.unmount();
  keyboardEvents.forEach((e) => {
    assert.ok(e.removed);
    e.callback();
  });
  input.onChange(answer);
  submitConfirm();

  // All presentation branches, raw engine messages/errors, locale and local SaveIndicator/TimeUp.
  for (const lang of ['en', 'fr', 'ar']) {
    reset();
    const t = locale(lang);
    const n = mountTree(() => QuizAttemptScreen(params));
    for (const status of [
      { kind: 'loading' },
      { kind: 'error', error: new Error('RAW load') },
      { kind: 'web', message: 'RAW ignored legacy web message' },
      { kind: 'ended', messageKey: 'quizEngine.ended' },
    ]) {
      attempt = { ...attempt, status };
      tree = n.render();
      if (status.kind === 'loading') one(tree, 'DetailSkeleton');
      if (status.kind === 'error') {
        assert.equal(one(tree, 'LoadError').error, status.error);
        one(tree, 'LoadError').onRetry();
        await flushTasks();
      }
      if (status.kind === 'web') {
        assert.ok(texts(tree).includes(t('quizAttemptScreen.webBody')));
        button(tree, t('quizInputs.webOpen')).onPress();
        equal(protocol.at(-1), ['web', [quiz, 'c', t('quizEntry.leave')]]);
      }
      if (status.kind === 'ended') assert.equal(one(tree, 'EmptyState').description, t(status.messageKey));
    }
    attempt = { ...attempt, status: { kind: 'ready' }, questions: [] };
    tree = n.render();
    assert.equal(one(tree, 'EmptyState').title, t('quizAttemptScreen.empty'));
    attempt = { ...attempt, questions: [q('one')], secondsLeft: null };
    for (const state of ['saved', 'saving', 'offline', 'error']) {
      attempt = { ...attempt, saveState: state, saveError: 'RAW save' };
      tree = n.render();
      const retry = all(tree, 'Pressable').find((n) => n.props.accessibilityHint === 'RAW save');
      if (retry) {
        retry.props.onPress();
        await flushTasks();
        assert.ok(alerts.at(-1)[1].includes('RAW save'));
      }
    }
    for (const [disabled, waiting, key] of [
      [true, false, 'timeManual'],
      [false, true, 'timeWaiting'],
      [false, false, 'timeSubmitting'],
    ]) {
      quiz = { ...quiz, timerAutosubmitDisabled: disabled };
      attempt = { ...attempt, expired: true, waitingToSubmit: waiting };
      tree = n.render();
      assert.ok(texts(tree).includes(t('quizAttemptScreen.' + key)));
    }
    n.unmount();
  }
  // Each original prompt and retained callback is revoked by committed replacement/away-back.
  for (const change of [
    'account',
    'client',
    'course',
    'quiz',
    'submission',
    'retake',
    'policy',
    'membership',
    'status',
    'position',
    'unmount',
  ]) {
    reset();
    const n = mountTree(() => QuizAttemptScreen(params));
    let v = n.render();
    const staleInput = one(v, 'QuestionView');
    v = review(n);
    button(v, 'Submit quiz').onPress();
    const stale = confirm();
    const oldPrevent = prevention.callback;
    const oldNav = nav();
    const k = keyboardEvents[0];
    const saved = { account, client, params, attempt, quiz };
    if (change === 'account') account = { id: 'B' };
    if (change === 'client') client = {};
    if (['course', 'quiz', 'submission'].includes(change))
      params = { ...params, [change + 'Id']: 'replacement' };
    if (change === 'retake') attempt = { ...attempt, submission: { id: 's', attempt: 2 } };
    if (change === 'policy') quiz = { ...quiz, timerAutosubmitDisabled: true };
    if (change === 'membership') attempt = { ...attempt, questions: [q('different')] };
    if (change === 'status') attempt = { ...attempt, status: { kind: 'ended', messageKey: 'quizEngine.ended' } };
    if (change === 'position') attempt = { ...attempt, position: 1 };
    if (change === 'unmount') n.unmount();
    else {
      n.render();
      ({ account, client, params, attempt, quiz } = saved);
      n.render();
    }
    const before = protocol.length,
      promptCount = alerts.length;
    stale();
    oldPrevent({ repeat: () => protocol.push(['repeat']) });
    oldNav.onGo(2);
    staleInput.onChange(answer);
    staleInput.onToggleFlag();
    staleInput.onOpenWeb();
    equal(protocol.length, before);
    assert.equal(alerts.length, promptCount);
    if (['account', 'client', 'course', 'quiz', 'submission', 'retake', 'unmount'].includes(change)) {
      assert.ok(k.removed);
      k.callback();
    }
    if (change !== 'unmount') n.unmount();
  }
  // Entered operations survive their own status transition, but not resource/policy retirement.
  for (const change of [
    'account',
    'client',
    'course',
    'quiz',
    'submission',
    'retake',
    'policy',
    'membership',
    'ended',
    'unmount',
  ]) {
    reset();
    const d = deferred();
    attempt.submit = () => d.promise;
    const n = mountTree(() => QuizAttemptScreen(params));
    n.render();
    let v = review(n);
    button(v, 'Submit quiz').onPress();
    confirm()();
    const before = alerts.length;
    if (change === 'account') account = { id: 'B' };
    if (change === 'client') client = {};
    if (['course', 'quiz', 'submission'].includes(change)) params = { ...params, [change + 'Id']: 'new' };
    if (change === 'retake') attempt = { ...attempt, submission: { id: 's', attempt: 2 } };
    if (change === 'policy') quiz = { ...quiz, locked: true };
    if (change === 'membership') attempt = { ...attempt, questions: [] };
    if (change === 'ended') attempt = { ...attempt, status: { kind: 'ended', messageKey: 'quizEngine.ended' } };
    if (change === 'unmount') n.unmount();
    else n.render();
    d.reject({ message: 'RAW retired' });
    await flushTasks();
    assert.equal(alerts.length, before);
    if (change !== 'unmount') n.unmount();
  }
  reset();
  const n = mountTree(() => QuizAttemptScreen(params));
  n.render();
  const repeat = () => {
    protocol.push(['repeat']);
    n.render();
    assert.equal(prevention.enabled, false, 'set-leaving precedes repeat');
  };
  prevention.callback({ repeat });
  const leave = confirm();
  leave();
  leave();
  equal(
    protocol.filter((p) => ['flush', 'repeat'].includes(p[0])),
    [['flush'], ['repeat']],
  );
  n.render();
  assert.equal(prevention.enabled, false);
  n.unmount();
  // Discarded render cannot publish callbacks, route data or policy.
  reset();
  const d = mountTree(() => QuizAttemptScreen(params));
  let v = d.render();
  const retained = one(v, 'QuestionView');
  const original = attempt;
  attempt = { ...attempt, setAnswer: () => protocol.push(['discarded']) };
  d.renderOnly();
  d.abandon();
  retained.onChange(answer);
  assert.equal(count('discarded'), 0);
  attempt = original;
  locale('ar');
  quiz = { ...quiz, title: 'NEW RAW' };
  v = d.render();
  retained.onChange(answer);
  assert.equal(count('answer'), 2);
  assert.equal(one(v, 'QuestionView').key, undefined);
  const show = keyboardEvents[0];
  show.callback();
  v = d.render();
  const hide = all(v, 'IconButton').find(
    (n) => n.props.accessibilityLabel === runtime.t('quizAttemptScreen.hideKeyboard'),
  );
  assert.ok(hide);
  hide.props.onPress();
  assert.equal(count('keyboard'), 1);
  attempt = { ...attempt, status: { kind: 'submitted', submission: attempt.submission } };
  d.render();
  d.replayEffects();
  d.render();
  assert.equal(count('replace'), 1);
  assert.equal(count('success'), 1);
  equal(protocol.find((p) => p[0] === 'replace')[1], {
    pathname: '/course/[courseId]/quiz/[quizId]/result',
    params,
  });
  d.unmount();
  // Save failure releases exactly its own claim; stale finally cannot release newer work.
  reset();
  attempt = { ...attempt, saveState: 'error', saveError: 'raw save' };
  const save1 = deferred(),
    save2 = deferred();
  let saves = 0;
  attempt.flush = () => {
    protocol.push(['flush']);
    return (++saves === 1 ? save1 : save2).promise;
  };
  const savesMount = mountTree(() => QuizAttemptScreen(params));
  v = savesMount.render();
  const savePress = all(v, 'Pressable').find((n) => n.props.accessibilityHint === 'raw save').props.onPress;
  savePress();
  savePress();
  await flushTasks();
  assert.equal(saves, 1);
  save1.reject(new Error('raw rejection'));
  await flushTasks();
  savePress();
  await flushTasks();
  assert.equal(saves, 2);
  attempt = { ...attempt, saveState: 'saved' };
  savesMount.render();
  savePress();
  assert.equal(saves, 2);
  save2.reject('raw second');
  await flushTasks();
  savesMount.unmount();
  // Prompt cleanup/replay cancels old responses and permits fresh work.
  reset();
  const replay = mountTree(() => QuizAttemptScreen(params));
  replay.render();
  v = review(replay);
  button(v, 'Submit quiz').onPress();
  const obsolete = confirm();
  replay.replayEffects();
  obsolete();
  assert.equal(count('submit'), 0);
  v = replay.render();
  button(v, 'Submit quiz').onPress();
  assert.equal(alerts.length, 2);
  alerts.at(-1)[3].onDismiss();
  replay.unmount();
  // Locale changes retain the actual question/editor boundary key and UI mode.
  reset();
  const stable = mountTree(() => QuizAttemptScreen(params));
  v = stable.render();
  const screenKey = all(v, 'Screen')[0].key;
  locale('ar');
  quiz = { ...quiz, title: 'raw updated' };
  v = stable.render();
  assert.equal(all(v, 'Screen')[0].key, screenKey);
  v = review(stable);
  locale('fr');
  v = stable.render();
  button(v, runtime.t('quizAttemptScreen.submitQuiz'));
  attempt = { ...attempt, submission: { id: 's', attempt: 2 } };
  v = stable.render();
  one(v, 'QuestionView');
  assert.equal(nav().visible, false);
  stable.unmount();
  // Header, local navigator, controls identities and Android keyboard contracts.
  reset();
  mocks['react-native'].Platform.OS = 'android';
  const android = mountTree(() => QuizAttemptScreen(params));
  v = android.render();
  assert.equal(one(v, 'KeyboardAvoidingView').behavior, undefined);
  assert.equal(one(v, 'KeyboardAvoidingView').style.paddingTop, 0);
  assert.equal(keyboardEvents[0].name, 'keyboardDidShow');
  assert.equal(keyboardEvents[1].name, 'keyboardDidHide');
  const header = one(v, 'Stack.Screen').options.headerRight();
  assert.equal(header.props.accessibilityLabel, 'All questions');
  header.props.onPress();
  v = android.render();
  assert.equal(nav().visible, true);
  equal(engineCalls.find((c) => c[0] === 'engine')[1], { ...params, autoSubmit: true });
  const timerProps = children.filter((n) => n.type.name === 'QuizTimer').at(-1).props;
  assert.equal(timerProps.attemptKey, nav().attemptKey);
  const close = nav().onClose;
  close();
  v = android.render();
  assert.equal(nav().visible, false);
  android.unmount();
  mocks['react-native'].Platform.OS = 'ios';
  // An old rejection/finally cannot free a replacement resource's active claim.
  reset();
  attempt = { ...attempt, saveState: 'offline', saveError: 'pending' };
  const oldSave = deferred(),
    newSave = deferred();
  let saveEntries = 0;
  attempt.flush = () => {
    saveEntries++;
    return oldSave.promise;
  };
  const race = mountTree(() => QuizAttemptScreen(params));
  v = race.render();
  all(v, 'Pressable')
    .find((n) => n.props.accessibilityHint === 'pending')
    .props.onPress();
  await flushTasks();
  client = {};
  attempt = {
    ...attempt,
    flush: () => {
      saveEntries++;
      return newSave.promise;
    },
  };
  v = race.render();
  const freshSave = all(v, 'Pressable').find((n) => n.props.accessibilityHint === 'pending').props.onPress;
  freshSave();
  await flushTasks();
  const beforeRetired = alerts.length;
  oldSave.reject(new Error('retired save'));
  await flushTasks();
  assert.equal(alerts.length, beforeRetired);
  freshSave();
  await flushTasks();
  assert.equal(saveEntries, 2);
  newSave.resolve();
  await flushTasks();
  race.unmount();
  reset();
  attempt = { ...attempt, status: { kind: 'submitted', submission: attempt.submission }, questions: [] };
  const emptyResult = mountTree(() => QuizAttemptScreen(params));
  v = emptyResult.render();
  one(v, 'DetailSkeleton');
  assert.equal(count('replace'), 1);
  emptyResult.unmount();
  reset();
  attempt = { ...attempt, status: { kind: 'ended', messageKey: 'quizEngine.ended' } };
  const ended = mountTree(() => QuizAttemptScreen(params));
  v = ended.render();
  const back = one(v, 'EmptyState').action.onPress;
  back();
  back();
  assert.equal(count('back'), 1);
  ended.unmount();
  reset();
  const disabledPrevious = mountTree(() => QuizAttemptScreen(params));
  v = disabledPrevious.render();
  button(v, 'Previous').onPress();
  assert.equal(count('position'), 0);
  disabledPrevious.unmount();
  // Actual route: raw title, translated fallback, stable locale identity, replacement identity.
  reset();
  const route = mountTree(() => Route());
  v = route.render();
  assert.equal(one(v, 'CourseScope').title, 'RAW title');
  const first = children.filter((n) => n.type === QuizAttemptScreen).at(-1).key;
  quiz = undefined;
  locale('fr');
  v = route.render();
  assert.equal(one(v, 'CourseScope').title, runtime.t('quizPresentation.single'));
  assert.equal(children.filter((n) => n.type === QuizAttemptScreen).at(-1).key, first);
  params = { ...params, submissionId: 'other' };
  route.render();
  assert.notEqual(children.filter((n) => n.type === QuizAttemptScreen).at(-1).key, first);
  route.unmount();
  // Engine provenance is required, including retired same-mount loads and reused IDs.
  reset();
  const provenanceScreen = mountTree(() => QuizAttemptScreen(params));
  provenanceScreen.render();
  for (const explicitProvenance of [
    { accountId: 'other', client, courseId: 'c', quizId: 'q', submissionId: 's', attempt: 1, generation: 8 },
    { accountId: account.id, client: {}, courseId: 'c', quizId: 'q', submissionId: 's', attempt: 1, generation: 8 },
    { accountId: account.id, client, courseId: 'c', quizId: 'q', submissionId: 's', attempt: 2, generation: 8 },
  ]) {
    attempt = { ...attempt, explicitProvenance };
    one(provenanceScreen.render(), 'DetailSkeleton');
  }
  attempt = { ...attempt, explicitProvenance: undefined, retired: true };
  one(provenanceScreen.render(), 'DetailSkeleton');
  attempt = { ...attempt, retired: false, status: { kind: 'error', messageKey: 'quizEngine.missingValidation' } };
  for (const language of ['en', 'fr', 'ar']) {
    runtime.setAccountLocale(account.id, language);
    assert.equal(one(provenanceScreen.render(), 'LoadError').error.message, runtime.t('quizEngine.missingValidation'));
  }
  provenanceScreen.unmount();
  console.log(
    'Quiz attempt screen: actual route/screen/local controls, staged ownership, confirmations, raw presentation and protocols passed; TZ=' +
      process.env.TZ,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
