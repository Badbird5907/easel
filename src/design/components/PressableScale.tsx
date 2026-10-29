import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { type HapticKind, haptics } from '../haptics';
import { AnimatedPressable } from '../interop';
import { motion } from '../tokens/layout';

export type PressableScaleProps = Omit<PressableProps, 'style'> & {
  className?: string;
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
  scaleTo = motion.pressScale.default,
  haptic,
  onPressIn,
  onPressOut,
  onPress,
  style,
  ...props
}: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => {
    const p = pressed.get();
    return reduceMotion ? { opacity: 1 - p * 0.3 } : { transform: [{ scale: 1 - p * (1 - scaleTo) }] };
  });

  return (
    <AnimatedPressable
      {...props}
      onPressIn={(e) => {
        pressed.set(withSpring(1, motion.spring.press));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.set(withSpring(0, motion.spring.press));
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) haptics[haptic]();
        onPress?.(e);
      }}
      style={style}
      animatedStyle={animatedStyle}
    />
  );
}
