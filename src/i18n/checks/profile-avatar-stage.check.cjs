/* global __dirname */
// Production pipeline, hook and form; real installed TanStack MutationObserver.
// Reuse only the existing synthetic React/native/transport harness, not its cases.
// No HTTP, storage, credentials, native effects or React Compiler execution.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { QueryClient, MutationCache, MutationObserver } = require('@tanstack/query-core');
const harness = fs.readFileSync(path.join(__dirname, 'profile-forms.check.cjs'), 'utf8');
const h = new Function(
  'require',
  '__dirname',
  harness.slice(0, harness.indexOf('async function main()')) +
    `
return { api, calls, queues, stubs, react, mount, mountProfile, choose, button, first, nodes,
  deferred, flush, reset, result, load, makeClient, unexpected,
  get env() { return env; }, set env(v) { env = v; },
  get query() { return query; }, set query(v) { query = v; },
  set focused(v) { focused = v; }, set online(v) { online = v; },
  set locale(v) { locale = v; }, get menu() { return menu; } };
`,
)(require, __dirname);
const { api, calls, queues, deferred, flush, reset } = h;
let beforeSuccess;
const queryClient = new QueryClient({
  mutationCache: new MutationCache({ onSuccess: () => beforeSuccess?.() }),
  defaultOptions: { mutations: { retry: false, networkMode: 'always', gcTime: Infinity } },
});
// Synthetic adapter for useCanvasMutation's client binding. Observer reset,
// options replacement, variables and lifecycle ordering run installed code.
h.stubs['@/canvas/query'].useCanvasMutation = (fn, options) => {
  const client = h.env.client;
  const config = { mutationFn: (value) => fn(client, value), ...options };
  const [observer] = h.react.useState(() => new MutationObserver(queryClient, config));
  h.react.useEffect(() => {
    observer.setOptions(config);
  });
  return { mutateAsync: observer.mutate, reset: observer.reset };
};
const file = {
  uri: 'file:///synthetic.jpg',
  name: 'Change picture',
  mimeType: 'image/jpeg',
  size: 12,
};
const list = [
  { type: 'gravatar', id: '42', token: 'WRONG' },
  { type: 'attachment', id: 42, token: 'RAW_TOKEN' },
];
const obsolete = (error) => error instanceof api.ObsoleteAvatarOperationError;
const cacheKey = () => assert.deepEqual(calls.cache, [{ queryKey: ['a', 'profile'] }]);
function hook(progress) {
  let value;
  const Component = () => {
    value = api.useUploadAvatar(progress);
    return null;
  };
  const host = h.mount(() => ({ type: Component, props: {} }));
  host.render();
  return {
    host,
    get value() {
      return value;
    },
  };
}
function pipeline(stage, isCurrent, progress) {
  const gate = deferred();
  queues.uploads.push(stage === 'transfer' ? gate.promise : { id: '42' });
  if (stage !== 'transfer')
    queues.get.push(stage === 'list' ? gate.promise : stage === 'fallback' ? [] : list);
  if (stage === 'fallback') queues.get.push(gate.promise);
  if (stage === 'put') queues.put.push(gate.promise);
  return { gate, pending: api.uploadAvatar(h.env.client, 'student', file, progress, isCurrent) };
}
async function main() {
  const baseline = require('./profile-avatar-stage.baseline.json');
  for (const lang of ['en', 'fr', 'ar']) {
    const catalog = h.load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 2859);
    for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
        hash,
        lang + '/' + key,
      );
  }
  reset();
  await assert.rejects(
    api.uploadAvatar(h.env.client, 'student', file, undefined, () => false),
    obsolete,
  );
  assert.equal(calls.uploads.length, 0);
  // Deferred success and raw failure at every entered stage. Avatar-list failure
  // preserves the historical fallback, but retirement prevents that next request.
  for (const stage of ['transfer', 'list', 'fallback', 'put']) {
    for (const reject of [false, true]) {
      reset();
      let live = true;
      const progress = [];
      const { gate, pending } = pipeline(
        stage,
        () => live,
        (v) => progress.push(v),
      );
      const raw = Error('Change picture');
      const checked = assert.rejects(
        pending,
        reject && stage !== 'list' ? (e) => e === raw : obsolete,
      );
      await flush();
      calls.uploads[0][3].onProgress(0.2);
      live = false;
      calls.uploads[0][3].onProgress(0.9);
      if (reject) gate.reject(raw);
      else
        gate.resolve(
          stage === 'transfer'
            ? { id: '42' }
            : stage === 'list'
              ? list
              : stage === 'fallback'
                ? { avatar: { token: 'RAW_TOKEN' } }
                : { avatar_url: null },
        );
      await checked;
      assert.deepEqual(progress, [0.2]);
      assert.equal(calls.get.length, stage === 'transfer' ? 0 : stage === 'fallback' ? 2 : 1);
      assert.equal(calls.put.length, stage === 'put' ? 1 : 0);
    }
  }
  // An asynchronous caller continuation between token resolution and final PUT.
  reset();
  let live = true;
  queues.uploads.push({ id: '42' });
  queues.get.push([
    {
      type: 'attachment',
      id: '42',
      get token() {
        live = false;
        return 'TOKEN';
      },
    },
  ]);
  await assert.rejects(
    api.uploadAvatar(h.env.client, 'student', file, undefined, () => live),
    obsolete,
  );
  assert.equal(calls.put.length, 0);
  // Pre-list and pre-fallback guards reject retirement caused while reading
  // the preceding synthetic response, without entering the next boundary.
  reset();
  live = true;
  queues.uploads.push({
    get id() {
      live = false;
      return '42';
    },
  });
  await assert.rejects(
    api.uploadAvatar(h.env.client, 'student', file, undefined, () => live),
    obsolete,
  );
  assert.equal(calls.get.length, 0);
  reset();
  live = true;
  queues.uploads.push({ id: '42' });
  queues.get.push([
    {
      get type() {
        live = false;
        return 'gravatar';
      },
    },
  ]);
  await assert.rejects(
    api.uploadAvatar(h.env.client, 'student', file, undefined, () => live),
    obsolete,
  );
  assert.equal(calls.get.length, 1);
  // A tagged retirement must never be swallowed by list's legacy fallback.
  reset();
  queues.uploads.push({ id: '42' });
  queues.get.push(() => {
    throw new api.ObsoleteAvatarOperationError();
  });
  await assert.rejects(api.uploadAvatar(h.env.client, 'student', file), obsolete);
  assert.equal(calls.get.length, 1);

  // Current URL, true null/missing avatar, ordinary list failure fallback, and
  // the unchanged legacy LocalFile mutation contract all publish original data.
  for (const guarded of [false, true]) {
    for (const avatar of ['raw-avatar', null, undefined]) {
      reset();
      const { host, value } = hook();
      queues.uploads.push({ id: '42' });
      queues.get.push(
        () => {
          throw Error('legacy list failure');
        },
        { avatar: { token: 'RAW_TOKEN' } },
      );
      queues.put.push({ avatar_url: avatar });
      const pending = value.mutateAsync(guarded ? { file, isCurrent: () => true } : file);
      value.reset();
      assert.equal(await pending, avatar ?? null);
      assert.equal(calls.uploads[0][2], file);
      assert.equal(calls.uploads[0][1], '/api/v1/users/self/files');
      assert.deepEqual(calls.uploads[0][3].params, {
        parent_folder_path: 'profile pictures',
        on_duplicate: 'rename',
      });
      assert.deepEqual(calls.get, [
        ['a', '/api/v1/users/student/avatars'],
        ['a', '/api/v1/files/42', { include: ['avatar'] }],
      ]);
      assert.deepEqual(calls.put, [
        ['a', '/api/v1/users/student', { user: { avatar: { token: 'RAW_TOKEN' } } }],
      ]);
      assert.deepEqual(calls.account, [['a', { avatarUrl: avatar ?? null }]]);
      cacheKey();
      host.unmount();
    }
  }
  // The eligibility predicate travels with invocation variables even if the
  // mutation function has not entered yet. No successful null on early retirement.
  reset();
  let earlyLive = true;
  const early = hook();
  const earlyPending = early.value.mutateAsync({ file, isCurrent: () => earlyLive });
  const earlyChecked = assert.rejects(earlyPending, obsolete);
  early.value.reset();
  earlyLive = false;
  await earlyChecked;
  assert.equal(calls.uploads.length, 0);
  assert.equal(calls.account.length, 0);
  cacheKey();
  early.host.unmount();
  // Legacy detached calls still finish against their entered client/account,
  // regardless of subsequent hook configuration, with raw error identity intact.
  for (const fail of [false, true]) {
    reset();
    const legacy = hook();
    const gate = deferred();
    queues.uploads.push(gate.promise);
    const raw = Error('Picture updated');
    const pending = legacy.value.mutateAsync(file);
    const outcome = fail ? assert.rejects(pending, (e) => e === raw) : pending;
    legacy.value.reset();
    await flush();
    h.env = { account: { id: 'b', user: { id: 'other' } }, client: h.makeClient('b') };
    legacy.host.render();
    if (fail) gate.reject(raw);
    else {
      queues.get.push(list);
      queues.put.push({ avatar_url: 'legacy' });
      gate.resolve({ id: '42' });
    }
    await outcome;
    assert.deepEqual(calls.account, fail ? [] : [['a', { avatarUrl: 'legacy' }]]);
    if (!fail) assert.equal(calls.put[0][0], 'a');
    cacheKey();
    legacy.host.unmount();
  }
  // Retirement during query's awaited success lifecycle rejects instead of
  // clearing a saved avatar. Original-account invalidation remains on settlement.
  reset();
  let eligible = true;
  const publication = deferred();
  beforeSuccess = () => publication.promise;
  const upload = hook();
  queues.uploads.push({ id: '42' });
  queues.get.push(list);
  queues.put.push({ avatar_url: null });
  const pending = upload.value.mutateAsync({ file, isCurrent: () => eligible });
  const checked = assert.rejects(pending, obsolete);
  upload.value.reset();
  await flush();
  eligible = false;
  h.env = { account: { id: 'b', user: { id: 'other' } }, client: h.makeClient('b') };
  upload.host.render();
  publication.resolve();
  await checked;
  assert.equal(calls.account.length, 0);
  cacheKey();
  beforeSuccess = undefined;
  upload.host.unmount();

  // Full production form + hook + real observer: all deferred stages across
  // committed identity/eligibility transitions, stale success and stale rejection.
  const replacements = {
    account: () => {
      h.env = { account: { id: 'b', user: { id: 'other' } }, client: h.makeClient('b') };
    },
    client: () => {
      h.env = { ...h.env, client: h.makeClient('replacement') };
    },
    permission: () => {
      h.query = { ...h.query, data: { ...h.query.data, canEditAvatar: false } };
    },
    focus: () => {
      h.focused = false;
    },
    offline: () => {
      h.online = false;
    },
    query: () => {
      h.query = { ...h.query, isError: true };
    },
    profile: () => {
      h.query = { ...h.query, data: { ...h.query.data } };
    },
    unmount: (host) => host.unmount(),
    replay: (host) => host.replay(),
  };
  for (const [replacement, replace] of Object.entries(replacements)) {
    for (const stage of ['transfer', 'list', 'fallback', 'put']) {
      for (const rejects of [false, true]) {
        reset();
        const host = h.mountProfile();
        const gate = deferred();
        queues.library.push(h.result());
        queues.uploads.push(stage === 'transfer' ? gate.promise : { id: '42' });
        if (stage !== 'transfer')
          queues.get.push(stage === 'list' ? gate.promise : stage === 'fallback' ? [] : list);
        if (stage === 'fallback') queues.get.push(gate.promise);
        if (stage === 'put') queues.put.push(gate.promise);
        h.choose(host);
        const chooseAgain = h.menu.options[1].onPress;
        chooseAgain();
        h.button(host, 'changePicture').onPress();
        chooseAgain();
        await flush();
        assert.equal(calls.library.length, 1, 'duplicate picker entry');
        assert.equal(calls.uploads.length, 1);
        const progress = calls.uploads[0][3].onProgress;
        replace(host);
        if (replacement !== 'unmount') host.render();
        progress(0.7);
        if (rejects) gate.reject(Error('raw stale failure'));
        else
          gate.resolve(
            stage === 'transfer'
              ? { id: '42' }
              : stage === 'list'
                ? list
                : stage === 'fallback'
                  ? { avatar: { token: 'RAW_TOKEN' } }
                  : { avatar_url: null },
          );
        await flush();
        if (replacement !== 'unmount') {
          host.render();
          assert.equal(h.nodes(host.tree, 'ProgressRing').length, 0);
          assert.equal(h.nodes(host.tree, 'Callout').length, 0);
        }
        assert.equal(
          calls.get.length,
          stage === 'transfer' ? 0 : stage === 'fallback' ? 2 : 1,
          replacement + '/' + stage,
        );
        assert.equal(calls.put.length, stage === 'put' ? 1 : 0);
        assert.equal(calls.account.length, 0);
        assert.equal(calls.toast.length, 0);
        cacheKey();
        host.unmount();
      }
    }
  }
  // A retired transfer resolves while a newer operation is live: it cannot
  // borrow the new guard/progress sink or clear the new saved avatar.
  reset();
  const overlap = h.mountProfile();
  const oldTransfer = deferred();
  queues.library.push(h.result());
  queues.uploads.push(oldTransfer.promise);
  h.choose(overlap);
  await flush();
  const oldProgress = calls.uploads[0][3].onProgress;
  h.focused = false;
  overlap.render();
  h.focused = true;
  overlap.render();
  const newTransfer = deferred();
  queues.library.push(h.result());
  queues.uploads.push(newTransfer.promise);
  h.choose(overlap);
  await flush();
  calls.uploads[1][3].onProgress(0.4);
  oldProgress(0.9);
  oldTransfer.resolve({ id: 'old' });
  await flush();
  overlap.render();
  assert.equal(h.first(overlap, 'ProgressRing').value, 0.4);
  assert.equal(calls.get.length, 0);
  assert.equal(calls.account.length, 0);
  queues.get.push(list);
  queues.put.push({ avatar_url: 'new' });
  newTransfer.resolve({ id: '42' });
  await flush();
  overlap.render();
  assert.deepEqual(calls.account, [['a', { avatarUrl: 'new' }]]);
  assert.equal(calls.toast.length, 1);
  overlap.unmount();
  // Locale-spanning picker and abandoned speculative permission render remain
  // eligible. A second upload cannot adopt delayed progress from the first.
  reset();
  const host = h.mountProfile();
  const picker = deferred();
  queues.library.push(picker.promise);
  h.choose(host);
  h.locale = 'ar';
  host.render();
  const savedQuery = h.query;
  h.query = { ...savedQuery, data: { ...savedQuery.data, canEditAvatar: false } };
  host.renderOnly();
  host.abandon();
  h.query = savedQuery;
  const firstTransfer = deferred();
  queues.uploads.push(firstTransfer.promise);
  picker.resolve(h.result());
  await flush();
  host.render();
  const firstProgress = calls.uploads[0][3].onProgress;
  firstProgress(0.2);
  host.render();
  assert.equal(h.first(host, 'ProgressRing').value, 0.2);
  queues.get.push(list);
  queues.put.push({ avatar_url: 'first' });
  firstTransfer.resolve({ id: '42' });
  await flush();
  host.render();
  assert.deepEqual(calls.account, [['a', { avatarUrl: 'first' }]]);
  const secondTransfer = deferred();
  queues.library.push(h.result());
  queues.uploads.push(secondTransfer.promise);
  h.choose(host);
  await flush();
  calls.uploads[1][3].onProgress(0.3);
  firstProgress(0.9);
  host.render();
  assert.equal(h.first(host, 'ProgressRing').value, 0.3);
  queues.get.push(list);
  queues.put.push({ avatar_url: null });
  secondTransfer.resolve({ id: '42' });
  await flush();
  host.render();
  assert.deepEqual(calls.account.at(-1), ['a', { avatarUrl: null }]);
  assert.equal(calls.toast.length, 2);
  host.unmount();
  reset();
  assert.deepEqual(h.unexpected, []);
  queryClient.clear();
  console.log(
    'profile-avatar-stage: PASS (2859 historical values/language; deferred pipeline, real observer, synthetic form boundaries)',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
