import { useQueryClient } from '@tanstack/react-query';

import { htmlToText } from '../html';
import type { CanvasClient } from '../client';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';
import { type Assignment, type CanvasAssignment, toAssignment } from './assignments';

// Raw shapes (lib/api/v1/context_module.rb, app/helpers/application_helper.rb
// #context_module_sequence_items_by_asset_id).

export type CanvasModuleItemType =
  'File' | 'Page' | 'Discussion' | 'Assignment' | 'Quiz' | 'SubHeader' | 'ExternalUrl' | 'ExternalTool';

export type CanvasCompletionRequirementType =
  'must_view' | 'must_submit' | 'must_contribute' | 'min_score' | 'min_percentage' | 'must_mark_done';

export type CanvasModuleItem = {
  id: string;
  module_id: string;
  position: number;
  title: string;
  indent?: number;
  type: CanvasModuleItemType;
  content_id?: string;
  html_url?: string;
  url?: string;
  page_url?: string;
  external_url?: string;
  new_tab?: boolean;
  /** An Assignment item that is a New Quiz (LTI-1, QUIZ-8). */
  quiz_lti?: boolean;
  completion_requirement?: {
    type: CanvasCompletionRequirementType;
    min_score?: number;
    min_percentage?: number;
    /** Absent when Canvas has no progression for the user (e.g. in sequences). */
    completed?: boolean;
  };
  content_details?: {
    points_possible?: number | null;
    due_at?: string | null;
    unlock_at?: string | null;
    lock_at?: string | null;
    locked_for_user?: boolean;
    lock_explanation?: string | null;
  };
  /** With `include[]=mastery_paths` on the items endpoints. Null when the item triggers no paths. */
  mastery_paths?: CanvasMasteryPaths | null;
};

/**
 * Conditional release on a module item (app/helpers/cyoe_helper.rb
 * `conditional_release_json`, ConditionalRelease::Service rules_data). The
 * sets are the ones the student's score on the item unlocked.
 */
export type CanvasMasteryPaths = {
  /** The item isn't graded yet, so no path is open. */
  locked: boolean;
  assignment_sets: {
    id: string;
    scoring_range_id?: string;
    position?: number | null;
    assignment_set_associations?: {
      id?: string;
      assignment_id: string;
      position?: number | null;
      model?: CanvasAssignment | null;
    }[];
  }[];
  selected_set_id: string | null;
  /** Several sets and none chosen yet. */
  awaiting_choice?: boolean;
  /** Canvas is still assigning the one set that applies. */
  still_processing?: boolean;
};

export type CanvasModule = {
  id: string;
  position: number;
  name: string;
  unlock_at: string | null;
  require_sequential_progress?: boolean;
  requirement_type?: 'all' | 'one';
  prerequisite_module_ids?: string[];
  state?: 'locked' | 'unlocked' | 'started' | 'completed';
  completed_at?: string | null;
  items_count: number;
  items_url?: string;
  /** Present with `include[]=items` unless the module is too large. */
  items?: CanvasModuleItem[];
};

export type CanvasModuleItemSequence = {
  items: { prev: CanvasModuleItem | null; current: CanvasModuleItem | null; next: CanvasModuleItem | null }[];
  modules: CanvasModule[];
};

// Models

export type ModuleItemType = CanvasModuleItemType;

export type CompletionRequirement = {
  type: CanvasCompletionRequirementType;
  minScore: number | null;
  minPercentage: number | null;
  /** Null when Canvas didn't say (no progression in the response). */
  completed: boolean | null;
};

export type ModuleItem = {
  id: string;
  moduleId: string;
  title: string;
  indent: number;
  type: ModuleItemType;
  /** Assignment, quiz, discussion, file, or tool ID. */
  contentId: string | null;
  /** For pages: the page's URL slug. */
  pageUrl: string | null;
  htmlUrl: string | null;
  externalUrl: string | null;
  /** For ExternalTool items: the sessionless launch API URL Canvas gives in `url`. */
  launchUrl: string | null;
  /** An Assignment item that is a New Quiz. */
  quizLti: boolean;
  requirement: CompletionRequirement | null;
  dueAt: Date | null;
  points: number | null;
  locked: boolean;
  /** Plain-text reason the item is locked. */
  lockExplanation: string | null;
};

export type ModuleState = 'locked' | 'unlocked' | 'started' | 'completed';

export type CourseModule = {
  id: string;
  name: string;
  position: number;
  unlockAt: Date | null;
  sequential: boolean;
  /** `one`: completing any single requirement completes the module. */
  requirementType: 'all' | 'one';
  prerequisiteIds: string[];
  state: ModuleState | null;
  items: ModuleItem[];
};

export type ModuleItemSequence = {
  current: ModuleItem | null;
  prev: ModuleItem | null;
  next: ModuleItem | null;
  module: CourseModule | null;
};

const toDate = (value?: string | null) => (value ? new Date(value) : null);

