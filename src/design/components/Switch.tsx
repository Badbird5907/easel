import { Platform, Switch as RNSwitch, type SwitchProps as RNSwitchProps } from 'react-native';

import { haptics } from '../haptics';
import { useTheme } from '../theme/ThemeProvider';

export type SwitchProps = Omit<RNSwitchProps, 'trackColor' | 'thumbColor' | 'ios_backgroundColor'>;

/** Platform switch, tinted with the current accent. */
export function Switch({ onValueChange, ...props }: SwitchProps) {
  const { colors } = useTheme();
  return (
    <RNSwitch
      trackColor={{ false: colors.borderStrong, true: colors.accent }}
      ios_backgroundColor={colors.borderStrong}
      thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
      onValueChange={(next) => {
        haptics.selection();
        onValueChange?.(next);
      }}
      {...props}
    />
  );
}
