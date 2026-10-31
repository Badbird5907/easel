/** Production adapters with synthetic Canvas responses. Query/session/client/native storage boundaries mocked. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const output = mkdtempSync(resolve(tmpdir(), 'easel-appointment-notifications-'));
const root = process.cwd();
const stub = `
export const useQueryClient = () => ({ invalidateQueries: async () => {} });
export const useAccountKey = () => 'synthetic-account-A';
export const useCanvasQuery = (key, fetcher, options) => ({ key, fetcher, options });
export const useCanvasMutation = (mutation) => mutation;
export const useCanvas = () => ({ account: { baseUrl: 'https://canvas.invalid' } });
export class CanvasError extends Error { constructor(status, message) { super(message); this.status = status; } }
export class JsonStore { constructor(_key, fallback) { this.value = fallback(); } get() { return this.value; } }
`;
try {
  await build({
    stdin: { contents: `export * from './src/canvas/api/preferences'; export * from './src/canvas/api/appointments'; export * from './src/features/notifications/settings'; export { CanvasError } from './src/canvas/client';`, resolveDir: root, loader: 'ts' },
    outfile: resolve(output, 'adapters.mjs'), bundle: true, platform: 'node', format: 'esm',
    packages: 'external', tsconfig: resolve(root, 'tsconfig.json'),
    plugins: [{ name: 'native-query-boundaries', setup(b) {
      b.onResolve({ filter: /^@tanstack\/react-query$|^\.\.\/(query|session|client)$|\/canvas\/client$|^\.\/storage$/ }, () => ({ path: 'boundaries', namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: stub, loader: 'js' }));
    } }],
  });
  // Use React from this workspace even when the generated bundle lives in /tmp.
  // esbuild's external import is resolved by a local file URL.
  const { writeFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const file = resolve(output, 'adapters.mjs');
  writeFileSync(file, readFileSync(file, 'utf8').replace(/from "react"/g, `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`));
  const api = await import(pathToFileURL(file).href);
  const calls = [];
  const fixtures = [
    { notification: 'New Event', category: 'calendar', frequency: 'weekly' },
    { notification: 'New Message', category: 'conversation_message', frequency: 'daily' },
    { notification: 'Due Date Changed', category: 'due_date', frequency: 'immediately' },
    { notification: 'Due Date Changed Again', category: 'due_date', frequency: 'never' },
    { notification: 'School Notify', category: 'ÉCOLE_Custom', frequency: 'daily' },
    { notification: 'Reserved Name', category: '__proto__', frequency: 'weekly' },
    ...['all_submissions', 'registration', 'summaries', 'migration', 'late_grading', 'student_appointment_signups'].map(category => ({ notification: category, category, frequency: 'never' })),
  ];
  const fakeClient = {
    get: async (...args) => { calls.push(['get', ...args]); return { notification_preferences: fixtures }; },
    put: async (...args) => { calls.push(['put', ...args]); },
  };
  const groups = await api.fetchPreferences(fakeClient, 'channel-1');
  assert.equal(calls[0][1], '/api/v1/users/self/communication_channels/channel-1/notification_preferences');
  assert.deepEqual(groups.map(g => g.id), ['course', 'inbox', 'scheduling', 'other']);
  const due = groups[0].categories[0];
  assert.equal(due.id, 'due_date');
  assert.equal(due.frequency, 'immediately');
  assert.deepEqual(due.notifications, ['Due Date Changed', 'Due Date Changed Again']);
  assert.equal(groups[3].categories.find(c => c.id === 'ÉCOLE_Custom').rawTitle, 'ÉCOLE_Custom');
  assert.equal(groups[3].categories.find(c => c.id === '__proto__').groupId, 'other');
  assert.equal(groups.flatMap(g => g.categories).length, 5);
  await api.updateCategory(fakeClient, 'channel-1', due, 'weekly');
  assert.deepEqual(calls[1], ['put', '/api/v1/users/self/communication_channels/channel-1/notification_preferences', {
    notification_preferences: { 'Due Date Changed': { frequency: 'weekly' }, 'Due Date Changed Again': { frequency: 'weekly' } },
  }]);
  assert.deepEqual(api.frequenciesFor('email'), ['immediately', 'daily', 'weekly', 'never']);
  for (const type of ['push', 'sms']) assert.deepEqual(api.frequenciesFor(type), ['immediately', 'never']);
  const reserve = api.useReserveSlot();
  const params = { slot: { id: 'slot', reserveUrl: '/api/v1/calendar_events/slot/reservations/person' }, comments: '  User NOTE  ', replaceExisting: true };
  await reserve({ post: async (...args) => calls.push(['post', ...args]) }, params);
  assert.deepEqual(calls[2], ['post', '/api/v1/calendar_events/slot/reservations/person', { comments: 'User NOTE', cancel_existing: true }]);
  for (const [status, reason] of [[400, 'unavailable'], [403, 'started']]) {
    await assert.rejects(reserve({ post: async () => { throw new api.CanvasError(status, 'Server'); } }, params), e => e instanceof api.ReservationError && e.reason === reason);
  }
  const serverError = new api.CanvasError(500, 'SERVER raw CASE');
  await assert.rejects(reserve({ post: async () => { throw serverError; } }, params), e => e === serverError);
  const quiet = { enabled: true, start: 1320, end: 420 };
  for (const [h, m, expected] of [[21, 59, false], [22, 0, true], [0, 0, true], [6, 59, true], [7, 0, false]])
    assert.equal(api.inQuietHours(new Date(2026, 2, 8, h, m), quiet), expected);
  console.log('Production preference grouping/filtering/payloads, reservation payload/reasons and local quiet-hours passed (synthetic clients; no real writes).');
} finally { rmSync(output, { recursive: true, force: true }); }
