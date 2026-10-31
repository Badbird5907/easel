/* global __dirname */
// Production route + registry + form + picker. Synthetic committed React/native/IO
// boundaries are deliberately fail-closed; no network or school operations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const h = require('./submission-form.check.cjs');
const {
  mount,
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
  nodes,
  props,
  assignment,
  SubmitForm,
  deferred,
  flush,
  equal,
  setEnvironment,
  environment,
  alert,
} = h;
const root = path.resolve(__dirname, '../..');
const baseline = require('./tool-picker.baseline.json');
let params = {},
  downloads = [],
  dirs = [],
  uploadBatches = [],
  uploadEmission = () => {};
Object.assign(native, elements('ActivityIndicator'), {
  Platform: { OS: 'ios' },
  Linking: { openURL: boundary('link') },
});
mocks['lucide-react-native'] = {
  ...elements('CloudOff Clock Globe RotateCw CircleCheck ExternalLink FilePen Plus Puzzle X Users'),
};
mocks['expo-router'].useLocalSearchParams = () => params;
mocks['expo-router'].router.canGoBack = () => true;
mocks['expo-router/react-navigation'] = { useHeaderHeight: () => 20 };
Object.assign(mocks['@/design'], elements('EmptyState ProgressBar'), {
  useTheme: () => ({ colors: { bg: 'bg', fgMuted: 'muted' } }),
});
mocks['@/features/course/CourseScope'] = { CourseScope: 'CourseScope' };
mocks['expo-web-browser'] = { openBrowserAsync: boundary('browserPicker') };
mocks['react-native-webview'] = { WebView: 'WebView' };
mocks['@/features/web/PopupSheet'] = { PopupSheet: 'PopupSheet' };
Object.assign(mocks['@/features/content/browser'], {
  sessionUrl: boundary('session'),
  openSignedIn: boundary('browserPicker'),
});
mocks['expo-file-system'] = {
  Paths: { cache: 'file:///cache' },
  Directory: class {
    constructor(...parts) {
      this.uri = parts.join('/');
      dirs.push(this);
    }
    create(options) {
      equal(options, { intermediates: true });
      this.created = true;
    }
    delete() {
      assert.ok(this.created);
      this.deleted = true;
    }
  },
  File: class {
    static downloadFileAsync(url, dir, options) {
      equal(options, { idempotent: true });
      assert.ok(dir.created);
      const d = deferred();
      downloads.push({ ...d, url, dir });
      return d.promise;
    }
  },
};
mocks['@/features/submissions/uploadStore'].addUploads = (slot, target, files) => {
  uploadBatches.push({ slot, target, files });
  uploadEmission();
  return ['owned-upload'];
};
for (const key of [
  'features/submissions/toolContent',
  'features/submissions/ToolPicker',
  'features/web/scripts',
  'app/(app)/course/[courseId]/assignment/[assignmentId]/tool-picker',
])
  allowed.add(key);
delete mocks['@/features/submissions/toolContent'];
const protocol = load('@/features/submissions/toolContent');
const Screen = load('@/app/(app)/course/[courseId]/assignment/[assignmentId]/tool-picker').default;
const { ToolPicker } = load('@/features/submissions/ToolPicker');
const target = (toolName = '') => ({
  accountId: environment().account.id,
  client: environment().client,
  courseId: 'c',
  assignmentId: 'a',
  toolId: 'tool',
  toolName,
});
const link = { kind: 'lti', url: 'https://raw.test/مسار', title: '', lookupUuid: 'uuid' };
const file = {
  kind: 'file',
  url: 'https://download.test/signed?a=%2F',
  name: 'ملف.pdf',
  mimeType: 'application/raw',
};
const picked = (...items) => ({ type: 'picked', items });
const setup = (toolName = '') => {
  reset();
  downloads = [];
  dirs = [];
  uploadBatches = [];
  uploadEmission = () => {};
  setEnvironment({
    account: { ...environment().account, baseUrl: 'https://canvas.test' },
    tools: { data: [{ id: 'tool', name: toolName, description: '' }] },
  });
  const form = mount(SubmitForm, props());
  const launch = () => {
    const tree = form.render();
    allow('push', undefined);
    all(tree, 'ListItem')[0].props.onPress();
    params = calls.at(-1)[1].params;
    assert.equal(typeof params.launch, 'string');
    return params.launch;
  };
  const token = launch();
  const screen = mount(Screen);
  const tree = screen.render();
  const outcome = nodes(tree).find((n) => n.type === ToolPicker).props.onOutcome;
  return { form, screen, outcome, token, launch };
};
const settleDownloads = () =>
  downloads.forEach((d, i) =>
    d.resolve({ uri: d.dir.uri + '/server.bin', name: 'server.bin', size: i, type: 'server/type' }),
  );
