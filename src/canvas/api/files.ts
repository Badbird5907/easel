import { useListPlaceholder } from './cacheSeed';
import { CanvasAuthError, type CanvasClient, CanvasError } from '../client';
import { useCanvasQuery } from '../query';
import type { CanvasAttachment } from '../types';

/**
 * Files and folders. Raw shapes follow lib/api/v1/attachment.rb and
 * lib/api/v1/folders.rb; screens only see the models below.
 */

// --- Raw API shapes ---------------------------------------------------------------

/** `GET /api/v1/files/:id` and folder file lists: attachment JSON plus what `api_show` adds. */
export type CanvasFile = CanvasAttachment & {
  uuid?: string;
  folder_id?: string | null;
  hidden?: boolean;
  hidden_for_user?: boolean;
  unlock_at?: string | null;
  lock_at?: string | null;
  lock_explanation?: string;
  lock_info?: { unlock_at?: string; lock_at?: string; manually_locked?: boolean } | null;
  mime_class?: string | null;
  media_entry_id?: string | null;
  /** Present on `api_show` when the school has Canvadocs and the file is unlocked. */
  canvadoc_session_url?: string | null;
  /** `include[]=context_asset_string`, e.g. `course_201`. */
  context_asset_string?: string | null;
  user?: { id?: string; display_name?: string } | null;
};

/** Folder JSON (lib/api/v1/folders.rb). */
export type CanvasFolder = {
  id: string;
  name: string;
  full_name: string;
  parent_folder_id: string | null;
  context_type: 'Course' | 'Group' | 'User' | 'Account';
  context_id: string;
  position?: number | null;
  unlock_at?: string | null;
  lock_at?: string | null;
  created_at?: string;
  updated_at?: string;
  locked?: boolean;
  hidden?: boolean;
  locked_for_user?: boolean;
  hidden_for_user?: boolean;
  files_count?: number;
  folders_count?: number;
  for_submissions?: boolean;
  can_upload?: boolean;
};

/**
 * The attachment JSON other features already hold (announcements, discussions,
 * inbox, submissions). Only `id` and `display_name` are required.
 */
export type AttachmentInput = Pick<CanvasAttachment, 'display_name'> &
  Partial<Omit<CanvasFile, 'id' | 'display_name'>> & { id: string | number };

// --- Models -------------------------------------------------------------------------

export type FilesContextType = 'courses' | 'groups' | 'users';

/** Whose files: a course, a group, or a user (`users/self` is My Files). */
export type FilesContext = { type: FilesContextType; id: string };

export type FileItem = {
  id: string;
  /** What Canvas shows: `display_name`. */
  name: string;
  /** The stored filename, which can differ from the display name. */
  filename: string;
  /** Raw MIME type. For decisions only; never shown. Use `describeFile()` for labels. */
  contentType: string;
  size: number | null;
  /** Download URL with a verifier. Null when locked or unknown. */
  url: string | null;
  thumbnailUrl: string | null;
  /** DocViewer (Canvadocs) session, when the school has it. */
  previewUrl: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  modifiedAt: Date | null;
  unlockAt: Date | null;
  lockAt: Date | null;
  lockedForUser: boolean;
  lockExplanation: string | null;
  /** Only visible by link. */
  hidden: boolean;
  folderId: string | null;
  mediaEntryId: string | null;
  context: { type: 'course' | 'group' | 'user'; id: string } | null;
  uploader: string | null;
};

export type FolderItem = {
  id: string;
  name: string;
  fullName: string;
  parentId: string | null;
  context: FilesContext;
  filesCount: number | null;
  foldersCount: number | null;
  lockedForUser: boolean;
  /** Locked or scheduled, even if the current user can still open it. */
  locked: boolean;
  hidden: boolean;
  unlockAt: Date | null;
  lockAt: Date | null;
  canUpload: boolean;
  forSubmissions: boolean;
  updatedAt: Date | null;
};

const date = (value: string | null | undefined) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

function contextFromAssetString(asset: string | null | undefined): FileItem['context'] {
  const match = asset?.match(/^(course|group|user)_(\d+)$/);
  return match ? { type: match[1] as 'course' | 'group' | 'user', id: match[2] } : null;
}

export function toFileItem(raw: AttachmentInput): FileItem {
  const lockedForUser = raw.locked_for_user ?? false;
  return {
    id: String(raw.id),
    name: raw.display_name || raw.filename || 'File',
    filename: raw.filename ? decodeURIComponent(raw.filename.replace(/\+/g, ' ')) : raw.display_name,
    contentType: raw['content-type'] ?? '',
    size: typeof raw.size === 'number' ? raw.size : null,
    url: raw.url ? raw.url : null,
    thumbnailUrl: raw.thumbnail_url || null,
    previewUrl: raw.canvadoc_session_url || raw.preview_url || null,
    createdAt: date(raw.created_at),
    updatedAt: date(raw.updated_at),
    modifiedAt: date(raw.modified_at ?? raw.updated_at),
    unlockAt: date(raw.unlock_at ?? raw.lock_info?.unlock_at),
    lockAt: date(raw.lock_at ?? raw.lock_info?.lock_at),
    lockedForUser,
    lockExplanation: lockedForUser ? (raw.lock_explanation ?? null) : null,
    hidden: raw.hidden ?? false,
    folderId: raw.folder_id ? String(raw.folder_id) : null,
    mediaEntryId: raw.media_entry_id ?? null,
    context: contextFromAssetString(raw.context_asset_string),
    uploader: raw.user?.display_name ?? null,
  };
}

