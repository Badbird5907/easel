/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(name, mocks) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, name), 'utf8'), {
    fileName: name, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'exports', code)(id => {
    assert.ok(id in mocks, `Unexpected import ${id}`);
    return mocks[id];
  }, exports);
  return exports;
}
let status = { installed: true, granted: true, connected: true, canPost: true };
const native = { status: () => status };
const bridge = load('canvasBridge.ts', {
  expo: { requireOptionalNativeModule: () => native }, 'react-native': { Platform: { OS: 'android' } },
});
assert.equal(bridge.bridgeLive(), true);
for (const key of Object.keys(status)) {
  status = { installed: true, granted: true, connected: true, canPost: true, [key]: false };
  assert.equal(bridge.bridgeLive(), false, `Polling fallback with ${key} off`);
}
let mirrored, subscription, focus, invalidated;
const account = { id: 'account', host: 'school.example', authMethod: 'pat' };
const settings = { bridgeEnabled: true, bridgeHideCopy: true, updates: { grades: false }, quietHours: { enabled: true, start: 1320, end: 420 } };
const client = {
  getQueryData: () => [{ id: '42', name: 'BIO 201', originalName: 'Biology', code: 'BIO201' }],
  getQueryCache: () => ({ subscribe: () => () => {} }),
  invalidateQueries: ({ predicate }) => { invalidated = predicate; },
};
const runtime = load('canvasBridgeRuntime.ts', {
  '@tanstack/react-query': { useQueryClient: () => client },
  react: { useEffect: fn => fn() },
  'react-native': { AppState: { addEventListener: (_, fn) => { focus = fn; return { remove() {} }; } } },
  '@/canvas/session': { useSession: () => ({ accounts: [account], active: account }) },
  './canvasBridge': { canvasBridge: { sync: s => { mirrored = JSON.parse(s); }, drainChanges: () => JSON.stringify([{ accountId: 'account', category: 'grades', courseId: '42' }]) } },
  './settings': { getSettings: () => settings, settingsStore: { subscribe: fn => { subscription = fn; return () => {}; } } },
});
runtime.useCanvasBridge();
assert.equal(mirrored.bridgeHideCopy, true);
assert.equal(mirrored.updates.grades, false);
assert.equal(mirrored.quietHours.start, 1320);
assert.deepEqual(mirrored.accounts[0].courses[0].names, ['BIO 201', 'Biology', 'BIO201']);
assert.equal(invalidated({ queryKey: ['account', 'grades', '42'] }), true);
assert.equal(invalidated({ queryKey: ['other-account', 'grades', '42'] }), false);
settings.bridgeEnabled = false; subscription(); assert.equal(mirrored.bridgeEnabled, false);
focus('active');
let replaced, switched;
const routing = load('routing.ts', {
  'expo-notifications': {}, 'expo-router': { router: { canDismiss: () => false, replace: p => { replaced = p; } }, useLocalSearchParams: () => ({ accountId: 'account', path: '/course/42/grades' }) },
  react: { useEffect: fn => fn() }, '@/canvas/session': { useSession: () => ({ status: 'ready', accounts: [account], active: account, switchAccount: id => { switched = id; } }) }, '@/features/content/links': {},
});
routing.useBridgedNotificationRouting(); assert.equal(replaced, '/course/42/grades'); assert.equal(switched, undefined);
console.log('Bridge settings mirroring, availability fallback, foreground marker scoping and routing passed');

(async () => {
  for (const [enabled, live, reason, expected] of [[true, true, 'background', 0], [true, false, 'background', 3], [false, true, 'background', 3], [true, true, 'manual', 3]]) {
    let polled = 0, planned = 0, reminders = 0;
    const checkSettings = { bridgeEnabled: enabled, updates: {}, defaultReminderMinutes: null };
    const counter = async () => { polled++; return []; };
    const noop = () => {};
    const checker = load('check.ts', {
      '@/canvas/api/notifications': { fetchStreamChanges: counter, fetchUnreadMessages: counter, fetchUnreadCount: counter, fetchPlannedWork: async () => { planned++; return []; } },
      '@/canvas/client': { CanvasAuthError: class extends Error {} },
      '@/canvas/session': { loadStoredClients: async () => [{ account: { id: 'a' }, client: {} }], isStoredAccountClient: () => true },
      '@/features/reminders/store': { applyDefaultReminders: noop, refreshItems: noop, reloadReminders: noop },
      '@/features/reminders/schedule': { syncReminders: async () => { reminders++; } },
      '@/i18n/account-display': { refreshAccountDisplay: async () => {} }, '@/i18n/account-preferences': {},
      './canvasBridge': { bridgeLive: () => live }, './paths': {}, './platform': {},
      './seen': { reloadSeen: noop, updateBadge: async () => {}, seenFor: () => ({ get: () => ({ baseline: null }), set: noop }) },
      './settings': { getSettings: () => checkSettings, settingsStore: { reload: noop }, metaStore: { reload: noop, set: noop, get: () => ({ lastCheckAt: null }) } },
    });
    await checker.checkForUpdates(reason);
    assert.equal(polled, expected, `${enabled}/${live}/${reason}: push polling`);
    assert.equal(planned, 1, 'Planner remains available for due-date changes');
    assert.equal(reminders, 1, 'Reminders remain scheduled');
  }
  console.log('Live bridge skips three push-covered fetches; disconnect/off/manual restore them; reminders retained');
})().catch(error => { console.error(error); process.exitCode = 1; });
