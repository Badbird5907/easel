import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useState } from 'react';

import {
  type CanvasPlannerNote,
  type CanvasPlannerOverride,
  type OverrideState,
  type PlannerNote,
  type PlannerNoteInput,
  plannerKeys,
  fetchPlannerNote,
  toPlannerNote,
  useCreatePlannerNote,
  useDeletePlannerNote,
  useSetPlannerOverride,
  useUpdatePlannerNote,
} from '@/canvas/api/planner';
import { CanvasError, CanvasNetworkError } from '@/canvas/client';
import type { WorkItem } from '@/canvas/models';
import { useCanvas } from '@/canvas/session';
import { useCanvasQuery } from '@/canvas/query';

import type { QueueLabelDescriptor } from './presentation';
import { isOnline } from './connectivity';
import {
  enqueueWrite,
  type HandlerContext,
  pendingWrites,
  type QueuedWrite,
  queueStore,
  registerWriteHandler,
  rewritePending,
  useQueuedWrites,
  WriteConflict,
} from './queue';

/*
 * Planner writes that wait for the network (OFF-2): marking done, dismissing,
 * and creating, editing, and deleting personal to-dos (planner notes). Offline,
 * the change shows at once in every cached planner list and stays there across
 * refetches and restarts until it reaches Canvas.
 *
 * Conflicts: the last write wins. The exception is deleting a to-do that
 * changed in Canvas after Easel last saw it; that delete is skipped and the
 * student gets a notice instead.
 */

// --- Shared cache helpers ------------------------------------------------------------------

const itemsFilter = (accountId: string) => ({ queryKey: [accountId, ...plannerKeys.items] });

function invalidatePlanner(queryClient: QueryClient | null, accountId: string) {
  if (!queryClient) return;
  void queryClient.invalidateQueries({ queryKey: [accountId, ...plannerKeys.all] });
  void queryClient.invalidateQueries({ queryKey: [accountId, 'calendar'] });
}

/** Whether a planner list for this range would show something dated `date`. */
function rangeHolds(key: readonly unknown[], date: Date) {
  const start = Date.parse(String(key[3] ?? ''));
  const end = Date.parse(String(key[4] ?? ''));
  if (Number.isNaN(start) || Number.isNaN(end)) return true;
  // Keys are UTC days; allow a day either side for time zones.
  const day = 86_400_000;
  return date.getTime() >= start - day && date.getTime() <= end + 2 * day;
}

const noteItemId = (noteId: string) => `planner_note:${noteId}`;

function noteWorkItem(id: string, input: SerializedInput): WorkItem {
  return {
    id: noteItemId(id),
    plannableId: id,
    plannableType: 'planner_note',
    kind: 'note',
    title: input.title,
    courseId: input.courseId,
    contextName: null,
    dueAt: new Date(input.todoDate),
    points: null,
    status: 'open',
    late: false,
    excused: false,
    hasFeedback: false,
    markedComplete: false,
    dismissed: false,
    overrideId: null,
    htmlUrl: null,
    newActivity: false,
  };
}

// --- Mark done and dismiss -------------------------------------------------------------------

type OverridePayload = {
  itemId: string;
  plannableType: string;
  plannableId: string;
  title: string;
  overrideId: string | null;
  markedComplete: boolean;
  dismissed: boolean;
};

const normalizeType = (type: string) => type.toLowerCase().replace(/_/g, '');

