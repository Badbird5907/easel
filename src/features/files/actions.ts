import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import * as Clipboard from 'expo-clipboard';
import { Directory, File, FileMode } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Platform, Share } from 'react-native';

import type { FileItem } from '@/canvas/api/files';

import type { FileActionOrigin, SaveDestination } from './actionTypes';
import { describeFile } from './kinds';

/**
 * What a student does with a file: share it (FILE-4), save it (FILE-5), open it
 * in another app (FILE-6), or share its Canvas link. Every action works on the
 * downloaded file itself, never a remote URL.
 */

export class FileActionError extends Error {
  readonly origin?: FileActionOrigin;

  constructor(message?: string, originOrOptions?: FileActionOrigin | ErrorOptions) {
    // Retain Error's optional cause constructor for legacy callers as well.
    super(message, originOrOptions && 'cause' in originOrOptions ? originOrOptions : undefined);
    this.origin = originOrOptions && 'reason' in originOrOptions ? originOrOptions : undefined;
  }
}

const cancelled = (error: unknown) => /cancel/i.test(String((error as Error)?.message ?? ''));

function shareOptions(file: FileItem): Sharing.SharingOptions {
  const type = describeFile(file);
  if (Platform.OS === 'android') return { mimeType: type.mimeType, dialogTitle: file.name };
  // iOS reads the type from the extension. A UTI whose preferred extension differs
  // (public.jpeg for .jpg) would make iOS rename the shared file, so skip it then.
  if (type.uti && type.utiMatchesExtension) return { UTI: type.uti, mimeType: type.mimeType };
  return type.extension ? {} : { mimeType: type.mimeType };
}

/** The system share sheet with the file itself, so notes apps receive the file. */
export async function shareFile(local: File, file: FileItem) {
  if (!(await Sharing.isAvailableAsync()))
    throw new FileActionError('Sharing isn’t available on this device.', {
      reason: 'sharing-unavailable',
    });
  await Sharing.shareAsync(local.uri, shareOptions(file));
}

/**
 * Opens the file in another app. iOS: the share sheet, whose app row is "Open in".
 * Android: an ACTION_VIEW intent with a FileProvider URI and read permission granted.
 * Resolves false when no installed app opens this type.
 */
export async function openInApp(local: File, file: FileItem): Promise<boolean> {
  if (Platform.OS === 'ios') {
    await shareFile(local, file);
    return true;
  }
  const mimeType = describeFile(file).mimeType;
  try {
    if (!(await local.canPreview({ mimeType }))) return false;
    await local.preview({ mimeType, title: file.name });
    return true;
  } catch (error) {
    if (cancelled(error)) return true;
    return false;
  }
}

function uniqueName(directory: Directory, name: string): File {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = new File(directory, name);
  for (let n = 2; candidate.exists && n < 100; n += 1)
    candidate = new File(directory, `${stem} ${n}${ext}`);
  return candidate;
}

const CHUNK = 1 << 20;

/**
 * Streams the file into a document the system just created, then checks that every
 * byte arrived and the document still exists, so a save can't report success when
 * nothing was written.
 */
async function writeDocument(out: File, local: File): Promise<void> {
  const input = local.open(FileMode.ReadOnly);
  const expected = input.size;
  let written = 0;
  try {
    const output = out.open(FileMode.WriteOnly);
    try {
      for (;;) {
        const chunk = await input.readBytes(CHUNK);
        if (chunk.length === 0) break;
        await output.writeBytes(chunk);
        written += chunk.length;
      }
    } finally {
      output.close();
    }
  } finally {
    input.close();
  }
  if (written !== expected || !out.exists) throw new Error('The copy is incomplete.');
}

/** Removes a document a failed save left behind. */
function discard(out: File) {
  try {
    if (out.exists) out.delete();
  } catch {
    // Already gone, or the provider refuses; either way there's nothing more to do.
  }
}

/** Copies into a picked folder. Android folders are SAF documents; iOS ones are security-scoped. */
async function copyInto(directory: Directory, local: File, file: FileItem): Promise<void> {
  if (Platform.OS === 'android') {
    // SAF names duplicates itself ("Syllabus (1).pdf"). Writing into the new document,
    // rather than copying over it, keeps it: a copy with overwrite deletes it first.
    const out = directory.createFile(local.name, describeFile(file).mimeType);
    try {
      await writeDocument(out, local);
    } catch (error) {
      discard(out);
      throw error;
    }
    return;
  }
  await local.copy(uniqueName(directory, local.name));
}

