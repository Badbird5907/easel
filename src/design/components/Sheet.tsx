import { Check } from 'lucide-react-native';
import { type ComponentRef, type ReactNode, type RefObject, useMemo, useRef } from 'react';
import { AccessibilityInfo, Modal, PanResponder, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { SlideInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';

import { haptics } from '../haptics';
import { useReduceMotion } from '../accessibility/useReduceMotion';
import { layout, motion } from '../tokens/layout';
import { Icon } from './Icon';
import { ListGroup, ListItem } from './List';
import { Text } from './Text';
import { AnimatedView } from '../interop';

type SheetProps = {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Label for the button that closes the sheet. */
  doneLabel?: string;
  /** Restore this trigger after iOS dismissal. Android uses native window focus restoration. */
  returnFocusRef?: RefObject<ComponentRef<typeof View> | null>;
};

/** How far a drag on the handle must travel before letting go closes the sheet. */
const DISMISS_DISTANCE = 96;

/**
 * A bottom sheet for picking options, over a scrim. Closes with Done, a tap on
 * the scrim, a drag down on its handle, or Back on Android.
 *
 * The same panel on both platforms, floating over the screen so the screen
 * underneath stays put. Dismiss the keyboard before opening it and pass the
 * trigger ref for explicit iOS screen-reader focus restoration.
 */
export function Sheet({ visible, title, onClose, children, doneLabel, returnFocusRef }: SheetProps) {
  const { direction, t } = useTranslation();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const headingRef = useRef<ComponentRef<typeof View>>(null);
  const { height } = useWindowDimensions();
  const drag = useSharedValue(0);

  const handle = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => drag.set(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > DISMISS_DISTANCE || g.vy > 1.2) onClose();
          drag.set(reduceMotion ? 0 : withSpring(0, motion.spring.settle));
        },
        onPanResponderTerminate: () => drag.set(reduceMotion ? 0 : withSpring(0, motion.spring.settle)),
      }),
    [drag, onClose, reduceMotion],
  );
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: reduceMotion ? 0 : drag.get() }] }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onShow={() => {
        drag.set(0);
        if (headingRef.current) AccessibilityInfo.sendAccessibilityEvent(headingRef.current, 'focus');
      }}
      onDismiss={() => {
        if (returnFocusRef?.current) AccessibilityInfo.sendAccessibilityEvent(returnFocusRef.current, 'focus');
      }}
    >
      <View className="flex-1 justify-end" style={{ direction }}>
        <Pressable
          accessible={false}
          focusable={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          className="absolute inset-0 bg-overlay/40"
        />
        <AnimatedView
          entering={reduceMotion ? undefined : SlideInDown.duration(motion.duration.slow)}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          className="shrink rounded-t-3xl border-x-hairline border-t-hairline border-border bg-bg"
          style={{ maxHeight: height - insets.top - 24, borderCurve: 'continuous' }}
          animatedStyle={dragStyle}
        >
          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled"
          >
            <View {...handle.panHandlers}>
              <View className="items-center pt-2" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View className="h-1 w-9 rounded-full bg-border-strong" />
              </View>
              <View className="min-h-14 flex-row items-center gap-3 px-5 pb-1 pt-2">
                <View ref={headingRef} accessible accessibilityRole="header" accessibilityLabel={title} className="flex-1">
                  <Text variant="headline" accessible={false}>{title}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  style={{ minHeight: layout.minTouch, minWidth: layout.minTouch, maxWidth: '50%', justifyContent: 'center' }}
                  onPress={onClose}
                  className="active:opacity-60"
                >
                  <Text variant="body" weight="semibold" tone="accent">
                    {doneLabel ?? t('common.done')}
                  </Text>
                </Pressable>
              </View>
            </View>
            <View className="gap-6 px-4 pt-2">
              {children}
            </View>
          </ScrollView>
        </AnimatedView>
      </View>
    </Modal>
  );
}

export type Option<T extends string> = { value: T; label: string; subtitle?: string; leading?: ReactNode };

type OptionGroupProps<T extends string> = {
  options: Option<T>[];
  /** One value for single choice, a set for multiple choice. */
  selected: T | ReadonlySet<T> | null;
  onSelect: (value: T) => void;
  header?: string;
  footer?: string;
};

/** A list of choices with checkmarks. Single choice reads as radio buttons; multiple as checkboxes. */
export function OptionGroup<T extends string>({
  options,
  selected,
  onSelect,
  header,
  footer,
}: OptionGroupProps<T>) {
  const multiple = selected !== null && typeof selected !== 'string';
  return (
    <ListGroup header={header} footer={footer}>
      {options.map((option) => {
        const checked = multiple ? (selected as ReadonlySet<T>).has(option.value) : selected === option.value;
        return (
          <ListItem
            key={option.value}
            title={option.label}
            subtitle={option.subtitle}
            leading={option.leading}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={{ checked }}
            trailing={
              <View className="w-6 items-end">
                {checked ? <Icon icon={Check} tone="accent" strokeWidth={2.25} /> : null}
              </View>
            }
            chevron={false}
            onPress={() => {
              haptics.selection();
              onSelect(option.value);
            }}
          />
        );
      })}
    </ListGroup>
  );
}
