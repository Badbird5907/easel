import { router, Stack } from 'expo-router';
import { Camera, ExternalLink, Image as ImageIcon } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, View } from 'react-native';

import {
  type Profile,
  type ProfileUpdate,
  PronounsNotOfferedError,
  useProfile,
  useUpdateProfile,
  useUploadAvatar,
} from '@/canvas/api/profile';
import type { LocalFile } from '@/canvas/uploads';
import {
  Avatar,
  Button,
  Callout,
  Card,
  haptics,
  ListGroup,
  ListItem,
  OptionGroup,
  ProgressRing,
  Screen,
  Sheet,
  Skeleton,
  Text,
  TextField,
  useToast,
} from '@/design';
import { useCanvas } from '@/canvas/session';
import { openProfileWebsite } from '@/features/settings/profileFormsBrowser';
import {
  ProfileFormsProgress,
  useProfileFormsOwner,
} from '@/features/settings/profileFormsLifetime';
import { LoadError } from '@/features/course/states';
import { useActionSheet } from '@/features/files/ActionSheet';
import { PickerPermissionError, PickerUnavailableError } from '@/features/files/upload';
import { useOnline } from '@/features/offline/useOnline';
import { type MessageKey, useTranslation } from '@/i18n';
import { pickAvatar } from '@/features/settings/avatar';

/** Canvas's built-in pronoun options (lib/pronouns.rb). Schools can add their own. */
const defaultPronouns = ['She/Her', 'He/Him', 'They/Them'];
const NO_PRONOUNS = 'none';

function ProfileSkeleton() {
  return (
    <View className="gap-6">
      <View className="items-center gap-3">
        <Skeleton className="h-[72px] w-[72px] rounded-full" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-28" />
      </View>
      <Card className="gap-4">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </Card>
    </View>
  );
}

