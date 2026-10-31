import * as WebBrowser from 'expo-web-browser';

import type { CanvasClient } from '@/canvas/client';
import { sessionUrl } from '@/features/content/browser';

export type MediaMessageBrowserState = 'idle' | 'opening' | 'failed';

/** One pending launch per committed source. Entered native effects cannot be undone. */
export function createMediaMessageBrowser(
  client: CanvasClient,
  url: string,
  owner: () => object | null,
  publish: (state: MediaMessageBrowserState) => void,
) {
  let pending: object | null = null;
  return async () => {
    const token = owner();
    if (!token || pending === token) return;
    pending = token;
    const current = () => owner() === token;
    publish('opening');
    try {
      const target = await sessionUrl(client, url);
      if (!current()) return;
      await WebBrowser.openBrowserAsync(target);
      if (current()) publish('idle');
    } catch {
      if (current()) publish('failed');
    } finally {
      if (pending === token) pending = null;
    }
  };
}
