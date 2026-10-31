import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FileItem } from '@/canvas/api/files';
import type { CanvasClient } from '@/canvas/client';
import { registerAccountCleanup, useCanvas } from '@/canvas/session';
import { sessionUrl } from '@/features/content/browser';

import { describeFile, extensionFor } from './kinds';

/**
 * Download pipeline (FILE-2). Files land in the cache, keyed by account, file ID,
 * and `updated_at`, so a replaced file downloads again and an unchanged one never
 * does. Attempts, in order:
 *   1. the attachment `url` (it carries a verifier) with the bearer token,
 *   2. the same URL without the token, for storage hosts that reject extra auth,
 *   3. a `session_token` web session that lands on the file.
 * An HTML page where a non-HTML file should be is Canvas's login page: it is
 * deleted, never kept as the file.
 */

export type DownloadErrorKind =
  'not_found' | 'forbidden' | 'locked' | 'signed_out' | 'offline' | 'server' | 'storage';

export class FileDownloadError extends Error {
  constructor(
    readonly kind: DownloadErrorKind,
    message: string,
    readonly status?: number,
    readonly origin?: { reason: DownloadErrorKind },
  ) {
    super(message);
    this.name = 'FileDownloadError';
  }
}

const messages: Record<DownloadErrorKind, string> = {
  not_found: 'This file was deleted or moved. Ask your instructor for a new link.',
  forbidden: 'You don’t have permission to download this file.',
  locked: 'This file is locked.',
  signed_out:
    'Canvas asked you to sign in again instead of sending the file. Try again, or open it in the browser.',
  offline: 'You’re offline, or Canvas can’t be reached. Connect and try again.',
  server: 'Canvas had a problem sending this file. Try again in a minute.',
  storage: 'Your device is out of space, or Easel couldn’t save the file.',
};

const fail = (kind: DownloadErrorKind, status?: number) =>
  new FileDownloadError(kind, messages[kind], status, { reason: kind });

const ROOT = 'easel-files';

const segment = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96);

/**
 * Where a copy lives. Files opened in the viewer go to the cache, which the OS
 * may clear when space runs low. Files a course sync downloads (OFF-3) are
 * kept under Documents, so they're there when the student is offline.
 */
export type CopyLocation = 'cache' | 'kept';

function accountRoot(accountId: string, where: CopyLocation) {
  return new Directory(where === 'kept' ? Paths.document : Paths.cache, ROOT, segment(accountId));
}

/** A filesystem-safe name that keeps the file's extension, so other apps know its type. */
export function localName(file: Pick<FileItem, 'name' | 'filename' | 'contentType'>): string {
  const ext = extensionFor(file);
  let base = file.name
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/^\.+/, '')
    .trim();
  if (!base) base = 'file';
  const hasExt = base.toLowerCase().endsWith(`.${ext}`);
  if (base.length > 120) base = base.slice(0, 120 - (ext.length + 1));
  if (ext && !hasExt) base = `${base.replace(/\.$/, '')}.${ext}`;
  return base;
}

const version = (file: FileItem) => String(file.updatedAt?.getTime() ?? file.modifiedAt?.getTime() ?? 0);

function fileDirectory(accountId: string, fileId: string, where: CopyLocation = 'cache') {
  return new Directory(accountRoot(accountId, where), segment(fileId));
}

function target(accountId: string, file: FileItem, where: CopyLocation = 'cache') {
  return new File(fileDirectory(accountId, file.id, where), version(file), localName(file));
}

/** The downloaded copy of this exact version, if there is one: kept first, then cached. */
export function cachedCopy(accountId: string, file: FileItem): File | null {
  for (const where of ['kept', 'cache'] as const) {
    try {
      const local = target(accountId, file, where);
      if (local.exists) return local;
    } catch {
      // Try the other place.
    }
  }
  return null;
}

/** Whether a copy of this exact version is kept for offline use. */
export function isKept(accountId: string, file: FileItem): boolean {
  try {
    return target(accountId, file, 'kept').exists;
  } catch {
    return false;
  }
}

type StoredMeta = Omit<FileItem, `${string}At`> & Record<`${string}At`, string | null>;

/** Metadata saved beside a download, so the viewer still opens it offline. */
function saveMeta(accountId: string, file: FileItem, where: CopyLocation = 'cache') {
  try {
    const meta = new File(fileDirectory(accountId, file.id, where), 'meta.json');
    meta.writeSync(JSON.stringify(file));
  } catch {
    // Offline metadata is a convenience.
  }
}

export function cachedMeta(accountId: string, fileId: string): FileItem | null {
  return storedMeta(accountId, fileId, 'kept') ?? storedMeta(accountId, fileId, 'cache');
}

