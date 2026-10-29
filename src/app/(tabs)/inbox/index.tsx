import { Stack } from 'expo-router';
import { Inbox } from 'lucide-react-native';
import { useState } from 'react';

import { EmptyState, Screen, SearchField } from '@/design';

export default function InboxScreen() {
  const [query, setQuery] = useState('');
  return (
    <>
      <Stack.Screen options={{ title: 'Inbox' }} />
      <Screen contentClassName="gap-4">
        <SearchField value={query} onChangeText={setQuery} placeholder="Search messages" />
        <EmptyState
          icon={Inbox}
          title="No messages yet"
          description="Conversations with instructors and classmates will show up here."
        />
      </Screen>
    </>
  );
}
