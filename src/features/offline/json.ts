/*
 * JSON that keeps Dates, Maps, and Sets. Models carry Date objects, and plain
 * JSON would turn them into strings that screens then call `.getTime()` on.
 * They're tagged on the way out and rebuilt on the way in. Used for the
 * persisted query cache and for course sync snapshots.
 */
const DATE = '$easelDate';
const MAP = '$easelMap';
const SET = '$easelSet';

export function encodeJson(value: unknown): string {
  return JSON.stringify(value, function replacer(this: Record<string, unknown>, key, current) {
    // `current` has already been through Date#toJSON; the original is on `this`.
    const raw = this[key];
    if (raw instanceof Date) return { [DATE]: raw.getTime() };
    if (raw instanceof Map) return { [MAP]: [...raw.entries()] };
    if (raw instanceof Set) return { [SET]: [...raw.values()] };
    return current;
  });
}

export function decodeJson<T>(text: string): T {
  return JSON.parse(text, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (DATE in value) return new Date(value[DATE] ?? Number.NaN);
      if (MAP in value) return new Map(value[MAP]);
      if (SET in value) return new Set(value[SET]);
    }
    return value;
  }) as T;
}
