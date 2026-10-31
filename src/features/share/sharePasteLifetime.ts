import * as Clipboard from 'expo-clipboard';
import { AccessibilityInfo } from 'react-native';

import type { Account } from '@/canvas/session';
import { haptics } from '@/design';
import type { Translate } from '@/i18n/types';

import { linkTarget, normalizeLink, openLinkTarget, type LinkTarget } from './links';

type ErrorKey = 'invalid' | 'empty' | 'clipboardEmpty' | 'clipboardError';
type Snapshot = {
  value: string;
  input: object;
  error: ErrorKey | null;
  notice: Extract<LinkTarget, { kind: 'other' }> | null;
};

/** Display-only fallback: supplied English-looking host values remain verbatim. */
export function sharePasteNoticeBody(host: string, school: string, t: Translate) {
  return t('sharePaste.otherBody', {
    destination: host === '' ? t('sharePaste.anotherSite') : host,
    school,
  });
}

// Clipboard entry cannot be cancelled. Share this admission slot even across
// owner retirement/unmount; no account or clipboard contents are stored here.
let clipboardEntry: object | null = null;

/** Render may construct an owner, but only a committed effect activates it. */
export class SharePasteOwner {
  private epoch: object | null = null;
  private translate: Translate | null = null;
  private snapshot: Snapshot = { value: '', input: {}, error: null, notice: null };
  private listeners = new Set<() => void>();

  constructor(
    private account: Account,
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
    // Replay must not revive retained controls or an old clipboard operation.
    this.update({ input: {}, error: null, notice: null });
  }
  setTranslator(t: Translate) {
    this.translate = t;
  }
  private current() {
    return !!this.epoch && this.focused && this.navigation.isFocused();
  }
  private accepts(expected: Snapshot) {
    return this.current() && expected === this.snapshot;
  }
  private acceptsInput(expected: Snapshot) {
    return this.current() && expected.input === this.snapshot.input;
  }

  edit(expected: Snapshot, value: string) {
    // Multiple text events may use one committed callback before React renders.
    // Keep its field generation, but replace the snapshot so every edit retires
    // an outstanding clipboard result and any notice action immediately.
    if (!this.acceptsInput(expected)) return;
    this.update({ value, error: null, notice: null });
  }

  open(expected: Snapshot) {
    if (!this.acceptsInput(expected)) return;
    this.openInput(this.snapshot.value);
  }

  private openInput(input: string) {
    // Claim this set of controls before any effect, including invalid/other-site
    // feedback. Retained submit callbacks cannot enter twice before a render.
    this.update({ input: {} });
    const url = normalizeLink(input, this.account.baseUrl);
    if (!url) {
      this.update({ notice: null, error: input.trim() ? 'invalid' : 'empty' });
      if (this.current()) haptics.warning();
      return;
    }
    const target = linkTarget(url, this.account);
    if (target.kind === 'other') {
      this.update({ error: null, notice: target });
      const notice = this.snapshot;
      if (this.accepts(notice)) haptics.warning();
      if (this.accepts(notice) && this.translate)
        AccessibilityInfo.announceForAccessibility(this.translate('sharePaste.otherTitle'));
      return;
    }
    // Claim synchronously, before router/openWebView entry, so retained controls
    // cannot launch again while React has yet to publish the cleared field.
    this.update({ value: '', input: {}, error: null, notice: null });
    if (this.current()) openLinkTarget(target);
  }

  browse(expected: Snapshot) {
    if (!this.accepts(expected) || !expected.notice) return;
    const target = expected.notice;
    this.update({ notice: null });
    if (this.current()) openLinkTarget(target);
  }

  async paste(expected: Snapshot) {
    if (!this.acceptsInput(expected) || clipboardEntry) return;
    const entry = {};
    clipboardEntry = entry;
    const epoch = this.epoch;
    this.update({ error: null, notice: null });
    const operation = this.snapshot;
    const owns = () => this.epoch === epoch && this.accepts(operation);
    let text: string;
    try {
      text = (await Clipboard.getStringAsync()).trim();
    } catch {
      if (owns()) this.update({ error: 'clipboardError' });
      return;
    } finally {
      if (clipboardEntry === entry) clipboardEntry = null;
    }
    if (!owns()) return;
    if (!text) {
      this.update({ error: 'clipboardEmpty' });
      return;
    }
    this.update({ value: text, input: {} });
    this.openInput(text);
  }
}
