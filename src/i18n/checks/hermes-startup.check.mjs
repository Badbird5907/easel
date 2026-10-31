// Run with: node --import tsx src/i18n/checks/hermes-startup.check.mjs
import assert from 'node:assert/strict';

// Model the missing Intl constructors in the shipped Android Hermes runtime.
// Imports must happen after removal, including runtime's initial locale state.
const names = ['getCanonicalLocales', 'Locale', 'PluralRules', 'RelativeTimeFormat', 'ListFormat'];
const native = Object.fromEntries(names.map((name) => [name, Intl[name]]));
const preserveNative = process.argv.includes('--native');
if (!preserveNative) {
  for (const name of names) {
    Object.defineProperty(Intl, name, { configurable: true, writable: true, value: undefined });
  }
}
const numberFormat = Intl.NumberFormat;
const dateTimeFormat = Intl.DateTimeFormat;
const { createTranslator, normalizeLocale, setAccountLocale, t } = await import('../runtime.ts');

assert.equal(createTranslator('en')('nav.home'), 'Home');
assert.equal(createTranslator('en')('home.members', { count: 1 }), '1 member');
assert.equal(createTranslator('en')('home.members', { count: 2 }), '2 members');
assert.equal(createTranslator('fr')('home.members', { count: 0 }), '0 membre');
assert.equal(normalizeLocale('fr_CA'), 'fr-CA');
assert.equal(normalizeLocale('ar_SA'), 'ar-SA');
assert.equal(normalizeLocale('not_a_locale_!'), 'en');
setAccountLocale('test-account', 'fr');
assert.equal(t('nav.home'), 'Accueil');
setAccountLocale(null);
assert.equal(t('nav.home'), 'Home');

for (const [count, category] of [[0, 'zero'], [1, 'one'], [2, 'two'], [3, 'few'], [11, 'many'], [100, 'other']]) {
  assert.equal(new Intl.PluralRules('ar').select(count), category);
}
assert.equal(new Intl.RelativeTimeFormat('en').format(-2, 'day'), '2 days ago');
assert.equal(new Intl.RelativeTimeFormat('fr').format(-2, 'day'), 'il y a 2 jours');
assert.equal(new Intl.ListFormat('en', { type: 'disjunction' }).format(['PDF', 'PNG']), 'PDF or PNG');
assert.equal(new Intl.ListFormat('fr').format(['A', 'B']), 'A et B');
assert.ok(new Intl.RelativeTimeFormat('ar').format(-2, 'day').length);
assert.ok(new Intl.ListFormat('ar').format(['A', 'B']).length);
assert.equal(Intl.NumberFormat, numberFormat, 'retain native number formatting');
assert.equal(Intl.DateTimeFormat, dateTimeFormat, 'retain native date/time-zone formatting');
if (preserveNative) {
  for (const name of names) assert.equal(Intl[name], native[name], `retain native ${name}`);
}
console.log('Hermes startup and formatter compatibility checks passed');
