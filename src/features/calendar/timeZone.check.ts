/** Run with TZ=UTC (and America/Los_Angeles, Asia/Tokyo) node_modules/.bin/tsx src/features/calendar/timeZone.check.ts. */
import type { CalendarItem, PersonalEventInput } from '@/canvas/api/calendar';
import type { WorkItem } from '@/canvas/models';
import {
  addDays,
  dateParts,
  dayKey,
  daysFrom,
  formatDate,
  fromDayKey,
  fromWallTime,
  mergeDateTime,
  setDisplayTimeZone,
  startOfDay,
} from '@/lib/dates';
import { groupByDue } from '@/lib/due';
import { countDueNow } from '@/features/planner/dueCount';
import { rangeFor } from '@/features/planner/filters';
import { upcomingRange } from '@/features/planner/range';
import { androidPickerValue, mergeAndroidPicker } from '@/features/planner/pickerDates';
import { daysOf, eventBody, projectAllDay } from './eventDates';
import { deviceEventDates, exportRange } from './exportDates';
import { addMonths, gridRange, monthWeeks, startOfMonth, weekDays } from './month';
import { buildRule, occurrences, parseRule } from './recurrence';
import { allDayItems, layoutDay, minutesOf } from './timeGrid';

// No Node types/dependencies: checks also compile with the app's tsconfig.
const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const assert = { equal, deepEqual: equal, ok: (value: unknown) => equal(!!value, true) };

const iso = (d: Date) => d.toISOString();
const d = (s: string) => new Date(s);
const item = (start: string, end: string | null = null): CalendarItem => ({
  id: start,
  kind: 'event',
  title: 'Event',
  contextCode: 'user_1',
  courseId: null,
  contextName: null,
  start: d(start),
  end: end ? d(end) : null,
  allDay: false,
  location: null,
  htmlUrl: null,
  eventId: '1',
  noteId: null,
  appointment: false,
  done: false,
  points: null,
});
const work = (due: string, overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: due,
  plannableId: due,
  plannableType: 'assignment',
  kind: 'assignment',
  title: 'Work',
  courseId: null,
  contextName: null,
  dueAt: d(due),
  points: null,
  status: 'open',
  late: false,
  excused: false,
  hasFeedback: false,
  markedComplete: false,
  dismissed: false,
  overrideId: null,
  htmlUrl: null,
  newActivity: false,
  ...overrides,
});

// Midnight/year boundaries and fractional offsets, independent of device timezone.
for (const [zone, instant, key, midnight] of [
  ['America/Los_Angeles', '2027-01-01T07:30:00Z', '2026-12-31', '2026-12-31T08:00:00.000Z'],
  ['Pacific/Kiritimati', '2026-12-31T10:30:00Z', '2027-01-01', '2026-12-31T10:00:00.000Z'],
  ['Asia/Kathmandu', '2026-12-31T18:30:00Z', '2027-01-01', '2026-12-31T18:15:00.000Z'],
  ['America/St_Johns', '2027-01-01T03:00:00Z', '2026-12-31', '2026-12-31T03:30:00.000Z'],
]) {
  setDisplayTimeZone(zone);
  assert.equal(dayKey(d(instant)), key);
  assert.equal(iso(startOfDay(d(instant))), midnight);
  assert.equal(dayKey(fromDayKey(key)), key);
  assert.equal(dateParts(d(instant)).year, Number(key.slice(0, 4)));
}

setDisplayTimeZone('America/New_York');
const spring = fromDayKey('2026-03-08');
const fall = fromDayKey('2026-11-01');
assert.equal(iso(spring), '2026-03-08T05:00:00.000Z');
assert.equal(iso(addDays(spring, 1)), '2026-03-09T04:00:00.000Z');
assert.equal((+addDays(spring, 1) - +spring) / 3600000, 23);
assert.equal((+addDays(fall, 1) - +fall) / 3600000, 25);
assert.equal(daysFrom(addDays(spring, 1), spring), 1);
assert.equal(
  iso(fromWallTime({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 })),
  '2026-03-08T07:30:00.000Z',
);
assert.equal(
  iso(fromWallTime({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 })),
  '2026-11-01T05:30:00.000Z',
);
assert.equal(
  iso(mergeDateTime(d('2026-11-01T06:30Z'), d('2026-11-01T06:30Z'), 'time')),
  '2026-11-01T06:30:00.000Z',
);

