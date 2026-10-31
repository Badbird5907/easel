const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
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
const equal = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const settle = async () => {
  for (let i = 0; i < 120; i++) await Promise.resolve();
};
let now = 1700000000000,
  seq = 0;
class Clock extends Date {
  constructor(...args) {
    super(...(args.length ? args : [now]));
  }
  static now() {
    return now;
  }
}
const timers = new Map(),
  app = new Set(),
  announcements = [],
  requests = [],
  storageCalls = [],
  db = new Map(),
  members = new Map(),
  cleanups = [];
const schedule = (fn, ms, repeat) => {
  const id = ++seq;
  timers.set(id, { fn, ms, repeat, at: now + ms });
  return id;
};
const advance = async (ms) => {
  now += ms;
  for (const [id, t] of [...timers])
    if (t.at <= now) {
      if (t.repeat) t.at = now + t.ms;
      else timers.delete(id);
      t.fn();
    }
  await settle();
};
let transport, storageDelay;
const storageBoundary = async (name, ...args) => {
  storageCalls.push([name, ...args]);
  if (storageDelay) await storageDelay(name, args);
  if (name === 'getItem') return db.get(args[0]) ?? null;
  if (name === 'setItem') db.set(args[0], args[1]);
  if (name === 'removeItem') db.delete(args[0]);
  if (name === 'getAllKeys') return [...db.keys()];
  if (name === 'multiRemove') args[0].forEach((k) => db.delete(k));
};
let session,
  online = true,
  locale = 'en';
const invalidations = [];
const queryClient = { invalidateQueries: async (arg) => invalidations.push(arg) };
const mocks = {
  react,
  'react-native': {
    AccessibilityInfo: { announceForAccessibility: (s) => announcements.push(s) },
    AppState: {
      addEventListener: (name, fn) => {
        assert.equal(name, 'change');
        app.add(fn);
        return { remove: () => app.delete(fn) };
      },
    },
  },
  '@react-native-async-storage/async-storage': {
    default: Object.fromEntries(
      ['getItem', 'setItem', 'removeItem', 'getAllKeys', 'multiRemove'].map((n) => [
        n,
        (...a) => storageBoundary(n, ...a),
      ]),
    ),
    __esModule: true,
  },
  '@/canvas/session': {
    useCanvas: () => session,
    isStoredAccountClient: (id, c) => members.get(id) === c,
    registerAccountCleanup: (fn) => {
      cleanups.push(fn);
      return () => {};
    },
  },
  '@/canvas/query': {
    useAccountKey: () => session.account.id,
    useCanvasQuery: () => {
      throw Error('Unexpected query hook');
    },
  },
  '@tanstack/react-query': { useQueryClient: () => queryClient },
  '@/features/offline/useOnline': { useOnline: () => online },
  'expo-crypto': {
    CryptoDigestAlgorithm: {},
    digestStringAsync: () => {
      throw Error('Unexpected digest');
    },
  },
  '@/i18n': { useTranslation: () => ({ t: runtime.createTranslator(locale) }) },
};
const allowed = new Set([
  'canvas/api/cacheSeed',
  'features/planner/submissionCache',
  'canvas/api/quizzes',
  'canvas/client',
  'canvas/html',
  'features/quizzes/answers',
  'features/quizzes/storage',
  'features/quizzes/quizAttemptEngine',
  'features/quizzes/useQuizAttempt',
  'i18n/runtime',
  'i18n/en',
  'i18n/fr',
  'i18n/ar',
]);
const cache = new Map();
function load(name, parent = path.join(root, 'entry.ts')) {
  if (isIntlPolyfills(name)) return intlPolyfills;
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (mocks[key]) return mocks[key];
  assert.ok(key.startsWith('@/') && allowed.has(key.slice(2)), 'Unexpected import ' + key);
  const file = ['.ts', '.tsx', '/index.ts']
    .map((e) => path.join(root, key.slice(2)) + e)
    .find(fs.existsSync);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (n) => load(n, file),
      Date: Clock,
      Intl,
      Error,
      console,
      URL,
      setTimeout: (f, ms) => schedule(f, ms, false),
      clearTimeout: (id) => timers.delete(id),
      setInterval: (f, ms) => schedule(f, ms, true),
      clearInterval: (id) => timers.delete(id),
      fetch: () => {
        throw Error('HTTP forbidden');
      },
    },
    { filename: file },
  );
  return module.exports;
}
const runtime = load('@/i18n/runtime'),
  storage = load('@/features/quizzes/storage');
