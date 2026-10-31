// Actual production presentation, producer, registry and route; synthetic hook
// commits and explicit native/query/browser/router boundaries, not native/Compiler tests.
const assert = require('node:assert/strict');
const a = require('./annotation-viewers.check.cjs');
const { h, mount, Parts, Feedback, registry, preview, empty, title, setParams } = a;
const { load, all, nodes, textOf, view, allow, equal, setEnvironment, flush } = h;
Object.assign(h.native, { Pressable: 'Pressable' });
const baseline = require('./submission-feedback.baseline.json');
const raw = 'https://signed.test/وثيقة?signature=a%2Fb&empty=';
const file = (patch = {}) => ({
  id: 'file',
  display_name: '',
  preview_url: raw,
  url: 'raw/file',
  'content-type': 'application/pdf',
  ...patch,
});
function source(patch = {}, assignmentPatch = {}) {
  let props = {
    assignment: { ...h.assignment(), ...assignmentPatch },
    attempt: {
      attempt: 2,
      type: 'online_upload',
      body: '',
      url: '',
      attachments: [file()],
      discussionEntries: [],
      ...patch,
    },
  };
  const screen = mount(() => Parts.AttemptContent(props));
  return {
    screen,
    tree: screen.render(),
    props: () => props,
    update(next) {
      props = next;
      return screen.render();
    },
    stage(next) {
      props = next;
      return screen.renderOnly();
    },
  };
}
function push(tree) {
  let params;
  allow('push', (target) => {
    params = target.params;
  });
  all(tree, 'ListItem')[0].props.onPress();
  assert.equal(typeof params.launch, 'string');
  equal(Object.keys(params).sort(), ['assignmentId', 'courseId', 'launch']);
  return params;
}
function start(params) {
  setParams(params);
  const screen = mount(Feedback);
  return { screen, tree: screen.render() };
}
function reset() {
  a.setup().screen.unmount();
}
const labels = (tree) =>
  nodes(tree)
    .map((n) => n.props?.accessibilityLabel)
    .filter((v) => v !== undefined);
