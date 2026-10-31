import { router } from 'expo-router';

import { type AttachmentInput, type FileItem, toFileItem } from '@/canvas/api/files';

/**
 * Attachment JSON a screen already had when it opened the viewer, keyed by file ID.
 * The viewer renders from it right away and falls back to it when Canvas won't
 * serve `GET /api/v1/files/:id` for an attachment the student can still download
 * (some inbox and submission attachments).
 */
const seeds = new Map<string, FileItem>();
const MAX_SEEDS = 200;

export function rememberFiles(files: (AttachmentInput | FileItem)[]) {
  for (const file of files) {
    const item = 'contentType' in file ? file : toFileItem(file);
    seeds.delete(item.id);
    seeds.set(item.id, item);
  }
  while (seeds.size > MAX_SEEDS) seeds.delete(seeds.keys().next().value!);
}

export function seededFile(fileId: string): FileItem | undefined {
  return seeds.get(fileId);
}

export type OpenFileOptions = {
  /** The course the link came from. Scopes the lookup and labels the file card. */
  courseId?: string;
  /** The Canvas web URL, for "Share link". */
  canvasUrl?: string;
  /**
   * Every file in the same message, post, or folder, in order. The viewer swipes
   * between them (FILE-8). Include the opened file.
   */
  files?: (AttachmentInput | FileItem)[];
};

/** Opens Easel's file viewer (FILE-1). Every entry point uses this. */
export function openFile(fileId: string, opts: OpenFileOptions = {}) {
  const siblings = opts.files ?? [];
  if (siblings.length) rememberFiles(siblings);
  const ids = siblings.map((f) => String(f.id));
  const params: Record<string, string> = { fileId: String(fileId) };
  if (opts.courseId) params.courseId = opts.courseId;
  if (opts.canvasUrl) params.canvasUrl = opts.canvasUrl;
  if (ids.length > 1 && ids.includes(String(fileId))) params.ids = ids.join(',');
  router.push({ pathname: '/file/[fileId]', params } as never);
}
