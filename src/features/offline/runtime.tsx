import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { registerQueryRuntime } from '@/canvas/query';
import { useSession } from '@/canvas/session';
import { useCourseSyncRuntime } from '@/features/sync/runner';
import { useSyncSettings } from '@/features/sync/settings';
import { useWidgetFeed } from '@/features/widgets/publish';

import { setBackgroundWant } from './background';
import './requests';
import './submissionDrafts';
import { usePendingPlannerOverlay } from './plannerWrites';
import { useWriteQueue } from './queue';

/*
 * Offline work that runs beside the screens (OFF-2, OFF-3, SYS-1): the write
 * queue, the overlay that keeps queued planner changes on screen, course
 * auto-sync, and the home screen widget feed. Importing this file registers
 * it with the query provider and registers the queue's write handlers; the
 * background task imports it first thing, so both runtimes see the same setup.
 */
/** Widgets refresh in the background while anyone is signed in; course sync only when scheduled. */
function useBackgroundWants() {
  const { status, accounts } = useSession();
  const { schedule } = useSyncSettings();
  const signedIn = status === 'ready' && accounts.length > 0;
  useEffect(() => {
    setBackgroundWant('widgets', signedIn);
    setBackgroundWant('sync', signedIn && schedule !== 'off');
  }, [signedIn, schedule]);
}

function OfflineRuntime({ client }: { client: QueryClient }) {
  useBackgroundWants();
  useWriteQueue(client);
  usePendingPlannerOverlay(client);
  useCourseSyncRuntime(client);
  useWidgetFeed(client);
  return null;
}

registerQueryRuntime(OfflineRuntime);
