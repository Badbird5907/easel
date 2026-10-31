import { ArrowLeft, ChevronLeft, Lock, RotateCw, X } from 'lucide-react-native';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { Button, Callout, Icon, IconButton, ProgressBar, Text, TextField, useTheme } from '@/design';
import { useTranslation } from '@/i18n';

import { type AuthEmbeddedChallenge, type AuthEmbeddedOwner, useAuthEmbeddedLifetime } from './authEmbeddedLifetime';
import { DUO_CLIPBOARD_BRIDGE, isDuoAppLink, isDuoPromptPage, isDuoScheme } from './duoLink';
import { type AuthorizationRequest, isCallback } from './oauth';

type Props = {
  /** The sign-in to run; null hides the view. */
  request: AuthorizationRequest | null;
  /** The OAuth callback URL, or null if the student closed the view. */
  onFinish: (callbackUrl: string | null) => void;
};

/**
 * Sign-in inside Easel (AUTH-4), for identity providers that break in the
 * system browser, and for site admin login, whose cookie only a web view can
 * set. Catches Easel callbacks and the registered Instructure HTTPS callback for mobile keys.
 */
export function EmbeddedSignIn({ request, onFinish }: Props) {
  const owner = useAuthEmbeddedLifetime(request);
  // A new object is a new authorization even when its OAuth state happens to match.
  const [slot, setSlot] = useState({ request, revision: 0 });
  if (slot.request !== request) setSlot({ request, revision: slot.revision + 1 });
  const finish = (url: string | null) => owner.finish(url, onFinish);
  return (
    <Modal
      visible={!!request}
      animationType="slide"
      // iOS: a native page sheet. Android: full screen under Easel's own header.
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => finish(null)}
    >
      {request ? <SignInWebView key={slot.revision} request={request} owner={owner} onFinish={finish} /> : null}
    </Modal>
  );
}

type Credential = { username: string; password: string; };

