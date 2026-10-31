import { Platform, Switch as RNSwitch, type SwitchProps as RNSwitchProps, View } from 'react-native';

import { layout } from '../tokens/layout';
import { haptics } from '../haptics';
import { useTheme } from '../theme/ThemeProvider';

export type SwitchProps = Omit<RNSwitchProps, 'trackColor' | 'thumbColor' | 'ios_backgroundColor'>;

/** Platform switch, tinted with the current accent. */
export function Switch({ onValueChange, style, ...props }: SwitchProps) {
  const { colors } = useTheme();
  return (
    <View style={{ minHeight: layout.minTouch, minWidth: layout.minTouch, justifyContent: 'center' }}>
      <RNSwitch
        hitSlop={9}
        trackColor={{ false: colors.borderStrong, true: colors.accent }}
        ios_backgroundColor={colors.borderStrong}
        thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
        onValueChange={(next) => {
          haptics.selection();
          onValueChange?.(next);
        }}
        // React Native's iOS switch defaults to alignSelf: 'flex-start', which pins it
        // to the top of a row instead of following the row's own alignment.
        style={[{ alignSelf: 'auto' }, style]}
        {...props}
      />
    </View>
  );
}