function storedMeta(accountId: string, fileId: string, where: CopyLocation): FileItem | null {
  try {
    const meta = new File(fileDirectory(accountId, fileId, where), 'meta.json');
    if (!meta.exists) return null;
    const raw = JSON.parse(meta.textSync()) as StoredMeta;
    const toDate = (v: string | null | undefined) => (v ? new Date(v) : null);
    const item = {
      ...raw,
      createdAt: toDate(raw.createdAt),
      updatedAt: toDate(raw.updatedAt),
      modifiedAt: toDate(raw.modifiedAt),
      unlockAt: toDate(raw.unlockAt),
      lockAt: toDate(raw.lockAt),
    } as FileItem;
    return cachedCopy(accountId, item) ? item : null;
  } catch {
    return null;
  }
}

/** Older versions of a file go once a newer one is saved. */
function pruneVersions(accountId: string, file: FileItem, where: CopyLocation = 'cache') {
  try {
    const keep = version(file);
    for (const entry of fileDirectory(accountId, file.id, where).list()) {
      if (entry instanceof Directory && entry.name !== keep) entry.delete();
    }
  } catch {
    // Pruning is best effort.
  }
}

export type Download = { file: FileItem; local: File; size: number; kept: boolean };

/** Every downloaded file for an account, newest first (FILE-10). Kept copies count once. */
export function listDownloads(accountId: string): Download[] {
  const out = new Map<string, Download>();
  for (const where of ['kept', 'cache'] as const) {
    const root = accountRoot(accountId, where);
    if (!root.exists) continue;
    for (const entry of root.list()) {
      if (!(entry instanceof Directory) || out.has(entry.name)) continue;
      const meta = storedMeta(accountId, entry.name, where);
      const local = meta ? target(accountId, meta, where) : null;
      if (meta && local?.exists) out.set(entry.name, { file: meta, local, size: local.size ?? 0, kept: where === 'kept' });
    }
  }
  return [...out.values()].sort((a, b) => (b.local.modificationTime ?? 0) - (a.local.modificationTime ?? 0));
}

export function removeDownload(accountId: string, fileId: string, where?: CopyLocation) {
  for (const place of where ? [where] : (['kept', 'cache'] as const)) {
    try {
      const dir = fileDirectory(accountId, fileId, place);
      if (dir.exists) dir.delete();
    } catch {
      // Already gone.
    }
  }
}

/** Bytes used by downloaded files for an account, by location. */
export function downloadsSize(accountId: string): { cache: number; kept: number } {
  const size = (where: CopyLocation) => {
    try {
      const root = accountRoot(accountId, where);
      return root.exists ? (root.size ?? 0) : 0;
    } catch {
      return 0;
    }
  };
  return { cache: size('cache'), kept: size('kept') };
}

// Removing an account removes its downloads, cached and kept (AUTH-10).
registerAccountCleanup((accountId) => {
  for (const where of ['kept', 'cache'] as const) {
    try {
      const root = accountRoot(accountId, where);
      if (root.exists) root.delete();
    } catch {
      // Already gone.
    }
  }
});

/** Sniffs the first bytes: Canvas's login page arrives as a 200 HTML response. */
function isLoginPage(local: File, expectHtml: boolean): boolean {
  let handle: ReturnType<File['open']> | null = null;
  try {
    handle = local.open(FileMode.ReadOnly);
    const bytes = handle.readBytesSync(2048);
    let head = '';
    for (const byte of bytes) head += String.fromCharCode(byte);
    head = head
      .replace(/^﻿|^\xEF\xBB\xBF/, '')
      .trimStart()
      .toLowerCase();
    const html = /^<(!doctype html|html|head|body|meta|title)/.test(head) || head.includes('<html');
    if (!html) return false;
    if (!expectHtml) return true;
    // An HTML file that is really the login form.
    return /pseudonym_session|\/login\/canvas|action="\/login/.test(head);
  } catch {
    return false;
  } finally {
    handle?.close();
  }
}

