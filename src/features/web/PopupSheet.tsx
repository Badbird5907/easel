import { type Ref, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Linking, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { useTranslation } from '@/i18n';
import { useWebLifetime, useWebLive } from './lifetime';

import { ProgressBar, Text, useTheme } from '@/design';

import { parseShimMessage, popupShim } from './scripts';

export type Popup = {
  /** The page's stand-in window ID, or null for links opened with target=_blank. */
  id: string | null;
  url: string;
};

export type PopupSheetHandle = {
  /** Runs script in the popup, e.g. to deliver a message from the page. */
  inject: (script: string) => void;
  navigate: (url: string) => void;
};

type Props = {
  popup: Popup | null;
  onClose: () => void;
  /** The popup posted to `window.opener`. */
  onOpenerMessage: (data: { json: string }, origin: string) => void;
  /** The popup moved to a new URL. */
  onNavigate: (url: string) => void;
  ref?: Ref<PopupSheetHandle>;
};

const CLOSED = {};

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

/**
 * A popup or `window.open` from a page or tool (LTI-4), as a sheet over the
 * page with its own web view. Sign-in popups (Google, Microsoft) finish here
 * and report back to the page through `window.opener`.
 */
export function PopupSheet({ popup, onClose, onOpenerMessage, onNavigate, ref }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const owner = useWebLifetime(JSON.stringify([popup?.id, popup?.url]), popup ?? CLOSED, 'popup');
  const live = useWebLive({ onClose, onOpenerMessage, onNavigate });
  const closedRef = useRef<typeof owner | null>(null);
  const owns = () => owner.active && !!popup && closedRef.current !== owner;
  const close = () => {
    if (!owns()) return;
    closedRef.current = owner;
    live.current.onClose();
  };
  const [instance, setInstance] = useState({ owner, key: 0 });
  const popupKey = instance.owner === owner ? instance.key : instance.key + 1;
  if (instance.owner !== owner) setInstance({ owner, key: popupKey });
  const source = useMemo(() => ({ uri: popup?.url ?? '' }), [popup]);
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView<object>>(null);
  const empty = { owner, title: '', url: '', progress: 0, loading: true };
  const [stored, setStored] = useState(empty);
  const state = stored.owner === owner ? stored : empty;
  const setState = (change: (s: typeof empty) => typeof empty) => {
    if (owns()) setStored((s) => change(s.owner === owner ? s : empty));
  };

  useImperativeHandle(ref, () => ({
    inject: (script) => {
      if (owns()) webRef.current?.injectJavaScript(script);
    },
    navigate: (url) => {
      if (owns()) webRef.current?.injectJavaScript(`location.href = ${JSON.stringify(url)}; true;`);
    },
  }));

  const onMessage = (event: WebViewMessageEvent) => {
    if (!owns()) return;
    const message = parseShimMessage(event.nativeEvent.data);
    if (message?.type === 'easel-opener-post')
      live.current.onOpenerMessage(message.data, message.origin);
    if (message?.type === 'easel-popup-self-close') close();
  };

  const host = hostOf(state.url || popup?.url || '');
  const title = state.title && state.title !== state.url ? state.title : host || t('web.window');

  return (
    <Modal
      visible={!!popup}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <View
        className="flex-1 bg-bg"
        style={{ paddingTop: Platform.OS === 'android' ? insets.top : 0 }}
      >
        <View className="min-h-14 flex-row items-center gap-3 border-b-hairline border-border px-4">
          <View className="flex-1 py-2" accessible accessibilityRole="header">
            <Text variant="headline" numberOfLines={1}>
              {title}
            </Text>
            {host && title !== host ? (
              <Text variant="footnote" tone="muted" numberOfLines={1}>
                {host}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('web.closeWindow')}
            hitSlop={12}
            onPress={close}
            className="min-h-11 justify-center active:opacity-60"
          >
            <Text variant="body" weight="semibold" tone="accent">
              {t('common.done')}
            </Text>
          </Pressable>
        </View>
        {state.loading ? (
          <ProgressBar
            value={Math.max(0.08, state.progress)}
            size="sm"
            className="rounded-none"
            accessibilityLabel={t('web.loading')}
          />
        ) : null}
        {popup ? (
          <WebView
            key={popupKey}
            ref={webRef}
            source={source}
            style={{ flex: 1, backgroundColor: colors.bg }}
            originWhitelist={['http://*', 'https://*', 'about:*', 'blob:*', 'data:*']}
            injectedJavaScriptBeforeContentLoaded={popupShim}
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            javaScriptCanOpenWindowsAutomatically
            setSupportMultipleWindows={false}
            allowsInlineMediaPlayback
            mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
            allowsLinkPreview={false}
            applicationNameForUserAgent="Easel"
            webviewDebuggingEnabled={__DEV__}
            onMessage={onMessage}
            onLoadStart={() => setState((s) => ({ ...s, loading: true }))}
            onLoadProgress={(e) => setState((s) => ({ ...s, progress: e.nativeEvent.progress }))}
            onLoadEnd={() => setState((s) => ({ ...s, loading: false }))}
            onNavigationStateChange={(nav) => {
              if (!owns()) return;
              setState((s) => ({ ...s, title: nav.title ?? '', url: nav.url }));
              if (nav.url) live.current.onNavigate(nav.url);
            }}
            onShouldStartLoadWithRequest={(request) => {
              if (!owns()) return false;
              if (/^(https?|about|blob|data):/i.test(request.url)) return true;
              Linking.openURL(request.url).catch(() => {});
              return false;
            }}
            // A popup opening its own popup replaces itself.
            onOpenWindow={(e) =>
              owns() &&
              webRef.current?.injectJavaScript(
                `location.href = ${JSON.stringify(e.nativeEvent.targetUrl)}; true;`,
              )
            }
          />
        ) : null}
        <View style={{ height: Platform.OS === 'android' ? insets.bottom : 0 }} />
      </View>
    </Modal>
  );
}
