/* eslint-disable @typescript-eslint/no-require-imports -- Conditional synchronous loading must precede locale initialization. */
// Hermes does not provide every Intl API. Install missing APIs synchronously
// before runtime.ts initializes, including in headless/background entry paths.
// Keep native implementations where available; dates and numbers stay native.
if (typeof Intl.getCanonicalLocales !== 'function') {
  require('@formatjs/intl-getcanonicallocales/polyfill-force.js');
}
if (typeof Intl.Locale !== 'function') {
  require('@formatjs/intl-locale/polyfill-force.js');
}
if (typeof Intl.PluralRules !== 'function') {
  require('@formatjs/intl-pluralrules/polyfill-force.js');
  require('@formatjs/intl-pluralrules/locale-data/en.js');
  require('@formatjs/intl-pluralrules/locale-data/fr.js');
  require('@formatjs/intl-pluralrules/locale-data/ar.js');
}
if (typeof Intl.RelativeTimeFormat !== 'function') {
  require('@formatjs/intl-relativetimeformat/polyfill-force.js');
  require('@formatjs/intl-relativetimeformat/locale-data/en.js');
  require('@formatjs/intl-relativetimeformat/locale-data/fr.js');
  require('@formatjs/intl-relativetimeformat/locale-data/ar.js');
}
if (typeof Intl.ListFormat !== 'function') {
  require('@formatjs/intl-listformat/polyfill-force.js');
  require('@formatjs/intl-listformat/locale-data/en.js');
  require('@formatjs/intl-listformat/locale-data/fr.js');
  require('@formatjs/intl-listformat/locale-data/ar.js');
}
