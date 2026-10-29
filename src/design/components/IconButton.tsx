import { cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react-native';

import { cn } from '@/lib/cn';

import { useTheme } from '../theme/ThemeProvider';
import type { ColorToken } from '../tokens/colors';
import { Icon } from './Icon';
import { PressableScale, type PressableScaleProps } from './PressableScale';

type Variant = 'ghost' | 'secondary' | 'tonal' | 'primary';
type Size = 'sm' | 'md' | 'lg';

const container = cva('items-center justify-center rounded-full', {
  variants: {
    variant: {
      ghost: '',
      secondary: 'bg-surface-sunken',
      tonal: 'bg-accent-soft',
      primary: 'bg-accent',
    } satisfies Record<Variant, string>,
    size: { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' } satisfies Record<Size, string>,
  },
});

const iconToken: Record<Variant, ColorToken> = {
  ghost: 'fg',
  secondary: 'fg',
  tonal: 'accentFg',
  primary: 'accentContrast',
};

const iconSize: Record<Size, number> = { sm: 18, md: 20, lg: 22 };
const slop: Record<Size, number> = { sm: 6, md: 2, lg: 0 };

export type IconButtonProps = Omit<PressableScaleProps, 'children'> & {
  icon: LucideIcon;
  /** Required: icon-only controls need a spoken name. */
  accessibilityLabel: string;
  variant?: Variant;
  size?: Size;
};

export function IconButton({
  icon,
  variant = 'ghost',
  size = 'md',
  disabled,
  className,
  ...props
}: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      scaleTo={0.92}
      hitSlop={slop[size]}
      className={cn(container({ variant, size }), disabled && 'opacity-40', className)}
      {...props}
    >
      <Icon icon={icon} size={iconSize[size]} color={colors[iconToken[variant]]} />
    </PressableScale>
  );
}