const contextTypes: Record<CanvasFolder['context_type'], FilesContextType> = {
  Course: 'courses',
  Group: 'groups',
  User: 'users',
  Account: 'courses',
};

export function toFolderItem(raw: CanvasFolder): FolderItem {
  return {
    id: String(raw.id),
    name: raw.name,
    fullName: raw.full_name,
    parentId: raw.parent_folder_id ? String(raw.parent_folder_id) : null,
    context: { type: contextTypes[raw.context_type] ?? 'courses', id: String(raw.context_id) },
    filesCount: raw.files_count ?? null,
    foldersCount: raw.folders_count ?? null,
    lockedForUser: raw.locked_for_user ?? false,
    locked: (raw.locked ?? false) || !!raw.lock_at || !!raw.unlock_at,
    hidden: raw.hidden ?? false,
    unlockAt: date(raw.unlock_at),
    lockAt: date(raw.lock_at),
    canUpload: raw.can_upload ?? false,
    forSubmissions: raw.for_submissions ?? false,
    updatedAt: date(raw.updated_at),
  };
}

// --- Fetchers -----------------------------------------------------------------------

/**
 * Canvas answers "you can't see this" with 401, the same status as a bad token
 * (`render_unauthorized_action`). Before treating a 401 as an expired token, check
 * the token itself, so a single private file never signs the student out.
 */
async function withPermissionCheck<T>(
  client: CanvasClient,
  path: string,
  request: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof CanvasAuthError)) throw error;
    const tokenWorks = await client.get('/api/v1/users/self', undefined, signal).then(
      () => true,
      (e: unknown) => !(e instanceof CanvasAuthError),
    );
    if (tokenWorks) throw new CanvasError('You don’t have permission to open this.', 403, path);
    throw error;
  }
}

export async function fetchFile(
  client: CanvasClient,
  fileId: string,
  options: { courseId?: string; signal?: AbortSignal } = {},
): Promise<FileItem> {
  const query = { include: ['context_asset_string', 'user'] };
  const get = (path: string) =>
    withPermissionCheck(
      client,
      path,
      () => client.get<CanvasFile>(path, query, options.signal),
      options.signal,
    );
  let raw: CanvasFile;
  if (options.courseId) {
    try {
      // The course route also follows replaced files (a newer upload with the same name).
      raw = await get(`/api/v1/courses/${options.courseId}/files/${fileId}`);
    } catch (error) {
      // Course links sometimes point at files that live elsewhere.
      if (!(error instanceof CanvasError && error.status === 404)) throw error;
      raw = await get(`/api/v1/files/${fileId}`);
    }
  } else {
    raw = await get(`/api/v1/files/${fileId}`);
  }
  const file = toFileItem(raw);
  if (!file.context && options.courseId) file.context = { type: 'course', id: options.courseId };
  return file;
}

const contextPath = (context: FilesContext) => `/api/v1/${context.type}/${context.id}`;

export async function fetchRootFolder(client: CanvasClient, context: FilesContext, signal?: AbortSignal) {
  const path = `${contextPath(context)}/folders/root`;
  const raw = await withPermissionCheck(
    client,
    path,
    () => client.get<CanvasFolder>(path, undefined, signal),
    signal,
  );
  return toFolderItem(raw);
}

export async function fetchFolder(client: CanvasClient, folderId: string, signal?: AbortSignal) {
  const path = `/api/v1/folders/${folderId}`;
  const raw = await withPermissionCheck(
    client,
    path,
    () => client.get<CanvasFolder>(path, undefined, signal),
    signal,
  );
  return toFolderItem(raw);
}

/** A folder from its path, as Canvas web URLs name them (`/courses/1/files/folder/Labs/Week 3`). */
export async function fetchFolderByPath(client: CanvasClient, context: FilesContext, path: string) {
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part));
  const chain = await client.get<CanvasFolder[]>(
    `${contextPath(context)}/folders/by_path/${segments.join('/')}`,
  );
  const last = chain[chain.length - 1];
  if (!last) throw new CanvasError('The specified resource does not exist.', 404, path);
  return toFolderItem(last);
}

export type FileSort = 'name' | 'updated_at' | 'size' | 'content_type';
export type SortOrder = 'asc' | 'desc';
export type FolderContents = { folders: FolderItem[]; files: FileItem[] };

