import { File, UploadType } from 'expo-file-system';

import { type CanvasFile, type FileItem, toFileItem } from './api/files';
import { type CanvasClient, CanvasError, CanvasNetworkError } from './client';

/** A local file ready to send: from the document picker, image picker, camera, or a recording. */
export type LocalFile = {
  uri: string;
  name: string;
  size?: number | null;
  mimeType?: string | null;
};

type Preflight = {
  upload_url: string;
  upload_params: Record<string, string>;
  file_param?: string;
};

/**
 * Canvas's three-step upload (`doc/api/file_uploads.md`), shared by My Files,
 * submissions, submission comments, quiz answers, and messages.
 *
 * 1. POST the file's name, size, and type to `preflightPath` (plus `params`,
 *    e.g. `parent_folder_id` or `on_duplicate`). Canvas answers with an upload URL.
 * 2. Send the bytes there as multipart form data, reporting progress.
 * 3. Confirm: the upload answers with the file JSON, a `location` to read, or a
 *    redirect to it.
 *
 * Preflight paths:
 * - My Files: `/api/v1/users/self/files`
 * - Submission: `/api/v1/courses/:id/assignments/:id/submissions/self/files`
 * - Submission comment: `/api/v1/courses/:id/assignments/:id/submissions/self/comments/files`
 * - Quiz answer: `/api/v1/courses/:id/quizzes/:id/submissions/self/files`
 * - Message attachment: My Files with `parent_folder_path` of the conversation attachments folder
 */
export async function uploadToCanvas(
  client: CanvasClient,
  preflightPath: string,
  file: LocalFile,
  options: {
    params?: Record<string, string | number | boolean | undefined>;
    /** 0 to 1, or null when the total size is unknown. */
    onProgress?: (fraction: number | null) => void;
    signal?: AbortSignal;
  } = {},
): Promise<FileItem> {
  const contentType = file.mimeType || 'application/octet-stream';
  const preflight = await client.post<Preflight | { attachments: Preflight[] }>(preflightPath, {
    name: file.name,
    size: file.size ?? undefined,
    content_type: contentType,
    ...options.params,
  });
  // Quiz answer preflights wrap the target in `attachments`.
  const target = 'attachments' in preflight ? preflight.attachments[0] : preflight;

  const result = await new File(file.uri).upload(target.upload_url, {
    httpMethod: 'POST',
    uploadType: UploadType.MULTIPART,
    fieldName: target.file_param ?? 'file',
    parameters: target.upload_params,
    mimeType: contentType,
    // iOS keeps a background session's transfer going while Easel is suspended (PRD 8, uploads
    // survive backgrounding). Android uploads while the process lives; see uploadStore.ts.
    sessionType: 'background',
    signal: options.signal,
    onProgress: progressReporter(options.onProgress),
  });

  const location = result.headers.Location ?? result.headers.location;
  if (result.status >= 300 && result.status < 400 && location) {
    return toFileItem(await client.get<CanvasFile>(location));
  }
  if (result.status >= 200 && result.status < 300) {
    const json = JSON.parse(result.body || '{}') as Partial<CanvasFile> & { location?: string };
    if (json.id && json.display_name) return toFileItem(json as CanvasFile);
    if (json.location) return toFileItem(await client.get<CanvasFile>(json.location));
  }
  throw new CanvasError(`Upload failed (${result.status}).`, result.status, target.upload_url);
}

function progressReporter(onProgress?: (fraction: number | null) => void) {
  return (progress: { bytesSent: number | bigint; totalBytes: number | bigint }) => {
    // Native progress can arrive as BigInt.
    const sent = Number(progress.bytesSent);
    const total = Number(progress.totalBytes);
    onProgress?.(total > 0 ? Math.min(1, sent / total) : null);
  };
}

// --- Media recordings (ASSIGN-6) ----------------------------------------------------

/** `GET /api/v1/services/kaltura` (services_api_controller.rb#show_kaltura_config). */
export type MediaService = { enabled: boolean };

