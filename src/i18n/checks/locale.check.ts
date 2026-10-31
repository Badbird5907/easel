import { languageName, languageOptionCode } from '@/features/settings/languages';
import { formatMoment } from '@/features/reminders/model';
import { en } from '../en';
import { fr } from '../fr';
import { ar } from '../ar';
import {
  canonicalLocale,
  normalizeLocale,
  localeInfo,
  createTranslator,
  t,
  formatNumber,
  getLocaleState,
  setAccountLocale,
  resetAccountLocale,
  subscribeLocale,
} from '../runtime';
import type { Catalog, MessageKey } from '../types';
import {
  setDisplayTimeZone,
  formatDate,
  formatTime,
  formatShortDate,
  dayLabel,
  dueIn,
  relativeAge,
  relativeAgeLabel,
  fromWallTime,
  dateParts,
  dayKey,
  dateFormatter,
  addDays,
} from '@/lib/dates';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(value: unknown) {
  equal(!!value, true);
}
for (const [input, expected] of [
  ['FR_ca', 'fr-CA'],
  ['ar_SA', 'ar-SA'],
  ['iw', 'he'],
  ['in', 'id'],
  ['zh_CN', 'zh-Hans'],
  ['zh_TW', 'zh-Hant'],
  ['no', 'nb'],
  ['  EN_gb ', 'en-GB'],
  ['not_a_locale_!', 'en'],
  ['zz-ZZ', 'en'],
  ['', 'en'],
])
  equal(normalizeLocale(input), expected);
equal(canonicalLocale('zz-ZZ'), 'zz-ZZ');
equal(languageOptionCode('fr_CA'), 'fr-CA');
equal(languageOptionCode('en_US'), 'en');
equal(languageName('fr_CA'), 'Français (Canada)');
equal(languageName('zz-ZZ'), 'zz-ZZ');
equal(normalizeLocale(null), 'en');
equal(localeInfo('ar-EG').direction, 'rtl');
equal(localeInfo('fr-CA').catalog, 'fr');
equal(localeInfo('de-DE').catalog, 'en');
equal(createTranslator('de-DE')('nav.home'), 'Home');
equal(createTranslator('fr-CA')('nav.home'), 'Accueil');
equal(formatNumber(1234.5, undefined, 'fr-CA'), new Intl.NumberFormat('fr-CA').format(1234.5));
equal(createTranslator('en')('home.members', { count: 1 }), '1 member');
equal(createTranslator('en')('home.members', { count: 2 }), '2 members');
equal(createTranslator('fr')('home.members', { count: 0 }), '0 membre');
for (const [count, category] of [
  [0, 'zero'],
  [1, 'one'],
  [2, 'two'],
  [3, 'few'],
  [11, 'many'],
  [100, 'other'],
] as const) {
  equal(new Intl.PluralRules('ar').select(count), category);
  equal(
    createTranslator('ar')('home.members', { count }),
    ar['home.members'][category].replace('{count}', new Intl.NumberFormat('ar').format(count)),
  );
}
// Whole-catalog key AND placeholder parity, including every plural branch.
const slots = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
for (const catalog of [fr, ar] as Catalog[]) {
  equal(Object.keys(catalog).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en) as MessageKey[]) {
    const source = en[key];
    const expected = slots(typeof source === 'string' ? source : source.other);
    const translated = catalog[key];
    for (const text of typeof translated === 'string' ? [translated] : Object.values(translated)) {
      ok(text?.trim());
      equal(slots(text!), expected);
    }
  }
}
// Defensive JS caller behavior and English fallback for a catalog entry accidentally omitted at runtime.
const untyped = createTranslator('fr') as (key: string, params?: object) => string;
equal(untyped('missing.key'), 'missing.key');
equal(untyped('settings.signOut'), 'Déconnecter {name}');
const original = fr['nav.home'];
delete (fr as Partial<Catalog>)['nav.home'];
equal(untyped('nav.home'), 'Home');
fr['nav.home'] = original;
equal(
  createTranslator('en')('settings.signOut', { name: '<student> {name}' }),
  'Sign out of <student> {name}',
);
ok(createTranslator('ar')('settings.signOut', { name: 'Alice' }).includes('\u2068Alice\u2069'));

