import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { cn } from '@/lib/cn';

import { useTheme } from '../theme/ThemeProvider';
import type { ColorToken, Tone } from '../tokens/colors';
import { Icon } from './Icon';
import { Text } from './Text';

export type BadgeTone = Tone | 'neutral';
type Variant = 'soft' | 'solid';

// Full class strings (not template literals) so Tailwind can see them.
const styles: Record<Variant, Record<BadgeTone, { box: string; text: string; icon: ColorToken }>> = {
  soft: {
    neutral: { box: 'bg-surface-sunken', text: 'text-fg-muted', icon: 'fgMuted' },
    accent: { box: 'bg-accent-soft', text: 'text-accent-fg', icon: 'accentFg' },
    success: { box: 'bg-success-soft', text: 'text-success-fg', icon: 'successFg' },
    warning: { box: 'bg-warning-soft', text: 'text-warning-fg', icon: 'warningFg' },
    danger: { box: 'bg-danger-soft', text: 'text-danger-fg', icon: 'dangerFg' },
    info: { box: 'bg-info-soft', text: 'text-info-fg', icon: 'infoFg' },
  },
  solid: {
    neutral: { box: 'bg-fg', text: 'text-bg', icon: 'bg' },
    accent: { box: 'bg-accent', text: 'text-accent-contrast', icon: 'accentContrast' },
    success: { box: 'bg-success', text: 'text-success-contrast', icon: 'successContrast' },
    warning: { box: 'bg-warning', text: 'text-warning-contrast', icon: 'warningContrast' },
    danger: { box: 'bg-danger', text: 'text-danger-contrast', icon: 'dangerContrast' },
    info: { box: 'bg-info', text: 'text-info-contrast', icon: 'infoContrast' },
  },
};

export type BadgeProps = {
  children: string | number;
  tone?: BadgeTone;
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  /** Leading status dot. */
  dot?: boolean;
  className?: string;
};

/** Compact status label: due dates, submission state, counts. */
export function Badge({
  children,
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  icon,
  dot,
  className,
}: BadgeProps) {
  const { colors } = useTheme();
  const s = styles[variant][tone];
  return (
    <View
      className={cn(
        'flex-row items-center rounded-full',
        size === 'sm' ? 'min-h-5 gap-1 px-2 py-0.5' : 'min-h-6 gap-1.5 px-2.5 py-1',
        s.box,
        className,
      )}
    >
      {dot ? <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors[s.icon] }} /> : null}
      {icon ? (
        <Icon icon={icon} size={size === 'sm' ? 12 : 14} color={colors[s.icon]} strokeWidth={2.25} />
      ) : null}
      <Text
        variant="caption"
        weight="semibold"
        tone="inherit"
        tabular
        numberOfLines={1}
        className={cn(s.text, size === 'sm' && 'text-[11px]')}
      >
        {String(children)}
      </Text>
    </View>
  );
}
