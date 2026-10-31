import { cva, type VariantProps } from 'class-variance-authority';
import { Platform, Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

import { type FontWeight, type TextVariant, typeScale } from '../tokens/typography';

const weightClass: Record<FontWeight, string> = {
  regular: 'font-sans',
  medium: 'font-sans-medium',
  semibold: 'font-sans-semibold',
  bold: 'font-sans-bold',
};

const text = cva('', {
  variants: {
    variant: {
      display: 'text-display',
      title1: 'text-title1',
      title2: 'text-title2',
      title3: 'text-title3',
      headline: 'text-headline',
      body: 'text-body',
      callout: 'text-callout',
      subhead: 'text-subhead',
      footnote: 'text-footnote',
      caption: 'text-caption',
      overline: 'text-overline uppercase',
    } satisfies Record<TextVariant, string>,
    tone: {
      default: 'text-fg',
      muted: 'text-fg-muted',
      subtle: 'text-fg-subtle',
      accent: 'text-accent-fg',
      success: 'text-success-fg',
      warning: 'text-warning-fg',
      danger: 'text-danger-fg',
      info: 'text-info-fg',
      /** For text on a solid accent fill. */
      onAccent: 'text-accent-contrast',
      inherit: '',
    },
    align: {
      left: 'text-left',
      center: 'text-center',
      right: 'text-right',
    },
  },
  defaultVariants: { variant: 'body', tone: 'default' },
});

export type TextProps = RNTextProps &
  VariantProps<typeof text> & {
    /** Overrides the variant's default weight. */
    weight?: FontWeight;
    /** Fixed-width digits, for grades, scores, and times that update in place. */
    tabular?: boolean;
    className?: string;
  };

export function Text({
  variant = 'body',
  tone,
  align = 'left',
  weight,
  tabular,
  className,
  style,
  maxFontSizeMultiplier,
  ...props
}: TextProps) {
  const { direction } = useTranslation();
  const resolvedWeight = weight ?? typeScale[variant ?? 'body'].weight;
  return (
    <RNText
      className={cn(text({ variant, tone, align }), weightClass[resolvedWeight], className)}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? 0}
      // Native left alignment resolves to the leading edge in RTL; don't mirror it twice.
      style={[
        tabular && { fontVariant: ['tabular-nums'] },
        androidMetrics,
        { direction },
        Platform.OS === 'ios' && { writingDirection: direction },
        style,
      ]}
      {...props}
    />
  );
}

// Inter ships tight vertical metrics; Android's extra font padding pushes text off center.
const androidMetrics = Platform.OS === 'android' ? { includeFontPadding: false } : undefined;