function SignInWebView({ request, owner, onFinish }: {
  request: AuthorizationRequest;
  owner: AuthEmbeddedOwner;
  onFinish: (url: string | null) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const webView = useRef<WebView<object>>(null);
  const source = useMemo(() => ({
    uri: request.url,
    // Canvas reads site admin login from a cookie (canvas-ios LoginWebRequest).
    ...(request.siteAdmin && { headers: { cookie: 'canvas_sa_delegated=1' } }),
  }), [request]);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [pageUrl, setPageUrl] = useState(request.url);
  const [failure, setFailure] = useState<'developerKey' | 'loadError' | 'duo' | null>(null);
  const [credential, setCredential] = useState<{ value: Credential; prompt: AuthEmbeddedChallenge; }>();
  // Schedule only after the credential prop is committed to the WebView. A timer
  // delivered after retirement still rechecks the exact request and challenge.
  useLayoutEffect(() => {
    if (credential) owner.scheduleReload(credential.prompt, () => webView.current?.reload());
  }, [credential, owner]);
  // Android has no native login prompt, so it gets an in-view form.
  const duoOpening = useRef(false);

  const [challenge, setChallenge] = useState<AuthEmbeddedChallenge | null>(null);

  const finish = (url: string | null) => {
    if (owner.current()) onFinish(url);
  };
  const reload = () => { if (owner.current()) webView.current?.reload(); };
  const back = () => { if (owner.current()) webView.current?.goBack(); };
  const close = () => {
    if (!owner.current()) return;
    if (Platform.OS === 'android' && canGoBack) back();
    else finish(null);
  };
  const page = safeUrl(pageUrl);
  const secure = page?.protocol === 'https:';
  const duoBridge = Platform.OS === 'android' ? DUO_CLIPBOARD_BRIDGE : '';

  const submitCredential = (prompt: AuthEmbeddedChallenge, value: Credential) => {
    if (!owner.answer(prompt)) return;
    setChallenge(null);
    setCredential({ value, prompt });
  };
  const cancelCredential = (prompt: AuthEmbeddedChallenge) => {
    if (owner.cancelChallenge(prompt)) setChallenge(null);
  };
  /** HTTP Basic (and on Android, NTLM) challenges answer with basicAuthCredential, then reload. */
  const askForCredentials = (url: string) => {
    const host = safeUrl(url)?.host ?? request.host.host;
    const prompt = owner.beginChallenge(host, !!credential, url);
    if (!prompt) return;
    if (Platform.OS === 'ios') {
      Alert.prompt(
        t('authEmbedded.signInTo', { host }),
        t(prompt.failed ? 'authEmbedded.credentialsFailed' : 'authEmbedded.credentialsNeeded'),
        [
          { text: t('authEmbedded.cancel'), style: 'cancel', onPress: () => cancelCredential(prompt) },
          {
            text: t('authEmbedded.signIn'),
            onPress: (value?: string | { login: string; password: string; }) => {
              if (!value || typeof value === 'string') return;
              submitCredential(prompt, { username: value.login, password: value.password });
            },
          },
        ],
        'login-password',
      );
    } else {
      setChallenge(prompt);
    }
  };

  const openDuo = (url: string) => {
    if (!owner.current() || duoOpening.current) return;
    if (!isDuoAppLink(url)) { setFailure('duo'); return; }
    duoOpening.current = true;
    setFailure(null);
    // Do not preflight canOpenURL: Android package visibility may hide an installed Duo app.
    // Pass the original link unchanged; never print, copy, or persist its authentication parameters.
    void Linking.openURL(url).catch(() => {
      if (owner.current()) setFailure('duo');
    }).finally(() => { duoOpening.current = false; });
  };

  const topInset = Platform.OS === 'ios' ? 0 : insets.top;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: topInset }}>
      <View className="min-h-14 flex-row items-center gap-1 border-b-hairline border-border px-2">
        {Platform.OS === 'ios' ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => finish(null)}
            className="min-h-11 justify-center px-2 active:opacity-60"
          >
            <Text variant="body" tone="accent">
              {t('authEmbedded.cancel')}
            </Text>
          </Pressable>
        ) : (
          <IconButton icon={X} size="lg" accessibilityLabel={t('authEmbedded.cancelSignIn')} onPress={() => finish(null)} />
        )}
        <View
          className="flex-1 flex-row items-center justify-center gap-1.5 px-2"
          accessible
          accessibilityLabel={t(secure ? 'authEmbedded.securePage' : 'authEmbedded.page', { host: page?.host ?? request.host.host })}
        >
          {secure ? <Icon icon={Lock} size={14} tone="subtle" /> : null}
          <Text variant="subhead" weight="semibold" numberOfLines={1}>
            {page?.host ?? request.host.host}
          </Text>
        </View>
        <View className="flex-row">
          {canGoBack ? (
            <IconButton
              icon={Platform.OS === 'ios' ? ChevronLeft : ArrowLeft}
              size="lg"
              accessibilityLabel={t('authEmbedded.previous')}
              onPress={back}
              flipInRTL
            />
          ) : null}
          <IconButton icon={RotateCw} size="lg" accessibilityLabel={t('authEmbedded.reload')} onPress={reload} />
        </View>
      </View>
      {loading ? (
        <ProgressBar value={Math.max(progress, 0.1)} size="sm" accessibilityLabel={t('authEmbedded.loading')} className="rounded-none" />
      ) : null}

      <View className="flex-1">
        <WebView
          ref={webView}
          source={source}
          // Intercept OAuth and Duo links ourselves instead of the library’s canOpenURL fallback.
          originWhitelist={ORIGIN_WHITELIST}
          onShouldStartLoadWithRequest={(navigation) => {
            if (!owner.current()) return false;
            if (isCallback(navigation.url, request)) {
              finish(navigation.url);
              return false;
            }
            if (isDuoScheme(navigation.url)) {
              openDuo(navigation.url);
              return false;
            }
            return true;
          }}
          // A fresh cookie jar each time, so signing in as a second account doesn't reuse the first.
          incognito
          // Popups (target=_blank, window.open) load in this view, as the official apps do.
          setSupportMultipleWindows={false}
          // Identity providers may open sign-in windows from JavaScript.
          javaScriptCanOpenWindowsAutomatically
          javaScriptEnabled
          domStorageEnabled
          applicationNameForUserAgent="Easel"
          injectedJavaScriptBeforeContentLoaded={
            (request.siteAdmin ? "document.cookie = 'canvas_sa_delegated=1; path=/'; true;" : '') + duoBridge || undefined
          }
          injectedJavaScript={duoBridge || undefined}
          onMessage={({ nativeEvent }) => {
            if (Platform.OS !== 'android' || !owner.current() || !isDuoPromptPage(nativeEvent.url)) return;
            try {
              const message = JSON.parse(nativeEvent.data);
              if (message?.type === 'easel-duo-open' && typeof message.url === 'string' && isDuoAppLink(message.url)) {
                openDuo(message.url);
              }
            } catch {
              // Other page messages are unrelated to the Duo handoff.
            }
          }}
          basicAuthCredential={credential?.value}
          onLoadStart={() => {
            if (!owner.current()) return;
            setLoading(true);
            setFailure(null);
          }}
          onLoadProgress={(event) => { if (owner.current()) setProgress(event.nativeEvent.progress); }}
          onLoadEnd={() => { if (owner.current()) setLoading(false); }}
          onNavigationStateChange={(state) => {
            if (!owner.current()) return;
            setCanGoBack(state.canGoBack);
            if (state.url && isCallback(state.url, request)) finish(state.url);
            else if (state.url) setPageUrl(state.url);
          }}
          onHttpError={(event) => {
            if (!owner.current()) return;
            const { statusCode, url } = event.nativeEvent;
            if (statusCode !== 401) return;
            // Canvas's own 401 on the authorize URL means the developer key is wrong, not a password prompt.
            if (url.startsWith(`${request.host.baseUrl}/login/oauth2`)) {
              setFailure('developerKey');
              return;
            }
            askForCredentials(url);
          }}
          onError={(event) => {
            // Cancelled navigations (our own callback catch) aren't failures.
            if (!owner.current() || isCallback(event.nativeEvent.url ?? '', request) || isDuoScheme(event.nativeEvent.url ?? '')) return;
            setFailure('loadError');
          }}
          style={{ flex: 1, backgroundColor: colors.bg }}
        />

        {failure ? (
          <View className="absolute inset-0 justify-center bg-bg px-6">
            <Callout tone="danger" title={t('authEmbedded.failureTitle')}>
              {failure === 'developerKey' ? t('authEmbedded.developerKey', { host: request.host.host }) : t(failure === 'duo' ? 'authEmbedded.duoUnavailable' : 'authEmbedded.loadError')}
            </Callout>
            <View className="mt-4 flex-row gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onPress={() => {
                  if (!owner.current()) return;
                  setFailure(null);
                  reload();
                }}
              >
                {t('authEmbedded.retry')}
              </Button>
              <Button variant="ghost" className="flex-1" onPress={close}>
                {t('authEmbedded.cancel')}
              </Button>
            </View>
          </View>
        ) : null}

        {challenge ? (
          <CredentialForm
            key={challenge.id}
            current={() => owner.ownsChallenge(challenge)}
            host={challenge.host}
            failed={challenge.failed}
            onCancel={() => cancelCredential(challenge)}
            onSubmit={(value) => submitCredential(challenge, value)}
          />
        ) : null}
      </View>
      {Platform.OS === 'android' ? <View style={{ height: insets.bottom }} /> : null}
    </View>
  );
}

