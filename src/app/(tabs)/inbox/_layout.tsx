import { Stack } from 'expo-router';

import { useStackScreenOptions } from '@/design';

export default function TabStackLayout() {
  return <Stack screenOptions={useStackScreenOptions()} />;
}
