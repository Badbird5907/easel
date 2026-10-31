import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CanvasClient } from '../../canvas/client';
import { setAccountLocale, getLocaleState } from '../runtime';
import { setDisplayTimeZone, displayTimeZone, deviceTimeZone, dayBoundary } from '../../lib/dates';
import {
  accountDateContext,
  recordDisplayPreferences,
  removeDisplayPreferences,
} from '../account-preferences';
import { refreshAccountDisplay, observeAccountDisplay } from '../account-display';
import { reminderText } from '../../features/reminders/model';
import { addReminder, removeAccountReminders } from '../../features/reminders/store';
import { syncReminders } from '../../features/reminders/schedule';
import { buildNextDue, buildTodo, nextDueTimeline, buildGrades, buildAnnouncements } from '../../features/widgets/build';
import { refreshWidgets } from '../../features/widgets/publish';
import { widgetMetaStore } from '../../features/widgets/settings';
import { checkForUpdates } from '../../features/notifications/check';
import * as mock from './background.stubs.mjs';
import { seenFor } from '../../features/notifications/seen';
import * as dates from '../../lib/dates';
import { applyTimeZone } from '../../features/settings/timeZone';
import { presentNow as publishNative } from '../../features/notifications/platform';
const turn = () => new Promise((r) => setTimeout(r, 0));
const defer = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const now = new Date('2030-01-01T23:30:00Z'),
  realNow = Date.now;
Date.now = () => +now;
const profiles = {
  A: { effective_locale: 'fr', time_zone: 'America/Los_Angeles' },
  B: { effective_locale: 'ar', time_zone: 'Asia/Tokyo' },
};
let gate = null,
  count = 0,
  offline = false;
