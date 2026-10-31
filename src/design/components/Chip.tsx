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
export function Chip({ children, selected = false, icon, className, accessibilityState, ...props }: ChipProps) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ ...accessibilityState, selected }}
      haptic="selection"
      className={cn(
        'min-h-9 flex-row items-center gap-1.5 rounded-full border px-3.5 py-1.5',
        selected ? 'border-transparent bg-accent' : 'border-border bg-surface',
        className,
      )}
      {...props}
    >
      {icon ? <Icon icon={icon} size={16} tone={selected ? 'onAccent' : 'muted'} strokeWidth={2} /> : null}
      <Text
        className="shrink"
        variant="subhead"
        weight={selected ? 'semibold' : 'medium'}
        tone={selected ? 'onAccent' : 'default'}
      >
        {children}
      </Text>
    </PressableScale>
  );
}
