import type { ComponentRef, ReactNode, Ref } from 'react';
import { Pressable, ScrollView, type ScrollViewProps, View } from 'react-native';

import { cn } from '@/lib/cn';

import { layout } from '../tokens/layout';
import { Text } from './Text';

export type ScreenProps = Omit<ScrollViewProps, 'contentContainerStyle'> & {
  children: ReactNode;
  /** Classes for the content container. Defaults give gutters and section spacing. */
  contentClassName?: string;
  ref?: Ref<ComponentRef<typeof ScrollView>>;
};

/**
 * Scrollable screen body. Render it as the screen's root element: native large
 * titles collapse and tab bars minimize by tracking the first scroll view.
 */
export function Screen({ children, className, contentClassName, ...props }: ScreenProps) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      className={cn('flex-1 bg-bg', className)}
      contentContainerClassName={cn('gap-8 px-4 pb-16 pt-2', contentClassName)}
      contentContainerStyle={{ width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' }}
      {...props}
    >
      {children}
    </ScrollView>
  );
}

export type SectionHeaderProps = {
  title: string;
  /** Trailing text action, e.g. "See all". */
  action?: { label: string; onPress: () => void };
  className?: string;
};

export function SectionHeader({ title, action, className }: SectionHeaderProps) {
  return (
    <View className={cn('flex-row items-baseline justify-between px-1', className)}>
      <Text variant="title3" accessibilityRole="header">
        {title}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={12}
          onPress={action.onPress}
          className="active:opacity-60"
        >
          <Text variant="subhead" weight="semibold" tone="accent">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export type SectionProps = SectionHeaderProps & {
  children: ReactNode;
};

/** A titled block of a screen. Stack these inside <Screen />. */
export function Section({ children, className, ...header }: SectionProps) {
  return (
    <View className={cn('gap-3', className)}>
      <SectionHeader {...header} />
      {children}
    </View>
  );
}
