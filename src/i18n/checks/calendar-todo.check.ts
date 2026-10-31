import { createTranslator, setAccountLocale } from '../runtime';
import { en } from '../en';
import { fr } from '../fr';
import { ar } from '../ar';
import {
  buildRule,
  describeRepeat,
  describeRecurrence,
  parseRule,
  repeatKinds,
  repeatValue,
  recurrenceProblem,
  occurrences,
} from '@/features/calendar/recurrence';
import { fullDay, longWeekday, monthTitle, monthWeeks, WEEK_STARTS_ON } from '@/features/calendar/month';
import { rangeFor, rangePresets, statusFilters, kindLabel } from '@/features/planner/filters';
import { dateParts, dayKey, fromWallTime, setDisplayTimeZone, weekday } from '@/lib/dates';
import { hourAxisFormatter, pageDelta } from '@/features/calendar/display';
import { dateTimeLabelFormatter } from '@/features/planner/display';

const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Values differ');
  },
  ok(value: unknown) {
    if (!value) throw new Error('Assertion failed');
  },
  notEqual(actual: unknown, expected: unknown) {
    if (actual === expected) throw new Error('Untranslated key');
  },
};
setDisplayTimeZone('America/New_York');
// Grid clock labels stay at their abstract hours even when Canvas uses another zone.
for (const locale of ['en-US', 'fr-CA', 'ar-EG']) {
  for (const zone of ['America/New_York', 'Asia/Kathmandu', 'Pacific/Auckland']) {
    setAccountLocale('axis-check', locale);
    setDisplayTimeZone(zone);
    const formatter = hourAxisFormatter(locale);
    for (const hour of [0, 1, 9, 12, 23]) {
      const hourPart = formatter.formatToParts(new Date(Date.UTC(2026, 0, 1, hour)))
        .find((part) => part.type === 'hour')?.value;
      const options = formatter.resolvedOptions();
      const expectedHour = options.hour12 ? hour % 12 || 12 : options.hourCycle === 'h24' && hour === 0 ? 24 : hour;
      assert.equal(hourPart, new Intl.NumberFormat(locale, {
        minimumIntegerDigits: options.hour === '2-digit' ? 2 : 1,
      }).format(expectedHour));
    }
  }
}
assert.equal(pageDelta(-80, 'ltr'), 1);
assert.equal(pageDelta(80, 'ltr'), -1);
assert.equal(pageDelta(-80, 'rtl'), -1);
assert.equal(pageDelta(80, 'rtl'), 1);
// A form can keep the same Date object through locale/zone changes, including a different civil day.
const fieldDate = new Date('2026-01-01T01:15:00Z');
for (const locale of ['en-US', 'fr-CA', 'ar-EG', 'en-US']) {
  for (const zone of ['America/New_York', 'Asia/Kathmandu', 'Pacific/Auckland']) {
    for (const mode of ['date', 'time'] as const) {
      const options: Intl.DateTimeFormatOptions = mode === 'date'
        ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
        : { hour: 'numeric', minute: '2-digit' };
      assert.equal(dateTimeLabelFormatter(locale, zone, mode).format(fieldDate),
        new Intl.DateTimeFormat(locale, { ...options, calendar: 'gregory', timeZone: zone }).format(fieldDate));
    }
  }
}
assert.notEqual(
  dateTimeLabelFormatter('en-US', 'America/New_York', 'date').format(fieldDate),
  dateTimeLabelFormatter('en-US', 'Asia/Kathmandu', 'date').format(fieldDate),
);
setDisplayTimeZone('America/New_York');
const start = fromWallTime({ year: 2026, month: 3, day: 3, hour: 10 });
const until = fromWallTime({ year: 2026, month: 4, day: 7, hour: 23, minute: 59 });
const baseline = repeatKinds.map((kind) => ({
  rule: buildRule(kind, start, until),
  dates: occurrences(kind, start, until).map((d) => d.toISOString()),
}));
const ranges = rangePresets.map(({ value }) => rangeFor(value, start));
const grids = monthWeeks(start).map((week) => week.map((day) => dayKey(day)));

