/* global __dirname */
// Production quiz components/helpers; staged commit/discard React hooks and
// explicit native/query/browser/child boundaries. No HTTP or native UI operations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const h = require('./submission-form.check.cjs');
const { mocks, elements, boundary, calls, allow, all, deferred, flush, equal, setEnvironment } = h;
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
Object.assign(mocks.react, react);
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
  'lib/dates',
  'features/course/format',
  'features/course/FactList',
  'features/grades/calculate',
  'features/grades/format',
  'features/quizzes/TakeQuiz', 'features/quizzes/AccessCodePrompt',
  'features/quizzes/lockdown', 'features/quizzes/quizEntry', 'features/web/open',
  'canvas/api/quizzes', 'canvas/client',
  'features/course/QuizDetails',
  'features/quizzes/QuizHistory',
  'features/quizzes/QuizResult',
  'features/quizzes/quizPresentation',
  'app/(app)/course/[courseId]/quizzes',
  'app/(app)/course/[courseId]/quiz/[quizId]',
  'app/(app)/course/[courseId]/quiz/[quizId]/history',
  'app/(app)/course/[courseId]/quiz/[quizId]/result',
]);
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
Object.assign(h.native, elements('Modal KeyboardAvoidingView Pressable'));
h.native.Platform = { OS: 'ios' };
h.native.Linking = { openURL: boundary('link') };
Object.assign(mocks['@/design'], elements('TextField Icon'));
mocks['@/design'].useTheme = () => ({ shadows: {} });
mocks['lucide-react-native'] = elements('Globe History ShieldAlert Wifi KeyRound');
mocks['expo-crypto'] = { CryptoDigestAlgorithm: {}, digestStringAsync: boundary('crypto') };
mocks['@/features/quizzes/storage'] = { quizStorageOwner: (accountId, client, current) => ({ accountId, client, current }), loadAccessCode: (id, quiz, owner) => { assert.equal(owner.accountId, id); assert.ok(owner.current()); return boundary('load')(id, quiz); }, saveAccessCode: (id, quiz, code, owner) => { assert.equal(owner.accountId, id); assert.ok(owner.current()); return boundary('save')(id, quiz, code); } };
// History's route function is real; its unused rendering dependencies are explicit.
mocks['@/canvas/api/courses'] = { useCourse: boundary('course') };
mocks['@/features/course/states'] = elements('LoadError DetailSkeleton');
mocks['@/features/quizzes/AttemptResults'] = elements('AttemptResults');
delete mocks['@/canvas/client'];
delete mocks['@/features/grades/calculate'];
delete mocks['@/features/grades/format'];
const api = load('@/canvas/api/quizzes');
const ui = load('@/features/quizzes/TakeQuiz');
const prompt = load('@/features/quizzes/AccessCodePrompt').AccessCodePrompt;
const lockdown = load('@/features/quizzes/lockdown');
const runtime = load('@/i18n/runtime');
const { CanvasNetworkError } = load('@/canvas/client');
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const baseline = require('./quiz-entry.baseline.json');
const client = { get: boundary('get'), post: boundary('post') };
const locale = lang => { runtime.setAccountLocale('quiz-entry', lang); return runtime.createTranslator(lang); };
const raw = () => ({ id: 'q/raw?ع', title: 'RAW العربية', htmlUrl: 'https://school/quiz?raw=%20', mobileUrl: 'https://school/mobile?raw=%2f', requiresAccessCode: false, requiresLockdownBrowser: false, oneQuestionAtATime: false, cantGoBack: false, locked: false, timeLimitMinutes: 65 });
const wire = () => ({ id: 's/raw', quiz_id: 'q/raw?ع', attempt: 2, workflow_state: 'untaken', attempts_left: -1 });
let p;
function setup() {
  setEnvironment({ client, account: { id: 'account/raw' }, online: true });
  locale('en');
  p = { quiz: raw(), courseId: 'c/raw?ع', attempts: { used: 0, inProgress: null }, attemptsLeft: null };
}
const button = (tree, key) => all(tree, 'Button').find(n => n.props.children === runtime.createTranslator(runtime.displayLocale())('quizEntry.' + key)).props;
const field = tree => all(tree, 'TextField')[0].props;
const promptProps = tree => all(tree, prompt)[0].props;
const text = h.textOf;
const pathFor = () => `/api/v1/courses/${p.courseId}/quizzes/${p.quiz.id}/submissions`;
async function run() {
  for (const lang of ['en', 'fr', 'ar']) {
    const c = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2292);
    for (const [k, v] of Object.entries(baseline.catalogs[lang])) assert.equal(hash(c[k]), v, k);
    assert.equal(Object.keys(c).filter(k => k.startsWith('quizEntry.')).length, 34);
  }
  setup();
  // Executable replacement for the historical whole-TakeQuiz freeze.
  for (const lock of [false, true]) for (const one of [false, true]) for (const back of [false, true])
    assert.equal(ui.quizMode({ ...raw(), requiresLockdownBrowser: lock, oneQuestionAtATime: one, cantGoBack: back }), lock ? 'lockdown' : one || back ? 'web' : 'native');
  equal(ui.attemptRoute('c/?', 'q&', 's#'), { pathname: '/course/[courseId]/quiz/[quizId]/take', params: { courseId: 'c/?', quizId: 'q&', submissionId: 's#' } });
  for (const mobileUrl of [undefined, null, '', 'raw://?ع']) {
    const q = { ...raw(), mobileUrl };
    allow('push', undefined); ui.openQuizOnWeb(q, 'raw/course');
    equal(calls.at(-1), ['push', { pathname: '/web', params: { url: mobileUrl ?? q.htmlUrl, title: q.title, guard: 'Leave this quiz? Your answers are saved, but the timer keeps running.', courseId: 'raw/course' } }]);
  }
  for (const url of ['https://a/b?x=%20', 'http://a/b', 'HTTPS://A', 'rldb://a'])
    assert.equal(lockdown.lockdownUrl(url), 'rldb://' + url.replace(/^https?:\/\//, ''));
  // No effects/localization start attempts. Presentation and duration rules.
  for (const lang of ['en', 'fr', 'ar']) {
    setup(); const t = locale(lang); const m = mount(() => ui.TakeQuiz(p));
    for (const minutes of [null, 0, 1, 59, 60, 65, 120]) {
      p.quiz = { ...p.quiz, timeLimitMinutes: minutes }; const tree = m.render();
      assert.ok(text(tree).includes(t('quizEntry.saves')));
      if (!minutes) assert.ok(!text(tree).includes(t('quizEntry.timed', { duration: '' }).split('  ')[0]));
      else { const f = mount(() => load('@/features/quizzes/quizPresentation').useQuizPresentation()); const pr = f.render(); assert.ok(text(tree).includes(t('quizEntry.timed', { duration: pr.minutes(minutes) }))); f.unmount(); }
    }
    p.attempts = { used: 1, inProgress: { id: 's' } }; p.attemptsLeft = 0;
    const tree = m.render(); assert.ok(button(tree, 'resume')); assert.equal(all(tree, 'Button').length, 1);
    p.attempts = { used: 2, inProgress: null }; assert.ok(text(m.render()).includes(t('quizEntry.used')));
    p.quiz = { ...p.quiz, locked: true }; setEnvironment({ online: false });
    allow('push', undefined); const historyButton = button(m.render(), 'history'); historyButton.onPress(); historyButton.onPress();
    equal(calls.at(-1), ['push', { pathname: '/course/[courseId]/quiz/[quizId]/history', params: { courseId: p.courseId, quizId: p.quiz.id } }]);
    m.unmount();
  }
  // Legacy duration outputs and exact optional-code serializer payloads.
  setup();
  const formatter=mount(()=>load('@/features/quizzes/quizPresentation').useQuizPresentation());
  const presentation=formatter.render();
  for(const [n,expected] of [[0,'0 minutes'],[1,'1 minute'],[59,'59 minutes'],[60,'1 hour'],[65,'1 hour 5 minutes'],[120,'2 hours']]) assert.equal(presentation.minutes(n),expected);
  formatter.unmount();
  for(const code of [undefined,'','RAW ع']) {
    allow('post',{quiz_submissions:[wire()]});const submission=await api.startQuizSubmission(client,'c/raw','q/raw',code);
    equal(calls.at(-1),['post','/api/v1/courses/c/raw/quizzes/q/raw/submissions',code?{access_code:code}:{}]);
    assert.equal(submission.id,'s/raw');assert.equal(submission.inProgress,true);assert.equal(submission.attemptsLeft,null);
  }
  // Real fetch/start adapters, raw endpoint and code payload, duplicate entry.
  setup(); let m = mount(() => ui.TakeQuiz(p)); let b = button(m.render(), 'take');
  const fetch = deferred(); allow('get', fetch.promise); const start = b.onPress(); b.onPress();
  equal(calls.at(-1), ['get', pathFor(), undefined, undefined]);
  allow('load', 'Raw كود'); allow('post', { quiz_submissions: [wire()] }); allow('push', undefined);
  fetch.resolve({ quiz_submissions: [] }); await start;
  equal(calls.slice(-3), [['load', 'account/raw', p.quiz.id], ['post', pathFor(), { access_code: 'Raw كود' }], ['push', ui.attemptRoute(p.courseId, p.quiz.id, 's/raw')]]);
  m.unmount();
  // Resume precedes storage/start; settings_only isn't an attempt.
  setup(); m = mount(() => ui.TakeQuiz(p)); allow('get', { quiz_submissions: [{ ...wire(), workflow_state: 'settings_only' }, wire()] }); allow('push', undefined); await button(m.render(), 'take').onPress(); m.unmount();
  // Every await, every replacement, both success and rejection. Original clients
  // remain the only entered transport; no real transport exists in this VM.
  for (const stage of ['get', 'load', 'post', 'save']) for (const change of ['account', 'client', 'course', 'quiz', 'unmount', 'lock', 'mode', 'requiresCode', 'replay']) for (const reject of [false, true]) {
    setup(); p.quiz.requiresAccessCode = true; const pending = deferred(); m = mount(() => ui.TakeQuiz(p)); b = button(m.render(), 'take');
    allow('get', stage === 'get' ? pending.promise : { quiz_submissions: [] });
    if (stage !== 'get') allow('load', stage === 'load' ? pending.promise : 'RAW');
    if (['post', 'save'].includes(stage)) allow('post', stage === 'post' ? pending.promise : { quiz_submissions: [wire()] });
    if (stage === 'save') allow('save', pending.promise);
    const op = b.onPress(); await flush();
    if (change === 'account') setEnvironment({ account: { id: 'replacement' } });
    if (change === 'client') setEnvironment({ client: { get: boundary('replacementGet'), post: boundary('replacementPost') } });
    if (change === 'course') p = { ...p, courseId: 'replacement' };
    if (change === 'quiz') p = { ...p, quiz: { ...p.quiz, id: 'replacement' } };
    if (change === 'lock') p = { ...p, quiz: { ...p.quiz, locked: true } };
    if (change === 'mode') p = { ...p, quiz: { ...p.quiz, oneQuestionAtATime: true } };
    if (change === 'requiresCode') p = { ...p, quiz: { ...p.quiz, requiresAccessCode: false } };
    if (change === 'unmount') m.unmount(); else if (change === 'replay') m.replayEffects(); else m.render();
    const n = calls.length;
    if (reject) pending.reject(new api.QuizRefusedError('access_code', 'RAW', 403));
    else pending.resolve(stage === 'get' ? { quiz_submissions: [] } : stage === 'load' ? 'RAW' : stage === 'post' ? { quiz_submissions: [wire()] } : undefined);
    await op; assert.equal(calls.length, n, `${stage}/${change}/${reject}`);
    if (change !== 'unmount' && change !== 'replay') { b.onPress(); assert.equal(calls.length, n); }
    if (change !== 'unmount') m.unmount();
  }
  // Own successful eligibility/cache update must not discard save/navigation.
  setup(); p.quiz.requiresAccessCode = true; m = mount(() => ui.TakeQuiz(p));
  const started = deferred(); allow('get', { quiz_submissions: [] }); allow('load', 'RAW'); allow('post', started.promise);
  const op = button(m.render(), 'take').onPress(); await flush();
  p = { ...p, attemptsLeft: 0, attempts: { used: 1, inProgress: null } }; m.render();
  allow('save', undefined); allow('push', undefined); started.resolve({ quiz_submissions: [wire()] }); await op; m.unmount();
  // Pending pre-start work is revoked by an eligibility transition, even away/back.
  setup(); m = mount(() => ui.TakeQuiz(p)); const d = deferred(); allow('get', d.promise); const pendingStart = button(m.render(), 'take').onPress();
  p.attemptsLeft = 0; m.render(); p.attemptsLeft = null; m.render(); const n = calls.length; d.resolve({ quiz_submissions: [] }); await pendingStart; assert.equal(calls.length, n); m.unmount();
  // Discarded resource render publishes nothing; locale/raw-title/object refreshes
  // preserve prompt session and do not issue transport or storage work.
  setup(); p.quiz.requiresAccessCode = true; m = mount(() => ui.TakeQuiz(p)); allow('get', { quiz_submissions: [] }); allow('load', null); await button(m.render(), 'take').onPress();
  let pp = promptProps(m.render()); const session = pp.context; let pm = mount(() => prompt(pp)); let pt = pm.render(); field(pt).onChangeText('  كود RAW  '); pt = pm.render();
  const stable = calls.length; const original = p; p = { ...p, courseId: 'discarded' }; const discarded = m.renderOnly(); m.abandon(); await button(discarded, 'take').onPress(); p = original;
  for (const lang of ['fr', 'ar', 'en']) { locale(lang); p = { ...p, quiz: { ...p.quiz, title: 'NEW raw' } }; pp = promptProps(m.render()); assert.equal(pp.context, session); pt = pm.render(); assert.equal(field(pt).value, '  كود RAW  '); }
  assert.equal(calls.length, stable);
  // Actual parent+prompt keyboard/button race, raw trimmed code and wrong-code retry.
  allow('get', { quiz_submissions: [] }); const refusal = deferred(); allow('post', refusal.promise);
  const keyboard = field(pt).onSubmitEditing; const request = keyboard(); button(pt, 'start').onPress(); await flush(); pp = promptProps(m.render()); pt = pm.render();
  const busyCount = calls.length; all(pt, 'Modal')[0].props.onRequestClose(); all(pt, 'Pressable')[0].props.onPress(); button(pt, 'cancel').onPress(); assert.equal(calls.length, busyCount);
  equal(calls.at(-1), ['post', pathFor(), { access_code: 'كود RAW' }]);
  allow('save', undefined); refusal.reject(new api.QuizRefusedError('access_code', 'SERVER', 403)); await request; pp = promptProps(m.render()); pt = pm.render();
  for (const lang of ['en', 'fr', 'ar']) { const t = locale(lang); pp = promptProps(m.render()); pt = pm.render(); assert.equal(field(pt).value, '  كود RAW  '); assert.equal(field(pt).error, t('quizEntry.wrongCode')); }
  const oldSubmit = pp.onSubmit; button(pt, 'cancel').onPress(); pp = promptProps(m.render()); pm.render(); const count = calls.length; await keyboard(); await oldSubmit('old'); assert.equal(calls.length, count);
  allow('get', { quiz_submissions: [] }); allow('load', null); await button(m.render(), 'take').onPress(); pp = promptProps(m.render()); assert.equal(field(pm.render()).value, ''); pm.unmount(); m.unmount();
  // Semantic refusal reasons, native network identity, raw non-English messages.
  for (const reason of ['ip_filter', 'locked', 'exists', 'lockdown', 'unsupported', 'one_at_a_time', 'ended', 'token', 'access_code', 'network', 'raw', 'unknown']) {
    setup(); m = mount(() => ui.TakeQuiz(p)); const err = reason === 'network' ? new CanvasNetworkError() : reason === 'raw' ? new Error('RAW locked access code العربية') : reason === 'unknown' ? 42 : new api.QuizRefusedError(reason, 'RAW العربية', 403);
    allow('get', () => Promise.reject(err)); if (reason === 'access_code') allow('save', undefined); if (['unsupported', 'one_at_a_time'].includes(reason)) allow('push', undefined);
    await button(m.render(), 'take').onPress();
    for (const lang of ['en', 'fr', 'ar']) {      
const t = locale(lang); const tree = m.render(); const c = all(tree, 'Callout')[0];
      if (['unsupported', 'one_at_a_time', 'access_code', 'unknown'].includes(reason)) assert.equal(c, undefined);
      else { assert.ok(c); if (['ended', 'token', 'raw'].includes(reason)) assert.equal(c.props.children, err.message); if (reason === 'ip_filter') assert.equal(c.props.children, t('quizEntry.ipBody', { message: err.serverMessage })); if (reason === 'network') assert.equal(c.props.children, t('quizEntry.networkBody')); }
    } m.unmount();
  }
  // Active delayed failures are raw/relabelable, never unhandled. Storage itself
  // normally absorbs failures; injection also covers a rejecting implementation.
  for (const stage of ['get', 'load', 'post', 'save', 'clear']) {
    setup(); p.quiz.requiresAccessCode = true; m = mount(() => ui.TakeQuiz(p));
    const d = deferred();
    allow('get', stage === 'get' ? d.promise : { quiz_submissions: [] });
    if (stage !== 'get') allow('load', stage === 'load' ? d.promise : 'SAVED raw');
    if (['post', 'save', 'clear'].includes(stage)) allow('post', stage === 'post' ? d.promise : stage === 'clear' ? () => Promise.reject(new api.QuizRefusedError('access_code', 'raw', 403)) : { quiz_submissions: [wire()] });
    if (['save', 'clear'].includes(stage)) allow('save', d.promise);
    const request = button(m.render(), 'take').onPress(); await flush();
    d.reject(Error('raw failure العربية')); await request;
    for (const lang of ['en', 'fr', 'ar']) { const t = locale(lang); const c = all(m.render(), 'Callout')[0]; assert.equal(c.props.title, t('quizEntry.failed')); assert.equal(c.props.children, 'raw failure العربية'); }
    m.unmount();
  }
  // Saved wrong code clears before reopening, without blaming entered text.
  setup(); p.quiz.requiresAccessCode = true; m = mount(() => ui.TakeQuiz(p));
  allow('get', { quiz_submissions: [] }); allow('load', 'saved'); allow('post', () => Promise.reject(new api.QuizRefusedError('access_code', 'raw', 403))); const clear = deferred(); allow('save', clear.promise);
  const savedRequest = button(m.render(), 'take').onPress(); await flush(); assert.equal(promptProps(m.render()).visible, false);
  clear.resolve(); await savedRequest; pp = promptProps(m.render()); assert.equal(pp.error, null); assert.equal(pp.visible, true);
  allow('get', { quiz_submissions: [] }); allow('post', { quiz_submissions: [wire()] }); allow('save', undefined); allow('push', undefined); await pp.onSubmit('NEW raw'); m.unmount();
  // Retained child controls reject current busy/content/open/parent-context changes.
  for (const change of ['busy', 'content', 'close', 'context', 'parent', 'unmount']) {
    let submitted = 0, cancelled = 0;
    pp = { visible: true, busy: false, error: null, context: {}, isCurrent: () => true, onSubmit: () => { submitted++; }, onCancel: () => { cancelled++; } };
    pm = mount(() => prompt(pp)); pt = pm.render(); field(pt).onChangeText('raw'); pt = pm.render();
    const oldField = field(pt), oldCancel = all(pt, 'Modal')[0].props.onRequestClose, oldBackdrop = all(pt, 'Pressable')[0].props.onPress;
    if (change === 'busy') pp = { ...pp, busy: true };
    if (change === 'content') oldField.onChangeText('new');
    if (change === 'close') pp = { ...pp, visible: false };
    if (change === 'context') pp = { ...pp, context: {} };
    if (change === 'parent') pp = { ...pp, isCurrent: () => false };
    if (change === 'unmount') pm.unmount(); else pm.render();
    await oldField.onSubmitEditing(); oldCancel(); oldBackdrop(); assert.equal(submitted, 0); assert.equal(cancelled, 0);
    if (change !== 'unmount') pm.unmount();
  }
  // Parent alert callbacks cannot open stores after any resource/policy replacement.
  for (const change of ['account', 'client', 'course', 'quiz', 'lock', 'attempts', 'unmount']) {
    setup(); p.quiz.requiresLockdownBrowser = true; m = mount(() => ui.TakeQuiz(p)); let alert;
    allow('link', () => Promise.reject(Error('missing'))); allow('alert', (...v) => { alert = v; }); button(m.render(), 'openLockdown').onPress(); await flush();
    if (change === 'account') setEnvironment({ account: { id: 'new' } });
    if (change === 'client') setEnvironment({ client: {} });
    if (change === 'course') p = { ...p, courseId: 'new' };
    if (change === 'quiz') p = { ...p, quiz: { ...p.quiz, id: 'new' } };
    if (change === 'lock') p = { ...p, quiz: { ...p.quiz, locked: true } };
    if (change === 'attempts') p = { ...p, attemptsLeft: 0 };
    if (change === 'unmount') m.unmount(); else m.render();
    const n = calls.length; await alert[2][1].onPress(); assert.equal(calls.length, n); if (change !== 'unmount') m.unmount();
  }
  // Web and LockDown mode entry, invocation-language alerts and stale stores.
  for (const platform of ['ios', 'android']) {
    h.native.Platform.OS = platform; cache.delete(path.join(root, 'features/quizzes/lockdown.ts')); const ld = load('@/features/quizzes/lockdown');
    const store = platform === 'ios' ? 'itms-apps://search.itunes.apple.com/WebObjects/MZSearch.woa/wa/search?media=software&term=Respondus%20LockDown%20Browser' : 'market://search?q=Respondus%20LockDown%20Browser&c=apps';
    const web = platform === 'ios' ? 'https://apps.apple.com/search?term=Respondus%20LockDown%20Browser' : 'https://play.google.com/store/search?q=Respondus%20LockDown%20Browser&c=apps';
    for (const stale of ['before', 'alert', 'store', 'none', 'cancel']) {
      let valid = true; const t = locale('fr'); const d = deferred(); allow('link', d.promise); let alert; if (stale !== 'before') allow('alert', (...args) => { alert = args; });
      const op = ld.openLockdownBrowser(raw().htmlUrl, { t, valid: () => valid }); locale('ar'); if (stale === 'before') valid = false; d.reject(Error('missing')); await op; if (stale === 'before') continue;
      assert.equal(alert[0], t('quizEntry.notInstalled'));
      if (stale === 'alert') valid = false;
      if (stale === 'cancel') alert[2][0].onPress();
      let pending; if (['store', 'none'].includes(stale)) { pending = deferred(); allow('link', pending.promise); }
      const go = alert[2][1].onPress(); alert[2][1].onPress();
      if (pending) { equal(calls.at(-1), ['link', store]); if (stale === 'store') valid = false; else allow('link', undefined); pending.reject(Error('store')); }
      await go; if (stale === 'none') equal(calls.at(-1), ['link', web]);
    }
    allow('link', undefined); await ld.openLockdownBrowser('http://legacy/raw'); equal(calls.at(-1), ['link', 'rldb://legacy/raw']);
  }
  h.native.Platform.OS = 'ios';
  setup(); p.quiz.oneQuestionAtATime = true; m = mount(() => ui.TakeQuiz(p)); const t = locale('ar'); allow('push', undefined); b = button(m.render(), 'take'); b.onPress(); b.onPress(); assert.equal(calls.at(-1)[1].params.guard, t('quizEntry.leave')); m.unmount();
  setup(); p.quiz.requiresLockdownBrowser = true; m = mount(() => ui.TakeQuiz(p)); const app = deferred(); allow('link', app.promise); b = button(m.render(), 'openLockdown'); b.onPress(); b.onPress(); p = { ...p, quiz: { ...p.quiz, id: 'replacement' } }; m.render(); app.reject(Error('gone')); await flush(); m.unmount();
  // Cancelled native alert releases entry for a later user action; its old
  // store callback remains consumed. Default alert language remains English.
  setup();locale('ar');let legacyAlert;
  allow('link',()=>Promise.reject(Error('missing')));allow('alert',(...v)=>{legacyAlert=v;});
  await lockdown.openLockdownBrowser('https://legacy');
  assert.equal(legacyAlert[0],'LockDown Browser isn’t installed');
  setup();p.quiz.requiresLockdownBrowser=true;m=mount(()=>ui.TakeQuiz(p));let cancelAlert;
  allow('link',()=>Promise.reject(Error('missing')));allow('alert',(...v)=>{cancelAlert=v;});
  button(m.render(),'openLockdown').onPress();await flush();cancelAlert[2][0].onPress();
  const nBefore=calls.length;await cancelAlert[2][1].onPress();assert.equal(calls.length,nBefore);
  allow('link',undefined);button(m.render(),'openLockdown').onPress();await flush();m.unmount();
  // An eligibility transition retires an external launch without blocking a
  // later launch, even while its app request or installation alert is pending.
  for (const stage of ['app', 'alert']) {
    setup();
    p.quiz.requiresLockdownBrowser = true;
    m = mount(() => ui.TakeQuiz(p));
    const pendingApp = deferred();
    let oldAlert;
    allow('link', pendingApp.promise);
    button(m.render(), 'openLockdown').onPress();
    if (stage === 'alert') {
      allow('alert', (...args) => { oldAlert = args; });
      pendingApp.reject(Error('not installed'));
      await flush();
    }
    p = { ...p, attemptsLeft: 0 };
    m.render();
    p = { ...p, attemptsLeft: 1 };
    m.render();
    if (stage === 'app') {
      pendingApp.reject(Error('obsolete launch'));
      await flush();
    } else {
      const beforeStore = calls.length;
      await oldAlert[2][1].onPress();
      assert.equal(calls.length, beforeStore, 'obsolete alert cannot enter the store');
    }
    const beforeRetry = calls.filter(call => call[0] === 'link').length;
    allow('link', undefined);
    button(m.render(), 'openLockdown').onPress();
    await flush();
    assert.equal(calls.filter(call => call[0] === 'link').length, beforeRetry + 1,
      'restored eligibility can start a fresh external launch');
    m.unmount();
  }
  h.verifyBoundaries();
  console.log('quiz-entry: 2292 preserved + 34 owned; production components/API, staged lifetime/transport/native/storage mocks passed (' + process.env.TZ + ')');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
