import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';

import { cn } from '@/lib/cn';

import { useTheme } from '../theme/ThemeProvider';
import { PressableScale, type PressableScaleProps } from './PressableScale';

const card = cva('rounded-2xl', {
  variants: {
    variant: {
      /** Default. Lifted by shadow in light mode and by surface lightness in dark. */
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
  /** Opt into one accessibility element for static content. Omit for cards with child controls. */
  accessible?: boolean;
  accessibilityLabel?: string;
};

export function Card({
  variant,
  padding,
  className,
  style,
  onPress,
  accessible,
  accessibilityLabel,
  children,
}: CardProps) {
  const { shadows } = useTheme();
  const elevated = (variant ?? 'elevated') === 'elevated';
  const classes = cn(
    card({ variant, padding }),
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
        accessible={accessible}
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        className={classes}
        style={cardStyle}
      >
        {children}
      </PressableScale>
    );
  }

  return (
    <View
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      className={classes}
      style={cardStyle}
    >
      {children}
    </View>
  );
}
