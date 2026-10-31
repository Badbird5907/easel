import { router } from 'expo-router';
import { CloudOff, Globe, RotateCw } from 'lucide-react-native';
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BackHandler, Linking, Platform, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { useCanvas } from '@/canvas/session';
import { Button, EmptyState, ProgressBar, useTheme } from '@/design';
import { sessionUrl } from '@/features/content/browser';
import { resolveCanvasLink } from '@/features/content/links';
import { useTranslation } from '@/i18n';
import { useWebLifetime, useWebLive } from './lifetime';

import { useOnline } from '@/features/offline/useOnline';

import { canvasFileId, looksLikeDownload, openDownload } from './downloads';
import { type Popup, PopupSheet, type PopupSheetHandle } from './PopupSheet';
import {
  androidDownloadShim,
  deliverToPopup,
  pageShim,
  parseShimMessage,
  popupEvent,
  toolFrameShim,
} from './scripts';
import { markSessionStarted } from './session';

export type WebViewState = {
  /** The page's own title. */
  title: string;
  url: string;
  canGoBack: boolean;
  loading: boolean;
};

export type AuthenticatedWebViewHandle = {
  /** Reloads the page. Pages that failed, and tool launches, start fresh. */
  reload: () => void;
  goBack: () => void;
  /** The page on screen now, for "Open in browser". */
  currentUrl: () => string;
};

export type AuthenticatedWebViewProps = {
  /** A Canvas page (opened signed in) or any other URL. */
  url: string;
  /** Optional enclosing resource lifetime; callback identities are not resource IDs. */
  resourceIdentity?: object;
  /** `url` is already a one-time signed URL, like a tool launch. Load it as is. */
  signed?: boolean;
  /** A fresh signed URL for reloads and retries, such as a new tool launch. */
  relaunch?: () => Promise<string>;
  /** Spoken name for the page. */
  title?: string;
  /** Course the page belongs to, for files it opens. */
  courseId?: string;
  /** Leaves Easel for the system browser; offered when the page can't load. */
  onOpenInBrowser?: () => void;
  onStateChange?: (state: WebViewState) => void;
  /** Space above the page, e.g. under a floating header. */
  topInset?: number;
  /**
   * Android: load a tool launch's tool as the page rather than inside Canvas's
   * iframe, so popups, sign-in windows, and downloads in the tool work.
   */
  unwrapToolFrame?: boolean;
  /** Back from a tool to its spent launch page: leave the screen. */
  onExit?: () => void;
  ref?: Ref<AuthenticatedWebViewHandle>;
};

/** Canvas pages that only make sense on the web, so links to them stay in the web view. */
const STAY_ON_WEB =
  /\/(take|history|submissions|external_tools|login|collaborations|outcomes|conferences)\b|display=borderless|session_token/;

const isCanvasHost = (url: string, baseUrl: string) => {
  try {
    return new URL(url).host === new URL(baseUrl).host;
  } catch {
    return false;
  }
};

