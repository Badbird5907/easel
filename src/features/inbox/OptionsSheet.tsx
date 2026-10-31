import { Check, ChevronDown, type LucideIcon } from 'lucide-react-native';
import { type ComponentRef, type Ref, type RefObject, useRef } from 'react';
import { AccessibilityInfo, Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AccentScope,
  Button,
  deriveAccent,
  haptics,
  Icon,
  PressableScale,
  Text,
  useReduceMotion,
  useTheme,
  withAlpha,
} from '@/design';
import { AnimatedView } from '@/design/interop';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

export type SheetOption = {
  key: string;
  label: string;
  subtitle?: string;
  icon?: LucideIcon;
  /** A course color, shown as a dot. */
  color?: string;
  selected?: boolean;
  destructive?: boolean;
  onPress: () => void;
};

type OptionsSheetProps = {
  visible: boolean;
  /** A selected action may run after iOS dismissal; plain closes have no argument. */
  onClose: (selected?: boolean) => void;
  title?: string;
  options: SheetOption[];
  /** Only plain iOS dismissal restores focus; chosen actions manage their next destination. */
  returnFocusRef?: RefObject<ComponentRef<typeof View> | null>;
};

/**
 * A short list of choices that slides up from the bottom: course pickers and
 * per-item actions. Tapping outside, Back, or picking an option closes it.
 */
export function OptionsSheet({ visible, onClose, title: suppliedTitle, options, returnFocusRef }: OptionsSheetProps) {
  const { t } = useTranslation();
  const title = suppliedTitle === undefined ? t('attachment.options') : suppliedTitle;
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const headingRef = useRef<ComponentRef<typeof View>>(null);
  // iOS can't present an alert or a screen while the sheet is still leaving, so the
  // chosen action waits for the dismissal there.
  const pending = useRef<(() => void) | null>(null);

  const choose = (option: SheetOption) => {
    haptics.selection();
    if (Platform.OS === 'ios') pending.current = option.onPress;
    onClose(true);
    if (Platform.OS !== 'ios') option.onPress();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => onClose()}
      onShow={() => {
        if (headingRef.current) AccessibilityInfo.sendAccessibilityEvent(headingRef.current, 'focus');
      }}
      onDismiss={() => {
        const action = pending.current;
        pending.current = null;
        if (action) action();
        else if (returnFocusRef?.current) AccessibilityInfo.sendAccessibilityEvent(returnFocusRef.current, 'focus');
      }}
    >
      <View className="flex-1 justify-end">
        <Pressable
          accessible={false}
          focusable={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={() => onClose()}
          className="absolute inset-0"
          style={{ backgroundColor: withAlpha(colors.overlay, 0.4) }}
        />
        <AnimatedView
          entering={reduceMotion ? undefined : SlideInDown.duration(220)}
          accessibilityViewIsModal
          onAccessibilityEscape={() => onClose()}
          className="shrink rounded-t-3xl bg-surface-raised"
          style={{ maxHeight: height * 0.75, borderCurve: 'continuous' }}
        >
          <ScrollView bounces={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}>
            <View className="items-center pb-1 pt-2.5" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View className="h-1 w-9 rounded-full bg-border-strong" />
            </View>
            <View className="flex-row items-center gap-3 px-5 pb-2 pt-2">
              <View ref={headingRef} accessible accessibilityRole="header" accessibilityLabel={title} className="flex-1">
                <Text variant="headline" accessible={false}>{title}</Text>
              </View>
              <Button variant="ghost" size="sm" onPress={() => onClose()} className="max-w-[50%]">{t('attachment.done')}</Button>
            </View>
            {options.map((option) => (
              <Pressable
                key={option.key}
                accessibilityRole={option.selected !== undefined ? 'radio' : 'button'}
                accessibilityState={option.selected !== undefined ? { checked: option.selected } : undefined}
                accessibilityLabel={option.subtitle ? t('attachment.optionSubtitle', { label: option.label, subtitle: option.subtitle }) : option.label}
                android_ripple={{ color: withAlpha(colors.fg, 0.08) }}
                onPress={() => choose(option)}
                className={cn(
                  'min-h-[52px] flex-row items-center gap-3 px-5 py-2.5',
                  Platform.OS === 'ios' && 'active:bg-surface-sunken',
                )}
              >
                {option.color ? (
                  <View
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: deriveAccent(option.color, scheme).accent }}
                  />
                ) : option.icon ? (
                  <Icon icon={option.icon} size={20} tone={option.destructive ? 'danger' : 'muted'} />
                ) : null}
                <View className="flex-1">
                  <Text variant="body" weight="medium" tone={option.destructive ? 'danger' : 'default'}>
                    {option.label}
                  </Text>
                  {option.subtitle ? (
                    <Text variant="footnote" tone="muted" numberOfLines={fontScale > 1.3 ? undefined : 1}>
                      {option.subtitle}
                    </Text>
                  ) : null}
                </View>
                {option.selected ? <Icon icon={Check} size={20} tone="accent" strokeWidth={2.25} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </AnimatedView>
      </View>
    </Modal>
  );
}

type MenuChipProps = {
  ref?: Ref<ComponentRef<typeof View>>;
  label: string;
  /** Spoken as "Course filter: BIO 201". */
  accessibilityLabel: string;
  onPress: () => void;
  /** Tints the chip when a filter is active. */
  active?: boolean;
  color?: string | null;
  className?: string;
};

/** A chip that opens a menu: filters whose options don't fit in a row. */
export function MenuChip({ ref, label, accessibilityLabel, onPress, active, color, className }: MenuChipProps) {
  const { t } = useTranslation();
  return (
    <AccentScope color={active ? color : null} className={cn('self-start', className)}>
      <PressableScale
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={t('attachment.menuLabel', { label: accessibilityLabel, value: label })}
        accessibilityHint={t('attachment.menuHint')}
        haptic="selection"
        onPress={onPress}
        className={cn(
          'min-h-9 flex-row items-center gap-1 rounded-full border py-1.5 pe-2.5 ps-3.5',
          active ? 'border-transparent bg-accent' : 'border-border bg-surface',
        )}
      >
        <Text
          variant="subhead"
          weight={active ? 'semibold' : 'medium'}
          tone={active ? 'onAccent' : 'default'}
        >
          {label}
        </Text>
        <Icon icon={ChevronDown} size={16} tone={active ? 'onAccent' : 'muted'} strokeWidth={2} />
      </PressableScale>
    </AccentScope>
  );
}
