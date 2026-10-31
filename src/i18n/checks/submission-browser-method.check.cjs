/* global __dirname */
// Production form + shared session helper; all transport/native/storage edges synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const crypto = require('node:crypto');
const harness = require('./submission-form.check.cjs');
const { mount, load, mocks, allowed, reset, view, all, props, assignment, deferred, flush,
  equal, calls, setEnvironment, environment, verifyBoundaries } = harness;
const root = path.resolve(__dirname, '../..');
const requests = [], browsers = [], inputs = [], listeners = new Map();
let focused, route, activeKey;
const navigation = {
  isFocused: () => focused,
  getState: () => ({ index: 0, routes: [{ key: activeKey }] }),
  addListener(event, fn) {
    const set = listeners.get(event) ?? new Set(); listeners.set(event, set); set.add(fn);
    return () => set.delete(fn);
  },
};
Object.assign(mocks['expo-router'], {
  useNavigation: () => navigation, useRoute: () => route, useIsFocused: () => focused,
});
mocks['expo-web-browser'] = {
  openBrowserAsync(...args) { const d = deferred(); browsers.push({ args, ...d }); return d.promise; },
};
const browserMock = mocks['@/features/content/browser'];
delete mocks['@/features/content/browser'];
allowed.add('features/content/browser');
Object.assign(browserMock, load('@/features/content/browser'));
mocks['@/features/content/browser'] = browserMock;
const actualUseOpenSignedIn = browserMock.useOpenSignedIn;
browserMock.useOpenSignedIn = () => {
  const open = actualUseOpenSignedIn();
  return (url, mayOpen) => { inputs.push({ url, mayOpen }); return open(url, mayOpen); };
};
let Form = harness.SubmitForm;
if (process.env.SUBMISSION_BROWSER_ORIGINAL) {
  const file = path.join(root, 'features/submissions/SubmitForm.tsx');
  const js = ts.transpileModule(fs.readFileSync(process.env.SUBMISSION_BROWSER_ORIGINAL, 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => load(name, file), module, module.exports);
  Form = module.exports.SubmitForm;
}
const api = load('@/canvas/api/submissions');
const nativeType = api.isNativeSubmissionType;
const client = () => ({ baseUrl: 'https://school.invalid', get(...args) {
  const d = deferred(); requests.push({ args, ...d }); return d.promise;
} });
function setup() {
  reset(); requests.length = browsers.length = inputs.length = 0; listeners.clear();
  focused = true; route = { key: 'submit' }; activeKey = route.key;
  setEnvironment({ account: { id: 'accountA', baseUrl: 'https://school.invalid' }, client: client() });
  // Same synthetic capability boundary as the existing form suite; no production rules changed.
  api.isNativeSubmissionType = value => !['online_upload', 'media_recording'].includes(value) && nativeType(value);
  view('en');
  const p = props({ ...assignment(), htmlUrl: '/courses/c/assignments/a?raw=%2f#ع' });
  const h = mount(Form, p);
  return { p, h, tree: h.render() };
}
const controls = tree => all(tree, 'ListItem').filter(n => n.props.chevron === false);
async function run() {
  if (process.env.SUBMISSION_BROWSER_ORIGINAL) {
    const { h, tree } = setup();
    controls(tree)[0].props.onPress(); controls(tree)[1].props.onPress();
    assert.equal(requests.length, 2, 'original competing controls duplicate session requests');
    h.unmount();
    for (const request of requests) request.resolve({ session_url: 'https://signed.invalid/old' });
    await flush();
    assert.equal(browsers.length, 2, 'original delayed browser entry survives unmount');
    for (const browser of browsers) browser.resolve();
    await flush(); verifyBoundaries();
    console.log('ORIGINAL RACE: two competing browser methods => two session requests and two native entries after unmount');
    return;
  }
  const retirements = {
    account: s => setEnvironment({ account: { ...environment().account, id: 'other' } }),
    client: s => setEnvironment({ client: client() }),
    accountBase: s => setEnvironment({ account: { ...environment().account, baseUrl: 'https://other.invalid' } }),
    clientBase: s => { environment().client.baseUrl = 'https://other.invalid'; },
    expired: s => setEnvironment({ account: { ...environment().account, expired: true } }),
    course: s => { s.p = props({ ...s.p.a, courseId: 'other' }); },
    assignment: s => { s.p = props({ ...s.p.a, id: 'other' }); },
    attempt: s => { s.p = props({ ...s.p.a, submission: { ...s.p.a.submission, attempt: 1 } }); },
    url: s => { s.p = props({ ...s.p.a, htmlUrl: '/new?raw=%2F' }); },
    method: s => { s.p = props({ ...s.p.a, submissionTypes: ['online_text_entry', 'media_recording'] }); },
    capability: s => { api.isNativeSubmissionType = nativeType; },
    permission: s => { s.p = props({ ...s.p.a, canSubmit: false }); },
    locked: s => { s.p = props({ ...s.p.a, locked: true }); },
    closed: s => { s.p = props({ ...s.p.a, lockAt: new Date(0) }); },
    attemptsExhausted: s => { s.p = props({ ...s.p.a, allowedAttempts: 0 }); },
    offline: s => setEnvironment({ online: false }),
    group: s => { s.p = props({ ...s.p.a, groupCategoryId: 'g' }); setEnvironment({ group: { data: null, isPending: true, isError: false } }); },
    route: s => { route = { key: 'other' }; activeKey = route.key; },
    activeRouteWithoutCommit: s => { activeKey = 'other'; s.noCommit = true; },
    focus: s => { focused = false; },
    blurWithoutCommit: s => { focused = false; for (const fn of listeners.get('blur') ?? []) fn(); s.noCommit = true; },
    blurAndReturn: s => { for (const fn of listeners.get('blur') ?? []) fn(); for (const fn of listeners.get('focus') ?? []) fn(); },
    unmount: s => { s.h.unmount(); s.unmounted = true; },
  };
  for (const fallback of [false, true]) for (const [name, retire] of Object.entries(retirements)) {
    const s = setup();
    const old = controls(s.tree)[0].props.onPress;
    const pending = old();
    assert.equal(requests.length, 1, name);
    retire(s);
    if (!s.unmounted && !s.noCommit) s.tree = s.h.render(s.p);
    old(); // Retained control cannot borrow a new owner.
    assert.equal(requests.length, 1, name + ' retained control');
    if (fallback) requests[0].reject(Error('session unavailable'));
    else requests[0].resolve({ session_url: 'https://signed.invalid/retired' });
    await pending;
    assert.equal(browsers.length, 0, name + ' delayed entry');
    assert.equal(calls.length, 0, name + ' no form/native/tool/draft side effects');
    if (!s.unmounted) s.h.unmount();
    verifyBoundaries();
  }
  // Raw input, actual session request normalization/fallback and unchanged native options.
  for (const fallback of [false, true]) for (const locale of ['en', 'fr', 'ar']) {
    const s = setup(), rows = controls(s.tree);
    const pending = rows[0].props.onPress();
    rows[0].props.onPress(); rows[1].props.onPress();
    assert.equal(requests.length, 1, 'different methods coalesce synchronously');
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].url, s.p.a.htmlUrl, 'exact raw assignment URL passed to shared helper');
    assert.equal(typeof inputs[0].mayOpen, 'function');
    equal(requests[0].args, ['/api/v1/login/session_token', {
      return_to: new URL(s.p.a.htmlUrl, environment().client.baseUrl).toString(),
    }]);
    view(locale); s.tree = s.h.render();
    if (fallback) requests[0].reject(Error('session denied'));
    else requests[0].resolve({ session_url: 'https://signed.invalid/once?raw=%2f#ع' });
    await flush();
    equal(browsers[0].args, [fallback ? new URL(s.p.a.htmlUrl, environment().client.baseUrl).toString() : 'https://signed.invalid/once?raw=%2f#ع']);
    controls(s.tree)[1].props.onPress();
    assert.equal(requests.length, 1, 'claim lasts through native completion');
    browsers[0].resolve(); await pending;
    const next = controls(s.tree)[1].props.onPress();
    assert.equal(requests.length, 2, 'current retry after completion');
    s.h.unmount(); requests[1].resolve({ session_url: 'https://signed.invalid/unused' }); await next;
    assert.equal(calls.length, 0); verifyBoundaries();
  }
  // Current native rejection is handled with existing localized feedback; no raw error.
  for (const locale of ['en', 'fr', 'ar']) {
    const s = setup();
    const pending = controls(s.tree)[0].props.onPress();
    requests[0].resolve({ session_url: 'https://signed.invalid/once' }); await flush();
    const t = view(locale); s.tree = s.h.render();
    harness.allow('alert', undefined);
    browsers[0].reject(Error('PRIVATE native detail')); await pending;
    equal(calls, [['alert', t('inboxMedia.browserError')]]);
    const retry = controls(s.tree)[0].props.onPress();
    assert.equal(requests.length, 2);
    requests[1].reject(Error('fallback')); await flush(); browsers[1].resolve(); await retry;
    s.h.unmount(); verifyBoundaries();
  }
  // Both old session completion and old native rejection cannot clear a newer claim.
  for (const entered of [false, true]) {
    const s = setup();
    const old = controls(s.tree)[0].props.onPress();
    if (entered) { requests[0].resolve({ session_url: 'https://signed.invalid/old' }); await flush(); }
    s.p = props({ ...s.p.a, htmlUrl: '/new' }); s.tree = s.h.render(s.p);
    const pending = controls(s.tree)[0].props.onPress();
    if (entered) browsers[0].reject(Error('old native error'));
    else requests[0].reject(Error('old fallback'));
    await old;
    controls(s.tree)[1].props.onPress();
    assert.equal(requests.length, 2, 'old finalizer cannot release current claim');
    requests[1].resolve({ session_url: 'https://signed.invalid/new' }); await flush();
    browsers.at(-1).resolve(); await pending;
    assert.equal(browsers.length, entered ? 2 : 1);
    assert.equal(calls.length, 0, 'old rejection is silent');
    s.h.unmount(); verifyBoundaries();
  }
  // Same-owner replacement: a capability change invalidates only the selected
  // method before another committed control claims entry, without a form render.
  {
    const s = setup(), rows = controls(s.tree);
    const old = rows[0].props.onPress();
    api.isNativeSubmissionType = value => value !== 'media_recording' && nativeType(value);
    const pending = rows[1].props.onPress();
    assert.equal(requests.length, 2);
    requests[0].resolve({ session_url: 'https://signed.invalid/old' }); await old;
    rows[1].props.onPress();
    assert.equal(requests.length, 2, 'same-owner old finalizer cannot clear newer operation');
    requests[1].resolve({ session_url: 'https://signed.invalid/new' }); await flush();
    assert.equal(browsers.length, 1); browsers[0].resolve(); await pending;
    assert.equal(calls.length, 0); s.h.unmount(); verifyBoundaries();
  }
  // Returning to identical source values never revives a retired control.
  {
    const s = setup(), old = controls(s.tree)[0].props.onPress;
    s.h.render(props({ ...s.p.a, canSubmit: false }));
    s.tree = s.h.render(s.p);
    old(); assert.equal(requests.length, 0);
    const pending = controls(s.tree)[0].props.onPress();
    assert.equal(requests.length, 1);
    s.h.unmount(); requests[0].reject(Error('fallback')); await pending;
    assert.equal(browsers.length, 0); verifyBoundaries();
  }
  // Browser claims never block ordinary comment/text/type edits or consume drafts.
  {
    const s = setup();
    const pending = controls(s.tree)[0].props.onPress();
    harness.field(s.tree).props.onChangeText(' raw comment ');
    all(s.tree, 'Editor')[0].props.onChange('<p>new draft</p>');
    harness.choose(s.tree, 'online_url');
    s.tree = s.h.render();
    assert.equal(harness.field(s.tree).props.value, ' raw comment ');
    assert.equal(all(s.tree, 'SegmentedControl')[0].props.value, 'online_url');
    equal(calls.map(c => c[0]), ['draftEdit']);
    requests[0].resolve({ session_url: 'https://signed.invalid/retired' }); await pending;
    assert.equal(browsers.length, 0); s.h.unmount(); verifyBoundaries();
  }
  // A competing submit operation remains authoritative and retires browser entry.
  {
    const s = setup();
    const pending = controls(s.tree)[0].props.onPress();
    const confirmation = harness.alert(s.tree), submitted = deferred();
    harness.successRequest('A', submitted);
    // Synthetic account client still needs the ordinary test mutation boundary.
    environment().client.post = harness.boundary('postA');
    const send = confirmation[2][1].onPress();
    requests[0].resolve({ session_url: 'https://signed.invalid/retired' }); await pending;
    assert.equal(browsers.length, 0);
    submitted.resolve({ attempt: 1, attempts: [], submittedAt: null, late: false }); await send; await flush();
    assert.equal(calls.filter(c => c[0] === 'postA').length, 1);
    s.h.unmount(); verifyBoundaries();
  }
  // Changed speculative render cannot publish a new callback before commit.
  {
    const s = setup();
    const pending = controls(s.tree)[0].props.onPress();
    const speculative = s.h.renderOnly(props({ ...s.p.a, htmlUrl: '/uncommitted' }));
    controls(speculative)[0].props.onPress(); assert.equal(requests.length, 1);
    requests[0].resolve({ session_url: 'https://signed.invalid/committed' }); await flush();
    assert.equal(browsers.length, 1, 'uncommitted source does not retire committed work');
    browsers[0].resolve(); await pending;
    s.h.commit(); s.h.unmount(); verifyBoundaries();
  }
  // Exact preservation of every reviewed catalog value; no baseline refresh.
  const baseline = require('./browser-catalogs.baseline.json');
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  assert.equal(baseline.catalogKeys.length, 3260);
  for (const locale of ['en', 'fr', 'ar']) {
    const catalog = load('@/i18n/' + locale)[locale];
    assert.equal(hash(JSON.stringify(baseline.catalogKeys.map(key => [key, catalog[key]]))),
      baseline.catalogHashes[locale], locale + ': all historical catalog values');
  }
  // Reverse the browser edits before checking the form snapshot, including the
  // intentional useSubmitAssignment extraction and planner cache publication.
  const source = fs.readFileSync(path.join(root, 'features/submissions/SubmitForm.tsx'), 'utf8');
  const restored = source
    .replace("import { router, useIsFocused, useNavigation, useRoute } from 'expo-router';", "import { router } from 'expo-router';")
    .replace(/  \/\/ Browser entry has its own committed lifetime\.[\s\S]*?(?=  const edit =)/, '')
    .replace('onPress={() => openBrowserMethod(browserType)}', 'onPress={() => navigate(() => openSignedIn(a.htmlUrl))}');
  assert.equal(hash(restored), '93ebec71a69d273205d4c4508cee8f49c3fa484c37f839119e154304bfade0da', 'all original form lifecycle, panels, confirmation, route and submission code unchanged');
  assert.equal(hash(fs.readFileSync(path.join(root, 'features/content/browser.ts'))), '519a926bb98b5fa98961e886630cf3688bb4e05688a1264f986075d10fa962f9', 'shared browser helper byte unchanged');
  console.log('submission-browser-method: original production callback/owner + shared session helper, retirement matrix, duplicates, retry, finalization, locale, drafts and submit isolation passed (' + process.env.TZ + ')');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
