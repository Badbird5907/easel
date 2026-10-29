import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { cn } from '@/lib/cn';

import { deriveAccent } from '../theme/accent';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorToken, Tone } from '../tokens/colors';
import { Icon } from './Icon';

type Size = 'sm' | 'md' | 'lg';

const sizes: Record<Size, { box: number; icon: number; radius: string }> = {
  sm: { box: 28, icon: 16, radius: 'rounded-md' },
  md: { box: 36, icon: 20, radius: 'rounded-lg' },
  lg: { box: 44, icon: 24, radius: 'rounded-xl' },
};

const softBg: Record<Tone | 'neutral', string> = {
  accent: 'bg-accent-soft',
  success: 'bg-success-soft',
  warning: 'bg-warning-soft',
  danger: 'bg-danger-soft',
  info: 'bg-info-soft',
  neutral: 'bg-surface-sunken',
};

const softFg: Record<Tone | 'neutral', ColorToken> = {
  accent: 'accentFg',
  success: 'successFg',
  warning: 'warningFg',
  danger: 'dangerFg',
  info: 'infoFg',
  neutral: 'fgMuted',
};

export type IconTileProps = {
  icon: LucideIcon;
  size?: Size;
  /** Tinted tile in a semantic tone. */
  tone?: Tone | 'neutral';
  /** Solid tile in any color (e.g. a course color), adjusted for the scheme. */
  color?: string;
  className?: string;
};

/** A rounded square holding an icon: leading visuals in rows, cards, and headers. */
export function IconTile({ icon, size = 'md', tone = 'accent', color, className }: IconTileProps) {
  const theme = useTheme();
  const spec = sizes[size];
  const solid = color ? deriveAccent(color, theme.scheme) : null;

  return (
    <View
      className={cn('items-center justify-center', spec.radius, !solid && softBg[tone], className)}
      style={[
        { width: spec.box, height: spec.box, borderCurve: 'continuous' },
        solid && { backgroundColor: solid.accent },
      ]}
    >
      <Icon icon={icon} size={spec.icon} color={solid ? solid.accentContrast : theme.colors[softFg[tone]]} />
    </View>
  );
}
