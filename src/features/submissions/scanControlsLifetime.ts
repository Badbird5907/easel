import { router, useNavigation, useRoute } from 'expo-router';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';

import { submissionFilesPath } from '@/canvas/api/submissions';
import type { CanvasClient } from '@/canvas/client';
import { haptics } from '@/design';
import { PickerPermissionError, PickerUnavailableError } from '@/features/files/upload';
import type { MessageKey, Translate } from '@/i18n';

import {
  addPages,
  buildPdf,
  capturePages,
  clearPages,
  movePage,
  pagesFor,
  pickPages,
  removePage,
  type ScanPage,
} from './scan';
import { addUploads, submissionSlot } from './uploadStore';

/** Claims are synchronous; ownership is published only by a committed layout effect.
 * Native presentation/focus is deliberately not ownership. Actual navigator state,
 * account/client/route replacement and unmount retire pending continuations.
 * Entered native writes/uploads cannot be rolled back by this caller.
 */
export function useScanControls(
  accountId: string,
  client: CanvasClient,
  courseId: string,
  assignmentId: string,
  pages: ScanPage[],
  t: Translate,
) {
  const navigation = useNavigation();
  const route = useRoute();
  const [generation, setGeneration] = useState(0);
  const owner = useMemo(
    () => ({ accountId, client, courseId, assignmentId, navigation, routeKey: route.key, generation }),
    [accountId, client, courseId, assignmentId, navigation, route.key, generation],
  );
  const key = `${accountId}|${courseId}|${assignmentId}`;
  type Lease = { owner: typeof owner; operation: object | null; confirmation: object | null };
  const live = useRef<Lease | null>(null);
  const translator = useRef(t);
  const [status, setStatus] = useState<{
    owner: typeof owner;
    busy: 'capture' | 'pdf' | null;
    error: MessageKey | null;
  } | null>(null);
  // A system picker can take focus without changing this navigator's active route.
  const onRoute = () => {
    const state = navigation.getState();
    return state?.routes[state.index]?.key === route.key;
  };
  useLayoutEffect(() => {
    translator.current = t;
  }, [t]);
  useLayoutEffect(() => {
    const lease: Lease = { owner, operation: null, confirmation: null };
    live.current = lease;
    let wasActive = navigation.getState()?.routes[navigation.getState()?.index ?? 0]?.key === owner.routeKey;
    const unsubscribe = navigation.addListener('state', () => {
      const state = navigation.getState();
      const active = state?.routes[state.index]?.key === owner.routeKey;
      if (!active && live.current === lease) live.current = null;
      if (active !== wasActive) {
        wasActive = active;
        setGeneration((n) => n + 1);
      }
    });
    return () => {
      unsubscribe();
      if (live.current === lease) live.current = null;
    };
  }, [navigation, owner]);
  const current = () => live.current?.owner === owner && onRoute();
  const snapshotCurrent = (snapshot = pages) => current() && pagesFor(key) === snapshot;
  const editable = () => snapshotCurrent() && !live.current?.operation;
  const claim = (busy: 'capture' | 'pdf') => {
    if (!editable()) return null;
    const lease = live.current!;
    const operation = {};
    lease.operation = operation;
    lease.confirmation = null;
    setStatus({ owner, busy, error: null });
    return operation;
  };
  const owns = (operation: object) => current() && live.current?.operation === operation;
  const finish = (operation: object, error: MessageKey | null = null) => {
    if (!owns(operation)) return;
    live.current!.operation = null;
    setStatus({ owner, busy: null, error });
  };
  const announce = (
    message: 'scanControls.added' | 'scanControls.removed' | 'scanControls.moved',
    count: number,
  ) => {
    // These announcement keys all take count; keep the key union at the call site.
    AccessibilityInfo.announceForAccessibility(translator.current(message, { count }));
  };
  const add = async (source: () => Promise<string[]>) => {
    const operation = claim('capture');
    if (!operation) return;
    try {
      const uris = await source();
      if (!owns(operation) || !snapshotCurrent()) return;
      if (uris.length) {
        addPages(key, uris);
        if (owns(operation)) announce('scanControls.added', uris.length);
      }
    } catch (error) {
      if (!snapshotCurrent()) return;
      const message =
        error instanceof PickerPermissionError && error.origin === 'camera-permission'
          ? 'scanControls.permission'
          : error instanceof PickerUnavailableError && error.origin === 'camera-unavailable'
            ? 'scanControls.unavailable'
            : 'scanControls.captureFailed';
      finish(operation, message);
      return;
    } finally {
      // A failure already released the claim; do not erase its error.
      if (owns(operation)) finish(operation);
    }
  };
  const createPdf = async () => {
    if (!pages.length) return;
    const operation = claim('pdf');
    if (!operation) return;
    try {
      const pdf = await buildPdf(pages);
      if (!owns(operation) || !snapshotCurrent()) return;
      addUploads(
        submissionSlot(accountId, courseId, assignmentId),
        { client, preflightPath: submissionFilesPath(courseId, assignmentId) },
        [pdf],
      );
      // Upload listeners may synchronously replace the owner/pages.
      if (!owns(operation) || !snapshotCurrent()) return;
      clearPages(key);
      const cleared = pagesFor(key);
      if (!owns(operation) || cleared.length) return;
      haptics.success();
      if (!owns(operation) || !snapshotCurrent(cleared)) return;
      router.back();
    } catch {
      if (owns(operation) && snapshotCurrent()) {
        haptics.error();
        finish(operation, 'scanControls.pdfFailed');
      }
    } finally {
      if (owns(operation)) finish(operation);
    }
  };
  const edit = (id: string, action: string) => {
    if (!editable()) return;
    const index = pages.findIndex((page) => page.id === id);
    if (index < 0) return;
    if (action === 'remove') {
      live.current!.confirmation = null;
      removePage(key, id);
      if (current()) announce('scanControls.removed', index + 1);
    } else if ((action === 'moveUp' && index > 0) || (action === 'moveDown' && index < pages.length - 1)) {
      live.current!.confirmation = null;
      const offset = action === 'moveUp' ? -1 : 1;
      movePage(key, id, offset);
      if (current()) announce('scanControls.moved', index + offset + 1);
    }
  };
  const discard = () => {
    if (!pages.length || !editable()) return;
    const confirmation = {};
    live.current!.confirmation = confirmation;
    const cancel = () => {
      if (current() && live.current?.confirmation === confirmation) live.current.confirmation = null;
    };
    Alert.alert(
      translator.current('scanControls.discardTitle'),
      translator.current('scanControls.discardBody'),
      [
        { text: translator.current('scanControls.keep'), style: 'cancel', onPress: cancel },
        {
          text: translator.current('scanControls.discard'),
          style: 'destructive',
          onPress: () => {
            if (!editable() || live.current?.confirmation !== confirmation) return;
            live.current.confirmation = null;
            clearPages(key);
            if (current())
              AccessibilityInfo.announceForAccessibility(translator.current('scanControls.discarded'));
          },
        },
      ],
      { cancelable: true, onDismiss: cancel },
    );
  };
  return {
    busy: status?.owner === owner ? status.busy : null,
    error: status?.owner === owner ? status.error : null,
    capture: () => add(capturePages),
    fromPhotos: () => add(pickPages),
    createPdf,
    edit,
    discard,
  };
}