registerWriteHandler<OverridePayload>('planner-override', {
  run: async (p, { client }) => {
    // Canvas sets both flags on every update; leaving one out clears it.
    const body = { marked_complete: p.markedComplete, dismissed: p.dismissed };
    if (p.overrideId)
      return client.put<CanvasPlannerOverride>(`/api/v1/planner/overrides/${p.overrideId}`, body);
    try {
      return await client.post<CanvasPlannerOverride>('/api/v1/planner/overrides', {
        plannable_type: p.plannableType,
        plannable_id: p.plannableId,
        ...body,
      });
    } catch (error) {
      if (!(error instanceof CanvasError && error.status === 400)) throw error;
      // Another device made an override meanwhile ("already exists"): update that one.
      const all = await client.getAll<CanvasPlannerOverride>('/api/v1/planner/overrides');
      const existing = all.find(
        (o) =>
          String(o.plannable_id) === p.plannableId &&
          normalizeType(String(o.plannable_type)) === normalizeType(p.plannableType),
      );
      if (!existing) throw error;
      return client.put<CanvasPlannerOverride>(`/api/v1/planner/overrides/${existing.id}`, body);
    }
  },
  merge: (pending, next) => ({ ...next, overrideId: next.overrideId ?? pending.overrideId }),
  onSuccess: (result, p, { accountId, queryClient }) => {
    const id = (result as CanvasPlannerOverride | undefined)?.id;
    if (queryClient && id) {
      queryClient.setQueriesData<WorkItem[]>(itemsFilter(accountId), (items) =>
        items?.map((i) => (i.id === p.itemId ? { ...i, overrideId: String(id) } : i)),
      );
    }
    if (!pendingWrites(accountId).some((w) => w.kind === 'planner-override'))
      invalidatePlanner(queryClient, accountId);
  },
  onDrop: (_p, { accountId, queryClient }) => invalidatePlanner(queryClient, accountId),
});

const overrideKey = (itemId: string) => `override:${itemId}`;

function overrideLabel(item: WorkItem, state: OverrideState) {
  if (state.dismissed && !item.dismissed) return `Dismiss “${item.title}”`;
  if (!state.dismissed && item.dismissed) return `Restore “${item.title}”`;
  return state.markedComplete ? `Mark “${item.title}” done` : `Mark “${item.title}” not done`;
}

function overrideDescriptor(item: WorkItem, state: OverrideState): QueueLabelDescriptor {
  if (state.dismissed && !item.dismissed) return { kind: 'planner-dismiss', title: item.title };
  if (!state.dismissed && item.dismissed) return { kind: 'planner-restore', title: item.title };
  return { kind: state.markedComplete ? 'planner-done' : 'planner-not-done', title: item.title };
}

export type WriteOutcome = 'sent' | 'queued';

/**
 * `useSetPlannerOverride` that waits for the network instead of failing:
 * offline, or when Canvas can't be reached, the change is queued and shows
 * right away. Resolves with whether it went out now or was queued.
 */
export function useQueuedPlannerOverride() {
  const queryClient = useQueryClient();
  const { account } = useCanvas();
  const send = useSetPlannerOverride();

  return async (item: WorkItem, state: OverrideState): Promise<WriteOutcome> => {
    const queue = (): WriteOutcome => {
      queryClient.setQueriesData<WorkItem[]>(itemsFilter(account.id), (items) =>
        items?.map((i) => (i.id === item.id ? { ...i, ...state } : i)),
      );
      enqueueWrite<OverridePayload>({
        accountId: account.id,
        kind: 'planner-override',
        key: overrideKey(item.id),
        label: overrideLabel(item, state),
        labelDescriptor: overrideDescriptor(item, state),
        payload: {
          itemId: item.id,
          plannableType: item.plannableType,
          plannableId: item.plannableId,
          title: item.title,
          overrideId: item.overrideId,
          ...state,
        },
      });
      return 'queued';
    };
    // Something for this item is already waiting: go behind it, so the order holds.
    if (!isOnline() || pendingWrites(account.id).some((w) => w.key === overrideKey(item.id))) return queue();
    try {
      await send(item, state);
      return 'sent';
    } catch (error) {
      if (error instanceof CanvasNetworkError) return queue();
      throw error;
    }
  };
}

// --- Personal to-dos -----------------------------------------------------------------------

type SerializedInput = { title: string; details: string; todoDate: string; courseId: string | null };

