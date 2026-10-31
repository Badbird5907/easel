import { dateParts, deviceTimeZone, displayTimeZone, fromWallTime, mergeDateTime } from '@/lib/dates';

/**
 * SDK 58's Android picker ignores timeZoneName. These are UI-only carriers,
 * never saved instants. Dates use noon (avoids midnight DST transitions); time
 * uses a safe day rather than the event's day, which might be a device DST gap.
 */
export function androidPickerValue(value: Date, mode: 'date' | 'time', zone = displayTimeZone()): Date {
  const p = dateParts(value, zone);
  if (mode === 'date') return new Date(p.year, p.month - 1, p.day, 12);
  for (let day = 1; day <= 31; day++) {
    const carrier = new Date(2000, 0, day, p.hour, p.minute);
    if (carrier.getHours() === p.hour && carrier.getMinutes() === p.minute) return carrier;
  }
  throw new Error('Cannot represent picker time in the device zone');
}

/** Explicit target zone is only for fields such as device-local quiet hours. */
export function mergePickerFields(
  current: Date, picked: Date, mode: 'date' | 'time',
  zone?: string, pickedZone = zone ?? displayTimeZone(),
): Date {
  if (zone === undefined) return mergeDateTime(current, picked, mode, pickedZone);
  const c = dateParts(current, zone);
  const p = dateParts(picked, pickedZone);
  const next = mode === 'date'
    ? { ...c, year: p.year, month: p.month, day: p.day }
    : { ...c, hour: p.hour, minute: p.minute, second: 0 };
  // Retain the exact instant for a no-op, including the later half of an overlap.
  if (Object.keys(c).every((key) => c[key as keyof typeof c] === next[key as keyof typeof next])) return current;
  return fromWallTime(next, zone);
}

export function mergeAndroidPicker(current: Date, picked: Date, mode: 'date' | 'time', zone?: string): Date {
  return mergePickerFields(current, picked, mode, zone, deviceTimeZone());
}

