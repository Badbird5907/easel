import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Camera, FileText, Image as ImageIcon, Mic, Paperclip, RotateCw, Video, X } from 'lucide-react-native';
import { type ComponentRef, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, View } from 'react-native';

import type { FileItem } from '@/canvas/api/files';
import { useCanvas } from '@/canvas/session';
import { type LocalFile, uploadToCanvas } from '@/canvas/uploads';
import { Button, IconButton, ListGroup, ListItem, ProgressBar, Text } from '@/design';
import { fileSummary } from '@/features/files/AttachmentList';
import { FileThumbnail } from '@/features/files/FileThumbnail';
import { timestampName } from '@/features/files/upload';
import { AudioRecorderSheet } from '@/features/submissions/AudioRecorderSheet';
import { createTranslator, useTranslation } from '@/i18n';

import { attachmentErrorText, attachmentProgressText, type AttachmentErrorOrigin, uploadError } from './attachmentPresentation';
import { OptionsSheet } from './OptionsSheet';

/*
 * Files and photos attached to a message or a discussion reply (INBOX-4,
 * CONTENT-3). Each one uploads to the student's own files through Canvas's
 * three-step upload as soon as it's picked, so sending only passes file IDs.
 */

export type PendingAttachment = {
  key: string;
  local: LocalFile;
  status: 'uploading' | 'done' | 'error';
  /** 0 to 1, or null when the size is unknown. */
  fraction: number | null;
  file: FileItem | null;
  error: string | null;
  /** Only locally authored errors are tagged; the compatibility string stays raw. */
  errorOrigin?: AttachmentErrorOrigin;
};

export type AttachmentSource = 'files' | 'photos' | 'camera' | 'video';

type Options = {
  /**
   * Where the upload lands, as a path under My Files: `conversation attachments`
   * for messages (what the official apps use) or `unfiled` for discussion replies
   * (what Canvas's discussion page uses).
   */
  folderPath: string;
  /** Canvas allows one file per discussion reply; messages take any number. */
  max?: number;
  /** Stable composer identity; focus/eligibility retire UI work, not accepted uploads. */
  owner?: { resource: string; focused?: boolean; eligible?: boolean };
};

/** Commit authority only in effects: speculative renders cannot retire live work. */
function useAttachmentLifetime(identity: object, eligible: boolean) {
  const token = useMemo(() => ({ identity, eligible }), [identity, eligible]);
  const committed = useRef<object | null>(null);
  useLayoutEffect(() => {
    committed.current = eligible ? token : null;
    return () => { committed.current = null; };
  }, [token, eligible]);
  return useMemo(() => () => committed.current === token, [token]);
}

type AttachmentLifetime = {
  /** Capture before opening a sheet. The returned lease never revives after retirement. */
  capture: () => (() => boolean) | null;
};

let nextKey = 1;