export async function fetchFolderContents(
  client: CanvasClient,
  folderId: string,
  sort: { by: FileSort; order: SortOrder },
  signal?: AbortSignal,
): Promise<FolderContents> {
  const path = `/api/v1/folders/${folderId}`;
  const [folders, files] = await withPermissionCheck(
    client,
    path,
    () =>
      Promise.all([
        client.getAll<CanvasFolder>(`${path}/folders`, undefined, { signal }),
        client.getAll<CanvasFile>(
          `${path}/files`,
          { sort: sort.by, order: sort.order, include: ['user'] },
          { signal },
        ),
      ]),
    signal,
  );
  return { folders: folders.map(toFolderItem), files: files.map(toFileItem) };
}

/** Canvas rejects shorter search terms with a 400. */
export const MIN_SEARCH_LENGTH = 2;

/** Searches every folder in a context by name. */
export async function searchFiles(
  client: CanvasClient,
  context: FilesContext,
  term: string,
  sort: { by: FileSort; order: SortOrder },
  signal?: AbortSignal,
): Promise<FolderContents> {
  const base = contextPath(context);
  const [folders, files] = await withPermissionCheck(
    client,
    base,
    () =>
      Promise.all([
        client
          .getAll<CanvasFolder>(`${base}/folders`, { search_term: term }, { signal, maxPages: 5 })
          // Folder search is a convenience; file results still help without it.
          .catch((error: unknown) => {
            if (error instanceof CanvasAuthError) throw error;
            return [] as CanvasFolder[];
          }),
        client.getAll<CanvasFile>(
          `${base}/files`,
          { search_term: term, sort: sort.by, order: sort.order },
          { signal, maxPages: 10 },
        ),
      ]),
    signal,
  );
  return {
    folders: folders.filter((f) => f.parent_folder_id).map(toFolderItem),
    files: files.map(toFileItem),
  };
}

// --- Hooks --------------------------------------------------------------------------

export const fileKey = (fileId: string) => ['files', 'file', fileId] as const;

/**
 * One file's metadata. `seed` (attachment JSON a screen already has) renders
 * immediately while the full record loads.
 */
export function useFile(fileId: string, options: { courseId?: string; seed?: FileItem } = {}) {
  const fromList = useListPlaceholder<FolderContents, FileItem>(['files'],
    (list) => list.files?.find((item) => item.id === fileId));
  return useCanvasQuery<FileItem>(
    fileKey(fileId),
    (client, signal) => fetchFile(client, fileId, { courseId: options.courseId, signal }),
    {
      placeholderData: () => options.seed ?? fromList(),
    },
  );
}

export function useRootFolder(context: FilesContext) {
  return useCanvasQuery(['files', 'root', context.type, context.id], (client, signal) =>
    fetchRootFolder(client, context, signal),
  );
}

export function useFolder(folderId: string | undefined) {
  return useCanvasQuery(
    ['files', 'folder', folderId ?? ''],
    (client, signal) => fetchFolder(client, folderId!, signal),
    { enabled: !!folderId },
  );
}

export function useFolderContents(folderId: string | undefined, sort: { by: FileSort; order: SortOrder }) {
  return useCanvasQuery(
    ['files', 'contents', folderId ?? '', sort.by, sort.order],
    (client, signal) => fetchFolderContents(client, folderId!, sort, signal),
    { enabled: !!folderId },
  );
}

export function useFileSearch(context: FilesContext, term: string, sort: { by: FileSort; order: SortOrder }) {
  const trimmed = term.trim();
  return useCanvasQuery(
    ['files', 'search', context.type, context.id, trimmed.toLowerCase(), sort.by, sort.order],
    (client, signal) => searchFiles(client, context, trimmed, sort, signal),
    { enabled: trimmed.length >= MIN_SEARCH_LENGTH, placeholderData: (previous) => previous },
  );
}

// --- Upload (My Files) -----------------------------------------------------------------

type UploadPreflight = {
  upload_url: string;
  upload_params: Record<string, string>;
  file_param?: string;
};

/**
 * Canvas's two-step upload: ask where to send the bytes, then send them. The caller
 * performs the byte upload (it needs the platform file API); this returns the target.
 */
export async function startUpload(
  client: CanvasClient,
  folderId: string,
  file: { name: string; size: number | null; contentType: string },
): Promise<UploadPreflight> {
  return client.post<UploadPreflight>('/api/v1/users/self/files', {
    name: file.name,
    size: file.size ?? undefined,
    content_type: file.contentType,
    parent_folder_id: folderId,
    on_duplicate: 'rename',
  });
}

/** Step three for uploads that answer with a redirect: confirm and read the file JSON. */
export async function confirmUpload(client: CanvasClient, location: string): Promise<FileItem> {
  return toFileItem(await client.get<CanvasFile>(location));
}