const server = createServer(async (req, res) => {
  const id = req.headers.authorization?.split(' ')[1],
    value = { ...profiles[id] };
  count++;
  if (gate) await gate.promise;
  res.setHeader('content-type', 'application/json');
  if (offline) {
    res.writeHead(503);
    res.end('{}');
    return;
  }
  res.end(JSON.stringify({ id, name: id, ...value }));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const A = { account: { id: 'A', user: { id: 'A' }, host: 'a.test' }, client: new CanvasClient(base, 'A') };
const B = { account: { id: 'B', user: { id: 'B' }, host: 'b.test' }, client: new CanvasClient(base, 'B') };
mock.clients.push(A, B);
try {
  for (const locale of ['en', 'fr', 'ar']) {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      setAccountLocale('parity', locale);
      setDisplayTimeZone(zone);
      const scoped = dates.createDateContext(locale, zone);
      for (const instant of ['2026-03-08T09:30:00Z', '2026-11-01T09:30:00Z', '2027-01-01T00:30:00Z']) {
        const date = new Date(instant),
          reference = new Date(+date - 9 * 3600000);
        for (const fn of [
          'daysFrom',
          'dayLabel',
          'formatTime',
          'formatShortDate',
          'formatDueDate',
          'dueIn',
          'relativeAge',
        ])
          assert.equal(
            scoped[fn](date, reference),
            {
              daysFrom: dates.daysFrom,
              dayLabel: dates.dayLabel,
              formatTime: dates.formatTime,
              formatShortDate: dates.formatShortDate,
              formatDueDate: dates.formatDueDate,
              dueIn: dates.dueIn,
              relativeAge: dates.relativeAge,
            }[fn](date, reference),
          );
      }
    }
  }
  assert.equal(dates.createDateContext('bad_locale_!', 'Mars/City').locale, 'en');
  assert.equal(dates.createDateContext(null, 'Mars/City').timeZone, deviceTimeZone());
  console.log('PASS scoped/default presentation parity across DST/year boundaries and three zones/locales');
  setAccountLocale('foreground', 'en');
  setDisplayTimeZone('Europe/Paris');
  const foreground = getLocaleState();
  assert.equal(accountDateContext('cold').locale, 'en');
  assert.equal(accountDateContext('cold').timeZone, deviceTimeZone());
  await Promise.all([
    refreshAccountDisplay(A.account, A.client),
    refreshAccountDisplay(B.account, B.client),
    refreshAccountDisplay(A.account, A.client),
  ]);
  assert.equal(count, 4, 'coalesced: two real HTTP profile endpoints per account');
  const a = accountDateContext('A'),
    b = accountDateContext('B'),
    due = new Date('2030-01-02T09:00:00Z');
  const announcement = { id: 'tagged', title: 'Unknown', courseId: null, author: { name: 'Unknown', avatarUrl: null },
    postedAt: now, unread: false, html: '', preview: '', htmlUrl: '' };
  for (const display of [a, b]) {
    const rows = buildAnnouncements([
      { ...announcement, authorNameFallback: 'unknown' },
      { ...announcement, id: 'legacy' },
      { ...announcement, id: 'supplied', author: { name: 'Unknown', avatarUrl: null }, authorNameFallback: undefined },
      { ...announcement, id: 'future', authorNameFallback: 'future' },
    ], null, now, display).rows;
    assert.deepEqual(rows.map(row => row.context), [display.t('discussions.unknownAuthor'), 'Unknown', 'Unknown', 'Unknown']);
    assert.ok(rows.every(row => row.title === 'Unknown'));
    assert.equal(getLocaleState(), foreground);
  }
  assert.deepEqual(Object.keys(JSON.parse(mock.disk.get('account-display:A'))).sort(), [
    'effectiveLocale',
    'timeZone',
  ]);
  assert.equal(a.locale, 'fr');
  assert.equal(b.locale, 'ar');
  assert.equal(a.daysFrom(due, now), 1);
  assert.equal(b.daysFrom(due, now), 0);
  assert.notEqual(a.dueIn(due, now), b.dueIn(due, now));
  assert.equal(getLocaleState(), foreground);
  assert.equal(displayTimeZone(), 'Europe/Paris');
  applyTimeZone({ getQueryCache: () => ({ findAll: () => [] }) }, 'obsolete-account', 'Pacific/Honolulu');
  assert.equal(
    displayTimeZone(),
    'Europe/Paris',
    'late Settings callback cannot change another account zone',
  );
  offline = true;
  await refreshAccountDisplay(A.account, A.client);
  offline = false;
  assert.equal(accountDateContext('A').locale, 'fr');
  console.log('PASS real local HTTP profile mapping/coalescing, cold/offline fallback, two locales/zones');
  gate = defer();
  const delayed = refreshAccountDisplay(A.account, A.client);
  for (let attempt = 0; count < 8 && attempt < 100; attempt++) await turn();
  assert.equal(count, 8);
  observeAccountDisplay('A', A.client, { effectiveLocale: 'ar', timeZone: 'UTC' });
  setAccountLocale('B', 'ar');
  setDisplayTimeZone('Asia/Tokyo');
  gate.resolve();
  gate = null;
  await delayed;
  assert.equal(accountDateContext('A').locale, 'ar');
  assert.equal(accountDateContext('A').timeZone, 'UTC');
  assert.equal(accountDateContext('B').timeZone, 'Asia/Tokyo');
  recordDisplayPreferences('A', { effectiveLocale: 'fr', timeZone: 'America/Los_Angeles' });
  const item = { id: 'assignment_1', title: 'Essay', dueAt: +due, courseId: null, url: null };
  for (const entry of [A, B]) addReminder(entry.account.id, item, { type: 'at', at: +now + 60_000 });
  await syncReminders();
  for (const entry of [A, B]) {
    const notice = [...mock.scheduled.values()].find((n) => n.data.accountId === entry.account.id);
    assert.equal(
      notice.text.body,
      reminderText(item, +now + 60_000, accountDateContext(entry.account.id)).body,
    );
  }
  const oldB = [...mock.scheduled.values()].find((n) => n.data.accountId === 'B').identifier;
  recordDisplayPreferences('A', { effectiveLocale: 'en', timeZone: 'UTC' });
  await syncReminders();
  assert.ok(mock.scheduled.has(oldB));
  assert.equal(mock.scheduled.size, 2);
  const scheduledBeforeLock = [...mock.scheduled.keys()].sort();
  mock.unavailableCredentials.add('A');
  assert.equal((await mock.loadStoredClients()).some((s) => s.account.id === 'A'), false);
  await syncReminders();
  assert.deepEqual([...mock.scheduled.keys()].sort(), scheduledBeforeLock, 'locked credentials retain local reminders');
  mock.unavailableCredentials.delete('A');
  mock.setIndexUnavailable(true);
  await syncReminders();
  assert.deepEqual([...mock.scheduled.keys()].sort(), scheduledBeforeLock, 'unknown account index never cancels reminders');
  mock.setIndexUnavailable(false);
  const workItem = {
    ...item,
    dueAt: due,
    kind: 'assignment',
    plannableId: '1',
    plannableType: 'assignment',
    status: 'todo',
    dismissed: false,
  };
  assert.notEqual(
    buildNextDue([workItem], [], now, a).headline,
    buildNextDue([workItem], [], now, b).headline,
  );
  assert.equal(buildTodo([workItem], [], now, a).summary, '1 due tomorrow');
  assert.equal(buildTodo([workItem], [], now, b).summary, '1 due today');
  assert.ok(
    nextDueTimeline([workItem], [], now, a).some((e) => +e.date === +dayBoundary(now, 1, a.timeZone) + 1000),
  );
  assert.deepEqual(buildGrades([], [], false).rows, []);
  console.log(
    'PASS delayed metadata loses to foreground refresh; scoped reminders/dedupe/widget day grouping and timeline',
  );
  const planned = {
    reminderId: 'assignment_new',
    assignmentReminderId: null,
    title: 'New work',
    dueAt: +due,
    gradable: true,
    done: false,
    updatedAt: +now,
    plannableType: 'assignment',
    plannableId: 'new',
    courseId: null,
    contextName: null,
    htmlUrl: null,
  };
  await checkForUpdates('manual');
  assert.equal(mock.delivered.length, 0);
  mock.work.set(A.client, [planned]);
  mock.work.set(B.client, [planned]);
  await checkForUpdates('manual');
  assert.equal(mock.delivered.length, 2);
  assert.match(mock.delivered[0].text.body, /Nouveau/);
  assert.match(mock.delivered[1].text.body, /واجب/);
  await checkForUpdates('manual');
  assert.equal(mock.delivered.length, 2);
  assert.equal((await checkForUpdates('foreground')).throttled, true);
  assert.equal(getLocaleState().accountId, 'B');
  assert.equal(displayTimeZone(), 'Asia/Tokyo');
  console.log(
    'PASS notification loop: account dates, silent baselines, dedupe, foreground throttling (mock delivery)',
  );
  mock.widgetItems.set(A.client, [workItem]);
  mock.widgetItems.set(B.client, [workItem]);
  widgetMetaStore.set({ accountId: 'A', fetchedAt: null });
  await refreshWidgets();
  assert.equal(
    +mock.widgetRanges.get(A.client).start,
    +dayBoundary(new Date(), -14, 'America/Los_Angeles'),
    'widget planner range uses the fetched target profile, not the foreground Tokyo zone',
  );
  const lastNext = () => mock.widgetWrites.findLast((n) => n.name === 'next').props;
  assert.equal(
    lastNext().headline,
    buildNextDue([workItem], [], new Date(), accountDateContext('A')).headline,
  );
  recordDisplayPreferences('A', { effectiveLocale: 'ar', timeZone: 'Asia/Tokyo' });
  assert.equal(
    lastNext().headline,
    buildNextDue([workItem], [], new Date(), accountDateContext('A')).headline,
  );
  const hold = defer();
  mock.setWorkGate(hold.promise);
  const pending = refreshWidgets();
  await turn();
  const before = mock.widgetWrites.length;
  widgetMetaStore.set({ accountId: 'B', fetchedAt: null });
  hold.resolve();
  await pending;
  assert.equal(mock.widgetWrites.length, before);
  mock.setWorkGate(null);
  gate = defer();
  const late = refreshAccountDisplay(A.account, A.client);
  const lateWork = defer();
  mock.setWorkGate(lateWork.promise);
  const lateCheck = checkForUpdates('manual');
  await turn();
  mock.clients.splice(mock.clients.indexOf(A), 1);
  removeDisplayPreferences('A');
  removeAccountReminders('A');
  seenFor('A').clear();
  const replacement = { account: A.account, client: new CanvasClient(base, 'A') };
  mock.clients.push(replacement);
  lateWork.resolve();
  mock.setWorkGate(null);
  gate.resolve();
  gate = null;
  await late;
  await lateCheck;
  assert.equal(mock.disk.has('seen:A'), false, 'late check cannot resurrect baseline/watermarks');
  mock.clients.splice(mock.clients.indexOf(replacement), 1);
  assert.equal(accountDateContext('A').locale, 'en');
  assert.equal(mock.disk.has('account-display:A'), false);
  await syncReminders();
  assert.ok([...mock.scheduled.values()].every((n) => n.data.accountId !== 'A'));
  addReminder('B', { ...item, id: 'assignment_2' }, { type: 'at', at: +now + 120_000 });
  const native = defer();
  mock.setSchedulingGate(native.promise);
  const syncing = syncReminders();
  await turn();
  B.account.expired = true;
  native.resolve();
  await syncing;
  mock.setSchedulingGate(null);
  await syncReminders();
  assert.equal(mock.scheduled.size, 0);
  mock.Platform.OS = 'android';
  let valid = true;
  const channelHold = defer();
  mock.setChannelGate(channelHold.promise);
  const duringChannels = publishNative({ title: 'Synthetic', body: 'Synthetic' }, { kind: 'messages', accountId: 'B', path: null }, () => valid);
  await turn();
  valid = false;
  channelHold.resolve();
  assert.equal(await duringChannels, false);
  assert.equal(mock.publications.length, 0, 'removed during channel setup: no publication');
  mock.setChannelGate(null);
  valid = true;
  const publicationHold = defer();
  mock.setPublicationGate(publicationHold.promise);
  const duringPublication = publishNative({ title: 'Synthetic', body: 'Synthetic' }, { kind: 'messages', accountId: 'B', path: null }, () => valid);
  await turn();
  valid = false;
  publicationHold.resolve();
  assert.equal(await duringPublication, false);
  const lateId = mock.publications.at(-1).id;
  assert.ok(mock.cancelled.includes(lateId));
  assert.ok(mock.dismissed.includes(lateId), 'late native completion is cancelled and dismissed');
  mock.setPublicationGate(null);
  mock.Platform.OS = 'ios';
  console.log(
    'PASS widget switch guard, cleanup/late profile, expired-account scheduling cancellation (mock native/storage/session)',
  );
  assert.equal(getLocaleState().accountId, 'B');
  assert.equal(displayTimeZone(), 'Asia/Tokyo');
} finally {
  Date.now = realNow;
  server.close();
}
