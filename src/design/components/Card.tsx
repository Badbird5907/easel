import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';

import { cn } from '@/lib/cn';

import { useTheme } from '../theme/ThemeProvider';
import { motion } from '../tokens/layout';
import { PressableScale, type PressableScaleProps } from './PressableScale';

const card = cva('rounded-2xl', {
  variants: {
    variant: {
      /** Default. Lifted with a soft shadow in light mode, a hairline in dark. */
      elevated: 'bg-surface',
      outlined: 'border-hairline border-border bg-surface',
      filled: 'bg-surface-sunken',
    },
    padding: {
      none: '',
      sm: 'p-3',
      md: 'p-4',
      lg: 'p-5',
    },
  },
  defaultVariants: { variant: 'elevated', padding: 'md' },
});

export type CardProps = VariantProps<typeof card> & {
  children: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** Makes the whole card a button. */
  onPress?: PressableScaleProps['onPress'];
  accessibilityLabel?: string;
};

export function Card({
  variant,
  padding,
  className,
  style,
  onPress,
  accessibilityLabel,
  children,
}: CardProps) {
  const { scheme, shadows } = useTheme();
  const elevated = (variant ?? 'elevated') === 'elevated';
  const classes = cn(
    card({ variant, padding }),
    elevated && scheme === 'dark' && 'border-hairline border-border',
    className,
  );
  const cardStyle: StyleProp<ViewStyle> = [
    { borderCurve: 'continuous' },
    elevated && shadows.card ? { boxShadow: shadows.card } : null,
    style,
  ];

  if (onPress) {
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        scaleTo={motion.pressScale.subtle}
        onPress={onPress}
        className={classes}
        style={cardStyle}
      >
        {children}
      </PressableScale>
    );
  }

  return (
    <View className={classes} style={cardStyle}>
      {children}
    </View>
  );
}
