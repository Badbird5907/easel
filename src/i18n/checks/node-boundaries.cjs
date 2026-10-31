// Node supplies full Intl. Synthetic module loaders skip only the native-startup
// side effect; hermes-startup.check.mjs deliberately loads the real polyfills.
const intlPolyfills = Object.freeze({});
function isIntlPolyfills(name) {
  return name === '@/i18n/polyfills' || name === './polyfills' || /\/i18n\/polyfills\.ts$/.test(name);
}
module.exports = { isIntlPolyfills, intlPolyfills };
