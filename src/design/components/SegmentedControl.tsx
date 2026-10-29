import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { cn } from '@/lib/cn';

import { haptics } from '../haptics';
import { AnimatedView } from '../interop';
import { useTheme } from '../theme/ThemeProvider';
import { motion } from '../tokens/layout';
import { Text } from './Text';

export type SegmentOption<T extends string> = { value: T; label: string };

export type SegmentedControlProps<T extends string> = {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  accessibilityLabel?: string;
};

const PAD = 3;

/** Switches between views of the same content (Upcoming / Past, Week / Month). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const { scheme, shadows } = useTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const segment = width > 0 ? (width - PAD * 2) / options.length : 0;

  const x = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    if (segment === 0) return;
    // Jump into place on first layout, glide afterwards.
    x.set(placed.current ? withSpring(index * segment, motion.spring.slide) : index * segment);
    placed.current = true;
  }, [index, segment, x]);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      className={cn('flex-row rounded-full bg-surface-sunken', className)}
      style={{ padding: PAD }}
    >
      {segment > 0 ? (
        <AnimatedView
          className={cn(
            'absolute rounded-full bg-surface-raised',
            scheme === 'dark' && 'border-hairline border-border-strong',
          )}
          style={[
            { top: PAD, bottom: PAD, left: PAD, width: segment },
            shadows.card ? { boxShadow: shadows.card } : null,
          ]}
          animatedStyle={thumbStyle}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              haptics.selection();
              onChange(option.value);
            }}
            className="min-h-9 flex-1 items-center justify-center px-3"
          >
            <Text variant="subhead" weight="semibold" tone={selected ? 'default' : 'muted'} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