async function run() {
  for (const lang of ['en', 'fr', 'ar']) {
    const cat = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 1954);
    for (const [k, v] of Object.entries(baseline.catalogs[lang])) equal(cat[k], v);
    // Freeze this slice while allowing unrelated namespaces to grow.
    assert.ok(Object.keys(cat).length >= 1991);
    assert.equal(
      Object.keys(cat).filter((key) => key.startsWith('submissionFeedback.')).length,
      37,
    );
  }
  reset();
  // Every submission branch and raw payload survives same-instance locale changes.
  for (const [patch, key] of [
    [{ type: 'online_text_entry' }, 'noText'],
    [{ attachments: [] }, 'noFiles'],
    [{ type: 'media_recording' }, 'media'],
    [{ type: 'online_quiz' }, 'quiz'],
    [{ type: 'discussion_topic', discussionEntries: ['', '<p>نص خام</p>'] }, 'discussion'],
    [{ type: 'basic_lti_launch' }, 'tool'],
    [{ type: 'basic_lti_launch', url: 'https://www.example.com/a?x=1' }, 'picked'],
    [{ type: 'student_annotation' }, 'annotations'],
    [{ type: 'unknown' }, 'unsupported'],
  ]) {
    const p = source(patch);
    for (const lang of ['en', 'fr', 'ar']) {
      const t = view(lang),
        tree = p.screen.render();
      assert.ok(
        textOf(tree).includes(t('submissionFeedback.' + key)) ||
          all(tree, 'ListItem').some((n) => n.props.title === t('submissionFeedback.' + key)),
      );
      if (patch.discussionEntries)
        equal(
          all(tree, 'RichContent').map((n) => n.props.html),
          patch.discussionEntries,
        );
    }
    p.screen.unmount();
  }
  for (const html of ['<p dir="rtl">العربية &amp; raw</p>', ' ']) {
    const p = source({ type: 'online_text_entry', body: html });
    assert.equal(all(p.tree, 'RichContent')[0].props.html, html);
    p.screen.unmount();
  }
  for (const url of [
    'https://www.example.com/مسار?raw=%2f',
    'not a URL',
    'https://www.example.com/',
  ]) {
    const p = source({ type: 'online_url', url });
    allow('openBrowser', Promise.resolve());
    all(p.tree, 'ListItem')[0].props.onPress();
    equal(h.calls.at(-1), ['openBrowser', url]);
    p.screen.unmount();
    all(p.tree, 'ListItem')[0].props.onPress();
  }
  const noUrl = source({ type: 'online_url', url: '' });
  assert.equal(noUrl.tree, null);
  noUrl.screen.unmount();
  for (const kind of ['audio', 'video'])
    for (const mediaTitle of [undefined, null, '', 'عنوان']) {
      const p = source({ type: 'media_recording', media: { kind, url: raw, title: mediaTitle } });
      for (const lang of ['en', 'fr', 'ar']) {
        const t = view(lang),
          media = all(p.screen.render(), 'MediaPlayer')[0].props;
        assert.equal(
          media.title,
          mediaTitle ?? t('submissionFeedback.' + (kind === 'audio' ? 'audio' : 'video')),
        );
        assert.equal(media.url, raw);
        assert.equal(media.kind, kind);
      }
      p.screen.unmount();
    }
  const mediaFiles = [
    file(),
    file({ id: 'audio', display_name: 'voice.m4a', 'content-type': 'audio/mp4' }),
    file({ id: 'video', display_name: 'raw.mp4', 'content-type': 'video/mp4' }),
  ];
  let p = source({ attachments: mediaFiles });
  equal(all(p.tree, 'AttachmentList')[0].props.attachments, mediaFiles);
  assert.equal(all(p.tree, 'ListItem').length, 1);
  p.screen.unmount();
  // Existing routing and tool payload decisions, including raw empty titles.
  for (const kind of ['quiz', 'discussion', 'assignment']) {
    p = source(
      { type: kind === 'discussion' ? 'discussion_topic' : 'online_quiz' },
      { kind, quizId: 'q', discussionTopicId: 'd' },
    );
    allow('push');
    all(p.tree, 'ListItem')[0].props.onPress();
    assert.equal(
      h.calls.at(-1)[1].pathname,
      kind === 'quiz'
        ? '/course/[courseId]/quiz/[quizId]'
        : kind === 'discussion'
          ? '/course/[courseId]/discussion/[topicId]'
          : '/course/[courseId]/assignment/[assignmentId]',
    );
    p.screen.unmount();
  }
  for (const picked of [true, false]) {
    p = source(
      { type: 'basic_lti_launch', url: raw, externalToolUrl: '' },
      { kind: picked ? 'assignment' : 'external_tool', name: '' },
    );
    allow('launchTool');
    all(p.tree, 'ListItem')[0].props.onPress();
    equal(h.calls.at(-1), [
      'launchTool',
      picked
        ? { courseId: 'c', url: raw, title: '', fallbackUrl: p.props().assignment.htmlUrl }
        : {
            courseId: 'c',
            assignmentId: 'a',
            launchType: 'assessment',
            url: '',
            title: '',
            fallbackUrl: p.props().assignment.htmlUrl,
          },
    ]);
    p.screen.unmount();
  }
  p = source({ type: 'student_annotation' });
  allow('push');
  all(p.tree, 'ListItem')[0].props.onPress();
  equal(h.calls.at(-1)[1].params, { courseId: 'c', assignmentId: 'a', attempt: '2' });
  p.screen.unmount();
  // Rubric maths, legacy rounding, hidden quantitative data, stable expansion.
  const number = load('@/features/submissions/feedbackPresentation').feedbackNumber;
  for (const n of [0, -0, 1, 1.005, 2.675, -1.005, -0.001, 1000.129, 1.999]) {
    const old = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
    assert.equal(number(n, 'en'), old);
    assert.equal(
      number(n, 'fr'),
      new Intl.NumberFormat('fr', { useGrouping: false, maximumFractionDigits: 2 }).format(
        Number(old),
      ),
    );
  }
  const criterion = {
    id: 'c',
    description: 'وصف خام',
    longDescription: '',
    points: 2.675,
    ignoreForScoring: false,
    ratings: [
      { id: 'r', description: '', longDescription: 'تفصيل', points: 1.005 },
      { id: 'other', description: 'Other raw', longDescription: '', points: 2.675 },
    ],
  };
  const assessment = {
    c: { ratingId: 'r', points: 1.005, comments: 'تعليق خام' },
    ignored: { points: 99999 },
  };
  for (const hidePoints of [false, true])
    for (const hideTotal of [false, true]) {
      const r = mount(() =>
        Parts.RubricView({
          criteria: [
            criterion,
            { ...criterion, id: 'ignored', points: 99999, ignoreForScoring: true },
          ],
          assessment,
          hidePoints,
          hideTotal,
        }),
      );
      for (const lang of ['en', 'fr', 'ar']) {
        const t = view(lang),
          tree = r.render();
        const totalLabel = t('submissionFeedback.totalLabel', {
          earned: number(1.005, lang),
          total: number(2.675, lang),
        });
        assert.equal(labels(tree).includes(totalLabel), !hidePoints && !hideTotal);
        const children = nodes(tree).filter((n) => typeof n.type === 'function');
        const ignored = mount(() => children[1].type(children[1].props));
        const ignoredTree = ignored.render();
        assert.ok(textOf(ignoredTree).includes(t('submissionFeedback.notScored')));
        assert.ok(labels(ignoredTree).some((v) => v.includes(t('submissionFeedback.notScored'))));
        if (hidePoints)
          assert.ok(labels(ignoredTree).every((v) => !v.includes(number(99999, lang))));
        ignored.unmount();
        const c = mount(() => children[0].type(children[0].props));
        let ct = c.render();
        assert.ok(labels(ct).some((v) => v.includes('وصف خام')));
        assert.ok(
          labels(ct).includes(t('submissionFeedback.instructor', { comment: 'تعليق خام' })),
        );
        if (hidePoints) assert.ok(labels(ct).every((v) => !v.includes(number(2.675, lang))));
        else
          assert.ok(
            labels(ct).some((v) =>
              v.includes(
                t('submissionFeedback.score', {
                  description: 'وصف خام',
                  earned: number(1.005, lang),
                  total: number(2.675, lang),
                }),
              ),
            ),
          );
        const button = all(ct, 'Pressable')[0].props;
        button.onPress();
        ct = c.render();
        assert.equal(all(ct, 'Pressable')[0].props.accessibilityState.expanded, true);
        view(lang === 'ar' ? 'fr' : 'ar');
        ct = c.render();
        assert.equal(all(ct, 'Pressable')[0].props.accessibilityState.expanded, true);
        assert.ok(textOf(ct).includes('Other raw'));
        c.unmount();
      }
      r.unmount();
    }
  const ungraded = mount(() =>
    Parts.RubricView({ criteria: [criterion], assessment: null, hidePoints: false }),
  );
  assert.equal(labels(ungraded.render()).length, 0);
  const ungradedNode = nodes(ungraded.render()).find((n) => typeof n.type === 'function');
  const ungradedCriterion = mount(() => ungradedNode.type(ungradedNode.props));
  const ungradedTranslator = view('fr');
  assert.ok(
    textOf(ungradedCriterion.render()).includes(
      ungradedTranslator('submissionFeedback.points', { value: number(2.675, 'fr') }),
    ),
  );
  ungradedCriterion.unmount();
  ungraded.unmount();
  // Canvas timezone + explicit locale; raw comment/attachment/media boundaries.
  const dates = load('@/lib/dates');
  const comment = {
    id: '1',
    authorId: 'self',
    authorName: 'اسم',
    authorAvatarUrl: '',
    createdAt: new Date('2024-01-01T00:30:00Z'),
    attempt: 1234,
    text: '',
    media: { kind: 'audio', url: raw },
    attachments: mediaFiles,
  };
  const cm = mount(() =>
    Parts.CommentList({
      comments: [
        comment,
        {
          ...comment,
          id: '2',
          authorId: 'other',
          text: 'تعليق',
          media: { kind: 'video', url: raw },
        },
      ],
      courseId: 'c',
      showAttempt: true,
      selfId: 'self',
    }),
  );
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo'])
    for (const lang of ['en', 'fr', 'ar']) {
      dates.setDisplayTimeZone(zone);
      const t = view(lang),
        tree = cm.render(),
        dc = dates.createDateContext(lang, zone);
      const date = t('date.at', {
        day: dc.formatShortDate(comment.createdAt),
        time: dc.formatTime(comment.createdAt),
      });
      assert.ok(
        textOf(tree).includes(t('submissionFeedback.attemptDate', { date, attempt: 1234 })),
      );
      assert.ok(textOf(tree).includes(t('submissionFeedback.you')));
      assert.ok(textOf(tree).includes('اسم'));
      equal(
        all(tree, 'MediaPlayer')
          .slice(0, 3)
          .map((n) => n.props.title),
        [
          t('submissionFeedback.audioComment'),
          t('submissionFeedback.voiceComment'),
          t('submissionFeedback.videoComment'),
        ],
      );
      assert.equal(all(tree, 'AttachmentList')[0].props.attachments[0].display_name, '');
    }
  cm.unmount();
  for (const showAttempt of [true, false]) {
    const c = mount(() =>
      Parts.CommentList({
        comments: [{ ...comment, attempt: 0, media: null, attachments: [] }],
        courseId: 'c',
        showAttempt,
      }),
    );
    const tree = c.render();
    assert.equal(all(tree, 'MediaPlayer').length, 0);
    assert.equal(all(tree, 'AttachmentList').length, 0);
    assert.ok(
      !textOf(tree).includes(
        view('ar')('submissionFeedback.attemptDate', { date: '', attempt: 0 }),
      ),
    );
    c.unmount();
  }
  // Real producer -> first route mount. Discarded producers cannot publish.
  reset();
  p = source();
  const committed = p.props();
  const before = registry.feedbackRevision();
  const discarded = p.stage({ ...committed, attempt: { ...committed.attempt, attempt: 99 } });
  all(discarded, 'ListItem')[0].props.onPress();
  assert.equal(registry.feedbackRevision(), before);
  p.screen.abandon();
  p.update(committed);
  let params = push(p.tree);
  setParams(params);
  let v = mount(Feedback);
  assert.equal(preview(v.renderOnly()).url, raw);
  v.abandon();
  assert.equal(registry.feedbackRevision(), before + 1);
  v = mount(Feedback);
  let tree = v.render();
  assert.equal(preview(tree).url, raw);
  assert.equal(title(tree), '');
  const error = preview(tree).onError;
  for (const lang of ['en', 'fr', 'ar']) {
    view(lang);
    setParams({ ...params });
    assert.equal(preview(v.render()).url, raw);
  }
  p.screen.unmount();
  all(p.tree, 'ListItem')[0].props.onPress();
  assert.equal(preview(v.render()).url, raw);
  v.replayEffects();
  await flush();
  assert.equal(preview(v.render()).url, raw);
  // Duplicate mounts cannot claim or dispose the original viewer's token.
  const duplicate = start(params);
  assert.equal(preview(duplicate.tree), undefined);
  duplicate.screen.unmount();
  await flush();
  assert.equal(preview(v.render()).url, raw);
  error();
  tree = v.render();
  const pending = empty(tree).action.onPress();
  v.unmount();
  a.getGets()[0].resolve({ session_url: raw });
  await pending;
  error();
  await flush();
  let replay = start(params);
  assert.equal(preview(replay.tree), undefined);
  replay.screen.unmount();
  p = source();
  params = push(p.tree);
  v = start(params).screen;
  assert.equal(preview(v.render()).url, raw);
  v.unmount();
  p.screen.unmount();
  await flush();
  // Pre-mount switches, unknown/restored tokens and every payload/route tamper.
  for (const patch of [
    { launch: undefined },
    { launch: 'forged' },
    { launch: ['x'] },
    { courseId: 'other' },
    { assignmentId: 'other' },
    { url: raw },
    { title: '' },
    { canvasUrl: '/other' },
    { attempt: '3' },
    { fileId: 'other' },
  ]) {
    reset();
    p = source();
    params = push(p.tree);
    p.screen.unmount();
    setParams({ ...params, ...patch });
    const badScreen = mount(Feedback);
    assert.equal(preview(badScreen.renderOnly()), undefined);
    badScreen.commit();
    const bad = { screen: badScreen, tree: badScreen.render() };
    assert.equal(preview(bad.tree), undefined);
    assert.equal(title(bad.tree), view('en')('annotationViewer.feedback'));
    setEnvironment({ online: false });
    allow('back');
    empty(bad.tree).action.onPress();
    bad.screen.unmount();
    registry.revokeFeedback(params.launch);
    await flush();
  }
  for (const change of [
    () => setEnvironment({ account: { id: 'B' } }),
    () => setEnvironment({ client: a.client('new') }),
  ]) {
    reset();
    p = source();
    params = push(p.tree);
    change();
    let bad = start(params);
    assert.equal(preview(bad.tree), undefined);
    bad.screen.unmount();
    p.screen.unmount();
    registry.revokeFeedback(params.launch);
  }
  // Committed source account/client/course/assignment/attempt/document changes
  // revoke already-issued launches and all retained actions; equivalent data does not.
  const changes = [
    (p) => {
      setEnvironment({ account: { id: 'B' } });
      return p.props();
    },
    (p) => {
      setEnvironment({ client: a.client('new') });
      return p.props();
    },
    ...['courseId', 'id', 'htmlUrl', 'name'].map((k) => (p) => ({
      ...p.props(),
      assignment: { ...p.props().assignment, [k]: 'new' },
    })),
    (p) => ({ ...p.props(), attempt: { ...p.props().attempt, attempt: 3 } }),
    ...['preview_url', 'display_name', 'id'].map((k) => (p) => ({
      ...p.props(),
      attempt: { ...p.props().attempt, attachments: [file({ [k]: 'new' })] },
    })),
  ];
  for (const change of changes) {
    reset();
    p = source();
    params = push(p.tree);
    const route = start(params);
    assert.ok(preview(route.tree));
    p.update({
      ...p.props(),
      assignment: { ...p.props().assignment },
      attempt: { ...p.props().attempt },
    });
    assert.ok(preview(route.screen.render()));
    p.update(change(p));
    all(p.tree, 'ListItem')[0].props.onPress();
    assert.equal(preview(route.screen.render()), undefined);
    route.screen.unmount();
    p.screen.unmount();
    await flush();
  }
  // All retained launch actions have the same source guard, including delayed
  // signed-browser results; local quiz/discussion/annotation navigation stays offline.
  for (const type of [
    'online_url',
    'media_recording',
    'online_quiz',
    'discussion_topic',
    'basic_lti_launch',
    'student_annotation',
  ]) {
    reset();
    p = source({ type, url: raw });
    const old = all(p.tree, 'ListItem')[0].props.onPress;
    p.update({ ...p.props(), attempt: { ...p.props().attempt, attempt: 3 } });
    old();
    p.screen.unmount();
    old();
  }
  reset();
  p = source({ type: 'media_recording' });
  const pendingMedia = all(p.tree, 'ListItem')[0].props.onPress();
  p.screen.unmount();
  a.getGets()[0].resolve({ session_url: raw });
  await pendingMedia;
  for (const type of ['online_quiz', 'discussion_topic', 'student_annotation']) {
    reset();
    setEnvironment({ online: false });
    p = source({ type });
    allow('push');
    all(p.tree, 'ListItem')[0].props.onPress();
    p.screen.unmount();
  }
  // A source revocation cancels an awaiting browser fallback even while the
  // route's account/params remain identical. It cannot open a replacement URL.
  reset();
  p = source();
  params = push(p.tree);
  const revocable = start(params);
  preview(revocable.tree).onError();
  const waiting = empty(revocable.screen.render()).action.onPress();
  p.update({ ...p.props(), attempt: { ...p.props().attempt, attempt: 3 } });
  a.getGets()[0].resolve({ session_url: raw });
  await waiting;
  assert.equal(preview(revocable.screen.render()), undefined);
  revocable.screen.unmount();
  p.screen.unmount();
  await flush();
  // Replacing a route token with another active viewer's token cannot commandeer
  // or revoke that viewer, including after cleanup of the rejected replacement.
  reset();
  p = source();
  const firstParams = push(p.tree),
    secondParams = push(p.tree);
  let leftParams = firstParams,
    rightParams = secondParams;
  const left = mount(() => {
    setParams(leftParams);
    return Feedback();
  });
  const right = mount(() => {
    setParams(rightParams);
    return Feedback();
  });
  assert.ok(preview(left.render()));
  assert.ok(preview(right.render()));
  leftParams = secondParams;
  assert.equal(preview(left.renderOnly()), undefined);
  left.commit();
  left.unmount();
  await flush();
  assert.equal(preview(right.render()).url, raw);
  right.unmount();
  p.screen.unmount();
  await flush();
  // Two speculative renders can authenticate the same pending launch without
  // consuming it. Only the first committed viewer wins; the other rechecks the
  // external-store snapshot and cannot release the winner's claim.
  reset();
  p = source();
  params = push(p.tree);
  setParams(params);
  const racingA = mount(Feedback),
    racingB = mount(Feedback);
  assert.ok(preview(racingA.renderOnly()));
  assert.ok(preview(racingB.renderOnly()));
  racingA.commit();
  racingB.commit();
  assert.ok(preview(racingA.render()));
  assert.equal(preview(racingB.render()), undefined);
  racingB.unmount();
  await flush();
  assert.ok(preview(racingA.render()));
  racingA.unmount();
  p.screen.unmount();
  await flush();
  // Registry cap, expiry, exact captured payload and exclusive claims. No timers
  // or persistence; expired pending entries are pruned by the next publication.
  await flush();
  reset();
  const owner = {
      accountId: 'A',
      client: h.environment().client,
      courseId: 'c',
      assignmentId: 'a',
    },
    src = {},
    doc = { attempt: 2, fileId: 'f', url: raw, title: '', canvasUrl: '' };
  const token = registry.beginFeedbackLaunch(src, () => true, owner, doc),
    claim = {};
  doc.url = 'changed';
  assert.equal(registry.claimFeedback(token, owner, claim), true);
  assert.equal(registry.feedbackDocument(token, owner, claim).url, raw);
  assert.equal(registry.feedbackDocument(token, owner, claim).attempt, 2);
  assert.equal(registry.feedbackDocument(token, owner, claim).fileId, 'f');
  assert.equal(registry.claimFeedback(token, owner, {}), false);
  registry.revokeFeedback(token, {});
  assert.ok(registry.feedbackDocument(token, owner, claim));
  registry.revokeFeedback(token, claim);
  const tokens = [];
  for (let i = 0; i < 65; i++) {
    const t = registry.beginFeedbackLaunch(src, () => true, owner, doc);
    if (t) tokens.push(t);
  }
  assert.ok(tokens.length <= 64 && tokens.length > 0);
  assert.equal(
    registry.beginFeedbackLaunch(src, () => true, owner, doc),
    null,
  );
  const realNow = Date.now;
  Date.now = () => realNow() + 6 * 60_000;
  try {
    assert.equal(registry.claimFeedback(tokens[0], owner, {}), false);
    const fresh = registry.beginFeedbackLaunch(src, () => true, owner, doc);
    assert.ok(fresh);
    registry.revokeFeedback(fresh);
  } finally {
    Date.now = realNow;
    for (const t of tokens) registry.revokeFeedback(t);
  }
  h.verifyBoundaries();
  console.log(
    'submission-feedback: production components, producer/route claims, catalogs and synthetic lifetimes passed (' +
      process.env.TZ +
      ')',
  );
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
