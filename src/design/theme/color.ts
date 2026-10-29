/**
 * Small color utilities for deriving themes from arbitrary colors (Canvas lets
 * users pick any hex for a course). Dependency-free so scripts can import it.
 */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return (
    '#' +
    [r, g, b]
      .map((v) =>
        Math.round(clamp(v, 0, 255))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
}

/** "61 79 224": the channel format Tailwind's `<alpha-value>` expects. */
export function toRgbChannels(hex: string): string {
  return hexToRgb(hex).join(' ');
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Linear blend from `a` (t = 0) to `b` (t = 1). */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => ca[i] + (cb[i] - ca[i]) * t) as RGB);
}

function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(channelToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Nudges `color` toward white or black until it reaches `ratio` against
 * `background`, keeping as much of the original hue as possible.
 */
export function ensureContrast(color: string, background: string, ratio: number): string {
  if (contrast(color, background) >= ratio) return color;
  const target = luminance(background) < 0.5 ? '#FFFFFF' : '#000000';
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(mix(color, target, mid), background) >= ratio) hi = mid;
    else lo = mid;
  }
  return mix(color, target, hi);
}

/** Whichever of the two candidates reads better on `background`. */
export function readableOn(background: string, light = '#FFFFFF', dark = '#0D1017'): string {
  return contrast(light, background) >= 4.5 || contrast(light, background) >= contrast(dark, background)
    ? light
    : dark;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
