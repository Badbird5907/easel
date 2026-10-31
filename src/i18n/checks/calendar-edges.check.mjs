/** Production reminder/date helpers and device export titles; all native calendar/storage calls are mocked. */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const output = mkdtempSync(resolve(tmpdir(), 'easel-calendar-edges-'));
const stub = String.raw`
const state = () => globalThis.__calendarEdges;
export const Platform = { OS: 'ios' };
export const Linking = { openURL: async () => { throw new Error('Not exercised'); } };
export const EntityTypes = { EVENT: 'event' };
export const requestCalendarPermissions = async () => { throw new Error('Not exercised'); };
export const getCalendars = async () => { throw new Error('Not exercised'); };
export const ExpoCalendar = {
  get: async (calendarId) => {
    state().onGet?.();
    return {
      createEvent: async (details) => {
        if (state().failTitle === details.title) throw new Error('Synthetic native failure');
        const id = 'native-' + ++state().sequence;
        state().events.set(id, { calendarId, details });
        state().calls.push({ operation: 'create', calendarId, id, details });
        return { id };
      },
    };
  },
};
export const ExpoCalendarEvent = {
  get: async (id) => {
    if (!state().events.has(id)) throw new Error('Missing mock event');
    return {
      update: async (details) => {
        state().events.get(id).details = details;
        state().calls.push({ operation: 'update', id, details });
      },
    };
  },
};
export class JsonStore {
  constructor(key, fallback) { this.key = key; this.fallback = fallback; }
  get() { return state().stores.get(this.key) ?? this.fallback(); }
  set(value) { state().stores.set(this.key, value); }
}
`;
const cases = String.raw`
import assert from 'node:assert/strict';
import { presetOffsets, offsetLabel, formatMoment, describeReminder, fireTime, sortReminders, reminderText } from '@/features/reminders/model';
import { copyToDeviceCalendar } from '@/features/calendar/deviceCalendar';
import { deviceEventDates } from '@/features/calendar/exportDates';
import { createDateContext, setDisplayTimeZone } from '@/lib/dates';
import { createTranslator, setAccountLocale, displayLocale } from '@/i18n/runtime';
import { en } from '@/i18n/en';
import { fr } from '@/i18n/fr';
import { ar } from '@/i18n/ar';

const native = globalThis.__calendarEdges = {
  stores: new Map(), events: new Map(), calls: [], sequence: 0, onGet: null, failTitle: null,
};
const locales = ['en-US', 'fr-CA', 'ar-EG', 'en-US'];
const numbers = [0, 1, 2, 3, 11, 100];
const dueAt = Date.parse('2026-11-01T06:30:00Z');
const item = { id: 'assignment_1', title: 'Canvas authored عنوان', dueAt, courseId: 'course', url: '/assignments/1' };
const reminders = [
  { id: 'fixed', type: 'at', at: dueAt - 900_000, source: 'user' },
  { id: 'offset', type: 'before', minutes: 60, source: 'user' },
];
const snapshot = JSON.stringify({ item, reminders, presetOffsets });
assert.deepEqual(presetOffsets, [{ minutes: 15 }, { minutes: 60 }, { minutes: 1440 }, { minutes: 2880 }]);
setDisplayTimeZone('America/New_York');
for (const locale of locales) {
  setAccountLocale('reminder-check', locale);
  const t = createTranslator(locale);
  const display = createDateContext(locale, 'America/New_York');
  const catalog = locale.startsWith('fr') ? fr : locale.startsWith('ar') ? ar : en;
  for (const [minutes, key, count] of [
    [15, 'reminder.minutesBefore', 15], [60, 'reminder.hoursBefore', 1],
    [1440, 'reminder.daysBefore', 1], [2880, 'reminder.daysBefore', 2],
    [1, 'reminder.minutesBefore', 1], [30, 'reminder.minutesBefore', 30],
    [120, 'reminder.hoursBefore', 2], [4320, 'reminder.daysBefore', 3],
  ]) {
    assert.equal(offsetLabel(minutes, t), t(key, { count }));
    assert.equal(offsetLabel(minutes), offsetLabel(minutes, t));
    assert.ok(offsetLabel(minutes, t).includes(new Intl.NumberFormat(locale).format(count)));
    assert.ok(!offsetLabel(minutes, t).includes('{count}'));
  }
  for (const key of ['reminder.count', 'reminder.minutesBefore', 'reminder.hoursBefore', 'reminder.daysBefore', 'calendarFeed.copied', 'calendarFeed.copyCount']) {
    for (const count of numbers) {
      const rules = new Intl.PluralRules(locale.split('-')[0]);
      const template = catalog[key][rules.select(count)] ?? catalog[key].other;
      const calendar = 'Family عنوان';
      const expected = template.replaceAll('{count}', new Intl.NumberFormat(locale).format(count))
        .replaceAll('{calendar}', locale.startsWith('ar') ? '\u2068' + calendar + '\u2069' : calendar);
      assert.equal(t(key, { count, calendar }), expected);
    }
  }
  const now = new Date();
  assert.equal(formatMoment(now.getTime(), { midSentence: true, display }),
    t('date.at', { day: t('date.todayLower'), time: display.formatTime(now) }));
  assert.equal(formatMoment(dueAt, { display }), display.formatDueDate(new Date(dueAt)));
  assert.equal(formatMoment(dueAt), formatMoment(dueAt, { display }));
  assert.equal(describeReminder(reminders[0], display), formatMoment(reminders[0].at, { display }));
  assert.equal(describeReminder(reminders[1], display), offsetLabel(60, t));
  assert.equal(fireTime(reminders[0], item), dueAt - 900_000);
  assert.equal(fireTime(reminders[1], item), dueAt - 3_600_000);
  assert.equal(fireTime(reminders[1], { dueAt: null }), null);
  assert.deepEqual(sortReminders(reminders, item).map(({ id }) => id), ['offset', 'fixed']);
  assert.deepEqual(sortReminders(reminders, { ...item, dueAt: null }).map(({ id }) => id), ['fixed', 'offset']);
  assert.equal(reminderText(item, dueAt - 3_600_000, display).title, item.title);
  assert.ok(!t('reminder.defaultHint', { offset: offsetLabel(60, t) }).includes('{offset}'));
  assert.equal(JSON.stringify({ item, reminders, presetOffsets }), snapshot);
}
assert.equal(offsetLabel(1, createTranslator('en')), '1 minute before');
assert.equal(offsetLabel(120, createTranslator('en')), '2 hours before');
assert.equal(offsetLabel(4320, createTranslator('fr')), '3 jours avant');
const scoped = createDateContext('fr-CA', 'Asia/Kathmandu');
const scopedLabel = formatMoment(dueAt, { display: scoped });
setAccountLocale('other', 'ar');
setDisplayTimeZone('Pacific/Honolulu');
assert.equal(formatMoment(dueAt, { display: scoped }), scopedLabel);
assert.equal(scopedLabel, scoped.formatDueDate(new Date(dueAt)));

// Title-only export localization with real production date payloads and mocked native storage.
setDisplayTimeZone('America/New_York');
const work = { id: 'work', kind: 'assignment', title: 'Student title عنوان', start: new Date(dueAt), end: null,
  allDay: false, allDayDate: null, location: 'Room A', contextName: 'Canvas course', htmlUrl: 'https://canvas.invalid/assignments/1' };
const event = { ...work, id: 'event', kind: 'event', title: 'Unchanged event', allDay: true, allDayDate: '2026-11-01' };
const note = { ...work, id: 'note', kind: 'note', title: 'Unchanged note' };
const inputSnapshot = JSON.stringify([work, event, note]);
for (const [index, locale] of locales.entries()) {
  const t = createTranslator(locale);
  const account = 'export-' + index;
  setAccountLocale(account, locale);
  native.calls = [];
  // A different viewing locale after the first await must not alter this export's captured labels.
  native.onGet = () => setAccountLocale('other-account', locale.startsWith('fr') ? 'ar' : 'fr');
  assert.deepEqual(await copyToDeviceCalendar(account, 'device', [work, event, note]), { copied: 3, failed: 0 });
  assert.equal(native.calls.length, 3);
  assert.equal(native.calls[0].details.title, t('calendarFeed.dueTitle', { title: work.title }));
  assert.equal(native.calls[1].details.title, event.title);
  assert.equal(native.calls[2].details.title, note.title);
  for (const [position, source] of [work, event, note].entries()) {
    const { title, ...payload } = native.calls[position].details;
    assert.deepEqual(payload, {
      ...deviceEventDates(source, 'ios'), location: source.location,
      notes: source.contextName + '\n' + source.htmlUrl, url: source.htmlUrl,
    });
  }
  native.calls = [];
  assert.deepEqual(await copyToDeviceCalendar(account, 'device', [work], t), { copied: 1, failed: 0 });
  assert.equal(native.calls[0].operation, 'update');
  assert.equal(native.calls[0].details.title, t('calendarFeed.dueTitle', { title: work.title }));
  assert.ok(native.stores.has('calendar:exported:' + account));
  assert.equal(displayLocale(), locale.startsWith('fr') ? 'ar' : 'fr');
}
assert.equal(native.stores.size, 4);
assert.equal(JSON.stringify([work, event, note]), inputSnapshot);
native.failTitle = event.title;
assert.deepEqual(await copyToDeviceCalendar('partial', 'device', [work, event], createTranslator('fr')), { copied: 1, failed: 1 });
assert.ok(native.stores.get('calendar:exported:partial').work);
assert.equal(native.stores.get('calendar:exported:partial').event, undefined);
setAccountLocale(null);
setDisplayTimeZone(null);
console.log('Calendar edge checks passed: presets, plurals, scoped moments, scheduling invariance, export titles/payloads/account stores (native calls mocked)');
`;

try {
  await build({
    stdin: { contents: cases, resolveDir: root, sourcefile: 'calendar-edges.cases.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: resolve(output, 'check.mjs'),
    tsconfig: resolve(root, 'tsconfig.json'),
    plugins: [{
      name: 'mock-calendar-boundaries',
      setup(b) {
        b.onResolve({ filter: /^(react-native|expo-calendar|@\/features\/notifications\/storage)$/ }, () => ({ path: 'native', namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: stub, loader: 'js' }));
      },
    }],
  });
  await import(pathToFileURL(resolve(output, 'check.mjs')).href);
} finally {
  rmSync(output, { recursive: true, force: true });
}
