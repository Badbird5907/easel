import { createPairingCode, type PairingCode } from '@/canvas/api/profile';
import type { CanvasClient } from '@/canvas/client';

/** Recheck after the mutation observer’s asynchronous entry stages. */
export function settingsPairingCreate(client: CanvasClient, current: () => boolean) {
  if (!current()) return Promise.reject(new Error('Obsolete pairing request'));
  return createPairingCode(client);
}

export type SettingsPairingFeedback = 'copied' | 'copyError' | 'shareError' | null;
type Snapshot = {
  code: PairingCode | null;
  pending: boolean;
  error: unknown;
  feedback: SettingsPairingFeedback;
};

export class SettingsPairingEffects {
  nativeBusy = false;
}

/** Per mounted account/client visit, including periods offline or without permission. */
export class SettingsPairingVisit {
  constructor(
    readonly accountId: string,
    readonly host: string,
    readonly client: object,
    readonly effects: SettingsPairingEffects,
  ) {}
  initialEntered = false;
  retryBusy = false;
}

/** Created during render, activated only by a commit. Never edits live state in render. */
export class SettingsPairingOwner {
  private epoch: object | null = null;
  private online = false;
  private generation = 0;
  private shareMessage: ((code: string) => string) | null = null;
  private snapshot: Snapshot = { code: null, pending: false, error: null, feedback: null };
  private listeners = new Set<() => void>();
  constructor(
    private visit: SettingsPairingVisit,
    private eligible: boolean,
    readonly schoolAccountId: string | null | undefined,
    private focused: boolean,
    private navigation: { isFocused(): boolean },
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    this.epoch = {};
  }
  retire() {
    this.epoch = null;
    if (this.snapshot.pending) this.update({ pending: false });
  }
  setOnline(value: boolean) {
    this.online = value;
  }
  setShareMessage(format: (code: string) => string) {
    this.shareMessage = format;
  }
  formatShareMessage(code: string) {
    if (!this.shareMessage) throw new Error('Pairing presentation is not committed');
    return this.shareMessage(code);
  }
  capture() {
    const epoch = this.epoch;
    return () => !!epoch && epoch === this.epoch && this.focused && this.navigation.isFocused();
  }
  async generate(
    expected: Snapshot,
    create: (current: () => boolean) => Promise<PairingCode>,
    initial = false,
  ) {
    const current = this.capture();
    if (!current() || !this.eligible || !this.online || expected !== this.snapshot || expected.pending)
      return;
    if (initial && this.visit.initialEntered) return;
    this.visit.initialEntered = true;
    this.generation += 1;
    this.update({ pending: true, error: null, feedback: null });
    const operation = this.snapshot;
    const owns = () => current() && this.snapshot === operation;
    try {
      const code = await create(() => owns() && this.online);
      if (owns()) this.update({ code, pending: false });
    } catch (error) {
      if (owns()) this.update({ error, pending: false });
    } finally {
      // A synchronous navigation blur can precede the focus-hook commit.
      if (this.snapshot === operation) this.update({ pending: false });
    }
  }
  /** Availability retries have their own lock and never imply permission. */
  async retry(refetch: () => Promise<unknown>) {
    if (!this.capture()() || this.visit.retryBusy) return;
    this.visit.retryBusy = true;
    try {
      await refetch();
    } catch {
      /* The query owns the visible error. */
    } finally {
      this.visit.retryBusy = false;
    }
  }
  async native(
    expected: Snapshot,
    kind: 'copy' | 'share',
    enter: (code: string) => Promise<unknown>,
    copied: () => void,
  ) {
    const current = this.capture();
    if (
      !current() ||
      !this.eligible ||
      expected !== this.snapshot ||
      !expected.code ||
      expected.pending ||
      this.visit.effects.nativeBusy
    )
      return;
    this.visit.effects.nativeBusy = true;
    // Capture the exact issued object, not just its text: duplicate server values
    // do not make an old callback valid for a newer issuance.
    const code = expected.code;
    const generation = this.generation;
    const owns = () =>
      current() && this.generation === generation && this.snapshot.code === code && !this.snapshot.pending;
    try {
      const result = await enter(code.code);
      if (!owns()) return;
      if (kind === 'copy') {
        if (result === false) this.update({ feedback: 'copyError' });
        else {
          this.update({ feedback: 'copied' });
          copied();
        }
      }
    } catch {
      if (owns()) this.update({ feedback: kind === 'copy' ? 'copyError' : 'shareError' });
    } finally {
      this.visit.effects.nativeBusy = false;
    }
  }
}
