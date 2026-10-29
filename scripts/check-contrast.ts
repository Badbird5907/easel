/**
 * Verifies every foreground/background pairing the components rely on meets
 * WCAG contrast, in both schemes and for every Canvas course color.
 *
 *   npm run check-contrast
 */
import { deriveAccent } from '../src/design/theme/accent';
import { contrast } from '../src/design/theme/color';
import {
  type ColorScheme,
  type ColorToken,
  courseColors,
  palettes,
  type Tone,
} from '../src/design/tokens/colors';

const TEXT = 4.5; // body text
const UI = 3; // large text, icons, control boundaries

type Check = { scheme: ColorScheme; label: string; ratio: number; min: number };
const checks: Check[] = [];

function check(scheme: ColorScheme, label: string, fg: string, bg: string, min: number) {
  checks.push({ scheme, label, ratio: contrast(fg, bg), min });
}

const tones: Tone[] = ['accent', 'success', 'warning', 'danger', 'info'];

for (const scheme of ['light', 'dark'] as const) {
  const c = palettes[scheme];
  for (const bg of ['bg', 'surface', 'surfaceSunken'] as ColorToken[]) {
    check(scheme, `fg on ${bg}`, c.fg, c[bg], TEXT);
    check(scheme, `fgMuted on ${bg}`, c.fgMuted, c[bg], TEXT);
    check(scheme, `fgSubtle on ${bg}`, c.fgSubtle, c[bg], UI);
  }
  for (const tone of tones) {
    const t = (suffix: string) => c[`${tone}${suffix}` as ColorToken];
    check(scheme, `${tone}Contrast on ${tone}`, t('Contrast'), c[tone], TEXT);
    check(scheme, `${tone}Fg on surface`, t('Fg'), c.surface, TEXT);
    check(scheme, `${tone}Fg on ${tone}Soft`, t('Fg'), t('Soft'), TEXT);
  }
  for (const course of courseColors) {
    const a = deriveAccent(course.light, scheme);
    check(scheme, `course ${course.id}: fill on surface`, a.accent, c.surface, UI);
    check(scheme, `course ${course.id}: contrast on fill`, a.accentContrast, a.accent, TEXT);
    check(scheme, `course ${course.id}: fg on soft`, a.accentFg, a.accentSoft, TEXT);
  }
}

const failures = checks.filter((c) => c.ratio < c.min);
for (const f of failures) {
  console.log(`✗ ${f.scheme.padEnd(5)} ${f.label.padEnd(36)} ${f.ratio.toFixed(2)} (needs ${f.min})`);
}
console.log(`${checks.length - failures.length}/${checks.length} pairs pass.`);
process.exit(failures.length ? 1 : 0);
