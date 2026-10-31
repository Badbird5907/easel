import { CanvasError, CanvasNetworkError } from '@/canvas/client';

/** Only authored messages carry this optional, JSON-safe provenance. */
export type UploadErrorOrigin =
  | { kind: 'network' | 'quota' | 'mediaService' | 'forbidden' | 'generic' | 'stopped' | 'lost' }
  | { kind: 'filetype'; name: string };

export const STOPPED = 'The upload stopped when Easel closed. Retry to send it again.';
export const LOST = 'Easel no longer has this file. Remove it and add it again.';

/** Reject unknown/malformed metadata without interpreting the accompanying raw text. */
export function uploadErrorOrigin(value: unknown): UploadErrorOrigin | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.hasOwn(value, 'kind') ||
    !('kind' in value)
  ) return;
  const keys = Object.keys(value);
  if (value.kind === 'filetype') {
    if (
      keys.length === 2 &&
      Object.hasOwn(value, 'name') &&
      'name' in value &&
      typeof value.name === 'string'
    )
      return { kind: 'filetype', name: value.name };
    return;
  }
  if (keys.length !== 1) return;
  switch (value.kind) {
    case 'network':
    case 'quota':
    case 'mediaService':
    case 'forbidden':
    case 'generic':
    case 'stopped':
    case 'lost':
      return { kind: value.kind };
  }
}

export function describeUploadError(
  error: unknown,
  name: string,
): {
  error: string;
  errorOrigin: UploadErrorOrigin;
} {
  if (error instanceof CanvasNetworkError)
    return {
      error: 'Couldn’t reach Canvas. Check your connection, then retry.',
      errorOrigin: { kind: 'network' },
    };
  if (error instanceof CanvasError) {
    if (/quota/i.test(error.message))
      return {
        error: 'Your Canvas storage is full. Delete files in Canvas, then retry.',
        errorOrigin: { kind: 'quota' },
      };
    if (/filetype|extension/i.test(error.message))
      return {
        error: `This assignment doesn’t accept ${name}.`,
        errorOrigin: { kind: 'filetype', name },
      };
    if (/media service/i.test(error.message))
      return {
        error: 'Canvas’s media service didn’t take the recording. Retry.',
        errorOrigin: { kind: 'mediaService' },
      };
    if (error.status === 403 || error.status === 401)
      return { error: 'Canvas didn’t allow this upload.', errorOrigin: { kind: 'forbidden' } };
  }
  return {
    error: 'The upload didn’t finish. Retry, or remove the file.',
    errorOrigin: { kind: 'generic' },
  };
}
