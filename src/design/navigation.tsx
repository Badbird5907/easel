import {
  DarkTheme,
  DefaultTheme,
  type NativeStackNavigationOptions,
  type Theme as NavigationTheme,
} from 'expo-router';
import { useMemo } from 'react';
import { Platform } from 'react-native';

import { useReduceMotion } from './accessibility/useReduceMotion';
import { Header } from './components/NavigationChrome';
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

/**
 * Shared options for every stack. iOS: native inline headers in Inter with tinted
 * back buttons. Android: Easel's own header instead of the Material app bar.
 */
export function useStackScreenOptions(): NativeStackNavigationOptions {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  return useMemo(
    () => ({
      // Tab roots draw their own large title (see <Screen title>); pushed screens stay inline.
      headerLargeTitleEnabled: false,
      animation: reduceMotion ? 'fade' : undefined,
      headerShadowVisible: false,
      headerTintColor: colors.accentFg,
      headerTitleStyle: { fontFamily: fontFamilies.semibold, color: colors.fg },
      headerBackButtonDisplayMode: 'minimal',
      contentStyle: { backgroundColor: colors.bg },
      ...(Platform.OS === 'android' && { header: (props) => <Header {...props} /> }),
    }),
    [colors, reduceMotion],
  );
}
