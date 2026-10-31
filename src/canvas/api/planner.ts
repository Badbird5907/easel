import { type QueryClient, useQueryClient } from '@tanstack/react-query';

import type { CanvasClient } from '../client';
import type { WorkItem, WorkItemKind, WorkItemStatus } from '../models';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';
import type { CanvasPlannableType, CanvasPlannerItem } from '../types';

/** `POST /api/v1/planner/overrides`, `PUT /api/v1/planner/overrides/:id` (lib/api/v1/planner_override.rb) */
export type CanvasPlannerOverride = {
  id: string;
  plannable_type: CanvasPlannableType;
  plannable_id: string;
  user_id?: string;
  assignment_id?: string | null;
  workflow_state?: string;
  marked_complete: boolean;
  dismissed: boolean;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
};

/** `GET /api/v1/planner_notes/:id` (lib/api/v1/planner_note.rb) */
export type CanvasPlannerNote = {
  id: string;
  title: string;
  details: string | null;
  todo_date: string | null;
  user_id?: string;
  course_id: string | null;
  workflow_state?: string;
  created_at?: string;
  updated_at?: string;
  linked_object_type?: string;
  linked_object_id?: string;
  linked_object_html_url?: string;
};

/** A personal to-do the student wrote, optionally tied to a course. */
export type PlannerNote = {
  id: string;
  title: string;
  /** Plain text, as Canvas stores it. */
  details: string;
  todoDate: Date;
  courseId: string | null;
  /** Set when the note was created from a course item; its course can't change. */
  linkedUrl: string | null;
};

const kinds: Record<CanvasPlannableType, WorkItemKind> = {
  assignment: 'assignment',
  sub_assignment: 'assignment',
  quiz: 'quiz',
  discussion_topic: 'discussion',
  announcement: 'announcement',
  wiki_page: 'page',
  planner_note: 'note',
  calendar_event: 'event',
  assessment_request: 'peer_review',
  peer_review_sub_assignment: 'peer_review',
};

function statusOf(item: CanvasPlannerItem): WorkItemStatus {
  const s = item.submissions;
  if (!s) return 'open';
  if (s.graded && !s.redo_request) return 'graded';
  if (s.submitted && !s.redo_request) return 'submitted';
  if (s.missing) return 'missing';
  return 'open';
}

export function toWorkItem(item: CanvasPlannerItem): WorkItem {
  const s = item.submissions || undefined;
  return {
    id: `${item.plannable_type}:${item.plannable_id}`,
    plannableId: String(item.plannable_id),
    plannableType: item.plannable_type,
    kind: kinds[item.plannable_type] ?? 'assignment',
    title: item.plannable.title,
    courseId: item.course_id ? String(item.course_id) : (item.plannable.course_id ?? null),
    contextName: item.context_name ?? null,
    dueAt: new Date(item.plannable_date),
    points: item.plannable.points_possible ?? null,
    status: statusOf(item),
    late: s?.late ?? false,
    excused: s?.excused ?? false,
    hasFeedback: s?.has_feedback ?? false,
    markedComplete: item.planner_override?.marked_complete ?? false,
    dismissed: item.planner_override?.dismissed ?? false,
    overrideId: item.planner_override?.id ?? null,
    htmlUrl: item.html_url ?? null,
    newActivity: item.new_activity ?? false,
  };
}

export type PlannerRange = { start: Date; end: Date };

export async function fetchPlannerItems(client: CanvasClient, range: PlannerRange, signal?: AbortSignal) {
  const items = await client.getAll<CanvasPlannerItem>(
    '/api/v1/planner/items',
    { start_date: range.start.toISOString(), end_date: range.end.toISOString() },
    { signal },
  );
  // Announcements live in their own feed; the planner returns them too.
  return items.filter((i) => i.plannable_type !== 'announcement').map(toWorkItem);
}

/** Include the exact boundary: zones can share a UTC day but have different windows. */
function dayKey(date: Date) {
  return date.toISOString();
}

/** Cache keys under the account prefix. Everything here lives under `planner`. */
export const plannerKeys = {
  all: ['planner'] as const,
  items: ['planner', 'items'] as const,
  note: (id: string) => ['planner', 'notes', id] as const,
};

export function usePlannerItems(range: PlannerRange, options?: { enabled?: boolean }) {
  return useCanvasQuery(
    [...plannerKeys.items, dayKey(range.start), dayKey(range.end)],
    (client, signal) => fetchPlannerItems(client, range, signal),
    options,
  );
}

export { upcomingRange } from '@/features/planner/range';

// ---------------------------------------------------------------------------
// Mark done and dismiss (planner overrides)

export type OverrideState = { markedComplete: boolean; dismissed: boolean };

/**
 * Writes for one item run one after another, so a quick undo never races the
 * first request. The override ID from each response feeds the next write: a
 * second POST for the same item would fail with "already exists".
 */
const queues = new Map<string, Promise<unknown>>();
const knownOverrides = new Map<string, string>();
/** Writes in flight per account. Refetching waits until they all land. */
const inFlight = new Map<string, number>();

