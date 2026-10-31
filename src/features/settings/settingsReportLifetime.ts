import { useIsFocused, useNavigation } from 'expo-router';
import { useLayoutEffect, useMemo } from 'react';

import type { Severity } from '@/canvas/api/help';

class ReportOwner {
  private epoch: object | null = null;
  constructor(
    readonly identity: object,
    private focused: boolean,
    private navigation: { isFocused(): boolean },
  ) {}
  activate() {
    this.epoch = {};
  }
  retire() {
    this.epoch = null;
  }
  current = () => !!this.epoch && this.focused && this.navigation.isFocused();
  capture() {
    const epoch = this.epoch;
    return () => !!epoch && this.epoch === epoch && this.current();
  }
}

export function useSettingsReportOwner(identity: object) {
  const focused = useIsFocused();
  const navigation = useNavigation();
  const owner = useMemo(
    () => new ReportOwner(identity, focused, navigation),
    [identity, focused, navigation],
  );
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.retire();
  }, [owner]);
  return owner;
}

type Draft = { subject: string; description: string; email: string | null; severity: Severity | null };
type Run = { owner: ReportOwner; current(): boolean };
type Success = { current(): boolean; host: string; email: string; done: boolean };
type Snapshot = {
  draft: Draft;
  tried: boolean;
  pending: Run | null;
  error: { current(): boolean; message: string } | null;
  success: Success | null;
};

/** Per-resource event state. Render only reads immutable snapshots; native events
 * publish synchronously, so a retained submit sees edits before React rerenders. */
export class SettingsReportForm {
  constructor(readonly identity: object) {}
  private snapshot: Snapshot = {
    draft: { subject: '', description: '', email: null, severity: null },
    tried: false,
    pending: null,
    error: null,
    success: null,
  };
  private listeners = new Set<() => void>();
  private profileEmail = '';
  get = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  setProfileEmail(email: string) {
    this.profileEmail = email;
  }
  change(owner: ReportOwner, patch: Partial<Draft>) {
    if (!owner.current() || this.snapshot.success?.current()) return;
    this.publish({ draft: { ...this.snapshot.draft, ...patch }, error: null });
  }
  async submit(
    owner: ReportOwner,
    options: {
      online(): boolean;
      host: string;
      send(draft: Draft & { severity: Severity; email: string }): Promise<unknown>;
      warning(): void;
      success(): void;
      error(): void;
    },
  ) {
    // Keep the entered claim across effect replay, even when its effects retired.
    if (
      !owner.current() ||
      this.snapshot.pending?.owner === owner ||
      this.snapshot.success?.current() ||
      !options.online()
    )
      return;
    const draft = this.snapshot.draft;
    this.publish({ tried: true });
    if (!draft.subject.trim() || !draft.description.trim() || !draft.severity) {
      options.warning();
      return;
    }
    const current = owner.capture();
    const run: Run = { owner, current: () => current() && this.snapshot.draft === draft };
    const email = (draft.email ?? this.profileEmail).trim();
    this.publish({ pending: run, error: null, success: null });
    try {
      await options.send({
        ...draft,
        subject: draft.subject.trim(),
        description: draft.description.trim(),
        severity: draft.severity,
        email,
      });
      if (this.snapshot.pending !== run || !run.current()) return;
      this.publish({ success: { current: run.current, host: options.host, email, done: false } });
      options.success();
    } catch (failure) {
      if (this.snapshot.pending !== run || !run.current()) return;
      this.publish({ error: { current: run.current, message: (failure as Error).message } });
      options.error();
    } finally {
      // An old completion can release only its own claim, never a newer run.
      if (this.snapshot.pending === run) this.publish({ pending: null });
    }
  }
  done(success: Success, navigate: () => void) {
    if (this.snapshot.success !== success || !success.current() || success.done) return;
    success.done = true;
    navigate();
  }
}
