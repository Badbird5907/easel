import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

function run(fn: () => Promise<void>) {
  if (enabled) fn().catch(() => {});
}

/**
 * Haptic vocabulary. Keep it sparse: haptics on every tap become noise.
 *   selection  value changed (segmented control, chip, switch)
 *   light      primary action pressed
 *   success / warning / error  outcome of an action (submitted, failed)
 */
export const haptics = {
  selection: () => run(() => Haptics.selectionAsync()),
  light: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

export type HapticKind = keyof typeof haptics;
