/**
 * Easel color tokens.
 *
 * Components never reference raw hex values. They use the semantic roles below,
 * which resolve per color scheme. Each role is exposed three ways:
 *   - Tailwind classes: `bg-surface`, `text-fg-muted`, `border-border`, `bg-accent/10`
 *   - CSS variables (`--color-surface`), set at the root by <ThemeProvider />
 *   - JS values via `useTheme().colors.surface`, for props that need a raw color
 *
 * Every tone (accent, success, warning, danger, info) has four roles:
 *   tone           solid fill (buttons, switches, selected indicators)
 *   tone-contrast  text/icons placed on the solid fill
 *   tone-soft      tinted container background (badges, chips, icon tiles)
 *   tone-fg        tone-colored text/icons on surfaces and soft containers
 *
 * Pairs are contrast-checked by `pnpm run check-contrast`.
 */

export type ColorScheme = 'light' | 'dark';

export type ColorTokens = {
  /** App background behind grouped content. */
  bg: string;
  /** Cards, list groups, rows. */
  surface: string;
  /** Sheets, popovers, anything floating above surfaces. */
  surfaceRaised: string;
  /** Inputs, tracks, skeletons: recessed areas. */
  surfaceSunken: string;
  /** Primary text and icons. */
  fg: string;
  /** Secondary text: metadata, descriptions. */
  fgMuted: string;
  /** Tertiary text: placeholders, timestamps, disabled labels. */
  fgSubtle: string;
  /** Hairline dividers and card outlines. */
  border: string;
  /** Emphasized outlines (outline buttons, focused-adjacent states). */
  borderStrong: string;
  /** Scrim behind modals. Use with alpha, e.g. `bg-overlay/40`. */
  overlay: string;

  accent: string;
  accentContrast: string;
  accentSoft: string;
  accentFg: string;

  success: string;
  successContrast: string;
  successSoft: string;
  successFg: string;

  warning: string;
  warningContrast: string;
  warningSoft: string;
  warningFg: string;

  danger: string;
  dangerContrast: string;
  dangerSoft: string;
  dangerFg: string;

  info: string;
  infoContrast: string;
  infoSoft: string;
  infoFg: string;
};

export type ColorToken = keyof ColorTokens;
export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Neutrals are one near-neutral ramp (OKLCH hue 95, chroma 0.004) so course
 * colors and the accent read cleanly against them. The accent is "Ultramarine",
 * a painter's pigment blue, and marks what's interactive. Inside <AccentScope>
 * it becomes the course color.
 */
export const palettes: Record<ColorScheme, ColorTokens> = {
  light: {
    bg: '#F7F7F4',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    surfaceSunken: '#EEEEEB',
    fg: '#161614',
    fgMuted: '#5E5E5B',
    fgSubtle: '#7C7C79',
    border: '#E2E2DF',
    borderStrong: '#CECECB',
    overlay: '#0C0B0A',

    accent: '#3D4FE0',
    accentContrast: '#FFFFFF',
    accentSoft: '#E8EAFB',
    accentFg: '#3445D1',

    success: '#15803D',
    successContrast: '#FFFFFF',
    successSoft: '#E3F0E8',
    successFg: '#13703A',

    warning: '#F5A00B',
    warningContrast: '#1F1300',
    warningSoft: '#FEF4E2',
    warningFg: '#975000',

    danger: '#D92525',
    dangerContrast: '#FFFFFF',
    dangerSoft: '#FAE5E5',
    dangerFg: '#C11F1F',

    info: '#0B6BCB',
    infoContrast: '#FFFFFF',
    infoSoft: '#E2EDF9',
    infoFg: '#0A60B5',
  },
  dark: {
    bg: '#0C0B0A',
    surface: '#161614',
    surfaceRaised: '#302F2D',
    surfaceSunken: '#1C1C1A',
    fg: '#F4F3F1',
    fgMuted: '#AAA9A6',
    fgSubtle: '#848380',
    border: '#262624',
    borderStrong: '#3E3D3B',
    overlay: '#000000',

    accent: '#5465F5',
    accentContrast: '#FFFFFF',
    accentSoft: '#21243D',
    accentFg: '#8E9AFF',

    success: '#2BBF62',
    successContrast: '#03140A',
    successSoft: '#183425',
    successFg: '#4ADE80',

    warning: '#FBBF24',
    warningContrast: '#1F1300',
    warningSoft: '#3E341A',
    warningFg: '#FCC94D',

    danger: '#D0303A',
    dangerContrast: '#FFFFFF',
    dangerSoft: '#391B1E',
    dangerFg: '#FF7B7B',

    info: '#3B9BF5',
    infoContrast: '#04101F',
    infoSoft: '#1B2D40',
    infoFg: '#6CB6FF',
  },
};

/**
 * Canvas' course color palette, carried over from the native apps so colors a
 * student already picked look the same here. Canvas also allows arbitrary hex
 * course colors; <AccentScope /> derives dark-mode variants for those.
 */
export const courseColors = [
  { id: 'plum', name: 'Plum', light: '#A31C73', dark: '#DA54A9' },
  { id: 'fuchsia', name: 'Fuchsia', light: '#C54396', dark: '#FF7FCD' },
  { id: 'violet', name: 'Violet', light: '#9E58BD', dark: '#B966D1' },
  { id: 'ocean', name: 'Ocean', light: '#2573DF', dark: '#6B80EA' },
  { id: 'sky', name: 'Sky', light: '#197EAB', dark: '#498EBE' },
  { id: 'sea', name: 'Sea', light: '#00828E', dark: '#34959B' },
  { id: 'aurora', name: 'Aurora', light: '#048660', dark: '#229A71' },
  { id: 'forest', name: 'Forest', light: '#27872B', dark: '#339B38' },
  { id: 'honey', name: 'Honey', light: '#996E00', dark: '#A78315' },
  { id: 'copper', name: 'Copper', light: '#BF5811', dark: '#D26C26' },
  { id: 'rose', name: 'Rose', light: '#ED0000', dark: '#E8593C' },
  { id: 'stone', name: 'Stone', light: '#767676', dark: '#888888' },
] as const;

export type CourseColor = (typeof courseColors)[number];

/** `surfaceRaised` -> `surface-raised`, the Tailwind class / CSS variable suffix. */
export function tokenToKebab(token: string): string {
  return token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export const colorTokenNames = Object.keys(palettes.light) as ColorToken[];
