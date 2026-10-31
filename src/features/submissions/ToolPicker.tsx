import { openBrowserAsync } from 'expo-web-browser';
import { CloudOff, Globe, RotateCw } from 'lucide-react-native';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { homeworkPickerPath } from '@/canvas/api/submissions';
import { useCanvas } from '@/canvas/session';
import { Button, EmptyState, ProgressBar, useTheme } from '@/design';
import { sessionUrl } from '@/features/content/browser';
import { useOnline } from '@/features/offline/useOnline';
import { type Popup, PopupSheet, type PopupSheetHandle } from '@/features/web/PopupSheet';
import { deliverToPopup, pageShim, parseShimMessage, popupEvent } from '@/features/web/scripts';

import { useTranslation } from '@/i18n';

import { parsePickerMessage, type PickerOutcome, pickerListener } from './toolContent';

const originOf = (url: string) => url.match(/^(https?:\/\/[^/?#]+)/i)?.[1] ?? '';

/**
 * A tool's `homework_submission` picker (ASSIGN-9): Google Drive, OneDrive,
 * Studio, and the like. It opens Canvas's own resource selection page signed in
 * through `session_token`, the way the web's submission page frames it, and
 * reports what the student picked.
 *
 * This is its own web view rather than `AuthenticatedWebView` because it has to
 * listen for the message Canvas posts when the tool answers. It shares the
 * popup bridge with the authenticated web view, so tools' sign-in popups work.
 */
type PickerProps = {
  courseId: string;
  assignmentId: string;
  toolId: string;
  toolName: string;
  /** false permits another answer after a rejected/download-failed outcome. */
  onOutcome: (outcome: PickerOutcome) => void | boolean | Promise<void | boolean>;
  isCurrent?: () => boolean;
  launchIdentity?: object;
  topInset?: number;
};

export function ToolPicker(props: PickerProps) {
  const { client, account } = useCanvas();
  const identity = JSON.stringify([
    account.id,
    account.baseUrl,
    props.courseId,
    props.assignmentId,
    props.toolId,
  ]);
  const [session, setSession] = useState({
    identity,
    client,
    launch: props.launchIdentity,
    generation: 0,
  });
  if (
    session.identity !== identity ||
    session.client !== client ||
    session.launch !== props.launchIdentity
  ) {
    setSession({
      identity,
      client,
      launch: props.launchIdentity,
      generation: session.generation + 1,
    });
  }
  return <PickerSession key={session.generation} {...props} />;
}

function PickerSession({
  courseId,
  assignmentId,
  toolId,
  toolName,
  onOutcome,
  isCurrent,
  topInset = 0,
}: PickerProps) {
  const { client, account } = useCanvas();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const online = useOnline();
  const webRef = useRef<WebView<object>>(null);
  const popupRef = useRef<PopupSheetHandle>(null);
  const [source, setSource] = useState<{ uri: string; key: number } | null>(null);
  const [failure, setFailure] = useState<'connection' | 'page' | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [popup, setPopup] = useState<Popup | null>(null);
  const currentUrl = useRef('');
  const livePopup = useRef(popup);
  useLayoutEffect(() => {
    livePopup.current = popup;
  }, [popup]);
  const answered = useRef(false);
  const browserClaim = useRef<object | null>(null);
  const started = useRef(false);
  const [requestGeneration, setRequestGeneration] = useState(0);
  const life = useRef<{ active: boolean; generation: number; url: string; succeeded: boolean }>({
    active: false,
    generation: 0,
    url: '',
    succeeded: false,
  });
  const callbacks = useRef({ onOutcome, isCurrent });
  useLayoutEffect(() => {
    callbacks.current = { onOutcome, isCurrent };
  });
  useLayoutEffect(() => {
    const state = life.current;
    state.active = true;
    return () => {
      state.active = false;
      state.generation++;
      started.current = false;
    };
  }, []);
  const current = () => life.current.active && (callbacks.current.isCurrent?.() ?? true);
  const pageCurrent = () => current() && source?.key === life.current.generation;

  const pageUrl = new URL(
    homeworkPickerPath(courseId, toolId, assignmentId),
    account.baseUrl,
  ).toString();

  /** Gets a fresh signed URL: session URLs are single use, so every load needs its own. */
  const fetchSource = useCallback(() => {
    const state = life.current;
    if (!state.active || !(callbacks.current.isCurrent?.() ?? true)) return;
    const generation = ++state.generation;
    setRequestGeneration(generation);
    state.url = '';
    state.succeeded = false;
    answered.current = false;
    setFailure(null);
    setLoading(true);
    setProgress(0);
    setPopup(null);
    const owns = () =>
      state.active && generation === state.generation && (callbacks.current.isCurrent?.() ?? true);
    return sessionUrl(client, pageUrl).then(
      (uri) => {
        if (owns()) setSource({ uri, key: generation });
      },
      () => {
        if (owns()) {
          setLoading(false);
          setFailure('connection');
        }
      },
    );
  }, [client, pageUrl]);
  const load = () => {
    if (current() && requestGeneration === life.current.generation) void fetchSource();
  };

  // First load, once there's a connection.
  useEffect(() => {
    if (!online || started.current) return;
    started.current = true;
    fetchSource();
  }, [online, fetchSource]);

  const onMessage = (event: WebViewMessageEvent) => {
    if (
      !pageCurrent() ||
      (event.nativeEvent.url && life.current.url && event.nativeEvent.url !== life.current.url)
    )
      return;
    const raw = event.nativeEvent.data;
    // The tool's answer. Checked first: the popup bridge claims every `easel-` message.
    if (raw.includes('"easel-picker-content"')) {
      try {
        const message = JSON.parse(raw) as { type: string; data: unknown };
        const outcome = parsePickerMessage(message.data);
        if (!outcome || answered.current) return;
        answered.current = true;
        const generation = life.current.generation;
        Promise.resolve(callbacks.current.onOutcome(outcome)).then(
          (accepted) => {
            if (current() && life.current.generation === generation && accepted === false)
              answered.current = false;
          },
          () => {
            if (current() && life.current.generation === generation) answered.current = false;
          },
        );
      } catch {
        answered.current = false;
        // Not a picker message, or a synchronous consumer failure.
      }
      return;
    }
    const shim = parseShimMessage(raw);
    if (!shim) return;
    switch (shim.type) {
      case 'easel-popup-open':
        setPopup({ id: shim.id, url: shim.url });
        break;
      case 'easel-popup-close':
        if (livePopup.current?.id === shim.id) setPopup(null);
        break;
      case 'easel-popup-navigate':
        if (livePopup.current?.id === shim.id) popupRef.current?.navigate(shim.url);
        break;
      case 'easel-popup-post':
        if (livePopup.current?.id === shim.id)
          popupRef.current?.inject(deliverToPopup(shim.data, originOf(currentUrl.current)));
        break;
    }
  };

  const closePopup = () => {
    if (!pageCurrent() || livePopup.current !== popup) return;
    if (popup) webRef.current?.injectJavaScript(popupEvent(popup.id, 'closed', null));
    setPopup(null);
  };

  const openInBrowser = async () => {
    if (!current() || requestGeneration !== life.current.generation || browserClaim.current) return;
    const claim = {};
    const generation = life.current.generation;
    browserClaim.current = claim;
    try {
      const uri = await sessionUrl(client, pageUrl);
      if (current() && generation === life.current.generation && browserClaim.current === claim)
        await openBrowserAsync(uri);
    } catch {
      /* Same silent browser fallback failure behavior. */
    } finally {
      if (browserClaim.current === claim) browserClaim.current = null;
    }
  };

  if (!online && !source)
    return (
      <View className="flex-1 justify-center bg-bg" style={{ paddingTop: topInset }}>
        <EmptyState
          icon={CloudOff}
          title={t('toolPicker.offline')}
          description={t('toolPicker.offlineHelp', { name: toolName })}
          action={{ label: t('toolPicker.retry'), leadingIcon: RotateCw, onPress: load }}
        />
      </View>
    );

  if (failure)
    return (
      <View className="flex-1 justify-center bg-bg" style={{ paddingTop: topInset }}>
        <EmptyState
          icon={CloudOff}
          title={t('toolPicker.failed', { name: toolName })}
          description={t('toolPicker.failureHelp', {
            reason: t(
              failure === 'connection' ? 'toolPicker.connectionFailure' : 'toolPicker.pageFailure',
            ),
          })}
          action={{ label: t('toolPicker.retry'), leadingIcon: RotateCw, onPress: load }}
        />
        <Button variant="ghost" leadingIcon={Globe} onPress={openInBrowser} className="self-center">
          {t('toolPicker.browser')}
        </Button>
      </View>
    );

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: topInset }}>
      {source ? (
        <WebView
          key={source.key}
          ref={webRef}
          source={{ uri: source.uri }}
          style={{ flex: 1, backgroundColor: colors.bg }}
          accessibilityLabel={toolName}
          originWhitelist={['http://*', 'https://*', 'about:*', 'blob:*', 'data:*']}
          injectedJavaScriptBeforeContentLoaded={`${pageShim}\n${pickerListener}`}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          javaScriptCanOpenWindowsAutomatically
          setSupportMultipleWindows
          allowsInlineMediaPlayback
          allowsBackForwardNavigationGestures
          allowsLinkPreview={false}
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
          applicationNameForUserAgent="Easel"
          webviewDebuggingEnabled={__DEV__}
          onShouldStartLoadWithRequest={(request) => {
            if (!pageCurrent()) return false;
            if (/^(https?|about|blob|data):/i.test(request.url)) return true;
            Linking.openURL(request.url).catch(() => {});
            return false;
          }}
          onLoadStart={(e) => {
            if (!pageCurrent()) return;
            life.current.url = e.nativeEvent.url;
            life.current.succeeded = false;
            setLoading(true);
          }}
          onLoadProgress={(e) => {
            if (pageCurrent()) setProgress(e.nativeEvent.progress);
          }}
          onLoad={(e) => {
            if (!pageCurrent() || (life.current.url && life.current.url !== e.nativeEvent.url))
              return;
            life.current.succeeded = true;
            setFailure(null);
            setLoading(false);
          }}
          onLoadEnd={(e) => {
            if (pageCurrent() && (!life.current.url || life.current.url === e.nativeEvent.url))
              setLoading(false);
          }}
          onNavigationStateChange={(nav) => {
            if (pageCurrent()) currentUrl.current = nav.url;
          }}
          onError={(e) => {
            if (
              !pageCurrent() ||
              life.current.succeeded ||
              (life.current.url && life.current.url !== e.nativeEvent.url)
            )
              return;
            const { code, domain } = e.nativeEvent;
            if (code === -999 || (domain === 'WebKitErrorDomain' && (code === 102 || code === 204)))
              return;
            if (Platform.OS === 'android' && code === -3) return;
            setFailure('page');
          }}
          onOpenWindow={(e) => {
            if (pageCurrent()) setPopup({ id: null, url: e.nativeEvent.targetUrl });
          }}
          onMessage={onMessage}
          onContentProcessDidTerminate={() => {
            if (pageCurrent()) webRef.current?.reload();
          }}
          onRenderProcessGone={() => {
            if (pageCurrent()) load();
          }}
        />
      ) : null}
      {loading ? (
        <View className="absolute inset-x-0" style={{ top: topInset }} pointerEvents="none">
          <ProgressBar
            value={Math.max(0.06, progress)}
            size="sm"
            className="rounded-none bg-transparent"
            accessibilityLabel={t('toolPicker.loading', { name: toolName })}
          />
        </View>
      ) : null}
      <PopupSheet
        ref={popupRef}
        popup={popup}
        onClose={closePopup}
        onNavigate={(next) => {
          if (!pageCurrent() || livePopup.current !== popup) return;
          if (popup) webRef.current?.injectJavaScript(popupEvent(popup.id, 'url', next));
        }}
        onOpenerMessage={(data, origin) => {
          if (!pageCurrent() || livePopup.current !== popup) return;
          webRef.current?.injectJavaScript(
            popupEvent(popup?.id ?? null, 'message', { json: data.json, origin }),
          );
        }}
      />
    </View>
  );
}