/** Picks files or photos and uploads each one, tracking progress per file. */
export function useAttachmentUploads({ folderPath, max = Infinity, owner }: Options) {
  const { client, account } = useCanvas();
  const { t } = useTranslation();
  const [items, setItems] = useState<PendingAttachment[]>([]);
  // Event handlers reserve capacity before React renders the updated list.
  const currentItems = useRef<PendingAttachment[]>([]);
  // Uploads finish after the composer may have closed or reset; ignore stale ones.
  const generation = useRef(0);
  const [revision, setRevision] = useState(0);
  const resource = owner?.resource;
  const identity = useMemo(() => ({ accountId: account?.id, client, resource, folderPath }), [account?.id, client, resource, folderPath]);
  const resourceCurrent = useAttachmentLifetime(identity, true);
  const uiCurrent = useAttachmentLifetime(identity, (owner?.focused ?? true) && (owner?.eligible ?? true));
  const limits = useRef(max);
  // Keep the native slot occupied until the entered picker settles, even after blur/reset.
  const pickerFlight = useRef(false);
  useLayoutEffect(() => { limits.current = max; }, [max]);
  useLayoutEffect(() => {
    setItems(currentItems.current);
    return () => {
      generation.current += 1;
      currentItems.current = [];
    };
  }, [identity]);
  const attachmentLifetime = useMemo<AttachmentLifetime>(() => ({
    revision,
    capture: () => {
      const started = generation.current;
      if (!uiCurrent() || pickerFlight.current || currentItems.current.length >= limits.current) return null;
      return () => uiCurrent() && generation.current === started && currentItems.current.length < limits.current;
    },
  }), [uiCurrent, revision]);

  const replaceItems = (next: PendingAttachment[]) => {
    currentItems.current = next;
    setItems(next);
  };

  const patch = (key: string, change: Partial<PendingAttachment>) =>
    replaceItems(currentItems.current.map((item) => (item.key === key ? { ...item, ...change } : item)));

  const upload = async (key: string, local: LocalFile) => {
    const started = generation.current;
    try {
      const file = await uploadToCanvas(client, '/api/v1/users/self/files', local, {
        params: { parent_folder_path: folderPath, on_duplicate: 'rename' },
        onProgress: (fraction) => {
          if (generation.current === started) patch(key, { fraction });
        },
      });
      if (generation.current === started) patch(key, { status: 'done', file, fraction: 1 });
    } catch (error) {
      if (generation.current === started)
        patch(key, { status: 'error', ...uploadError(error, local.name) });
    }
  };

  const add = (files: LocalFile[]) => {
    if (!uiCurrent()) return;
    const room = Math.max(0, limits.current - currentItems.current.length);
    const added = files.slice(0, room).map((local): PendingAttachment => ({
      key: `a${nextKey++}`,
      local,
      status: 'uploading',
      fraction: 0,
      file: null,
      error: null,
    }));
    if (!added.length) return;
    replaceItems([...currentItems.current, ...added]);
    for (const item of added) void upload(item.key, item.local);
  };

  const pick = async (source: AttachmentSource) => {
    const valid = attachmentLifetime.capture();
    if (!valid) return;
    pickerFlight.current = true;
    try {
      let room = limits.current - currentItems.current.length;
      if (source === 'files') {
        const picked = await DocumentPicker.getDocumentAsync({
          copyToCacheDirectory: true,
          multiple: room > 1,
        });
        if (!valid() || picked.canceled) return;
        add(picked.assets.map((a) => ({ uri: a.uri, name: a.name, size: a.size, mimeType: a.mimeType })));
        return;
      }

      const camera = source === 'camera' || source === 'video';
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!valid()) return;
      room = limits.current - currentItems.current.length;
      if (room <= 0) return;
      if (!permission.granted) {
        Alert.alert(
          camera ? t('attachment.cameraOff') : t('attachment.photosOff'),
          source === 'video'
            ? t('attachment.videoPermission')
            : camera
              ? t('attachment.cameraPermission')
              : t('attachment.photosPermission'),
          [
            { text: t('attachment.notNow'), style: 'cancel' },
            { text: t('attachment.openSettings'), onPress: () => { if (valid()) void Linking.openSettings(); } },
          ],
        );
        return;
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: source === 'video' ? ['videos'] : ['images', 'videos'],
        quality: 0.85,
        allowsMultipleSelection: source === 'photos' && room > 1,
        selectionLimit: Number.isFinite(room) ? room : 0,
        ...(source === 'video' && { videoMaxDuration: 600 }),
      };
      const picked = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (!valid() || picked.canceled) return;
      add(
        picked.assets.map((a, i) => {
          const extension = a.mimeType?.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
          return {
            uri: a.uri,
            name:
              source === 'video'
                ? timestampName('Video message', extension === 'quicktime' ? 'mov' : extension)
                : a.fileName || `${a.type === 'video' ? 'Video' : 'Photo'} ${i + 1}.${extension}`,
            size: a.fileSize ?? null,
            mimeType: a.mimeType ?? (a.type === 'video' ? 'video/mp4' : 'image/jpeg'),
          };
        }),
      );
    } finally {
      pickerFlight.current = false;
    }
  };

  const remove = (key: string) => {
    if (uiCurrent()) replaceItems(currentItems.current.filter((item) => item.key !== key));
  };

  const retry = (key: string) => {
    if (!uiCurrent()) return;
    const item = currentItems.current.find((i) => i.key === key);
    if (!item || item.status !== 'error') return;
    patch(key, { status: 'uploading', fraction: 0, error: null, errorOrigin: undefined });
    void upload(key, item.local);
  };

  /** Clears everything, for a composer that closed or sent. */
  const reset = () => {
    if (!resourceCurrent()) return;
    generation.current += 1;
    setRevision((value) => value + 1);
    replaceItems([]);
  };

  /** Starts from files already on the post, e.g. when editing a reply. */
  const seed = (files: FileItem[]) => {
    if (!resourceCurrent()) return;
    generation.current += 1;
    setRevision((value) => value + 1);
    replaceItems(
      files.map((file) => ({
        key: `a${nextKey++}`,
        local: { uri: '', name: file.name, size: file.size, mimeType: file.contentType },
        status: 'done',
        fraction: 1,
        file,
        error: null,
      })),
    );
  };

  return {
    attachmentLifetime,
    items,
    files: items.flatMap((i) => (i.status === 'done' && i.file ? [i.file] : [])),
    uploading: items.some((i) => i.status === 'uploading'),
    failed: items.some((i) => i.status === 'error'),
    full: items.length >= max,
    pick,
    /** Adds files made in the app, such as an audio recording. */
    add,
    remove,
    retry,
    reset,
    seed,
  };
}

