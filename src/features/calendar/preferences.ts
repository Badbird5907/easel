import { useSyncExternalStore } from 'react';

import { JsonStore } from '@/features/notifications/storage';

/** The Calendar tab's views (CAL-1, CAL-2). */
export type CalendarView = 'month' | 'week' | 'day' | 'agenda';

const VIEWS: CalendarView[] = ['month', 'week', 'day', 'agenda'];

/** The view the Calendar tab opens in: the last one the student chose, on this device. */
const viewStore = new JsonStore<CalendarView>(
  'calendar:view',
  () => 'month',
  (stored) => (VIEWS.includes(stored) ? stored : 'month'),
);

export function useCalendarView(): [CalendarView, (view: CalendarView) => void] {
  const view = useSyncExternalStore(viewStore.subscribe, viewStore.get);
  return [view, (next) => viewStore.set(next)];
}
