import type { ResolvedSharePayload, SharePayload } from 'expo-sharing';
import { useSyncExternalStore } from 'react';

import type { LocalFile } from '@/canvas/uploads';
import { describeFile } from '@/features/files/kinds';

/**
 * What another app shared with Easel (ASSIGN-16, SYS-2), in the shapes the rest
 * of the app uses: local files ready for `uploadToCanvas`, a web address, or text.
 *
 * The share screen sets it from `useShareIntake()`; the course, assignment, and
 * folder pickers it pushes read it from here, since the OS share payload is
 * cleared once the student acts on it.
 */

export type SharedFile = LocalFile & { isImage: boolean };

export type SharedContent = {
  files: SharedFile[];
  /** A web address, from a URL share or text that is only an address. */
  url: string | null;
  text: string | null;
};

/** What the content can be turned in as. Files win, then a URL, then text. */
export type SharedKind = 'files' | 'url' | 'text' | 'none';

export const EMPTY: SharedContent = { files: [], url: null, text: null };

export function kindOf(content: SharedContent): SharedKind {
  if (content.files.length) return 'files';
  if (content.url) return 'url';
  if (content.text?.trim()) return 'text';
  return 'none';
}

/** A string that is only a web address, like `https://school.instructure.com/courses/1`. */
export function asUrl(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? '';
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The first web address inside some text, for "Open in Easel" on a shared message. */
export function firstUrl(text: string | null | undefined): string | null {
  const match = text?.match(/https?:\/\/[^\s<>"']+/i);
  return match ? asUrl(match[0].replace(/[.,;:!?)\]]+$/, '')) : null;
}

const lastSegment = (uri: string) => {
  const segment = uri.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

function fileFrom(
  uri: string,
  name: string | null,
  size: number | null,
  mimeType: string | null,
): SharedFile {
  const fileName = name?.trim() || lastSegment(uri) || 'Shared file';
  const type = mimeType && mimeType !== 'application/octet-stream' ? mimeType : null;
  const resolvedType = type ?? (describeFile({ name: fileName }).mimeType || null);
  return {
    uri,
    name: fileName,
    size,
    mimeType: resolvedType,
    isImage: (resolvedType ?? '').startsWith('image/') || describeFile({ name: fileName }).kind === 'image',
  };
}

const FILE_TYPES = new Set(['file', 'image', 'video', 'audio']);

/**
 * Builds the content from the raw payloads, with details from the resolved ones
 * when they've arrived. Files need the resolved payload: on Android the raw value
 * is a `content://` URI only the share intent can read, and resolving copies it.
 */
export function toSharedContent(raw: SharePayload[], resolved: ResolvedSharePayload[]): SharedContent {
  const files: SharedFile[] = [];
  let url: string | null = null;
  const texts: string[] = [];

  for (const payload of raw) {
    const type = payload.shareType ?? 'text';
    if (type === 'url') {
      url ??= asUrl(payload.value) ?? (payload.value?.trim() || null);
    } else if (type === 'text') {
      const value = payload.value ?? '';
      const only = asUrl(value);
      if (only) url ??= only;
      else if (value.trim()) texts.push(value.trim());
    }
  }

  for (const payload of resolved) {
    if (!payload.contentType || !FILE_TYPES.has(payload.contentType) || !payload.contentUri) continue;
    files.push(
      fileFrom(payload.contentUri, payload.originalName, payload.contentSize, payload.contentMimeType),
    );
  }

  return { files, url, text: texts.length ? texts.join('\n\n') : null };
}

/** Raw payloads that are files, which wait for resolving before they can be used. */
export const fileCount = (raw: SharePayload[]) =>
  raw.filter((p) => FILE_TYPES.has(p.shareType ?? 'text')).length;

// The content the pickers act on.

export type SharedContentSnapshot = { readonly revision: number; readonly content: SharedContent };

let current: SharedContentSnapshot = Object.freeze({ revision: 0, content: EMPTY });
const listeners = new Set<() => void>();

export function setSharedContent(content: SharedContent) {
  // Every publication retires old picker controls, including A -> B -> A and
  // publishing a mutated object again before React has committed a new render.
  const published = Object.freeze({ revision: current.revision + 1, content });
  current = published;
  for (const listener of listeners) listener();
  // A subscriber may synchronously publish again; return this invocation's record.
  return published;
}

export const getSharedContentSnapshot = (): SharedContentSnapshot => current;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSharedContent(): SharedContent {
  return useSyncExternalStore(
    subscribe,
    () => current.content,
    () => current.content,
  );
}

/** Subscribe to publications, even when their content reference is unchanged. */
export function useSharedContentSnapshot(): SharedContentSnapshot {
  return useSyncExternalStore(subscribe, getSharedContentSnapshot, getSharedContentSnapshot);
}

/** "2 files", "a link", "your text": what the share is, for confirmations. */
export function describeShared(content: SharedContent): string {
  switch (kindOf(content)) {
    case 'files':
      return content.files.length === 1 ? content.files[0].name : `${content.files.length} files`;
    case 'url':
      return 'the link';
    case 'text':
      return 'the text';
    default:
      return 'nothing';
  }
}