/** Native download errors carry the HTTP status in their message ("HTTP 404", "status: 404"). */
function statusOf(error: unknown): number | null {
  const match = String((error as Error)?.message ?? '').match(/(?:HTTP|status:?)\s*(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

type Attempt = { url: string; headers?: Record<string, string> };

function sameHost(url: string, baseUrl: string) {
  try {
    return new URL(url).host === new URL(baseUrl).host;
  } catch {
    return false;
  }
}

function attempts(client: CanvasClient, file: FileItem): (Attempt | (() => Promise<Attempt>))[] {
  const canonical = `${client.baseUrl}/files/${file.id}/download?download_frd=1`;
  const url = file.url ?? canonical;
  const list: (Attempt | (() => Promise<Attempt>))[] = [];
  // The token only ever goes to the school's own Canvas host.
  if (sameHost(url, client.baseUrl)) list.push({ url, headers: client.authHeaders });
  list.push({ url });
  list.push(async () => ({ url: await sessionUrl(client, url) }));
  return list;
}

function abortError() {
  const error = new Error('Download cancelled');
  error.name = 'AbortError';
  return error;
}

export type Progress = { fraction: number | null; bytes: number };

export async function downloadFile(
  client: CanvasClient,
  accountId: string,
  file: FileItem,
  options: {
    onProgress?: (progress: Progress) => void;
    signal?: AbortSignal;
    /** Keep the copy for offline use (course sync) instead of in the cache. */
    keep?: boolean;
  } = {},
): Promise<File> {
  if (accountId === 'easel_demo') {
    if (!file.contentType.startsWith('image/') && file.contentType !== 'application/pdf') {
      const { t } = await import('@/i18n/runtime');
      throw new Error(t('demo.unavailable'));
    }
    const { demoImage, demoPdf } = await import('@/features/demo/assets');
    const destination = target(accountId, file, options.keep ? 'kept' : 'cache');
    destination.parentDirectory.create({ intermediates: true, idempotent: true });
    destination.write(file.contentType.startsWith('image/') ? demoImage.split(',')[1] : demoPdf, { encoding: 'base64' });
    return destination;
  }
  const where: CopyLocation = options.keep ? 'kept' : 'cache';
  const existing = cachedCopy(accountId, file);
  if (existing && (!options.keep || isKept(accountId, file))) return existing;
  if (existing && options.keep) {
    // Already downloaded to the cache: move it where it's kept.
    try {
      const destination = target(accountId, file, 'kept');
      destination.parentDirectory.create({ intermediates: true, idempotent: true });
      existing.moveSync(destination);
      saveMeta(accountId, file, 'kept');
      pruneVersions(accountId, file, 'kept');
      removeDownload(accountId, file.id, 'cache');
      return destination;
    } catch {
      // Fall through to a fresh download.
    }
  }
  if (file.lockedForUser) throw new FileDownloadError(
    'locked', file.lockExplanation ?? messages.locked, undefined,
    file.lockExplanation == null ? { reason: 'locked' } : undefined,
  );

  const destination = target(accountId, file, where);
  const folder = destination.parentDirectory;
  try {
    folder.create({ intermediates: true, idempotent: true });
  } catch {
    throw fail('storage');
  }

  const expectHtml = describeFile(file).kind === 'html';
  let sawLoginPage = false;
  let refused: number | null = null;

  for (const next of attempts(client, file)) {
    if (options.signal?.aborted) throw abortError();
    let attempt: Attempt;
    try {
      attempt = typeof next === 'function' ? await next() : next;
    } catch {
      continue;
    }
    const partial = new File(folder, `.download-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const task = File.createDownloadTask(attempt.url, partial, {
        headers: attempt.headers,
        sessionType: 'foreground',
        signal: options.signal,
        onProgress: (progress) => {
          // Native progress can arrive as BigInt.
          const written = Number(progress.bytesWritten);
          const total = Number(progress.totalBytes);
          options.onProgress?.({ fraction: total > 0 ? Math.min(1, written / total) : null, bytes: written });
        },
      });
      const result = await task.downloadAsync();
      if (!result) throw new Error('Download paused');
      if (isLoginPage(result, expectHtml)) {
        sawLoginPage = true;
        result.delete();
        continue;
      }
      // Native completion can arrive after cancellation/account cleanup. Never
      // promote those bytes or recreate metadata after the owner has gone.
      if (options.signal?.aborted) { if (result.exists) result.delete(); throw abortError(); }
      result.moveSync(destination, { overwrite: true });
      pruneVersions(accountId, file, where);
      saveMeta(accountId, file, where);
      return destination;
    } catch (error) {
      try {
        if (partial.exists) partial.delete();
      } catch {
        // Nothing to clean up.
      }
      if ((error as Error)?.name === 'AbortError' || options.signal?.aborted) throw error;
      const status = statusOf(error);
      if (status === 404 || status === 410) throw fail('not_found', status);
      if (status !== null && status >= 500) throw fail('server', status);
      if (status === null) {
        // A failed move or write means the disk, not the network.
        if (/move|write|space|disk/i.test(String((error as Error)?.message))) throw fail('storage');
        throw fail('offline');
      }
      refused = status;
    }
  }
  if (sawLoginPage) throw fail('signed_out');
  throw fail('forbidden', refused ?? undefined);
}

// --- Shared jobs ---------------------------------------------------------------------

type Job = {
  promise: Promise<File>;
  progress: Progress;
  controller: AbortController;
  listeners: Set<() => void>;
};

/** One download per file version, shared by the preview and every action that needs the bytes. */
const jobs = new Map<string, Job>();
const jobKey = (accountId: string, file: FileItem) => `${accountId}:${file.id}:${version(file)}`;

function startJob(client: CanvasClient, accountId: string, file: FileItem): Job {
  const key = jobKey(accountId, file);
  const running = jobs.get(key);
  if (running) return running;
  const controller = new AbortController();
  const job: Job = {
    progress: { fraction: 0, bytes: 0 },
    controller,
    listeners: new Set(),
    promise: Promise.resolve() as unknown as Promise<File>,
  };
  let last = 0;
  job.promise = downloadFile(client, accountId, file, {
    signal: controller.signal,
    onProgress: (progress) => {
      job.progress = progress;
      // Progress events arrive fast; a few repaints a second is plenty.
      const now = Date.now();
      if (now - last < 120 && progress.fraction !== 1) return;
      last = now;
      job.listeners.forEach((listener) => listener());
    },
  }).finally(() => {
    jobs.delete(key);
    job.listeners.forEach((listener) => listener());
  });
  jobs.set(key, job);
  return job;
}

export type DownloadState =
  | { status: 'idle'; local: null; progress: null; error: null }
  | { status: 'downloading'; local: null; progress: Progress; error: null }
  | { status: 'ready'; local: File; progress: null; error: null }
  | { status: 'error'; local: null; progress: null; error: FileDownloadError };

const idle: DownloadState = { status: 'idle', local: null, progress: null, error: null };

function asDownloadError(error: unknown): FileDownloadError {
  return error instanceof FileDownloadError ? error : fail('offline');
}

/**
 * The local copy of a file, downloading it on demand. `auto` starts right away
 * (previews that need the bytes); otherwise `ensure()` starts it (Share, Save).
 */
export function useFileDownload(file: FileItem | undefined, { auto = false }: { auto?: boolean } = {}) {
  const { client, account } = useCanvas();
  const key = file ? jobKey(account.id, file) : null;
  // State belongs to one file version; a new version starts over from the cache.
  const [entry, setEntry] = useState<{ key: string | null; state: DownloadState }>({
    key: null,
    state: idle,
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fromCache = useMemo<DownloadState>(() => {
    const local = file ? cachedCopy(account.id, file) : null;
    return local ? { status: 'ready', local, progress: null, error: null } : idle;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, entry]);
  const state = entry.key === key && entry.state.status !== 'idle' ? entry.state : fromCache;
  const setState = useCallback((next: DownloadState) => setEntry({ key, state: next }), [key]);

  const follow = useCallback(
    (job: Job) => {
      const update = () => {
        if (mounted.current && jobs.get(key ?? '') === job)
          setState({ status: 'downloading', local: null, progress: job.progress, error: null });
      };
      job.listeners.add(update);
      update();
      return job.promise.then(
        (local) => {
          job.listeners.delete(update);
          if (mounted.current) setState({ status: 'ready', local, progress: null, error: null });
          return local;
        },
        (error: unknown) => {
          job.listeners.delete(update);
          const cancelled = (error as Error)?.name === 'AbortError';
          if (mounted.current)
            setState(
              cancelled
                ? idle
                : { status: 'error', local: null, progress: null, error: asDownloadError(error) },
            );
          if (cancelled) return null;
          throw asDownloadError(error);
        },
      );
    },
    [key, setState],
  );

  /** Resolves with the local file, downloading it first if needed. Null if cancelled. */
  const ensure = useCallback(async (): Promise<File | null> => {
    if (!file) return null;
    const local = cachedCopy(account.id, file);
    if (local) {
      setState({ status: 'ready', local, progress: null, error: null });
      return local;
    }
    return follow(startJob(client, account.id, file));
  }, [file, account.id, client, follow, setState]);

  const cancel = useCallback(() => {
    if (key) jobs.get(key)?.controller.abort();
  }, [key]);

  // Join a download another screen already started, or start one for auto previews.
  useEffect(() => {
    if (!file || !key) return;
    if (cachedCopy(account.id, file)) return;
    const running = jobs.get(key);
    if (running) {
      follow(running).catch(() => {});
    } else if (auto && !file.lockedForUser) {
      follow(startJob(client, account.id, file)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, auto]);

  return { ...state, ensure, cancel };
}