async function writeOverride(
  client: CanvasClient,
  { item, state, queueKey }: { item: WorkItem; state: OverrideState; queueKey: string },
): Promise<CanvasPlannerOverride> {
  const previous = queues.get(queueKey) ?? Promise.resolve();
  const run = previous
    .catch(() => {})
    .then(async () => {
      const overrideId = knownOverrides.get(queueKey) ?? item.overrideId;
      // Canvas sets both flags on every update; leaving one out clears it.
      const body = { marked_complete: state.markedComplete, dismissed: state.dismissed };
      const override = overrideId
        ? await client.put<CanvasPlannerOverride>(`/api/v1/planner/overrides/${overrideId}`, body)
        : await client.post<CanvasPlannerOverride>('/api/v1/planner/overrides', {
            plannable_type: item.plannableType,
            plannable_id: item.plannableId,
            ...body,
          });
      knownOverrides.set(queueKey, String(override.id));
      return override;
    });
  queues.set(queueKey, run);
  try {
    return await run;
  } finally {
    if (queues.get(queueKey) === run) queues.delete(queueKey);
  }
}

function patchCachedItems(
  queryClient: QueryClient,
  accountKey: string,
  itemId: string,
  patch: Partial<WorkItem>,
) {
  queryClient.setQueriesData<WorkItem[]>({ queryKey: [accountKey, ...plannerKeys.items] }, (items) =>
    items?.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
  );
}

/**
 * Marks a planner item done or dismissed. The change shows everywhere at once
 * (To Do, Home, course screens), rolls back if Canvas refuses it, and refetches
 * the planner once every pending write has landed.
 */
export function useSetPlannerOverride() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  const mutation = useCanvasMutation(writeOverride);

  return async (item: WorkItem, state: OverrideState): Promise<void> => {
    const filter = { queryKey: [accountKey, ...plannerKeys.items] };
    await queryClient.cancelQueries(filter);
    const snapshot = queryClient.getQueriesData<WorkItem[]>(filter);
    patchCachedItems(queryClient, accountKey, item.id, state);
    inFlight.set(accountKey, (inFlight.get(accountKey) ?? 0) + 1);
    try {
      const override = await mutation.mutateAsync({ item, state, queueKey: `${accountKey}:${item.id}` });
      patchCachedItems(queryClient, accountKey, item.id, { overrideId: String(override.id) });
    } catch (error) {
      for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
      throw error;
    } finally {
      const remaining = (inFlight.get(accountKey) ?? 1) - 1;
      inFlight.set(accountKey, remaining);
      if (remaining === 0) queryClient.invalidateQueries({ queryKey: [accountKey, ...plannerKeys.all] });
    }
  };
}

// ---------------------------------------------------------------------------
// Personal to-dos (planner notes)

export function toPlannerNote(note: CanvasPlannerNote): PlannerNote {
  return {
    id: String(note.id),
    title: note.title,
    details: note.details ?? '',
    todoDate: new Date(note.todo_date ?? note.created_at ?? Date.now()),
    courseId: note.course_id ? String(note.course_id) : null,
    linkedUrl: note.linked_object_html_url ?? null,
  };
}

export async function fetchPlannerNote(client: CanvasClient, id: string, signal?: AbortSignal) {
  return toPlannerNote(await client.get<CanvasPlannerNote>(`/api/v1/planner_notes/${id}`, undefined, signal));
}

export function usePlannerNote(id: string) {
  return useCanvasQuery(plannerKeys.note(id), (client, signal) => fetchPlannerNote(client, id, signal));
}

export type PlannerNoteInput = {
  title: string;
  details: string;
  todoDate: Date;
  courseId: string | null;
};

/**
 * Refreshes every list that can show a note: the planner feeds and the calendar.
 * A deleted note's own query is left alone, so its closing screen doesn't refetch a 404.
 */
function useInvalidatePlanner() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return (deletedId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: [accountKey, ...plannerKeys.all],
        predicate: (query) => !deletedId || query.queryKey[2] !== 'notes' || query.queryKey[3] !== deletedId,
      }),
      queryClient.invalidateQueries({ queryKey: [accountKey, 'calendar'] }),
    ]);
}

export function useCreatePlannerNote() {
  const invalidate = useInvalidatePlanner();
  return useCanvasMutation(
    async (client, input: PlannerNoteInput) =>
      toPlannerNote(
        await client.post<CanvasPlannerNote>('/api/v1/planner_notes', {
          title: input.title,
          details: input.details,
          todo_date: input.todoDate.toISOString(),
          // Canvas looks up any course_id it's given, even an empty one.
          ...(input.courseId ? { course_id: input.courseId } : {}),
        }),
      ),
    { onSuccess: () => invalidate() },
  );
}

export function useUpdatePlannerNote(id: string) {
  const invalidate = useInvalidatePlanner();
  return useCanvasMutation(
    async (client, input: PlannerNoteInput) =>
      toPlannerNote(
        await client.put<CanvasPlannerNote>(`/api/v1/planner_notes/${id}`, {
          title: input.title,
          details: input.details,
          todo_date: input.todoDate.toISOString(),
          // An empty course_id unlinks the course.
          course_id: input.courseId ?? '',
        }),
      ),
    { onSuccess: () => invalidate() },
  );
}

export function useDeletePlannerNote(id: string) {
  const invalidate = useInvalidatePlanner();
  return useCanvasMutation(
    (client, _: void) => client.delete<CanvasPlannerNote>(`/api/v1/planner_notes/${id}`),
    { onSuccess: () => invalidate(id) },
  );
}
