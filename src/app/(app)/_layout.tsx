import { useTranslation } from '@/i18n';
import { CanvasLocaleSync } from '@/features/settings/locale';
import { Stack } from 'expo-router';

import { useStackScreenOptions } from '@/design';
import { TermsRecheck } from '@/features/settings/TermsRecheck';
import { CanvasTimeZoneSync } from '@/features/settings/timeZone';

/**
 * Everything behind sign-in. Detail screens (courses, assignments, files,
 * conversations) live here, beside the tabs, so every tab opens them the
 * same way and Canvas links resolve to one route.
 */
export default function AppLayout() {
  const { t } = useTranslation();
  return (
    <CanvasLocaleSync>
      <CanvasTimeZoneSync />
      <TermsRecheck />
      <Stack screenOptions={useStackScreenOptions()}>
        {/* Title is what VoiceOver reads for the back button on pushed screens. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t('common.back') }} />
        <Stack.Screen name="settings" options={{ title: t('nav.settings') }} />
        <Stack.Screen name="design" options={{ title: t('nav.design') }} />
        <Stack.Screen name="add-account" options={{ title: t('nav.addAccount'), presentation: 'modal' }} />
        <Stack.Screen name="compose" options={{ title: t('nav.compose'), presentation: 'modal' }} />
      </Stack>
    </CanvasLocaleSync>
  );
}
