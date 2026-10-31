import {
  focusManager,
  QueryClient,
  type QueryKey,
  useMutation,
  type UseMutationOptions,
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import { persistQueryClientSave, PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { type ComponentType, type ReactNode, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import {
  isOnline,
  noteRequestError,
  OfflineError,
  offlineLoadMessage,
  reportReachable,
  retryConnectivity,
  setProbeTarget,
} from '@/features/offline/connectivity';
import { CACHE_MAX_AGE, cacheBuster, cachePersister, shouldPersistQuery } from '@/features/offline/persist';
import { syncedQueryData } from '@/features/sync/snapshots';

import { CanvasAuthError, CanvasError, CanvasNetworkError, type CanvasClient } from './client';
import { markAccountExpired, registerAccountCleanup, useCanvas, useSession } from './session';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // At least as long as the persisted cache lives, or restored data would be collected right away.
        gcTime: CACHE_MAX_AGE,
        // Four total attempts; fast recovery without retrying permission or programming errors.
        retry: (count, error) => count < 3 && error.name !== 'AbortError' &&
          !(error instanceof CanvasAuthError) &&
          (error instanceof CanvasNetworkError || (error instanceof CanvasError &&
            (error.status === 408 || error.status === 429 || error.status >= 500))),
        retryDelay: (attempt, error) => Math.max(
          Math.min(400 * 2 ** attempt * (0.75 + Math.random() * 0.5), 8_000),
          error instanceof CanvasError ? error.retryAfterMs ?? 0 : 0,
        ),
      },
      // Mutations never wait for the network: offline, they fail right away (see useCanvasMutation).
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}

const persistOptions = {
  persister: cachePersister,
  maxAge: CACHE_MAX_AGE,
  buster: cacheBuster,
  dehydrateOptions: {
    shouldDehydrateQuery: shouldPersistQuery,
    shouldDehydrateMutation: () => false,
  },
};

/** Refetches stale data when the app returns to the foreground. */
function useAppFocus() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
    return () => sub.remove();
  }, []);
}

/**
 * Removing an account drops its cached queries from memory and from disk
 * (AUTH-10). Keys start with the account ID, so one prefix covers them all.
 */
function useAccountCacheCleanup(client: QueryClient) {
  useEffect(
    () =>
      registerAccountCleanup(async (accountId) => {
        await client.cancelQueries({ queryKey: [accountId] });
        client.removeQueries({ queryKey: [accountId] });
        // Write now rather than after the throttle, so a quick exit can't leave the data on disk.
        await persistQueryClientSave({ queryClient: client, ...persistOptions });
      }),
    [client],
  );
}

/** Drops restored data for accounts that are gone, e.g. removed just before the app was killed. */
function useOrphanCleanup(client: QueryClient, restored: boolean) {
  const { status, accounts } = useSession();
  useEffect(() => {
    if (!restored || status !== 'ready') return;
    const ids = new Set(accounts.map((a) => a.id));
    client.removeQueries({ predicate: (query) => !ids.has(String(query.queryKey[0])) });
  }, [client, restored, status, accounts]);
}

/**
 * Offline, a refresh of data already on screen ends right away instead of
 * waiting for the network: pull to refresh stops spinning, and the data stays.
 * Coming back online refetches it (refetchOnReconnect). Queries with nothing
 * cached keep waiting and read as offline errors (see asOfflineError).
 */
function useEndPausedRefreshes(client: QueryClient) {
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'pause') return;
        const { query } = event;
        if (query.state.data === undefined) return;
        setTimeout(() => {
          if (query.state.fetchStatus === 'paused') void query.cancel({ revert: true });
        }, 0);
      }),
    [client],
  );
}

/** Probes the active account's Canvas while it's unreachable. */
function useProbeTarget() {
  const { active } = useSession();
  useEffect(() => setProbeTarget(active?.baseUrl ?? null), [active?.baseUrl]);
}

/** Something that runs beside the screens with the query client: queued writes, course sync, widgets. */
export type QueryRuntime = ComponentType<{ client: QueryClient }>;

const runtimes: QueryRuntime[] = [];

/**
 * Features that keep working while the app runs register here, at import time,
 * so this file doesn't import them (they import the query hooks). They mount
 * once the saved cache is back, so they see restored data.
 */
export function registerQueryRuntime(runtime: QueryRuntime) {
  if (!runtimes.includes(runtime)) runtimes.push(runtime);
}

