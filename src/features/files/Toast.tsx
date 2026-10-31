import { CircleAlert, CircleCheck } from 'lucide-react-native';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown, useReducedMotion } from 'react-native-reanimated';

import { Icon, Text, useTheme } from '@/design';

type ToastMessage = { id: number; text: string; tone: 'success' | 'danger' };

/** A brief confirmation ("Saved to Files") or failure above the bottom of the screen. */
export function useToast(bottomOffset = 16): {
  show: (text: string, tone?: ToastMessage['tone']) => void;
  toast: ReactNode;
} {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);
  const reduceMotion = useReducedMotion();
  const { shadows } = useTheme();

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback((text: string, tone: ToastMessage['tone'] = 'success') => {
    counter.current += 1;
    setMessage({ id: counter.current, text, tone });
    AccessibilityInfo.announceForAccessibility(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), tone === 'danger' ? 5000 : 2600);
  }, []);

  const toast = message ? (
    <View pointerEvents="none" className="absolute inset-x-4 items-center" style={{ bottom: bottomOffset }}>
      <Animated.View
        key={message.id}
        entering={reduceMotion ? undefined : FadeInDown.duration(180)}
        exiting={reduceMotion ? undefined : FadeOutDown.duration(160)}
        style={{ boxShadow: shadows.raised }}
      >
        <View
          className="max-w-[360px] flex-row items-center gap-2.5 rounded-2xl bg-surface-raised px-4 py-3"
          style={{ borderCurve: 'continuous' }}
        >
          <Icon icon={message.tone === 'success' ? CircleCheck : CircleAlert} size={18} tone={message.tone} />
          <Text variant="subhead" weight="medium" className="shrink">
            {message.text}
          </Text>
        </View>
      </Animated.View>
    </View>
  ) : null;

  return { show, toast };
}
