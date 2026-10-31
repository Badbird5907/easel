import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { FileItem } from '@/canvas/api/files';
import { CanvasError } from '@/canvas/client';
import { useAccountKey } from '@/canvas/query';
import { useCanvas } from '@/canvas/session';
import { type LocalFile, uploadToCanvas } from '@/canvas/uploads';

import { extensionOf } from './kinds';
import type { FolderUploadOrigin } from './uploadPresentation';

// --- Sources -------------------------------------------------------------------------
// Where a local file comes from before it's uploaded: Files, the photo library,
// or the camera. Shared by My Files, submissions, and submission comments.

/** The student said no to camera or photo access. `message` says how to turn it back on. */
export class PickerPermissionError extends Error {
  constructor(message?: string, options?: ErrorOptions & { origin?: 'camera-permission' }) {
    super(message, options);
    this.origin = options?.origin;
  }

  readonly origin?: 'camera-permission';
}

/** The device can't do this, like the camera on a simulator. */
export class PickerUnavailableError extends Error {
  constructor(message?: string, options?: ErrorOptions & { origin?: 'camera-unavailable' }) {
    super(message, options);
    this.origin = options?.origin;
  }

  readonly origin?: 'camera-unavailable';
}

const mimeExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/** "Photo Oct 29 at 11.42.07.jpg": a readable, unique name for something with none. */
export function timestampName(prefix: string, extension: string, now = new Date()): string {
  const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return `${prefix} ${day} at ${time}.${extension}`;
}

/** The picker's name, with an extension that matches what the bytes really are. */
function nameFor(asset: ImagePicker.ImagePickerAsset, fallbackPrefix: string): string {
  const mime = asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
  const extension = mimeExtensions[mime] ?? extensionOf(asset.fileName) ?? 'jpg';
  if (!asset.fileName) return timestampName(fallbackPrefix, extension);
  const current = extensionOf(asset.fileName);
  const same = current === extension || (current === 'jpeg' && extension === 'jpg');
  return same ? asset.fileName : `${asset.fileName.replace(/\.[^.]+$/, '')}.${extension}`;
}

function fromAsset(asset: ImagePicker.ImagePickerAsset, fallbackPrefix: string): LocalFile {
  return {
    uri: asset.uri,
    name: nameFor(asset, fallbackPrefix),
    size: asset.fileSize ?? null,
    mimeType: asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
  };
}

/** Files (iCloud Drive, Google Drive, Downloads, and other providers). */
export async function pickDocuments({ multiple = true }: { multiple?: boolean } = {}): Promise<LocalFile[]> {
  const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple });
  if (picked.canceled) return [];
  return picked.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    size: asset.size ?? null,
    mimeType: asset.mimeType ?? null,
  }));
}

/** The photo library. Images come back as JPEG so every school's Canvas can open them. */
export async function pickPhotos({
  multiple = true,
  videos = false,
}: { multiple?: boolean; videos?: boolean } = {}): Promise<LocalFile[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: videos ? ['images', 'videos'] : ['images'],
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? 20 : 1,
    orderedSelection: true,
    quality: 0.85,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => fromAsset(asset, asset.type === 'video' ? 'Video' : 'Photo'));
}

async function ensureCamera() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted)
    throw new PickerPermissionError('Easel can’t use the camera. Turn on camera access for Easel in Settings.', { origin: 'camera-permission' });
}

async function launchCamera(options: ImagePicker.ImagePickerOptions) {
  await ensureCamera();
  try {
    return await ImagePicker.launchCameraAsync(options);
  } catch (error) {
    if (/simulator|not available|unavailable/i.test(String((error as Error).message)))
      throw new PickerUnavailableError('This device doesn’t have a camera. Choose a photo or file instead.', { origin: 'camera-unavailable' });
    throw error;
  }
}

