import type { Translate } from '@/i18n/types';

export type FolderUploadOrigin =
  { reason: 'quota' } | { reason: 'upload'; name: string } | { reason: 'picker' };

/** Only authored origin metadata is translated; legacy/server/unknown messages stay raw. */
export function folderUploadError(
  error: { message: string; origin?: FolderUploadOrigin },
  t: Translate,
): string {
  switch (error.origin?.reason) {
    case 'quota':
      return t('files.uploadError.quota');
    case 'upload':
      return t('files.uploadError.upload', { name: error.origin.name });
    case 'picker':
      return t('files.uploadError.picker');
    default:
      return error.message;
  }
}
