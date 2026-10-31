import * as SystemUI from 'expo-system-ui';
import { vars } from 'nativewind';
import { createContext, type ReactNode, use, useEffect, useMemo, useState } from 'react';
import { type StyleProp, StyleSheet, useColorScheme, View, type ViewStyle } from 'react-native';

import { type ColorScheme, type ColorTokens, palettes, tokenToKebab } from '../tokens/colors';
import { shadows } from '../tokens/layout';
import { deriveAccent } from './accent';
import { toRgbChannels } from './color';
import { saveSchemePreference, type SchemePreference } from './preference';

export type Theme = {
  scheme: ColorScheme;
  colors: ColorTokens;
  shadows: (typeof shadows)[ColorScheme];
};

const ThemeContext = createContext<Theme | null>(null);

type PreferenceState = {
  preference: SchemePreference;
  setPreference: (preference: SchemePreference) => void;
};

const PreferenceContext = createContext<PreferenceState | null>(null);

function toCssVars(colors: Partial<ColorTokens>) {
  const out: Record<string, string> = {};
  for (const [token, hex] of Object.entries(colors)) {
    out[`--color-${tokenToKebab(token)}`] = toRgbChannels(hex);
  }
  return vars(out);
}

const schemeVars = {
  light: toCssVars(palettes.light),
  dark: toCssVars(palettes.dark),
};

type ThemeProviderProps = {
  children: ReactNode;
  /** The saved appearance choice, already applied by `loadSchemePreference()`. */
  initialPreference?: SchemePreference;
};

/**
 * Resolves the active color scheme and publishes the matching tokens as CSS
 * variables (for className styling) and through context (for `useTheme`).
 * Follows the OS setting live unless the user picked Light or Dark in Settings.
 */
export function ThemeProvider({ children, initialPreference = 'system' }: ThemeProviderProps) {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [preference, setPreferenceState] = useState(initialPreference);

  const preferenceState = useMemo<PreferenceState>(
    () => ({
      preference,
      setPreference: (next) => {
        setPreferenceState(next);
        saveSchemePreference(next);
      },
    }),
    [preference],
  );

  const theme = useMemo<Theme>(
    () => ({ scheme, colors: palettes[scheme], shadows: shadows[scheme] }),
    [scheme],
  );

  useEffect(() => {
    // Root view color shows during navigation transitions and keyboard animations.
    SystemUI.setBackgroundColorAsync(theme.colors.bg).catch(() => {});
  }, [theme.colors.bg]);

  return (
    <PreferenceContext value={preferenceState}>
      <ThemeContext value={theme}>
        <View style={[styles.root, { backgroundColor: theme.colors.bg }, schemeVars[scheme]]}>
          {children}
        </View>
      </ThemeContext>
    </PreferenceContext>
  );
}

export function useTheme(): Theme {
  const theme = use(ThemeContext);
  if (!theme) throw new Error('useTheme() must be used inside <ThemeProvider>.');
  return theme;
}

/** The user's appearance choice (System, Light, Dark) and a setter that persists it. */
export function useSchemePreference(): PreferenceState {
  const state = use(PreferenceContext);
  if (!state) throw new Error('useSchemePreference() must be used inside <ThemeProvider>.');
  return state;
}

type AccentScopeProps = {
  /** Any hex color, usually a Canvas course color. Omit to inherit. */
  color?: string | null;
  children: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Re-tints everything inside it. Components using `accent` tokens (buttons,
 * switches, progress, tinted icons) pick up `color` with legibility adjusted
 * for the current scheme.
 *
 * ```tsx
 * <AccentScope color={course.color}>
 *   <Button>Submit assignment</Button>
 * </AccentScope>
 * ```
 */
export function AccentScope({ color, children, className, style }: AccentScopeProps) {
  const parent = useTheme();

  const scoped = useMemo(() => {
    if (!color) return null;
    const accent = deriveAccent(color, parent.scheme);
    return {
      theme: { ...parent, colors: { ...parent.colors, ...accent } },
      cssVars: toCssVars(accent),
    };
  }, [color, parent]);

  // collapsable={false} keeps large titles collapsing when a scope wraps a screen's scroll view.
  if (!scoped) {
    return (
      <View collapsable={false} className={className} style={style}>
        {children}
      </View>
    );
  }

  return (
    <ThemeContext value={scoped.theme}>
      <View collapsable={false} className={className} style={[scoped.cssVars, style]}>
        {children}
      </View>
    </ThemeContext>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
