import nativewindPreset from 'nativewind/preset';
import { hairlineWidth } from 'nativewind/theme';
import type { Config } from 'tailwindcss';

import { colorTokenNames, tokenToKebab } from './src/design/tokens/colors';
import { radii } from './src/design/tokens/radii';
import { fontFamilies, letterSpacingFor, textVariants, typeScale } from './src/design/tokens/typography';

// Semantic colors resolve to CSS variables set by <ThemeProvider />, so one class
// (`bg-surface`) works in light mode, dark mode, and inside <AccentScope />.
const colors = Object.fromEntries(
  colorTokenNames.map((token) => {
    const name = tokenToKebab(token);
    return [name, `rgb(var(--color-${name}) / <alpha-value>)`];
  }),
);

const fontSize = Object.fromEntries(
  textVariants.map((variant) => {
    const { size, lineHeight } = typeScale[variant];
    const config = { lineHeight: `${lineHeight}px`, letterSpacing: `${letterSpacingFor(variant)}px` };
    return [variant, [`${size}px`, config] as [string, typeof config]];
  }),
);

export default {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [nativewindPreset],
  theme: {
    // Replaces Tailwind's palette entirely: only semantic tokens are available.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#FFFFFF',
      black: '#000000',
      ...colors,
    },
    fontFamily: {
      sans: [fontFamilies.regular],
      'sans-medium': [fontFamilies.medium],
      'sans-semibold': [fontFamilies.semibold],
      'sans-bold': [fontFamilies.bold],
    },
    fontSize,
    borderRadius: {
      DEFAULT: `${radii.md}px`,
      ...Object.fromEntries(Object.entries(radii).map(([key, value]) => [key, `${value}px`])),
    },
    extend: {
      // NativeWind's preset extends `sans` to a platform system font; this extend runs later and wins.
      fontFamily: { sans: [fontFamilies.regular] },
      borderWidth: { hairline: hairlineWidth() },
      height: { hairline: hairlineWidth() },
    },
  },
  plugins: [],
} satisfies Config;
