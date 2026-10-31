import type { LucideIcon } from 'lucide-react-native';

import { useTranslation } from '@/i18n';

import { useTheme } from '../theme/ThemeProvider';
import type { ColorToken } from '../tokens/colors';

export type IconTone =
  'default' | 'muted' | 'subtle' | 'accent' | 'onAccent' | 'success' | 'warning' | 'danger' | 'info';

const toneToken: Record<IconTone, ColorToken> = {
  default: 'fg',
  muted: 'fgMuted',
  subtle: 'fgSubtle',
  accent: 'accentFg',
  onAccent: 'accentContrast',
  success: 'successFg',
  warning: 'warningFg',
  danger: 'dangerFg',
  info: 'infoFg',
};

export type IconProps = {
  icon: LucideIcon;
  size?: number;
  tone?: IconTone;
  /** Any color token; wins over `tone`. */
  token?: ColorToken;
  /** Raw color; wins over `token` and `tone`. Prefer tokens. */
  color?: string;
  strokeWidth?: number;
  /** Mirror in right-to-left layouts. For directional glyphs: chevrons, arrows. */
  flipInRTL?: boolean;
};

/**
 * Lucide icon colored from theme tokens. Strokes thin out slightly as icons grow
 * so small and large icons carry the same visual weight.
 */
export function Icon({ icon: Glyph, size = 20, tone = 'default', token, color, strokeWidth, flipInRTL }: IconProps) {
  const { colors } = useTheme();
  const { direction } = useTranslation();
  return (
    <Glyph
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      size={size}
      color={color ?? colors[token ?? toneToken[tone]]}
      strokeWidth={strokeWidth ?? 1.75}
      style={flipInRTL && direction === 'rtl' ? mirrored : undefined}
    />
  );
}

const mirrored = { transform: [{ scaleX: -1 }] };
