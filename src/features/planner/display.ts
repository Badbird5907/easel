/** Explicit locale/zone inputs keep memoized fields current while a form stays mounted. */
export function dateTimeLabelFormatter(locale: string, timeZone: string, mode: 'date' | 'time') {
  return new Intl.DateTimeFormat(locale, {
    calendar: 'gregory',
    timeZone,
    ...(mode === 'date'
      ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
      : { hour: 'numeric', minute: '2-digit' }),
  } as Intl.DateTimeFormatOptions);
}