assert.equal(iso(startOfMonth(spring)), '2026-03-01T05:00:00.000Z');
assert.equal(iso(addMonths(spring, 1)), '2026-04-01T04:00:00.000Z');
assert.equal(iso(gridRange(spring).start), '2026-03-01T05:00:00.000Z');
assert.equal(iso(gridRange(spring).end), '2026-04-05T03:59:59.999Z');
assert.equal(monthWeeks(spring).flat().length, 35);
assert.deepEqual(
  weekDays(spring).map((date) => dayKey(date)),
  ['2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14'],
);
assert.equal(iso(upcomingRange(spring).end), '2026-04-05T04:00:00.000Z');
assert.equal(iso(exportRange(spring).start), '2026-03-08T05:00:00.000Z');
assert.equal(iso(exportRange(spring).end), '2026-04-05T04:00:00.000Z');
assert.equal(iso(rangeFor('week', spring).end), '2026-03-15T04:00:00.000Z');

const crossing = item('2027-01-01T04:30Z', '2027-01-01T05:30Z');
assert.deepEqual(daysOf(crossing), ['2026-12-31', '2027-01-01']);
assert.equal(minutesOf(crossing.start), 1410);
assert.equal(layoutDay([crossing], fromDayKey('2026-12-31'))[0].top, 1410);
assert.equal(layoutDay([crossing], fromDayKey('2027-01-01'))[0].bottom, 30);
assert.equal(layoutDay([item('2026-03-08T07:30Z')], spring)[0].top, 210);
assert.equal(layoutDay([item('2026-11-01T06:30Z')], fall)[0].top, 90);
assert.equal(layoutDay([item('2026-03-09T04:00Z')], spring).length, 0);

assert.deepEqual(occurrences('daily', d('2026-03-07T14:00Z'), fromDayKey('2026-03-09')).map(iso), [
  '2026-03-07T14:00:00.000Z',
  '2026-03-08T13:00:00.000Z',
  '2026-03-09T13:00:00.000Z',
]);
assert.deepEqual(occurrences('daily', d('2026-03-07T07:30Z'), fromDayKey('2026-03-09')).map(iso), [
  '2026-03-07T07:30:00.000Z',
  '2026-03-08T07:30:00.000Z',
  '2026-03-09T06:30:00.000Z',
]);
assert.deepEqual(occurrences('weekly', d('2026-10-25T13:00Z'), fromDayKey('2026-11-08')).map(iso), [
  '2026-10-25T13:00:00.000Z',
  '2026-11-01T14:00:00.000Z',
  '2026-11-08T14:00:00.000Z',
]);
assert.deepEqual(occurrences('monthly', d('2026-02-23T14:00Z'), fromDayKey('2026-04-30')).map(iso), [
  '2026-02-23T14:00:00.000Z',
  '2026-03-30T13:00:00.000Z',
  '2026-04-27T13:00:00.000Z',
]);
assert.deepEqual(occurrences('yearly', d('2024-02-29T14:00Z'), fromDayKey('2028-03-01')).map(iso), [
  '2024-02-29T14:00:00.000Z',
  '2028-02-29T14:00:00.000Z',
]);
assert.equal(
  buildRule('weekly', d('2027-01-01T04:30Z'), fromDayKey('2027-01-07')),
  'FREQ=WEEKLY;BYDAY=TH;INTERVAL=1;UNTIL=20270108T045959Z',
);
const parsed = parseRule('FREQ=DAILY;INTERVAL=1;COUNT=3', d('2026-03-07T14:00Z'), null);
assert.equal(parsed.kind, 'daily');
assert.ok('until' in parsed && iso(parsed.until) === '2026-03-09T13:00:00.000Z');

// Picker date/time halves merge in Canvas time, including Android's device-local carrier.
const current = d('2026-03-07T14:15Z');
assert.equal(iso(mergeDateTime(current, spring, 'date')), '2026-03-08T13:15:00.000Z');
const timeCarrier = androidPickerValue(current, 'time');
assert.equal(timeCarrier.getHours(), 9);
assert.equal(timeCarrier.getMinutes(), 15);
assert.equal(
  iso(mergeAndroidPicker(current, new Date(2000, 0, 15, 10, 45), 'time')),
  '2026-03-07T15:45:00.000Z',
);
assert.equal(iso(mergeAndroidPicker(current, new Date(2026, 2, 8, 12), 'date')), '2026-03-08T13:15:00.000Z');

for (const [today, cutoff] of [
  ['2026-03-08', '2026-03-09T04:00Z'],
  ['2026-11-01', '2026-11-02T05:00Z'],
]) {
  const before = new Date(+d(cutoff) - 1).toISOString();
  const list = [
    work(before),
    work(cutoff),
    work('2020-01-01T00:00Z'),
    work(before, { markedComplete: true }),
    work(before, { dismissed: true }),
    work(before, { kind: 'event' }),
  ];
  assert.equal(countDueNow(list, fromDayKey(today)), 2);
  const groups = groupByDue([work(before), work(cutoff)], fromDayKey(today));
  assert.deepEqual(
    groups.map((g) => g.title),
    ['Today', 'Tomorrow'],
  );
}

