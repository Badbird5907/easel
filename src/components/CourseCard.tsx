import { LocalizedText as Text } from '@/i18n/LocalizedText';
import { View } from 'react-native';

import { AccentScope, Card } from '@/design';
import type { Course } from '@/canvas/models';

type Props = {
  course: Course;
  onPress?: () => void;
  className?: string;
};

/** Dashboard tile for one course, tinted with the student's course color. */
export function CourseCard({ course, onPress, className }: Props) {
  return (
    <AccentScope color={course.color} className={className}>
      <Card
        padding="none"
        onPress={onPress}
        accessibilityLabel={`${course.code}, ${course.name}`}
        // Content height first, then stretch to the row's tallest card.
        className="grow"
      >
        <View
          className="min-h-[76px] justify-end rounded-t-2xl bg-accent px-3.5 py-3"
          style={{ borderCurve: 'continuous' }}
        >
          <Text numberOfLines={1} variant="caption" weight="semibold" tone="onAccent">
            {course.code}
          </Text>
        </View>
        <View className="grow p-3.5">
          {/* A minimum height keeps short names aligned while longer names can grow. */}
          <Text variant="headline" numberOfLines={3} className="min-h-[44px]">
            {course.name}
          </Text>
        </View>
      </Card>
    </AccentScope>
  );
}
