import { useLayoutEffect, useMemo } from 'react';
import type { PeerReview } from '@/canvas/api/peerReviews';
import { CanvasNetworkError } from '@/canvas/client';
import { useCanvas } from '@/canvas/session';
import type { Translate } from '@/i18n';

/** Untagged cache labels are raw. Anonymous presentation never trusts a model name. */
export function peerLabel(review: PeerReview, anonymous: boolean, t: Translate) {
  if (anonymous || review.reviewee.kind === 'anonymous')
    return review.labelOrigin === 'generated' && review.labelOrdinal != null
      ? t('peerReviews.classmate', { count: review.labelOrdinal })
      : t('peerReviews.anonymousClassmate');
  return review.labelOrigin === 'generated' && review.labelOrdinal != null
    ? t('peerReviews.classmate', { count: review.labelOrdinal })
    : review.label;
}
export function peerFailure(error: unknown) {
  if (error instanceof CanvasNetworkError) return { reason: 'networkFailure' } as const;
  const message = error instanceof Error ? error.message : '';
  if (/not authorized|unauthorized/i.test(message)) return { reason: 'authorizedFailure' } as const;
  return message
    ? { reason: 'detailFailure' as const, detail: message.replace(/\.$/, '') }
    : { reason: 'genericFailure' as const };
}

/** Resource identity is independent of locale, titles, assessment and completed progress.
 * Render only prepares a snapshot; committed effects publish it. Event claims and
 * draft revisions are synchronous, including before React renders their state. */
class PeerOwner<T> {
  constructor(
    readonly key: string,
    readonly client: object,
    readonly account: string,
  ) {}
  active = false;
  current: T | null = null;
  revision = 0;
  confirmation: object | null = null;
  operation: object | null = null;
  retry: object | null = null;
  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.current = null;
    this.confirmation = this.operation = this.retry = null;
  }
  publish(snapshot: T) {
    this.current = snapshot;
  }
  revise() {
    this.revision++;
  }
  confirm(claim: object | null) {
    this.confirmation = claim;
  }
  send(claim: object | null) {
    this.operation = claim;
  }
  retryClaim(claim: object | null) {
    this.retry = claim;
  }
}
export function usePeerOwner<T>(key: string, snapshot?: T) {
  const { client, account } = useCanvas();
  const owner = useMemo(() => new PeerOwner<T>(key, client, account.id), [key, client, account.id]);
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.dispose();
  }, [owner]);
  useLayoutEffect(() => {
    if (snapshot !== undefined) owner.publish(snapshot);
  });
  return owner;
}

/** A rejected first request cannot release a paired retry while the second runs. */
export function usePeerRetry(key: string, requests: (() => unknown)[]) {
  const owner = usePeerOwner(key, requests);
  return async () => {
    if (!owner.active || owner.retry) return;
    const claim = {};
    owner.retryClaim(claim);
    try {
      await Promise.allSettled(
        owner.current!.map((request) =>
          Promise.resolve().then(() => {
            if (owner.active && owner.retry === claim) return request();
          }),
        ),
      );
    } finally {
      if (owner.active && owner.retry === claim) owner.retryClaim(null);
    }
  };
}
