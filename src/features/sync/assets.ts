import { Directory, File, Paths } from 'expo-file-system';

import { fetchFile } from '@/canvas/api/files';
import { fetchOfflineAsset, offlineAssetMime } from '@/canvas/api/offlineAssets';
import type { CanvasClient } from '@/canvas/client';
import { cachedCopy } from '@/features/files/download';
import { LocalStore } from '@/features/offline/store';

import {
  type AssetKind,
  type AssetReference,
  type OfflineNoticeRenderer,
  discoverAssets,
  rewriteAssetHtml,
} from './assetHtml';

// Data URLs keep WebView's existing sandbox intact. Short direct clips are supported;
// large lectures remain online. Bound network buffers, disk use and rendered HTML.
export const ASSET_LIMIT = 8 * 1024 * 1024;
export const COURSE_ASSET_LIMIT = 32 * 1024 * 1024;
export const DOCUMENT_ASSET_LIMIT = 16 * 1024 * 1024;
const MAX_ASSETS = 200;
type Asset = AssetReference & { name: string; mime: string; size: number };
type Index = Record<string, Record<string, Asset[]>>;
export const assetIndex = new LocalStore<Index>('sync.assets.v1', () => ({}));
const segment = (s: string) => `id-${encodeURIComponent(s)}`;
const root = (accountId: string) => new Directory(Paths.document, 'easel-assets', segment(accountId));
const directory = (accountId: string, courseId: string) => new Directory(root(accountId), segment(courseId));
const key = (r: AssetReference) => `${r.kind}:${r.url}`;
const matchesKind = (mime: string, kind: AssetKind) =>
  kind === 'image'
    ? mime.startsWith('image/')
    : kind === 'track'
      ? mime === 'text/vtt'
      : /^(audio|video)\//.test(mime);
const abort = () => Object.assign(new Error('Sync cancelled'), { name: 'AbortError' });
function records(accountId: string, courseId: string) {
  return assetIndex.get()[accountId]?.[courseId] ?? [];
}
function publish(accountId: string, courseId: string, assets: Asset[]) {
  assetIndex.update((s) => ({ ...s, [accountId]: { ...s[accountId], [courseId]: assets } }));
}
function removeFile(accountId: string, courseId: string, asset: Asset) {
  try {
    const file = new File(directory(accountId, courseId), asset.name);
    if (file.exists) file.delete();
  } catch {
    /* Already removed. */
  }
}
export function courseAssetBytes(accountId: string, courseId: string): number {
  try {
    const dir = directory(accountId, courseId);
    return dir.exists ? (dir.size ?? 0) : 0;
  } catch {
    return 0;
  }
}
export function removeCourseAssets(accountId: string, courseId: string) {
  try {
    const dir = directory(accountId, courseId);
    if (dir.exists) dir.delete();
  } catch {
    /* Already removed. */
  }
  assetIndex.update((s) => {
    const courses = { ...s[accountId] };
    delete courses[courseId];
    return { ...s, [accountId]: courses };
  });
}
export function removeAccountAssets(accountId: string) {
  try {
    const dir = root(accountId);
    if (dir.exists) dir.delete();
  } catch {
    /* Already removed. */
  }
  assetIndex.update((s) => {
    const next = { ...s };
    delete next[accountId];
    return next;
  });
}

