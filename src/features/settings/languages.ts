import { canonicalLocale } from '@/i18n/runtime';
/**
 * The languages Canvas offers (canvas-lms config/locales/locales.yml), each
 * named in its own language. The choice is saved to Canvas (`user[locale]`)
 * so it follows the student everywhere; Easel's pilot follows effective_locale with English fallback for untranslated catalogs.
 */
export const canvasLanguages: readonly (readonly [code: string, name: string])[] = [
  ['ar', 'العربية'],
  ['ca', 'Català'],
  ['cy', 'Cymraeg'],
  ['da', 'Dansk'],
  ['de', 'Deutsch'],
  ['el', 'Ελληνικά'],
  ['en', 'English (United States)'],
  ['en-AU', 'English (Australia)'],
  ['en-CA', 'English (Canada)'],
  ['en-GB', 'English (United Kingdom)'],
  ['es', 'Español (Latinoamérica)'],
  ['es-ES', 'Español (España)'],
  ['fa', 'فارسی'],
  ['fi', 'Suomi'],
  ['fr', 'Français (France)'],
  ['fr-CA', 'Français (Canada)'],
  ['ga', 'Gaeilge'],
  ['he', 'עברית'],
  ['hi', 'हिन्दी'],
  ['ht', 'Kreyòl Ayisyen'],
  ['hu', 'Magyar'],
  ['hy', 'Հայերեն'],
  ['id', 'Bahasa Indonesia'],
  ['is', 'Íslenska'],
  ['it', 'Italiano'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['mi', 'Te reo Māori'],
  ['ms', 'Bahasa Melayu'],
  ['nb', 'Norsk bokmål'],
  ['nl', 'Nederlands'],
  ['nn', 'Norsk nynorsk'],
  ['pl', 'Polski'],
  ['pt', 'Português (Portugal)'],
  ['pt-BR', 'Português (Brasil)'],
  ['ru', 'Русский'],
  ['sl', 'Slovenščina'],
  ['sv', 'Svenska'],
  ['th', 'ไทย'],
  ['tr', 'Türkçe'],
  ['uk', 'Українська'],
  ['vi', 'Tiếng Việt'],
  ['zh-Hans', '简体中文'],
  ['zh-Hant', '繁體中文'],
];

/** A locale's name, or the code itself for one Canvas added after this list. */
export function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  return canvasLanguages.find(([c]) => c === languageOptionCode(code))?.[1] ?? code;
}

/** Match Canvas aliases to picker values without changing the locale used for Intl formatting. */
export function languageOptionCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const canonical = canonicalLocale(code);
  if (canonical === 'en-US') return 'en';
  return canvasLanguages.find(([value]) => canonicalLocale(value) === canonical)?.[0] ?? code;
}
