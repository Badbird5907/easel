import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Clapperboard, FileAudio, Mic, RefreshCw, Video } from 'lucide-react-native';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, View } from 'react-native';

import type { Assignment } from '@/canvas/api/assignments';
import { submissionFilesPath, useMediaService } from '@/canvas/api/submissions';
import { useCanvas } from '@/canvas/session';
import type { LocalFile } from '@/canvas/uploads';
import { Button, Callout, haptics, IconTile, ListGroup, ListItem, Text, useTheme } from '@/design';
import { useTranslation } from '@/i18n';
import { describeFile } from '@/features/files/kinds';
import {
  PickerPermissionError,
  PickerUnavailableError,
  recordVideo,
  timestampName,
} from '@/features/files/upload';

import { AudioRecorderSheet } from './AudioRecorderSheet';
import { MediaPlayer } from './MediaPlayer';
import { checkExtensions } from './rules';
import { mediaErrorDetail, mediaNoticeText, type MediaNotice } from './mediaPanelPresentation';
import { UploadList } from './UploadList';
import {
  addUploads,
  removeUpload,
  uploadsFor,
  type UploadItem,
  type UploadTarget,
} from './uploadStore';

/**
 * How a media recording gets to Canvas (ASSIGN-6):
 * - `kaltura`: the school's media service takes it as a `media_recording`.
 * - `file`: no media service, but the assignment takes uploads, so the recording goes in as a file.
 * - `unavailable`: neither, so the recording can't be turned in from any app.
 */
export type MediaMode = 'checking' | 'unknown' | 'kaltura' | 'file' | 'unavailable';

export function useMediaMode(a: Assignment): { mode: MediaMode; retry: () => void } {
  const wants = a.submissionTypes.includes('media_recording');
  const service = useMediaService();
  const retry = () => {
    service.refetch();
  };
  if (!wants) return { mode: 'unavailable', retry };
  if (service.isPending) return { mode: 'checking', retry };
  if (service.isError) return { mode: 'unknown', retry };
  if (service.data.enabled) return { mode: 'kaltura', retry };
  return { mode: a.submissionTypes.includes('online_upload') ? 'file' : 'unavailable', retry };
}

/** Where a recording uploads for each mode. */
export function mediaTarget(
  a: Assignment,
  mode: MediaMode,
  client: UploadTarget['client'],
): UploadTarget | null {
  if (mode === 'kaltura') return { client, media: { contextCode: `course_${a.courseId}` } };
  if (mode === 'file') return { client, preflightPath: submissionFilesPath(a.courseId, a.id) };
  return null;
}

/** A video from the library: library videos only, kept in their original format. */
async function pickVideo(): Promise<LocalFile | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: false,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const mime = asset.mimeType ?? 'video/mp4';
  return {
    uri: asset.uri,
    name: asset.fileName ?? timestampName('Video', mime === 'video/quicktime' ? 'mov' : 'mp4'),
    size: asset.fileSize ?? null,
    mimeType: mime,
  };
}

/** An audio or video file from Files. */
async function pickMediaFile(): Promise<LocalFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['audio/*', 'video/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = picked.canceled ? null : picked.assets[0];
  return asset
    ? { uri: asset.uri, name: asset.name, size: asset.size ?? null, mimeType: asset.mimeType ?? null }
    : null;
}

const kindOf = (file: LocalFile): 'audio' | 'video' =>
  describeFile({ name: file.name, contentType: file.mimeType ?? undefined }).kind === 'audio'
    ? 'audio'
    : 'video';

