import type { FileItem } from '@/canvas/api/files';
import { openFile } from '@/features/files/open';

/**
 * Downloads from web pages and tools go to Easel's file viewer (LTI-4, FILE-1):
 * Canvas files by their ID, anything else as a file the viewer downloads
 * through the shared pipeline in `features/files/download.ts`.
 */

const CANVAS_FILE = /^\/(?:(?:courses|groups|users)\/\d+\/)?files\/(\d+)(?:\/(?:download|preview))?\/?$/;

/** The Canvas file a URL points at, if it's on the account's host. */
export function canvasFileId(url: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(url, baseUrl);
    if (parsed.host !== new URL(baseUrl).host) return null;
    return parsed.pathname.match(CANVAS_FILE)?.[1] ?? null;
  } catch {
    return null;
  }
}

const DOCUMENT_EXTENSIONS =
  /\.(pdf|docx?|xlsx?|pptx?|key|pages|numbers|zip|csv|txt|rtf|odt|ods|odp|epub|mp3|m4a|wav|mp4|mov|png|jpe?g|gif|heic)$/i;

/** Best guess, before loading, that a link is a file rather than a page. */
export function looksLikeDownload(url: string): boolean {
  try {
    const parsed = new URL(url);
    return DOCUMENT_EXTENSIONS.test(parsed.pathname) || /[?&]download(_frd)?=1\b/.test(url);
  } catch {
    return false;
  }
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  csv: 'text/csv',
  txt: 'text/plain',
  rtf: 'application/rtf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  heic: 'image/heic',
};

/** A stable ID per URL, so the same download isn't fetched twice. */
function idFor(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) hash = (Math.imul(31, hash) + url.charCodeAt(i)) | 0;
  return `web-${(hash >>> 0).toString(36)}`;
}

function nameFor(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    const decoded = decodeURIComponent(last);
    return decoded && decoded !== 'download' ? decoded : 'Download';
  } catch {
    return 'Download';
  }
}

/** A file record for a URL that isn't a Canvas file, for the viewer to download and show. */
export function webFile(url: string, name?: string, contentType?: string): FileItem {
  const filename = name || nameFor(url);
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return {
    id: idFor(url),
    name: filename,
    filename,
    contentType: contentType ?? MIME[ext] ?? '',
    size: null,
    url,
    thumbnailUrl: null,
    previewUrl: null,
    createdAt: null,
    updatedAt: null,
    modifiedAt: null,
    unlockAt: null,
    lockAt: null,
    lockedForUser: false,
    lockExplanation: null,
    hidden: false,
    folderId: null,
    mediaEntryId: null,
    context: null,
    uploader: null,
  };
}

/** Opens a download from a web page in Easel's file viewer. `name` is the page's suggested file name. */
export function openDownload(
  url: string,
  baseUrl: string,
  options: { courseId?: string; name?: string } = {},
) {
  const fileId = canvasFileId(url, baseUrl);
  if (fileId) {
    openFile(fileId, { courseId: options.courseId, canvasUrl: url });
    return;
  }
  const file = webFile(url, options.name);
  openFile(file.id, { files: [file] });
}
