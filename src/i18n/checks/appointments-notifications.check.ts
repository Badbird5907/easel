/** Pure production presentation/math. No native UI, scheduling, storage or network is invoked. */
import { createTranslator, setAccountLocale } from '../runtime';
import { en } from '../en';
import { fr } from '../fr';
import { ar } from '../ar';
import { appointmentDisplay, availability } from '@/features/appointments/display';
import { preferenceText, preferenceGroupId, preferenceGroupTitle, frequencyLabel } from '@/features/notifications/preferenceDisplay';
import { quietHourValue, quietHourMinutes, checkAge } from '@/features/notifications/display';
import { androidPickerValue, mergeAndroidPicker, mergePickerFields } from '@/features/planner/pickerDates';
import { dateTimeLabelFormatter } from '@/features/planner/display';
import { createDateContext, dateParts, deviceTimeZone, fromWallTime, setDisplayTimeZone } from '@/lib/dates';
import type { AppointmentGroup, AppointmentSlot } from '@/canvas/api/appointments';
import type { PreferenceCategory } from '@/canvas/api/preferences';

const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Values differ');
  },
  ok(value: unknown) { if (!value) throw new Error('Assertion failed'); },
};

assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
const category: PreferenceCategory = { id: 'due_date', title: 'Due dates', description: 'cached English', group: 'Course activities', frequency: 'daily', notifications: ['Assignment Due Date Changed'] };
const custom = { ...category, id: 'School_Custom', title: 'ÉCOLE Custom Name', description: 'User text العربية' };
const oldGroup = { title: 'Course activities', categories: [category] };
const customGroup = { title: 'School GROUP', categories: [custom] };
const slot: AppointmentSlot = { id: 's', start: new Date('2026-01-01T00:30:00Z'), end: new Date('2026-01-01T02:00:00Z'), open: 2, capacity: 4, reserved: false, reservationId: null, comments: 'User NOTE', reserveUrl: '/unchanged' };
const group: AppointmentGroup = { id: 'g', title: 'Office HOURS', description: '', location: null, address: null, start: new Date('2026-01-01T07:30:00Z'), end: new Date('2026-01-01T08:30:00Z'), courseId: null, contextCodes: [], forGroups: false, maxPerStudent: 2, requiringAction: false, slotCount: 1, reserved: [], htmlUrl: null };
const before = JSON.stringify({ category, custom, group, slot });
const texts = new Set<string>();
// Reuse exact data/Date references while switching account locale and Canvas zone, then return to English.
for (const locale of ['en-US', 'fr-CA', 'ar-EG', 'en-US']) {
  const t = createTranslator(locale);
  setAccountLocale('presentation-check', locale);
  texts.add(preferenceText(category, t).title);
  assert.equal(preferenceText(category, t).title, t('preferences.due_date.title'));
  assert.deepEqual(preferenceText(custom, t), { title: custom.title, description: custom.description });
  assert.equal(preferenceText({ ...custom, rawTitle: 'EXACT_School_Slug' }, t).title, 'Exact school slug');
  assert.equal(preferenceText({ ...category, id: 'future_category', title: 'future_category' }, t).title, 'Future category');
  for (const id of ['access_requests', 'account_notification', 'alert', 'blueprint', 'content_link_error', 'portfolio', 'reminder', 'reported_reply']) {
    const text = preferenceText({ ...category, id }, t);
    assert.ok(text.title && text.description && !text.title.includes('_'));
    assert.equal(text.title, t(`preferences.${id}.title` as keyof typeof en));
  }
  assert.ok(t('planner.points', { count: 1 }) !== t('planner.points', { count: 2 }));
  assert.equal(preferenceGroupId(oldGroup), 'course');
  assert.equal(preferenceGroupTitle(oldGroup, t), t('preferences.group.course'));
  assert.equal(preferenceGroupTitle(customGroup, t), customGroup.title);
  for (const id of ['__proto__', 'constructor']) {
    assert.equal(preferenceText({ ...custom, id }, t).title, custom.title);
    assert.equal(preferenceGroupTitle({ ...customGroup, categories: [{ ...custom, id }] }, t), customGroup.title);
  }
  for (const frequency of ['immediately', 'daily', 'weekly', 'never'] as const)
    assert.equal(frequencyLabel(frequency, t), t(`preferences.frequency.${frequency}`));
  for (const count of [0, 1, 2, 3, 11, 100]) {
    assert.ok(t('appointments.timesReserved', { count }).includes(new Intl.NumberFormat(locale).format(count)));
    assert.ok(t('notifications.checked', { count, posted: 1234 }).includes(new Intl.NumberFormat(locale).format(1234)));
  }
  assert.equal(availability({ ...slot, reserved: true }, t), t('appointments.reserved'));
  assert.equal(availability({ ...slot, open: null }, t), t('appointments.open'));
  assert.equal(availability({ ...slot, open: 0 }, t), t('appointments.full'));
  assert.equal(availability(slot, t), t('appointments.capacity', { count: 2, capacity: 4 }));
  for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Kathmandu']) {
    setDisplayTimeZone(zone);
    const d = appointmentDisplay(locale, zone);
    const short = new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, month: 'short', day: 'numeric' });
    const expected = zone === 'America/Los_Angeles'
      ? `${short.format(group.start!)} – ${short.format(group.end!)}` : short.format(group.start!);
    assert.equal(d.summary(group, undefined, t), expected); // UTC same day, LA crosses midnight/year
    assert.equal(d.fullDay.format(slot.start), new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, weekday: 'long', month: 'long', day: 'numeric' }).format(slot.start));
    const booked = { ...group, reserved: [{ id: 'r', start: slot.start, end: slot.end }, { id: 'r2', start: slot.start, end: slot.end }] };
    assert.equal(d.summary(booked, 'USER COURSE', t), `USER COURSE · ${t('appointments.timesReserved', { count: 2 })}`);
    for (const minutes of [0, 90, 150, 420, 1320, 1439]) {
      const value = quietHourValue(minutes);
      assert.equal(quietHourMinutes(value), minutes);
      const carrier = androidPickerValue(value, 'time', deviceTimeZone());
      assert.equal(quietHourMinutes(carrier), minutes);
      assert.equal(mergeAndroidPicker(value, carrier, 'time', deviceTimeZone()), value);
      assert.equal(mergePickerFields(value, value, 'time', deviceTimeZone()), value);
      const changed = mergeAndroidPicker(value, quietHourValue(1320), 'time', deviceTimeZone());
      assert.equal(quietHourMinutes(changed), 1320);
      assert.equal(quietHourMinutes(mergePickerFields(value, quietHourValue(150), 'time', deviceTimeZone())), 150);
      assert.equal(dateTimeLabelFormatter(locale, deviceTimeZone(), 'time').format(value), new Intl.DateTimeFormat(locale, { timeZone: deviceTimeZone(), hour: 'numeric', minute: '2-digit', calendar: 'gregory' }).format(value));
    }
    const now = new Date('2026-01-10T00:00:00Z');
    assert.equal(checkAge(new Date(now.getTime() - 2 * 60_000), createDateContext(locale, zone), now), new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-2, 'minute'));
  }
}
assert.equal(texts.size, 3);
assert.equal(JSON.stringify({ category, custom, group, slot }), before);
// Scoped picker merges use existing compatible gap/overlap behavior, retaining no-op instants.
for (const zone of ['America/New_York', 'America/Los_Angeles']) {
  setDisplayTimeZone('Asia/Tokyo');
  const current = fromWallTime({ year: 2026, month: 3, day: 8, hour: 1, minute: 30 }, zone);
  const picked = fromWallTime({ year: 2000, month: 1, day: 1, hour: 2, minute: 30 }, zone);
  const gap = mergePickerFields(current, picked, 'time', zone);
  assert.equal(dateParts(gap, zone).hour, 3);
  assert.equal(dateParts(gap, zone).minute, 30);
  const early = fromWallTime({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, zone);
  const late = new Date(early.getTime() + 3600_000);
  assert.equal(mergePickerFields(late, early, 'time', zone), late);
}
// Default callers still merge into Canvas zone, not device zone.
setDisplayTimeZone('America/New_York');
const event = new Date('2026-11-01T06:30:00Z');
assert.equal(mergeAndroidPicker(event, androidPickerValue(event, 'time'), 'time'), event);
const captured = createTranslator('fr');
setAccountLocale('other', 'ar');
assert.ok(captured('notifications.changeError', { category: custom.title, error: 'SERVER RAW' }).includes('Impossible'));
setAccountLocale(null); setDisplayTimeZone(null);
console.log(`Appointment/notification presentation and quiet-hour roundtrips passed; device TZ=${deviceTimeZone()}; catalogs=${Object.keys(en).length}. No native UI exercised.`);
