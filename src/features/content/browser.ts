import * as WebBrowser from 'expo-web-browser';

import type { CanvasClient } from '@/canvas/client';
import { useCanvas } from '@/canvas/session';

/**
 * A one-time URL that signs the browser in to Canvas, then lands on `url`.
 * Canvas expires it after about 30 seconds, so open it right away.
 */
export async function sessionUrl(client: CanvasClient, url: string): Promise<string> {
  const absolute = new URL(url, client.baseUrl).toString();
  try {
    const { session_url } = await client.get<{ session_url: string }>('/api/v1/login/session_token', {
      return_to: absolute,
    });
    return session_url;
  } catch {
    // Some schools block session tokens; the page will ask the student to sign in.
    return absolute;
  }
}

/** "Open in browser" that arrives signed in (PRD LTI-3).
 * An optional caller guard retires launch entry, not a browser already opened. */
export async function openSignedIn(client: CanvasClient, url: string, mayOpen?: () => boolean) {
  if (mayOpen && !mayOpen()) return;
  const target = await sessionUrl(client, url);
  if (mayOpen && !mayOpen()) return;
  await WebBrowser.openBrowserAsync(target);
}

export function useOpenSignedIn() {
  const { client } = useCanvas();
  return (url: string, mayOpen?: () => boolean) => openSignedIn(client, url, mayOpen);
}
