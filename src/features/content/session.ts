import { useLayoutEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import type { CanvasClient } from '@/canvas/client';
import { isStoredAccountClient } from '@/canvas/session';
import { markSessionStarted, SESSION_MAX_AGE, sessionIsFresh, sessionStartUrl } from '@/features/web/session';

type Handle = { injectJavaScript: (script: string) => void };
type Context = { accountId: string; baseUrl: string; client: CanvasClient; source: object; expired: boolean };
let nextKey = 0; // Allocated only by the committed layout effect, never during render.

/** One committed document/native mount. Disposal never reactivates this instance. */
class ContentSession {
  readonly key: number;
  active = true;
  loaded = false;
  private ready = false;
  private presentation = '';
  private handle: Handle | null = null;
  private attached = false;
  private demanded = false;
  private pending: { initial: boolean } | null = null;
  private activated = false;
  private stopRefresh: (() => void) | null = null;

  constructor(
    readonly context: Context,
    private readonly replace: (sameMount?: boolean) => void,
    key = ++nextKey,
    private readonly resumeDemand = false,
  ) {
    this.key = key;
  }

  get needsSession() {
    return this.demanded || this.resumeDemand;
  }

  private current = () =>
    this.active &&
    !this.context.expired &&
    isStoredAccountClient(this.context.accountId, this.context.client);

  // A callback ref also revokes work if the imperative handle disappears or changes.
  attach = (handle: Handle | null) => {
    if (!this.active || this.handle === handle) return;
    if (handle && this.attached) {
      this.replace(true);
      return;
    }
    this.reset();
    this.handle = handle;
    if (handle) {
      this.attached = true;
      if (this.resumeDemand) this.demand();
    }
  };

  private reset() {
    this.pending = null;
    this.activated = false;
    this.stopRefresh?.();
    this.stopRefresh = null;
  }

  dispose() {
    this.active = false;
    this.reset();
    this.handle = null;
  }

  inheritReadiness(previous: ContentSession) {
    this.loaded = previous.loaded;
    this.ready = previous.ready;
  }

  setPresentation(script: string) {
    this.presentation = script;
    if (this.ready || this.loaded) this.present();
  }

  private present() {
    if (this.active && this.handle && this.presentation) this.handle.injectJavaScript(this.presentation);
  }

  presentationReady = () => {
    if (!this.active || !this.handle) return;
    this.ready = true;
    this.present();
  };

  loadEnd = () => {
    if (!this.active || !this.handle) return;
    this.loaded = true;
    this.present();
  };

  demand = () => {
    if (!this.current() || !this.handle) return;
    this.demanded = true;
    if (!this.stopRefresh) {
      const handle = this.handle;
      const refresh = () => {
        if (this.handle === handle && this.current()) void this.request(false);
      };
      const timer = setInterval(refresh, SESSION_MAX_AGE);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active' && !sessionIsFresh(this.context.accountId)) refresh();
      });
      this.stopRefresh = () => {
        clearInterval(timer);
        sub.remove();
      };
    }
    void this.request(true);
  };

  async request(initial: boolean) {
    const handle = this.handle;
    if (!this.current() || !handle || (initial && this.activated)) return;
    if (this.pending) {
      // The one completion must activate embeds even when a refresh entered first.
      this.pending.initial ||= initial;
      return;
    }
    const operation = { initial };
    this.pending = operation;
    const current = () => this.current() && this.handle === handle && this.pending === operation;
    let url: string | null = null;
    if (!initial || !sessionIsFresh(this.context.accountId)) {
      url = await sessionStartUrl(this.context.client).catch(() => null);
    }
    if (!current()) return;
    if (url) markSessionStarted(this.context.accountId);
    if (!current()) return;
    const activate = operation.initial;
    this.pending = null;
    if (activate) this.activated = true;
    if (activate || url) {
      const call = activate ? 'easelSession' : 'easelRefreshSession';
      handle.injectJavaScript(`window.${call} && window.${call}(${JSON.stringify(url)}); true;`);
    }
  }
}

/** Publish ownership only at commit. A new owner gets a new native key, so queued
 * events retain the old owner rather than impersonating a replacement document.
 * Handle turnover keeps the key but retires the owner; layout replay creates a fresh owner too; old promises/callbacks stay revoked. */
export function useContentSession(
  accountId: string,
  baseUrl: string,
  client: CanvasClient,
  source: object,
  expired: boolean,
) {
  const context = useMemo(
    () => ({ accountId, baseUrl, client, source, expired }),
    [accountId, baseUrl, client, source, expired],
  );
  const [session, setSession] = useState<ContentSession | null>(null);
  useLayoutEffect(() => {
    let current: ContentSession;
    const replace = (sameMount = false) => {
      // Imperative-ref replay/turnover retires callbacks but keeps the native key.
      // Remounting for every ref replay would loop under Strict Mode. Demand is
      // retried by the new owner only after its own handle attaches.
      const key = sameMount ? current.key : undefined;
      const demand = sameMount && current.needsSession;
      const previous = current;
      previous?.dispose();
      current = new ContentSession(context, replace, key, demand);
      if (sameMount) current.inheritReadiness(previous);
      setSession(current);
    };
    replace();
    return () => current.dispose();
  }, [context]);
  return session?.context === context ? session : null;
}
