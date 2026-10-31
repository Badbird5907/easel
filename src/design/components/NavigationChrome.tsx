import type { BottomTabBarProps } from 'expo-router/js-tabs';
import type { NativeStackHeaderProps } from 'expo-router';
import { ArrowLeft, type LucideIcon } from 'lucide-react-native';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptics } from '../haptics';
import { withAlpha } from '../theme/color';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Text } from './Text';

/*
 * Easel's own navigation chrome for Android. iOS uses the system tab bar and
 * headers; Android gets these instead of Material components, so both
 * platforms share one look while Android keeps its own Back behavior.
 */

export type TabBarProps = BottomTabBarProps & {
  /** Icon per route name. */
  icons: Record<string, LucideIcon>;
};

export function TabBar({ state, descriptors, emitter, navigateToTab, insets, icons }: TabBarProps) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();

  return (
    <View
      accessibilityRole="tablist"
      className="flex-row border-t-hairline border-border bg-surface"
      style={{ paddingBottom: insets.bottom }}
    >
      {state.routes.map((route, index) => {
        const focused = index === state.index;
        const { options } = descriptors[route.key];
        const label = options.title ?? route.name;
        const color = focused ? colors.accentFg : colors.fgMuted;
        const icon = icons[route.name];
        const badge =
          options.tabBarBadge !== undefined && options.tabBarBadge !== ''
            ? String(options.tabBarBadge)
            : null;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? (badge ? `${label}, ${badge}` : label)}
            android_ripple={{ color: withAlpha(colors.fg, 0.06), borderless: true, radius: 40 }}
            onPress={() => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                haptics.selection();
                navigateToTab(route.key);
              }
            }}
            onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
            className="min-h-14 flex-1 items-center justify-center gap-1 pb-1.5 pt-2.5"
          >
            <View>
              {icon ? <Icon icon={icon} size={24} color={color} strokeWidth={focused ? 2.25 : 1.75} /> : null}
              {badge ? (
                <View
                  className={`min-h-5 min-w-[18px] items-center justify-center rounded-full border-2 border-surface bg-danger px-1 ${fontScale > 1.3 ? '' : 'absolute -top-1.5'}`}
                  style={fontScale > 1.3 ? undefined : { start: 14 }}
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                >
                  <Text
                    variant="caption"
                    weight="semibold"
                    tone="inherit"
                    tabular
                    numberOfLines={1}
                    className="text-[11px] leading-[14px] text-danger-contrast"
                  >
                    {badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              variant="caption"
              weight={focused ? 'semibold' : 'medium'}
              tone="inherit"
              align="center"
              style={{ color, alignSelf: 'stretch' }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Stack header for pushed screens: back button, title, optional actions. Tab
 * roots hide it and draw a large title row with <Screen title> instead.
 */
export function Header({ back, options, route, navigation }: NativeStackHeaderProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const title = typeof options.title === 'string' ? options.title : route.name;
  const tint = typeof options.headerTintColor === 'string' ? options.headerTintColor : colors.accentFg;
  const actions = options.headerRight?.({ tintColor: tint, canGoBack: !!back });

  return (
    <View className="bg-bg" style={{ paddingTop: insets.top }}>
      <View className="min-h-14 flex-row items-center gap-1 px-2">
        {back ? (
          <IconButton
            icon={ArrowLeft}
            size="lg"
            accessibilityLabel="Back"
            onPress={navigation.goBack}
            iconColor={tint}
            flipInRTL
          />
        ) : null}
        <Text variant="headline" accessibilityRole="header" accessibilityLabel={title} numberOfLines={1} ellipsizeMode="tail" className="min-w-0 flex-1 px-2">
          {title}
        </Text>
        {actions}
      </View>
    </View>
  );
}
