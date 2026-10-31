import { onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { AppState } from 'react-native';

import { CanvasNetworkError } from '@/canvas/client';

/*
 * Whether Easel can reach Canvas (OFF-1). Two signals:
 *   - the device's network, from expo-network
 *   - whether the school's Canvas answers, learned from failed requests
 *
 * A request that can't reach Canvas marks it unreachable. Easel then probes the
 * host every few seconds and flips back as soon as it answers. React Query's
 * onlineManager follows the combined state, so refetches pause offline (cached
 * data stays on screen) and resume on reconnect.
 */

export type Connectivity = {
  /** The device has a network connection. */
  network: boolean;
  /** The active Canvas host answered recently. */
  reachable: boolean;
  /** Host that failed, for messages like "Can't reach school.instructure.com". */
  host: string | null;
};

let state: Connectivity = { network: true, reachable: true, host: null };
const listeners = new Set<() => void>();

/** The active account's Canvas, probed while it's unreachable. */
let probeBaseUrl: string | null = null;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probing = false;

const PROBE_INTERVAL_MS = 8_000;
const PROBE_TIMEOUT_MS = 6_000;

function setState(patch: Partial<Connectivity>) {
  const next = { ...state, ...patch };
  if (next.network === state.network && next.reachable === state.reachable && next.host === state.host)
    return;
  state = next;
  for (const listener of listeners) listener();
  if (state.network && !state.reachable) scheduleProbe();
}

export const connectivity = {
  get: (): Connectivity => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function isOnline(): boolean {
  return state.network && state.reachable;
}

/** Reads the network state with expo-network. */
function fromNetworkState(s: Network.NetworkState): boolean {
  // UNKNOWN reads as disconnected in expo-network; don't block on it.
  if (s.type === Network.NetworkStateType.UNKNOWN) return true;
  return s.type !== Network.NetworkStateType.NONE && s.isConnected !== false;
}

function applyNetwork(s: Network.NetworkState) {
  const network = fromNetworkState(s);
  // A returning network is worth a fresh try at Canvas.
  setState(network && !state.network ? { network, reachable: true, host: null } : { network });
}

let started = false;

/** Starts watching the network. Call once, from the root layout. */
export function startConnectivity() {
  if (started) return;
  started = true;
  Network.getNetworkStateAsync()
    .then(applyNetwork)
    .catch(() => {});
  Network.addNetworkStateListener(applyNetwork);
  AppState.addEventListener('change', (next) => {
    if (next === 'active' && state.network && !state.reachable) void probe();
  });
  onlineManager.setEventListener((setOnline) => {
    setOnline(isOnline());
    return connectivity.subscribe(() => setOnline(isOnline()));
  });
}

/** Which Canvas to probe while it's unreachable: the active account's. */
export function setProbeTarget(baseUrl: string | null) {
  probeBaseUrl = baseUrl;
}

/** A request failed before reaching Canvas. */
export function reportUnreachable(baseUrl: string) {
  let host: string | null = null;
  try {
    host = new URL(baseUrl).host;
  } catch {
    // Keep the generic message.
  }
  setState({ reachable: false, host });
}

/** A request reached Canvas. */
export function reportReachable() {
  if (!state.reachable) setState({ reachable: true, host: null });
}

/** Records the outcome of a request so the offline state follows reality. */
export function noteRequestError(error: unknown, baseUrl: string) {
  if (error instanceof CanvasNetworkError && !(error instanceof OfflineError)) reportUnreachable(baseUrl);
}

function scheduleProbe(delay = PROBE_INTERVAL_MS) {
  if (probeTimer) return;
  probeTimer = setTimeout(() => {
    probeTimer = null;
    void probe();
  }, delay);
}

/**
 * Asks Canvas for anything: any HTTP answer, even a 401, means it's reachable.
 * Sends no token.
 */
async function probe() {
  if (probing || !probeBaseUrl) return;
  probing = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(`${probeBaseUrl}/api/v1/users/self`, { method: 'HEAD', signal: controller.signal });
    reportReachable();
  } catch {
    // Still unreachable.
  } finally {
    clearTimeout(timeout);
    probing = false;
    if (state.network && !state.reachable) scheduleProbe();
  }
}

/** Checks again right away, e.g. from a "Try again" button. */
export function retryConnectivity() {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
  void probe();
}

/** What to tell the student when something needs the network. */
export function offlineMessage(current: Connectivity = state): string {
  if (!current.network) return 'You’re offline. Connect to the internet and try again.';
  return `Couldn’t reach ${current.host ?? 'Canvas'}. Check your connection and try again.`;
}

/** Why data with nothing cached can't load yet. It loads on its own once Canvas answers. */
export function offlineLoadMessage(current: Connectivity = state): string {
  if (!current.network) return 'You’re offline. This loads when you reconnect.';
  return `Couldn’t reach ${current.host ?? 'Canvas'}. This loads when it’s back.`;
}

/**
 * Thrown instead of sending a request while offline, so actions fail right
 * away with a clear reason instead of hanging.
 */
export class OfflineError extends CanvasNetworkError {
  constructor(message = offlineMessage()) {
    super(message);
    this.name = 'OfflineError';
  }
}
