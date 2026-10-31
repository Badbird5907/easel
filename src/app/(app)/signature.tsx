import { router, Stack, usePreventRemove } from 'expo-router';
import { Signature } from 'lucide-react-native';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import {
  type InboxSignature,
  SIGNATURE_MAX,
  useInboxSignature,
  useSaveSignature,
} from '@/canvas/api/conversations';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  haptics,
  ListGroup,
  ListItem,
  Screen,
  Skeleton,
  Switch,
  Text,
  TextField,
} from '@/design';

import { useCanvas } from '@/canvas/session';
import { isOnline } from '@/features/offline/connectivity';
import { useOnline } from '@/features/offline/useOnline';
import {
  type SignatureRun,
  useSettingsSignatureOwner,
} from '@/features/settings/settingsSignatureLifetime';
import { formatNumber, useTranslation } from '@/i18n';

type Available = Extract<InboxSignature, { available: true }>;

function SignatureForm({ current, ready }: { current: Available; ready: boolean }) {
  const { t, locale } = useTranslation();
  const online = useOnline();
  const { account, client } = useCanvas();
  const identity = useMemo(
    () => ({ accountId: account.id, userId: account.user.id, client }),
    [account.id, account.user.id, client],
  );
  const editOwner = useSettingsSignatureOwner(identity, ready);
  const writeOwner = useSettingsSignatureOwner(identity, ready && online);
  // Query changes retire old confirmations, but cached unsaved text still needs
  // a current discard decision while writes are unavailable.
  const discardIdentity = useMemo(() => ({ identity, ready }), [identity, ready]);
  const discardOwner = useSettingsSignatureOwner(discardIdentity);
  // Same-resource query refreshes keep drafts and in-flight saves alive (including
  // the save API's own invalidation). Retained actions use committed settings.
  const committed = useRef(current);
  useLayoutEffect(() => {
    committed.current = current;
  }, [current]);
  const save = useSaveSignature();
  const [draft, setDraft] = useState({ enabled: current.enabled, text: current.text });
  // Read/write only in events, never while rendering: native callbacks can fire
  // again before React publishes a new set of props.
  const liveDraft = useRef(draft);
  const claims = useRef<{ write?: SignatureRun; discard?: SignatureRun; leaving?: boolean }>({});
  const [activity, setActivity] = useState<SignatureRun | null>(null);
  const [notice, setNotice] = useState<{ run: SignatureRun; error: Error } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const { enabled, text } = draft;
  const dirty = !leaving && (enabled !== current.enabled || text.trim() !== current.text.trim());
  const missingText = enabled && !text.trim();
  const pending = !!activity?.current();
  const error = notice?.run.current() ? notice.error : null;

  const change = (patch: Partial<typeof draft>) => {
    if (!editOwner.current() || claims.current.leaving || claims.current.write?.current()) return;
    const next = { ...liveDraft.current, ...patch };
    if (next.text === liveDraft.current.text && next.enabled === liveDraft.current.enabled) return;
    liveDraft.current = next;
    claims.current.discard = undefined;
    setDraft(next);
    setNotice(null);
  };
  const allowLeave = usePreventRemove(dirty, ({ repeat }) => {
    if (!discardOwner.current() || claims.current.leaving || claims.current.discard?.current()) return;
    const source = liveDraft.current;
    const valid = discardOwner.capture();
    const run: SignatureRun = {
      current: () => valid() && liveDraft.current === source && claims.current.discard === run,
    };
    claims.current.discard = run;
    const cancel = () => {
      if (claims.current.discard === run) claims.current.discard = undefined;
    };
    Alert.alert(
      t('settingsSignature.discardTitle'),
      t('settingsSignature.discardBody'),
      [
        { text: t('settingsSignature.keepEditing'), style: 'cancel', onPress: cancel },
        {
          text: t('settingsSignature.discard'),
          style: 'destructive',
          onPress: () => {
            if (!run.current() || claims.current.leaving) return;
            cancel();
            claims.current.leaving = true;
            setLeaving(true);
            repeat();
          },
        },
      ],
      { onDismiss: cancel },
    );
  });

  const submit = async () => {
    if (
      !writeOwner.current() ||
      !isOnline() ||
      claims.current.leaving ||
      claims.current.write?.current()
    )
      return;
    const source = liveDraft.current;
    const baseline = committed.current;
    if (
      (source.enabled && !source.text.trim()) ||
      (source.enabled === baseline.enabled && source.text.trim() === baseline.text.trim())
    )
      return;
    const valid = writeOwner.capture();
    const run: SignatureRun = {
      current: () =>
        valid() &&
        liveDraft.current === source &&
        claims.current.write === run &&
        !claims.current.leaving,
    };
    claims.current.write = run;
    claims.current.discard = undefined;
    setActivity(run);
    setNotice(null);
    try {
      const result = save.mutateAsync({ ...source, settings: baseline.settings });
      // Preserve the originating account's mutation options through later renders.
      // reset detaches the observer; it does not cancel an entered Canvas write.
      save.reset();
      await result;
      if (!run.current()) return;
      haptics.success();
      claims.current.leaving = true;
      setLeaving(true);
      allowLeave();
      router.back();
    } catch (failure) {
      if (!run.current()) return;
      setNotice({ run: { current: valid }, error: failure as Error });
      haptics.error();
    } finally {
      if (claims.current.write === run) {
        if (run.current()) setActivity(null);
        claims.current.write = undefined;
      }
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Button
              size="sm"
              disabled={!dirty || missingText || !ready || !online || pending}
              loading={pending}
              onPress={submit}
              className="me-2"
            >
              {t('settingsSignature.save')}
            </Button>
          ),
        }}
      />
      {error ? (
        <Callout tone="danger" title={t('settingsSignature.saveFailed')}>
          {error.message}
        </Callout>
      ) : null}
      <ListGroup footer={t('settingsSignature.help')}>
        <ListItem
          title={t('settingsSignature.toggle')}
          chevron={false}
          disabled={pending || !ready}
          accessibilityRole="switch"
          accessibilityState={{ checked: enabled, disabled: pending || !ready }}
          onPress={() => change({ enabled: !liveDraft.current.enabled })}
          trailing={
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Switch
                value={enabled}
                onValueChange={(value) => change({ enabled: value })}
                disabled={pending || !ready}
              />
            </View>
          }
        />
      </ListGroup>
      <TextField
        label={t('settingsSignature.label')}
        value={text}
        onChangeText={(value) => change({ text: value })}
        onSubmitEditing={submit}
        multiline
        maxLength={SIGNATURE_MAX}
        placeholder={t('settingsSignature.placeholder')}
        editable={!pending && ready}
        error={missingText ? t('settingsSignature.missingText') : null}
        helperText={t('settingsSignature.count', {
          used: formatNumber(text.length, undefined, locale),
          max: formatNumber(SIGNATURE_MAX, undefined, locale),
        })}
      />
      {enabled && text.trim() ? (
        <Card className="gap-2">
          <Text variant="subhead" weight="semibold" tone="muted">
            {t('settingsSignature.preview')}
          </Text>
          <Text variant="body" tone="muted">
            {t('settingsSignature.message')}
          </Text>
          <View className="gap-1">
            <Text variant="body" tone="subtle">
              ---
            </Text>
            <Text variant="body">{text.trim()}</Text>
          </View>
        </Card>
      ) : null}
      <Text variant="footnote" tone="muted" className="px-1">
        {t('settingsSignature.canvasHelp')}
      </Text>
    </>
  );
}

