import { X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';

import { useReduceMotion } from '../accessibility/useReduceMotion';
import { AnimatedView } from '../interop';
import { useTheme } from '../theme/ThemeProvider';
import { layout } from '../tokens/layout';
import { IconButton } from './IconButton';
import { Text } from './Text';

type Toast = {
  id: number;
  message: string;
  action?: { label: string; onPress: () => void };
};

const GAP = 12;
let nextId = 1;

/** Messages stay until dismissed: callers also use this API for errors and Undo. */
export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const hide = useCallback(() => setToast(null), []);
  return {
    show: (message: string, action?: Toast['action']) => setToast({ id: nextId++, message, action }),
    hide,
    element: <ToastView toast={toast} onClose={hide} />,
  };
}

function ToastView({ toast, onClose }: { toast: Toast | null; onClose: () => void }) {
  const { shadows } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (!toast) return;
    const message = toast.action
      ? t('common.actionAvailable', { message: toast.message, action: toast.action.label })
      : toast.message;
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
    } else {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [toast, t]);

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0 bottom-0 items-center px-4"
      style={{ paddingBottom: (Platform.OS === 'ios' ? insets.bottom : 0) + GAP }}
    >
      {toast ? (
        <AnimatedView
          key={toast.id}
          entering={reduceMotion ? undefined : FadeInDown.duration(200)}
          exiting={reduceMotion ? undefined : FadeOutDown.duration(160)}
          className="w-full max-w-[560px] rounded-2xl border-hairline border-border bg-surface-raised p-2"
          style={[{ borderCurve: 'continuous', maxHeight: height * 0.5 }, shadows.raised ? { boxShadow: shadows.raised } : null]}
        >
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
            <View style={{ flexDirection: fontScale > 1.3 ? 'column' : 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="subhead" className="shrink py-2 pl-2" style={{ flex: fontScale > 1.3 ? undefined : 1, alignSelf: 'stretch' }}>
                {toast.message}
              </Text>
              <View className="flex-row flex-wrap items-center justify-end gap-2 self-end">
                {toast.action ? (
                  <Pressable
                    accessibilityRole="button"
                    style={{ minHeight: layout.minTouch, minWidth: layout.minTouch }}
                    onPress={() => {
                      toast.action?.onPress();
                      onClose();
                    }}
                    className="shrink justify-center rounded-xl px-3 active:bg-accent-soft"
                  >
                    <Text variant="subhead" weight="semibold" tone="accent">{toast.action.label}</Text>
                  </Pressable>
                ) : null}
                <IconButton icon={X} accessibilityLabel={t('common.dismissMessage')} onPress={onClose} />
              </View>
            </View>
          </ScrollView>
        </AnimatedView>
      ) : null}
    </View>
  );
}
