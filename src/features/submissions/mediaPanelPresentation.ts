import type { Translate } from '@/i18n';

import { extensionList } from './rules';

export type MediaNotice =
  | { reason: 'extensions'; extensions: string[]; name: string }
  | { reason: 'unavailable'; detail: string; origin?: string }
  | { reason: 'picker' | 'settings'; detail?: string };

export function mediaNoticeText(notice: MediaNotice, t: Translate, locale: string): string {
  switch (notice.reason) {
    case 'extensions':
      return t('mediaSubmission.rejected', {
        extensions: extensionList(notice.extensions, locale),
        name: notice.name,
      });
    case 'unavailable':
      return notice.origin === 'camera-unavailable'
        ? t('mediaSubmission.cameraUnavailable')
        : notice.detail;
    default:
      return (
        notice.detail ??
        t(
          notice.reason === 'picker'
            ? 'mediaSubmission.pickerFailure'
            : 'mediaSubmission.settingsFailure',
        )
      );
  }
}

/** Empty and same-English messages supplied by native/server callers stay raw. */
export function mediaErrorDetail(error: unknown): string | undefined {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return error.message;
  return undefined;
}