/**
 * React Query for Canvas data, with the cache persisted to disk (OFF-1): screens
 * open with the last data they showed, then refresh. `useIsRestoring()` is true
 * until the saved cache is back.
 */
export function CanvasQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  const [restored, setRestored] = useState(false);
  useAppFocus();
  useAccountCacheCleanup(client);
  useOrphanCleanup(client, restored);
  useEndPausedRefreshes(client);
  useProbeTarget();
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={persistOptions}
      onSuccess={() => setRestored(true)}
      onError={() => setRestored(true)}
    >
      {children}
      {restored ? runtimes.map((Runtime, index) => <Runtime key={index} client={client} />) : null}
    </PersistQueryClientProvider>
  );
}

type CanvasQueryOptions<T> = Omit<UseQueryOptions<T, Error, T, QueryKey>, 'queryKey' | 'queryFn'>;

/** One error per message, so effects that depend on `error` don't rerun every render. */
const offlineLoadErrors = new Map<string, OfflineError>();
function offlineLoadError(message: string): OfflineError {
  let error = offlineLoadErrors.get(message);
  if (!error) offlineLoadErrors.set(message, (error = new OfflineError(message)));
  return error;
}

/**
 * A query with nothing cached that's waiting for the network would otherwise
 * show a loading state forever. It reads as an error that says why, and
 * "Try again" checks the connection right away. It still loads on its own
 * once Easel is back online.
 */
function asOfflineError<T>(query: UseQueryResult<T, Error>): UseQueryResult<T, Error> {
  if (!(query.isPending && query.fetchStatus === 'paused')) return query;
  return {
    ...query,
    status: 'error',
    isPending: false,
    isLoading: false,
    isError: true,
    isLoadingError: true,
    error: offlineLoadError(offlineLoadMessage()),
    refetch: (...args: Parameters<typeof query.refetch>) => {
      retryConnectivity();
      return query.refetch(...args);
    },
  } as UseQueryResult<T, Error>;
}

/**
 * `useQuery` scoped to the active account: the key is prefixed with the
 * account ID, so switching accounts never shows another account's data.
 * Offline, cached data stays on screen and refreshes when Canvas is back.
 */
export function useCanvasQuery<T>(
  key: QueryKey,
  fetcher: (client: CanvasClient, signal: AbortSignal) => Promise<T>,
  options?: CanvasQueryOptions<T>,
) {
  const { account, client } = useCanvas();
  const queryKey = [account.id, ...key];
  // A course synced for offline (OFF-3) opens with its synced copy when nothing newer is cached.
  const synced = syncedQueryData<T>(queryKey);
  const query = useQuery({
    queryKey,
    ...(account.authMethod === 'demo' && { networkMode: 'always' as const }),
    ...(synced && { initialData: synced.data, initialDataUpdatedAt: synced.updatedAt }),
    queryFn: async ({ signal }) => {
      try {
        const data = await fetcher(client, signal);
        reportReachable();
        return data;
      } catch (error) {
        // Marking Canvas unreachable pauses the retry until it answers again.
        noteRequestError(error, account.baseUrl);
        if (error instanceof CanvasAuthError) void markAccountExpired(account.id, client).catch(() => {});
        throw error;
      }
    },
    ...options,
  });
  return asOfflineError(query);
}

/**
 * `useMutation` with the active account's client. Offline, it fails at once
 * with an `OfflineError` ("You're offline…") instead of waiting.
 */
export function useCanvasMutation<TData, TVariables>(
  mutate: (client: CanvasClient, variables: TVariables) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, Error, TVariables>, 'mutationFn'>,
) {
  const { account, client } = useCanvas();
  const mutation = useMutation({
    mutationFn: async (variables: TVariables) => {
      if (account.authMethod !== 'demo' && !isOnline()) throw new OfflineError();
      try {
        const data = await mutate(client, variables);
        reportReachable();
        return data;
      } catch (error) {
        noteRequestError(error, account.baseUrl);
        if (error instanceof CanvasAuthError) void markAccountExpired(account.id, client).catch(() => {});
        throw error;
      }
    },
    networkMode: 'always',
    ...options,
  });
  return mutation;
}

/** Query-key prefix for the active account, for invalidation after mutations. */
export function useAccountKey(): string {
  return useCanvas().account.id;
}
