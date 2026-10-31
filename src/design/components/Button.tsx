import { cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, View } from 'react-native';

import { cn } from '@/lib/cn';

import type { HapticKind } from '../haptics';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorToken } from '../tokens/colors';
import type { TextVariant } from '../tokens/typography';
import { Icon } from './Icon';
import { PressableScale, type PressableScaleProps } from './PressableScale';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'tonal' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

const container = cva('flex-row items-center justify-center rounded-full', {
  variants: {
    variant: {
      primary: 'bg-accent',
      secondary: 'bg-surface-sunken',
      tonal: 'bg-accent-soft',
      outline: 'border border-border-strong',
      ghost: '',
      destructive: 'bg-danger',
    } satisfies Record<ButtonVariant, string>,
    size: {
      // min-h (not h) so labels can grow with Dynamic Type.
      sm: 'min-h-9 px-3.5 py-1.5',
      md: 'min-h-11 px-5 py-2.5',
      lg: 'min-h-[52px] px-6 py-3',
    } satisfies Record<ButtonSize, string>,
  },
});

const labelClass: Record<ButtonVariant, string> = {
  primary: 'text-accent-contrast',
  secondary: 'text-fg',
  tonal: 'text-accent-fg',
  outline: 'text-fg',
  ghost: 'text-accent-fg',
  destructive: 'text-danger-contrast',
};

const contentToken: Record<ButtonVariant, ColorToken> = {
  primary: 'accentContrast',
  secondary: 'fg',
  tonal: 'accentFg',
  outline: 'fg',
  ghost: 'accentFg',
  destructive: 'dangerContrast',
};

const sizeSpec: Record<ButtonSize, { label: TextVariant; icon: number }> = {
  sm: { label: 'subhead', icon: 16 },
  md: { label: 'callout', icon: 18 },
  lg: { label: 'headline', icon: 20 },
};

export type ButtonProps = Omit<PressableScaleProps, 'children'> & {
  children: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
  /** Shows a spinner alongside the label and blocks presses. */
  loading?: boolean;
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  leadingIcon,
  trailingIcon,
  loading = false,
  disabled,
  haptic,
  className,
  accessibilityState,
  ...props
}: ButtonProps) {
  const { colors } = useTheme();
  const spec = sizeSpec[size];
  const contentColor = colors[contentToken[variant]];
  const inactive = disabled || loading;
  const defaultHaptic: HapticKind | undefined =
    variant === 'primary' || variant === 'destructive' ? 'light' : undefined;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ ...accessibilityState, disabled: !!inactive || !!accessibilityState?.disabled, busy: loading || accessibilityState?.busy }}
      disabled={inactive}
      haptic={haptic ?? defaultHaptic}
      className={cn(container({ variant, size }), disabled && 'opacity-40', className)}
      {...props}
    >
      <View
        className={cn('max-w-full flex-row items-center justify-center', size === 'sm' ? 'gap-1.5' : 'gap-2')}
      >
        {loading ? <ActivityIndicator accessible={false} importantForAccessibility="no" color={contentColor} size="small" /> : null}
        {leadingIcon ? <Icon icon={leadingIcon} size={spec.icon} color={contentColor} strokeWidth={2} /> : null}
        <Text
          variant={spec.label}
          weight="semibold"
          tone="inherit"
          className={cn('shrink text-center', labelClass[variant])}
        >
          {children}
        </Text>
        {trailingIcon ? <Icon icon={trailingIcon} size={spec.icon} color={contentColor} strokeWidth={2} /> : null}
      </View>
    </PressableScale>
  );
}
