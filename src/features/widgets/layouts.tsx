import type { Widget } from 'expo-widgets';

import type { ListWidgetProps, NextDueProps } from './types';

/*
 * Platforms without home screen widgets (web). `layouts.ios.tsx` and
 * `layouts.android.tsx` register the real ones with the same exports.
 */

export const NextDueWidget: Widget<NextDueProps> | null = null;
export const TodoWidget: Widget<ListWidgetProps> | null = null;
export const AnnouncementsWidget: Widget<ListWidgetProps> | null = null;
export const GradesWidget: Widget<ListWidgetProps> | null = null;
