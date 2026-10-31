import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import type { FileItem } from '@/canvas/api/files';
import type { CanvasClient } from '@/canvas/client';
import { registerAccountCleanup } from '@/canvas/session';
import {
  type LocalFile,
  type MediaEntry,
  uploadMediaToKaltura,
  uploadToCanvas,
} from '@/canvas/uploads';

import { describeUploadError, LOST, STOPPED, type UploadErrorOrigin } from './uploadErrors';

/**
 * Files on their way to Canvas for a submission or a submission comment
 * (ASSIGN-4, ASSIGN-6, ASSIGN-11). The store lives at module level, so leaving
 * the screen doesn't stop or lose an upload; reopening it shows the same progress.
 *
 * Each slot (one assignment's submission, its media recording, or its next
 * comment) holds a list of files. Every file uploads as soon as it's added,
 * through Canvas's three-step upload or, for media recordings, Kaltura, and
 * keeps its own progress, error, and retry.
 *
 * Surviving backgrounding and relaunch (PRD 8):
 * - Transfers use a background URL session on iOS, so they keep going while
 *   Easel is suspended. Android has no background session in expo-file-system;
 *   the upload continues while the process lives.
 * - Each slot is saved to Documents/uploads/<account>.json, and every file is
 *   copied under Documents/uploads/files when it's added, so picked, shared, and
 *   recorded files outlive the cache. After a relaunch, finished uploads are still
 *   ready to submit, and ones the OS stopped come back as "Retry".
 */

export type UploadStatus = 'uploading' | 'done' | 'error';

export type UploadItem = {
  id: string;
  file: LocalFile;
  status: UploadStatus;
  /** 0 to 1, or null while the size is unknown. */
  fraction: number | null;
  /** The Canvas file once the upload finishes. Its ID goes in `file_ids[]`. */
  uploaded: FileItem | null;
  /** The media entry once a recording reaches Kaltura. Its ID goes in `media_comment_id`. */
  media: MediaEntry | null;
  error: string | null;
  errorOrigin?: UploadErrorOrigin;
};

/** Where a slot's files go: a Canvas upload preflight, or Kaltura for media recordings. */
export type UploadTarget =
  | { client: CanvasClient; preflightPath: string }
  | { client: CanvasClient; media: { contextCode: string } };

type Destination = { preflightPath: string } | { media: { contextCode: string } };

type Slot = {
  items: UploadItem[];
  attempts: Map<string, object>;
  /** Null after a relaunch until a screen hands the store a client again. */
  client: CanvasClient | null;
  destination: Destination;
};

const slots = new Map<string, Slot>();
const listeners = new Set<() => void>();
const EMPTY: UploadItem[] = [];
let counter = 0;
const newId = () => `upload-${Date.now().toString(36)}-${counter++}`;

const accountOf = (key: string) => key.split('|')[1] ?? '';

// --- Persistence ---------------------------------------------------------------------

const safe = (part: string) => part.replace(/[^A-Za-z0-9._-]/g, '_');
const rootDir = () => new Directory(Paths.document, 'uploads');
const filesDir = () => new Directory(Paths.document, 'uploads', 'files');
const stateFile = (accountId: string) => new File(rootDir(), `${safe(accountId)}.json`);

type StoredSlot = { destination: Destination; items: Omit<UploadItem, 'fraction'>[] };

const dirty = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persistSoon(key: string) {
  dirty.add(accountOf(key));
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    for (const accountId of [...dirty]) persistAccount(accountId);
    dirty.clear();
  }, 250);
}

function persistAccount(accountId: string) {
  try {
    const stored: Record<string, StoredSlot> = {};
    for (const [key, slot] of slots) {
      if (accountOf(key) !== accountId || !slot.items.length) continue;
      stored[key] = {
        destination: slot.destination,
        items: slot.items.map(({ fraction: _fraction, ...item }) => item),
      };
    }
    const file = stateFile(accountId);
    if (!Object.keys(stored).length) {
      if (file.exists) file.delete();
      return;
    }
    const dir = rootDir();
    if (!dir.exists) dir.create({ intermediates: true });
    // Small metadata only: synchronous write keeps the 250ms debounce and cannot
    // complete after account cleanup. File.write is asynchronous in SDK 58.
    file.writeSync(JSON.stringify(stored));
  } catch {
    // The uploads still run; only a relaunch would lose track of them.
  }
}

/** Copies a file into Documents so it survives cache cleanup, share-extension resets, and relaunch. */
async function keepCopy(id: string, file: LocalFile): Promise<LocalFile> {
  let owned: LocalFile | undefined;
  try {
    const source = new File(file.uri);
    if (!source.exists) return file;
    const dir = filesDir();
    if (!dir.exists) dir.create({ intermediates: true });
    const copy = new File(dir, `${id}-${safe(file.name).slice(-80)}`);
    if (copy.exists) copy.delete();
    owned = { ...file, uri: copy.uri, size: file.size ?? source.size ?? null };
    await source.copy(copy);
    return owned;
  } catch {
    if (owned) dropCopy(owned);
    return file;
  }
}

