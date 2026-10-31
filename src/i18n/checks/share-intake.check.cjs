/* global __dirname */
// Executes the actual adapter and screen using the screen suite's allowlisted
// production loader/reconciler. Only Expo/RN, navigation, session and UI effects
// are synthetic. No network, native, storage, clipboard or account effects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const h = require('./share-screen.check.cjs');
const { setup, item, first, store, calls, publications, rawFile, resolvedFile } = h;
const raw = (value) => [{ ...rawFile, value }];
const resolved = (value) => [{ ...resolvedFile, contentUri: value }];
const A = raw('content://A');
const B = raw('content://B');
const RA = resolved('file:///A.pdf');
const RB = resolved('file:///B.pdf');
function boundary(initial = A) {
  const b = { raw: initial, reads: 0, requests: [], listeners: [], error: null };
  h.useIntakeBoundaries({
    getSharedPayloads() {
      b.reads++;
      if (b.error) throw b.error;
      return b.raw;
    },
    getResolvedSharedPayloadsAsync() {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      b.requests.push({ resolve, reject });
      return promise;
    },
  }, {
    addEventListener(name, fn) {
      assert.equal(name, 'change');
      const listener = { fn, removed: false };
      b.listeners.push(listener);
      return { remove() { listener.removed = true; } };
    },
  });
  b.emit = (state = 'active') => b.listeners.filter((l) => !l.removed).forEach((l) => l.fn(state));
  return b;
}
function IntakeProbe() { return h.jsx('Intake', { value: h.actualIntake() }); }
function probe() {
  const p = h.mount(() => h.jsx(IntakeProbe, {}));
  p.value = () => first(p, 'Intake').value;
  p.render();
  return p;
}
const flush = async (...hosts) => {
  // Flush both the adapter's await and the installed async function in before mode.
  for (let i = 0; i < 6; i++) await Promise.resolve();
  for (const host of hosts) host.render();
};
let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
}
async function main() {
  await check('3051 reviewed catalog values preserved; future peer additions allowed', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'share-intake.baseline.json')));
    for (const lang of ['en', 'fr', 'ar']) {
      const catalog = h.load('@/i18n/' + lang)[lang];
      assert.equal(Object.keys(baseline.catalogs[lang]).length, 3051);
      for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
        assert.equal(crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'), hash, lang + '/' + key);
    }
  });
  for (const oldOutcome of ['success', 'error']) {
    for (const newerFirst of [false, true]) {
      await check(`screen A/B equal count: stale ${oldOutcome}, newerFirst=${newerFirst}`, async () => {
        const b = boundary();
        const screen = setup();
        assert.ok(first(screen, 'ListSkeleton'));
        assert.equal(item(screen, 'submit'), undefined);
        b.raw = B;
        b.emit();
        screen.render();
        assert.equal(b.requests.length, 2);
        if (newerFirst) { b.requests[1].resolve(RB); await flush(screen); }
        if (oldOutcome === 'success') b.requests[0].resolve(RA);
        else b.requests[0].reject(new Error('stale A error'));
        await flush(screen);
        if (!newerFirst) {
          assert.ok(first(screen, 'ListSkeleton'), 'old completion must not end B pending state');
          assert.equal(item(screen, 'submit'), undefined);
          assert.equal(item(screen, 'upload'), undefined);
          assert.deepEqual(store().files, []);
          b.requests[1].resolve(RB);
          await flush(screen);
        }
        assert.equal(store().files[0].uri, RB[0].contentUri);
        assert.ok(item(screen, 'submit'));
        assert.ok(item(screen, 'upload'));
        assert.ok(!publications.some((value) => value.files.some((f) => f.uri === RA[0].contentUri)));
        item(screen, 'submit').onPress();
        assert.deepEqual(calls, [['push', '/share/courses']]);
        screen.unmount();
        assert.ok(b.listeners.every((l) => l.removed));
      });
    }
  }
  for (const outcome of ['success', 'error']) {
    for (const settled of [false, true]) {
      await check(`atomic snapshot survives stale ${outcome}; B settled=${settled}`, async () => {
        const b = boundary(); const p = probe();
        b.raw = B; b.emit(); p.render();
        if (settled) { b.requests[1].resolve(RB); await flush(p); }
        const snapshot = p.value();
        const reads = b.reads;
        if (outcome === 'success') b.requests[0].resolve(RA);
        else b.requests[0].reject(new Error('old'));
        await flush(p);
        assert.equal(p.value(), snapshot, 'old success/error/finalization must publish nothing');
        assert.equal(b.reads, reads);
        assert.equal(p.value().error, null);
        assert.equal(p.value().isResolving, !settled);
        p.unmount();
      });
    }
  }
  await check('screen replay restarts pending work and unmount never publishes or clears', async () => {
    const b = boundary(); const screen = setup();
    screen.replay(); screen.render();
    assert.equal(b.requests.length, 2);
    b.requests[0].resolve(RA); await flush(screen);
    assert.ok(first(screen, 'ListSkeleton'));
    assert.equal(item(screen, 'submit'), undefined);
    b.requests[1].resolve(RB); await flush(screen);
    assert.equal(store().files[0].uri, RB[0].contentUri);
    b.raw = raw('C'); b.emit(); screen.render();
    const count = publications.length;
    screen.unmount();
    b.requests[2].resolve(resolved('file:///C.pdf')); await flush();
    assert.equal(publications.length, count);
    assert.deepEqual(calls, []);
  });
  await check('new intake observation retires screen controls before its next render', async () => {
    const b = boundary(); const screen = setup();
    b.requests[0].resolve(RA); await flush(screen);
    const submit = item(screen, 'submit').onPress;
    const upload = item(screen, 'upload').onPress;
    b.raw = B; b.emit();
    // The old UI can still deliver an event before React commits the next state.
    submit(); upload();
    assert.deepEqual(calls, [], 'observed replacement must retire old entry actions immediately');
    screen.render();
    b.requests[1].resolve(RB); await flush(screen);
    item(screen, 'submit').onPress();
    assert.deepEqual(calls, [['push', '/share/courses']]);
    screen.unmount();
  });
  await check('initial raw is synchronous/coherent; resolution starts only on commit', async () => {
    const b = boundary();
    const p = h.mount(() => h.jsx(IntakeProbe, {}));
    const draft = p.renderOnly();
    const value = h.nodes(draft, 'Intake')[0].value;
    assert.equal(value.sharedPayloads, A);
    assert.deepEqual(value.resolvedSharedPayloads, []);
    assert.equal(value.isResolving, true);
    assert.equal(value.error, null);
    assert.equal(b.requests.length, 0);
    p.abandon();
    assert.equal(b.listeners.length, 0);
    // A different value between render and effect must not be overwritten by A.
    p.renderOnly();
    b.raw = B;
    p.commit();
    p.render();
    assert.equal(first(p, 'Intake').value.sharedPayloads, B);
    assert.equal(b.requests.length, 1);
    p.unmount();
  });
  for (const outcome of ['success', 'error']) {
    await check(`settlement re-read detects changed raw without event (${outcome})`, async () => {
      const b = boundary();
      const p = probe();
      b.raw = B;
      if (outcome === 'success') b.requests[0].resolve(RA);
      else b.requests[0].reject('stale error');
      await flush(p);
      assert.equal(p.value().sharedPayloads, B);
      assert.deepEqual(p.value().resolvedSharedPayloads, []);
      assert.equal(p.value().error, null);
      assert.equal(p.value().isResolving, true);
      assert.equal(b.requests.length, 2);
      b.requests[1].resolve(RB);
      await flush(p);
      assert.equal(p.value().resolvedSharedPayloads, RB);
      p.unmount();
    });
  }
  await check('observed A -> B -> A has three generations, not a value-only completion guard', async () => {
    const b = boundary(); const p = probe();
    b.raw = B; b.emit(); p.render();
    b.raw = A; b.emit(); p.render();
    assert.equal(b.requests.length, 3);
    b.requests[0].resolve(RA); b.requests[1].reject('obsolete');
    await flush(p);
    assert.equal(p.value().isResolving, true);
    assert.equal(p.value().error, null);
    assert.deepEqual(p.value().resolvedSharedPayloads, []);
    const fresh = resolved('file:///new-A.pdf');
    b.requests[2].resolve(fresh); await flush(p);
    assert.equal(p.value().resolvedSharedPayloads, fresh);
    p.unmount();
  });
  await check('dedup pending/success; active/explicit refresh retries failed identical values', async () => {
    const b = boundary(); const p = probe();
    const refresh = p.value().refreshSharePayloads;
    b.emit('background'); b.emit('inactive'); refresh(); b.emit();
    b.raw = A.map((v) => ({ ...v })); b.emit();
    assert.equal(b.requests.length, 1);
    const error = new Error('retry me');
    b.requests[0].reject(error); await flush(p);
    assert.equal(p.value().error, error);
    assert.equal(p.value().isResolving, false);
    refresh(); p.render();
    assert.equal(b.requests.length, 2);
    assert.equal(p.value().error, null);
    b.requests[1].reject('non-Error'); await flush(p);
    assert.ok(p.value().error instanceof Error);
    b.emit(); p.render();
    assert.equal(b.requests.length, 3);
    b.requests[2].resolve(RA); await flush(p);
    const success = p.value();
    refresh(); b.emit(); p.render();
    assert.equal(b.requests.length, 3);
    assert.equal(p.value(), success);
    p.unmount();
  });
  await check('empty transitions retire pending results and errors without resolving empty arrays', async () => {
    const b = boundary([]); const p = probe();
    assert.equal(p.value().isResolving, false);
    assert.equal(b.requests.length, 0);
    b.raw = A; b.emit(); p.render();
    b.raw = []; b.emit(); p.render();
    b.requests[0].resolve(RA); await flush(p);
    assert.deepEqual(p.value().sharedPayloads, []);
    assert.deepEqual(p.value().resolvedSharedPayloads, []);
    assert.equal(p.value().isResolving, false);
    assert.equal(b.requests.length, 1);
    p.unmount();
  });
  await check('field changes, delimiter collisions, duplicates and order are not lost', async () => {
    const collisionA = [{ shareType: 'file', value: 'content://a|b', mimeType: 'c' }];
    const collisionB = [{ shareType: 'file', value: 'content://a', mimeType: 'b|c' }];
    const b = boundary(collisionA); const p = probe();
    const variants = [collisionB, [{ ...collisionB[0], mimeType: 'd' }],
      [{ ...collisionB[0], shareType: 'image' }], [...A, ...B], [...B, ...A], [...A, ...A], A.map((v) => ({ ...v }))];
    for (const [i, values] of variants.entries()) {
      b.raw = values; b.emit(); p.render();
      assert.equal(b.requests.length, i + 2);
      assert.equal(p.value().sharedPayloads, values, 'no array/value normalization');
      assert.deepEqual(p.value().resolvedSharedPayloads, []);
    }
    // Key captured by value also notices a mutation of the native boundary array.
    b.raw[0] = { ...b.raw[0], value: 'literal | {value} العربية %2F' };
    b.emit(); p.render();
    assert.equal(b.requests.length, variants.length + 2);
    p.unmount();
  });
  for (const replay of [false, true]) {
    for (const outcome of ['success', 'error']) {
      await check(`retired effects cannot read/publish: replay=${replay}, ${outcome}`, async () => {
        const b = boundary(raw('A')); const p = probe();
        const refresh = p.value().refreshSharePayloads;
        const oldEvent = b.listeners[0].fn;
        if (replay) { p.replay(); p.render(); } else p.unmount();
        const reads = b.reads, requests = b.requests.length;
        refresh(); oldEvent('active');
        assert.equal(b.reads, reads);
        assert.equal(b.requests.length, requests);
        if (outcome === 'success') b.requests[0].resolve(RA);
        else b.requests[0].reject(new Error('retired'));
        await flush();
        assert.equal(b.reads, reads, 'retired completion must not even read global native state');
        if (replay) {
          p.render();
          assert.equal(p.value().isResolving, true);
          assert.equal(p.value().error, null);
          assert.deepEqual(p.value().resolvedSharedPayloads, []);
          b.requests[1].resolve(RB); await flush(p);
          assert.equal(p.value().resolvedSharedPayloads, RB);
          p.unmount();
        }
        assert.ok(b.listeners.every((l) => l.removed));
      });
    }
  }
  await check('raw read failures invalidate pending work and remain retryable', async () => {
    const b = boundary(); b.error = new Error('read unavailable');
    const p = probe();
    assert.equal(p.value().error, b.error);
    assert.equal(p.value().isResolving, false);
    assert.deepEqual(p.value().sharedPayloads, []);
    b.error = null; p.value().refreshSharePayloads(); p.render();
    assert.equal(b.requests.length, 1);
    b.error = new Error('read failed at settlement');
    b.requests[0].resolve(RA); await flush(p);
    assert.equal(p.value().error, b.error);
    assert.deepEqual(p.value().resolvedSharedPayloads, []);
    assert.deepEqual(p.value().sharedPayloads, []);
    b.error = null; b.emit(); p.render();
    b.error = new Error('refresh failed'); b.emit(); p.render();
    b.requests[1].resolve(RA); await flush(p);
    assert.equal(p.value().error, b.error);
    assert.deepEqual(p.value().resolvedSharedPayloads, []);
    b.error = null; b.emit(); p.render();
    b.requests[2].resolve(RB); await flush(p);
    assert.equal(p.value().resolvedSharedPayloads, RB);
    p.unmount();
  });
  await check('native limitation: unobserved A -> B -> A cannot be identified by JS samples', async () => {
    const b = boundary(raw('A')); const p = probe();
    // Native call captured B before the settlement sample sees A again. The
    // API has no token/argument to prove which OS generation was captured.
    b.raw = raw('B'); b.raw = raw('A');
    b.requests[0].resolve(RB); await flush(p);
    assert.equal(p.value().sharedPayloads[0].value, 'A');
    assert.equal(p.value().resolvedSharedPayloads, RB);
    p.unmount();
  });
  console.log(`Share intake: ${passed} groups passed; ${failed} failed (${process.env.TZ ?? 'default TZ'}).`);
  if (failed) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