export async function syncEmbeddedAssets(options: {
  accountId: string;
  courseId: string;
  client: CanvasClient;
  html: Set<string>;
  media: boolean;
  signal: AbortSignal;
  canSave: () => boolean;
  preservePrevious: boolean;
  onProgress: (done: number, total: number) => void;
}): Promise<{ skipped: number; unsupported: number }> {
  const { accountId, courseId, client, signal } = options;
  const wanted = new Map<string, AssetReference>();
  let unsupported = 0;
  for (const html of options.html) {
    const found = discoverAssets(html, client.baseUrl, options.media);
    unsupported += found.unsupported;
    for (const ref of found.resources) wanted.set(key(ref), ref);
  }
  const current = new Map(records(accountId, courseId).map((a) => [key(a), a]));
  let skipped = Math.max(0, wanted.size - MAX_ASSETS);
  const selected = [...wanted.values()].slice(0, MAX_ASSETS);
  let done = 0;
  // One embedded download at a time: at most 8 MiB in flight, plus its final copy.
  for (const ref of selected) {
    if (signal.aborted || !options.canSave()) throw abort();
    try {
      let url = ref.url;
      let downloaded: { bytes: Uint8Array; mime: string } | null = null;
      const parsed = new URL(url);
      const fileId =
        parsed.origin === new URL(client.baseUrl).origin
          ? parsed.pathname.match(
              /^\/(?:api\/v1\/|courses\/[^/]+\/)?files\/([0-9~]+)(?:\/(?:download|preview))?\/?$/,
            )?.[1]
          : undefined;
      if (fileId) {
        // Reauthorize through course-scoped Canvas metadata, never infer a storage host.
        const file = await fetchFile(client, fileId, { courseId, signal });
        if (file.lockedForUser || !file.url) throw new Error('File unavailable');
        url = file.url;
        const local = cachedCopy(accountId, file);
        const mime = offlineAssetMime(file.contentType ?? '');
        if (local && mime && local.size > 0 && local.size <= ASSET_LIMIT)
          downloaded = { bytes: local.bytesSync(), mime };
      }
      downloaded ??= await fetchOfflineAsset(client, url, signal, ASSET_LIMIT);
      if (signal.aborted || !options.canSave()) throw abort();
      if (!matchesKind(downloaded.mime, ref.kind)) throw new Error('Unexpected asset type');
      const previous = current.get(key(ref));
      const size = downloaded.bytes.byteLength;
      const previousFile = previous ? new File(directory(accountId, courseId), previous.name) : null;
      const previousSize = previousFile?.exists ? previousFile.size : 0;
      if (courseAssetBytes(accountId, courseId) - previousSize + size > COURSE_ASSET_LIMIT)
        throw new Error('Course asset limit reached');
      const dir = directory(accountId, courseId);
      dir.create({ intermediates: true, idempotent: true });
      const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.asset`;
      const local = new File(dir, name);
      try {
        local.writeSync(downloaded.bytes);
      } catch (error) {
        if (local.exists) local.delete();
        throw error;
      }
      // No await from the removal guard through file + index publication.
      current.set(key(ref), { ...ref, name, size, mime: downloaded.mime });
      publish(accountId, courseId, [...current.values()]);
      if (previous) removeFile(accountId, courseId, previous);
    } catch (error) {
      if (signal.aborted || !options.canSave() || (error as Error)?.name === 'AbortError') throw abort();
      skipped++;
    } finally {
      options.onProgress(++done, selected.length);
    }
  }
  // Partial syncs keep earlier usable media, just like snapshots and course files.
  if (!skipped && !options.preservePrevious) {
    for (const [id, asset] of current)
      if (!wanted.has(id)) {
        removeFile(accountId, courseId, asset);
        current.delete(id);
      }
    publish(accountId, courseId, [...current.values()]);
  }
  return { skipped, unsupported };
}

/** Exact URL + kind + account matches only; never let HTML choose a local path.
 * Optional notice rendering uses explicit viewing-language inputs, never the foreground store.
 */
export function offlineAssetHtml(
  accountId: string,
  baseUrl: string,
  html: string,
  index: Index = assetIndex.get(),
  renderNotice?: OfflineNoticeRenderer,
): string {
  const available = new Map<string, { courseId: string; asset: Asset }>();
  for (const [courseId, assets] of Object.entries(index[accountId] ?? {}))
    for (const asset of assets) available.set(key(asset), { courseId, asset });
  const memo = new Map<string, string | null>();
  let used = 0;
  return rewriteAssetHtml(html, baseUrl, (url, kind) => {
    const id = key({ url, kind });
    if (memo.has(id)) {
      const data = memo.get(id) ?? null;
      const size = available.get(id)?.asset.size ?? 0;
      if (used + size > DOCUMENT_ASSET_LIMIT) return null;
      used += size;
      return data;
    }
    const match = available.get(id);
    if (!match) return null;
    try {
      const file = new File(directory(accountId, match.courseId), match.asset.name);
      if (
        !file.exists ||
        !offlineAssetMime(match.asset.mime) ||
        !matchesKind(match.asset.mime, kind) ||
        file.size > ASSET_LIMIT ||
        used + file.size > DOCUMENT_ASSET_LIMIT
      )
        return null;
      used += file.size;
      const data = `data:${match.asset.mime};base64,${file.base64Sync()}`;
      memo.set(id, data);
      return data;
    } catch {
      memo.set(id, null);
      return null;
    }
  }, renderNotice);
}
