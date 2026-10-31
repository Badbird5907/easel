import { useSyncExternalStore } from 'react';

import { type Connectivity, connectivity } from './connectivity';

/**
 * Whether Easel can reach Canvas right now (OFF-1): the device has a network
 * and the school's Canvas is answering. Screens disable actions that need the
 * network when this is false.
 */
export function useOnline(): boolean {
  const state = useConnectivity();
  return state.network && state.reachable;
}

/** The full offline state, for messages that say why. */
export function useConnectivity(): Connectivity {
  return useSyncExternalStore(connectivity.subscribe, connectivity.get, connectivity.get);
}
