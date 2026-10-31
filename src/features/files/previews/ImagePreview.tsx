import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTranslation } from '@/i18n';
import { AnimatedView } from '@/design/interop';

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const settle = { damping: 26, stiffness: 260, mass: 0.8 };

/**
 * A picture with pinch zoom, pan, and double-tap zoom. Animated GIFs play.
 * While zoomed, a one-finger drag pans the picture instead of swiping to the
 * next attachment; `onZoomChange` lets the pager know.
 */
export function ImagePreview({
  uri,
  accessibilityLabel,
  onZoomChange,
  onError,
}: {
  uri: string;
  accessibilityLabel: string;
  onZoomChange?: (zoomed: boolean) => void;
  onError?: () => void;
}) {
  const { t } = useTranslation();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const reduceMotion = useReducedMotion();
  const width = useSharedValue(0);
  const height = useSharedValue(0);

  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const zoomed = useSharedValue(false);

  const report = (value: boolean) => onZoomChange?.(value);

  const setZoomed = (value: boolean) => {
    'worklet';
    if (zoomed.get() !== value) {
      zoomed.set(value);
      runOnJS(report)(value);
    }
  };

  const animate = (target: number) => {
    'worklet';
    return reduceMotion ? withTiming(target, { duration: 0 }) : withSpring(target, settle);
  };

  /** Keeps the picture covering the view: no panning past its edges. */
  const bound = (value: number, s: number, size: number) => {
    'worklet';
    const max = Math.max(0, (size * (s - 1)) / 2);
    return Math.min(max, Math.max(-max, value));
  };

  const settleInBounds = () => {
    'worklet';
    const s = Math.min(MAX_SCALE, Math.max(1, scale.get()));
    scale.set(animate(s));
    x.set(animate(bound(x.get(), s, width.get())));
    y.set(animate(bound(y.get(), s, height.get())));
    setZoomed(s > 1.01);
  };

  const pinch = usePinchGesture({
    onActivate: (event) => {
      'worklet';
      startScale.set(scale.get());
      startX.set(x.get());
      startY.set(y.get());
      // Focal point relative to the view's center.
      focalX.set(event.focalX - width.get() / 2);
      focalY.set(event.focalY - height.get() / 2);
    },
    onUpdate: (event) => {
      'worklet';
      const next = Math.min(MAX_SCALE * 1.2, Math.max(0.8, startScale.get() * event.scale));
      const ratio = next / startScale.get();
      // Zoom around the fingers: the point under them stays put.
      x.set(focalX.get() - (focalX.get() - startX.get()) * ratio);
      y.set(focalY.get() - (focalY.get() - startY.get()) * ratio);
      scale.set(next);
    },
    onDeactivate: () => {
      'worklet';
      settleInBounds();
    },
  });

  const pan = usePanGesture({
    enabled: zoomed,
    maxPointers: 2,
    onBegin: () => {
      'worklet';
      startX.set(x.get());
      startY.set(y.get());
    },
    onUpdate: (event) => {
      'worklet';
      x.set(startX.get() + event.translationX);
      y.set(startY.get() + event.translationY);
    },
    onDeactivate: () => {
      'worklet';
      settleInBounds();
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: (event) => {
      'worklet';
      if (scale.get() > 1.01) {
        scale.set(animate(1));
        x.set(animate(0));
        y.set(animate(0));
        setZoomed(false);
        return;
      }
      const target = DOUBLE_TAP_SCALE;
      const fx = event.x - width.get() / 2;
      const fy = event.y - height.get() / 2;
      scale.set(animate(target));
      x.set(animate(bound(-fx * (target - 1), target, width.get())));
      y.set(animate(bound(-fy * (target - 1), target, height.get())));
      setZoomed(true);
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }],
  }));

  return (
    <View
      className="flex-1 overflow-hidden"
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        width.set(w);
        height.set(h);
        setBox({ width: w, height: h });
      }}
    >
      <GestureDetector gesture={gesture}>
        <AnimatedView
          collapsable={false}
          style={StyleSheet.absoluteFill}
          animatedStyle={style}
          accessible
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={t('files.previews.zoomHint')}
        >
          {box.width > 0 ? (
            <Image
              source={{ uri }}
              style={{ width: box.width, height: box.height }}
              contentFit="contain"
              autoplay
              onError={onError}
              accessible={false}
            />
          ) : null}
        </AnimatedView>
      </GestureDetector>
    </View>
  );
}
