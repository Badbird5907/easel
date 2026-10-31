import { displayLocale, normalizeLocale } from './runtime';

const names = new Map<string, Map<string, string>>();

/** Localized zone name, not a translated copy of Canvas's English Rails labels. */
export function localizedZoneName(timeZone: string, locale = displayLocale()): string {
  let zones = names.get(locale);
  if (!zones) {
    zones = new Map();
    names.set(locale, zones);
  }
  const cached = zones.get(timeZone);
  if (cached !== undefined) return cached;
  let name = timeZone;
  try {
    name =
      new Intl.DateTimeFormat(normalizeLocale(locale), { timeZone, timeZoneName: 'longGeneric' })
        .formatToParts(new Date())
        .find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    // Cache unsupported zones too: repeated searches must not retry throwing ICU calls.
  }
  zones.set(timeZone, name);
  return name;
}
