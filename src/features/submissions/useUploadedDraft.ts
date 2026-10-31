import { useEffect, useSyncExternalStore } from 'react';

import type { DraftContent } from '@/canvas/api/submissionDrafts';
import { queueDraft } from '@/features/offline/submissionDrafts';
import { useTranslation } from '@/i18n';

import { draftStatusLabel } from './draftPresentation';
import { type DraftTarget, editDraft, readDraftDocument, subscribeDrafts } from './draftState';

/** Only IDs already returned by an explicit upload. Never starts or retries an upload. */
export function useUploadedDraft(target: DraftTarget, content: DraftContent | null, enabled: boolean) {
  const { t } = useTranslation();
  const { accountId, courseId, assignmentId, attempt, submissionId } = target;
  const serialized = content ? JSON.stringify(content) : null;
  const doc = useSyncExternalStore(subscribeDrafts, () => readDraftDocument(target), () => readDraftDocument(target));
  const kind = content?.activeSubmissionType ?? '';
  useEffect(() => {
    if (!enabled || !serialized || !submissionId) return;
    const t = { accountId, courseId, assignmentId, attempt, submissionId };
    const content = JSON.parse(serialized) as DraftContent;
    const kind = content.activeSubmissionType;
    const doc = readDraftDocument(t);
    if (doc.consumed || JSON.stringify(doc.records[kind]?.content) === serialized) return;
    if (content.activeSubmissionType === 'media_recording' && !content.mediaId && !doc.records[kind]) return;
    if (content.activeSubmissionType === 'online_upload' && !content.fileIds.length && !doc.records[kind]) return;
    if (editDraft(t, kind, serialized, content)) queueDraft(t, kind);
  }, [accountId, courseId, assignmentId, attempt, submissionId, serialized, enabled]);
  const status = doc.records[kind]?.status;
  return draftStatusLabel(status, kind, t);
}
