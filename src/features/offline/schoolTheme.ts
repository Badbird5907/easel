import { useSyncExternalStore } from 'react';

import { JsonStore } from '@/features/notifications/storage';

/*
 * Whether course content uses the school's mobile theme (HTML-8): the CSS and
 * JS a Canvas admin uploads in the Theme Editor for the mobile apps. Off by
 * default; one setting for every account on the device. RichContent applies
 * the theme only within its accessibility guards.
 */
const store = new JsonStore<boolean>('easel.schoolTheme', () => false);

export function useSchoolThemeEnabled(): boolean {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function setSchoolThemeEnabled(on: boolean): void {
  store.set(on);
}
