import { useEffect } from 'react';
import {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { cn } from '@/lib/cn';

import { AnimatedView } from '../interop';

export type SkeletonProps = {
  /** Size and shape come from classes: `h-4 w-32`, `h-10 w-10 rounded-full`. */
  className?: string;
};

/** Placeholder for content that's loading. Pulses gently; static with Reduce Motion. */
export function Skeleton({ className }: SkeletonProps) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    opacity.set(withRepeat(withTiming(0.45, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [reduceMotion, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <AnimatedView
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn('h-4 rounded-md bg-surface-sunken', className)}
      animatedStyle={style}
    />
  );
}
