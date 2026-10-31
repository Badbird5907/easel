import { Stack } from 'expo-router';

import { useStackScreenOptions } from '@/design';

export default function TabStackLayout() {
  return (
    <Stack screenOptions={useStackScreenOptions()}>
      {/* Tab roots draw their own title row with <Screen title>, so the bar above it goes. */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
