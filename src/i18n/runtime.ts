import './polyfills';

import { en } from './en';
import { fr } from './fr';
import { ar } from './ar';
import type { Catalog, MessageKey, PluralMessage, Translate } from './types';

/** Canvas aliases plus legacy language tags accepted by older Canvas schools. */
const aliases: Record<string, string> = {
  'zh-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant-HK',
  'en-us': 'en-US',
  iw: 'he',
  in: 'id',
  no: 'nb',
  'pt-br': 'pt-BR',
};
/** Canonical syntax only, useful for metadata lookup without conflating unknown tags with English. */
export function canonicalLocale(value: string | null | undefined): string | null {
  const input = value?.trim().replace(/_/g, '-');
  if (!input) return null;
  try {
    return Intl.getCanonicalLocales(aliases[input.toLowerCase()] ?? input)[0] ?? null;
  } catch {
    return null;
  }
}
export function normalizeLocale(value: string | null | undefined): string {
  const canonical = canonicalLocale(value);
  try {
    // Every formatter uses the same fallback, never the host device's implicit language.
    return canonical &&
      Intl.DateTimeFormat.supportedLocalesOf([canonical]).length &&
      Intl.NumberFormat.supportedLocalesOf([canonical]).length &&
      Intl.PluralRules.supportedLocalesOf([canonical]).length &&
      Intl.RelativeTimeFormat.supportedLocalesOf([canonical]).length
      ? canonical
      : 'en';
  } catch {
    return 'en';
  }
}
export function localeInfo(value: string | null | undefined) {
  const locale = normalizeLocale(value);
  const language = locale.split('-')[0];
  const catalog = language === 'fr' || language === 'ar' ? language : 'en';
  // Direction follows the displayed catalog until a translation exists, not untranslated Canvas content.
  return { locale, catalog, direction: catalog === 'ar' ? 'rtl' : 'ltr' } as const;
}
export type LocaleState = ReturnType<typeof localeInfo> & { accountId: string | null };
let state: LocaleState = { ...localeInfo('en'), accountId: null };
const listeners = new Set<() => void>();
export const getLocaleState = () => state;
export const displayLocale = () => state.locale;
export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** No cross-account locale cache. Missing effective_locale always starts in English. */
export function setAccountLocale(accountId: string | null, effectiveLocale?: string | null) {
  const next = { ...localeInfo(accountId ? effectiveLocale : 'en'), accountId };
  if (next.locale === state.locale && next.accountId === state.accountId) return false;
  state = next;
  for (const listener of listeners) listener();
  return true;
}
export function resetAccountLocale(accountId: string) {
  if (state.accountId === accountId) setAccountLocale(null);
}
export function formatNumber(value: number, options?: Intl.NumberFormatOptions, locale = displayLocale()) {
  return new Intl.NumberFormat(normalizeLocale(locale), options).format(value);
}
const catalogs: Record<'en' | 'fr' | 'ar', Catalog> = { en, fr, ar };

/** Simple named interpolation and Intl cardinal plurals. No source-text lookup or ICU parsing. */
export function createTranslator(locale: string): Translate {
  const info = localeInfo(locale);
  const catalog = catalogs[info.catalog];
  const plurals = new Intl.PluralRules(info.catalog);
  return ((key: MessageKey, params: Record<string, string | number> = {}) => {
    const source = Object.hasOwn(en, key) ? (en as Catalog)[key] : undefined;
    if (!source) return String(key); // defensive for untyped callers
    const translated = catalog[key];
    const message = translated ?? source;
    const rules = translated ? plurals : new Intl.PluralRules('en');
    const template =
      typeof message === 'string'
        ? message
        : ((message as PluralMessage)[rules.select(Number(params.count))] ?? message.other);
    return template.replace(/\{(\w+)\}/g, (slot, name: string) => {
      const value = params[name];
      if (value === undefined) return slot; // visible diagnostic, never silently erase a missing value
      if (typeof value === 'number') return formatNumber(value, undefined, info.locale);
      // Isolate external names/search text in RTL sentences; leave Canvas content itself intact.
      return info.direction === 'rtl' ? `\u2068${value}\u2069` : value;
    });
  }) as Translate;
}
let translatorLocale = '';
let translator: Translate;
export const t: Translate = (key, ...args) => {
  if (translatorLocale !== state.locale) {
    translatorLocale = state.locale;
    translator = createTranslator(state.locale);
  }
  return translator(key, ...args);
};