type NotePayload =
  | { op: 'create'; tempId: string; input: SerializedInput }
  | { op: 'update'; id: string; input: SerializedInput; base: SerializedInput | null }
  | { op: 'delete'; id: string; title: string; base: SerializedInput | null };

const serialize = (input: PlannerNoteInput): SerializedInput => ({
  title: input.title,
  details: input.details,
  todoDate: input.todoDate.toISOString(),
  courseId: input.courseId,
});

const noteKey = (id: string) => `note:${id}`;
const TEMP_PREFIX = 'local-';
export const isLocalNoteId = (id: string) => id.startsWith(TEMP_PREFIX);

/** Local notes read their optimistic cache entry, never a nonexistent Canvas ID. */
export function useQueuedPlannerNote(id: string) {
  return useCanvasQuery(plannerKeys.note(id), (client, signal) => fetchPlannerNote(client, id, signal), {
    enabled: !isLocalNoteId(id),
  });
}

const noteBody = (input: SerializedInput) => ({
  title: input.title,
  details: input.details,
  todo_date: input.todoDate,
});

function sameAsBase(note: CanvasPlannerNote, base: SerializedInput) {
  const date = (value: string | null | undefined) => (value ? new Date(value).getTime() : null);
  return (
    note.title === base.title &&
    (note.details ?? '') === base.details &&
    date(note.todo_date) === date(base.todoDate) &&
    (note.course_id ? String(note.course_id) : null) === base.courseId
  );
}

registerWriteHandler<NotePayload>('planner-note', {
  run: async (p, { client }) => {
    if (p.op === 'create') {
      return toPlannerNote(
        await client.post<CanvasPlannerNote>('/api/v1/planner_notes', {
          ...noteBody(p.input),
          ...(p.input.courseId ? { course_id: p.input.courseId } : {}),
        }),
      );
    }
    if (p.op === 'update') {
      try {
        return toPlannerNote(
          await client.put<CanvasPlannerNote>(`/api/v1/planner_notes/${p.id}`, {
            ...noteBody(p.input),
            course_id: p.input.courseId ?? '',
          }),
        );
      } catch (error) {
        if (error instanceof CanvasError && error.status === 404)
          throw new WriteConflict(`“${p.input.title}” was deleted in Canvas, so your changes weren’t saved.`,
            { kind: 'planner-deleted', title: p.input.title });
        throw error;
      }
    }
    // Delete, unless it changed in Canvas since Easel last saw it.
    if (p.base) {
      let current: CanvasPlannerNote;
      try {
        current = await client.get<CanvasPlannerNote>(`/api/v1/planner_notes/${p.id}`);
      } catch (error) {
        // Already gone: nothing left to do.
        if (error instanceof CanvasError && error.status === 404) return null;
        throw error;
      }
      if (!sameAsBase(current, p.base))
        throw new WriteConflict(
          `“${current.title}” changed in Canvas after you deleted it here, so Easel kept it.`,
          { kind: 'planner-changed', title: current.title },
        );
    }
    try {
      return await client.delete(`/api/v1/planner_notes/${p.id}`);
    } catch (error) {
      if (error instanceof CanvasError && error.status === 404) return null;
      throw error;
    }
  },
  merge: (pending, next) => {
    if (pending.op === 'create') {
      if (next.op === 'delete') return null;
      if (next.op === 'update') return { ...pending, input: next.input };
      return next;
    }
    if (pending.op === 'update') {
      if (next.op === 'update') return { ...next, base: pending.base };
      if (next.op === 'delete') return { ...next, base: pending.base };
    }
    return next;
  },
  onSuccess: (result, p, { accountId, queryClient }) => {
    if (p.op === 'create' && result) {
      const note = result as PlannerNote;
      // Later writes for the to-do now point at its real ID.
      // An edit queued while the create was on its way becomes an update; a delete keeps going.
      rewritePending(accountId, (w) => {
        if (w.kind !== 'planner-note' || w.key !== noteKey(p.tempId)) return w;
        const payload = w.payload as NotePayload;
        const next: NotePayload =
          payload.op === 'create'
            ? { op: 'update', id: note.id, input: payload.input, base: null }
            : { ...payload, id: note.id };
        return { ...w, key: noteKey(note.id), payload: next };
      });
      if (queryClient) {
        queryClient.setQueriesData<WorkItem[]>(itemsFilter(accountId), (items) =>
          items?.map((i) =>
            i.id === noteItemId(p.tempId) ? { ...i, id: noteItemId(note.id), plannableId: note.id } : i,
          ),
        );
        queryClient.setQueryData([accountId, ...plannerKeys.note(note.id)], note);
        queryClient.removeQueries({ queryKey: [accountId, ...plannerKeys.note(p.tempId)], exact: true });
      }
    }
    if (!pendingWrites(accountId).some((w) => w.kind === 'planner-note'))
      invalidatePlanner(queryClient, accountId);
  },
  onDrop: (_p, { accountId, queryClient }) => invalidatePlanner(queryClient, accountId),
});