/**
 * "Save to Files" on iOS and "Save to…" on Android: the system folder picker, then a copy.
 * Resolves with the folder's name, or null if the student cancels.
 */
export async function saveToFolder(
  local: File,
  file: FileItem,
  initialUri?: string,
): Promise<string | null> {
  return (await saveToFolderResult(local, file, initialUri))?.label ?? null;
}

/** Structured counterpart; the legacy wrapper performs the same single save. */
export async function saveToFolderResult(
  local: File,
  file: FileItem,
  initialUri?: string,
): Promise<SaveDestination | null> {
  let directory: Directory;
  try {
    directory = await Directory.pickDirectoryAsync(initialUri);
  } catch (error) {
    if (cancelled(error)) return null;
    throw new FileActionError('Couldn’t open the folder picker.', { reason: 'folder-picker' });
  }
  try {
    await copyInto(directory, local, file);
  } catch {
    const destination = folderDestination(directory, 'that-folder');
    throw new FileActionError(`Couldn’t save to ${destination.label}. Pick another folder.`, {
      reason: 'folder-copy',
      destination,
    });
  }
  return folderDestination(directory, 'folder');
}

/** The folder's name as the Files app shows it; iOS reports "On My iPhone" by its storage name. */
function folderDestination(
  directory: Directory,
  fallback: 'folder' | 'that-folder' | 'downloads',
): SaveDestination {
  const name = directory.name;
  if (!name)
    return {
      label: { folder: 'the folder', 'that-folder': 'that folder', downloads: 'Downloads' }[
        fallback
      ],
      origin: fallback,
    };
  if (Platform.OS === 'ios' && /^File Provider Storage$/i.test(name))
    return Platform.isPad
      ? { label: 'On My iPad', origin: 'ipad' }
      : { label: 'On My iPhone', origin: 'iphone' };
  return { label: name };
}

type SavedDocument = { uri: string };

/** Easel's Android module, in builds from 1.2.0: MediaStore Downloads and the system Save dialog. */
type DownloadsModule = {
  /** MediaStore Downloads needs Android 10. */
  canSave(): boolean;
  save(source: string, name: string, mimeType: string): Promise<SavedDocument>;
  /** Null when the student closes the dialog. */
  saveAs(source: string, name: string, mimeType: string): Promise<SavedDocument | null>;
};

const downloadsModule = () =>
  Platform.OS === 'android' ? requireOptionalNativeModule<DownloadsModule>('EaselDownloads') : null;

const DOWNLOADS: SaveDestination = { label: 'Downloads', origin: 'downloads' };
const DOWNLOADS_FOLDER_KEY = 'easel.files.downloadsFolder';
const ANDROID_DOWNLOADS =
  'content://com.android.externalstorage.documents/document/primary%3ADownload';

/**
 * Android quick save: straight into the public Downloads folder, with no dialog.
 * Android 9 and earlier show the system Save dialog instead. Builds without Easel's
 * downloads module (1.1.0) can't reach Downloads itself: they ask for a folder once
 * (the picker opens at Downloads) and save straight there afterwards.
 */
export async function saveToDownloads(local: File, file: FileItem): Promise<string | null> {
  return (await saveToDownloadsResult(local, file))?.label ?? null;
}

/** Structured counterpart of saveToDownloads. */
export async function saveToDownloadsResult(
  local: File,
  file: FileItem,
): Promise<SaveDestination | null> {
  const native = downloadsModule();
  if (native) {
    if (!native.canSave()) return saveAsResult(local, file);
    try {
      await native.save(local.uri, local.name, describeFile(file).mimeType);
    } catch {
      throw new FileActionError(
        'Couldn’t save to Downloads. Touch and hold Save to choose another folder.',
        { reason: 'downloads-copy' },
      );
    }
    return DOWNLOADS;
  }
  const saved = await AsyncStorage.getItem(DOWNLOADS_FOLDER_KEY);
  if (saved) {
    try {
      const directory = new Directory(saved);
      await copyInto(directory, local, file);
      return folderDestination(directory, 'downloads');
    } catch {
      // Permission revoked or folder deleted: ask again.
      await AsyncStorage.removeItem(DOWNLOADS_FOLDER_KEY);
    }
  }
  let directory: Directory;
  try {
    directory = await Directory.pickDirectoryAsync(ANDROID_DOWNLOADS);
  } catch (error) {
    if (cancelled(error)) return null;
    throw new FileActionError('Couldn’t open the folder picker.', { reason: 'folder-picker' });
  }
  try {
    await copyInto(directory, local, file);
  } catch {
    const destination = folderDestination(directory, 'that-folder');
    throw new FileActionError(`Couldn’t save to ${destination.label}. Pick another folder.`, {
      reason: 'folder-copy',
      destination,
    });
  }
  await AsyncStorage.setItem(DOWNLOADS_FOLDER_KEY, directory.uri);
  return folderDestination(directory, 'downloads');
}

