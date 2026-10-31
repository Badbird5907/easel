import { Directory, File, Paths } from 'expo-file-system';

import type { DraftContent } from '@/canvas/api/submissionDrafts';
import { registerAccountCleanup } from '@/canvas/session';

export type DraftTarget = { accountId: string; courseId: string; assignmentId: string; attempt: number; submissionId?: string };
export type DraftStatus = 'device' | 'waiting' | 'synced' | 'unavailable' | 'stale' | 'storage-error';
export type DraftRecord = { value: string; revision: number; savedAt: string; status: DraftStatus; content?: DraftContent };
export type DraftDocument = {
  target: DraftTarget;
  generation: number;
  consumed: boolean;
  discarded?: boolean;
  records: Record<string, DraftRecord>;
};
const cache = new Map<string, DraftDocument>();
const listeners = new Set<() => void>();
const removed = new Set<string>();
let generationSeed = Date.now();
export function activateDraftAccount(id: string) { removed.delete(id); }
export const draftKey = (t: DraftTarget) => JSON.stringify([t.accountId, t.courseId, t.assignmentId, t.attempt]);
const encode = (s: string) => encodeURIComponent(s);
const dir = (id: string) => new Directory(Paths.document, 'submission-drafts-v2', encode(id));
const file = (t: DraftTarget) => new File(dir(t.accountId), `${encode(JSON.stringify([t.courseId, t.assignmentId, t.attempt]))}.json`);
export const subscribeDrafts = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function readDraftDocument(t: DraftTarget): DraftDocument {
  const key = draftKey(t);
  let doc = cache.get(key);
  if (!doc) {
    try { if (!removed.has(t.accountId) && file(t).exists) doc = JSON.parse(file(t).textSync()); } catch { /* Keep the editor usable. */ }
    doc ??= { target: t, generation: ++generationSeed, consumed: false, records: {} };
    cache.set(key, doc);
  }
  return doc;
}

/** Reconcile a background runtime's disk writes without changing stable React snapshots unnecessarily. */
export function reloadDraftDocument(t: DraftTarget) {
  if (removed.has(t.accountId) || Object.values(cache.get(draftKey(t))?.records ?? {}).some((r) => r.status === 'storage-error')) return;
  try {
    if (!file(t).exists) return;
    const disk = JSON.parse(file(t).textSync()) as DraftDocument;
    if (JSON.stringify(cache.get(draftKey(t))) !== JSON.stringify(disk)) {
      cache.set(draftKey(t), disk);
      listeners.forEach((fn) => fn());
    }
  } catch { /* Keep the in-memory draft on storage failure. */ }
}

export function writeDraftDocument(doc: DraftDocument): boolean {
  if (removed.has(doc.target.accountId)) return false;
  let saved = true;
  try {
    const folder = dir(doc.target.accountId);
    if (!folder.exists) folder.create({ intermediates: true });
    file(doc.target).writeSync(JSON.stringify(doc));
  } catch {
    saved = false;
    doc = { ...doc, records: Object.fromEntries(Object.entries(doc.records).map(([k, v]) => [k, { ...v, status: 'storage-error' }])) };
  }
  cache.set(draftKey(doc.target), doc);
  listeners.forEach((fn) => fn());
  return saved;
}
export function editDraft(t: DraftTarget, kind: string, value: string, content?: DraftContent) {
  const doc = readDraftDocument(t);
  if (doc.consumed) return null;
  const record: DraftRecord = { value, content, revision: (doc.records[kind]?.revision ?? 0) + 1,
    savedAt: new Date().toISOString(), status: content && t.submissionId ? 'waiting' : 'device' };
  writeDraftDocument({ ...doc, target: t, records: { ...doc.records, [kind]: record } });
  return readDraftDocument(t).records[kind];
}
export function setDraftStatus(t: DraftTarget, kind: string, revision: number, status: DraftStatus) {
  const doc = readDraftDocument(t), record = doc.records[kind];
  if (!doc.consumed && record?.revision === revision)
    writeDraftDocument({ ...doc, records: { ...doc.records, [kind]: { ...record, status } } });
}
/** Compare-and-set restore: even an intentional empty edit or discard wins over remote data. */
export function restoreDraft(t: DraftTarget, kind: string, generation: number, value: string) {
  const doc = readDraftDocument(t);
  if (doc.consumed || doc.discarded || doc.generation !== generation || doc.records[kind] || !value) return false;
  return writeDraftDocument({ ...doc, records: { ...doc.records, [kind]: {
    value, revision: 1, savedAt: new Date().toISOString(), status: 'synced',
  } } });
}
/** Successful explicit submit consumes only that attempt; no network deletion of newer drafts. */
export function consumeDraft(t: DraftTarget) {
  const doc = readDraftDocument(t);
  writeDraftDocument({ ...doc, consumed: true, generation: doc.generation + 1, records: {} });
}
registerAccountCleanup((accountId) => {
  removed.add(accountId);
  for (const [key, doc] of cache) if (doc.target.accountId === accountId) cache.delete(key);
  try { if (dir(accountId).exists) dir(accountId).delete(); } catch { /* Already removed. */ }
  listeners.forEach((fn) => fn());
});
