import { NativeTabs } from 'expo-router/native-tabs';

import { fontFamilies, useTheme } from '@/design';
import { actionableCount } from '@/mocks/canvas';

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <NativeTabs
      tintColor={colors.accentFg}
      iconColor={{ default: colors.fgMuted, selected: colors.accentFg }}
      backgroundColor={colors.surface}
      indicatorColor={colors.accentSoft}
      rippleColor={colors.accentSoft}
      badgeBackgroundColor={colors.danger}
      labelStyle={{
        default: { fontFamily: fontFamilies.medium, color: colors.fgMuted },
        selected: { fontFamily: fontFamilies.semibold, color: colors.accentFg },
      }}
      minimizeBehavior="onScrollDown"
      labelVisibilityMode="labeled"
    >
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="calendar">
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="todo">
        <NativeTabs.Trigger.Label>To Do</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'checklist', selected: 'checklist.checked' }}
          md="checklist"
        />
        <NativeTabs.Trigger.Badge>{String(actionableCount)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'tray', selected: 'tray.fill' }} md="inbox" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
