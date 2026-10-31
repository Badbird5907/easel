import { useGradePresentation } from '../presentation';
import { View } from 'react-native';

import { Text } from '@/design';

import { displayLetter, formatPercent, spokenLetter } from '../format';

type Props = {
  name: string;
  /** "30% of grade · Lowest score dropped". */
  detail: string | null;
  /** Group subtotal as a percentage. Null hides it (nothing graded, or totals hidden). */
  percent: number | null;
  /** Shown instead of the percentage under restricted data. */
  letter: string | null;
  restricted: boolean;
};

/** Assignment group title with its weight, drop rules, and subtotal. */
export function GroupHeader({ name, detail, percent, letter, restricted }: Props) {
  const p = useGradePresentation();
  const value = restricted
    ? letter
      ? displayLetter(letter, p)
      : null
    : percent !== null
      ? formatPercent(percent, p.locale)
      : null;
  const spoken = restricted ? (letter ? spokenLetter(letter, p) : null) : value;
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={[name, spoken, detail].filter(Boolean).join(', ')}
      className="gap-0.5 px-1"
    >
      <View className="flex-row items-baseline justify-between gap-3">
        <Text variant="title3" className="flex-1" numberOfLines={2}>
          {name}
        </Text>
        {value ? (
          <Text variant="headline" tabular>
            {value}
          </Text>
        ) : null}
      </View>
      {detail ? (
        <Text variant="footnote" tone="muted">
          {detail}
        </Text>
      ) : null}
    </View>
  );
}