/** The inbox signature (INBOX-7, SET-7), stored in Canvas's inbox settings. */
export default function SignatureScreen() {
  const { t } = useTranslation();
  const { account, client } = useCanvas();
  const signature = useInboxSignature();
  // Key the form (including its mutation observer) by account and client, but
  // never by language or query data: refetches must not erase unsaved text.
  const [context, setContext] = useState({ client, generation: 0 });
  if (context.client !== client) setContext({ client, generation: context.generation + 1 });
  const identity = useMemo(
    () => ({
      client,
      accountId: account.id,
      userId: account.user.id,
      data: signature.data,
      error: signature.error,
    }),
    [client, account.id, account.user.id, signature.data, signature.error],
  );
  const retryOwner = useSettingsSignatureOwner(identity, signature.isError);
  const retrying = useRef<SignatureRun | null>(null);
  const retry = async () => {
    if (!retryOwner.current() || retrying.current?.current()) return;
    const run = { current: retryOwner.capture() };
    retrying.current = run;
    try {
      await signature.refetch();
    } catch {
      /* Query owns failure presentation. */
    } finally {
      if (retrying.current === run) retrying.current = null;
    }
  };
  return (
    <>
      <Stack.Screen options={{ title: t('settingsSignature.title') }} />
      <Screen automaticallyAdjustKeyboardInsets contentClassName="gap-5">
        {signature.isError ? (
          <Callout
            tone="danger"
            title={t('settingsSignature.loadFailed')}
            action={{ label: t('settingsSignature.retry'), onPress: retry }}
          >
            {signature.error.message}
          </Callout>
        ) : null}
        {signature.data?.available ? (
          <SignatureForm
            key={`${account.id}:${account.user.id}:${context.generation}`}
            current={signature.data}
            ready={!signature.isError && !signature.isPending}
          />
        ) : signature.isPending ? (
          <View className="gap-3" accessibilityLabel={t('settingsSignature.loading')}>
            <Skeleton className="h-14 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </View>
        ) : !signature.isError ? (
          <Card padding="none">
            <EmptyState
              icon={Signature}
              title={t('settingsSignature.unavailable')}
              description={t('settingsSignature.unavailableHelp')}
            />
          </Card>
        ) : null}
      </Screen>
    </>
  );
}
