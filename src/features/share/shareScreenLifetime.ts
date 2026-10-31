import type { Translate } from '@/i18n/types';

import {
  getSharedContentSnapshot,
  setSharedContent,
  type SharedContent,
  type SharedContentSnapshot,
} from './content';

/** Only an explicitly empty destination gets authored fallback copy. */
export function shareScreenNoticeBody(host: string, school: string, t: Translate) {
  return t('shareScreen.otherBody', {
    destination: host === '' ? t('shareScreen.anotherSite') : host,
    school,
  });
}

// Only a committed, focused screen may publish or act on the shared picker slot.
let currentOwner: ShareScreenOwner | null = null;

export class ShareScreenOwner {
  private active = false;
  private publication: SharedContentSnapshot | null = null;
  private values: string;
  private observed: SharedContentSnapshot;
  private controls = {};
  private listeners = new Set<() => void>();

  constructor(
    private content: SharedContent,
    private focused: boolean,
    private navigation: { isFocused(): boolean },
    private sourceCurrent: () => boolean = () => true,
  ) {
    this.values = JSON.stringify(content);
    this.observed = getSharedContentSnapshot();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.controls;

  private advance() {
    this.controls = {};
    for (const listener of this.listeners) listener();
  }

  activate() {
    this.active = true;
    if (!this.focused || !this.navigation.isFocused() || !this.sourceCurrent()) return;
    // A newer publication between render and commit wins. Replay may reactivate
    // only its still-current record, without publishing stale content again.
    if (
      getSharedContentSnapshot() !== (this.publication ?? this.observed) ||
      JSON.stringify(this.content) !== this.values
    )
      return;
    currentOwner = this;
    this.publication ??= setSharedContent(this.content);
  }

  retire() {
    this.active = false;
    if (currentOwner === this) currentOwner = null;
    this.advance();
    // clearSharedPayloads is global and has no compare-and-clear identity.
    // Effect replay/old unmounts must not erase a replacement native share.
    // Explicit Done still uses the unchanged public leaveShare protocol.
  }

  private current() {
    return (
      this.active &&
      currentOwner === this &&
      this.focused &&
      this.navigation.isFocused() &&
      this.sourceCurrent() &&
      this.publication !== null &&
      getSharedContentSnapshot() === this.publication &&
      JSON.stringify(this.content) === this.values
    );
  }

  enter(expected: object, action: () => void) {
    if (!this.current() || expected !== this.controls) return;
    // Consume retained controls synchronously, including cross-action taps.
    this.advance();
    const admitted = this.controls;
    // Recheck after notifying subscribers; never overwrite a newer store record.
    if (this.current() && this.controls === admitted) action();
  }
}
