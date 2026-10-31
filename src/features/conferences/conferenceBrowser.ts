import { useIsFocused, useNavigation } from 'expo-router';
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';

import type { Conference, LiveConference, Recording } from '@/canvas/api/conferences';
import { useCanvas } from '@/canvas/session';
import { openSignedIn } from '@/features/content/browser';
import { useTranslation } from '@/i18n';

export type ConferenceContext = { type: 'course' | 'group'; id: string };
type Translator = ReturnType<typeof useTranslation>['t'];

/** A conference entry claim cannot cancel session lookup or undo an entered browser. */
class ConferenceBrowser {
  private epoch: object | null = null;
  private pending: object | null = null;
  private listeners = new Set<() => void>();
  private t: Translator | null = null;

  constructor(
    private valid: () => boolean,
    private enter: (current: () => boolean) => Promise<void>,
    private notice: 'alert' | 'announcement',
  ) {}
  activate() {
    this.epoch = {};
  }
  retire() {
    this.epoch = null;
    this.pending = null;
  }
  blur = () => {
    // Retire this operation even if blur/focus happens between React commits.
    if (!this.epoch) return;
    this.epoch = {};
    this.pending = null;
    this.publish();
  };
  setTranslator(t: Translator) {
    this.t = t;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => !!this.pending;
  private publish() {
    this.listeners.forEach((listener) => listener());
  }
  open = async () => {
    if (!this.epoch || !this.valid() || this.pending) return;
    const epoch = this.epoch;
    const operation = {};
    this.pending = operation;
    const current = () => this.epoch === epoch && this.pending === operation && this.valid();
    this.publish();
    try {
      await this.enter(current);
    } catch (error) {
      if (current() && this.t) {
        if (this.notice === 'announcement')
          AccessibilityInfo.announceForAccessibility(this.t('conference.error'));
        else Alert.alert(this.t('conferences.browserError'), (error as Error).message);
      }
    } finally {
      if (current()) {
        this.pending = null;
        this.publish();
      }
    }
  };
}

/** Raw source snapshots also catch in-place changes; locale is presentation, not identity. */
export function useConferenceBrowser({
  source,
  conference,
  context,
  url,
  eligible,
  notice = 'alert',
}: {
  source: Conference | LiveConference | Recording;
  conference?: Conference;
  context: ConferenceContext;
  url: string;
  eligible: boolean;
  notice?: 'alert' | 'announcement';
}) {
  const { account, client } = useCanvas();
  const { t } = useTranslation();
  const focused = useIsFocused();
  const navigation = useNavigation();
  const { id, baseUrl } = account;
  const userId = account.user.id;
  const clientBaseUrl = client.baseUrl;
  const snapshot = JSON.stringify([source, conference, context]);
  const owner = useMemo(
    () =>
      new ConferenceBrowser(
        () =>
          focused &&
          navigation.isFocused() &&
          eligible &&
          account.id === id &&
          account.user.id === userId &&
          account.baseUrl === baseUrl &&
          client.baseUrl === clientBaseUrl &&
          JSON.stringify([source, conference, context]) === snapshot,
        (current) => openSignedIn(client, url, current),
        notice,
      ),
    // Scalar identity and the raw snapshot cover account/context clones without locale churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      id,
      userId,
      baseUrl,
      client,
      clientBaseUrl,
      focused,
      navigation,
      eligible,
      source,
      conference,
      snapshot,
      url,
      notice,
    ],
  );
  useLayoutEffect(() => {
    owner.activate();
    const unsubscribe = navigation.addListener('blur', owner.blur);
    return () => {
      owner.retire();
      unsubscribe();
    };
  }, [owner, navigation]);
  useLayoutEffect(() => owner.setTranslator(t), [owner, t]);
  const pending = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { open: owner.open, pending };
}