export function toModuleItem(item: CanvasModuleItem): ModuleItem {
  const req = item.completion_requirement;
  const details = item.content_details;
  return {
    id: String(item.id),
    moduleId: String(item.module_id),
    title: item.title,
    indent: item.indent ?? 0,
    type: item.type,
    contentId: item.content_id ? String(item.content_id) : null,
    pageUrl: item.page_url ?? null,
    htmlUrl: item.html_url ?? null,
    externalUrl: item.external_url ?? null,
    launchUrl: item.type === 'ExternalTool' ? (item.url ?? null) : null,
    quizLti: item.quiz_lti ?? false,
    requirement: req
      ? {
          type: req.type,
          minScore: req.min_score ?? null,
          minPercentage: req.min_percentage ?? null,
          completed: req.completed ?? null,
        }
      : null,
    dueAt: toDate(details?.due_at),
    points: details?.points_possible ?? null,
    locked: details?.locked_for_user ?? false,
    lockExplanation: details?.lock_explanation ? htmlToText(details.lock_explanation) : null,
  };
}

function toModule(m: CanvasModule, items: CanvasModuleItem[]): CourseModule {
  return {
    id: String(m.id),
    name: m.name,
    position: m.position,
    unlockAt: toDate(m.unlock_at),
    sequential: m.require_sequential_progress ?? false,
    requirementType: m.requirement_type ?? 'all',
    prerequisiteIds: (m.prerequisite_module_ids ?? []).map(String),
    state: m.state ?? null,
    items: items.map(toModuleItem),
  };
}

// Fetchers and hooks

const itemQuery = { include: ['content_details'] };