export type AttachmentUploads = Omit<ReturnType<typeof useAttachmentUploads>, 'attachmentLifetime'> & {
  attachmentLifetime?: AttachmentLifetime;
};

class AttachmentMenu {
  closed = false;
  used = false;
  constructor(readonly identity: object, readonly valid: () => boolean) {}
  close() { this.closed = true; }
  claim() { this.used = true; }
}

/**
 * "Attach" with a menu: a file, the photo library, or the camera. With `media`,
 * also record a video or a voice message (INBOX-5). Recordings go up as
 * attachments, which every Canvas accepts; Canvas media comments need the
 * school's Kaltura setup.
 */
export function AttachButton({
  uploads,
  label,
  disabled,
  media = false,
}: {
  uploads: AttachmentUploads;
  label?: string;
  disabled?: boolean;
  media?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<AttachmentMenu | null>(null);
  const [recording, setRecording] = useState<{ identity: object; valid: () => boolean } | null>(null);
  const attachTrigger = useRef<ComponentRef<typeof View>>(null);
  const lifetime = uploads.attachmentLifetime;
  const identity = useMemo(() => ({ lifetime, disabled, media }), [lifetime, disabled, media]);
  const current = useAttachmentLifetime(identity, !disabled);
  const menuLease = useRef<AttachmentMenu | null>(null);
  const recordingLease = useRef<{ identity: object; valid: () => boolean } | null>(null);
  useLayoutEffect(() => {
    menuLease.current = null;
    recordingLease.current = null;
    return () => { menuLease.current = null; recordingLease.current = null; };
  }, [identity]);
  const claimMenu = () => {
    if (!current() || !open || menuLease.current !== open || open.used || !open.valid()) return null;
    open.claim();
    menuLease.current = null;
    setOpen(null);
    return open;
  };
  const pick = (source: AttachmentSource) => { if (claimMenu()) void uploads.pick(source); };
  const record = () => {
    const selected = claimMenu();
    if (!selected || recordingLease.current || (lifetime && !lifetime.capture())) return;
    const entry = { identity, valid: () => current() && selected.valid() };
    recordingLease.current = entry;
    setRecording(entry);
  };
  return (
    <>
      <Button
        ref={attachTrigger}
        variant="secondary"
        size="sm"
        leadingIcon={Paperclip}
        disabled={disabled || uploads.full}
        onPress={() => {
          if (!current() || uploads.full) return;
          const next = lifetime ? lifetime.capture() : () => true;
          if (!next) return;
          const menu = new AttachmentMenu(identity, next);
          menuLease.current = menu;
          setOpen(menu);
        }}
        accessibilityHint={t('attachment.chooseHint')}
        className="self-start"
      >
        {label === undefined ? t('attachment.attach') : label}
      </Button>
      <OptionsSheet
        visible={open !== null && open.identity === identity && !open.closed}
        returnFocusRef={attachTrigger}
        onClose={(selected) => {
          if (!current() || !open || menuLease.current !== open || open.closed) return;
          open.close();
          if (!selected) menuLease.current = null;
          // A chosen iOS callback still owns its one post-dismissal handoff.
          setOpen(null);
        }}
        title={t('attachment.attach')}
        options={[
          { key: 'files', label: t('attachment.files'), icon: FileText, onPress: () => pick('files') },
          {
            key: 'photos',
            label: t('attachment.photos'),
            icon: ImageIcon,
            onPress: () => pick('photos'),
          },
          { key: 'camera', label: t('attachment.camera'), icon: Camera, onPress: () => pick('camera') },
          ...(media
            ? [
                { key: 'video', label: t('attachment.video'), icon: Video, onPress: () => pick('video') },
                { key: 'audio', label: t('attachment.audio'), icon: Mic, onPress: record },
              ]
            : []),
        ]}
      />
      {media ? (
        <AudioRecorderSheet
          visible={recording !== null && recording.identity === identity}
          onClose={() => {
            if (!current() || recordingLease.current !== recording) return;
            recordingLease.current = null;
            setRecording(null);
          }}
          onAttach={(file) => {
            if (!recording || recordingLease.current !== recording || !recording.valid()) return;
            recordingLease.current = null;
            setRecording(null);
            uploads.add([{ ...file, name: file.name.replace(/^Voice comment/, 'Voice message') }]);
          }}
        />
      ) : null}
    </>
  );
}

/** Picked files with upload progress, retry for failures, and remove. */
export function PendingAttachmentList({ uploads }: { uploads: AttachmentUploads }) {
  const { t, locale } = useTranslation();
  if (uploads.items.length === 0) return null;
  return (
    <ListGroup>
      {uploads.items.map((item) => {
        const preview = item.file ?? {
          name: item.local.name,
          filename: item.local.name,
          contentType: item.local.mimeType ?? '',
          thumbnailUrl: null,
        };
        const status =
          item.status === 'uploading'
            ? attachmentProgressText(item.fraction, locale)
            : item.status === 'error'
              ? attachmentErrorText(item.error, item.errorOrigin, t)
              : item.file
                ? fileSummary(item.file, locale)
                : '';
        return (
          <ListItem
            key={item.key}
            leading={<FileThumbnail file={preview} size="sm" />}
            title={item.local.name}
            subtitle={item.status === 'uploading' ? undefined : status}
            subtitleLines={2}
            accessibilityLabel={t('attachment.nameStatus', { name: item.local.name, status })}
            chevron={false}
            trailing={
              <View className="flex-row items-center">
                {item.status === 'uploading' ? (
                  <View className="w-16" accessibilityLiveRegion="polite">
                    <ProgressBar value={item.fraction ?? 0} size="sm" />
                  </View>
                ) : null}
                {item.status === 'error' ? (
                  <IconButton
                    icon={RotateCw}
                    size="sm"
                    accessibilityLabel={t('attachment.retry', { name: item.local.name })}
                    onPress={() => uploads.retry(item.key)}
                  />
                ) : null}
                <IconButton
                  icon={X}
                  size="sm"
                  accessibilityLabel={t('attachment.remove', { name: item.local.name })}
                  onPress={() => uploads.remove(item.key)}
                />
              </View>
            }
          />
        );
      })}
    </ListGroup>
  );
}

/**
 * One line under a composer while files upload or after one fails.
 * Old callers retain English; rendering/background callers can pass their own locale.
 */
export function attachmentStatusLine(uploads: AttachmentUploads, locale = 'en'): string | null {
  const t = createTranslator(locale);
  if (uploads.uploading) return t('attachment.wait');
  if (uploads.failed) return t('attachment.retryOrRemove');
  return null;
}

export function AttachmentStatus({ uploads }: { uploads: AttachmentUploads }) {
  const { locale } = useTranslation();
  const line = attachmentStatusLine(uploads, locale);
  if (!line) return null;
  return (
    <Text variant="footnote" tone="muted" className="px-1">
      {line}
    </Text>
  );
}
