import type { DiscussionEntry } from '@/canvas/api/discussions';
import { CanvasError } from '@/canvas/client';
import type { Translate } from '@/i18n';

/** Translate only explicit generated origins, never English-looking supplied names. */
export function entryAuthorName(
  entry: Pick<DiscussionEntry, 'authorNameOrigin'> & { author: { name: string } | null },
  t: Translate,
): string {
  const origin = entry.authorNameOrigin;
  if (origin?.kind === 'unknown') return t('discussionThread.unknown');
  if (origin?.kind === 'anonymous' && typeof origin.token === 'string') {
    return origin.token === 'current_user'
      ? t('discussionThread.anonymousYou')
      : t('discussionThread.anonymousToken', { token: origin.token });
  }
  return entry.author?.name ?? t('discussionThread.unknown');
}

/** Local missing responses only; server/legacy errors retain their existing policy. */
export function discussionErrorMessage(error: Error | null | undefined, t: Translate): string | null {
  return error instanceof CanvasError && 'reason' in error && error.reason === 'discussion-no-response'
    ? t('discussionThread.noResponse')
    : error?.message ?? null;
}