const finish = (x) => {
  x.screen.unmount();
  x.form.unmount();
};
async function run() {
  for (const lang of ['en', 'fr', 'ar']) {
    const cat = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 1914);
    for (const [key, value] of Object.entries(baseline.catalogs[lang])) equal(cat[key], value);
    assert.equal(Object.keys(cat).filter((k) => k.startsWith('toolPicker.')).length, 20);
  }
  const source = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const parser = (s) => s.split('// --- Hand-off')[0];
  assert.equal(
    parser(source('features/submissions/toolContent.ts')),
    parser(baseline.sources['features/submissions/toolContent.ts']),
  );
  assert.equal(source('features/web/scripts.ts'), baseline.sources['features/web/scripts.ts']);
  // Freeze all WebView security/options/script props, not only the bridge string.
  const options = (s) =>
    s.slice(
      s.indexOf('          originWhitelist='),
      s.indexOf('          onShouldStartLoadWithRequest='),
    );
  assert.equal(
    options(source('features/submissions/ToolPicker.tsx')),
    options(baseline.sources['features/submissions/ToolPicker.tsx']),
  );
  const names = [
    'ltiResourceLink',
    'LtiLinkItem',
    'lti_launch_url',
    'file',
    'FileItem',
    'image',
    'link',
    'ContentItem',
    'url',
    'oembed',
    'html',
    'iframe',
    'unknown',
  ];
  for (const type of names) {
    const out = protocol.parsePickerMessage({
      subject: 'LtiDeepLinkingResponse',
      content_items: [{ type, url: ' https://raw.test/a ', title: ' اسم ', lookup_uuid: 'uuid' }],
    });
    assert.equal(out.type, 'picked');
    assert.equal(out.items[0].url, 'https://raw.test/a');
  }
  const messages = [],
    listeners = [];
  const window = {
    ReactNativeWebView: { postMessage: (x) => messages.push(JSON.parse(x)) },
    addEventListener: (_, cb) => listeners.push(cb),
  };
  window.top = window;
  vm.runInNewContext(protocol.pickerListener, { window });
  vm.runInNewContext(protocol.pickerListener, { window });
  assert.equal(listeners.length, 1);
  listeners[0]({ data: { subject: 'externalContentCancel' } });
  assert.equal(messages.length, 1);
  // Legacy compatibility cannot publish into an owned editor, even with an old registered listener.
  let x = setup(),
    legacy = 0;
  const stopLegacy = protocol.receivePicks('submission|accountA|c|a', () => legacy++);
  assert.equal(
    protocol.handToSubmitForm('submission|accountA|c|a', { ...link, toolName: '' }),
    false,
  );
  for (const t of [undefined, 'wrong']) assert.equal(protocol.claimToolLaunch(t, target()), null);
  for (const mismatch of [
    { client: {} },
    { accountId: 'B' },
    { assignmentId: 'B' },
    { courseId: 'B' },
    { toolId: 'B' },
    { toolName: 'Tool' },
  ]) {
    assert.equal(protocol.claimToolLaunch(x.token, { ...target(), ...mismatch }), null);
  }
  const original = params;
  params = { ...params, launch: undefined };
  x.screen.render();
  assert.equal(all(x.screen.render(), 'EmptyState').length, 1);
  assert.equal(await x.outcome(picked(file)), false);
  assert.equal(downloads.length, 0);
  finish(x);
  stopLegacy();
  assert.equal(legacy, 0);
  params = original;

  // Current eligible adoption precedes upload emissions, retains raw names/metadata, and consumes launch.
  x = setup();
  const pending = x.outcome(picked(file, { ...file, name: 'no-extension', mimeType: null }));
  assert.equal(await x.outcome(picked(file)), false);
  assert.equal(downloads.length, 2);
  for (const lang of ['fr', 'ar', 'en']) {
    view(lang);
    x.form.render(props({ ...assignment() }));
    x.screen.render();
  }
  assert.equal(downloads.length, 2);
  assert.equal(uploadBatches.length, 0);
  allow('back', undefined);
  settleDownloads();
  assert.equal(await pending, true);
  assert.equal(uploadBatches.length, 1);
  equal(
    uploadBatches[0].files.map((f) => [f.name, f.mimeType, f.size]),
    [
      ['ملف.pdf', 'application/raw', 0],
      ['server.bin', 'server/type', 1],
    ],
  );
  assert.equal(
    dirs.some((d) => d.deleted),
    false,
  );
  assert.equal(protocol.claimToolLaunch(x.token, target()), null);
  assert.equal(await x.outcome(picked(file)), false);
  finish(x);

  // The pinned editor survives an ordinary server-attempt refetch; remounting it does not.
  x = setup();
  x.form.render(props({ ...assignment(), submission: { ...assignment().submission, attempt: 1 } }));
  assert.equal(protocol.toolLaunchCurrent(x.token, target()), true);
  finish(x);
  x = setup('أداة');
  allow('alert', (...args) => {
    assert.ok(args[0].includes('أداة'));
    assert.ok(args[1].includes('خطأ RAW'));
    assert.equal(args[2][0].text, view('fr')('common.done'));
  });
  view('fr');
  x.screen.render();
  const localizedOutcome = nodes(x.screen.render()).find((n) => n.type === ToolPicker).props
    .onOutcome;
  await localizedOutcome({ type: 'error', message: 'خطأ RAW' });
  finish(x);

  // Revocation before and after downloading: replacement receivers never inherit a producer.
  for (const change of [
    'client',
    'account',
    'assignment',
    'unmount',
    'new-launch',
    'same-slot',
    'route-unmount',
    'permission',
    'confirmation',
    'offline',
  ]) {
    x = setup();
    const pending = x.outcome(picked(file));
    const previousCalls = calls.length;
    let replacement;
    if (change === 'client') {
      setEnvironment({ client: {} });
      x.form.render();
    }
    if (change === 'account') {
      setEnvironment({ account: { ...environment().account, id: 'B' } });
      x.form.render();
    }
    if (change === 'assignment') x.form.render(props({ ...assignment(), id: 'B' }));
    if (change === 'unmount') x.form.unmount();
    if (change === 'route-unmount') x.screen.unmount();
    if (change === 'new-launch') x.launch();
    if (change === 'same-slot') {
      replacement = mount(SubmitForm, props());
      replacement.render();
    }
    if (change === 'permission')
      x.form.render(props({ ...assignment(), submissionTypes: ['online_text_entry'] }));
    if (change === 'confirmation') alert(x.form.render());
    if (change === 'offline') {
      setEnvironment({ online: false });
      x.form.render();
    }
    const before = calls.length;
    settleDownloads();
    assert.equal(await pending, false, change);
    assert.equal(uploadBatches.length, 0, change);
    assert.ok(
      dirs.every((d) => d.deleted),
      change,
    );
    assert.equal(calls.length, before, change + ' stale feedback');
    assert.ok(before >= previousCalls);
    if (change !== 'route-unmount') x.screen.unmount();
    if (change !== 'unmount') x.form.unmount();
    replacement?.unmount();
  }
  // Partial failure waits for every download, removes only this batch, and permits retry.
  x = setup();
  let pendingFailure = x.outcome(picked(file, file));
  downloads[0].reject(Error('raw server'));
  await flush();
  assert.ok(dirs.every((d) => !d.deleted));
  allow('alert', undefined);
  downloads[1].resolve({ uri: dirs[1].uri + '/f', name: 'f', size: 9, type: null });
  assert.equal(await pendingFailure, false);
  assert.ok(dirs.every((d) => d.deleted));
  assert.equal(uploadBatches.length, 0);
  const retry = x.outcome(picked(file));
  assert.equal(downloads.length, 3);
  allow('back', undefined);
  settleDownloads();
  assert.equal(await retry, true);
  finish(x);

  // Late failure and cancellation do not consume a newer launch.
  x = setup();
  const abandoned = x.outcome(picked(file));
  const newToken = x.launch();
  const beforeFailure = calls.length;
  downloads[0].reject(Error('late raw failure'));
  await abandoned;
  await x.outcome({ type: 'cancelled' });
  assert.equal(calls.length, beforeFailure);
  assert.equal(protocol.toolLaunchCurrent(newToken, target()), true);
  finish(x);

  // Links/LTI and raw empty names survive route, form and locale refresh.
  for (const kind of ['link', 'lti']) {
    x = setup();
    allow('back', undefined);
    assert.equal(await x.outcome(picked({ ...link, kind })), true);
    assert.equal(uploadBatches.length, 0);
    const tree = x.form.render();
    if (kind === 'link') assert.equal(all(tree, 'TextField')[0].props.value, link.url);
    const confirmation = alert(tree);
    h.successRequest();
    await confirmation[2][1].onPress();
    const payload = calls.find((c) => c[0] === 'postA')[2].submission;
    equal(
      payload,
      kind === 'link'
        ? { submission_type: 'online_url', url: new URL(link.url).toString() }
        : { submission_type: 'basic_lti_launch', url: link.url, resource_link_lookup_uuid: 'uuid' },
    );
    finish(x);
  }
  // Stale error/cancel cannot haptic, alert or navigate; local safe-back remains offline.
  x = setup();
  x.launch();
  const before = calls.length;
  await x.outcome({ type: 'error', message: 'Raw خطأ' });
  await x.outcome({ type: 'cancelled' });
  assert.equal(calls.length, before);
  finish(x);
  x = setup();
  setEnvironment({ online: false });
  x.form.render();
  const expiredTree = x.screen.render();
  allow('back', undefined);
  all(expiredTree, 'Button')[0].props.onPress();
  finish(x);

  // A synchronous upload subscriber can replace the owner. Started IO remains owned
  // by uploadStore; no feedback/navigation/cleanup targets the replacement.
  x = setup();
  uploadEmission = () => {
    setEnvironment({ client: {} });
    x.form.render();
  };
  const emitted = x.outcome(picked(file));
  const beforeEmission = calls.length;
  settleDownloads();
  await emitted;
  assert.equal(uploadBatches.length, 1);
  assert.equal(calls.length, beforeEmission);
  assert.ok(dirs.every((d) => !d.deleted));
  finish(x);

  // Revocation subscribers can synchronously issue another launch. Completion
  // must explicitly deny navigation in that case.
  const editorContext = {};
  const stopEditor = protocol.registerToolEditor('reentrant', {
    context: editorContext,
    accepts: () => true,
    receive: () => true,
  });
  const reentrantToken = protocol.beginToolLaunch('reentrant', editorContext, target());
  const reentrantClaim = protocol.claimToolLaunch(reentrantToken, target());
  assert.equal(reentrantClaim.accept({ ...link, toolName: '' }), true);
  let replacedDuringCompletion = false;
  const unsubscribe = protocol.subscribeToolLaunches(() => {
    if (!replacedDuringCompletion) {
      replacedDuringCompletion = true;
      protocol.beginToolLaunch('reentrant', editorContext, target());
    }
  });
  assert.equal(reentrantClaim.complete(), false);
  assert.equal(replacedDuringCompletion, true);
  unsubscribe();
  stopEditor();

  await pickerCases();
  h.verifyBoundaries();
  console.log(
    `tool-picker: real registry/form/route/picker, 1934 keys; headless ownership, batch cleanup, retry, locale and bridge checks passed (${process.env.TZ})`,
  );
}
async function pickerCases() {
  reset();
  setEnvironment({ account: { ...environment().account, baseUrl: 'https://canvas.test' } });
  let outcomes = [],
    result = deferred(),
    owned = true;
  const p = {
    courseId: 'c',
    assignmentId: 'a',
    toolId: 'tool',
    toolName: '',
    isCurrent: () => owned,
    onOutcome: (o) => {
      outcomes.push(o);
      return result.promise;
    },
  };
  const session = deferred();
  allow('session', session.promise);
  const outer = mount(ToolPicker, p);
  let entry = outer.render();
  let inner = mount(entry.type, entry.props);
  inner.render();
  const initialCalls = calls.length;
  for (const lang of ['fr', 'ar', 'en']) {
    view(lang);
    const next = outer.render();
    assert.equal(next.key, entry.key);
    inner.render(next.props);
  }
  assert.equal(calls.length, initialCalls);
  session.resolve('https://signed.test/once');
  await flush();
  let tree = inner.render();
  let web = all(tree, 'WebView')[0];
  assert.equal(web.props.accessibilityLabel, '');
  web.props.onLoadStart({ nativeEvent: { url: 'https://page/new' } });
  web.props.onLoad({ nativeEvent: { url: 'https://page/new' } });
  web.props.onError({ nativeEvent: { code: 500, url: 'https://page/old' } });
  assert.equal(all(inner.render(), 'EmptyState').length, 0);
  const message = (data) => ({
    nativeEvent: { data: JSON.stringify({ type: 'easel-picker-content', data }) },
  });
  const answer = message({
    subject: 'LtiDeepLinkingResponse',
    content_items: [{ type: 'ltiResourceLink', url: link.url, title: 'أداة', lookup_uuid: 'uuid' }],
  });
  web.props.onMessage(answer);
  web.props.onMessage(answer);
  assert.equal(outcomes.length, 1);
  for (const lang of ['ar', 'fr']) {
    view(lang);
    inner.render();
  }
  assert.equal(calls.length, initialCalls);
  result.resolve(false);
  await flush();
  result = deferred();
  web.props.onMessage(answer);
  assert.equal(outcomes.length, 2);
  result.resolve(true);
  await flush();
  web.props.onMessage(answer);
  assert.equal(outcomes.length, 2);
  // Old source callbacks are inert after a new signed-URL request begins.
  const newer = deferred();
  allow('session', newer.promise);
  web.props.onRenderProcessGone();
  const before = outcomes.length;
  web.props.onMessage(message({ subject: 'externalContentCancel' }));
  web.props.onError({ nativeEvent: { code: 500, url: 'https://page/new' } });
  web.props.onOpenWindow({ nativeEvent: { targetUrl: 'https://old-popup.test' } });
  assert.equal(outcomes.length, before);
  newer.resolve('https://signed.test/new');
  await flush();
  tree = inner.render();
  const newWeb = all(tree, 'WebView')[0];
  assert.notEqual(newWeb.key, web.key);
  assert.equal(all(tree, 'PopupSheet')[0].props.popup, null);
  newWeb.props.onOpenWindow({ nativeEvent: { targetUrl: 'https://popup.test/ع' } });
  tree = inner.render();
  const popup = all(tree, 'PopupSheet')[0].props.popup;
  const count = calls.length;
  view('en');
  tree = inner.render();
  assert.equal(all(tree, 'PopupSheet')[0].props.popup, popup);
  assert.equal(calls.length, count);
  // Live reason relabels without another session URL; native exceptions remain ignored.
  newWeb.props.onLoadStart({ nativeEvent: { url: 'https://page/error' } });
  for (const event of [
    { code: -999 },
    { code: 102, domain: 'WebKitErrorDomain' },
    { code: 204, domain: 'WebKitErrorDomain' },
  ]) {
    newWeb.props.onError({ nativeEvent: { ...event, url: 'https://page/error' } });
    assert.equal(all(inner.render(), 'EmptyState').length, 0);
  }
  newWeb.props.onError({ nativeEvent: { code: 500, url: 'https://page/error' } });
  for (const lang of ['en', 'fr', 'ar']) {
    const t = view(lang);
    tree = inner.render();
    assert.ok(all(tree, 'EmptyState')[0].props.description.includes(t('toolPicker.pageFailure')));
  }
  assert.equal(calls.length, count);
  const retry = deferred();
  allow('session', retry.promise);
  all(tree, 'EmptyState')[0].props.action.onPress();
  // Replacing committed client remounts the session. Delayed old success is discarded.
  setEnvironment({ client: {} });
  const replacement = outer.render();
  assert.notEqual(replacement.key, entry.key);
  inner.unmount();
  retry.resolve('https://must-not-display.test');
  await flush();
  const currentSession = deferred();
  allow('session', currentSession.promise);
  inner = mount(replacement.type, replacement.props);
  inner.render();
  currentSession.reject(Error('secret raw signing failure'));
  await flush();
  tree = inner.render();
  assert.ok(
    all(tree, 'EmptyState')[0].props.description.includes(
      view('ar')('toolPicker.connectionFailure'),
    ),
  );
  // Offline load retries do not navigate; browser fallback is explicitly invoked.
  allow('session', Promise.resolve('https://browser.test'));
  allow('browserPicker', Promise.resolve());
  await all(tree, 'Button')[0].props.onPress();
  const delayedBrowser = deferred();
  allow('session', delayedBrowser.promise);
  const opening = all(tree, 'Button')[0].props.onPress();
  const browserCalls = calls.filter((c) => c[0] === 'browserPicker').length;
  owned = false;
  delayedBrowser.resolve('https://stale-browser.test');
  await opening;
  assert.equal(calls.filter((c) => c[0] === 'browserPicker').length, browserCalls);
  const staleCount = calls.length;
  all(tree, 'EmptyState')[0].props.action.onPress();
  assert.equal(calls.length, staleCount);
  inner.unmount();
  outer.unmount();
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
