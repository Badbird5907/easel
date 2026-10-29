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
 * Pairs are contrast-checked by `npm run check-contrast`.
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
 * Brand accent is "Ultramarine", a painter's pigment blue. Neutrals are slightly
 * cool so course colors read clearly against them.
 */
export const palettes: Record<ColorScheme, ColorTokens> = {
  light: {
    bg: '#F3F4F6',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    surfaceSunken: '#EBEDF0',
    fg: '#0D1017',
    fgMuted: '#596070',
    fgSubtle: '#7C828F',
    border: '#E2E4E8',
    borderStrong: '#C9CDD4',
    overlay: '#05070C',

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
    bg: '#09090B',
    surface: '#141518',
    surfaceRaised: '#26282D',
    surfaceSunken: '#1C1E22',
    fg: '#F2F3F5',
    fgMuted: '#A0A6B1',
    fgSubtle: '#747A87',
    border: '#25272C',
    borderStrong: '#3A3D44',
    overlay: '#000000',

    accent: '#5465F5',
    accentContrast: '#FFFFFF',
    accentSoft: '#202340',
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
