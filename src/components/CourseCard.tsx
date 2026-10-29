import { View } from 'react-native';

import { AccentScope, Card, Text } from '@/design';
import type { Course } from '@/mocks/canvas';

type Props = {
  course: Course;
  onPress?: () => void;
  className?: string;
};

export function formatScore(score: number | null) {
  return score === null ? null : `${(score * 100).toFixed(1)}%`;
}

/** Dashboard tile for one course, tinted with the student's course color. */
export function CourseCard({ course, onPress, className }: Props) {
  const score = formatScore(course.score);
  const label = [course.code, course.name, score && `grade ${score} ${course.letter ?? ''}`]
    .filter(Boolean)
    .join(', ');

  return (
    <AccentScope color={course.color} className={className}>
      <Card padding="none" onPress={onPress} accessibilityLabel={label} className="flex-1">
        <View
          className="h-[76px] justify-end overflow-hidden rounded-t-2xl bg-accent px-3.5 pb-3"
          style={{ borderCurve: 'continuous' }}
        >
          {/* Two soft discs give the band depth without competing with the text. */}
          <View className="absolute -right-8 -top-12 h-32 w-32 rounded-full bg-white/10" />
          <View className="absolute -top-16 right-10 h-24 w-24 rounded-full bg-white/10" />
          <Text variant="caption" weight="semibold" tone="onAccent">
            {course.code}
          </Text>
        </View>
        <View className="flex-1 justify-between gap-3 p-3.5">
          <Text variant="headline" numberOfLines={2}>
            {course.name}
          </Text>
          {score ? (
            <View className="flex-row items-baseline gap-1.5">
              <Text variant="callout" weight="semibold" tone="accent" tabular>
                {score}
              </Text>
              <Text variant="footnote" tone="muted">
                {course.letter}
              </Text>
            </View>
          ) : (
            <Text variant="footnote" tone="subtle">
              No grade yet
            </Text>
          )}
        </View>
      </Card>
    </AccentScope>
  );
}
