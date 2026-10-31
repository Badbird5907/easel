import { LocalStore, useLocalStore } from '@/features/offline/store';

/*
 * Widget settings (SYS-1). Device-wide. The Grades widget is opt-in and off
 * by default, in the spirit of HOME-3: grades never show on a home screen
 * unless the student asks.
 */

export type WidgetSettings = {
  gradesEnabled: boolean;
};

const defaults = (): WidgetSettings => ({ gradesEnabled: false });

export const widgetSettingsStore = new LocalStore<WidgetSettings>('widgets.settings', defaults, (stored) => ({
  ...defaults(),
  ...stored,
}));

export function useWidgetSettings(): WidgetSettings {
  return useLocalStore(widgetSettingsStore);
}

export function setGradesWidgetEnabled(enabled: boolean) {
  widgetSettingsStore.update((current) => ({ ...current, gradesEnabled: enabled }));
}

/** Bookkeeping: which account the widgets show, and when they were last fed from Canvas. */
export type WidgetMeta = {
  accountId: string | null;
  fetchedAt: number | null;
};

export const widgetMetaStore = new LocalStore<WidgetMeta>('widgets.meta', () => ({
  accountId: null,
  fetchedAt: null,
}));
