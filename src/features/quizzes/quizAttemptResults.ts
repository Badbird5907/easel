import { useLayoutEffect, useMemo } from 'react';
import { useCanvas } from '@/canvas/session';
import type { WebViewRoute } from '@/features/web/open';
import { openWebView } from '@/features/web/open';

type Request = (() => unknown) | undefined;
class AttemptOwner {
  constructor(
    readonly key: string,
    readonly account: string,
    readonly client: object,
    readonly requests: Request[],
  ) {}
  active = false;
  batch: object | null = null;
  web: WebViewRoute | null = null;
  activate() {
    this.active = true;
  }
  publish(web: WebViewRoute | null) {
    this.web = web;
  }
  dispose() {
    this.active = false;
    this.batch = null;
    this.web = null;
  }
  claim(batch: object | null) {
    this.batch = batch;
  }
}

/** Semantic policy/observer changes retire callbacks, including an away-and-back.
 * Locale/title changes only publish presentation. Nothing is published in render.
 * An already-entered request or web navigation cannot be rolled back.
 */
export function useAttemptActions(
  key: string,
  web: WebViewRoute | null,
  first: Request,
  second?: Request,
  third?: Request,
  fourth?: Request,
) {
  const { account, client } = useCanvas();
  const owner = useMemo(
    () => new AttemptOwner(key, account.id, client, [first, second, third, fourth]),
    [key, account.id, client, first, second, third, fourth],
  );
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.dispose();
  }, [owner]);
  useLayoutEffect(() => {
    owner.publish(web);
  });
  return {
    open: () => {
      if (owner.active && owner.web) openWebView(owner.web);
    },
    retry: async () => {
      if (!owner.active || owner.batch) return;
      const batch = {};
      owner.claim(batch);
      try {
        await Promise.allSettled(
          owner.requests.filter(Boolean).map((request) =>
            Promise.resolve().then(() => {
              if (owner.active && owner.batch === batch) return request!();
            }),
          ),
        );
      } finally {
        if (owner.active && owner.batch === batch) owner.claim(null);
      }
    },
  };
}