/**
 * Android "Save to…". With Easel's module, the system Save dialog
 * (ACTION_CREATE_DOCUMENT), which can save into Downloads itself; without it, the
 * folder picker. Resolves with where the file went, or null if the student cancels.
 */
export async function saveAsResult(local: File, file: FileItem): Promise<SaveDestination | null> {
  const native = downloadsModule();
  if (!native) return saveToFolderResult(local, file, ANDROID_DOWNLOADS);
  let saved: SavedDocument | null;
  try {
    saved = await native.saveAs(local.uri, local.name, describeFile(file).mimeType);
  } catch (error) {
    if ((error as { code?: string })?.code === 'ERR_SAVE_DIALOG')
      throw new FileActionError('Couldn’t open the folder picker.', { reason: 'folder-picker' });
    throw new FileActionError('Couldn’t save to that folder. Pick another folder.', {
      reason: 'folder-copy',
      destination: { label: 'that folder', origin: 'that-folder' },
    });
  }
  return saved ? documentDestination(saved.uri) : null;
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Where a saved document is, by name: Downloads, its folder, or "the folder". */
export function documentDestination(uri: string): SaveDestination {
  const match = /^content:\/\/([^/]+)\/document\/([^/?#]+)/.exec(uri);
  const id = match ? decoded(match[2]) : '';
  // External storage IDs are "primary:Download/Notes/Syllabus.pdf"; the Downloads
  // provider's are "msf:123", or "raw:/storage/emulated/0/Download/Syllabus.pdf".
  const path =
    match?.[1] === 'com.android.externalstorage.documents'
      ? id.slice(id.indexOf(':') + 1)
      : match?.[1] === 'com.android.providers.downloads.documents'
        ? id.startsWith('raw:')
          ? id.slice(4).replace(/^\/storage\/[^/]+\/\d+\//, '')
          : 'Download/'
        : '';
  const folders = path.split('/').slice(0, -1);
  if (folders.length === 1 && folders[0] === 'Download') return DOWNLOADS;
  const folder = folders.at(-1);
  return folder ? { label: folder } : { label: 'the folder', origin: 'folder' };
}

export function canSaveToPhotos(file: FileItem): boolean {
  const kind = describeFile(file).kind;
  return kind === 'image' || kind === 'video';
}

/** Images and videos into Photos (iOS) or the gallery (Android). Add-only permission. */
export async function saveToPhotos(local: File) {
  const permission = await requestPermissionsAsync(true);
  if (!permission.granted)
    throw new FileActionError(
      Platform.OS === 'ios'
        ? 'Easel can’t add to Photos. Allow it in Settings > Easel > Photos.'
        : 'Easel can’t add to your gallery. Allow photo access in Settings.',
      { reason: Platform.OS === 'ios' ? 'photos-permission' : 'gallery-permission' },
    );
  await Asset.create(local.uri);
}

/** The file's page in Canvas on the web. */
export function fileWebUrl(baseUrl: string, file: FileItem, canvasUrl?: string): string {
  if (canvasUrl) return canvasUrl;
  if (file.context?.type === 'course')
    return `${baseUrl}/courses/${file.context.id}/files/${file.id}`;
  if (file.context?.type === 'group')
    return `${baseUrl}/groups/${file.context.id}/files/${file.id}`;
  return `${baseUrl}/files/${file.id}`;
}

/** "Share link": the Canvas URL, for classmates who are signed in to Canvas. */
export async function shareLink(url: string, file: FileItem) {
  await Share.share(Platform.OS === 'ios' ? { url } : { message: url, title: file.name });
}

export async function copyLink(url: string) {
  await Clipboard.setStringAsync(url);
}
