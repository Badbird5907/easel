import * as Calendar from 'expo-calendar';
import { Linking, Platform } from 'react-native';

import type { CalendarItem } from '@/canvas/api/calendar';
import { JsonStore } from '@/features/notifications/storage';
import { createTranslator, displayLocale } from '@/i18n/runtime';
import type { Translate } from '@/i18n/types';

import { deviceEventDates } from './exportDates';

/*
 * The device's own calendars (CAL-7, SET-8): subscribing to the Canvas feed,
 * and copying chosen events in with expo-calendar's object API (SDK 58).
 */

/** The feed as a `webcal:` link, which calendar apps treat as "subscribe". */
export function webcalUrl(ics: string): string {
  return ics.replace(/^https?:/i, 'webcal:');
}

/**
 * Hands the feed to the system. iOS opens Calendar's subscribe prompt. Android
 * has no standard handler, so this only works when an app that subscribes to
 * feeds is installed; false means nothing took it.
 */
export async function subscribeToFeed(ics: string): Promise<boolean> {
  try {
    await Linking.openURL(webcalUrl(ics));
    return true;
  } catch {
    return false;
  }
}

/** Google Calendar's "From URL" page, for Android devices with nothing that takes `webcal:`. */
export const GOOGLE_ADD_BY_URL = 'https://calendar.google.com/calendar/u/0/r/settings/addbyurl';

export type DeviceCalendar = { id: string; title: string; color: string | null; account: string };

/** Calendars Easel may add events to. Null when the student said no to calendar access. */
export async function writableCalendars(): Promise<DeviceCalendar[] | null> {
  const permission = await Calendar.requestCalendarPermissions();
  if (permission.status !== 'granted') return null;
  const calendars = await Calendar.getCalendars(
    Platform.OS === 'ios' ? Calendar.EntityTypes.EVENT : undefined,
  );
  return calendars
    .filter((c) => c.allowsModifications)
    .map((c) => ({
      id: c.id,
      title: c.title,
      color: c.color ?? null,
      account: c.source?.name ?? '',
    }))
    .sort((a, b) => a.account.localeCompare(b.account) || a.title.localeCompare(b.title));
}

/** Which device event each copied Canvas item became, per account, so copying again updates it. */
type Exported = Record<string, { calendarId: string; eventId: string }>;
const stores = new Map<string, JsonStore<Exported>>();
function exportedFor(accountId: string) {
  let store = stores.get(accountId);
  if (!store) {
    store = new JsonStore<Exported>(`calendar:exported:${accountId}`, () => ({}));
    stores.set(accountId, store);
  }
  return store;
}

function details(item: CalendarItem, translate: Translate) {
  const work = item.kind !== 'event' && item.kind !== 'note';
  // SDK 58's update wrapper explicitly forwards null fields to EventKit, but
  // its TypeScript timeZone property omits null. Keep the cast at this boundary.
  return {
    title: work ? translate('calendarFeed.dueTitle', { title: item.title }) : item.title,
    ...deviceEventDates(item, Platform.OS),
    location: item.location ?? '',
    notes: [item.contextName, item.htmlUrl].filter(Boolean).join('\n'),
    ...(Platform.OS === 'ios' && item.htmlUrl ? { url: item.htmlUrl } : {}),
  } as Parameters<Calendar.ExpoCalendarEvent['update']>[0];
}

/**
 * Copies items into a device calendar. Items copied before are updated in
 * place when their device event still exists. Resolves how many made it.
 */
export async function copyToDeviceCalendar(
  accountId: string,
  calendarId: string,
  items: CalendarItem[],
  translate: Translate = createTranslator(displayLocale()),
): Promise<{ copied: number; failed: number }> {
  const store = exportedFor(accountId);
  const calendar = await Calendar.ExpoCalendar.get(calendarId);
  const next: Exported = { ...store.get() };
  let copied = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const known = next[item.id];
      let updated = false;
      if (known && known.calendarId === calendarId) {
        try {
          const existing = await Calendar.ExpoCalendarEvent.get(known.eventId);
          await existing.update(details(item, translate));
          updated = true;
        } catch {
          // Deleted on the device since; add it again.
        }
      }
      if (!updated) {
        const event = await calendar.createEvent(details(item, translate));
        next[item.id] = { calendarId, eventId: event.id };
      }
      copied++;
    } catch {
      failed++;
    }
  }
  store.set(next);
  return { copied, failed };
}