function dropCopy(file: LocalFile) {
  try {
    if (!file.uri.startsWith(`${filesDir().uri.replace(/\/$/, '')}/`)) return;
    const copy = new File(file.uri);
    if (copy.exists) copy.delete();
  } catch {
    // Already gone.
  }
}

/** Reads saved slots once, when the store first loads. Uploads in flight at the time come back as errors. */
function restore() {
  try {
    const dir = rootDir();
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      if (!(entry instanceof File) || !entry.name.endsWith('.json')) continue;
      const stored = JSON.parse(entry.textSync()) as Record<string, StoredSlot>;
      for (const [key, slot] of Object.entries(stored)) {
        slots.set(key, {
          client: null,
          attempts: new Map(),
          destination: slot.destination,
          items: slot.items.map((item) => {
            const missing = !new File(item.file.uri).exists;
            if (item.status === 'done') return { ...item, fraction: 1 };
            return {
              ...item,
              status: 'error',
              fraction: null,
              error: missing
                ? LOST
                : item.status === 'uploading'
                  ? STOPPED
                  : (item.error ?? STOPPED),
              ...(missing
                ? { errorOrigin: { kind: 'lost' as const } }
                : item.status === 'uploading' || item.error == null
                  ? { errorOrigin: { kind: 'stopped' as const } }
                  : {}),
            };
          }),
        });
      }
    }
  } catch {
    // A damaged state file only loses the list; the files in Canvas are untouched.
  }
}
restore();

// --- Store ---------------------------------------------------------------------------

function emit() {
  for (const listener of listeners) listener();
}

function update(key: string, id: string, patch: Partial<UploadItem>, { persist = true } = {}) {
  const slot = slots.get(key);
  if (!slot) return;
  slot.items = slot.items.map((item) => (item.id === id ? { ...item, ...patch } : item));
  emit();
  if (persist) persistSoon(key);
}

const mediaTypeOf = (file: LocalFile): 'audio' | 'video' =>
  file.mimeType?.startsWith('audio/') || /\.(m4a|mp3|aac|wav|caf)$/i.test(file.name)
    ? 'audio'
    : 'video';

/** A claim belongs to one slot lifetime and one attempt, including its pending copy. */
function start(key: string, id: string, target: UploadTarget | null, copy = false) {
  const slot = slots.get(key);
  const item = slot?.items.find((i) => i.id === id);
  if (!slot || !item || slot.attempts.has(id)) return;
  const claim = {};
  slot.attempts.set(id, claim);
  const current = () => slots.get(key) === slot && slot.attempts.get(id) === claim;
  // Capture the endpoint and raw metadata before any asynchronous boundary.
  const original = { ...item.file };
  const destination = target ? destinationOf(target) : null;
  const client = target?.client;
  update(key, id, { status: 'uploading', fraction: 0, error: null, errorOrigin: undefined });
  if (!current()) return;
  void (async () => {
    try {
      const file = copy ? await keepCopy(id, original) : original;
      if (!current()) {
        if (copy && file.uri !== original.uri) dropCopy(file);
        return;
      }
      if (copy) update(key, id, { file });
      if (!current()) return;
      if (!client || !destination) {
        slot.attempts.delete(id);
        update(key, id, { status: 'error', error: STOPPED, errorOrigin: { kind: 'stopped' } });
        return;
      }
      if (!new File(file.uri).exists) {
        slot.attempts.delete(id);
        update(key, id, { status: 'error', error: LOST, errorOrigin: { kind: 'lost' } });
        return;
      }
      let lastReported = 0;
      const onProgress = (fraction: number | null) => {
        if (!current()) return;
        // Native progress fires often; repaint at most every couple of percent.
        if (fraction !== null && fraction < 1 && fraction - lastReported < 0.02) return;
        lastReported = fraction ?? 0;
        update(key, id, { fraction }, { persist: false });
      };
      const result =
        'media' in destination
          ? {
              media: await uploadMediaToKaltura(client, file, {
                type: mediaTypeOf(file),
                contextCode: destination.media.contextCode,
                onProgress,
              }),
              uploaded: null,
            }
          : {
              uploaded: await uploadToCanvas(client, destination.preflightPath, file, {
                onProgress,
              }),
              media: null,
            };
      if (current()) {
        slot.attempts.delete(id);
        update(key, id, {
          status: 'done',
          fraction: 1,
          ...result,
          error: null,
          errorOrigin: undefined,
        });
      }
    } catch (error) {
      if (current()) {
        slot.attempts.delete(id);
        update(key, id, { status: 'error', ...describeUploadError(error, original.name) });
      }
    } finally {
      // A listener may already have claimed a new retry during settlement.
      if (current()) slot.attempts.delete(id);
    }
  })();
}

