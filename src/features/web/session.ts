import type { CanvasClient } from '@/canvas/client';
import { sessionUrl } from '@/features/content/browser';

/**
 * The Canvas web session behind web views (HTML-6). Web views share one cookie
 * store, so a session started in any of them signs in authenticated iframes,
 * media, and pages in all of them. Canvas's session cookie can lapse while a
 * student reads, so content with embeds starts a fresh one through a
 * `session_token` URL when the last is older than `MAX_AGE`, and keeps it
 * alive every `MAX_AGE` while it stays on screen.
 *
 * Starting a session for the active account also replaces any session another
 * account on the same school left in the cookie store.
 */
export const SESSION_MAX_AGE = 10 * 60_000;

const startedAt = new Map<string, number>();

export function sessionIsFresh(accountId: string, now = Date.now()) {
  const at = startedAt.get(accountId);
  return at !== undefined && now - at < SESSION_MAX_AGE;
}

export function markSessionStarted(accountId: string) {
  startedAt.set(accountId, Date.now());
  // Another account's session in the shared store is now gone.
  for (const id of startedAt.keys()) if (id !== accountId) startedAt.delete(id);
}

/**
 * A one-time URL that starts a web session and lands on a tiny page. Null when
 * the school blocks session tokens; embeds then load as they are.
 */
export async function sessionStartUrl(client: CanvasClient): Promise<string | null> {
  const target = `${client.baseUrl}/favicon.ico`;
  const url = await sessionUrl(client, target);
  return url === target ? null : url;
}
