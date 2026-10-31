import type { Translate } from '@/i18n';

import { extensionList } from './rules';
import type { Notice } from './useAddFiles';

export const pickerLabels = {
  file: 'submissionPicker.file',
  photos: 'submissionPicker.photos',
  photo: 'submissionPicker.photo',
  video: 'submissionPicker.video',
  audio: 'submissionPicker.audio',
  scan: 'submissionPicker.scan',
} as const;
export type PickerOption = keyof typeof pickerLabels;
export type PickerNotice =
  | { reason: 'rejected'; count: number; name: string; extensions: string[] }
  | { reason: 'unavailable'; detail: string; origin?: string }
  | { reason: 'picker' | 'settings'; detail?: string };

/** Only the explicit tag from the local camera producer authorizes translation. */
export function cameraPermissionBody(detail: string, origin: string | undefined, t: Translate) {
  return origin === 'camera-permission' ? t('submissionPicker.permissionBody') : detail;
}

export function pickerNotice(notice: PickerNotice, t: Translate, locale: string): Notice {
  switch (notice.reason) {
    case 'rejected':
      return {
        tone: 'warning',
        title:
          notice.count === 1
            ? t('submissionPicker.rejectedOne', { name: notice.name })
            : t('submissionPicker.rejectedMany', { count: notice.count }),
        body: t('submissionPicker.onlyAccepts', {
          extensions: extensionList(notice.extensions, locale),
        }),
      };
    case 'unavailable':
      return {
        tone: 'warning',
        title: t('submissionPicker.unavailableTitle'),
        body:
          notice.origin === 'camera-unavailable'
            ? t('submissionPicker.unavailableBody')
            : notice.detail,
      };
    case 'picker':
    case 'settings':
      return {
        tone: 'danger',
        title: t(
          notice.reason === 'picker'
            ? 'submissionPicker.errorTitle'
            : 'submissionPicker.settingsTitle',
        ),
        body:
          notice.detail ??
          t(
            notice.reason === 'picker'
              ? 'submissionPicker.errorBody'
              : 'submissionPicker.settingsBody',
          ),
      };
  }
}

export function pickerPresentation(
  keys: PickerOption[],
  extensions: string[],
  t: Translate,
  locale: string,
) {
  return {
    title: t('submissionPicker.title'),
    message: extensions.length
      ? t('submissionPicker.accepts', {
          extensions: extensionList(extensions, locale),
        })
      : undefined,
    options: keys.map((key) => t(pickerLabels[key])),
  };
}

/** Empty and same-text native messages are still raw messages. */
export function pickerErrorDetail(error: unknown): string | undefined {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return error.message;
  return undefined;
}
