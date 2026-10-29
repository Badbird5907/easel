import { Stack } from 'expo-router';
import { CalendarDays } from 'lucide-react-native';

import { EmptyState, Screen } from '@/design';

export default function CalendarScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Calendar' }} />
      <Screen>
        <EmptyState
          icon={CalendarDays}
          title="Calendar is on the way"
          description="Due dates and events from every course will show up here in one timeline."
        />
      </Screen>
    </>
  );
}
