import * as WebBrowser from 'expo-web-browser';

import type { CanvasClient } from '@/canvas/client';
import { sessionUrl } from '@/features/content/browser';

/** Preserve the shared signed-in URL contract, guarding the pre-open await. */
export async function openProfileWebsite(client: CanvasClient, isCurrent: () => boolean) {
  if (!isCurrent()) return;
  const url = await sessionUrl(client, '/profile');
  if (isCurrent()) await WebBrowser.openBrowserAsync(url);
}
