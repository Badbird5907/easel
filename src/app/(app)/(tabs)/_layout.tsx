import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import type { SFSymbol } from 'expo-symbols';
import { CalendarDays, House, Inbox, ListChecks, type LucideIcon } from 'lucide-react-native';
import { Platform } from 'react-native';

import { fontFamilies, TabBar, useTheme } from '@/design';
import { useTodoBadgeCount } from '@/features/planner/badge';
import { useLaunchLandingTab } from '@/features/settings/landingTab';
import { formatNumber, type Translate, useTranslation } from '@/i18n';

type SFIcon = SFSymbol | { default: SFSymbol; selected: SFSymbol };
type TabTitleKey = 'nav.home' | 'nav.calendar' | 'nav.todo' | 'nav.inbox';

/** One list drives both platforms: SF Symbols for the iOS system bar, Lucide for Easel's Android bar. */
const tabs: { name: string; titleKey: TabTitleKey; sf: SFIcon; icon: LucideIcon }[] = [
  { name: '(home)', titleKey: 'nav.home', sf: { default: 'house', selected: 'house.fill' }, icon: House },
  { name: 'calendar', titleKey: 'nav.calendar', sf: 'calendar', icon: CalendarDays },
  {
    name: 'todo',
    titleKey: 'nav.todo',
    sf: { default: 'checklist', selected: 'checklist.checked' },
    icon: ListChecks,
  },
  { name: 'inbox', titleKey: 'nav.inbox', sf: { default: 'tray', selected: 'tray.fill' }, icon: Inbox },
];

const icons = Object.fromEntries(tabs.map((t) => [t.name, t.icon]));

export default function TabsLayout() {
  // SET-3: the tab the student chose in Settings opens at launch.
  useLaunchLandingTab();
  return Platform.OS === 'ios' ? <SystemTabs /> : <EaselTabs />;
}

/** The To Do tab's count of overdue and due-today work (TODO-6), when the student turned it on. */
function badgeText(count: number | null, t: Translate, locale: string): string | undefined {
  if (!count) return undefined;
  return count > 99 ? t('nav.badgeOverflow', { count: 99 }) : formatNumber(count, undefined, locale);
}

function SystemTabs() {
  const { colors } = useTheme();
  const { t, locale } = useTranslation();
  const todoCount = useTodoBadgeCount();
  const todoBadge = badgeText(todoCount, t, locale);
  return (
    <NativeTabs
      tintColor={colors.accentFg}
      iconColor={{ default: colors.fgMuted, selected: colors.accentFg }}
      labelStyle={{
        default: { fontFamily: fontFamilies.medium, color: colors.fgMuted },
        selected: { fontFamily: fontFamilies.semibold, color: colors.accentFg },
      }}
      minimizeBehavior="onScrollDown"
    >
      {tabs.map((tab) => (
        // Screen sets its own insets so the large title can morph into the bar.
        <NativeTabs.Trigger
          key={tab.name}
          name={tab.name}
          disableAutomaticContentInsets
          accessibilityLabel={
            tab.name === 'todo' && todoCount
              ? t('nav.todoBadgeCount', { count: todoCount })
              : t(tab.titleKey)
          }
        >
          <NativeTabs.Trigger.Label>{t(tab.titleKey)}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={tab.sf} />
          {tab.name === 'todo' && todoBadge ? (
            <NativeTabs.Trigger.Badge>{todoBadge}</NativeTabs.Trigger.Badge>
          ) : null}
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

function EaselTabs() {
  const { t, locale } = useTranslation();
  const todoCount = useTodoBadgeCount();
  const todoBadge = badgeText(todoCount, t, locale);
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} icons={icons} />}>
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.titleKey),
            tabBarAccessibilityLabel:
              tab.name === 'todo' && todoCount
                ? t('nav.todoBadgeCount', { count: todoCount })
                : t(tab.titleKey),
            ...(tab.name === 'todo' && todoBadge
              ? {
                  tabBarBadge: todoBadge,
                }
              : {}),
          }}
        />
      ))}
    </Tabs>
  );
}
