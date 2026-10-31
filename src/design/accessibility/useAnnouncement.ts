import { useEffect } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/** Pair with an Android live region; never announce through both channels on one platform. */
export function useAnnouncement(message: string | null | undefined) {
  useEffect(() => {
    if (message && Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
    }
  }, [message]);
}