const destinationOf = (target: UploadTarget): Destination =>
  'media' in target ? { media: { ...target.media } } : { preflightPath: target.preflightPath };

/** Adds files to a slot and starts uploading them. */
export function addUploads(key: string, target: UploadTarget, files: LocalFile[]): string[] {
  const slot = slots.get(key) ?? {
    items: [],
    attempts: new Map<string, object>(),
    client: target.client,
    destination: destinationOf(target),
  };
  // The latest client wins, in case the token was refreshed.
  slot.client = target.client;
  slot.destination = destinationOf(target);
  slots.set(key, slot);
  const ids = files.map((file) => {
    const id = newId();
    slot.items = [
      ...slot.items,
      {
        id,
        file: { ...file },
        status: 'uploading',
        fraction: 0,
        uploaded: null,
        media: null,
        error: null,
      },
    ];
    return id;
  });
  emit();
  persistSoon(key);
  ids.forEach((id) => start(key, id, target, true));
  return ids;
}

/** Tries a failed upload again. Pass the current client after a relaunch. */
export function retryUpload(key: string, id: string, client?: CanvasClient) {
  const slot = slots.get(key);
  if (
    !slot ||
    slot.items.find((item) => item.id === id)?.status !== 'error' ||
    slot.attempts.has(id)
  )
    return;
  if (client) slot.client = client;
  start(key, id, slot.client ? { client: slot.client, ...slot.destination } : null);
}

/** Removes a file. An upload in flight finishes on its own; its result is ignored. */
export function removeUpload(key: string, id: string) {
  const slot = slots.get(key);
  if (!slot) return;
  slot.attempts.delete(id);
  const removed = slot.items.find((item) => item.id === id);
  slot.items = slot.items.filter((item) => item.id !== id);
  if (removed) dropCopy(removed.file);
  emit();
  persistSoon(key);
}

/** Moves a file up or down, for the order files appear in the submission. */
export function moveUpload(key: string, id: string, offset: -1 | 1) {
  const slot = slots.get(key);
  if (!slot) return;
  const index = slot.items.findIndex((i) => i.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= slot.items.length) return;
  const items = [...slot.items];
  [items[index], items[target]] = [items[target], items[index]];
  slot.items = items;
  emit();
  persistSoon(key);
}

export function clearUploads(key: string) {
  const slot = slots.get(key);
  if (!slot) return;
  slots.delete(key);
  slot.items.forEach((item) => dropCopy(item.file));
  emit();
  persistSoon(key);
}

export function uploadsFor(key: string): UploadItem[] {
  return slots.get(key)?.items ?? EMPTY;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The files in one slot, live. */
export function useUploads(key: string): UploadItem[] {
  return useSyncExternalStore(
    subscribe,
    () => uploadsFor(key),
    () => uploadsFor(key),
  );
}

/** Uploads still sending, for one account or all of them. */
export function activeUploadCount(accountId?: string): number {
  let count = 0;
  for (const [key, slot] of slots) {
    if (accountId && accountOf(key) !== accountId) continue;
    count += slot.items.filter((item) => item.status === 'uploading').length;
  }
  return count;
}

/**
 * How many uploads are still sending, live: for one account, or every account
 * when `accountId` is left out. Sign-out uses it to warn before dropping them.
 */
export function useActiveUploads(accountId?: string): { count: number } {
  const count = useSyncExternalStore(
    subscribe,
    () => activeUploadCount(accountId),
    () => activeUploadCount(accountId),
  );
  return { count };
}

// Removing an account drops its pending uploads, their copies, and its saved state (AUTH-10).
registerAccountCleanup((accountId) => {
  dirty.delete(accountId);
  for (const [key, slot] of [...slots]) {
    if (accountOf(key) !== accountId) continue;
    slots.delete(key);
    slot.items.forEach((item) => dropCopy(item.file));
  }
  emit();
  try {
    const file = stateFile(accountId);
    if (file.exists) file.delete();
  } catch {
    // Nothing saved.
  }
});

export const submissionSlot = (accountId: string, courseId: string, assignmentId: string) =>
  `submission|${accountId}|${courseId}|${assignmentId}`;

/** A media recording on its way to Kaltura, for a `media_recording` submission (ASSIGN-6). */
export const mediaSlot = (accountId: string, courseId: string, assignmentId: string) =>
  `media|${accountId}|${courseId}|${assignmentId}`;

export const commentSlot = (accountId: string, courseId: string, assignmentId: string) =>
  `comment|${accountId}|${courseId}|${assignmentId}`;

/** What a slot adds up to, for the submit button and summaries. */
export function summarize(items: UploadItem[]) {
  const uploading = items.filter((i) => i.status === 'uploading').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const done = items.filter((i) => i.status === 'done');
  return {
    uploading,
    failed,
    ready: items.length > 0 && uploading === 0 && failed === 0,
    fileIds: done.filter((i) => i.uploaded).map((i) => i.uploaded!.id),
    media: done.find((i) => i.media)?.media ?? null,
  };
}
