import { displayLocale, normalizeLocale } from './runtime';

/** Localized zone name, not a translated copy of Canvas's English Rails labels. */
export function localizedZoneName(timeZone: string, locale = displayLocale()): string {
  try {
    return (
      new Intl.DateTimeFormat(normalizeLocale(locale), { timeZone, timeZoneName: 'longGeneric' })
        .formatToParts(new Date())
        .find((part) => part.type === 'timeZoneName')?.value ?? timeZone
    );
  } catch {
    return timeZone;
  }
}
