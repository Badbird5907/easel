import { useEffect, useRef, useState } from 'react';
import { I18nManager, Pressable, useWindowDimensions, View } from 'react-native';
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { cn } from '@/lib/cn';

import { haptics } from '../haptics';
import { AnimatedView } from '../interop';
import { useTheme } from '../theme/ThemeProvider';
import { useReduceMotion } from '../accessibility/useReduceMotion';
import { layout, motion } from '../tokens/layout';
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
  const { shadows } = useTheme();
  const reduceMotion = useReduceMotion();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > 1.3;
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
    const target = index * segment * (I18nManager.isRTL ? -1 : 1);
    x.set(!reduceMotion && placed.current ? withSpring(target, motion.spring.slide) : target);
    placed.current = true;
  }, [index, segment, x, reduceMotion]);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      className={cn('rounded-2xl bg-surface-sunken', !stacked && 'flex-row rounded-full', className)}
      style={{ padding: PAD }}
    >
      {segment > 0 && !stacked ? (
        <AnimatedView
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute rounded-full bg-surface-raised"
          style={[
            { top: PAD, bottom: PAD, start: PAD, width: segment },
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
            style={{ minHeight: layout.minTouch, minWidth: layout.minTouch }}
            className={cn('items-center justify-center rounded-full px-3 py-1.5', !stacked && 'flex-1', stacked && selected && 'bg-surface-raised')}
          >
            <Text variant="subhead" weight="semibold" tone={selected ? 'default' : 'muted'} align="center">
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
