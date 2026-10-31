import { useTranslation } from '@/i18n';
import { Stack } from 'expo-router';

import { EPortfolioList } from '@/features/eportfolios/EPortfolioList';

export default function EPortfoliosScreen() {
  const { t } = useTranslation();
  return <><Stack.Screen options={{ title: t('portfolios.title') }} /><EPortfolioList /></>;
}