const originOf = (url: string) => {
  const match = url.match(/^(https?:\/\/[^/?#]+)/i);
  return match ? match[1] : '';
};

/**
 * One web view for everything Canvas only offers on the web: tools, New
 * Quizzes, quiz fallbacks, Collaborations, Outcomes, DocViewer (PRD 9).
 *
 * - Canvas pages open signed in through a `session_token` URL. Cookies stay in
 *   the web view's own store and only ever come from the school's Canvas host.
 * - Popups and `window.open` open in a sheet, with `window.opener` bridged so
 *   sign-in popups inside tools finish (LTI-4).
 * - Downloads go to Easel's file viewer; Canvas links with native screens open
 *   them. File inputs, camera, and microphone work as in Safari or Chrome.
 * - Shows load progress, and error and offline states with "Try again".
 */
export function AuthenticatedWebView({
  url,
  resourceIdentity,
  signed,
  relaunch,
  title,
  courseId,
  onOpenInBrowser,
  onStateChange,
  topInset = 0,
  unwrapToolFrame = false,
  onExit,
  ref,
}: AuthenticatedWebViewProps) {
  const { client, account } = useCanvas();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const owner = useWebLifetime(
    JSON.stringify([url, signed, courseId, unwrapToolFrame]),
    client,
    JSON.stringify([account.id, account.baseUrl]),
    resourceIdentity,
  );
  const live = useWebLive({ relaunch, onOpenInBrowser, onStateChange, onExit });
  const online = useOnline();
  const webRef = useRef<WebView<object>>(null);
  const signedOwners = useRef(new Map<string, typeof owner>());
  const popupRef = useRef<PopupSheetHandle>(null);

  const [storedSource, setSource] = useState<{
    owner: typeof owner;
    source: { uri: string };
    key: number;
    mountKey: number;
  } | null>(null);
  const source = storedSource?.owner === owner ? storedSource : null;
  type Failure = { reason: 'page' | 'connection'; raw?: string };
  const [display, setDisplay] = useState({
    owner,
    failure: null as Failure | null,
    progress: 0,
    loading: true,
  });
  const { failure, progress, loading } =
    display.owner === owner ? display : { failure: null, progress: 0, loading: true };
  const update = (patch: Partial<Omit<typeof display, 'owner'>>) =>
    setDisplay((s) => ({
      ...(s.owner === owner ? s : { owner, failure: null, progress: 0, loading: true }),
      ...patch,
    }));
  const [storedPopup, setStoredPopup] = useState<{ owner: typeof owner; popup: Popup } | null>(
    null,
  );
  const popup = storedPopup?.owner === owner ? storedPopup.popup : null;
  const popupLiveRef = useWebLive(popup);
  const setPopup = (next: Popup | null) => {
    popupLiveRef.current = next;
    setStoredPopup(next ? { owner, popup: next } : null);
  };
  const currentRef = useMemo(
    () => ({
      owner,
      current: { url, title: '', canGoBack: false, loaded: false, failed: false },
    }),
    [owner, url],
  );
  const [request, setRequest] = useState({ owner, generation: 0 });
  const requestGeneration = request.owner === owner ? request.generation : 0;
  const ownsRequest = () => owner.active && owner.generation === requestGeneration;
  const ownsSource = () => owner.active && !!source && source.key === owner.generation;
  const ownsPopup = () => ownsSource() && !!popup && popupLiveRef.current === popup;

  const injected = useMemo(
    () =>
      Platform.OS === 'android'
        ? `${pageShim}\n${androidDownloadShim}\n${unwrapToolFrame ? toolFrameShim : ''}`
        : pageShim,
    [unwrapToolFrame],
  );

  const load = useCallback(
    async (target: string) => {
      if (!owner.active || owner.pending) return;
      const generation = owner.begin();
      setRequest({ owner, generation });
      setDisplay({ owner, failure: null, loading: true, progress: 0 });
      setSource(null);
      popupLiveRef.current = null;
      setStoredPopup(null);
      currentRef.current.loaded = false;
      currentRef.current.failed = false;

      currentRef.current.title = '';
      currentRef.current.canGoBack = false;
      const owns = () => owner.active && owner.generation === generation;
      live.current.onStateChange?.({ title: '', url: target, canGoBack: false, loading: true });
      if (!owns()) return;
      try {
        let uri: string;
        if (signed) {
          const previous = signedOwners.current.get(target);
          if (owner.initialSigned() && !previous) {
            signedOwners.current.set(target, owner);
            uri = target;
          } else if (live.current.relaunch) {
            uri = await live.current.relaunch();
          } else if (!owner.allowInitialSigned || (previous && previous !== owner)) {
            throw new Error();
          } else uri = target;
        } else if (!isCanvasHost(target, account.baseUrl)) uri = target;
        else {
          uri = await sessionUrl(client, target);
          if (!owns()) return;
          if (uri !== target) markSessionStarted(account.id);
        }
        if (!owns()) return;
        setSource({ owner, source: { uri }, key: generation, mountKey: generation });
      } catch (error) {
        if (!owns()) return;

        setDisplay({
          owner,
          loading: false,
          progress: 0,
          failure: { reason: 'page', raw: (error as Error)?.message || undefined },
        });
      } finally {
        if (owns()) owner.finish();
      }
    },
    [owner, currentRef, signed, account.baseUrl, account.id, client, live, popupLiveRef],
  );

  const connectionRef = useRef({ owner, online });
  const failureRef = useWebLive(failure);
  useEffect(() => {
    const reconnect =
      connectionRef.current.owner === owner && !connectionRef.current.online && online;
    connectionRef.current = { owner, online };
    if (online && (!owner.started || (reconnect && failureRef.current))) {
      // Replay/unmount cancels a queued start before it can consume a URL.
      let cancelled = false;
      void Promise.resolve().then(() => {
        if (!cancelled) void load(url);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [online, owner, load, url, failureRef]);

  const report = (patch: Partial<WebViewState>) => {
    if (!ownsSource()) return;
    Object.assign(currentRef.current, patch);
    live.current.onStateChange?.({
      title: currentRef.current.title,
      url: currentRef.current.url,
      canGoBack: currentRef.current.canGoBack,
      loading: patch.loading ?? false,
    });
  };

  const reloadNative = () => {
    if (!ownsSource()) return;
    report({ loading: true });
    if (!ownsSource()) return;
    const generation = owner.next();
    setRequest({ owner, generation });
    setSource({ owner, source: source!.source, key: generation, mountKey: source!.mountKey });
    setPopup(null);
    currentRef.current.loaded = false;

    update({ loading: true, progress: 0 });
    webRef.current?.reload();
  };

  const reload = () => {
    if (!ownsRequest() || owner.pending) return;
    if (signed || failure || !currentRef.current.loaded) {
      void load(signed ? url : currentRef.current.url || url);
      return;
    }
    // Normal reload keeps native history and the exact source object.
    reloadNative();
  };

  useImperativeHandle(ref, () => ({
    reload,
    goBack: () => {
      if (ownsSource()) webRef.current?.goBack();
    },
    currentUrl: () => (ownsRequest() ? currentRef.current.url || url : ''),
  }));

  // Android Back goes back a page before it leaves the screen.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!ownsSource() || popupLiveRef.current !== popup) return false;
      if (popupLiveRef.current) {
        setPopup(null);
        return true;
      }
      if (currentRef.current.canGoBack) {
        webRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  });

  const onShouldStart = (request: ShouldStartLoadRequest) => {
    if (!ownsSource()) return false;
    const target = request.url;
    if (/^(about|blob|data):/i.test(target)) return true;
    if (!/^https?:/i.test(target)) {
      // mailto:, tel:, and app links (Zoom, Teams, LockDown Browser) belong to other apps.
      Linking.openURL(target).catch(() => {});
      return false;
    }
    // Android reports no frame; it only asks about the main frame in practice.
    const topFrame = Platform.OS === 'android' ? request.isTopFrame !== false : request.isTopFrame;
    if (!currentRef.current.loaded) return true;
    const userInitiated = Platform.OS === 'android' || request.navigationType === 'click';
    // Frames load freely (tools live in Canvas's tool iframe), except a tap on a Canvas
    // link inside one, which opens the way it would from the page itself.
    if (!topFrame && !(userInitiated && isCanvasHost(target, account.baseUrl))) return true;

    if (canvasFileId(target, account.baseUrl) && !STAY_ON_WEB.test(target)) {
      openDownload(target, account.baseUrl, { courseId });
      return false;
    }
    // iOS hands real downloads to onFileDownload once the response arrives; Android has no such hook.
    if (Platform.OS === 'android' && looksLikeDownload(target)) {
      openDownload(target, account.baseUrl, { courseId });
      return false;
    }
    if (userInitiated && isCanvasHost(target, account.baseUrl) && !STAY_ON_WEB.test(target)) {
      const route = resolveCanvasLink(target, account.baseUrl);
      const here = currentRef.current.url.split(/[?#]/)[0];
      if (route && target.split(/[?#]/)[0] !== here) {
        router.push(route as never);
        return false;
      }
    }
    return true;
  };

  const onMessage = (event: WebViewMessageEvent) => {
    if (!ownsSource()) return;
    const message = parseShimMessage(event.nativeEvent.data);
    if (!message) return;
    switch (message.type) {
      case 'easel-popup-open':
        if (popupLiveRef.current === popup) setPopup({ id: message.id, url: message.url });
        break;
      case 'easel-popup-close':
        if (ownsPopup() && popup?.id === message.id) setPopup(null);
        break;
      case 'easel-popup-navigate':
        if (ownsPopup() && popup?.id === message.id) popupRef.current?.navigate(message.url);
        break;
      case 'easel-popup-post':
        if (ownsPopup() && popup?.id === message.id)
          popupRef.current?.inject(deliverToPopup(message.data, originOf(currentRef.current.url)));
        break;
      case 'easel-download':
        openDownload(message.url, account.baseUrl, { courseId, name: message.name || undefined });
        break;
      case 'easel-tool-revisited':
        if (live.current.onExit) live.current.onExit();
        else webRef.current?.goForward();
        break;
    }
  };

  const closePopup = () => {
    if (!ownsPopup()) return;
    if (popup) webRef.current?.injectJavaScript(popupEvent(popup.id, 'closed', null));
    setPopup(null);
  };

  if (!online && !source) {
    return (
      <View className="flex-1 justify-center bg-bg" style={{ paddingTop: topInset }}>
        <EmptyState
          icon={CloudOff}
          title={t('web.offline')}
          description={t('web.offlineHelp')}
          action={{
            label: t('web.retry'),
            leadingIcon: RotateCw,
            onPress: () => {
              if (ownsRequest()) void load(url);
            },
          }}
        />
      </View>
    );
  }

  if (failure) {
    return (
      <View className="flex-1 justify-center bg-bg" style={{ paddingTop: topInset }}>
        <EmptyState
          icon={CloudOff}
          title={t('web.failed')}
          description={t(onOpenInBrowser ? 'web.failureBrowserHelp' : 'web.failureHelp', {
            reason:
              failure.raw ?? t(failure.reason === 'connection' ? 'web.connection' : 'web.page'),
          })}
          action={{ label: t('web.retry'), leadingIcon: RotateCw, onPress: reload }}
        />
        {onOpenInBrowser ? (
          <Button
            variant="ghost"
            leadingIcon={Globe}
            onPress={() => {
              if (ownsRequest()) live.current.onOpenInBrowser?.();
            }}
            className="self-center"
          >
            {t('web.browser')}
          </Button>
        ) : null}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: topInset }}>
      {source ? (
        <WebView
          key={source.mountKey}
          ref={webRef}
          source={source.source}
          style={{ flex: 1, backgroundColor: colors.bg }}
          accessibilityLabel={title}
          originWhitelist={['http://*', 'https://*', 'about:*', 'blob:*', 'data:*']}
          injectedJavaScriptBeforeContentLoaded={injected}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          javaScriptCanOpenWindowsAutomatically
          setSupportMultipleWindows
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          allowsPictureInPictureMediaPlayback
          allowsBackForwardNavigationGestures
          allowsLinkPreview={false}
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
          applicationNameForUserAgent="Easel"
          downloadingMessage={t('web.downloading')}
          lackPermissionToDownloadMessage={t('web.downloadPermission')}
          webviewDebuggingEnabled={__DEV__}
          onShouldStartLoadWithRequest={onShouldStart}
          onLoadStart={() => {
            if (!ownsSource()) return;
            update({ loading: true });
            report({ loading: true });
          }}
          onLoadProgress={(e) => {
            if (ownsSource()) update({ progress: e.nativeEvent.progress });
          }}
          onLoadEnd={() => {
            if (!ownsSource() || currentRef.current.failed) return;

            currentRef.current.loaded = true;
            update({ loading: false });
            report({ loading: false });
          }}
          onNavigationStateChange={(nav: WebViewNavigation) =>
            report({
              url: nav.url,
              title: nav.title ?? '',
              canGoBack: nav.canGoBack,
              loading: nav.loading,
            })
          }
          onError={(e) => {
            if (!ownsSource()) return;
            // Cancelled loads (a new navigation, a link Easel opened natively) and loads that
            // turned into downloads (WebKit 102) aren't failures.
            const { code, domain } = e.nativeEvent;
            if (code === -999 || (domain === 'WebKitErrorDomain' && (code === 102 || code === 204)))
              return;
            if (Platform.OS === 'android' && code === -3) return;
            currentRef.current.failed = true;

            setRequest({ owner, generation: owner.next() });
            setPopup(null);
            update({
              failure: {
                reason: /offline|internet|network|host/i.test(e.nativeEvent.description)
                  ? 'connection'
                  : 'page',
              },
              loading: false,
            });
          }}
          onOpenWindow={(e) => {
            if (ownsSource() && popupLiveRef.current === popup)
              setPopup({ id: null, url: e.nativeEvent.targetUrl });
          }}
          onFileDownload={(e) => {
            if (ownsSource())
              openDownload(e.nativeEvent.downloadUrl, account.baseUrl, { courseId });
          }}
          onMessage={onMessage}
          onContentProcessDidTerminate={reloadNative}
          onRenderProcessGone={() => {
            if (ownsSource()) void load(currentRef.current.url || url);
          }}
        />
      ) : null}
      {loading ? (
        <View className="absolute inset-x-0" style={{ top: topInset }} pointerEvents="none">
          <ProgressBar
            value={Math.max(0.06, progress)}
            size="sm"
            className="rounded-none bg-transparent"
            accessibilityLabel={title ? t('web.loadingTitle', { title }) : t('web.loading')}
          />
        </View>
      ) : null}
      <PopupSheet
        ref={popupRef}
        popup={popup}
        onClose={closePopup}
        onNavigate={(next) => {
          if (ownsPopup() && popup)
            webRef.current?.injectJavaScript(popupEvent(popup.id, 'url', next));
        }}
        onOpenerMessage={(data, origin) => {
          if (!ownsPopup()) return;
          webRef.current?.injectJavaScript(
            popupEvent(popup?.id ?? null, 'message', { json: data.json, origin }),
          );
        }}
      />
    </View>
  );
}
