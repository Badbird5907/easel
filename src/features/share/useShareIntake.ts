import {
  getResolvedSharedPayloadsAsync,
  getSharedPayloads,
  type SharePayload,
  type UseIncomingShareResult,
} from 'expo-sharing';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

type Intake = Omit<UseIncomingShareResult, 'clearSharedPayloads'> & {
  /** Retires rendered controls immediately when another observation replaces this snapshot. */
  isCurrent(): boolean;
};
type Resolution = Pick<Intake, 'resolvedSharedPayloads' | 'error'>;

// Ordered tuples preserve duplicates, order and every public raw field. Unlike
// delimiter joins, JSON cannot confuse a separator in a value with a field edge.
const payloadKey = (payloads: SharePayload[]) =>
  JSON.stringify(payloads.map(({ value, shareType, mimeType }) => [value, shareType, mimeType]));
const intakeError = (error: unknown) =>
  error instanceof Error ? error : new Error('Failed to resolve shared payloads');

function initialIntake(): Intake {
  try {
    const sharedPayloads = getSharedPayloads();
    return {
      sharedPayloads,
      resolvedSharedPayloads: [],
      isResolving: sharedPayloads.length > 0,
      error: null,
      refreshSharePayloads: () => {},
      isCurrent: () => false,
    };
  } catch (error) {
    return {
      sharedPayloads: [],
      resolvedSharedPayloads: [],
      isResolving: false,
      error: intakeError(error),
      refreshSharePayloads: () => {},
      isCurrent: () => false,
    };
  }
}

/**
 * Correlates JS-observed raw generations with their resolution attempts. Expo's
 * resolver takes no payload/ID: native capture happens later, inside that call.
 * Re-reading at settlement detects changes even without an AppState event, but
 * cannot detect unobserved OS A -> B -> A or make native capture/clear atomic.
 * Cleanup only retires callbacks; explicit leaveShare retains global clearing.
 */
export function useShareIntake(): Intake {
  const [intake, setIntake] = useState(initialIntake);

  useEffect(() => {
    let active = true;
    let generation = 0;
    let key: string | undefined;
    let current: Intake | undefined;

    function publish(next: Omit<Intake, 'isCurrent'>) {
      const snapshot: Intake = {
        ...next,
        isCurrent: () => active && current === snapshot,
      };
      current = snapshot;
      setIntake(snapshot);
    }

    function readFailure(error: unknown) {
      ++generation;
      key = undefined;
      publish({
        sharedPayloads: [],
        resolvedSharedPayloads: [],
        isResolving: false,
        error: intakeError(error),
        refreshSharePayloads,
      });
    }

    async function resolve(attempt: number) {
      let result: Resolution;
      try {
        result = { resolvedSharedPayloads: await getResolvedSharedPayloadsAsync(), error: null };
      } catch (error) {
        result = { resolvedSharedPayloads: [], error: intakeError(error) };
      }
      if (!active || generation !== attempt) return;
      // This is an observation, not proof of native provenance. Never infer
      // correlation from equal counts, filenames, or the resolved URI.
      let observed: SharePayload[];
      try {
        observed = getSharedPayloads();
      } catch (error) {
        readFailure(error);
        return;
      }
      if (payloadKey(observed) !== key) {
        accept(observed);
        return;
      }
      if (current) publish({ ...current, ...result, isResolving: false });
    }

    function accept(sharedPayloads: SharePayload[]) {
      const nextKey = payloadKey(sharedPayloads);
      // Pending and successful observations deduplicate. Failed attempts may
      // retry the same values on explicit refresh or the next active event.
      if (key === nextKey && current && !current.error) return;
      key = nextKey;
      const attempt = ++generation;
      publish({
        sharedPayloads,
        resolvedSharedPayloads: [],
        isResolving: sharedPayloads.length > 0,
        error: null,
        refreshSharePayloads,
      });
      if (sharedPayloads.length > 0) void resolve(attempt);
    }

    function refreshSharePayloads() {
      if (!active) return;
      try {
        accept(getSharedPayloads());
      } catch (error) {
        readFailure(error);
      }
    }

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshSharePayloads();
    });
    refreshSharePayloads();
    return () => {
      active = false;
      ++generation;
      subscription.remove();
    };
  }, []);

  return intake;
}
