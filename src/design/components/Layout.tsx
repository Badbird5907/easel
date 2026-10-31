import { BlurView } from 'expo-blur';
import {
  Children,
  cloneElement,
  type ComponentRef,
  isValidElement,
  type ReactNode,
  type Ref,
  useState,
} from 'react';
import {
  FlatList,
  type LayoutRectangle,
  Platform,
  Pressable,
  type RefreshControlProps,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

import { useReduceMotion } from '../accessibility/useReduceMotion';
import { useScreenReader } from '../accessibility/useScreenReader';
import { AnimatedView } from '../interop';
import { useTheme } from '../theme/ThemeProvider';
import { layout } from '../tokens/layout';
import { typeScale } from '../tokens/typography';
import { Text } from './Text';

export type ScreenProps = Omit<ScrollViewProps, 'contentContainerStyle'> & {
  children: ReactNode;
  /** Classes for the content stack. Defaults give section spacing. */
  contentClassName?: string;
  /** Mount long groups as they approach the viewport, without delaying the push. */
  virtualized?: boolean;
  /**
   * Large title drawn as the first row of the content. Use on tab roots, whose
   * stack header is hidden, so the title and its control share one row.
   */
  title?: string;
  /** Control at the end of the title row, such as a settings button. */
  titleAccessory?: ReactNode;
  /** The scroll view, for scrolling to a field. Untitled screens only. */
  ref?: Ref<ComponentRef<typeof ScrollView>>;
};

/**
 * Scrollable screen body. Render it as the screen's root element: the iOS tab
 * bar minimizes and scrolls to top by tracking the first scroll view.
 */
export function Screen({ title, titleAccessory, ...props }: ScreenProps) {
  const { direction } = useTranslation();
  if (title) {
    // The titled screen drives its own scroll view for the title morph.
    const { ref: _ref, ...titled } = props;
    return <TitledScreen title={title} titleAccessory={titleAccessory} {...titled} />;
  }

  const { children, className, contentClassName, virtualized, ref, ...rest } = props;
  if (virtualized) return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      className={cn('flex-1 bg-bg', className)}
      contentContainerStyle={[styles.content, styles.untitledTop, { direction }]}
      data={Children.toArray(children)}
      renderItem={({ item }) => <View className={cn('pb-8', contentClassName)}>{item}</View>}
      initialNumToRender={5}
      maxToRenderPerBatch={2}
      windowSize={3}
      {...rest}
    />
  );
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      className={cn('flex-1 bg-bg', className)}
      contentContainerStyle={[styles.content, styles.untitledTop, { direction }]}
      ref={ref}
      {...rest}
    >
      <View className={cn('gap-8', contentClassName)}>{children}</View>
    </ScrollView>
  );
}

/** Height of the compact bar the title settles into. */
const BAR_HEIGHT = 44;
/** The large-title row's minimum height (`min-h-14`), before it's measured. */
const TITLE_ROW_HEIGHT = 56;
/** Space for iOS's floating tab bar, which can't be measured (expo-router NativeTabs). */
const TAB_BAR_CLEARANCE = 96;
/** The title lands at headline size: 17/34. */
const COMPACT_SCALE = typeScale.headline.size / typeScale.display.size;
/** How far the title grows when the list is pulled past its top. */
const PULL_SCALE = 1.08;

