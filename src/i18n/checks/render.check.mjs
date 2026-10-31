/** Headless React server rendering of locale-dependent props; not native layout/AT verification. */
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as i18nModule from '../index.ts';
import * as datesModule from '../../lib/dates.ts';
// tsx exposes TS as CommonJS in this package; also accept an ESM runner.
const { useTranslation, setAccountLocale } = i18nModule.default ?? i18nModule;
const { formatTime, setDisplayTimeZone } = datesModule.default ?? datesModule;
const due = new Date('2026-11-01T06:30:00Z');
function Probe() {
  const { t, direction } = useTranslation();
  return React.createElement(
    'section',
    { dir: direction, 'aria-label': t('nav.settings') },
    t('home.members', { count: 3 }),
    ' | ',
    formatTime(due),
  );
}
setDisplayTimeZone('America/New_York');
setAccountLocale('A', 'en');
const en = renderToStaticMarkup(React.createElement(Probe));
assert.match(en, /3 members/);
setAccountLocale('A', 'fr');
const fr = renderToStaticMarkup(React.createElement(Probe));
assert.match(fr, /3 membres/);
assert.match(fr, /Réglages/);
setAccountLocale('B', 'ar');
const ar = renderToStaticMarkup(React.createElement(Probe));
assert.match(ar, /dir="rtl"/);
assert.match(ar, /الإعدادات/);
assert.ok(ar.includes(`${new Intl.NumberFormat('ar').format(3)} أعضاء`));
setAccountLocale('C');
assert.equal(renderToStaticMarkup(React.createElement(Probe)), en);
setAccountLocale(null);
setDisplayTimeZone(null);
console.log('Headless React locale rendering inputs passed (no native renderer or Canvas mocks)');