// Same objects, consecutive account locale changes: no stale module-scope weekday/recurrence labels.
for (const locale of ['en-US', 'fr-CA', 'ar-EG', 'en-US']) {
  setAccountLocale('calendar-check', locale);
  const t = createTranslator(locale);
  const weekdayName = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    timeZone: 'America/New_York',
    calendar: 'gregory',
  }).format(start);
  assert.equal(longWeekday.format(start), weekdayName);
  assert.equal(describeRepeat('weekly', start, t), t('repeat.weekly', { weekday: weekdayName }));
  assert.equal(describeRepeat('weekly', start), describeRepeat('weekly', start, t));
  assert.equal(
    monthTitle.format(start),
    new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'America/New_York',
      calendar: 'gregory',
    }).format(start),
  );
  assert.equal(
    fullDay.format(start),
    new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York',
      calendar: 'gregory',
    }).format(start),
  );
  for (const [i, kind] of repeatKinds.entries()) {
    assert.equal(buildRule(kind, start, until), baseline[i].rule);
    assert.deepEqual(
      occurrences(kind, start, until).map((d) => d.toISOString()),
      baseline[i].dates,
    );
    const recurrence = parseRule(baseline[i].rule, start, null);
    assert.equal(recurrence.kind, kind);
    assert.ok(repeatValue(recurrence, t));
    assert.equal(recurrenceProblem(recurrence, start, t), null);
    if (kind !== 'none')
      assert.ok(describeRecurrence(recurrence, start, t)?.includes(describeRepeat(kind, start, t)));
  }
  // First/fourth/last monthly wording follows the existing RRULE position, including last-fourth.
  for (const [day, key, pos] of [
    [3, 'first', 1],
    [24, 'fourth', 4],
    [31, 'last', -1],
  ] as const) {
    const date = fromWallTime({ year: 2026, month: 3, day, hour: 10 });
    assert.equal(
      describeRepeat('monthly', date, t),
      t(`repeat.monthly.${key}`, { weekday: longWeekday.format(date) }),
    );
    assert.ok(buildRule('monthly', date, until)?.includes(`BYSETPOS=${pos};`));
  }
  const lastFourth = fromWallTime({ year: 2026, month: 4, day: 28, hour: 10 });
  assert.equal(
    describeRepeat('monthly', lastFourth, t),
    t('repeat.monthly.last', { weekday: longWeekday.format(lastFourth) }),
  );
  const custom = { kind: 'custom', rule: 'FREQ=HOURLY;COUNT=2', text: 'Canvas-authored wording' } as const;
  assert.equal(repeatValue(custom, t), custom.text);
  assert.equal(describeRecurrence(custom, start, t), custom.text);
  assert.equal(repeatValue({ ...custom, text: null }, t), t('event.custom'));
  assert.equal(recurrenceProblem({ kind: 'daily', until: start }, until, t), t('repeat.endBefore'));
  assert.equal(
    recurrenceProblem({ kind: 'daily', until: fromWallTime({ year: 2028, month: 1, day: 1 }) }, start, t),
    t('repeat.tooMany', { count: 400 }),
  );
  assert.deepEqual(
    rangePresets.map(({ value }) => rangeFor(value, start)),
    ranges,
  );
  assert.deepEqual(
    monthWeeks(start).map((week) => week.map((day) => dayKey(day))),
    grids,
  );
  assert.equal(weekday(monthWeeks(start)[0][0]), WEEK_STARTS_ON);
  assert.equal(dateParts(start).hour, 10);
  for (const { labelKey } of [...statusFilters, ...rangePresets]) assert.notEqual(t(labelKey), labelKey);
  for (const key of Object.values(kindLabel)) if (key) assert.notEqual(t(key), key);
}
// Count categories, interpolation, localized digits and date slots for every migrated plural label.
for (const [locale, catalog] of [
  ['en', en],
  ['fr', fr],
  ['ar', ar],
] as const) {
  const t = createTranslator(locale);
  for (const count of [0, 1, 2, 3, 11, 100]) {
    for (const key of [
      'calendar.items',
      'calendar.earlierDays',
      'calendar.signupCount',
      'calendar.moreAllDay',
      'planner.showCompleted',
      'event.addsCount',
    ] as const) {
      const messages = catalog[key] as Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
      const branch = new Intl.PluralRules(locale).select(count);
      const expected = (messages[branch] ?? messages.other)
        .replace('{count}', new Intl.NumberFormat(locale).format(count))
        .replace('{date}', locale === 'ar' ? '\u2068DATE\u2069' : 'DATE');
      assert.equal(t(key, { count, date: 'DATE' }), expected);
      assert.ok(!expected.includes('{'));
    }
  }
}
console.log(
  'Calendar/To Do: locale switches, recurrence semantics, weekday/month formatting, stable filter metadata, count branches passed.',
);
