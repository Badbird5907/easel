import { useIsFocused, useNavigation, useRoute } from 'expo-router';
import { useLayoutEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import type { FileItem } from '@/canvas/api/files';
import type { CanvasClient } from '@/canvas/client';
import { isStoredAccountClient, useCanvas } from '@/canvas/session';
import { openSignedIn } from '@/features/content/browser';
import { type Translate, useTranslation } from '@/i18n';

export type FileViewerBrowserIdentity = {
  accountId: string;
  baseUrl: string;
  client: CanvasClient;
  fileId: string;
  courseId?: string;
  canvasUrl?: string;
  active: boolean;
  source: 'metadata' | 'download';
  error: unknown;
};

/** Mutable entry state belongs to this error control, never to a render or another file. */
class FileViewerBrowser {
  private epoch: object | null = null;
  private pending: object | null = null;
  private translate: Translate | null = null;

  constructor(
    private valid: () => boolean,
    private client: CanvasClient,
    private url: string | undefined,
  ) {}

  activate() {
    this.epoch = {};
  }
  retire() {
    this.epoch = null;
    this.pending = null;
  }
  setTranslator(t: Translate) {
    this.translate = t;
  }

  open = async () => {
    if (!this.epoch || this.pending || !this.valid() || !this.url) return;
    const generation = this.epoch;
    const operation = {};
    this.pending = operation; // Synchronous: duplicate presses cannot enter another lookup.
    const current = () => this.epoch === generation && this.pending === operation && this.valid();
    try {
      await openSignedIn(this.client, this.url, current);
    } catch {
      if (current() && this.translate)
        Alert.alert(
          this.translate('conferences.browserError'),
          this.translate('files.actions.error.unexpected'),
        );
    } finally {
      // Old finalization cannot release a replacement claim, including effect replay.
      if (this.epoch === generation && this.pending === operation) this.pending = null;
    }
  };
}

/** Only the committed error owns entry; a session request or entered browser cannot be undone. */
export function useFileViewerBrowser(
  {
    accountId,
    baseUrl,
    client,
    fileId,
    courseId,
    canvasUrl,
    active,
    source,
    error,
  }: FileViewerBrowserIdentity,
  file: FileItem | undefined,
  kind: string,
  browserUrl: string | undefined,
  eligible: boolean,
) {
  const { account, client: currentClient } = useCanvas();
  const { t } = useTranslation();
  const focused = useIsFocused();
  const [focusGeneration, setFocusGeneration] = useState(0);
  const navigation = useNavigation();
  const route = useRoute();
  const routeIdentity = JSON.stringify([route.key, route.name, route.params]);
  const fileSnapshot = JSON.stringify(file);
  const clientBaseUrl = client.baseUrl;
  const currentAccountId = account.id;
  const currentBaseUrl = account.baseUrl;
  const owner = useMemo(() => {
    const valid = () =>
      active &&
      eligible &&
      focused &&
      navigation.isFocused() &&
      accountId === currentAccountId &&
      baseUrl === currentBaseUrl &&
      client === currentClient &&
      account.id === accountId &&
      account.baseUrl === baseUrl &&
      client.baseUrl === clientBaseUrl &&
      isStoredAccountClient(accountId, client) &&
      JSON.stringify([route.key, route.name, route.params]) === routeIdentity &&
      JSON.stringify(file) === fileSnapshot;
    return new FileViewerBrowser(valid, client, browserUrl);
    // Identity includes the original query/download error, even when no metadata exists.
    // Locale and fresh callback/identity-object allocations are presentation only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accountId,
    baseUrl,
    client,
    clientBaseUrl,
    currentAccountId,
    currentBaseUrl,
    currentClient,
    fileId,
    courseId,
    canvasUrl,
    active,
    source,
    error,
    file,
    fileSnapshot,
    kind,
    browserUrl,
    eligible,
    focused,
    focusGeneration,
    navigation,
    routeIdentity,
  ]);
  useLayoutEffect(() => {
    owner.activate();
    const unsubscribe = navigation.addListener('blur', () => {
      owner.retire();
      // Blur/focus can be batched into one render with focused still true.
      setFocusGeneration((generation) => generation + 1);
    });
    return () => {
      owner.retire();
      unsubscribe();
    };
  }, [owner, navigation]);
  useLayoutEffect(() => owner.setTranslator(t), [owner, t]);
  return owner.open;
}