// Account transitions: cached, uncached, invalid, sign-out, and an obsolete boundary's cleanup.
setAccountLocale('A', 'fr');
equal(t('nav.home'), 'Accueil');
setAccountLocale('B');
equal(t('nav.home'), 'Home');
setAccountLocale('B', 'ar');
resetAccountLocale('A');
equal(getLocaleState().locale, 'ar');
resetAccountLocale('B');
equal(getLocaleState().accountId, null);
equal(t('nav.home'), 'Home');
setAccountLocale('A', 'fr-CA');
equal(getLocaleState().locale, 'fr-CA');
setAccountLocale('A', 'bad_tag_!');
equal(t('nav.home'), 'Home');

// Rendering inputs change without mutating/refetching data, including cached formatter facades.
const date = new Date('2027-01-01T01:05:00Z');
const facade = dateFormatter({ month: 'long', day: 'numeric' });
let notifications = 0;
const stop = subscribeLocale(() => notifications++);
for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
  setDisplayTimeZone(zone);
  for (const locale of ['en-US', 'en-GB', 'fr-CA', 'ar-EG', 'ar-SA', 'en-u-ca-islamic']) {
    setAccountLocale('A', locale);
    equal(
      formatTime(date),
      new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        calendar: 'gregory',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date),
    );
    equal(
      facade.format(date),
      new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        calendar: 'gregory',
        month: 'long',
        day: 'numeric',
      }).format(date),
    );
    const now = new Date('2026-12-31T00:00:00Z');
    const sameYear = dateParts(date).year === dateParts(now).year;
    equal(
      formatShortDate(date, now),
      new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        calendar: 'gregory',
        month: 'short',
        day: 'numeric',
        ...(sameYear ? {} : { year: 'numeric' }),
      }).format(date),
    );
    equal(dayLabel(date, date), createTranslator(locale)('date.today'));
    ok(!dueIn(new Date(date.getTime() + 120000), date).includes('{'));
    ok(!relativeAge(new Date(date.getTime() - 120000), date).includes('{'));
    equal(
      relativeAgeLabel(new Date(date.getTime() - 120000), date),
      new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-2, 'minute'),
    );
  }
}
ok(notifications >= 12);
stop();
// Elapsed labels cover each unit boundary and use absolute dates after a week.
// Consumers must not append English "ago" to these standalone display strings.
for (const locale of ['en', 'fr', 'ar-EG']) {
  setAccountLocale('A', locale);
  const clock = new Date('2027-01-02T12:00:00Z');
  const translate = createTranslator(locale);
  equal(relativeAgeLabel(clock, clock), translate('date.now'));
  for (const [minutes, value, unit] of [
    [1, 1, 'minute'],
    [59, 59, 'minute'],
    [60, 1, 'hour'],
    [1439, 23, 'hour'],
    [1440, 1, 'day'],
    [8639, 5, 'day'],
    [8640, 6, 'day'],
  ] as const) {
    equal(
      relativeAgeLabel(new Date(clock.getTime() - minutes * 60000), clock),
      new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-value, unit),
    );
  }
  const old = new Date(clock.getTime() - 7 * 86400000);
  equal(relativeAgeLabel(old, clock), formatShortDate(old, clock));
  const today = new Date();
  equal(
    formatMoment(today.getTime(), { midSentence: true }),
    translate('date.at', { day: translate('date.todayLower'), time: formatTime(today) }),
  );
}
setDisplayTimeZone('America/New_York');
for (const locale of ['en', 'fr', 'ar']) {
  setAccountLocale('A', locale);
  const gap = fromWallTime({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
  equal(gap.toISOString(), '2026-03-08T07:30:00.000Z');
  equal(
    fromWallTime({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }).toISOString(),
    '2026-11-01T05:30:00.000Z',
  );
  equal(dayKey(gap), '2026-03-08');
  equal(dateParts(addDays(gap, 1)).hour, 3);
  equal(
    formatDate(gap, { hour: 'numeric' }),
    new Intl.DateTimeFormat(locale, { timeZone: 'America/New_York', hour: 'numeric' }).format(gap),
  );
}
setAccountLocale(null);
setDisplayTimeZone(null);
console.log('Locale/catalog/account/date checks passed');

/** Compile-only contract: missing slots, invalid keys and string counts must fail typecheck. */
export function typeContract() {
  // @ts-expect-error unknown key
  t('not.a.key');
  // @ts-expect-error interpolation is required
  t('settings.signOut');
  // @ts-expect-error plural counts must be numbers
  t('home.members', { count: '2' });
}
