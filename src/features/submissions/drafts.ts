import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useSyncExternalStore } from 'react';

import { fetchSubmissionDraft } from '@/canvas/api/submissionDrafts';
import type { CanvasClient } from '@/canvas/client';
import { registerAccountCleanup } from '@/canvas/session';
import { queueStore } from '@/features/offline/queue';
import { queueDraft } from '@/features/offline/submissionDrafts';
import { useOnline } from '@/features/offline/useOnline';
import { useTranslation } from '@/i18n';

import { draftStatusLabel } from './draftPresentation';

import { type DraftTarget, activateDraftAccount, editDraft, readDraftDocument, reloadDraftDocument, restoreDraft, writeDraftDocument, subscribeDrafts } from './draftState';

export type DraftKind = 'text' | 'url' | 'comment';
const safe = (part: string) => part.replace(/[^A-Za-z0-9._-]/g, '_');
const accountDir = (id: string) => new Directory(Paths.document, 'drafts', safe(id));
const legacyFile = (t: DraftTarget, kind: DraftKind) => new File(accountDir(t.accountId), `${safe(t.courseId)}-${safe(t.assignmentId)}-${kind}.json`);

/** Shared-in work remains unbound until the editor knows the submission's next attempt. */
export function saveDraft(accountId: string, courseId: string, assignmentId: string, kind: DraftKind, value: string) {
  const t = { accountId, courseId, assignmentId, attempt: 0 };
  const folder = accountDir(accountId);
  if (!folder.exists) folder.create({ intermediates: true });
  legacyFile(t, kind).writeSync(JSON.stringify({ value, savedAt: new Date().toISOString() }));
}
export function clearDraft(accountId: string, courseId: string, assignmentId: string, kind: DraftKind) {
  const f = legacyFile({ accountId, courseId, assignmentId, attempt: 0 }, kind);
  if (f.exists) f.delete();
}
registerAccountCleanup((id) => { try { if (accountDir(id).exists) accountDir(id).delete(); } catch { /* Already gone. */ } });

export type DraftOptions = { attempt: number; submissionId?: string; client?: CanvasClient };
const nonblank = (v: string) => !v.trim();
export function useDraft(accountId: string, courseId: string, assignmentId: string, kind: DraftKind,
  isEmpty: (value: string) => boolean = nonblank, options?: DraftOptions) {
  const target: DraftTarget = { accountId, courseId, assignmentId, attempt: options?.attempt ?? 0, submissionId: options?.submissionId };
  useEffect(() => { activateDraftAccount(accountId); }, [accountId]);
  useEffect(() => queueStore.subscribe(() => reloadDraftDocument({ accountId, courseId, assignmentId, attempt: options?.attempt ?? 0 })),
    [accountId, courseId, assignmentId, options?.attempt]);
  const online = useOnline();
  const doc = useSyncExternalStore(subscribeDrafts, () => readDraftDocument(target), () => readDraftDocument(target));
  const record = doc.records[kind];
  const client = options?.client, submissionId = options?.submissionId, attempt = target.attempt;
  const setValue = (value: string) => {
    const content = kind === 'text' ? { activeSubmissionType: 'online_text_entry' as const, body: isEmpty(value) ? '' : value }
      : kind === 'url' ? { activeSubmissionType: 'online_url' as const, url: value } : undefined;
    const saved = editDraft(target, kind, value, content);
    if (saved) queueDraft(target, kind);
  };
  useEffect(() => {
    const t = { accountId, courseId, assignmentId, attempt, submissionId };
    const existing = readDraftDocument(t);
    const record = existing.records[kind];
    if (!existing.consumed && submissionId && record?.content && (record.status === 'waiting' || record.status === 'device')) {
      if (writeDraftDocument({ ...existing, target: t, records: { ...existing.records, [kind]: { ...record, status: 'waiting' } } })) queueDraft(t, kind);
    }
    const f = legacyFile(t, kind);
    try {
      if (!readDraftDocument(t).consumed && f.exists) {
        const stored = JSON.parse(f.textSync()) as { value: string; savedAt: string };
        const current = readDraftDocument(t).records[kind];
        // A freshly shared-in value may replace an earlier draft, but never current typing.
        if (current && Date.parse(current.savedAt) >= Date.parse(stored.savedAt)) { f.delete(); return; }
        const content = kind === 'text' ? { activeSubmissionType: 'online_text_entry' as const, body: stored.value }
          : kind === 'url' ? { activeSubmissionType: 'online_url' as const, url: stored.value } : undefined;
        const saved = editDraft(t, kind, stored.value, content);
        if (saved?.status !== 'storage-error') { f.delete(); queueDraft(t, kind); }
      }
    } catch { /* Keep a legacy file if migration fails. */ }
  }, [accountId, courseId, assignmentId, attempt, submissionId, kind]);
  useEffect(() => {
    if (kind === 'comment' || !client || !submissionId || !online) return;
    const t = { accountId, courseId, assignmentId, attempt, submissionId };
    const before = readDraftDocument(t);
    if (before.consumed || before.discarded || before.records[kind]) return;
    let cancelled = false;
    void fetchSubmissionDraft(client, submissionId).then((remote) => {
      if (cancelled || (remote.attempt ?? 0) + 1 !== attempt || remote.submissionDraft?.submissionAttempt !== attempt) return;
      const value = (kind === 'text' ? remote.submissionDraft.body : remote.submissionDraft.url) ?? '';
      restoreDraft(t, kind, before.generation, value);
    }).catch(() => { /* Remote capability never blocks local editing. */ });
    return () => { cancelled = true; };
  }, [accountId, courseId, assignmentId, attempt, submissionId, kind, client, online]);
  // Presentation-only subscription: no locale input enters persistence or sync effects.
  const { t } = useTranslation();
  const statusLabel = draftStatusLabel(record?.status, kind, t);
  /** Capture at invocation, not render: revisions detect edits even before React rerenders.
   * The returned clear is bound to this target/kind and rechecks synchronously.
   * Existing clear() remains unconditional (except consumed documents).
   */
  const captureForClear = () => {
    const captured = readDraftDocument(target);
    if (captured.consumed || captured.discarded || captured.records[kind]?.status === 'stale') return null;
    const revision = captured.records[kind]?.revision;
    return {
      value: captured.records[kind]?.value ?? '',
      clearIfUnchanged: () => {
        const current = readDraftDocument(target);
        if (current.consumed || current.discarded || current.records[kind]?.status === 'stale' ||
          current.generation !== captured.generation ||
          current.records[kind]?.revision !== revision) return false;
        setValue('');
        return true;
      },
    };
  };
  return { value: record?.value ?? '', setValue, loaded: true, restoredAt: null,
    savedAt: record ? new Date(record.savedAt) : null, statusLabel, captureForClear,
    clear: () => { if (!readDraftDocument(target).consumed) setValue(''); } };
}
export type Draft = ReturnType<typeof useDraft>;
