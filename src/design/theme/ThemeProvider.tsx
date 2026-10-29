import * as SystemUI from 'expo-system-ui';
import { vars } from 'nativewind';
import { createContext, type ReactNode, use, useEffect, useMemo } from 'react';
import { type StyleProp, StyleSheet, useColorScheme, View, type ViewStyle } from 'react-native';

import { type ColorScheme, type ColorTokens, palettes, tokenToKebab } from '../tokens/colors';
import { shadows } from '../tokens/layout';
import { deriveAccent } from './accent';
import { toRgbChannels } from './color';

export type Theme = {
  scheme: ColorScheme;
  colors: ColorTokens;
  shadows: (typeof shadows)[ColorScheme];
};

const ThemeContext = createContext<Theme | null>(null);

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

/**
 * Resolves the system color scheme and publishes the matching tokens as CSS
 * variables (for className styling) and through context (for `useTheme`).
 * Follows the OS setting live, with no app restart.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  const theme = useMemo<Theme>(
    () => ({ scheme, colors: palettes[scheme], shadows: shadows[scheme] }),
    [scheme],
  );

  useEffect(() => {
    // Root view color shows during navigation transitions and keyboard animations.
    SystemUI.setBackgroundColorAsync(theme.colors.bg).catch(() => {});
  }, [theme.colors.bg]);

  return (
    <ThemeContext value={theme}>
      <View style={[styles.root, { backgroundColor: theme.colors.bg }, schemeVars[scheme]]}>{children}</View>
    </ThemeContext>
  );
}

export function useTheme(): Theme {
  const theme = use(ThemeContext);
  if (!theme) throw new Error('useTheme() must be used inside <ThemeProvider>.');
  return theme;
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