function ProfileForm({ profile, ready }: { profile: Profile; ready: boolean }) {
  const { t, locale } = useTranslation();
  const { account, client } = useCanvas();
  const online = useOnline();
  const toast = useToast();
  const { show, sheet } = useActionSheet();
  const canEditName = profile.canEditName;
  const canEditAvatar = profile.canEditAvatar;
  const identity = useMemo(
    () => ({
      accountId: account.id,
      userId: account.user.id,
      client,
      profile,
      canEditName,
      canEditAvatar,
    }),
    [account.id, account.user.id, client, profile, canEditName, canEditAvatar],
  );
  const owner = useProfileFormsOwner(identity, online && ready);
  const editOwner = useProfileFormsOwner(identity);
  const editCurrent = editOwner.current;
  const current = owner.current;
  type Run = { current: () => boolean };
  const claims = useRef<{ write?: Run; picture?: Run; browser?: Run }>({});
  const revisions = useRef<Partial<Record<keyof typeof claims.current, object>>>({});
  const claim = (kind: keyof typeof claims.current): Run | null => {
    if (!current() || claims.current[kind]?.current()) return null;
    const valid = owner.capture();
    const token = {};
    revisions.current[kind] = token;
    const run = { current: () => valid() && revisions.current[kind] === token };
    claims.current[kind] = run;
    return run;
  };
  const release = (kind: keyof typeof claims.current, run: Run) => {
    if (claims.current[kind] === run) delete claims.current[kind];
  };
  const update = useUpdateProfile();
  const [activity, setActivity] = useState<{
    run: Run;
    kind: 'name' | 'pronouns';
    pronouns?: string;
  } | null>(null);
  const [picture, setPicture] = useState<{ run: Run; progress: number | null } | null>(null);
  // Each committed mutation configuration has its own sink. Publish after
  // useMutation's options effect; a picker may outlive several locale renders.
  const progressSink = new ProfileFormsProgress(setPicture);
  const upload = useUploadAvatar((progress) => progressSink.report(progress));
  const uploadEntry = useRef<{ upload: typeof upload; progress: ProfileFormsProgress } | null>(
    null,
  );
  useEffect(() => {
    uploadEntry.current = { upload, progress: progressSink };
    return () => {
      uploadEntry.current = null;
    };
  });
  const [name, setName] = useState(profile.name);
  const [shortName, setShortName] = useState(profile.shortName);
  const [pronounsOpen, setPronounsOpen] = useState(false);
  const [notice, setNotice] = useState<{
    run: Run;
    title: MessageKey;
    error?: Error;
    body?: MessageKey;
  } | null>(null);
  const nameChanged = name.trim() !== profile.name || shortName.trim() !== profile.shortName;
  const nameError = !name.trim() ? t('profileForms.nameRequired') : null;
  const defaults = ['profileForms.sheHer', 'profileForms.heHim', 'profileForms.theyThem'] as const;
  const pronounOptions = [
    { value: NO_PRONOUNS, label: t('profileForms.none') },
    ...[...new Set([...defaultPronouns, ...(profile.pronouns ? [profile.pronouns] : [])])].map(
      (p) => ({
        value: `value:${p}`,
        // Supplied strings remain raw, even if they collide with authored labels.
        label:
          p === profile.pronouns || !defaultPronouns.includes(p)
            ? p
            : t(defaults[defaultPronouns.indexOf(p)]),
      }),
    ),
  ];
  const activeWrite = activity?.run.current() ? activity : null;
  const pronouns =
    activeWrite?.pronouns !== undefined ? activeWrite.pronouns || null : profile.pronouns;

  const write = async (patch: ProfileUpdate, kind: 'name' | 'pronouns') => {
    const run = claim('write');
    if (!run) return;
    setNotice(null);
    setActivity({ run, kind, pronouns: patch.pronouns });
    try {
      const pending = update.mutateAsync(patch);
      update.reset();
      await pending;
      if (!run.current()) return;
      haptics.success();
      toast.show(
        kind === 'name'
          ? t('profileForms.nameSaved')
          : patch.pronouns
            ? t('profileForms.pronounsSet', { pronouns: patch.pronouns })
            : t('profileForms.pronounsRemoved'),
      );
    } catch (error) {
      if (!run.current()) return;
      haptics.error();
      setNotice({
        run,
        title: kind === 'name' ? 'profileForms.nameFailed' : 'profileForms.pronounsFailed',
        ...(error instanceof PronounsNotOfferedError
          ? { body: 'profileForms.pronounsNotOffered' as const }
          : { error: error as Error }),
      });
    } finally {
      release('write', run);
      if (run.current()) setActivity(null);
    }
  };
  const saveName = () => {
    if (!current() || !profile.canEditName || nameError || !nameChanged) return;
    const patch: ProfileUpdate = {};
    if (name.trim() !== profile.name) patch.name = name.trim();
    if (shortName.trim() !== profile.shortName) patch.short_name = shortName.trim() || name.trim();
    void write(patch, 'name');
  };
  const savePronouns = (value: string) => {
    if (
      !current() ||
      claims.current.write?.current() ||
      !pronounOptions.some((o) => o.value === value)
    )
      return;
    setPronounsOpen(false);
    const next = value === NO_PRONOUNS ? '' : value.slice('value:'.length);
    if (next !== (profile.pronouns ?? '')) void write({ pronouns: next }, 'pronouns');
  };
  const pick = async (source: 'camera' | 'library') => {
    if (!profile.canEditAvatar) return;
    const run = claim('picture');
    if (!run) return;
    try {
      const file: LocalFile | null = await pickAvatar(source, run.current);
      if (!file || !run.current()) return;
      const entry = uploadEntry.current;
      if (!entry) return;
      setNotice(null);
      setPicture({ run, progress: 0 });
      entry.progress.start(run);
      try {
        const pending = entry.upload.mutateAsync({ file, isCurrent: run.current });
        entry.upload.reset();
        await pending;
        if (run.current()) {
          haptics.success();
          toast.show(t('profileForms.pictureUpdated'));
        }
      } catch (error) {
        if (run.current()) {
          haptics.error();
          setNotice({ run, title: 'profileForms.pictureFailed', error: error as Error });
        }
      } finally {
        entry.progress.finish();
      }
    } catch (error) {
      if (!run.current()) return;
      if (error instanceof PickerPermissionError) {
        let used = false;
        Alert.alert(
          t('profileForms.cameraOff'),
          error.origin === 'camera-permission' ? t('profileForms.cameraPermission') : error.message,
          [
            {
              text: t('profileForms.notNow'),
              style: 'cancel',
              onPress: () => {
                used = true;
              },
            },
            {
              text: t('profileForms.openSettings'),
              onPress: () => {
                if (used || !run.current()) return;
                used = true;
                void Linking.openSettings().catch(() => {});
              },
            },
          ],
        );
      } else if (error instanceof PickerUnavailableError) {
        setNotice({
          run,
          title: 'profileForms.noCamera',
          ...(error.origin === 'camera-unavailable'
            ? { body: 'profileForms.cameraUnavailable' as const }
            : { error }),
        });
      } else setNotice({ run, title: 'profileForms.photosFailed', error: error as Error });
    } finally {
      release('picture', run);
      if (run.current()) setPicture(null);
    }
  };
  const menu = useRef<object | null>(null);
  const choosePicture = () => {
    if (!current() || !profile.canEditAvatar || claims.current.picture?.current()) return;
    const token = {};
    menu.current = token;
    const menuCurrent = owner.capture();
    let used = false;
    const choose = (source: 'camera' | 'library') => {
      if (used || menu.current !== token || !menuCurrent()) return;
      used = true;
      void pick(source);
    };
    show({
      title: t('profileForms.changePictureTitle'),
      onClose: (selected) => {
        if (!selected && menu.current === token) menu.current = null;
      },
      options: [
        {
          key: 'camera',
          label: t('profileForms.takePhoto'),
          icon: Camera,
          onPress: () => choose('camera'),
        },
        {
          key: 'library',
          label: t('profileForms.chooseLibrary'),
          icon: ImageIcon,
          onPress: () => choose('library'),
        },
      ],
      presentation: (translate) => ({
        title: translate('profileForms.changePictureTitle'),
        options: [translate('profileForms.takePhoto'), translate('profileForms.chooseLibrary')],
      }),
    });
  };
  const editBio = async () => {
    const run = claim('browser');
    if (!run) return;
    try {
      await openProfileWebsite(client, run.current);
    } catch (error) {
      if (run.current()) setNotice({ run, title: 'profileForms.webFailed', error: error as Error });
    } finally {
      release('browser', run);
    }
  };
  const uploading = !!picture?.run.current();
  const progress = uploading ? (picture?.progress ?? null) : null;
  const visibleNotice = notice?.run.current() ? notice : null;

  return (
    <View className="flex-1 bg-bg">
      <Screen contentClassName="gap-6">
        <View className="items-center gap-3">
          <View>
            <Avatar name={profile.name} uri={profile.avatarUrl} size="xl" />
            {uploading ? (
              <View
                className="absolute inset-0 items-center justify-center rounded-full bg-overlay/40"
                accessibilityLabel={
                  progress === null
                    ? t('profileForms.uploadingPicture')
                    : t('profileForms.uploadProgress', {
                        percent: new Intl.NumberFormat(locale).format(Math.round(progress * 100)),
                      })
                }
              >
                <ProgressRing value={progress ?? 0} size={40} />
              </View>
            ) : null}
          </View>
          <View className="items-center gap-0.5">
            <Text variant="title2" align="center" accessibilityRole="header">
              {profile.name}
            </Text>
            {profile.pronouns || profile.email ? (
              <Text variant="subhead" tone="muted" align="center">
                {[profile.pronouns, profile.email].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
          {profile.canEditAvatar ? (
            <Button
              variant="tonal"
              size="sm"
              leadingIcon={Camera}
              disabled={uploading || !online || !ready}
              onPress={choosePicture}
            >
              {uploading ? t('profileForms.uploading') : t('profileForms.changePicture')}
            </Button>
          ) : (
            <Text variant="footnote" tone="muted" align="center">
              {t('profileForms.pictureManaged')}
            </Text>
          )}
        </View>

        {visibleNotice ? (
          <Callout tone="danger" title={t(visibleNotice.title)}>
            {visibleNotice.body ? t(visibleNotice.body) : visibleNotice.error?.message}
          </Callout>
        ) : null}

        <View className="gap-2">
          <Card className="gap-4">
            <TextField
              label={t('profileForms.fullName')}
              value={name}
              onChangeText={(value) => {
                if (editCurrent() && profile.canEditName) setName(value);
              }}
              editable={profile.canEditName}
              autoComplete="name"
              textContentType="name"
              error={nameChanged ? nameError : null}
              returnKeyType="next"
            />
            <TextField
              label={t('profileForms.displayName')}
              value={shortName}
              onChangeText={(value) => {
                if (editCurrent() && profile.canEditName) setShortName(value);
              }}
              editable={profile.canEditName}
              autoComplete="name"
              helperText={t('profileForms.displayNameHelp')}
              returnKeyType="done"
              onSubmitEditing={() => nameChanged && saveName()}
            />
            {profile.canEditName ? (
              <Button
                disabled={!nameChanged || !!nameError || !online || !ready || !!activeWrite}
                loading={activeWrite?.kind === 'name'}
                onPress={saveName}
              >
                {t('profileForms.saveName')}
              </Button>
            ) : null}
          </Card>
          {!profile.canEditName ? (
            <Text variant="footnote" tone="muted" className="px-4">
              {t('profileForms.nameManaged')}
            </Text>
          ) : null}
        </View>

        <ListGroup>
          <ListItem
            title={t('portfolios.title')}
            subtitle={t('portfolios.profileSubtitle')}
            onPress={() => {
              if (editCurrent()) router.push('/eportfolios' as never);
            }}
          />
        </ListGroup>

        <ListGroup footer={t('profileForms.pronounsHelp')}>
          <ListItem
            title={t('profileForms.pronouns')}
            value={pronouns ?? t('profileForms.none')}
            disabled={!online || !ready || !!activeWrite}
            onPress={() => {
              if (current() && !claims.current.write?.current()) setPronounsOpen(true);
            }}
          />
        </ListGroup>

        <View className="gap-2">
          <Text variant="overline" tone="muted" className="px-4">
            {t('profileForms.bio')}
          </Text>
          <Card className="gap-3">
            <Text variant="body" tone={profile.bio ? 'default' : 'muted'}>
              {profile.bio ?? t('profileForms.noBio')}
            </Text>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              leadingIcon={ExternalLink}
              disabled={!online || !ready}
              onPress={editBio}
            >
              {t('profileForms.editWeb')}
            </Button>
          </Card>
          <Text variant="footnote" tone="muted" className="px-4">
            {t('profileForms.bioHelp')}
          </Text>
        </View>
      </Screen>

      <Sheet
        visible={pronounsOpen}
        title={t('profileForms.pronouns')}
        onClose={() => {
          if (editCurrent()) setPronounsOpen(false);
        }}
      >
        <OptionGroup
          options={pronounOptions}
          selected={pronouns ? `value:${pronouns}` : NO_PRONOUNS}
          onSelect={savePronouns}
        />
      </Sheet>
      {sheet}
      {toast.element}
    </View>
  );
}

/** Profile (SET-6): picture, name, pronouns, and bio, as far as the school lets students change them. */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const { account, client } = useCanvas();
  const profile = useProfile();
  // A replaced client must also replace hook observers and local drafts. This
  // render-local state adjustment never changes a live ownership ref.
  const [context, setContext] = useState({ client, generation: 0 });
  if (context.client !== client) setContext({ client, generation: context.generation + 1 });
  const identity = useMemo(
    () => ({
      client,
      accountId: account.id,
      userId: account.user.id,
      data: profile.data,
      error: profile.error,
    }),
    [client, account.id, account.user.id, profile.data, profile.error],
  );
  const owner = useProfileFormsOwner(identity);
  const current = owner.current;
  const retrying = useRef(false);
  const retry = async () => {
    if (!current() || retrying.current) return;
    retrying.current = true;
    try {
      await profile.refetch();
    } catch {
      /* Query owns failure presentation. */
    } finally {
      retrying.current = false;
    }
  };
  return (
    <>
      <Stack.Screen options={{ title: t('profileForms.title') }} />
      {profile.data ? (
        <ProfileForm
          key={`${account.id}:${account.user.id}:${context.generation}:${profile.data.id}`}
          profile={profile.data}
          ready={!profile.isError}
        />
      ) : (
        <Screen contentClassName="gap-6">
          {profile.isError ? (
            <LoadError title={t('profileForms.loadFailed')} error={profile.error} onRetry={retry} />
          ) : (
            <ProfileSkeleton />
          )}
        </Screen>
      )}
    </>
  );
}
