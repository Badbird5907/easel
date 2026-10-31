import { getLocaleState } from '@/i18n/runtime';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';

import { useProfile } from '@/canvas/api/profile';
import { useAccountKey } from '@/canvas/query';
import { offsetLabel, setDisplayTimeZone, useDisplayTimeZone } from '@/lib/dates';

import { canvasTimeZones } from './timeZones';

/**
 * Keeps every date in the app in the student's Canvas time zone (SET-14).
 * The profile comes from the saved cache first, so the zone is right on the
 * first frame after launch. Returns the zone in use.
 */
export function useCanvasTimeZoneSync(): string {
  const profile = useProfile();
  const queryClient = useQueryClient();
  const accountId = useAccountKey();
  const timeZone = profile.data?.timeZone;
  useLayoutEffect(() => {
    // An uncached account starts in the device zone, never the previous account's zone.
    applyTimeZone(queryClient, accountId, timeZone ?? null);
  }, [timeZone, queryClient, accountId]);
  return useDisplayTimeZone();
}

/** Switches every date to `timeZone`, including rows already on screen. */
export function applyTimeZone(queryClient: QueryClient, accountId: string, timeZone: string | null) {
  // A Settings save may finish after its account has left the foreground.
  if (getLocaleState().accountId !== accountId) return;
  if (setDisplayTimeZone(timeZone)) redrawDates(queryClient, accountId);
}

/** "Central Time (US & Canada)", or the IANA name for zones outside Canvas's list. */
export function timeZoneName(iana: string | null | undefined): string | null {
  if (!iana) return null;
  // Zones outside Canvas's list read as their city: "America/Toronto" is "Toronto".
  return (
    canvasTimeZones.find(([zone]) => zone === iana)?.[1] ?? (iana.split('/').pop() ?? iana).replace(/_/g, ' ')
  );
}

/** "Central Time (US & Canada) (GMT-5)". */
export function timeZoneLabel(iana: string): string {
  return `${timeZoneName(iana)} (${offsetLabel(iana)})`;
}

function cloneDates(value: unknown): unknown {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(cloneDates);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = cloneDates(item);
    return out;
  }
  return value;
}

/**
 * Redraws dates already on screen after the time zone changes. Rows are
 * memoized on their data, so the account's cached data is set again with fresh
 * Date objects: structural sharing hands new references to exactly the
 * objects that hold dates, and only those re-render.
 */
export function redrawDates(queryClient: QueryClient, accountId: string) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: [accountId] })) {
    if (query.state.data !== undefined)
      queryClient.setQueryData(query.queryKey, cloneDates(query.state.data));
  }
}

/** For tight spaces: "Pacific Time" rather than "Pacific Time (US & Canada)". */
export function shortTimeZoneName(iana: string | null | undefined): string | null {
  return timeZoneName(iana)?.replace(' (US & Canada)', '') ?? null;
}

/**
 * `useCanvasTimeZoneSync` as a component, for layouts: render it once beside
 * the signed-in navigator so the zone is right on every launch path,
 * including links that open straight to a detail screen.
 */
export function CanvasTimeZoneSync() {
  useCanvasTimeZoneSync();
  return null;
}
