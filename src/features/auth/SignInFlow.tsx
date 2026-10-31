import {
  AppWindow,
  Globe,
  KeyRound,
  type LucideIcon,
  School as SchoolIcon,
  ShieldCheck,
  SquareAsterisk,
  Ticket,
} from 'lucide-react-native';
import { type ComponentRef, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, TextInput, View } from 'react-native';

import { acceptTerms, fetchRequiresTerms } from '@/canvas/api/legal';
import { normalizeHost } from '@/canvas/client';
import { discoverMobileCredentials, MobileVerifyError } from '@/canvas/mobileVerify';
import {
  type Account,
  type ClientCredentials,
  discardSignIn,
  createOAuthSource,
  type PendingSignIn,
  ObsoleteSignInError,
  SignInError,
  storedClientCredentials,
  useSession,
  verifyOAuth,
  verifyToken,
  wrongAccountMessage,
} from '@/canvas/session';
import {
  Avatar,
  Button,
  Callout,
  Card,
  haptics,
  IconTile,
  ListGroup,
  ListItem,
  type Option,
  OptionGroup,
  Screen,
  Sheet,
  Text,
  TextField,
} from '@/design';

import { useTranslation, type MessageKey, type Translate } from '@/i18n';

import { authFormsClaim, authFormsRetire, useAuthFormsLifetime, type AuthFormsOperation, type AuthFormsOwner } from './authFormsLifetime';
import { EmbeddedSignIn } from './EmbeddedSignIn';
import { developerKeyFor } from './keys';
import {
  type AuthorizationRequest,
  authorizeInBrowser,
  checkSchool,
  codeFromCallback,
  createAuthorization,
  exchangeCode,
  type LoginMode,
  SignInCanceled,
} from './oauth';
import { type School, searchSchools, typedSchool } from './schools';
import { TermsStep } from './TermsStep';
import { TokenHelp } from './TokenHelp';

/** The login modes, plus the two ways to bring your own credentials (AUTH-5, AUTH-6). */
export type SignInMethod = LoginMode | 'key' | 'token';

/** `hint` fits the sheet's one-line subtitles; `description` explains the choice once it's made. */
const methods: Record<SignInMethod, { label: MessageKey; hint: MessageKey; description: MessageKey; icon: LucideIcon; }> = {
  browser: {
    label: 'authForms.method.browser.label',
    hint: 'authForms.method.browser.hint',
    description: 'authForms.method.browser.description',
    icon: Globe,
  },
  canvas: {
    label: 'authForms.method.canvas.label',
    hint: 'authForms.method.canvas.hint',
    description: 'authForms.method.canvas.description',
    icon: KeyRound,
  },
  'site-admin': {
    label: 'authForms.method.site-admin.label',
    hint: 'authForms.method.site-admin.hint',
    description: 'authForms.method.site-admin.description',
    icon: ShieldCheck,
  },
  embedded: {
    label: 'authForms.method.embedded.label',
    hint: 'authForms.method.embedded.hint',
    description: 'authForms.method.embedded.description',
    icon: AppWindow,
  },
  key: {
    label: 'authForms.method.key.label',
    hint: 'authForms.method.key.hint',
    description: 'authForms.method.key.description',
    icon: SquareAsterisk,
  },
  token: {
    label: 'authForms.method.token.label',
    hint: 'authForms.method.token.hint',
    description: 'authForms.method.token.description',
    icon: Ticket,
  },
};

const option = (value: SignInMethod, t: Translate): Option<SignInMethod> => ({
  value,
  label: t(methods[value].label),
  subtitle: t(methods[value].hint),
  leading: <IconTile icon={methods[value].icon} tone="neutral" size="sm" />,
});
const pageMethods = (['browser', 'canvas', 'site-admin', 'embedded'] as const);
const credentialMethods = (['key', 'token'] as const);

type Message = { tone: 'danger' | 'info'; title: MessageKey; text: MessageKey; host?: string; } | { tone: 'danger'; title: MessageKey; raw: string; };

type Props = {
  /** Draws the large title, for the root sign-in screen. Modal screens have a native header. */
  showTitle?: boolean;
  /** Signing in again to an account whose sign-in ended (AUTH-8). Locks the school and the user. */
  expired?: Account | null;
  /** From Add account: asks Canvas for a fresh login, so the browser's current session isn't reused. */
  addingAccount?: boolean;
  onSignedIn?: (account: Account) => void;
  /** Extra content under the form, such as other accounts to switch to. */
  footer?: ReactNode;
};

