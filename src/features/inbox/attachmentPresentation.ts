import { CanvasError } from '@/canvas/client';
import { createTranslator, formatNumber } from '@/i18n/runtime';
import type { Translate } from '@/i18n/types';

/** JSON-safe origin for authored errors only; legacy/unknown errors remain verbatim. */
export type AttachmentErrorOrigin = { kind: 'attachment-quota' } | { kind: 'attachment-upload'; name: string };

export function uploadError(error: unknown, name: string): { error: string; errorOrigin: AttachmentErrorOrigin } {
  if (error instanceof CanvasError && /quota/i.test(error.message))
    return {
      error: 'Your Canvas file storage is full. Delete files in Canvas, then try again.',
      errorOrigin: { kind: 'attachment-quota' },
    };
  return {
    error: `Couldn’t upload ${name}. Check your connection and try again.`,
    errorOrigin: { kind: 'attachment-upload', name },
  };
}

export function attachmentErrorText(error: string | null, origin: unknown, t: Translate): string {
  if (origin && typeof origin === 'object' && 'kind' in origin) {
    if (origin.kind === 'attachment-quota') return t('attachment.storageFull');
    if (origin.kind === 'attachment-upload' && 'name' in origin && typeof origin.name === 'string')
      return t('attachment.uploadError', { name: origin.name });
  }
  return error ?? t('attachment.failed');
}

/** Explicit viewing locale; retain Math.round and the underlying numeric fraction. */
export function attachmentProgressText(fraction: number | null, locale: string): string {
  const t = createTranslator(locale);
  return fraction == null
    ? t('attachment.uploading')
    : t('attachment.uploadingPercent', {
        percent: formatNumber(Math.round(fraction * 100) / 100, { style: 'percent', maximumFractionDigits: 0 }, locale),
      });
}
