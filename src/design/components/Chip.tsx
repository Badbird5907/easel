import type { LucideIcon } from 'lucide-react-native';

import { cn } from '@/lib/cn';

import { Icon } from './Icon';
import { PressableScale, type PressableScaleProps } from './PressableScale';
import { Text } from './Text';

export type ChipProps = Omit<PressableScaleProps, 'children'> & {
  children: string;
  selected?: boolean;
  icon?: LucideIcon;
};

/** Filter and choice chip. Use in a horizontal row above the content it filters. */
export function Chip({ children, selected = false, icon, className, ...props }: ChipProps) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected }}
      haptic="selection"
      scaleTo={0.95}
      hitSlop={{ top: 4, bottom: 4 }}
      className={cn(
        'min-h-9 flex-row items-center gap-1.5 rounded-full border px-3.5 py-1.5',
        selected ? 'border-transparent bg-accent-soft' : 'border-border bg-surface',
        className,
      )}
      {...props}
    >
      {icon ? <Icon icon={icon} size={16} tone={selected ? 'accent' : 'muted'} /> : null}
      <Text
        variant="subhead"
        weight={selected ? 'semibold' : 'medium'}
        tone={selected ? 'accent' : 'default'}
      >
        {children}
      </Text>
    </PressableScale>
  );
}