/**
 * Canvas sign-in (AUTH-1 to AUTH-7): find the school, then one Continue button
 * that opens the school's sign-in in the system browser. "Other ways to sign
 * in" switches to Canvas login, site admin, an in-app web view, a developer
 * key, or an access token.
 */
export function SignInFlow({ showTitle, expired, addingAccount, onSignedIn, footer }: Props) {
  const { t } = useTranslation();
  const { addAccount } = useSession();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<School | null>(null);
  const [method, setMethod] = useState<SignInMethod>(expired?.authMethod === 'token' ? 'token' : 'browser');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, setPending] = useState<{ signIn: PendingSignIn; operation: AuthFormsOperation; retry?: number; } | null>(null);
  const acceptedTerms = useRef(new WeakSet<AuthFormsOperation>());
  const [embedded, setEmbedded] = useState<AuthorizationRequest | null>(null);
  const embeddedDone = useRef<((url: string | null) => void) | null>(null);
  const embeddedRequest = useRef<AuthorizationRequest | null>(null);
  const [storedKey, setStoredKey] = useState<{ owner: AuthFormsOwner; key: ClientCredentials | null; } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ school?: MessageKey; clientId?: MessageKey; token?: MessageKey; }>({});
  const schoolInput = useRef<ComponentRef<typeof TextInput>>(null);
  const clientIdInput = useRef<ComponentRef<typeof TextInput>>(null);
  const secretInput = useRef<ComponentRef<typeof TextInput>>(null);
  const tokenInput = useRef<ComponentRef<typeof TextInput>>(null);
  const methodTrigger = useRef<ComponentRef<typeof View>>(null);
  const otherWaysTrigger = useRef<ComponentRef<typeof View>>(null);
  const [sheetSource, setSheetSource] = useState<'method' | 'other'>('other');

  const owner = useAuthFormsLifetime(JSON.stringify([expired?.id, expired?.host, expired?.authMethod, addingAccount]));
  const [revision, setRevision] = useState(0);
  const eligible = () => owner.active && owner.revision === revision;

  const [stateOwner, setStateOwner] = useState(owner);
  if (stateOwner !== owner) {
    setStateOwner(owner);
    setRevision(0);
    setBusy(false);
    setPending(null);
    setEmbedded(null);
    setMessage(null);
    setMethod(expired?.authMethod === 'token' ? 'token' : 'browser');
    setFieldErrors({});
    setSheetOpen(false);
  }

  useLayoutEffect(() => {
    return () => {
      const done = embeddedDone.current;
      embeddedDone.current = null;
      done?.(null);
    };
  }, [owner]);

  // A delayed lookup may only supply the account it was requested for.
  const expiredId = expired?.id;
  useEffect(() => {
    let current = true;
    if (expiredId) storedClientCredentials(expiredId).then(
      (key) => { if (current) setStoredKey({ owner, key }); },
      () => { if (current) setStoredKey({ owner, key: null }); },
    );
    return () => { current = false; };
  }, [expiredId, owner]);

  const replaceForm = (inputEvent = false) => {
    if (!owner.active || (!inputEvent && !eligible())) return false;
    authFormsRetire(owner);
    setRevision(owner.revision);
    const done = embeddedDone.current;
    embeddedDone.current = null;
    done?.(null);
    setEmbedded(null);
    setPending(null);
    setBusy(false);
    return true;
  };

  const typed = useMemo(() => typedSchool(query), [query]);
  // Names get suggestions; an address (with a dot or port) is taken as typed.
  const suggestions = useMemo(
    () => (expired || selected || /[.:]/.test(query) ? [] : searchSchools(query)),
    [expired, selected, query],
  );
  // A single word like "harvard" could be a short name or a search. When the list has matches, ask.
  const ambiguous = !selected && suggestions.length > 0 && !!typed;
  const school: School | null = expired
    ? { name: expired.host, host: expired.host }
    : (selected ?? (ambiguous ? null : typed));
  const host = school ? normalizeHost(school.host) : null;

  const openSheet = (source: 'method' | 'other') => {
    if (!eligible() || owner.claimed) return;
    Keyboard.dismiss();
    setSheetSource(source);
    setSheetOpen(true);
  };

  const choose = (next: School) => {
    if (!replaceForm()) return;
    haptics.selection();
    setSelected(next);
    setQuery(next.name);
    setFieldErrors((previous) => ({ ...previous, school: undefined }));
    setMessage(null);
    Keyboard.dismiss();
  };

  const run = async (task: (operation: AuthFormsOperation) => Promise<void>) => {
    const operation = authFormsClaim(owner, revision);
    if (!operation) return;
    Keyboard.dismiss();
    setBusy(true);
    setMessage(null);
    try {
      await task(operation);
    } catch (error) {
      if (!operation.current()) return;
      if (error instanceof SignInCanceled) {
        setMessage({
          tone: 'info',
          title: 'authForms.canceled',
          text: 'authForms.canceledHelp',
        });
      } else {
        haptics.error();
        setMessage({
          tone: 'danger',
          title: 'authForms.failed',
          ...(error instanceof SignInError ? { raw: error.message } : { text: 'authForms.failedHelp' as const }),
        });
      }
    } finally {
      if (operation.current()) setBusy(false);
      if (!operation.waiting) operation.release();
    }
  };

  const save = async (signIn: PendingSignIn, operation: AuthFormsOperation) => {
    if (!operation.current()) return false;
    try {
      const account = await addAccount(signIn, { expectedAccountId: expired?.id, current: operation.current });
      if (!operation.current()) return false;
      haptics.success();
      onSignedIn?.(account);
      return true;
    } catch (error) {
      if (!(error instanceof ObsoleteSignInError)) throw error;
      return false;
    }
  };

  /** Refuses a different user when signing in again, then asks for terms if Canvas wants them. */
  const finish = async (signIn: PendingSignIn, operation: AuthFormsOperation) => {
    // Retirement releases only this local source; explicit rejection still ends SSO sessions.
    if (!operation.current()) return;
    if (expired && signIn.account.id !== expired.id) {
      await discardSignIn(signIn);
      throw new SignInError(wrongAccountMessage(signIn.account, expired));
    }
    const requiresTerms = await fetchRequiresTerms(signIn.client);
    if (!operation.current()) return;
    if (requiresTerms) {
      operation.waiting = true;
      setPending({ signIn, operation });
      return;
    }
    await save(signIn, operation);
  };

  const openEmbedded = (request: AuthorizationRequest) =>
    new Promise<string>((resolve, reject) => {
      embeddedRequest.current = request;
      embeddedDone.current = (url) => (url ? resolve(url) : reject(new SignInCanceled()));
      setEmbedded(request);
    });

  const authorize = (request: AuthorizationRequest) =>
    request.embedded ? openEmbedded(request) : authorizeInBrowser(request);

  const continueWithCanvas = () =>
    run(async (operation) => {
      if (!host || !school) return;
      let authHost = host;
      let key: ClientCredentials | null =
        method === 'key'
          ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() || null }
          : ((storedKey?.owner === owner ? storedKey?.key : null) ?? developerKeyFor(host.host));
      if (!key?.clientId) {
        const controller = new AbortController();
        const release = operation.onRetire(() => controller.abort());
        try {
          const discovered = await discoverMobileCredentials(host, controller.signal);
          if (!operation.current()) return;
          authHost = discovered.host;
          key = discovered.key;
        } catch (error) {
          if (error instanceof MobileVerifyError) throw new SignInError(error.message);
          throw error;
        } finally {
          release();
        }
      }
      await checkSchool(authHost);
      if (!operation.current()) return;
      const mode: LoginMode = method === 'key' || method === 'token' ? 'browser' : method;
      const options = {
        mode,
        authenticationProvider: school.authenticationProvider,
        forceLogin: !!addingAccount && !expired,
      };
      let request = await createAuthorization(authHost, key, options);
      if (!operation.current()) return;
      let callback = await authorize(request);
      if (!operation.current()) return;
      // Older Canvas doesn't know prompt=login. Ask again without it.
      if (options.forceLogin && callback.includes('error=unsupported_prompt_type')) {
        request = await createAuthorization(authHost, key, { ...options, forceLogin: false });
        if (!operation.current()) return;
        callback = await authorize(request);
        if (!operation.current()) return;
      }
      const code = codeFromCallback(callback, request);
      const source = createOAuthSource(authHost, key, operation.current);
      operation.onRetire(source.abandon);
      const tokens = await exchangeCode(request, code);
      source.capture(tokens);
      if (!operation.current()) return;
      await finish(await verifyOAuth(authHost, tokens, key, { source }), operation);
    });

  const signInWithToken = () =>
    run(async (operation) => {
      if (!host) return;
      await finish(await verifyToken(host.host, token), operation);
    });

  if (pending) {
    return (
      <Screen title={showTitle ? t('authForms.terms') : undefined} contentClassName="gap-6">
        <TermsStep
          key={pending.retry ?? 0}
          pending={pending.signIn}
          showHeading={!showTitle}
          onAccept={async () => {
            const { operation, signIn } = pending;
            if (!operation.claimAction()) return;
            try {
              if (!acceptedTerms.current.has(operation)) {
                await acceptTerms(signIn.client);
                acceptedTerms.current.add(operation);
              }
              if (await save(signIn, operation)) operation.release();
              else if (operation.current()) {
                // TermsStep claims successful callbacks. Remount after local admission refusal
                // so a still-current form can retry without submitting consent again.
                setPending({ ...pending, retry: (pending.retry ?? 0) + 1 });
              }
            } catch (error) {
              if (operation.current()) throw error;
            } finally {
              operation.endAction();
            }
          }}
          onDecline={async () => {
            const { operation, signIn } = pending;
            if (!operation.claimAction()) return;
            try {
              await discardSignIn(signIn);
              if (!operation.current()) return;
              setPending(null);
              setMessage({
                tone: 'info', title: 'authForms.notSignedIn',
                text: 'authForms.termsRequired', host: signIn.account.host,
              });
              operation.release();
            } catch (error) {
              if (operation.current()) throw error;
            } finally {
              operation.endAction();
            }
          }}
        />
      </Screen>
    );
  }

  const info = methods[method];
  const submit = method === 'token' ? signInWithToken : continueWithCanvas;
  const submitValidated = () => {
    if (!eligible() || owner.claimed) return;
    if (!host) {
      setFieldErrors({ school: 'authForms.schoolRequired' });
      schoolInput.current?.focus();
      return;
    }
    if (method === 'key' && !clientId.trim()) {
      setFieldErrors({ clientId: 'authForms.clientIdRequired' });
      clientIdInput.current?.focus();
      return;
    }
    if (method === 'token' && !token.trim()) {
      setFieldErrors({ token: 'authForms.tokenRequired' });
      tokenInput.current?.focus();
      return;
    }
    setFieldErrors({});
    void submit();
  };

  const intro = expired
    ? expired.authMethod === 'token'
      ? t('authForms.expiredToken', { name: expired.user.shortName })
      : t('authForms.expiredOAuth', { name: expired.user.shortName })
    : addingAccount
      ? t('authForms.introAdd')
      : t('authForms.intro');

  return (
    <>
      <Screen title={showTitle ? (expired ? t('authForms.signInAgain') : t('authForms.signIn')) : undefined} contentClassName="gap-6">
        <Text variant="body" tone="muted" className={showTitle ? '-mt-2' : undefined}>
          {intro}
        </Text>

        {expired ? (
          <Card variant="filled" className="flex-row items-center gap-3">
            <Avatar name={expired.user.name} uri={expired.user.avatarUrl} />
            <View className="flex-1">
              <Text variant="headline">
                {expired.user.name}
              </Text>
              <Text variant="subhead" tone="muted">
                {expired.host}
              </Text>
            </View>
          </Card>
        ) : (
          <View className="gap-3">
            <TextField
              ref={schoolInput}
              label={t('authForms.school')}
              placeholder={t('authForms.schoolPlaceholder')}
              leadingIcon={SchoolIcon}
              value={query}
              onChangeText={(text) => {
                if (!replaceForm(true)) return;
                setQuery(text);
                setSelected(null);
                setFieldErrors((previous) => ({ ...previous, school: undefined }));
                // Messages are about the school that was there before.
                setMessage(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              keyboardType={Platform.OS === 'ios' ? 'url' : 'default'}
              textContentType="URL"
              returnKeyType="go"
              onSubmitEditing={submitValidated}
              error={fieldErrors.school ? t(fieldErrors.school) : undefined}
              clearable
              helperText={
                ambiguous
                  ? t('authForms.chooseSchool')
                  : host && (selected || host.host !== query.trim().toLowerCase())
                    ? t('authForms.signingInTo', { host: host.host })
                    : undefined
              }
            />
            {suggestions.length > 0 ? (
              <ListGroup>
                {suggestions.map((s) => (
                  <ListItem
                    key={`${s.host}:${s.authenticationProvider ?? ''}`}
                    leading={<IconTile icon={SchoolIcon} tone="neutral" size="sm" />}
                    title={s.name}
                    subtitle={s.host}
                    subtitleLines={1}
                    chevron={false}
                    onPress={() => choose(s)}
                  />
                ))}
                {typed && !suggestions.some((s) => s.host === typed.host && !s.authenticationProvider) ? (
                  <ListItem
                    leading={<IconTile icon={Globe} tone="neutral" size="sm" />}
                    title={t('authForms.useHost', { host: typed.host })}
                    subtitle={t('authForms.address')}
                    subtitleLines={1}
                    chevron={false}
                    onPress={() => choose(typed)}
                  />
                ) : null}
              </ListGroup>
            ) : null}
          </View>
        )}

        {method !== 'browser' ? (
          <ListGroup>
            <ListItem
              ref={methodTrigger}
              leading={<IconTile icon={info.icon} tone="neutral" />}
              title={t(info.label)}
              subtitle={t(info.description)}
              accessibilityLabel={t('authForms.withMethod', { method: t(info.label) })}
              accessibilityHint={t('authForms.chooseMethod')}
              onPress={() => openSheet('method')}
              disabled={busy}
            />
          </ListGroup>
        ) : null}

        {method === 'key' ? (
          <View className="gap-4">
            <TextField
              ref={clientIdInput}
              label={t('authForms.clientId')}
              placeholder={t('authForms.clientIdPlaceholder')}
              value={clientId}
              onChangeText={(value) => {
                if (!replaceForm(true)) return;
                setClientId(value);
                setFieldErrors((previous) => ({ ...previous, clientId: undefined }));
              }}
              error={fieldErrors.clientId ? t(fieldErrors.clientId) : undefined}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              returnKeyType="next"
              onSubmitEditing={() => { if (eligible()) secretInput.current?.focus(); }}
            />
            <TextField
              ref={secretInput}
              label={t('authForms.clientSecret')}
              placeholder={t('authForms.secretPlaceholder')}
              value={clientSecret}
              onChangeText={(value) => { if (replaceForm(true)) setClientSecret(value); }}
              secureTextEntry
              textContentType="none"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={submitValidated}
              helperText={t('authForms.secretHelp')}
            />
          </View>
        ) : null}

        {method === 'token' ? (
          <TextField
            ref={tokenInput}
            label={t('authForms.token')}
            placeholder={t('authForms.tokenPlaceholder')}
            leadingIcon={KeyRound}
            value={token}
            onChangeText={(value) => {
              if (!replaceForm(true)) return;
              setToken(value);
              setFieldErrors((previous) => ({ ...previous, token: undefined }));
            }}
            error={fieldErrors.token ? t(fieldErrors.token) : undefined}
            secureTextEntry
            // A pasted API token, not a password: keep password managers out of it.
            textContentType="none"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={submitValidated}
          />
        ) : null}

        {message ? (
          <Callout tone={message.tone} title={t(message.title)}>
            {'raw' in message ? message.raw : t(message.text, { host: message.host ?? '' })}
          </Callout>
        ) : null}

        <View className="gap-2">
          <Button size="lg" loading={busy} onPress={submitValidated}>
            {method === 'token' ? t('authForms.signIn') : expired ? t('authForms.signInAgain') : t('authForms.continue')}
          </Button>
          {method === 'browser' ? (
            <Button ref={otherWaysTrigger} variant="ghost" onPress={() => openSheet('other')} disabled={busy}>
              {t('authForms.otherWays')}
            </Button>
          ) : null}
        </View>

        {method === 'token' ? <TokenHelp baseUrl={host?.baseUrl ?? null} /> : null}

        {footer}

        <Text variant="footnote" tone="muted" align="center" className="px-4">
          {t(Platform.OS === 'ios' ? 'authForms.privacyIos' : 'authForms.privacyAndroid')}
        </Text>
      </Screen>

      <Sheet visible={sheetOpen} title={t('authForms.otherWays')} onClose={() => { if (eligible()) setSheetOpen(false); }}
        returnFocusRef={sheetSource === 'method' ? methodTrigger : otherWaysTrigger}>
        <OptionGroup
          header={t('authForms.page')}
          options={pageMethods.map((value) => option(value, t))}
          selected={method}
          onSelect={(value) => {
            if (!replaceForm()) return;
            setMethod(value);
            setFieldErrors({});
            setMessage(null);
            setSheetOpen(false);
          }}
        />
        <OptionGroup
          header={t('authForms.credentials')}
          footer={t('authForms.credentialsHelp')}
          options={credentialMethods.map((value) => option(value, t))}
          selected={method}
          onSelect={(value) => {
            if (!replaceForm()) return;
            setMethod(value);
            setFieldErrors({});
            setMessage(null);
            setSheetOpen(false);
          }}
        />
      </Sheet>

      <EmbeddedSignIn
        request={embedded}
        onFinish={(url) => {
          if (!eligible() || !embedded || embeddedRequest.current !== embedded) return;
          embeddedRequest.current = null;
          setEmbedded(null);
          const done = embeddedDone.current;
          embeddedDone.current = null;
          done?.(url);
        }}
      />
    </>
  );
}
