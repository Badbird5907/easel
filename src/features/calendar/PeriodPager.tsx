import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { View } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
} from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { AnimatedView } from '@/design/interop';
import { useReduceMotion } from '@/design/accessibility/useReduceMotion';
import { useTranslation } from '@/i18n';
import { pageDelta } from './display';

type Props = {
  children: ReactNode;
  /** Changes whenever the period on screen changes, so the new one can slide in. */
  pageKey: string;
  /** Swiped to the next (1) or previous (-1) period. */
  onPage: (delta: 1 | -1) => void;
  /** Pinched open (`in`, a closer view) or closed (`out`, a wider one). */
  onPinch?: (direction: 'in' | 'out') => void;
};

/** How far, or how fast, a swipe has to go to turn the page. */
const PAGE_DISTANCE = 72;
const PAGE_VELOCITY = 600;
const OUT_MS = 140;
const IN_MS = 220;

/**
 * Swipe sideways between periods (CAL-2) and pinch to zoom between views.
 * The content follows the finger, slides out, and the next period slides in
 * from the other side. With Reduce Motion it just changes. Vertical scrolling
 * inside keeps working: the swipe gives up as soon as a drag goes vertical.
 */
export function PeriodPager({ children, pageKey, onPage, onPinch }: Props) {
  const reduceMotion = useReduceMotion();
  const { direction } = useTranslation();
  const width = useSharedValue(0);
  const x = useSharedValue(0);
  const pending = useRef<1 | -1 | null>(null);
  const rtl = direction === 'rtl';

  const commit = (delta: 1 | -1) => {
    pending.current = delta;
    onPage(delta);
  };
  const pinched = (direction: 'in' | 'out') => onPinch?.(direction);

  // The new period is on screen but hasn't painted: start it beside the old one's exit.
  useLayoutEffect(() => {
    const delta = pending.current;
    pending.current = null;
    if (delta === null || reduceMotion) {
      x.set(0);
      return;
    }
    const from = (rtl ? -1 : 1) * delta * width.get() * 0.35;
    x.set(from);
    x.set(withTiming(0, { duration: IN_MS, easing: Easing.out(Easing.cubic) }));
  }, [pageKey, reduceMotion, rtl, width, x]);

  const pan = usePanGesture({
    activeOffsetX: [-18, 18],
    failOffsetY: [-14, 14],
    onUpdate: (event) => {
      'worklet';
      x.set(event.translationX * 0.9);
    },
    onDeactivate: (event) => {
      'worklet';
      const dx = event.translationX;
      const far = Math.abs(dx) > PAGE_DISTANCE || Math.abs(event.velocityX) > PAGE_VELOCITY;
      if (!far || Math.sign(dx) !== Math.sign(event.velocityX || dx)) {
        x.set(withTiming(0, { duration: IN_MS }));
        return;
      }
      // Dragging left shows what's next (right in RTL).
      const delta = pageDelta(dx, direction);
      if (reduceMotion) {
        x.set(0);
        runOnJS(commit)(delta);
        return;
      }
      x.set(
        withTiming(Math.sign(dx) * width.get() * 0.5, { duration: OUT_MS }, (finished) => {
          if (finished) runOnJS(commit)(delta);
        }),
      );
    },
  });

  // A pinch changes the view once, as soon as it passes the threshold.
  const pinchedOnce = useSharedValue(false);
  const pinch = usePinchGesture({
    enabled: !!onPinch,
    onBegin: () => {
      'worklet';
      pinchedOnce.set(false);
    },
    onUpdate: (event) => {
      'worklet';
      if (pinchedOnce.get()) return;
      if (event.scale > 1.2) {
        pinchedOnce.set(true);
        runOnJS(pinched)('in');
      } else if (event.scale < 0.83) {
        pinchedOnce.set(true);
        runOnJS(pinched)('out');
      }
    },
  });

  const gesture = useSimultaneousGestures(pan, pinch);

  const style = useAnimatedStyle(() => {
    const w = width.get() || 1;
    return {
      transform: [{ translateX: x.get() }],
      opacity: 1 - Math.min(0.6, Math.abs(x.get()) / w),
    };
  });

  return (
    <View className="overflow-hidden" onLayout={(e) => width.set(e.nativeEvent.layout.width)}>
      <GestureDetector gesture={gesture}>
        <AnimatedView collapsable={false} animatedStyle={style}>
          {children}
        </AnimatedView>
      </GestureDetector>
    </View>
  );
}
