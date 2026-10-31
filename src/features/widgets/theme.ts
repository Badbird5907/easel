// Relative imports on purpose: the widget layout bundler (expo-widgets `initialLayout`)
// resolves only relative paths and stubs everything else.
import { palettes } from '../../design/tokens/colors';
import type { WidgetPalette, WidgetTheme } from './types';

function pick(scheme: 'light' | 'dark'): WidgetPalette {
  const c = palettes[scheme];
  return {
    bg: c.bg,
    surface: c.surface,
    fg: c.fg,
    muted: c.fgMuted,
    subtle: c.fgSubtle,
    border: c.border,
    accent: c.accent,
    accentFg: c.accentFg,
    danger: c.danger,
    dangerFg: c.dangerFg,
  };
}

/** Easel's tokens for both schemes, so widgets follow light and dark mode. */
export const widgetTheme: WidgetTheme = { light: pick('light'), dark: pick('dark') };

/** What a widget says before Easel has published anything to it. */
export const WAITING_MESSAGE = 'Open Easel to load your work.';

/**
 * iOS keeps widget props in UserDefaults, which only takes property-list
 * values: `null` throws. Drops null and undefined fields, deeply; layouts read
 * a missing field the same as null.
 */
export function plistSafe<T>(value: T): T {
  if (Array.isArray(value)) return value.map(plistSafe) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      if (field !== null && field !== undefined) out[key] = plistSafe(field);
    }
    return out as T;
  }
  return value;
}
