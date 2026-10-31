import { createTranslator } from '@/i18n/runtime';

/** Optional, JSON-safe presentation only. Never used to select or execute a write. */
export type QueueLabelDescriptor =
  | { kind: 'planner-add' | 'planner-edit' | 'planner-delete' | 'planner-dismiss' |
      'planner-restore' | 'planner-done' | 'planner-not-done' | 'what-if-score'; title: string }
  | { kind: 'planner-delete-untitled' | 'draft-save' | 'draft-discard' | 'what-if-reset' };

export type QueueNoticeDescriptor =
  | { kind: 'planner-deleted' | 'planner-changed' | 'what-if-failed'; title: string }
  | { kind: 'what-if-reset-failed' }
  | { kind: 'dropped'; label: string; labelDescriptor?: QueueLabelDescriptor; detail: string | null };

type Label = { label: string; labelDescriptor?: unknown };
type Notice = { message: string; noticeDescriptor?: unknown };
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

/** Explicit viewing locale; callers can reuse this across a render. No stored data is modified.
 * Validate persisted descriptors at the display boundary, including future/unknown variants.
 * Legacy records always keep their original text; no source-text or URL heuristics.
 */
export function createOfflinePresentation(locale: string) {
  const t = createTranslator(locale);
  function label(write: Label): string {
    const d = record(write.labelDescriptor);
    if (!d) return write.label;
    switch (d.kind) {
      case 'draft-save': return t('offline.label.draftSave');
      case 'draft-discard': return t('offline.label.draftDiscard');
      case 'what-if-reset': return t('offline.label.whatIfReset');
      case 'planner-delete-untitled': return t('offline.label.deleteUntitled');
    }
    if (typeof d.title !== 'string') return write.label;
    const params = { title: d.title };
    switch (d.kind) {
      case 'planner-add': return t('offline.label.add', params);
      case 'planner-edit': return t('offline.label.edit', params);
      case 'planner-delete': return t('offline.label.delete', params);
      case 'planner-dismiss': return t('offline.label.dismiss', params);
      case 'planner-restore': return t('offline.label.restore', params);
      case 'planner-done': return t('offline.label.done', params);
      case 'planner-not-done': return t('offline.label.notDone', params);
      case 'what-if-score': return t('offline.label.whatIfScore', params);
      default: return write.label;
    }
  }
  function notice(value: Notice): string {
    const d = record(value.noticeDescriptor);
    if (!d) return value.message;
    if (d.kind === 'what-if-reset-failed') return t('offline.notice.whatIfResetFailed');
    if (d.kind === 'dropped') {
      if (typeof d.label !== 'string' || (d.detail !== null && typeof d.detail !== 'string')) return value.message;
      return t('offline.notice.dropped', {
        label: label({ label: d.label, labelDescriptor: d.labelDescriptor }),
        detail: d.detail || t('offline.notice.refused'),
      });
    }
    if (typeof d.title !== 'string') return value.message;
    const params = { title: d.title };
    switch (d.kind) {
      case 'planner-deleted': return t('offline.notice.deleted', params);
      case 'planner-changed': return t('offline.notice.changed', params);
      case 'what-if-failed': return t('offline.notice.whatIfFailed', params);
      default: return value.message;
    }
  }
  function summary(writes: readonly Label[], online: boolean): string {
    if (writes.length === 1) return t(online ? 'offline.pendingOneOnline' : 'offline.pendingOneOffline', { label: label(writes[0]) });
    return t(online ? 'offline.pendingOnline' : 'offline.pendingOffline', { count: writes.length });
  }
  return { label, notice, summary };
}
