import { type ReactNode, useEffect } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { cn } from '@/lib/cn';

import { useReduceMotion } from '../accessibility/useReduceMotion';
import { AnimatedView } from '../interop';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorToken, Tone } from '../tokens/colors';
import { motion } from '../tokens/layout';

const toneFill: Record<Tone, ColorToken> = {
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
};

const clamp01 = (v: number) => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;

/** Animates toward `value` (0 to 1), or jumps there with Reduce Motion on. */
function useProgress(value: number) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    const target = clamp01(value);
    progress.set(reduceMotion ? target : withSpring(target, motion.spring.settle));
  }, [value, reduceMotion, progress]);
  return progress;
}

export type ProgressBarProps = {
  /** 0 to 1. */
  value: number;
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  accessibilityLabel?: string;
  className?: string;
};

export function ProgressBar({
  value,
  tone = 'accent',
  size = 'md',
  accessibilityLabel,
  className,
}: ProgressBarProps) {
  const { colors } = useTheme();
  const progress = useProgress(value);
  // Pixel widths from the measured track; animated percentage widths don't render reliably.
  const trackWidth = useSharedValue(0);
  const fillStyle = useAnimatedStyle(() => ({ width: progress.get() * trackWidth.get() }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamp01(value) * 100) }}
      onLayout={(e) => trackWidth.set(e.nativeEvent.layout.width)}
      className={cn(
        'overflow-hidden rounded-full bg-surface-sunken',
        size === 'sm' ? 'h-1' : size === 'md' ? 'h-1.5' : 'h-2.5',
        className,
      )}
    >
      <AnimatedView
        className="h-full rounded-full"
        style={{ backgroundColor: colors[toneFill[tone]] }}
        animatedStyle={fillStyle}
      />
    </View>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type ProgressRingProps = {
  /** 0 to 1. */
  value: number;
  size?: number;
  thickness?: number;
  tone?: Tone;
  /** Raw color for the arc, e.g. a course color. Wins over `tone`. */
  color?: string;
  /** Centered content, typically a percentage or grade. */
  children?: ReactNode;
  accessibilityLabel?: string;
};

export function ProgressRing({
  value,
  size = 56,
  thickness = 5,
  tone = 'accent',
  color,
  children,
  accessibilityLabel,
}: ProgressRingProps) {
  const { colors } = useTheme();
  const progress = useProgress(value);
  const { fontScale, width } = useWindowDimensions();
  size = children ? Math.min(size * Math.max(1, fontScale), width - 32) : size;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.get()),
  }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamp01(value) * 100) }}
      style={{ width: size, height: size }}
      className="items-center justify-center"
    >
      <Svg accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.surfaceSunken}
          strokeWidth={thickness}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color ?? colors[toneFill[tone]]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          fill="none"
          animatedProps={arcProps}
        />
      </Svg>
      {children}
    </View>
  );
}
