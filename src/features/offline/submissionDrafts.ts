import { deleteSubmissionDraft, fetchSubmissionDraft, saveSubmissionDraft } from '@/canvas/api/submissionDrafts';
import { type DraftTarget, draftKey, readDraftDocument, reloadDraftDocument, setDraftStatus, writeDraftDocument } from '@/features/submissions/draftState';

import { enqueueWrite, queueStore, registerWriteHandler } from './queue';

export type DraftWrite = { target: DraftTarget; generation: number } & (
  | { action: 'save'; kind: string; revision: number }
  | { action: 'discard' }
);
const KIND = 'submission-draft';
const current = (p: DraftWrite) => {
  reloadDraftDocument(p.target);
  const doc = readDraftDocument(p.target);
  return !doc.consumed && doc.generation === p.generation &&
    (p.action === 'discard' || doc.records[p.kind]?.revision === p.revision);
};
registerWriteHandler<DraftWrite>(KIND, {
  async run(p, { client, accountId }) {
    if (accountId !== p.target.accountId || !p.target.submissionId || !current(p)) return;
    const remote = await fetchSubmissionDraft(client, p.target.submissionId);
    if (!current(p)) return;
    if ((remote.attempt ?? 0) + 1 !== p.target.attempt) {
      if (p.action === 'save') setDraftStatus(p.target, p.kind, p.revision, 'stale');
      return;
    }
    if (p.action === 'discard') {
      // Queue ordering puts this after any in-flight save and before new edits.
      // Canvas deletion is submission-wide, so never delete after the attempt advanced.
      await deleteSubmissionDraft(client, p.target.submissionId);
    } else {
      const content = readDraftDocument(p.target).records[p.kind]?.content;
      if (!content) return;
      await saveSubmissionDraft(client, p.target.submissionId, p.target.attempt, content);
      if (current(p)) setDraftStatus(p.target, p.kind, p.revision, 'synced');
    }
  },
  onDrop(p) {
    if (p.action === 'save' && current(p)) setDraftStatus(p.target, p.kind, p.revision, 'unavailable');
  },
});

/** Local content is durable before queueing. Coalesce keystrokes; never queue uploads or submits. */
export function queueDraft(t: DraftTarget, kind: string) {
  const doc = readDraftDocument(t), record = doc.records[kind];
  if (doc.consumed || !t.submissionId || !record?.content || record.status === 'storage-error') return;
  const key = `${draftKey(t)}:${doc.generation}:${kind}`;
  enqueueWrite({ accountId: t.accountId, kind: KIND, key, label: 'Save submission draft', labelDescriptor: { kind: 'draft-save' },
    payload: { target: t, generation: doc.generation, action: 'save', kind, revision: record.revision } satisfies DraftWrite });
  // Handler-owned debounce; the queue's retry timer also wakes these after restart.
  queueStore.update((list) => list.map((w) => w.accountId === t.accountId && w.kind === KIND && w.key === key && w.status !== 'running'
    ? { ...w, nextAttemptAt: Date.now() + 700 } : w));
}

/** Explicit discard only. A tombstone blocks late restore/save; new edits get a new queue key. */
export function discardSubmissionDraft(t: DraftTarget) {
  const doc = readDraftDocument(t);
  if (doc.consumed) return;
  const generation = doc.generation + 1;
  const records = Object.fromEntries(Object.keys(doc.records).map((kind) => [kind, {
    value: '', revision: (doc.records[kind]?.revision ?? 0) + 1,
    savedAt: new Date().toISOString(), status: 'device' as const,
  }]));
  if (!writeDraftDocument({ ...doc, generation, discarded: true, records })) return;
  if (t.submissionId) enqueueWrite({ accountId: t.accountId, kind: KIND,
    key: `${draftKey(t)}:discard:${generation}`, label: 'Discard submission draft', labelDescriptor: { kind: 'draft-discard' },
    payload: { target: t, generation, action: 'discard' } satisfies DraftWrite });
}