/** Record audio or video, or pick a video, for a media submission (ASSIGN-6). */
export function MediaPanel({
  a,
  slot,
  items,
  mode,
  onRetryCheck,
  disabled,
}: {
  a: Assignment;
  slot: string;
  items: UploadItem[];
  mode: MediaMode;
  onRetryCheck: () => void;
  disabled?: boolean;
}) {
  const { t, locale } = useTranslation();
  const { account, client } = useCanvas();
  const { colors } = useTheme();
  // Only submission identity and relevant eligibility belong to the lifetime. Refetched
  // assignment objects, progress, labels and locale must not restart an open recorder.
  const contextKey = JSON.stringify([
    account.id,
    a.courseId,
    a.id,
    a.submission?.id,
    a.submission?.attempt,
    slot,
    mode,
    a.allowedExtensions,
    a.submissionTypes,
    a.locked,
    a.canSubmit,
    a.allowedAttempts,
    a.submission?.extraAttempts,
    a.lockAt?.getTime(),
  ]);
  const context = useMemo(() => ({ contextKey, client }), [contextKey, client]);
  const live = useRef<{
    context: object;
    disabled: boolean;
    operation: object | null;
    latest: object | null;
    notice: MediaNotice | null;
    t: typeof t;
    retry: () => void;
  } | null>(null);
  const [recording, setRecording] = useState<{ context: object; operation: object } | null>(null);
  const [feedback, setFeedback] = useState<{ context: object; notice: MediaNotice } | null>(null);
  useLayoutEffect(() => {
    live.current = {
      context,
      disabled: !!disabled,
      operation: null,
      latest: null,
      notice: null,
      t,
      retry: onRetryCheck,
    };
    return () => {
      live.current = null;
    };
    // Presentation/disabled updates below do not replace the context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);
  useLayoutEffect(() => {
    const state = live.current;
    if (!state || state.context !== context) return;
    if (disabled && !state.disabled) {
      state.operation = null;
      state.latest = null;
      setRecording(null);
    }
    state.disabled = !!disabled;
    state.t = t;
    state.retry = onRetryCheck;
  }, [context, disabled, t, onRetryCheck]);
  const current = () => {
    const state = live.current;
    return state?.context === context && !state.disabled ? state : null;
  };
  const eligible = () =>
    !a.locked &&
    a.canSubmit !== false &&
    a.submissionTypes.includes('media_recording') &&
    (a.allowedAttempts === null ||
      (a.submission?.attempt ?? 0) < a.allowedAttempts + (a.submission?.extraAttempts ?? 0)) &&
    (!a.lockAt || a.lockAt.getTime() >= Date.now());
  const publish = (notice: MediaNotice | null) => {
    const state = current();
    if (!state) return;
    state.notice = notice;
    setFeedback(notice ? { context, notice } : null);
  };
  const claim = () => {
    const state = current();
    if (
      !state ||
      state.operation ||
      !eligible() ||
      (mode !== 'file' && mode !== 'kaltura') ||
      uploadsFor(slot).length
    )
      return null;
    const operation = {};
    state.operation = operation;
    state.latest = operation;
    return operation;
  };
  const owns = (operation: object) => {
    const state = current();
    return !!state && state.operation === operation && eligible() && !uploadsFor(slot).length;
  };
  const finish = (operation: object) => {
    if (live.current?.context === context && live.current.operation === operation)
      live.current.operation = null;
  };
  const take = (file: LocalFile | null, operation: object) => {
    if (!owns(operation) || !file) return;
    const target = mediaTarget(a, mode, client);
    if (!target) return;
    if (mode === 'file' && checkExtensions([file], a.allowedExtensions).rejected.length) {
      publish({ reason: 'extensions', extensions: [...a.allowedExtensions], name: file.name });
      haptics.warning();
      return;
    }
    publish(null);
    // The picker was offered only for an empty slot, which must still be empty.
    // Never clear a slot here: another producer may have added a newer upload.
    addUploads(slot, target, [file]);
  };
  const guard = async (pick: () => Promise<LocalFile | null>) => {
    const operation = claim();
    if (!operation) return;
    const snapshotT = current()!.t;
    try {
      take(await pick(), operation);
    } catch (error) {
      if (!owns(operation)) return;
      if (error instanceof PickerPermissionError) {
        let settingsUsed = false;
        Alert.alert(
          snapshotT('mediaSubmission.permissionTitle'),
          error.origin === 'camera-permission'
            ? snapshotT('mediaSubmission.permissionBody')
            : error.message,
          [
            { text: snapshotT('mediaSubmission.notNow'), style: 'cancel' },
            {
              text: snapshotT('mediaSubmission.settings'),
              onPress: async () => {
                const valid = () =>
                  current()?.latest === operation && eligible() && !uploadsFor(slot).length;
                if (settingsUsed || !valid()) return;
                settingsUsed = true;
                try {
                  await Linking.openSettings();
                } catch (failure) {
                  if (valid()) publish({ reason: 'settings', detail: mediaErrorDetail(failure) });
                }
              },
            },
          ],
        );
      } else if (error instanceof PickerUnavailableError) {
        publish({ reason: 'unavailable', detail: error.message, origin: error.origin });
      } else {
        publish({ reason: 'picker', detail: mediaErrorDetail(error) });
      }
    } finally {
      finish(operation);
    }
  };
  const notice = feedback?.context === context ? feedback.notice : null;
  const recorder = recording?.context === context ? recording : null;

  if (mode === 'checking')
    return (
      <View className="flex-row items-center gap-3 px-1 py-2" accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.fgMuted} />
        <Text variant="subhead" tone="muted">
          {t('mediaSubmission.checking')}
        </Text>
      </View>
    );

  if (mode === 'unknown')
    return (
      <Callout
        tone="warning"
        title={t('mediaSubmission.unknownTitle')}
        action={{
          label: t('mediaSubmission.retry'),
          onPress: () => {
            const state = current();
            if (!state || state.operation) return;
            const operation = {};
            state.operation = operation;
            try {
              state.retry();
            } finally {
              void Promise.resolve().then(() => finish(operation));
            }
          },
        }}
      >
        {t('mediaSubmission.unknownBody')}
      </Callout>
    );

  if (mode === 'unavailable')
    return (
      <Callout tone="warning" title={t('mediaSubmission.unavailableTitle')}>
        {t('mediaSubmission.unavailableBody')}
      </Callout>
    );

  const item = items[0];
  return (
    <View className="gap-3">
      {mode === 'file' ? (
        <Callout tone="info" title={t('mediaSubmission.fileTitle')}>
          {t('mediaSubmission.fileBody')}
        </Callout>
      ) : null}
      {notice ? (
        <Callout
          tone="warning"
          title={t('mediaSubmission.noticeTitle')}
          action={{
            label: t('mediaSubmission.dismiss'),
            onPress: () => {
              if (current()?.notice === notice) publish(null);
            },
            accessibilityLabel: t('mediaSubmission.dismissLabel'),
          }}
        >
          {mediaNoticeText(notice, t, locale)}
        </Callout>
      ) : null}
      {item ? (
        <>
          <MediaPlayer
            url={item.file.uri}
            kind={kindOf(item.file)}
            title={item.file.name}
            subtitle={t(
              kindOf(item.file) === 'audio'
                ? 'mediaSubmission.audioSubtitle'
                : 'mediaSubmission.videoSubtitle',
            )}
          />
          <UploadList slot={slot} items={items} disabled={disabled} />
          <Button
            variant="tonal"
            leadingIcon={RefreshCw}
            disabled={disabled}
            onPress={() => {
              if (!current() || !eligible()) return;
              const existing = uploadsFor(slot);
              if (
                existing.length !== items.length ||
                !existing.every((entry, index) => entry.id === items[index].id)
              )
                return;
              // Remove only the offered IDs, even if a store listener adds an item.
              for (const entry of items) removeUpload(slot, entry.id);
              publish(null);
            }}
          >
            {t('mediaSubmission.replace')}
          </Button>
        </>
      ) : (
        <ListGroup footer={t('mediaSubmission.footer')}>
          <ListItem
            leading={<IconTile icon={Mic} tone="accent" />}
            title={t('mediaSubmission.audio')}
            onPress={() => {
              const operation = claim();
              if (operation) setRecording({ context, operation });
            }}
            disabled={disabled}
          />
          <ListItem
            leading={<IconTile icon={Video} tone="accent" />}
            title={t('mediaSubmission.video')}
            onPress={() => guard(() => recordVideo({ maxSeconds: 600 }))}
            disabled={disabled}
          />
          <ListItem
            leading={<IconTile icon={Clapperboard} tone="accent" />}
            title={t('mediaSubmission.chooseVideo')}
            subtitle={t('mediaSubmission.library')}
            subtitleLines={1}
            onPress={() => guard(pickVideo)}
            disabled={disabled}
          />
          <ListItem
            leading={<IconTile icon={FileAudio} tone="accent" />}
            title={t('mediaSubmission.chooseFile')}
            subtitle={t('mediaSubmission.files')}
            subtitleLines={1}
            onPress={() => guard(pickMediaFile)}
            disabled={disabled}
          />
        </ListGroup>
      )}
      <AudioRecorderSheet
        visible={!!recorder && !disabled}
        onClose={() => {
          if (!recorder || !current() || live.current?.operation !== recorder.operation) return;
          finish(recorder.operation);
          setRecording(null);
        }}
        attachLabel={t('audioRecorder.useRecording')}
        fileName="Recording"
        purpose={t('audioRecorder.submissionPurpose')}
        onAttach={(file) => {
          if (!recorder || !current() || live.current?.operation !== recorder.operation) return;
          try {
            take(file, recorder.operation);
          } finally {
            finish(recorder.operation);
            setRecording(null);
          }
        }}
      />
    </View>
  );
}
