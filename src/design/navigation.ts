import {
  DarkTheme,
  DefaultTheme,
  type NativeStackNavigationOptions,
  type Theme as NavigationTheme,
} from 'expo-router';
import { useMemo } from 'react';
import { Platform } from 'react-native';

import { useTheme } from './theme/ThemeProvider';
import { fontFamilies } from './tokens/typography';

// Font family carries the weight. Setting fontWeight too makes Android fake-bold it.
const fonts: NavigationTheme['fonts'] = {
  regular: { fontFamily: fontFamilies.regular, fontWeight: 'normal' },
  medium: { fontFamily: fontFamilies.medium, fontWeight: 'normal' },
  bold: { fontFamily: fontFamilies.semibold, fontWeight: 'normal' },
  heavy: { fontFamily: fontFamilies.bold, fontWeight: 'normal' },
};

/** React Navigation theme built from Easel tokens, for expo-router's <ThemeProvider />. */
export function useNavigationTheme(): NavigationTheme {
  const { scheme, colors } = useTheme();
  return useMemo(
    () => ({
      dark: scheme === 'dark',
      colors: {
        ...(scheme === 'dark' ? DarkTheme : DefaultTheme).colors,
        primary: colors.accentFg,
        background: colors.bg,
        // Header background on iOS < 26 and Android: match the screen so headers read as part of it.
        card: colors.bg,
        text: colors.fg,
        border: colors.border,
        notification: colors.danger,
      },
      fonts,
    }),
    [scheme, colors],
  );
}

/** Shared options for every stack: native large titles, Inter headers, tinted back buttons. */
export function useStackScreenOptions(): NativeStackNavigationOptions {
  const { colors } = useTheme();
  return useMemo(
    () => ({
      headerLargeTitleEnabled: Platform.OS === 'ios',
      headerLargeTitleShadowVisible: false,
      headerShadowVisible: false,
      headerTintColor: colors.accentFg,
      headerTitleStyle: { fontFamily: fontFamilies.semibold, color: colors.fg },
      headerLargeTitleStyle: { fontFamily: fontFamilies.bold, color: colors.fg },
      headerBackButtonDisplayMode: 'minimal',
      contentStyle: { backgroundColor: colors.bg },
    }),
    [colors],
  );
}