/** Puts every pending to-do change into a planner list, so refetches don't undo it. */
function applyPendingToItems(items: WorkItem[], key: readonly unknown[], writes: QueuedWrite[]): WorkItem[] {
  let next = items;
  for (const write of writes) {
    if (write.kind === 'planner-override') {
      const p = write.payload as OverridePayload;
      const current = next.find((i) => i.id === p.itemId);
      if (current && (current.markedComplete !== p.markedComplete || current.dismissed !== p.dismissed))
        next = next.map((i) =>
          i.id === p.itemId ? { ...i, markedComplete: p.markedComplete, dismissed: p.dismissed } : i,
        );
      continue;
    }
    if (write.kind !== 'planner-note') continue;
    const p = write.payload as NotePayload;
    if (p.op === 'delete') {
      if (next.some((i) => i.id === noteItemId(p.id))) next = next.filter((i) => i.id !== noteItemId(p.id));
      continue;
    }
    const id = p.op === 'create' ? p.tempId : p.id;
    const wanted = noteWorkItem(id, p.input);
    const index = next.findIndex((i) => i.id === wanted.id);
    const holds = rangeHolds(key, wanted.dueAt);
    if (index === -1) {
      if (holds) next = [...next, wanted];
      continue;
    }
    const current = next[index];
    if (!holds) {
      next = next.filter((_, i) => i !== index);
    } else if (
      current.title !== wanted.title ||
      current.courseId !== wanted.courseId ||
      current.dueAt.getTime() !== wanted.dueAt.getTime()
    ) {
      next = next.map((item, i) =>
        i === index ? { ...item, title: wanted.title, courseId: wanted.courseId, dueAt: wanted.dueAt } : item,
      );
    }
  }
  return next;
}

function applyPending(queryClient: QueryClient, accountId: string) {
  const writes = pendingWrites(accountId).filter(
    (w) => w.kind === 'planner-override' || w.kind === 'planner-note',
  );
  if (!writes.length) return;
  for (const query of queryClient.getQueryCache().findAll(itemsFilter(accountId))) {
    const data = query.state.data as WorkItem[] | undefined;
    if (!Array.isArray(data)) continue;
    const next = applyPendingToItems(data, query.queryKey, writes);
    if (next !== data) queryClient.setQueryData(query.queryKey, next);
  }
  // Notes the student opens while their change is pending.
  for (const write of writes) {
    if (write.kind !== 'planner-note') continue;
    const p = write.payload as NotePayload;
    if (p.op === 'delete') continue;
    const id = p.op === 'create' ? p.tempId : p.id;
    const key = [accountId, ...plannerKeys.note(id)];
    const current = queryClient.getQueryData<PlannerNote>(key);
    const wanted: PlannerNote = {
      id,
      title: p.input.title,
      details: p.input.details,
      todoDate: new Date(p.input.todoDate),
      courseId: p.input.courseId,
      linkedUrl: current?.linkedUrl ?? null,
    };
    if (
      !current ||
      current.title !== wanted.title ||
      current.details !== wanted.details ||
      current.courseId !== wanted.courseId ||
      current.todoDate.getTime() !== wanted.todoDate.getTime()
    )
      queryClient.setQueryData(key, wanted);
  }
}

