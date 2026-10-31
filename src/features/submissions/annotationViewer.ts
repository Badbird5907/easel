import { useCallback, useLayoutEffect, useRef } from 'react';

import { CanvasNetworkError } from '@/canvas/client';

/** Only an absent parameter is a draft. Callers serialize submitted integers. */
export function annotationAttempt(raw: unknown): 'draft' | number | null {
  if (raw === undefined) return 'draft';
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function annotationFailure(error: unknown) {
  if (error instanceof CanvasNetworkError) return 'annotationViewer.network' as const;
  // Compatibility with the existing API: Canvas has no typed exhausted-attempt
  // discriminator here. Retain its /attempts/i fallback, without widening it or
  // matching translated/displayed text. Rejections need not be Error objects.
  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    /attempts/i.test(error.message)
  )
    return 'annotationViewer.attemptsUsed' as const;
  return 'annotationViewer.sessionFailed' as const;
}

/** Render never publishes ownership. Abandoned renders cannot acquire a target. */
export function useViewerLifetime<T>(context: T) {
  const live = useRef<T | null>(null);
  useLayoutEffect(() => {
    live.current = context;
    return () => {
      if (live.current === context) live.current = null;
    };
  }, [context]);
  return useCallback(() => live.current === context, [context]);
}
