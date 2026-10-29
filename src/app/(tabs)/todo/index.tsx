import { Stack } from 'expo-router';
import { PartyPopper } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { AssignmentRow } from '@/components/AssignmentRow';
import { Chip, EmptyState, ListGroup, Screen } from '@/design';
import { type AssignmentStatus, assignments } from '@/mocks/canvas';

type Filter = 'all' | AssignmentStatus;

const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'dueToday', label: 'Due today' },
  { value: 'missing', label: 'Missing' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'submitted', label: 'Submitted' },
];

export default function TodoScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const visible = assignments.filter((a) => filter === 'all' || a.status === filter);

  return (
    <>
      <Stack.Screen options={{ title: 'To Do' }} />
      <Screen contentClassName="gap-4">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-4"
          contentContainerClassName="gap-2 px-4"
        >
          {filters.map((f) => (
            <Chip key={f.value} selected={filter === f.value} onPress={() => setFilter(f.value)}>
              {f.label}
            </Chip>
          ))}
        </ScrollView>
        {visible.length > 0 ? (
          <ListGroup>
            {visible.map((a) => (
              <AssignmentRow key={a.id} assignment={a} />
            ))}
          </ListGroup>
        ) : (
          <EmptyState
            icon={PartyPopper}
            title="Nothing here"
            description="No assignments match this filter."
          />
        )}
      </Screen>
    </>
  );
}