/**
 * Keeps pending planner changes on screen: after every planner fetch (and
 * whenever the queue changes) the pending changes are laid back over the
 * cached lists. Render once, inside the query provider.
 */
export function usePendingPlannerOverlay(queryClient: QueryClient) {
  useEffect(() => {
    let scheduled = false;
    const reapply = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        const accounts = new Set(pendingWrites().map((w) => w.accountId));
        for (const accountId of accounts) applyPending(queryClient, accountId);
      }, 0);
    };
    reapply();
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      const key = event.query.queryKey;
      if (key[1] === 'planner') reapply();
    });
    const unsubscribeQueue = queueStore.subscribe(reapply);
    return () => {
      unsubscribeCache();
      unsubscribeQueue();
    };
  }, [queryClient]);
}

/** The planner item IDs with a change waiting to sync, for row markers. */
export function usePendingPlannerIds(): ReadonlySet<string> {
  const { account } = useCanvas();
  const writes = useQueuedWrites(account.id);
  return useMemo(() => {
    const ids = new Set<string>();
    for (const w of writes) {
      if (w.kind === 'planner-override') ids.add((w.payload as OverridePayload).itemId);
      if (w.kind === 'planner-note') {
        const p = w.payload as NotePayload;
        ids.add(noteItemId(p.op === 'create' ? p.tempId : p.id));
      }
    }
    return ids;
  }, [writes]);
}

// --- Drop-in hooks for the to-do screens -----------------------------------------------------

type MutateOptions<T> = { onSuccess?: (result: T) => void; onError?: (error: Error) => void };

/** The parts of a React Query mutation the to-do screens use, with `queued` on success. */
export type QueueableMutation<TInput> = {
  mutate: (input: TInput, options?: MutateOptions<WriteOutcome>) => void;
  isPending: boolean;
  error: Error | null;
};

function useQueueable<TInput>(
  send: {
    mutate: (input: TInput, o: { onSuccess: () => void; onError: (e: Error) => void }) => void;
    isPending: boolean;
    error: Error | null;
    reset: () => void;
  },
  queue: (input: TInput) => void,
  hasPending: () => boolean = () => false,
): QueueableMutation<TInput> {
  const [queuedError, setQueuedError] = useState<Error | null>(null);
  return {
    isPending: send.isPending,
    error: queuedError ?? send.error,
    mutate: (input, options) => {
      setQueuedError(null);
      const enqueue = () => {
        try {
          queue(input);
          send.reset();
          options?.onSuccess?.('queued');
        } catch (error) {
          setQueuedError(error as Error);
          options?.onError?.(error as Error);
        }
      };
      if (!isOnline() || hasPending()) {
        enqueue();
        return;
      }
      send.mutate(input, {
        onSuccess: () => options?.onSuccess?.('sent'),
        onError: (error) => {
          if (error instanceof CanvasNetworkError) enqueue();
          else options?.onError?.(error);
        },
      });
    },
  };
}

/** The to-do as Canvas last sent it, for telling a later change in Canvas apart. */
function baseOf(queryClient: QueryClient, accountId: string, id: string): SerializedInput | null {
  const note = queryClient.getQueryData<PlannerNote>([accountId, ...plannerKeys.note(id)]);
  return note
    ? {
        title: note.title,
        details: note.details,
        todoDate: note.todoDate.toISOString(),
        courseId: note.courseId,
      }
    : null;
}

