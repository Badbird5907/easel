import { useLayoutEffect, useMemo } from 'react';

import type { AuthorizationRequest } from './oauth';

export type AuthEmbeddedChallenge = { host: string; url: string; failed: boolean; id: number; epoch: number; };

/** Mutable only from commit/cleanup and event delivery, never speculative rendering. */
export function useAuthEmbeddedLifetime(request: AuthorizationRequest | null) {
  const owner = useMemo(() => createOwner(request), [request]);
  useLayoutEffect(() => {
    owner.activate();
    return owner.deactivate;
  }, [owner]);
  return owner;
}

function createOwner(request: AuthorizationRequest | null) {
  let active = false;
  let ended = false;
  let epoch = 0;
  let sequence = 0;
  let challenge: AuthEmbeddedChallenge | null = null;
  let answered = false;
  let reloadScheduled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = () => active && !ended && request !== null;
  const clearChallenge = () => {
    challenge = null;
    answered = false;
    reloadScheduled = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    current,
    activate: () => { active = true; },
    deactivate: () => { active = false; epoch++; clearChallenge(); },
    finish: (url: string | null, onFinish: (url: string | null) => void) => {
      if (!current()) return;
      ended = true;
      clearChallenge();
      onFinish(url);
    },
    beginChallenge: (host: string, failed: boolean, url: string) => {
      if (!current()) return null;
      // Coalesce repeat 401 delivery while the same prompt is still open.
      if (challenge && !answered && challenge.url === url) return null;
      clearChallenge();
      challenge = { host, url, failed, id: ++sequence, epoch };
      return challenge;
    },
    ownsChallenge: (value: AuthEmbeddedChallenge) => current() && challenge === value && value.epoch === epoch && !answered,
    answer: (value: AuthEmbeddedChallenge) => {
      if (!current() || challenge !== value || value.epoch !== epoch || answered) return false;
      answered = true;
      return true;
    },
    cancelChallenge: (value: AuthEmbeddedChallenge) => {
      if (!current() || challenge !== value || value.epoch !== epoch || answered) return false;
      clearChallenge();
      return true;
    },
    scheduleReload: (value: AuthEmbeddedChallenge, reload: () => void) => {
      if (!current() || challenge !== value || value.epoch !== epoch || !answered || reloadScheduled) return;
      reloadScheduled = true;
      timer = setTimeout(() => {
        timer = undefined;
        if (current() && challenge === value && value.epoch === epoch && answered) reload();
      }, 0);
    },
  };
}

export type AuthEmbeddedOwner = ReturnType<typeof useAuthEmbeddedLifetime>;
