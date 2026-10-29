import { type ColorScheme, type ColorTokens, courseColors, palettes } from '../tokens/colors';
import { contrast, ensureContrast, mix, readableOn } from './color';

type AccentTokens = Pick<ColorTokens, 'accent' | 'accentContrast' | 'accentSoft' | 'accentFg'>;

const darkVariants = new Map<string, string>(courseColors.map((c) => [c.light.toUpperCase(), c.dark]));

/**
 * Builds accent tokens from any color, typically a course color.
 *
 * Known Canvas palette colors use their hand-tuned dark variants. Anything else
 * is adjusted to stay legible: the fill keeps 3:1 against the surface (enough to
 * read as a control), and `accentFg` reaches 4.5:1 for text.
 */
export function deriveAccent(color: string, scheme: ColorScheme): AccentTokens {
  const base = palettes[scheme];
  const known = scheme === 'dark' ? darkVariants.get(color.toUpperCase()) : undefined;
  const accent = known ?? ensureContrast(color, base.surface, 3);
  const accentSoft = mix(base.surface, accent, scheme === 'dark' ? 0.2 : 0.12);
  const accentFg = ensureContrast(accent, accentSoft, 4.5);
  const accentContrast = readableOn(accent, '#FFFFFF', palettes.light.fg);

  return { accent, accentContrast, accentSoft, accentFg };
}

/** True when white text on `color` meets WCAG AA. Handy for course banners. */
export function prefersLightText(color: string): boolean {
  return contrast('#FFFFFF', color) >= 4.5;
}