/** Queues a new to-do; it shows in planner lists right away under a temporary ID. */
export function queueCreateNote(queryClient: QueryClient, accountId: string, input: PlannerNoteInput) {
  const tempId = `${TEMP_PREFIX}${Crypto.randomUUID()}`;
  enqueueWrite<NotePayload>({
    accountId,
    kind: 'planner-note',
    key: noteKey(tempId),
    label: `Add “${input.title}”`,
    labelDescriptor: { kind: 'planner-add', title: input.title },
    payload: { op: 'create', tempId, input: serialize(input) },
  });
  applyPending(queryClient, accountId);
}

/** Queues an edit. A to-do made offline doesn't exist in Canvas yet, so its queued create changes instead. */
export function queueUpdateNote(
  queryClient: QueryClient,
  accountId: string,
  id: string,
  input: PlannerNoteInput,
) {
  enqueueWrite<NotePayload>({
    accountId,
    kind: 'planner-note',
    key: noteKey(id),
    label: `Edit “${input.title}”`,
    labelDescriptor: { kind: 'planner-edit', title: input.title },
    payload: isLocalNoteId(id)
      ? { op: 'create', tempId: id, input: serialize(input) }
      : { op: 'update', id, input: serialize(input), base: baseOf(queryClient, accountId, id) },
  });
  applyPending(queryClient, accountId);
}

/** Queues a delete. A to-do that never reached Canvas just disappears. */
export function queueDeleteNote(queryClient: QueryClient, accountId: string, id: string) {
  const note = queryClient.getQueryData<PlannerNote>([accountId, ...plannerKeys.note(id)]);
  enqueueWrite<NotePayload>({
    accountId,
    kind: 'planner-note',
    key: noteKey(id),
    label: `Delete “${note?.title ?? 'to-do'}”`,
    labelDescriptor: note ? { kind: 'planner-delete', title: note.title } : { kind: 'planner-delete-untitled' },
    payload: { op: 'delete', id, title: note?.title ?? 'to-do', base: baseOf(queryClient, accountId, id) },
  });
  queryClient.setQueriesData<WorkItem[]>(itemsFilter(accountId), (items) =>
    items?.filter((i) => i.id !== noteItemId(id)),
  );
  applyPending(queryClient, accountId);
}

/** `useCreatePlannerNote` that queues the new to-do when offline. */
export function useQueuedCreatePlannerNote(): QueueableMutation<PlannerNoteInput> {
  const { account } = useCanvas();
  const queryClient = useQueryClient();
  const create = useCreatePlannerNote();
  return useQueueable(create, (input) => queueCreateNote(queryClient, account.id, input));
}

/** `useUpdatePlannerNote` that queues the edit when offline. */
export function useQueuedUpdatePlannerNote(id: string): QueueableMutation<PlannerNoteInput> {
  const { account } = useCanvas();
  const queryClient = useQueryClient();
  const update = useUpdatePlannerNote(id);
  const queueable = useQueueable(
    update,
    (input) => queueUpdateNote(queryClient, account.id, id, input),
    () => pendingWrites(account.id).some((w) => w.key === noteKey(id)),
  );
  if (!isLocalNoteId(id)) return queueable;
  return {
    ...queueable,
    isPending: false,
    mutate: (input, options) => {
      queueUpdateNote(queryClient, account.id, id, input);
      options?.onSuccess?.('queued');
    },
  };
}

/** `useDeletePlannerNote` that queues the delete when offline. */
export function useQueuedDeletePlannerNote(id: string): QueueableMutation<void> {
  const { account } = useCanvas();
  const queryClient = useQueryClient();
  const remove = useDeletePlannerNote(id);
  const queueable = useQueueable(
    remove,
    () => queueDeleteNote(queryClient, account.id, id),
    () => pendingWrites(account.id).some((w) => w.key === noteKey(id)),
  );
  if (!isLocalNoteId(id)) return queueable;
  return {
    ...queueable,
    isPending: false,
    mutate: (_input, options) => {
      queueDeleteNote(queryClient, account.id, id);
      options?.onSuccess?.('queued');
    },
  };
}

export type { HandlerContext };
