// Production routes/helper/API/browser URL adapter; synthetic committed hooks,
// native components, account/query, transport, WebView and browser/router edges.
// No renderer, device, school requests, Compiler or native authentication claims.
const assert = require('node:assert/strict');
const h = require('./submission-form.check.cjs');
const {
  load,
  mocks,
  allowed,
  native,
  elements,
  boundary,
  calls,
  allow,
  reset,
  view,
  all,
  deferred,
  flush,
  equal,
  setEnvironment,
} = h;
const baseline = require('./annotation-viewers.baseline.json');
// A local staging harness adds discarded-render and effect-replay cases without
// changing any existing suite. It is intentionally not a React renderer.
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
Object.assign(mocks.react, react);
function mount(fn) {
  const s = { cursor: 0, slots: [], layouts: [], effects: [], mounted: true, dirty: false };
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
Object.assign(native, { Platform: { OS: 'ios' } });
mocks['lucide-react-native'] = elements(
  'FileWarning ClipboardCheck ExternalLink FilePen Globe MessageSquare Mic Puzzle',
);
Object.assign(
  mocks['@/design'],
  elements('Avatar Badge Card Divider Icon IconTile ListGroup ListItem Text'),
);
mocks['@/features/content/RichContent'] = { RichContent: 'RichContent' };
mocks['@/features/files/AttachmentList'] = { AttachmentList: 'AttachmentList' };
mocks['@/features/submissions/MediaPlayer'] = { MediaPlayer: 'MediaPlayer' };
mocks['@/features/lti/launch'] = { useLaunchTool: () => (payload, lifetime) => { assert.equal(typeof lifetime.isCurrent, 'function'); return boundary('launchTool')(payload); } };
mocks['@/canvas/api/pages'] = { FRONT_PAGE: 'front_page' };
Object.assign(mocks['@/design'], elements('EmptyState Divider'));
mocks['@/features/course/CourseScope'] = { CourseScope: 'CourseScope' };
mocks['@/features/course/states'] = { DetailSkeleton: 'DetailSkeleton' };
mocks['@/features/web/AuthenticatedWebView'] = { AuthenticatedWebView: 'AuthenticatedWebView' };
mocks['@/features/files/previews/WebPreviews'] = { DocViewerPreview: 'DocViewerPreview' };
mocks['expo-router/react-navigation'] = { useHeaderHeight: () => 20 };
mocks['react-native-safe-area-context'] = { useSafeAreaInsets: () => ({ bottom: 0 }) };
mocks['expo-web-browser'] = { openBrowserAsync: boundary('openBrowser') };
let params,
  query,
  posts,
  gets,
  canGoBack = true;
mocks['expo-router'].useLocalSearchParams = () => params;
mocks['expo-router'].router.canGoBack = () => canGoBack;
mocks['@/canvas/api/assignments'].useAssignment = (c, a) => {
  assert.equal(c, params.courseId);
  assert.equal(a, params.assignmentId);
  return query;
};
delete mocks['@/features/content/browser'];
for (const k of [
  'features/lti/action',
  'features/lti/lifetime',
  'features/content/browser',
  'features/course/SubmissionParts',
  'features/course/navigation',
  'features/submissions/feedbackLaunch',
  'features/submissions/feedbackPresentation',
  'features/submissions/annotationViewer',
  'app/(app)/course/[courseId]/assignment/[assignmentId]/annotate',
  'app/(app)/course/[courseId]/assignment/[assignmentId]/annotations',
])
  allowed.add(k);
const Annotate = load('@/app/(app)/course/[courseId]/assignment/[assignmentId]/annotate').default;
const Feedback = load(
  '@/app/(app)/course/[courseId]/assignment/[assignmentId]/annotations',
).default;
const Parts = load('@/features/course/SubmissionParts');
const registry = load('@/features/submissions/feedbackLaunch');
let feedbackRaw;
function feedbackParams(extra = {}) {
  feedbackRaw = { courseId: 'c', assignmentId: 'a', ...extra };
  const producer = mount(() =>
    Parts.AttemptContent({
      assignment: {
        courseId: feedbackRaw.courseId,
        id: feedbackRaw.assignmentId,
        htmlUrl: feedbackRaw.canvasUrl,
      },
      attempt: {
        type: 'online_upload',
        attempt: 1,
        attachments: [
          {
            id: 'file',
            display_name: feedbackRaw.title,
            preview_url: feedbackRaw.url,
            'content-type': 'application/pdf',
          },
        ],
      },
    }),
  );
  const tree = producer.render();
  let result;
  allow('push', (target) => {
    result = target.params;
  });
  all(tree, 'ListItem')[0].props.onPress();
  producer.unmount();
  return result;
}
const rawURL = 'https://signed.test/مسار?signature=a%2Fb&x=1';
function client(id) {
  return {
    id,
    baseUrl: 'https://canvas.test',
    post(...args) {
      const d = deferred();
      posts.push({ ...d, args, id });
      return d.promise;
    },
    get(...args) {
      const d = deferred();
      gets.push({ ...d, args, id });
      return d.promise;
    },
  };
}
function setup(Screen = Annotate, extra = {}) {
  reset();
  posts = [];
  gets = [];
  canGoBack = true;
  setEnvironment({ account: { id: 'A' }, client: client('A'), online: true });
  params =
    Screen === Feedback && extra.url
      ? feedbackParams(extra)
      : { courseId: 'c', assignmentId: 'a', ...extra };
  query = {
    data: { submission: { id: 'sub' }, htmlUrl: '/courses/c/assignments/a?raw=%2F' },
    isSuccess: true,
    isError: false,
    refetch: boundary('refetch'),
  };
  const screen = mount(Screen);
  return { screen, tree: screen.render() };
}
const empty = (tree) => all(tree, 'EmptyState')[0]?.props;
const viewer = (tree) => all(tree, 'AuthenticatedWebView')[0]?.props;
const preview = (tree) => all(tree, 'DocViewerPreview')[0]?.props;
const done = (tree) => all(tree, 'Button')[0]?.props.onPress;
const title = (tree) => all(tree, 'CourseScope')[0].props.title;
async function succeed(screen, i = posts.length - 1, url = rawURL) {
  posts[i].resolve({ canvadocs_session_url: url, annotation_context_launch_id: 'RAW' });
  await flush();
  return screen.render();
}
async function fail(screen, error, i = posts.length - 1) {
  posts[i].reject(error);
  await flush();
  return screen.render();
}
async function run() {
  for (const lang of ['en', 'fr', 'ar']) {
    const cat = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 1934);
    for (const [k, v] of Object.entries(baseline.catalogs[lang])) equal(cat[k], v);
    const added = Object.keys(cat).filter((k) => k.startsWith('annotationViewer.'));
    assert.equal(added.length, 20);
    equal(
      added.sort(),
      Object.keys(load('@/i18n/en').en)
        .filter((k) => k.startsWith('annotationViewer.'))
        .sort(),
    );
    for (const k of added)
      equal(
        [...cat[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
        [...load('@/i18n/en').en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
      );
  }
  // Raw draft payload, same mounted viewer/session and callbacks across locale,
  // account object refresh, query object refresh and connectivity changes.
  let x = setup();
  equal(posts[0].args, [
    '/api/v1/canvadoc_session',
    { submission_attempt: 'draft', submission_id: 'sub' },
  ]);
  let tree = await succeed(x.screen);
  const browser = viewer(tree).onOpenInBrowser,
    back = done(tree);
  for (const lang of ['en', 'fr', 'ar']) {
    const t = view(lang);
    query = { ...query, data: { ...query.data, unrelated: lang } };
    setEnvironment({ account: { id: 'A', name: lang }, online: false });
    tree = x.screen.render();
    assert.equal(title(tree), t('annotationViewer.annotate'));
    assert.equal(viewer(tree).url, new URL(rawURL).toString());
    assert.equal(viewer(tree).title, 'DocViewer');
    assert.ok(h.textOf(tree).includes(t('annotationViewer.saveNote')));
    assert.ok(h.textOf(tree).includes(t('annotationViewer.done')));
    assert.equal(posts.length, 1);
    assert.equal(gets.length, 0);
  }
  allow('back');
  back();
  const opening = browser();
  equal(gets[0].args, [
    '/api/v1/login/session_token',
    { return_to: 'https://canvas.test/courses/c/assignments/a?raw=%2F' },
  ]);
  allow('openBrowser');
  gets[0].resolve({ session_url: rawURL });
  await opening;
  equal(calls.at(-1), ['openBrowser', rawURL]);
  x.screen.unmount();
  back();
  await browser();

  x = setup(Annotate, { attempt: '1234' });
  tree = await succeed(x.screen);
  equal(posts[0].args[1], { submission_attempt: '1234', submission_id: 'sub' });
  for (const lang of ['en', 'fr', 'ar']) {
    const t = view(lang);
    tree = x.screen.render();
    assert.equal(
      title(tree),
      t('annotationViewer.attemptTitle', { attempt: new Intl.NumberFormat(lang).format(1234) }),
    );
    assert.equal(done(tree), undefined);
    assert.equal(viewer(tree).url, new URL(rawURL).toString());
  }
  assert.equal(posts.length, 1);
  x.screen.unmount();
  for (const attempt of [
    '',
    '0',
    '-1',
    '1.5',
    'NaN',
    'Infinity',
    '9007199254740992',
    ' 1',
    '1e2',
    '0x1',
    null,
    [],
    ['1'],
    'draft',
  ]) {
    x = setup(Annotate, { attempt });
    for (const lang of ['en', 'fr', 'ar']) {
      const t = view(lang);
      tree = x.screen.render();
      assert.equal(empty(tree).description, t('annotationViewer.invalidAttempt'));
      assert.equal(viewer(tree), undefined);
      assert.equal(done(tree), undefined);
    }
    assert.equal(posts.length, 0);
    setEnvironment({ online: false });
    allow('back');
    empty(tree).action.onPress();
    x.screen.unmount();
  }
  for (const attempt of ['1', '01', '9007199254740991']) {
    x = setup(Annotate, { attempt });
    equal(posts[0].args[1].submission_attempt, String(Number(attempt)));
    x.screen.unmount();
    posts[0].reject(null);
    await flush();
  }
  // Stable reasons relabel without retrying, including non-Error rejections.
  for (const [error, key] of [
    [new mocks['@/canvas/client'].CanvasNetworkError('attempts'), 'network'],
    [new Error('No ATTEMPTS remain'), 'attemptsUsed'],
    [null, 'sessionFailed'],
    [{ message: 5 }, 'sessionFailed'],
    ['attempts', 'sessionFailed'],
    [new Error('essais'), 'sessionFailed'],
  ]) {
    x = setup();
    tree = await fail(x.screen, error);
    for (const lang of ['en', 'fr', 'ar']) {
      const t = view(lang);
      tree = x.screen.render();
      assert.equal(empty(tree).description, t('annotationViewer.' + key));
    }
    const retry = empty(tree).action.onPress;
    retry();
    retry();
    assert.equal(posts.length, 2);
    tree = await succeed(x.screen);
    assert.equal(viewer(tree).url, new URL(rawURL).toString());
    retry();
    assert.equal(posts.length, 2);
    x.screen.unmount();
  }
  // Pending/error/no-submission query branches and synchronous refetch claims.
  for (const kind of ['pending', 'error', 'missing']) {
    x = setup(Annotate, { attempt: '0' }); // Start without a session side effect.
    delete params.attempt;
    query = {
      ...query,
      data: kind === 'missing' ? { submission: null } : undefined,
      isSuccess: kind === 'missing',
      isError: kind === 'error',
    };
    tree = x.screen.render();
    assert.equal(posts.length, 0);
    if (kind === 'pending') assert.equal(all(tree, 'DetailSkeleton').length, 1);
    else {
      for (const lang of ['en', 'fr', 'ar']) {
        const t = view(lang);
        tree = x.screen.render();
        assert.equal(
          empty(tree).description,
          t('annotationViewer.' + (kind === 'error' ? 'assignmentFailed' : 'noSubmission')),
        );
      }
      const d = deferred();
      allow('refetch', d.promise);
      const retry = empty(tree).action.onPress;
      retry();
      retry();
      d.reject(new Error('offline'));
      await flush();
      allow('refetch', Promise.resolve());
      retry();
      await flush();
    }
    query = { ...query, data: { submission: { id: 'sub' } }, isError: false, isSuccess: true };
    x.screen.render();
    assert.equal(posts.length, 1);
    await succeed(x.screen);
    x.screen.unmount();
  }
  // Query success may render before refetch's promise settles. Its claim must
  // not block the now-eligible initial session on the same submission context.
  x = setup(Annotate, { attempt: '0' });
  delete params.attempt;
  query = { ...query, isError: true };
  tree = x.screen.render();
  assert.equal(posts.length, 0);
  const refreshing = deferred();
  allow('refetch', refreshing.promise);
  empty(tree).action.onPress();
  empty(tree).action.onPress();
  query = { ...query, isError: false };
  x.screen.render();
  assert.equal(posts.length, 1);
  refreshing.resolve();
  await flush();
  await succeed(x.screen);
  x.screen.unmount();

  // Late requests cannot populate a replacement target; first replacement render
  // has no previous viewer, and both resolve and reject are inert after unmount.
  const transitions = {
    account: () => setEnvironment({ account: { id: 'B' } }),
    client: () => setEnvironment({ client: client('B') }),
    course: () => {
      params = { ...params, courseId: 'other' };
    },
    assignment: () => {
      params = { ...params, assignmentId: 'other' };
    },
    submission: () => {
      query = { ...query, data: { ...query.data, submission: { id: 'other' } } };
    },
    attempt: () => {
      params = { ...params, attempt: '2' };
    },
  };
  for (const change of Object.values(transitions))
    for (const reject of [false, true]) {
      x = setup();
      change();
      assert.equal(viewer(x.screen.renderOnly()), undefined);
      x.screen.commit();
      x.screen.render();
      assert.equal(posts.length, 2);
      tree = await fail(x.screen, new Error('retry me'), 1);
      empty(tree).action.onPress();
      assert.equal(posts.length, 3);
      tree = await succeed(x.screen, 2, 'https://signed.test/new');
      if (reject) posts[0].reject(new Error('old attempts'));
      else posts[0].resolve({ canvadocs_session_url: rawURL });
      await flush();
      tree = x.screen.render();
      assert.equal(viewer(tree).url, 'https://signed.test/new');
      x.screen.unmount();
    }
  for (const reject of [false, true]) {
    x = setup();
    x.screen.unmount();
    if (reject) posts[0].reject({ message: 'attempts' });
    else posts[0].resolve({ canvadocs_session_url: rawURL });
    await flush();
  }
  // Retained successful-source/browser/navigation callbacks and delayed URL responses.
  for (const [name, change] of [
    ...Object.entries(transitions),
    ['unmount', () => x.screen.unmount()],
  ]) {
    x = setup();
    tree = await succeed(x.screen);
    const oldBrowser = viewer(tree).onOpenInBrowser,
      oldBack = done(tree);
    const pending = oldBrowser();
    change();
    if (name !== 'unmount') {
      assert.equal(viewer(x.screen.renderOnly()), undefined);
      x.screen.commit();
      x.screen.render();
    }
    gets[0].resolve({ session_url: rawURL });
    await pending;
    const count = gets.length;
    await oldBrowser();
    oldBack();
    assert.equal(gets.length, count);
    if (name !== 'unmount') x.screen.unmount();
  }
  // Feedback: untouched signed URL and raw title; no URL lookup on render/locale.
  for (const rawTitle of [undefined, '', 'عنوان خام']) {
    x = setup(Feedback, { url: rawURL, title: rawTitle, canvasUrl: '/raw' });
    const source = preview(x.tree);
    for (const lang of ['en', 'fr', 'ar']) {
      const t = view(lang);
      setEnvironment({ online: false });
      tree = x.screen.render();
      assert.equal(title(tree), rawTitle ?? t('annotationViewer.feedback'));
      assert.equal(preview(tree).title, rawTitle ?? t('annotationViewer.document'));
      assert.equal(preview(tree).url, rawURL);
      assert.equal(gets.length, 0);
      assert.equal(posts.length, 0);
    }
    source.onError();
    for (const lang of ['en', 'fr', 'ar']) {
      const t = view(lang);
      tree = x.screen.render();
      assert.equal(empty(tree).description, t('annotationViewer.previewHelp'));
      assert.equal(empty(tree).action.label, t('annotationViewer.browser'));
    }
    const oldBrowser = empty(tree).action.onPress;
    const pending = oldBrowser();
    params = feedbackParams({ ...feedbackRaw, url: 'https://signed.test/new' });
    tree = x.screen.render();
    source.onError();
    assert.equal(preview(x.screen.render()).url, feedbackRaw.url);
    gets[0].resolve({ session_url: rawURL });
    await pending;
    await oldBrowser();
    assert.equal(gets.length, 1);
    x.screen.unmount();
    source.onError();
  }
  for (const change of [transitions.account, transitions.client]) {
    x = setup(Feedback, { url: rawURL, canvasUrl: '/raw' });
    const old = preview(x.tree);
    old.onError();
    tree = x.screen.render();
    const staleBrowser = empty(tree).action.onPress,
      pending = staleBrowser();
    change();
    tree = x.screen.renderOnly();
    assert.equal(preview(tree), undefined);
    x.screen.commit();
    tree = x.screen.render();
    gets[0].resolve({ session_url: rawURL });
    await pending;
    await staleBrowser();
    old.onError();
    const staleBack = empty(tree).action.onPress;
    for (const lang of ['en', 'fr', 'ar']) {
      const t = view(lang);
      setEnvironment({ online: false });
      tree = x.screen.render();
      assert.equal(empty(tree).description, t('annotationViewer.expiredHelp'));
      allow('back');
      empty(tree).action.onPress();
    }
    // Changing the document or returning to the original account cannot restore provenance.
    params = { ...params, url: 'https://signed.test/replaced' };
    x.screen.render();
    staleBack();
    setEnvironment({ account: { id: 'A' } });
    tree = x.screen.render();
    assert.equal(preview(tree), undefined);
    canGoBack = false;
    allow('replace');
    empty(tree).action.onPress();
    equal(calls.at(-1), [
      'replace',
      {
        pathname: '/course/[courseId]/assignment/[assignmentId]',
        params: { courseId: 'c', assignmentId: 'a' },
      },
    ]);
    x.screen.unmount();
    empty(tree).action.onPress();
  }
  x = setup(Feedback, { url: rawURL, canvasUrl: '/raw' });
  preview(x.tree).onError();
  tree = x.screen.render();
  const pending = empty(tree).action.onPress();
  gets[0].reject(new Error('school blocks session tokens'));
  allow('openBrowser');
  await pending;
  equal(calls.at(-1), ['openBrowser', 'https://canvas.test/raw']);
  x.screen.unmount();
  x = setup(Feedback);
  setEnvironment({ online: false });
  allow('back');
  empty(x.tree).action.onPress();
  x.screen.unmount();
  // Restoring old raw parameters without the live producer capability fails
  // before even the first preview render, including a retained previous title.
  x = setup(Feedback);
  x.screen.unmount();
  params = {
    courseId: 'c',
    assignmentId: 'a',
    url: rawURL,
    title: 'Prior account title',
    canvasUrl: '/raw',
  };
  const restored = mount(Feedback);
  const firstRestored = restored.renderOnly();
  assert.equal(preview(firstRestored), undefined);
  assert.equal(title(firstRestored), view('en')('annotationViewer.feedback'));
  restored.commit();
  assert.equal(preview(restored.render()), undefined);
  assert.equal(gets.length, 0);
  assert.equal(posts.length, 0);
  restored.unmount();
  // Only committed renders own side effects. A discarded replacement neither
  // requests a session nor revokes the real committed target's callbacks.
  x = setup();
  tree = await succeed(x.screen);
  const retainedBack = done(tree),
    committedParams = params;
  params = { ...params, attempt: 'bad' };
  const abandonedBack = empty(x.screen.renderOnly()).action.onPress;
  abandonedBack();
  assert.equal(posts.length, 1);
  x.screen.abandon();
  params = committedParams;
  allow('back');
  retainedBack();
  tree = x.screen.render();
  assert.equal(viewer(tree).url, new URL(rawURL).toString());
  x.screen.replayEffects();
  assert.equal(posts.length, 1);
  x.screen.unmount();
  x = setup();
  x.screen.replayEffects();
  assert.equal(posts.length, 1);
  tree = await fail(x.screen, new Error('failed'));
  empty(tree).action.onPress();
  x.screen.replayEffects();
  assert.equal(posts.length, 2);
  await succeed(x.screen);
  x.screen.unmount();

  x = setup(Feedback, { url: rawURL, canvasUrl: '/raw' });
  const committedError = preview(x.tree).onError;
  const identity = h.environment();
  setEnvironment({ account: { id: 'B' } });
  const abandonedReturn = empty(x.screen.renderOnly()).action.onPress;
  abandonedReturn();
  x.screen.abandon();
  setEnvironment(identity);
  tree = x.screen.render();
  assert.equal(preview(tree).url, rawURL);
  const original = params;
  params = feedbackParams({ ...feedbackRaw, url: 'https://signed.test/abandoned' });
  const discardedError = preview(x.screen.renderOnly()).onError;
  discardedError();
  x.screen.abandon();
  params = original;
  assert.equal(preview(x.screen.render()).url, rawURL);
  committedError();
  assert.ok(empty(x.screen.render()));
  x.screen.unmount();

  // Every feedback document/route parameter owns its own failure and callbacks.
  for (const patch of [
    { courseId: 'next' },
    { assignmentId: 'next' },
    { title: '' },
    { canvasUrl: '/next' },
  ]) {
    x = setup(Feedback, { url: rawURL, canvasUrl: '/raw' });
    const error = preview(x.tree).onError;
    error();
    tree = x.screen.render();
    const stale = empty(tree).action.onPress,
      waiting = stale();
    params = feedbackParams({ ...feedbackRaw, ...patch });
    tree = x.screen.render();
    assert.equal(preview(tree).url, rawURL);
    error();
    assert.ok(preview(x.screen.render()));
    gets[0].resolve({ session_url: rawURL });
    await waiting;
    await stale();
    assert.equal(gets.length, 1);
    x.screen.unmount();
  }
  // A same-submission browser target change cancels only the old browser action,
  // and retains the already loaded annotation session.
  x = setup();
  tree = await succeed(x.screen);
  const oldOpen = viewer(tree).onOpenInBrowser,
    waiting = oldOpen();
  query = { ...query, data: { ...query.data, htmlUrl: '/replacement' } };
  tree = x.screen.render();
  assert.equal(posts.length, 1);
  assert.ok(viewer(tree));
  gets[0].resolve({ session_url: rawURL });
  await waiting;
  await oldOpen();
  assert.equal(gets.length, 1);
  x.screen.unmount();

  // Execute the unchanged real DocViewerPreview at explicit WebView/link/native
  // boundaries as well: signed source identity/auth headers survive locale-only
  // renders. This does not render a WebView or establish browser authentication.
  delete mocks['@/features/files/previews/WebPreviews'];
  allowed.add('features/files/previews/WebPreviews');
  mocks['@/features/files/previews/presentation'] = {
    pdfPresentation: boundary('unusedPdf'),
    pdfPresentationScript: boundary('unusedPdfScript'),
  };
  mocks['react-native-webview'] = { WebView: 'WebView' };
  mocks['@/features/content/links'] = { openCanvasLink: boundary('unexpectedLink') };
  mocks['@/design'].useTheme = () => ({ colors: { bg: 'bg', fgMuted: 'muted' } });
  Object.assign(native, elements('ActivityIndicator'));
  const { DocViewerPreview } = load('@/features/files/previews/WebPreviews');
  const authHeaders = { Authorization: 'synthetic-only' };
  setEnvironment({ account: { id: 'A', host: 'signed.test' }, client: { authHeaders } });
  const props = { url: rawURL, title: '', onError: boundary('previewError') };
  const previewMount = mount(() => DocViewerPreview(props));
  let source;
  for (const lang of ['en', 'fr', 'ar']) {
    view(lang);
    tree = previewMount.render();
    const web = all(tree, 'WebView')[0].props;
    if (source) assert.equal(web.source, source);
    source = web.source;
    assert.equal(source.uri, rawURL);
    assert.equal(source.headers, authHeaders);
    assert.equal(web.accessibilityLabel, '');
    assert.equal(web.sharedCookiesEnabled, true);
    assert.equal(web.setSupportMultipleWindows, false);
  }
  let web = all(tree, 'WebView')[0].props;
  web.onHttpError({ nativeEvent: { statusCode: 200 } });
  allow('previewError');
  web.onHttpError({ nativeEvent: { statusCode: 400 } });
  props.url = 'https://external.test/signed?raw=%2F';
  tree = previewMount.render();
  web = all(tree, 'WebView')[0].props;
  assert.equal(web.source.uri, props.url);
  assert.equal(web.source.headers, undefined);
  previewMount.unmount();
  h.verifyBoundaries();
  console.log(
    'annotation-viewers: production routes/API/browser adapter, frozen catalogs and synthetic lifetime checks passed (' +
      process.env.TZ +
      ')',
  );
}
if (require.main === module)
  run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });

module.exports = {
  h,
  mount,
  Parts,
  Feedback,
  registry,
  setup,
  preview,
  empty,
  title,
  client,
  feedbackParams,
  setParams: (p) => {
    params = p;
  },
  getParams: () => params,
  getGets: () => gets,
  setBack: (value) => {
    canGoBack = value;
  },
};
