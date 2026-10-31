import type { AppointmentGroup, AppointmentSlot } from '@/canvas/api/appointments';
import type { Translate } from '@/i18n/types';
import { createDateContext, dayKey } from '@/lib/dates';
import { formatMoment } from '@/features/reminders/model';

/** Scoped presentation, also safe for persistent objects cached by React Compiler. */
export function appointmentDisplay(locale: string, zone: string) {
  const dates = createDateContext(locale, zone);
  const fullDay = new Intl.DateTimeFormat(locale, {
    calendar: 'gregory', timeZone: zone, weekday: 'long', month: 'long', day: 'numeric',
  });
  const shortDay = new Intl.DateTimeFormat(locale, {
    calendar: 'gregory', timeZone: zone, month: 'short', day: 'numeric',
  });
  return {
    dates,
    fullDay,
    dayKey: (date: Date) => dayKey(date, zone),
    range: (slot: Pick<AppointmentSlot, 'start' | 'end'>) =>
      `${dates.formatTime(slot.start)} – ${dates.formatTime(slot.end)}`,
    summary(group: AppointmentGroup, courseCode: string | undefined, t: Translate) {
      const parts = [courseCode];
      if (group.reserved.length === 1)
        parts.push(t('appointments.yourTime', { time: formatMoment(group.reserved[0].start.getTime(), { display: dates }) }));
      else if (group.reserved.length > 1)
        parts.push(t('appointments.timesReserved', { count: group.reserved.length }));
      else if (group.start && group.end)
        parts.push(dayKey(group.start, zone) === dayKey(group.end, zone)
          ? shortDay.format(group.start)
          : `${shortDay.format(group.start)} – ${shortDay.format(group.end)}`);
      return parts.filter(Boolean).join(' · ');
    },
  };
}

export function availability(slot: AppointmentSlot, t: Translate): string {
  if (slot.reserved) return t('appointments.reserved');
  if (slot.open === null) return t('appointments.open');
  if (slot.open === 0) return t('appointments.full');
  return slot.capacity && slot.capacity > 1
    ? t('appointments.capacity', { count: slot.open, capacity: slot.capacity })
    : t('appointments.open');
}
