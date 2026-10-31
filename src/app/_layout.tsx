// Defines the background refresh task. Must load before anything else (NOTIF-3).
import '@/background/tasks';
import '@/global.css';

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { useIsRestoring } from '@tanstack/react-query';
import { LocaleProvider, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CanvasQueryProvider } from '@/canvas/query';
import { SessionProvider, useSession } from '@/canvas/session';
import {
  loadSchemePreference,
  type SchemePreference,
  ThemeProvider,
  useNavigationTheme,
  useTheme,
} from '@/design';
import { NotificationsRuntime } from '@/features/notifications/runtime';
import { startConnectivity } from '@/features/offline/connectivity';
import { OfflineBanner } from '@/features/offline/OfflineBanner';
import { useTranslation } from '@/i18n';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [preference, setPreference] = useState<SchemePreference | null>(null);

  useEffect(() => {
    // Route discovery also imports this module in Node during release builds.
    // Start device/browser listeners only once the app has mounted.
    startConnectivity();
    loadSchemePreference().then(setPreference);
  }, []);

  if (!(fontsLoaded || fontError) || preference === null) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider initialPreference={preference}>
        <SessionProvider>
          <CanvasQueryProvider>
            <RootNavigator />
          </CanvasQueryProvider>
        </SessionProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const navigationTheme = useNavigationTheme();
  const { scheme } = useTheme();
  const { status, active } = useSession();
  const { direction } = useTranslation();
  const restoring = useIsRestoring();
  const signedIn = !!active && !active.expired;

  // Do not mount empty query observers before hydration, or expose an unlaid-out navigator.
  if (status === 'loading' || restoring) return null;

  return (
    <LocaleProvider direction={direction}>
      <NavigationThemeProvider value={navigationTheme}>
        {/* Follows Easel's appearance setting, which can differ from the system's. */}
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <NotificationsRuntime />
        <View className="flex-1 bg-bg" style={{ direction }} onLayout={() => SplashScreen.hideAsync()}>
          <OfflineBanner />
          {/* Measures its own insets, so screens under the banner don't pad for the status bar again. */}
          <SafeAreaProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Protected guard={signedIn}>
                <Stack.Screen name="(app)" />
              </Stack.Protected>
              <Stack.Protected guard={!signedIn}>
                <Stack.Screen name="sign-in" />
              </Stack.Protected>
            </Stack>
          </SafeAreaProvider>
        </View>
      </NavigationThemeProvider>
    </LocaleProvider>
  );
}
