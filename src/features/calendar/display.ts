/** Axis rows represent clock hours, not instants in the student's Canvas zone. */
export function hourAxisFormatter(locale: string) {
  return new Intl.DateTimeFormat(locale, { calendar: 'gregory', hour: 'numeric', timeZone: 'UTC' });
}

/** Logical period movement follows the viewing account, independently of the device language. */
export function pageDelta(translationX: number, direction: 'ltr' | 'rtl'): 1 | -1 {
  'worklet';
  return translationX < 0 !== (direction === 'rtl') ? 1 : -1;
}
