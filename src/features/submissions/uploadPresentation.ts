import { describeFile, formatSize } from '@/features/files/kinds';
import type { Translate } from '@/i18n';

import { uploadErrorOrigin } from './uploadErrors';
import type { UploadItem } from './uploadStore';

export function uploadStatusText(item: UploadItem, t: Translate, locale: string): string {
  switch (item.status) {
    case 'uploading':
      if (item.fraction === null || item.fraction <= 0) return t('submissionUpload.uploading');
      if (item.fraction >= 1) return t('submissionUpload.finishing');
      return t('submissionUpload.percent', { percent: Math.round(item.fraction * 100) });
    case 'done': {
      const type = describeFile(
        { name: item.file.name, contentType: item.file.mimeType ?? undefined },
        locale,
      ).label;
      const size = formatSize(item.file.size ?? item.uploaded?.size ?? null, locale);
      return [type, size, t(item.media ? 'submissionUpload.mediaDone' : 'submissionUpload.done')]
        .filter(Boolean)
        .join(' · ');
    }
    case 'error': {
      const origin = uploadErrorOrigin(item.errorOrigin);
      if (origin?.kind === 'filetype') return t('submissionUpload.filetype', { name: origin.name });
      if (origin) return t(`submissionUpload.${origin.kind}`);
      return item.error ?? t('submissionUpload.failed');
    }
  }
}
