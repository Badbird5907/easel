import { useTranslation } from '@/i18n';
import { useDisplayTimeZone } from '@/lib/dates';
import { createGradePresentation } from './format';

export function useGradePresentation() {
  const { locale } = useTranslation();
  const zone = useDisplayTimeZone();
  return createGradePresentation(locale, zone);
}
