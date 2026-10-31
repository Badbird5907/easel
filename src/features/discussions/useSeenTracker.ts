import { useCallback, useEffect, useRef, useState } from 'react';
import { type HostInstance, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Room the stack header takes below the status bar. */
const HEADER = 44;
/** Batch marks so a fast scroll sends a few requests, not one per reply. */
const FLUSH_MS = 700;
const CHECK_MS = 250;

/**
 * Notices unread replies as they scroll into view and reports them in batches
 * (CONTENT-2: "mark read as entries are seen"). Unread entries register the view
 * to watch; the screen calls `check` when it scrolls or its content changes.
 */
export function useSeenTracker(onSeen: (ids: string[]) => void) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const views = useRef(new Map<string, HostInstance>());
  const seenRef = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheck = useRef(0);
  const report = useRef(onSeen);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    report.current = onSeen;
  }, [onSeen]);

  const flush = useCallback(() => {
    flushTimer.current = null;
    const ids = [...pending.current];
    pending.current.clear();
    if (!ids.length) return;
    setSeen(new Set(seenRef.current));
    report.current(ids);
  }, []);

  const measure = useCallback(() => {
    const top = insets.top + HEADER;
    const bottom = height - insets.bottom;
    for (const [id, view] of views.current) {
      if (seenRef.current.has(id)) continue;
      view.measureInWindow((_x, y, width, h) => {
        if (width <= 0 || h <= 0 || seenRef.current.has(id)) return;
        if (y + h > top && y < bottom) {
          seenRef.current.add(id);
          pending.current.add(id);
          if (!flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_MS);
        }
      });
    }
  }, [flush, height, insets.top, insets.bottom]);

  /** Looks for newly visible replies, at most every quarter second while scrolling. */
  const check = useCallback(() => {
    const now = Date.now();
    if (now - lastCheck.current < CHECK_MS) return;
    lastCheck.current = now;
    measure();
  }, [measure]);

  /** Always measures: after a scroll ends, a layout change, or replies expanding. */
  const checkNow = useCallback(() => {
    lastCheck.current = Date.now();
    // Let layout settle first.
    requestAnimationFrame(measure);
  }, [measure]);

  const register = useCallback((id: string, view: HostInstance | null) => {
    if (view) views.current.set(id, view);
    else views.current.delete(id);
  }, []);

  /** Counts replies as handled without reporting them: marked read in bulk, or marked unread by hand. */
  const markHandled = useCallback((ids: string[]) => {
    for (const id of ids) {
      seenRef.current.add(id);
      pending.current.delete(id);
    }
    setSeen(new Set(seenRef.current));
  }, []);

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      // Report what was seen just before leaving.
      const ids = [...pending.current];
      pending.current.clear();
      if (ids.length) report.current(ids);
    },
    [],
  );

  return { register, check, checkNow, markHandled, seen };
}