/** Whether the school's Canvas stores audio and video recordings (Kaltura). */
export async function fetchMediaService(client: CanvasClient, signal?: AbortSignal): Promise<MediaService> {
  const data = await client.get<{ enabled?: boolean }>('/api/v1/services/kaltura', undefined, signal);
  return { enabled: !!data?.enabled };
}

export type MediaEntry = { id: string; type: 'audio' | 'video' };

type KalturaSession = {
  ks: string;
  kaltura_setting?: { domain?: string; protocol?: string } | null;
};

/** The `<id>` in a Kaltura API XML response. */
function kalturaId(xml: string): string | null {
  const error = /<error>[\s\S]*?<message>([^<]*)<\/message>/.exec(xml);
  if (error) return null;
  return /<result>[\s\S]*?<id>([^<]+)<\/id>/.exec(xml)?.[1] ?? /<id>([^<]+)<\/id>/.exec(xml)?.[1] ?? null;
}

async function kalturaPost(base: string, query: Record<string, string>, form: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(`${base}/api_v3/index.php?${new URLSearchParams(query)}`, {
      method: 'POST',
      headers: { Accept: 'application/xml', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new CanvasNetworkError();
  }
  const text = await response.text();
  const id = response.ok ? kalturaId(text) : null;
  if (!id) throw new CanvasError('The media service didn’t accept the recording.', response.status, base);
  return id;
}

/**
 * Uploads an audio or video recording the way the official apps do
 * (canvas-ios UploadMedia.swift), so it can be submitted as `media_recording`:
 *
 * 1. `POST /api/v1/services/kaltura_session?include_upload_config=1` for a Kaltura session.
 * 2. Kaltura `uploadtoken.add`, then `uploadtoken.upload` with the bytes (a background
 *    session on iOS, with progress).
 * 3. Kaltura `media.addFromUploadedFile` for the entry ID.
 * 4. `POST /api/v1/media_objects` so Canvas knows the entry belongs to this course.
 *
 * Schools without Kaltura can't take media submissions at all; `fetchMediaService` says so first.
 */
export async function uploadMediaToKaltura(
  client: CanvasClient,
  file: LocalFile,
  options: {
    type: 'audio' | 'video';
    /** `course_123`: who the media object belongs to. */
    contextCode: string;
    onProgress?: (fraction: number | null) => void;
    signal?: AbortSignal;
  },
): Promise<MediaEntry> {
  const session = await client.post<KalturaSession>(
    '/api/v1/services/kaltura_session?include_upload_config=1',
    {},
  );
  const domain = session.kaltura_setting?.domain;
  if (!session.ks || !domain)
    throw new CanvasError('The media service isn’t set up.', 400, 'kaltura_session');
  const protocol = session.kaltura_setting?.protocol || 'https';
  const base = /^https?:\/\//.test(domain) ? domain : `${protocol}://${domain}`;
  const ks = session.ks;

  const token = await kalturaPost(base, { service: 'uploadtoken', action: 'add' }, { ks });
  const upload = await new File(file.uri).upload(
    `${base}/api_v3/index.php?${new URLSearchParams({ service: 'uploadtoken', action: 'upload', uploadTokenId: token, ks })}`,
    {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'fileData',
      mimeType: file.mimeType || (options.type === 'audio' ? 'audio/mp4' : 'video/mp4'),
      sessionType: 'background',
      signal: options.signal,
      onProgress: progressReporter(options.onProgress),
    },
  );
  if (upload.status < 200 || upload.status >= 300 || /<error>/.test(upload.body ?? ''))
    throw new CanvasError(`Upload failed (${upload.status}).`, upload.status, base);

  const entryId = await kalturaPost(
    base,
    { service: 'media', action: 'addFromUploadedFile', uploadTokenId: token, ks },
    { 'mediaEntry:name': file.name, 'mediaEntry:mediaType': options.type === 'audio' ? '5' : '1' },
  );
  await client.post('/api/v1/media_objects', {
    id: entryId,
    type: options.type,
    context_code: options.contextCode,
    title: file.name,
    user_entered_title: file.name,
  });
  return { id: entryId, type: options.type };
}
