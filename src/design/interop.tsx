import { cssInterop } from 'nativewind';
import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';

/**
 * Animated components that accept `className`.
 *
 * NativeWind drops className styles when a Reanimated animated style arrives in
 * the same `style` prop, so animated styles travel in `animatedStyle` instead and
 * are merged in after NativeWind has resolved the classes.
 *
 * Both wrap our own `createAnimatedComponent` results: Reanimated's prebuilt
 * `Animated.View` still loses the classes even with this split.
 */

const ReanimatedView = Animated.createAnimatedComponent(View);

type AnimatedViewProps = ComponentProps<typeof ReanimatedView> & {
  className?: string;
  animatedStyle?: ComponentProps<typeof ReanimatedView>['style'];
};

export function AnimatedView({ style, animatedStyle, ...props }: AnimatedViewProps) {
  return <ReanimatedView {...props} style={[style, animatedStyle]} />;
}
cssInterop(AnimatedView, { className: 'style' });

const ReanimatedPressable = Animated.createAnimatedComponent(Pressable);

type AnimatedPressableProps = ComponentProps<typeof ReanimatedPressable> & {
  className?: string;
  animatedStyle?: ComponentProps<typeof ReanimatedPressable>['style'];
};

export function AnimatedPressable({ style, animatedStyle, ...props }: AnimatedPressableProps) {
  return <ReanimatedPressable {...props} style={[style, animatedStyle]} />;
}
cssInterop(AnimatedPressable, { className: 'style' });