/** One photo from the camera. */
export async function takePhoto(): Promise<LocalFile | null> {
  const result = await launchCamera({ mediaTypes: ['images'], quality: 0.85 });
  if (result.canceled || !result.assets[0]) return null;
  return fromAsset(result.assets[0], 'Photo');
}

/** A video from the camera, for a comment or submission. */
export async function recordVideo({ maxSeconds = 600 }: { maxSeconds?: number } = {}): Promise<LocalFile | null> {
  const result = await launchCamera({
    mediaTypes: ['videos'],
    videoMaxDuration: maxSeconds,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
  });
  if (result.canceled || !result.assets[0]) return null;
  return fromAsset(result.assets[0], 'Video');
}

// --- My Files ------------------------------------------------------------------------

export type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; name: string; fraction: number | null }
  | { status: 'done'; file: FileItem }
  | { status: 'error'; message: string; origin?: FolderUploadOrigin };

/**
 * Upload to a My Files folder (FILE-9): pick a document, ask Canvas where to send
 * it, send the bytes, and confirm. Canvas answers the byte upload with the file
 * JSON, a `location` to confirm, or a redirect to it.
 */
export function useUploadToFolder(folderId: string | undefined) {
  const { client } = useCanvas();
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  const lifetime = useMemo(() => ({ accountKey, client, folderId }), [accountKey, client, folderId]);
  const live = useRef<{ lifetime: typeof lifetime; operation: object | null } | null>(null);
  useLayoutEffect(() => {
    live.current = { lifetime, operation: null };
    return () => {
      if (live.current?.lifetime === lifetime) live.current = null;
    };
  }, [lifetime]);
  const isCurrent = () => live.current?.lifetime === lifetime;
  const [result, setResult] = useState<{ lifetime: typeof lifetime; state: UploadState } | null>(null);
  const state: UploadState = result?.lifetime === lifetime ? result.state : { status: 'idle' };

  const pickAndUpload = async () => {
    if (!folderId) return;
    // Claim synchronously, before the picker yields: same-render callbacks share this claim.
    if (!isCurrent() || live.current!.operation) return;
    const operation = {};
    live.current!.operation = operation;
    const owns = () => isCurrent() && live.current!.operation === operation;
    let asset: LocalFile | undefined;
    const publish = (next: UploadState) => {
      if (owns()) setResult({ lifetime, state: next });
    };
    try {
      [asset] = await pickDocuments({ multiple: false });
      if (!asset || !owns()) return;
      const picked = asset;
      publish({ status: 'uploading', name: picked.name, fraction: 0 });
      const uploaded = await uploadToCanvas(client, '/api/v1/users/self/files', picked, {
        params: { parent_folder_id: folderId, on_duplicate: 'rename' },
        onProgress: (fraction) => publish({ status: 'uploading', name: picked.name, fraction }),
      });
      // An already-started request may finish after the UI context changes. Invalidate
      // its captured account, but never publish that result into the replacement UI.
      await queryClient.invalidateQueries({ queryKey: [accountKey, 'files'] });
      publish({ status: 'done', file: uploaded });
    } catch (error) {
      const quota = error instanceof CanvasError && /quota/i.test(error.message);
      publish({
        status: 'error',
        message: !asset
          ? 'Couldn’t choose a file. Try again.'
          : quota
            ? 'Your My Files storage is full. Delete something in Canvas and try again.'
            : `Couldn’t upload ${asset.name}. Check your connection and try again.`,
        origin: !asset
          ? { reason: 'picker' }
          : quota
            ? { reason: 'quota' }
            : { reason: 'upload', name: asset.name },
      });
    } finally {
      // An obsolete completion must not release a newer operation after reset.
      if (owns()) live.current!.operation = null;
    }
  };

  return {
    state,
    pickAndUpload,
    reset: () => {
      if (!isCurrent()) return;
      live.current!.operation = null;
      setResult({ lifetime, state: { status: 'idle' } });
    },
  };
}
