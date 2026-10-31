import { CloudOff, WifiOff } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';
import { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, motion, Text } from '@/design';
import { AnimatedView } from '@/design/interop';
import { useTranslation } from '@/i18n';

import { retryConnectivity } from './connectivity';
import { useConnectivity } from './useOnline';

/**
 * A quiet strip under the status bar while Easel can't reach Canvas (OFF-1).
 * The root layout puts it above the navigator, so it pushes the screens down
 * instead of covering them. Screen readers hear the change when it happens.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const state = useConnectivity();
  const insets = useSafeAreaInsets();
  const offline = !state.network || !state.reachable;
  const message = !state.network
    ? t('offline.disconnected')
    : t('offline.unreachable', { host: state.host ?? t('offline.canvas') });

  const announced = useRef(false);
  useEffect(() => {
    if (offline) {
      AccessibilityInfo.announceForAccessibility(message);
      announced.current = true;
    } else if (announced.current) {
      AccessibilityInfo.announceForAccessibility(t('offline.online'));
      announced.current = false;
    }
  }, [offline, message, t]);

  if (!offline) return null;

  return (
    <AnimatedView
      entering={FadeIn.duration(motion.duration.base)}
      exiting={FadeOut.duration(motion.duration.base)}
      className="border-b-hairline border-border bg-surface-sunken"
      style={{ paddingTop: insets.top }}
    >
      <View className="min-h-10 flex-row items-center gap-2.5 px-4 py-2">
        <View accessible accessibilityRole="text" className="flex-1 flex-row items-center gap-2.5">
          <Icon icon={state.network ? CloudOff : WifiOff} size={16} tone="muted" />
          <Text variant="footnote" weight="medium" tone="muted" className="flex-1">
            {message}
          </Text>
        </View>
        {state.network ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('offline.retryHint', { host: state.host ?? t('offline.canvas') })}
            hitSlop={12}
            onPress={retryConnectivity}
            className="min-h-8 justify-center active:opacity-60"
          >
            <Text variant="footnote" weight="semibold" tone="accent">
              {t('offline.retry')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </AnimatedView>
  );
}