const { QuizAttemptEngine } = load('@/features/quizzes/quizAttemptEngine');
const { useQuizAttempt } = load('@/features/quizzes/useQuizAttempt');
const { CanvasError, CanvasNetworkError } = load('@/canvas/client');
const { QuizRefusedError } = load('@/canvas/api/quizzes');
function client(id) {
  const c = Object.fromEntries(
    ['get', 'post', 'put'].map((method) => [
      method,
      (url, body) => {
        requests.push({ id, method, url, body });
        return transport(method, url, body);
      },
    ]),
  );
  members.set(id, c);
  return c;
}
const rawSubmission = (attempt = 1, progress = true, token = 'token-' + attempt) => ({
  quiz_submissions: [
    {
      id: 's',
      quiz_id: 'q',
      attempt,
      validation_token: token,
      workflow_state: progress ? 'untaken' : 'complete',
      started_at: '2023-01-01T00:00:00Z',
    },
  ],
});
const rawQuestions = {
  quiz_submission_questions: ['one', 'two'].map((id, i) => ({
    id,
    question_type: 'essay_question',
    position: i + 1,
    question_name: id,
    question_text: id,
    answer: 'server',
    flagged: false,
  })),
};
function defaults() {
  transport = async (method, url) =>
    url.endsWith('/time')
      ? { time_left: null, end_at: null }
      : url.endsWith('/questions')
        ? method === 'get'
          ? rawQuestions
          : {}
        : url.endsWith('/complete')
          ? rawSubmission(1, false)
          : url.endsWith('/events')
            ? {}
            : method === 'put'
              ? {}
              : rawSubmission();
}
function setup(id = 'A', overrides = {}) {
  defaults();
  const c = client(id);
  const context = {
    accountId: id,
    client: c,
    courseId: 'c',
    quizId: 'q',
    submissionId: 's',
    ...overrides,
  };
  const updates = [];
  const engine = new QuizAttemptEngine(
    context,
    runtime.createTranslator(locale),
    (s) => updates.push(s),
    () => invalidations.push(context),
  );
  return { engine, updates, context };
}
const answer = (value) => ({ kind: 'text', value });
async function ready(id = 'A') {
  const x = setup(id);
  await x.engine.load();
  await settle();
  assert.equal(x.engine.snapshot.status.kind, 'ready');
  return x;
}
async function main() {
  // Preserve every historical value, including the final 42 added by the screen slice.
  const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
  for (const lang of ['en', 'fr', 'ar']) {
    const c = load('@/i18n/' + lang)[lang];
    const baselines = [
      ['tool-launch-consumers', 2330, true],
      ['quiz-controls', 35, 'raw'],
      ['quiz-question-inputs', 25, false],
      ['quiz-attempt-screen', 45, false],
      ['quiz-engine', 42, true],
    ];
    for (const [name, count, hashed] of baselines) {
      const b = require('./' + name + '.baseline.json').catalogs[lang];
      assert.equal(Object.keys(b).length, count);
      for (const [k, v] of Object.entries(b))
        assert.equal(
          hashed === 'raw'
            ? crypto
                .createHash('sha256')
                .update(typeof c[k] === 'string' ? c[k] : JSON.stringify(c[k]))
                .digest('hex')
            : hashed
              ? hash(c[k])
              : JSON.stringify(c[k]),
          hashed ? v : JSON.stringify(v),
          k,
        );
    }
    assert.equal(Object.keys(c).filter((k) => k.startsWith('quizEngine.')).length, 4);
  }
  // Deferred access-code read: no questions/auth/time published by a retired load.
  for (const reject of [false, true]) {
    const x = setup();
    const d = deferred();
    storageDelay = (n) => (n === 'getItem' ? d.promise : undefined);
    const p = x.engine.load();
    await settle();
    const before = requests.length;
    x.engine.dispose();
    if (reject) d.reject(Error('storage'));
    else d.resolve();
    await p;
    await settle();
    assert.equal(requests.length, before);
    storageDelay = null;
  }
  // Submission/questions success/rejection, all retired stages leave new owners untouched.
  for (const stage of ['submission', 'questions', 'time', 'answers', 'flags', 'events', 'complete'])
    for (const reject of [false, true]) {
      const x = setup();
      const d = deferred(),
        base = transport;
      let held = false;
      transport = (m, u, b) => {
        const match =
          stage === 'submission'
            ? u.endsWith('/s')
            : stage === 'questions'
              ? m === 'get' && u.endsWith('/questions')
              : stage === 'time'
                ? u.endsWith('/time')
                : stage === 'answers'
                  ? m === 'post' && u.endsWith('/questions')
                  : stage === 'flags'
                    ? m === 'put'
                    : stage === 'events'
                      ? u.endsWith('/events')
                      : u.endsWith('/complete');
        if (match && !held) {
          held = true;
          return d.promise;
        }
        return base(m, u, b);
      };
      const loading = x.engine.load();
      await settle();
      let operation = loading;
      if (stage === 'answers') {
        x.engine.setAnswer('one', answer('old'));
        operation = x.engine.flush();
      }
      if (stage === 'flags') {
        x.engine.toggleFlag('one');
        operation = x.engine.flush();
      }
      if (stage === 'events') operation = x.engine.sendEvents();
      if (stage === 'complete') operation = x.engine.submit();
      await settle();
      assert.ok(held, stage);
      x.engine.dispose();
      const count = x.updates.length;
      const fresh = await ready('B');
      const before = requests.length;
      if (reject) d.reject(new CanvasNetworkError());
      else
        d.resolve(
          stage === 'submission'
            ? rawSubmission()
            : stage === 'questions'
              ? rawQuestions
              : stage === 'time'
                ? { time_left: 0 }
                : stage === 'complete'
                  ? rawSubmission(1, false)
                  : {},
        );
      await operation;
      await settle();
      assert.equal(x.updates.length, count, stage);
      assert.equal(requests.length, before, stage);
      assert.equal(fresh.engine.snapshot.status.kind, 'ready');
      fresh.engine.dispose();
    }
  // Missing auth is structured and does not enter question reads. Duplicate load is inert.
  for (const [attempt, token] of [
    [1, null],
    [0, 'x'],
    [NaN, 'x'],
  ]) {
    const x = setup();
    transport = async () => rawSubmission(attempt, true, token);
    await x.engine.load();
    await x.engine.load();
    assert.equal(x.engine.snapshot.status.messageKey, 'quizEngine.missingValidation');
    x.engine.dispose();
  }
  // Same millisecond edits + coalesced flush drain the latest identity; exact real API payloads.
  {
    const { engine } = await ready();
    const d = deferred(),
      base = transport;
    let first = true;
    transport = (m, u, b) =>
      m === 'post' && u.endsWith('/questions') && first ? ((first = false), d.promise) : base(m, u, b);
    engine.setAnswer('one', answer('first'));
    const p = engine.flush();
    engine.setAnswer('one', answer('latest'));
    assert.equal(engine.flush(), p);
    d.resolve({});
    await p;
    await settle();
    assert.equal(engine.snapshot.pendingCount, 0);
    const writes = requests.filter((r) => r.method === 'post' && r.url.endsWith('/questions')).slice(-2);
    equal(
      writes.map((r) => r.body),
      ['first', 'latest'].map((value) => ({
        attempt: 1,
        validation_token: 'token-1',
        quiz_questions: [{ id: 'one', answer: value }],
      })),
    );
    engine.dispose();
  }
  // Flag ABA edits during send must replay even when final boolean equals old.
  {
    const { engine } = await ready();
    const d = deferred(),
      base = transport;
    let first = true;
    transport = (m, u, b) => (m === 'put' && first ? ((first = false), d.promise) : base(m, u, b));
    const before = requests.filter((r) => r.method === 'put').length;
    engine.toggleFlag('one');
    engine.toggleFlag('one');
    engine.toggleFlag('one');
    const p = engine.flush();
    d.resolve({});
    await p;
    assert.equal(requests.filter((r) => r.method === 'put').length - before, 2);
    engine.dispose();
  }
  // Pending flags block completion and ready recovers; refusal ends rather than completing.
  for (const failure of [
    new CanvasNetworkError(),
    new QuizRefusedError('token', 'RAW token', 403),
    new QuizRefusedError('ended', 'RAW ended', 400),
  ]) {
    const { engine } = await ready();
    const base = transport;
    transport = (m, u, b) => (m === 'put' ? Promise.reject(failure) : base(m, u, b));
    const before = requests.filter((r) => r.url.endsWith('/complete')).length;
    engine.toggleFlag('one');
    await settle();
    await engine.submit().catch(() => {});
    assert.equal(requests.filter((r) => r.url.endsWith('/complete')).length, before);
    assert.equal(engine.snapshot.status.kind, failure instanceof CanvasNetworkError ? 'ready' : 'ended');
    engine.dispose();
  }
  // Batch 400 fallback retains concurrent edits and original auth.
  {
    const { engine } = await ready();
    const base = transport;
    transport = (m, u, b) =>
      m === 'post' && u.endsWith('/questions') && b.quiz_questions.length > 1
        ? Promise.reject(new CanvasError('bad answer', 400, u))
        : base(m, u, b);
    engine.setAnswer('one', answer('a'));
    engine.setAnswer('two', answer('b'));
    await engine.flush();
    assert.equal(engine.snapshot.pendingCount, 0);
    engine.dispose();
  }
  // Events remain durable until ack; new events during send survive, rejection retains all.
  for (const reject of [false, true]) {
    const { engine } = await ready();
    const d = deferred(),
      base = transport;
    transport = (m, u, b) => (u.endsWith('/events') ? d.promise : base(m, u, b));
    const p = engine.sendEvents();
    assert.equal(engine.sendEvents(), p);
    engine.setPosition(1);
    if (reject) d.reject(Error('event'));
    else d.resolve({});
    await p;
    await settle();
    const saved = await storage.loadAttempt('A', 's', 1);
    assert.ok(saved.events.some((e) => e.type === 'question_viewed'));
    assert.equal(
      saved.events.some((e) => e.type === 'session_started'),
      reject,
    );
    engine.dispose();
  }
  // Offline saves survive close/reopen; storage waits for accepted snapshots.
  {
    const { engine } = await ready();
    transport = async () => {
      throw new CanvasNetworkError();
    };
    engine.setAnswer('one', answer('offline'));
    await engine.flush();
    engine.dispose();
    await settle();
    const next = await ready();
    assert.equal(next.engine.snapshot.answers.one.value, 'offline');
    assert.equal(next.engine.snapshot.pendingCount, 0);
    next.engine.dispose();
  }
  // Completion is single-entry; waits required answer + flag work, then events, then complete.
  {
    const { engine } = await ready();
    const d = deferred(),
      base = transport;
    transport = (m, u, b) => (u.endsWith('/complete') ? d.promise : base(m, u, b));
    const before = requests.length;
    engine.setAnswer('one', answer('done'));
    engine.toggleFlag('one');
    const p = engine.submit();
    await engine.submit();
    await settle();
    assert.equal(requests.slice(before).filter((r) => r.url.endsWith('/complete')).length, 1);
    d.resolve(rawSubmission(1, false));
    await p;
    assert.equal(engine.snapshot.status.kind, 'submitted');
    assert.equal(await storage.loadAccessCode('A', 'q'), null);
    engine.dispose();
  }
  // Ended fetch must not adopt a reused submission's new attempt as this result.
  {
    const { engine } = await ready();
    const base = transport;
    transport = (m, u, b) =>
      u.endsWith('/complete')
        ? Promise.reject(new QuizRefusedError('ended', 'raw', 400))
        : u.endsWith('/s')
          ? Promise.resolve(rawSubmission(2, true))
          : base(m, u, b);
    await engine.submit();
    assert.equal(engine.snapshot.status.kind, 'ended');
    engine.dispose();
  }
  // Time rounding, auto policy, locale-at-invocation, retry interval, disposal.
  {
    const x = setup();
    const base = transport;
    transport = (m, u, b) =>
      u.endsWith('/time')
        ? Promise.resolve({ time_left: 0.49 })
        : u.endsWith('/complete')
          ? Promise.reject(new CanvasNetworkError())
          : base(m, u, b);
    x.engine.configure(runtime.createTranslator('fr'), false);
    await x.engine.load();
    await settle();
    assert.equal(x.engine.snapshot.secondsLeft, 0);
    const before = announcements.length;
    await advance(1000);
    assert.equal(announcements.length, before);
    x.engine.configure(runtime.createTranslator('ar'), true);
    await advance(0);
    assert.equal(announcements.at(-1), runtime.createTranslator('ar')('quizEngine.timeUp'));
    assert.ok(x.engine.snapshot.waitingToSubmit);
    await advance(4999);
    assert.equal(announcements.length, before + 1);
    await advance(1);
    assert.equal(announcements.length, before + 2);
    x.engine.dispose();
    assert.equal(timers.size, 0);
    assert.equal(app.size, 0);
  }
  // Storage serializes codes/attempt clears, rejects old membership at actual entry,
  // drains entered writes before cleanup, and permits an explicitly new saved client.
  {
    const c = client('storage');
    const owner = storage.quizStorageOwner('storage', c);
    const d = deferred();
    let held = false;
    storageDelay = (n) => (n === 'setItem' && !held ? ((held = true), d.promise) : undefined);
    const first = storage.saveAccessCode('storage', 'q', 'old', owner);
    await settle();
    const queued = storage.saveAccessCode('storage', 'q', 'stale', owner);
    members.delete('storage');
    const cleanup = cleanups[0]('storage');
    const newer = client('storage');
    const newOwner = storage.quizStorageOwner('storage', newer);
    const next = storage.saveAccessCode('storage', 'q', 'new', newOwner);
    d.resolve();
    await Promise.all([first, queued, cleanup, next]);
    storageDelay = null;
    assert.equal(await storage.loadAccessCode('storage', 'q', newOwner), 'new');
    const writes = storageCalls.filter((c) => c[0] === 'setItem' && c[1].includes('storage'));
    assert.ok(!writes.some((c) => c[2] === 'stale'));
    await storage.saveAttempt('storage', 's', 2, storage.emptyAttempt(), newOwner);
    await storage.clearAttempt('storage', 's', 2, newOwner);
    assert.equal(db.has('easel.quiz.attempt.storage.s.2'), false);
  }
  // Real hook: committed replacement/retry/unmount, locale keeps generation/auth,
  // abandoned render does not authorize another engine; stale callbacks stay inert.
  {
    defaults();
    session = { account: { id: 'hook' }, client: client('hook') };
    let props = { courseId: 'c', quizId: 'q', submissionId: 's', autoSubmit: true };
    const m = mount(() => useQuizAttempt(props));
    let v = m.render();
    await settle();
    v = m.render();
    assert.equal(v.status.kind, 'ready');
    const gen = v.provenance.generation;
    const before = requests.length;
    locale = 'fr';
    v = m.render();
    await settle();
    assert.equal(v.provenance.generation, gen);
    assert.equal(requests.length, before);
    props = { ...props, submissionId: 'discarded' };
    m.renderOnly();
    m.abandon();
    props = { ...props, submissionId: 's' };
    assert.equal(requests.length, before);
    const old = v;
    v.retry();
    v.retry();
    v = m.render();
    await settle();
    v = m.render();
    assert.notEqual(v.provenance.generation, gen);
    old.setAnswer('one', answer('retired'));
    assert.notEqual(v.answers.one.value, 'retired');
    for (const change of ['account', 'client', 'course', 'quiz', 'submission', 'away', 'back']) {
      const prev = v;
      if (change === 'account') session = { account: { id: 'next' }, client: client('next') };
      else if (change === 'client') session = { ...session, client: client(session.account.id) };
      else
        props = {
          ...props,
          [change === 'course' ? 'courseId' : change === 'quiz' ? 'quizId' : 'submissionId']: change,
        };
      v = m.render();
      await settle();
      v = m.render();
      assert.notEqual(v.provenance.generation, prev.provenance.generation);
      const n = requests.length;
      await prev.submit();
      await prev.flush();
      assert.equal(requests.length, n);
    }
    m.unmount();
    const n = requests.length;
    await v.submit();
    await advance(120000);
    assert.equal(requests.length, n);
    assert.equal(timers.size, 0);
  }

  // Exact retry schedule, no duplicate retry storms, and retained AppState callbacks.
  {
    const { engine } = await ready('retry');
    const listener = [...app][0];
    transport = async () => {
      throw new CanvasNetworkError();
    };
    engine.setAnswer('one', answer('retry'));
    await engine.flush();
    for (const delay of [2000, 4000, 8000, 15000, 30000, 30000]) {
      const pending = [...timers.values()].filter((t) => !t.repeat);
      assert.equal(pending.length, 1);
      assert.equal(pending[0].at - now, delay);
      await advance(delay);
    }
    members.delete('retry');
    const count = requests.length;
    listener('background');
    await settle();
    assert.equal(requests.length, count);
    assert.equal(timers.size, 0);
    assert.equal(app.size, 0);
  }
  // Queued ownership is checked at native entry, not only when scheduled.
  {
    const c = client('queue'),
      owner = storage.quizStorageOwner('queue', c);
    const d = deferred();
    let blocked = false,
      live = true;
    storageDelay = (n) => (n === 'setItem' && !blocked ? ((blocked = true), d.promise) : undefined);
    const first = storage.saveAccessCode('queue', 'other', 'block', owner);
    await settle();
    const scoped = storage.quizStorageOwner('queue', c, () => live);
    const obsolete = storage.saveAccessCode('queue', 'q', 'obsolete', scoped);
    live = false;
    const newestOwner = storage.quizStorageOwner('queue', c);
    const newest = storage.saveAccessCode('queue', 'q', 'newest', newestOwner);
    d.resolve();
    await Promise.all([first, obsolete, newest]);
    storageDelay = null;
    assert.equal(await storage.loadAccessCode('queue', 'q', newestOwner), 'newest');
    assert.ok(!storageCalls.some((c) => c[0] === 'setItem' && c[2] === 'obsolete'));
    // Old shapes/keys and snapshot-at-enqueue survive mutation of the input object.
    const data = storage.emptyAttempt();
    data.pending.one = { answer: answer('original'), type: 'essay_question', at: now };
    const saved = storage.saveAttempt('queue', 's', 1, data, owner);
    data.pending.one.answer = answer('mutated');
    await saved;
    assert.equal(
      (await storage.loadAttempt('queue', 's', 1, owner)).pending.one.answer.value,
      'original',
    );
    await storage.clearAttempt('queue', 's', 1, owner);
    await storage.saveAttempt('queue', 's', 1, data, owner);
    assert.equal(
      (await storage.loadAttempt('queue', 's', 1, owner)).pending.one.answer.value,
      'mutated',
    );
  }
  // A corrected deadline cancels an already scheduled automatic retry.
  {
    const { engine } = await ready('clock');
    const base = transport;
    transport = (m, u, b) =>
      u.endsWith('/time')
        ? Promise.resolve({ time_left: 0 })
        : u.endsWith('/complete')
          ? Promise.reject(new CanvasNetworkError())
          : base(m, u, b);
    await engine.refreshTime();
    await advance(0);
    transport = (m, u, b) => (u.endsWith('/time') ? Promise.resolve({ time_left: 60 }) : base(m, u, b));
    await engine.refreshTime();
    const count = announcements.length;
    await advance(5000);
    assert.equal(announcements.length, count);
    engine.dispose();
  }
  // Same submission ID, new server attempt: new load generation and original token payload.
  {
    defaults();
    session = { account: { id: 'retake' }, client: client('retake') };
    const m = mount(() =>
      useQuizAttempt({ courseId: 'c', quizId: 'q', submissionId: 's', autoSubmit: false }),
    );
    m.render();
    await settle();
    const old = m.render();
    const base = transport;
    transport = (method, url, body) =>
      url.endsWith('/s')
        ? Promise.resolve(rawSubmission(2, true, 'second-token'))
        : base(method, url, body);
    old.retry();
    m.render();
    await settle();
    const next = m.render();
    assert.equal(next.provenance.attempt, 2);
    assert.notEqual(next.provenance.generation, old.provenance.generation);
    next.setAnswer('one', answer('second'));
    await next.flush();
    const write = requests.filter((r) => r.method === 'post' && r.url.endsWith('/questions')).at(-1);
    assert.equal(write.body.attempt, 2);
    assert.equal(write.body.validation_token, 'second-token');
    m.replayEffects();
    await settle();
    m.render();
    m.unmount();
    assert.equal(timers.size, 0);
  }

  // An old completion cannot clear a newer accepted code, even while the old
  // screen is still mounted. Actual completion payload retains its loaded code.
  {
    const x = setup('codes');
    await storage.saveAccessCode('codes', 'q', 'original');
    await x.engine.load();
    await settle();
    const newCodeOwner = storage.quizStorageOwner('codes', x.context.client);
    await storage.saveAccessCode('codes', 'q', 'new-code', newCodeOwner);
    await x.engine.submit();
    assert.equal(
      requests.filter((r) => r.url.endsWith('/complete')).at(-1).body.access_code,
      'original',
    );
    assert.equal(await storage.loadAccessCode('codes', 'q', newCodeOwner), 'new-code');
    x.engine.dispose();
  }
  // A second committed engine for the same resource retires the first; original
  // queued edit snapshots drain before the new engine reads them.
  {
    const old = await ready('overlap');
    old.engine.setAnswer('one', answer('handoff'));
    const next = new QuizAttemptEngine(
      old.context,
      runtime.createTranslator('en'),
      () => {},
      () => {},
    );
    await next.load();
    await settle();
    assert.equal(old.engine.current(), false);
    assert.equal(next.snapshot.answers.one.value, 'handoff');
    next.dispose();
  }
  // Viewing another question while completion cleanup is pending must not
  // recreate the completed attempt after its ordered local removal.
  {
    const { engine } = await ready('navigation-cleanup');
    const key = 'easel.quiz.attempt.navigation-cleanup.s.1';
    const d = deferred();
    let entered = false;
    storageDelay = (name, args) =>
      name === 'removeItem' && args[0] === key && !entered
        ? ((entered = true), d.promise)
        : undefined;
    const operation = engine.submit();
    await settle();
    assert.ok(entered);
    engine.setPosition(1);
    assert.equal(engine.snapshot.position, 1, 'read-only navigation still works during submission');
    d.resolve();
    await operation;
    await settle();
    storageDelay = null;
    assert.equal(engine.snapshot.status.kind, 'submitted');
    assert.equal(db.has(key), false, 'navigation must not resurrect a completed attempt');
    engine.dispose();
  }
  // Retirement while post-completion storage is delayed cannot publish success
  // or enter a subsequent access-code clear. Cleanup drains the entered clear.
  for (const reject of [false, true]) {
    const { engine } = await ready('clearing');
    const d = deferred();
    let entered = false;
    storageDelay = (n) => (n === 'removeItem' && !entered ? ((entered = true), d.promise) : undefined);
    const operation = engine.submit();
    await settle();
    assert.ok(entered);
    engine.dispose();
    const count = storageCalls.length;
    if (reject) d.reject(Error('native storage rejected'));
    else d.resolve();
    await operation;
    await settle();
    storageDelay = null;
    assert.equal(storageCalls.length, count);
    assert.notEqual(engine.snapshot.status.kind, 'submitted');
  }
  console.log(
    'quiz-engine: real engine/hook/storage/API; synthetic clock/session/transport/native boundaries; all checks passed',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
