import { router, usePathname } from 'expo-router';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import { settingsKv } from './kv';

/*
 * The tab Easel opens to (SET-3). One choice per device, not per account:
 * it's about how this student uses this phone. Stored in synchronous SQLite
 * so the tabs can read it before the first frame.
 */

export type LandingTab = 'home' | 'calendar' | 'todo' | 'inbox';

export const landingTabs: {
  value: LandingTab;
  label: string;
  href: '/' | '/calendar' | '/todo' | '/inbox';
}[] = [
  { value: 'home', label: 'Home', href: '/' },
  { value: 'calendar', label: 'Calendar', href: '/calendar' },
  { value: 'todo', label: 'To Do', href: '/todo' },
  { value: 'inbox', label: 'Inbox', href: '/inbox' },
];

const KEY = 'landingTab';

function read(): LandingTab {
  try {
    const value = settingsKv.getItemSync(KEY);
    return landingTabs.some((t) => t.value === value) ? (value as LandingTab) : 'home';
  } catch {
    return 'home';
  }
}

let current: LandingTab | null = null;
const listeners = new Set<() => void>();

function get(): LandingTab {
  current ??= read();
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The saved landing tab, for code outside React. */
export function landingTab(): LandingTab {
  return get();
}

export function setLandingTab(tab: LandingTab) {
  current = tab;
  try {
    settingsKv.setItemSync(KEY, tab);
  } catch {
    // Storage full or unavailable: the choice lasts until the app closes.
  }
  for (const listener of listeners) listener();
}

export function useLandingTab(): [LandingTab, (tab: LandingTab) => void] {
  const value = useSyncExternalStore(subscribe, get, get);
  return [value, useCallback((tab: LandingTab) => setLandingTab(tab), [])];
}

let applied = false;

/**
 * Where to go once at launch, or null to stay. Only the first call in a
 * process answers: switching accounts or remounting the tabs must not jump
 * the student to another tab.
 */
export function takeLaunchRedirect(): (typeof landingTabs)[number]['href'] | null {
  if (applied) return null;
  applied = true;
  const tab = get();
  return tab === 'home' ? null : (landingTabs.find((t) => t.value === tab)?.href ?? null);
}

/**
 * Opens the saved landing tab once per launch (SET-3). Call it in the tabs
 * layout. A launch from a link or notification that already points somewhere
 * other than Home stays where it landed.
 */
export function useLaunchLandingTab() {
  const pathname = usePathname();
  const first = useRef(pathname);
  useEffect(() => {
    const href = takeLaunchRedirect();
    if (href && first.current === '/') router.navigate(href);
  }, []);
}