export async function fetchModules(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<CourseModule[]> {
  const modules = await client.getAll<CanvasModule>(
    `/api/v1/courses/${courseId}/modules`,
    { include: ['items', 'content_details'] },
    { signal },
  );
  // Canvas leaves `items` out of large modules; fetch those separately.
  const items = await Promise.all(
    modules.map((m) =>
      (m.items && m.items.length >= m.items_count) || m.items_count === 0
        ? Promise.resolve(m.items ?? [])
        : client.getAll<CanvasModuleItem>(`/api/v1/courses/${courseId}/modules/${m.id}/items`, itemQuery, {
            signal,
          }),
    ),
  );
  return modules.map((m, i) => toModule(m, items[i])).sort((a, b) => a.position - b.position);
}

const modulesKey = (courseId: string) => ['courses', courseId, 'modules'];

/** Modules with items, requirements, and the student's progress (CONTENT-6). */
export function useModules(courseId: string) {
  return useCanvasQuery(modulesKey(courseId), (client, signal) => fetchModules(client, courseId, signal));
}

export async function fetchModuleItemSequence(
  client: CanvasClient,
  courseId: string,
  itemId: string,
  signal?: AbortSignal,
): Promise<ModuleItemSequence> {
  const data = await client.get<CanvasModuleItemSequence>(
    `/api/v1/courses/${courseId}/module_item_sequence`,
    { asset_type: 'ModuleItem', asset_id: itemId },
    signal,
  );
  const entry = data.items[0];
  const current = entry?.current ? toModuleItem(entry.current) : null;
  const module = current ? data.modules.find((m) => String(m.id) === current.moduleId) : undefined;
  return {
    current,
    prev: entry?.prev ? toModuleItem(entry.prev) : null,
    next: entry?.next ? toModuleItem(entry.next) : null,
    module: module ? toModule(module, []) : null,
  };
}

/** Previous and next items around a module item, across modules (CONTENT-7). */
export function useModuleItemSequence(courseId: string, itemId: string) {
  return useCanvasQuery(['courses', courseId, 'module_item_sequence', itemId], (client, signal) =>
    fetchModuleItemSequence(client, courseId, itemId, signal),
  );
}

type ItemRef = { moduleId: string; itemId: string };

function setItemCompleted(modules: CourseModule[] | undefined, ref: ItemRef, completed: boolean) {
  return modules?.map((m) =>
    m.id !== ref.moduleId
      ? m
      : {
          ...m,
          items: m.items.map((i) =>
            i.id === ref.itemId && i.requirement ? { ...i, requirement: { ...i.requirement, completed } } : i,
          ),
        },
  );
}

/** Marks a "mark as done" item done or not done, updating the list right away. */
export function useMarkModuleItemDone(courseId: string) {
  const queryClient = useQueryClient();
  const key = [useAccountKey(), ...modulesKey(courseId)];
  return useCanvasMutation(
    (client, { moduleId, itemId, done }: ItemRef & { done: boolean }) => {
      const path = `/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}/done`;
      return done ? client.put<unknown>(path) : client.delete<unknown>(path);
    },
    {
      onMutate: async (vars) => {
        await queryClient.cancelQueries({ queryKey: key });
        const previous = queryClient.getQueryData<CourseModule[]>(key);
        queryClient.setQueryData(key, setItemCompleted(previous, vars, vars.done));
        return { previous };
      },
      onError: (_error, _vars, context) => {
        const previous = (context as { previous?: CourseModule[] } | undefined)?.previous;
        if (previous) queryClient.setQueryData(key, previous);
      },
      // Completing an item can complete the module and unlock the next one.
      onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
    },
  );
}

/** Fulfills a "view" requirement. Canvas refuses locked items; that's fine to ignore. */
export function useMarkModuleItemViewed(courseId: string) {
  const queryClient = useQueryClient();
  const key = [useAccountKey(), ...modulesKey(courseId)];
  return useCanvasMutation(
    (client, { moduleId, itemId }: ItemRef) =>
      client.post<unknown>(`/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}/mark_read`),
    { onSuccess: () => queryClient.invalidateQueries({ queryKey: key }) },
  );
}

// Mastery paths (ASSIGN-15) ----------------------------------------------------

/** One path the student can take: an assignment set. */
export type MasteryPathOption = {
  id: string;
  /** 1-based, in Canvas's order ("Option 1"). */
  position: number;
  assignments: Assignment[];
};

export type MasteryPath = {
  /** The module item whose score opens the paths. */
  itemId: string;
  moduleId: string;
  /** Not graded yet, so no path is open. */
  locked: boolean;
  /** The paths the student's score opened. */
  options: MasteryPathOption[];
  selectedId: string | null;
  /** More than one path, none chosen. */
  awaitingChoice: boolean;
  /** Canvas is still assigning the path. */
  processing: boolean;
};

function toMasteryPath(item: CanvasModuleItem, paths: CanvasMasteryPaths): MasteryPath {
  const options = [...(paths.assignment_sets ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((set, index) => ({
      id: String(set.id),
      position: set.position ?? index + 1,
      assignments: [...(set.assignment_set_associations ?? [])]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .flatMap((assoc) => (assoc.model ? [toAssignment(assoc.model)] : [])),
    }));
  const selectedId = paths.selected_set_id != null ? String(paths.selected_set_id) : null;
  return {
    itemId: String(item.id),
    moduleId: String(item.module_id),
    locked: paths.locked,
    options,
    selectedId,
    awaitingChoice: paths.awaiting_choice ?? (selectedId === null && options.length > 1),
    processing: paths.still_processing ?? false,
  };
}

/** Only graded items (assignments, and quizzes through their assignment) can open paths. */
const mayTriggerPaths = (m: CourseModule) =>
  m.items.some((i) => i.type === 'Assignment' || i.type === 'Quiz');

/**
 * Mastery paths by module item ID. The modules index doesn't pass
 * `mastery_paths` through, so this reads the items of each module that could
 * hold a trigger, the way the official apps do.
 */
export async function fetchMasteryPaths(
  client: CanvasClient,
  courseId: string,
  moduleIds: string[],
  signal?: AbortSignal,
): Promise<Record<string, MasteryPath>> {
  const lists = await Promise.all(
    moduleIds.map((id) =>
      client.getAll<CanvasModuleItem>(
        `/api/v1/courses/${courseId}/modules/${id}/items`,
        { include: ['mastery_paths'] },
        { signal },
      ),
    ),
  );
  const byItem: Record<string, MasteryPath> = {};
  for (const item of lists.flat()) {
    if (item.mastery_paths) byItem[String(item.id)] = toMasteryPath(item, item.mastery_paths);
  }
  return byItem;
}

/** Mastery paths on the course's module items. Waits for the modules list. */
export function useMasteryPaths(courseId: string, modules: CourseModule[] | undefined) {
  const moduleIds = (modules ?? []).filter(mayTriggerPaths).map((m) => m.id);
  return useCanvasQuery(
    [...modulesKey(courseId), 'mastery_paths', moduleIds.join(',')],
    (client, signal) => fetchMasteryPaths(client, courseId, moduleIds, signal),
    { enabled: moduleIds.length > 0 },
  );
}

export type SelectMasteryPathInput = { moduleId: string; itemId: string; setId: string };

/**
 * Chooses a path (`POST …/items/:id/select_mastery_path`). Canvas then assigns
 * the set's assignments, sometimes a moment later, so the module, assignment
 * lists, and To Do all refresh.
 */
export function useSelectMasteryPath(courseId: string) {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    (client, { moduleId, itemId, setId }: SelectMasteryPathInput) =>
      client.post<unknown>(
        `/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}/select_mastery_path`,
        { assignment_set_id: setId },
      ),
    {
      onSuccess: (_data, { itemId, setId }) => {
        // Show the choice right away; the refetch fills in the released items.
        queryClient.setQueriesData<Record<string, MasteryPath>>(
          { queryKey: [accountKey, ...modulesKey(courseId), 'mastery_paths'] },
          (old) =>
            old?.[itemId]
              ? { ...old, [itemId]: { ...old[itemId], selectedId: setId, awaitingChoice: false } }
              : old,
        );
        return Promise.all(
          [
            modulesKey(courseId),
            ['courses', courseId, 'module_item_sequence'],
            ['courses', courseId, 'assignment_groups'],
            ['courses', courseId, 'syllabus'],
            ['grades', courseId],
            ['planner'],
          ].map((key) => queryClient.invalidateQueries({ queryKey: [accountKey, ...key] })),
        );
      },
    },
  );
}
