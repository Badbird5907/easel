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
  // Native JSON.parse handles primitives without crossing into a JS reviver for each
  // field. Only visit objects afterwards, rebuilding the few tagged model values.
  function restore(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    const object = value as Record<string, unknown>;
    if (DATE in object) return new Date((object[DATE] as number | null) ?? Number.NaN);
    if (MAP in object) return new Map(restore(object[MAP]) as [unknown, unknown][]);
    if (SET in object) return new Set(restore(object[SET]) as unknown[]);
    for (const key of Object.keys(object)) {
      const child = object[key];
      if (child && typeof child === 'object') object[key] = restore(child);
    }
    return value;
  }
  return restore(JSON.parse(text)) as T;
}
