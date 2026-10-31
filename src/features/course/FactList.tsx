import { View } from 'react-native';

import { Card, Divider, Text } from '@/design';

export type Fact = {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'danger' | 'warning' | 'success';
};

/**
 * Label and value pairs (due dates, points, attempts). Values wrap rather than
 * truncate, so long dates and lists stay readable at large text sizes.
 */
export function FactList({ facts }: { facts: (Fact | null | false | undefined)[] }) {
  const rows = facts.filter((f): f is Fact => !!f);
  if (rows.length === 0) return null;
  return (
    <Card padding="none">
      {rows.map((fact, index) => (
        <View key={fact.label} accessible accessibilityLabel={`${fact.label}: ${fact.value}`}>
          {index > 0 ? <Divider inset={16} /> : null}
          <View className="flex-row gap-4 px-4 py-3">
            <Text variant="subhead" tone="muted" className="w-[34%]">
              {fact.label}
            </Text>
            <Text variant="subhead" weight="medium" tone={fact.tone ?? 'default'} className="flex-1">
              {fact.value}
            </Text>
          </View>
        </View>
      ))}
    </Card>
  );
}
