import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type BridgeStatus = { installed: boolean; granted: boolean; connected: boolean; canPost: boolean };
export type BridgeChange = { accountId: string; category: string; courseId?: string };
export const canvasBridge = Platform.OS === 'android' ? requireOptionalNativeModule<{
  sync(json: string): void;
  status(): BridgeStatus;
  drainChanges(): string;
  openSettings(): void;
}>('CanvasNotificationBridge') : null;

export function bridgeLive(): boolean {
  const status = canvasBridge?.status();
  return !!status?.installed && status.granted && status.connected && status.canPost;
}
