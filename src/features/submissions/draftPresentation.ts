import type { Translate } from '@/i18n';
import type { DraftStatus } from './draftState';

/** Authored status only; draft content and persisted status remain untouched. */
export function draftStatusLabel(status: DraftStatus | undefined, kind: string, t: Translate) {
  if (!status) return null;
  switch (status) {
    case 'storage-error':
      return t('submissionDraft.storageError');
    case 'waiting':
      return t('submissionDraft.waiting');
    case 'synced':
      return t('submissionDraft.synced');
    case 'unavailable':
      return t('submissionDraft.unavailable');
    case 'stale':
      return t('submissionDraft.stale');
    default:
      return t(kind === 'comment' ? 'submissionDraft.comment' : 'submissionDraft.device');
  }
}
