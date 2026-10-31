import type { ComponentRef, Ref } from 'react';
import type { PressableProps, StyleProp, View, ViewStyle } from 'react-native';
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { type HapticKind, haptics } from '../haptics';
import { AnimatedPressable } from '../interop';
import { useReduceMotion } from '../accessibility/useReduceMotion';
import { layout, motion } from '../tokens/layout';

export type PressableScaleProps = Omit<PressableProps, 'style'> & {
  className?: string;
  ref?: Ref<ComponentRef<typeof View>>;
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed. 1 disables the effect. */
  scaleTo?: number;
  /** Haptic fired on press. */
  haptic?: HapticKind;
};

/**
 * The base interaction for anything tappable: shrinks slightly under the
 * finger and springs back. With Reduce Motion on, it dims instead.
 */
export function PressableScale({
  scaleTo = motion.pressScale,
  haptic,
  onPressIn,
  onPressOut,
  onPress,
  style,
  disabled,
  accessibilityState,
  ...props
}: PressableScaleProps) {
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => {
    const p = pressed.get();
    return reduceMotion ? { opacity: 1 - p * 0.3 } : { transform: [{ scale: 1 - p * (1 - scaleTo) }] };
  });

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled || accessibilityState?.disabled}
      accessibilityState={{ ...accessibilityState, disabled: !!(disabled || accessibilityState?.disabled) }}
      onPressIn={(e) => {
        pressed.set(reduceMotion ? 1 : withSpring(1, motion.spring.press));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.set(reduceMotion ? 0 : withSpring(0, motion.spring.press));
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) haptics[haptic]();
        onPress?.(e);
      }}
      style={[{ minWidth: layout.minTouch, minHeight: layout.minTouch }, style]}
      animatedStyle={animatedStyle}
    />
  );
}
