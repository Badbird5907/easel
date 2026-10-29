/**
 * Shape, spacing, and motion tokens.
 *
 * Spacing uses Tailwind's default 4pt scale (`p-4` = 16). The values here are
 * the few layout constants that need names.
 */

/**
 * Corner radii. Nested shapes should be concentric: inner radius = outer radius
 * minus the padding between them (a `rounded-2xl` card with `p-3` holds
 * `rounded-xl` children).
 */
export const radii = {
  none: 0,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 20,
  '3xl': 28,
  full: 9999,
} as const;

export const layout = {
  /** Horizontal screen margin. */
  gutter: 16,
  /** Smallest comfortable touch target, per Apple HIG and Material. */
  minTouch: 44,
  /** Readable content width on tablets and web. */
  maxContentWidth: 720,
} as const;

/** Elevation is shadow in light mode and a hairline border in dark mode. */
export const shadows = {
  light: {
    card: '0px 1px 2px rgba(13, 16, 23, 0.04), 0px 2px 10px rgba(13, 16, 23, 0.04)',
    raised: '0px 4px 12px rgba(13, 16, 23, 0.06), 0px 16px 40px rgba(13, 16, 23, 0.10)',
  },
  dark: {
    card: undefined,
    raised: '0px 16px 40px rgba(0, 0, 0, 0.5)',
  },
} as const;

export const motion = {
  duration: { fast: 120, base: 200, slow: 320 },
  spring: {
    /** Press feedback: quick and nearly critically damped. */
    press: { damping: 22, stiffness: 420, mass: 0.6 },
    /** Indicators sliding between positions (segmented control, tabs). */
    slide: { damping: 24, stiffness: 280, mass: 0.9 },
    /** Values settling into place (progress, counters). */
    settle: { damping: 20, stiffness: 120, mass: 1 },
  },
  pressScale: { default: 0.97, subtle: 0.985 },
} as const;