function TitledScreen({
  title,
  titleAccessory,
  children,
  className,
  contentClassName,
  refreshControl,
  ...props
}: ScreenProps & { title: string }) {
  const { colors } = useTheme();
  const { direction } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const screenReader = useScreenReader();
  const staticTitle = reduceMotion || screenReader || fontScale > 1;
  const scrolled = useSharedValue(0);

  // Where the title sits at rest, measured from the invisible placeholder in the content.
  const [row, setRow] = useState<LayoutRectangle | null>(null);
  const [slot, setSlot] = useState<LayoutRectangle | null>(null);
  const [titleWidth, setTitleWidth] = useState(0);

  // Insets are padded explicitly rather than left to iOS's automatic adjustment,
  // which isn't always applied (or reported) on the first frame after a deep link
  // or remount. So the scroll view always rests at offset 0 and the title's
  // measured position already includes the status bar.
  const restingOffset = 0;
  const contentTop = 0;
  const contentLeft = Math.max(0, (windowWidth - layout.maxContentWidth) / 2);
  const rtl = direction === 'rtl';

  // Android draws the pull-to-refresh spinner at the top of the scroll view, which
  // runs under the status bar here. Start it below the title row, where content begins.
  const titleBottom = row ? row.y + row.height : insets.top + TITLE_ROW_HEIGHT;
  const refresh =
    Platform.OS === 'android' && isValidElement<RefreshControlProps>(refreshControl)
      ? cloneElement(refreshControl, {
          progressViewOffset: refreshControl.props.progressViewOffset ?? titleBottom,
        })
      : refreshControl;

  const measured = row !== null && slot !== null && titleWidth > 0;
  const morphDistance = row?.height ?? 56;
  const slotX = contentLeft + (row?.x ?? 0) + (slot?.x ?? 0);
  const glyphX = rtl ? slotX + (slot?.width ?? 0) - titleWidth : slotX;
  const startY = contentTop + (row?.y ?? 0) + (slot?.y ?? 0);
  const startCenterY = startY + (slot?.height ?? 0) / 2;
  const endCenterY = insets.top + BAR_HEIGHT / 2;
  // Scaling pivots on the title's leading edge, so track that edge from start to end.
  const anchorStart = rtl ? glyphX + titleWidth : glyphX;
  const anchorEnd = windowWidth / 2 + ((rtl ? 1 : -1) * titleWidth * COMPACT_SCALE) / 2;

  const scrollRef = useAnimatedRef<Animated.ScrollView>();

  // Like UIKit's large titles, never rest halfway through the morph: when a
  // gesture ends inside it, glide to fully expanded or fully collapsed.
  const settle = (y: number) => {
    'worklet';
    if (staticTitle || y <= 0 || y >= morphDistance) return;
    scrollTo(scrollRef, 0, (y < morphDistance / 2 ? 0 : morphDistance) + restingOffset, true);
  };

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrolled.set(event.contentOffset.y - restingOffset);
    },
    onEndDrag: (event) => {
      // A fling hands off to momentum, which settles on its own end.
      if (Math.abs(event.velocity?.y ?? 0) < 0.05) settle(event.contentOffset.y - restingOffset);
    },
    onMomentumEnd: (event) => {
      settle(event.contentOffset.y - restingOffset);
    },
  });

  // One title, carried by the scroll: it shrinks and glides from the leading edge
  // into the center of the bar, and grows a little when pulled down.
  const titleStyle = useAnimatedStyle(() => {
    const y = scrolled.get();
    const progress = interpolate(y, [0, morphDistance], [0, 1], Extrapolation.CLAMP);
    const scale =
      y < 0
        ? interpolate(y, [-160, 0], [PULL_SCALE, 1], Extrapolation.CLAMP)
        : interpolate(progress, [0, 1], [1, COMPACT_SCALE]);
    return {
      opacity: measured ? 1 : 0,
      transform: [
        { translateX: glyphX + (anchorEnd - anchorStart) * progress },
        { translateY: startY + (y < 0 ? -y : (endCenterY - startCenterY) * progress) },
        { scale },
      ],
    };
  });

  // Content slides under the status bar first: give it a backdrop right away.
  const statusBackdrop = useAnimatedStyle(() => ({
    opacity: interpolate(scrolled.get(), [0, 8], [0, 1], Extrapolation.CLAMP),
  }));
  // The bar fills in behind the title as it arrives.
  const compactBar = useAnimatedStyle(() => ({
    opacity: interpolate(scrolled.get(), [morphDistance * 0.5, morphDistance], [0, 1], Extrapolation.CLAMP),
  }));

  const backdrop =
    Platform.OS === 'ios' ? (
      <BlurView tint="systemChromeMaterial" intensity={100} style={StyleSheet.absoluteFill} />
    ) : (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} />
    );

  return (
    <View collapsable={false} className={cn('flex-1 bg-bg', className)} style={{ direction }}>
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustsScrollIndicatorInsets={false}
        scrollIndicatorInsets={{ top: insets.top + (staticTitle ? 0 : BAR_HEIGHT), bottom: insets.bottom }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={styles.fill}
        refreshControl={refresh}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top,
            // iOS's tab bar floats over content; leave room to scroll past it.
            paddingBottom: Platform.OS === 'ios' ? insets.bottom + TAB_BAR_CLEARANCE : styles.content.paddingBottom,
          },
        ]}
        {...props}
      >
        <View
          onLayout={(e) => setRow(e.nativeEvent.layout)}
          className="min-h-14 flex-row items-center gap-3 pb-3 pt-2"
        >
          {/* Keep the heading in reading order; large text and assistive technology use it in place. */}
          <Text
            variant="display"
            accessibilityRole="header"
            numberOfLines={1}
            onLayout={(e) => setSlot(e.nativeEvent.layout)}
            className={cn('flex-1', !staticTitle && 'opacity-0')}
          >
            {title}
          </Text>
          {titleAccessory}
        </View>
        <View className={cn('gap-8', contentClassName)}>{children}</View>
      </Animated.ScrollView>

      {!staticTitle ? (
        <>
          <AnimatedView
            pointerEvents="none"
            style={[styles.overlay, { height: insets.top }]}
            animatedStyle={statusBackdrop}
          >
            {backdrop}
          </AnimatedView>
          <AnimatedView
            pointerEvents="none"
            style={[styles.overlay, { height: insets.top + BAR_HEIGHT }]}
            animatedStyle={compactBar}
          >
            {backdrop}
            <View className="absolute inset-x-0 bottom-0 h-hairline bg-border" />
          </AnimatedView>
          <AnimatedView
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.floatingTitle,
              { maxWidth: slot?.width, transformOrigin: rtl ? 'right center' : 'left center' },
            ]}
            animatedStyle={titleStyle}
          >
            <Text variant="display" numberOfLines={1} onLayout={(e) => setTitleWidth(e.nativeEvent.layout.width)}>
              {title}
            </Text>
          </AnimatedView>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.gutter,
    paddingBottom: 64,
  },
  untitledTop: { paddingTop: 8 },
  overlay: { position: 'absolute', top: 0, start: 0, end: 0, overflow: 'hidden' },
  // Positioned by transform from the physical top-left, so it is placed with left, not start.
  floatingTitle: { position: 'absolute', top: 0, left: 0 },
});

export type SectionHeaderProps = {
  title: string;
  /** Trailing text action, e.g. "See all". */
  action?: { label: string; onPress: () => void };
  className?: string;
};

export function SectionHeader({ title, action, className }: SectionHeaderProps) {
  return (
    <View className={cn('flex-row flex-wrap items-center justify-between gap-x-3 px-1', className)}>
      <Text variant="title3" accessibilityRole="header" className="shrink">
        {title}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          style={{ minHeight: layout.minTouch, minWidth: layout.minTouch, justifyContent: 'center' }}
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