// Cached all-day civil dates survive zone changes, and serialize at midnight in the edited zone.
const allDay = { ...item('2027-01-01T00:00Z'), allDay: true, allDayDate: '2027-01-01' };
for (const zone of ['America/Los_Angeles', 'Asia/Kathmandu', 'Pacific/Kiritimati']) {
  setDisplayTimeZone(zone);
  assert.deepEqual(daysOf(allDay), ['2027-01-01']);
  const projected = projectAllDay(allDay);
  assert.equal(dayKey(projected.start), '2027-01-01');
  assert.equal(allDayItems([allDay], fromDayKey('2027-01-01')).length, 1);
  assert.equal(allDayItems([allDay], fromDayKey('2026-12-31')).length, 0);
  assert.equal(formatDate(projected.start, { day: 'numeric' }), '1');
  const input: PersonalEventInput = {
    title: 'All day',
    start: allDay.start,
    end: allDay.start,
    allDay: true,
    allDayDate: allDay.allDayDate,
    location: '',
    rrule: 'FREQ=DAILY;COUNT=2;INTERVAL=1',
  };
  const body = eventBody(input).calendar_event;
  assert.equal(body.time_zone_edited, zone);
  assert.equal(dayKey(d(body.start_at)), '2027-01-01');
  assert.equal(dateParts(d(body.start_at)).hour, 0);
  assert.equal(body.end_at, body.start_at);

  const android = deviceEventDates(allDay, 'android', zone);
  assert.equal(iso(android.startDate), '2027-01-01T00:00:00.000Z');
  assert.equal(iso(android.endDate), '2027-01-02T00:00:00.000Z');
  assert.equal(android.timeZone, 'UTC');
  const ios = deviceEventDates(allDay, 'ios', zone);
  assert.equal(dayKey(ios.startDate, zone), '2027-01-01');
  assert.equal(dayKey(ios.endDate, zone), '2027-01-02');
  assert.equal(dateParts(ios.startDate, zone).hour, 0);
  assert.equal(ios.timeZone, null);
  const timed = deviceEventDates(crossing, 'ios', 'Pacific/Honolulu');
  assert.equal(iso(timed.startDate), iso(crossing.start));
  assert.equal(iso(timed.endDate), iso(crossing.end!));
  assert.equal(timed.timeZone, zone);
}

// iOS floating events span one civil day even across daylight-saving changes.
for (const [key, hours] of [['2026-03-08', 23], ['2026-11-01', 25]] as const) {
  const exported = deviceEventDates({ ...allDay, allDayDate: key }, 'ios', 'America/New_York');
  assert.equal((+exported.endDate - +exported.startDate) / 3600000, hours);
  assert.equal(dateParts(exported.endDate, 'America/New_York').hour, 0);
}

// Range boundaries change with the Canvas zone, even at the same instant.
const sameInstant = d('2027-01-01T04:30Z');
setDisplayTimeZone('America/Los_Angeles');
assert.equal(iso(exportRange(sameInstant).start), '2026-12-31T08:00:00.000Z');
assert.equal(iso(upcomingRange(sameInstant).end), '2027-01-28T08:00:00.000Z');
setDisplayTimeZone('Asia/Tokyo');
assert.equal(iso(exportRange(sameInstant).start), '2026-12-31T15:00:00.000Z');
assert.equal(iso(upcomingRange(sameInstant).end), '2027-01-28T15:00:00.000Z');
assert.equal(iso(exportRange(sameInstant, 'America/Los_Angeles').start), '2026-12-31T08:00:00.000Z');
assert.equal(iso(upcomingRange(sameInstant, 'America/Los_Angeles').end), '2027-01-28T08:00:00.000Z');
setDisplayTimeZone('Australia/Lord_Howe');
assert.equal(
  iso(fromWallTime({ year: 2026, month: 10, day: 4, hour: 2, minute: 15 })),
  '2026-10-03T15:45:00.000Z',
);
assert.equal((+addDays(fromDayKey('2026-10-04'), 1) - +fromDayKey('2026-10-04')) / 3600000, 23.5);
setDisplayTimeZone('America/Santiago');
const midnightGap = fromDayKey('2026-09-06');
assert.equal(iso(midnightGap), '2026-09-06T04:00:00.000Z');
assert.equal(countDueNow([work('2026-09-07T03:30Z')], midnightGap), 0);
assert.equal(iso(rangeFor('week', midnightGap).end), '2026-09-13T03:00:00.000Z');
assert.equal(iso(weekDays(midnightGap)[1]), '2026-09-07T03:00:00.000Z');
setDisplayTimeZone('America/New_York');
assert.deepEqual(occurrences('daily', d('2026-11-01T06:30Z'), fromDayKey('2026-11-02')).map(iso), [
  '2026-11-01T06:30:00.000Z',
  '2026-11-02T06:30:00.000Z',
]);
console.log(`Canvas timezone checks passed (device ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
