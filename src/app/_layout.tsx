import '@/global.css';

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ThemeProvider, useNavigationTheme, useStackScreenOptions } from '@/design';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const ready = fontsLoaded || !!fontError;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <RootNavigator />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const navigationTheme = useNavigationTheme();
  const screenOptions = useStackScreenOptions();

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <StatusBar style="auto" />
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="design" options={{ title: 'Design System' }} />
      </Stack>
    </NavigationThemeProvider>
  );
}
