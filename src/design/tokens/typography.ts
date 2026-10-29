/**
 * Type scale. Inter for everything; sizes and roles follow the iOS text styles
 * so the hierarchy feels native on both platforms.
 *
 * Tracking follows Inter's dynamic metrics (tighter as size grows), which is
 * most of what makes large Inter headings look crisp instead of loose.
 */

export const fontFamilies = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export type FontWeight = keyof typeof fontFamilies;

type TypeStyle = {
  size: number;
  lineHeight: number;
  weight: FontWeight;
  /** Extra tracking in px added on top of Inter's dynamic tracking. */
  trackingAdjust?: number;
  uppercase?: boolean;
};

export const typeScale = {
  /** Hero numbers, greetings. */
  display: { size: 34, lineHeight: 40, weight: 'bold' },
  /** Screen titles when not using the native large title. */
  title1: { size: 28, lineHeight: 34, weight: 'bold' },
  /** Section heroes, sheet titles. */
  title2: { size: 22, lineHeight: 28, weight: 'semibold' },
  /** Section headers. */
  title3: { size: 20, lineHeight: 25, weight: 'semibold' },
  /** Row titles, card titles, emphasized body. */
  headline: { size: 17, lineHeight: 22, weight: 'semibold' },
  /** Default reading text. */
  body: { size: 16, lineHeight: 24, weight: 'regular' },
  /** Button labels, dense body. */
  callout: { size: 15, lineHeight: 20, weight: 'regular' },
  /** Row subtitles, secondary descriptions. */
  subhead: { size: 14, lineHeight: 20, weight: 'regular' },
  /** Metadata, helper text. */
  footnote: { size: 13, lineHeight: 18, weight: 'regular' },
  /** Badges, timestamps, tab labels. */
  caption: { size: 12, lineHeight: 16, weight: 'medium' },
  /** Small uppercase labels above groups. */
  overline: { size: 11, lineHeight: 14, weight: 'semibold', trackingAdjust: 0.6, uppercase: true },
} as const satisfies Record<string, TypeStyle>;

export type TextVariant = keyof typeof typeScale;

/** Inter's recommended tracking for a given size, in px. */
export function interTracking(size: number): number {
  const em = -0.0223 + 0.185 * Math.exp(-0.1745 * size);
  return Math.round(em * size * 100) / 100;
}

export function letterSpacingFor(variant: TextVariant): number {
  const style: TypeStyle = typeScale[variant];
  return interTracking(style.size) + (style.trackingAdjust ?? 0);
}

export const textVariants = Object.keys(typeScale) as TextVariant[];