function CredentialForm({
  current,
  host,
  failed,
  onCancel,
  onSubmit,
}: {
  current: () => boolean;
  host: string;
  failed: boolean;
  onCancel: () => void;
  onSubmit: (value: Credential) => void;
}) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<Credential>({ username: '', password: '' });
  const edits = useRef(fields);
  const lifetime = useRef({ active: false, submitted: false });
  useLayoutEffect(() => {
    const committed = lifetime.current;
    committed.active = true;
    return () => { committed.active = false; };
  }, [lifetime]);
  const edit = (field: keyof Credential, value: string) => {
    if (!lifetime.current.active || lifetime.current.submitted || !current()) return;
    edits.current = { ...edits.current, [field]: value };
    setFields(edits.current);
  };
  const submit = () => {
    if (!lifetime.current.active || lifetime.current.submitted || !current() || !edits.current.username) return;
    lifetime.current.submitted = true;
    onSubmit(edits.current);
  };
  const cancel = () => {
    if (!lifetime.current.active || lifetime.current.submitted || !current()) return;
    lifetime.current.submitted = true;
    onCancel();
  };
  return (
    <View className="absolute inset-0 justify-center bg-overlay/40 px-5" accessibilityViewIsModal>
      <View className="gap-4 rounded-3xl bg-bg p-5" style={{ borderCurve: 'continuous' }}>
        <View className="gap-1">
          <Text variant="headline" accessibilityRole="header">
            {t('authEmbedded.signInTo', { host })}
          </Text>
          <Text variant="subhead" tone={failed ? 'danger' : 'muted'}>
            {t(failed ? 'authEmbedded.credentialsFailed' : 'authEmbedded.credentialsNeeded')}
          </Text>
        </View>
        <TextField
          label={t('authEmbedded.username')}
          value={fields.username}
          onChangeText={(value) => edit('username', value)}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          autoFocus
        />
        <TextField
          label={t('authEmbedded.password')}
          value={fields.password}
          onChangeText={(value) => edit('password', value)}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <View className="flex-row gap-3">
          <Button variant="secondary" className="flex-1" onPress={cancel}>
            {t('authEmbedded.cancel')}
          </Button>
          <Button className="flex-1" disabled={!fields.username} onPress={submit}>
            {t('authEmbedded.signIn')}
          </Button>
        </View>
      </View>
    </View>
  );
}

const ORIGIN_WHITELIST = ['http://*', 'https://*', 'easel://*', 'duotrustedendpoints://*'];

function safeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
