import { type CanvasClient, CanvasError } from '../client';
import { useCanvasQuery } from '../query';
import { fetchAssignmentGroups } from './assignments';
import { fetchDiscussions } from './discussions';
import { fetchModules } from './modules';
import { type CanvasPage, fetchPages } from './pages';
import { fetchCourseTabs } from './tabs';

/*
 * Course search (COURSE-6). Schools with IgniteAI Search get Canvas's smart
 * search (`GET /courses/:id/smartsearch`), which matches meaning, not just
 * words. Everywhere else, Easel searches titles of the course's assignments,
 * pages, modules, and discussions on the device.
 *
 * Detecting smart search: Canvas adds a course tab with ID `search` when it's
 * available (course.rb TAB_SEARCH), and drops it when the instructor hides it.
 * The `smart_search` feature flag is the fallback signal. A 403 from the
 * endpoint means it's off after all.
 */

/** search_result_json (lib/api/v1/search_result.rb) */
type CanvasSearchResult = {
  content_id: string;
  content_type: 'Assignment' | 'WikiPage' | 'DiscussionTopic' | 'Announcement' | string;
  readable_type?: string;
  title: string;
  /** Plain text. */
  body?: string | null;
  html_url: string;
  /** 0 to 100. */
  relevance?: number | null;
  distance?: number | null;
};

export type SearchKind = 'assignment' | 'page' | 'discussion' | 'announcement' | 'module' | 'quiz';

export type SearchResult = {
  /** `<kind>:<id>`, unique across kinds. */
  key: string;
  kind: SearchKind;
  id: string;
  title: string;
  /** A line of context: the matching text for smart search, or the item's details. */
  snippet: string | null;
  htmlUrl: string | null;
  /** Pages open by URL slug. */
  pageUrl?: string;
  /** Quizzes and graded discussions open their own screens. */
  quizId?: string | null;
  discussionTopicId?: string | null;
  /** Smart search's confidence, 0 to 100. */
  relevance: number | null;
};

export type SearchMode = 'smart' | 'titles';

const kinds: Record<string, SearchKind> = {
  Assignment: 'assignment',
  WikiPage: 'page',
  DiscussionTopic: 'discussion',
  Announcement: 'announcement',
};

/** `/courses/1/pages/lab-safety` → `lab-safety`. */
const pageSlug = (url: string) => url.match(/\/pages\/([^/?#]+)/)?.[1];

function toSmartResult(r: CanvasSearchResult): SearchResult | null {
  const kind = kinds[r.content_type];
  if (!kind) return null;
  return {
    key: `${kind}:${r.content_id}`,
    kind,
    id: String(r.content_id),
    title: r.title,
    snippet: r.body?.replace(/\s+/g, ' ').trim().slice(0, 180) || null,
    htmlUrl: r.html_url,
    pageUrl: kind === 'page' ? (pageSlug(r.html_url) ?? undefined) : undefined,
    relevance: r.relevance ?? null,
  };
}

/** Whether the course offers smart search: its `search` tab, or the feature flag. */
export async function fetchSearchMode(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<SearchMode> {
  const tabs = await fetchCourseTabs(client, courseId, signal).catch(() => null);
  if (tabs?.some((t) => t.id === 'search' && !t.hidden)) return 'smart';
  if (tabs?.some((t) => t.id === 'search')) return 'titles';
  const flags = await client
    .get<string[]>(`/api/v1/courses/${courseId}/features/enabled`, undefined, signal)
    .catch(() => [] as string[]);
  return Array.isArray(flags) && flags.includes('smart_search') ? 'smart' : 'titles';
}

export function useSearchMode(courseId: string) {
  return useCanvasQuery(
    ['courses', courseId, 'search', 'mode'],
    (client, signal) => fetchSearchMode(client, courseId, signal),
    { staleTime: 30 * 60_000 },
  );
}

/** Smart search results, best match first. Throws `SmartSearchOff` when Canvas refuses. */
export class SmartSearchOff extends Error {
  constructor() {
    super('Smart search is off for this course.');
    this.name = 'SmartSearchOff';
  }
}

export async function fetchSmartSearch(
  client: CanvasClient,
  courseId: string,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  try {
    const data = await client.get<{ results?: CanvasSearchResult[] }>(
      `/api/v1/courses/${courseId}/smartsearch`,
      { q: query, per_page: 30 },
      signal,
    );
    return (data?.results ?? []).map(toSmartResult).filter((r): r is SearchResult => !!r);
  } catch (error) {
    if (error instanceof CanvasError && (error.status === 403 || error.status === 404)) throw new SmartSearchOff();
    throw error;
  }
}

/** Everything searchable by title on the device: the course's assignments, pages, modules, and discussions. */
export async function fetchSearchIndex(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<{ results: SearchResult[]; unavailable: SearchKind[] }> {
  const unavailable: SearchKind[] = [];
  // A list the course turned off or the student can't see shouldn't sink the rest.
  const safe = <T>(kind: SearchKind, p: Promise<T[]>) => p.catch((error): T[] => {
    if (signal?.aborted || error?.name === 'CanvasAuthError') throw error;
    unavailable.push(kind);
    return [];
  });
  const [assignments, pages, modules, discussions] = await Promise.all([
    safe('assignment', fetchAssignmentGroups(client, courseId, null, signal).then((list) => list.assignments)),
    safe('page', fetchPages(client, courseId, signal)),
    safe('module', fetchModules(client, courseId, signal)),
    safe('discussion', fetchDiscussions(client, { type: 'course', id: courseId }, signal)),
  ]);
  const results: SearchResult[] = [];
  for (const a of assignments) {
    const kind = a.kind === 'quiz' ? 'quiz' : a.discussionTopicId ? 'discussion' : 'assignment';
    const id = kind === 'discussion' ? a.discussionTopicId! : a.id;
    results.push({
      key: `${kind}:${id}`,
      kind,
      id,
      title: a.name,
      snippet: null,
      htmlUrl: a.htmlUrl,
      quizId: a.quizId,
      discussionTopicId: a.discussionTopicId,
      relevance: null,
    });
  }
  for (const p of pages)
    results.push({
      key: `page:${p.url}`,
      kind: 'page',
      id: p.id,
      title: p.title,
      snippet: null,
      htmlUrl: p.htmlUrl,
      pageUrl: p.url,
      relevance: null,
    });
  for (const m of modules) {
    results.push({
      key: `module:${m.id}`,
      kind: 'module',
      id: m.id,
      title: m.name,
      snippet: null,
      htmlUrl: null,
      relevance: null,
    });
  }
  for (const m of modules) for (const item of m.items) {
    if (item.type !== 'Page' || !item.pageUrl) continue;
    results.push({ key: `page:${item.pageUrl}`, kind: 'page', id: item.contentId ?? item.id,
      title: item.title, snippet: null, htmlUrl: item.htmlUrl, pageUrl: item.pageUrl, relevance: null });
  }
  // A hidden Pages tab disables its index, but linked pages remain readable.
  if (unavailable.includes('page')) {
    try {
      const home = await client.get<CanvasPage>(`/api/v1/courses/${courseId}/front_page`, undefined, signal);
      const slugs = [...new Set(Array.from((home.body ?? '').matchAll(/href=["'][^"']*\/courses\/([^/"']+)\/pages\/([^?#!"'/]+)/g))
        .filter((match) => match[1] === courseId).map((match) => match[2]))];
      await Promise.all(slugs.map(async (slug) => {
        try {
          const page = await client.get<CanvasPage>(`/api/v1/courses/${courseId}/pages/${slug}`, undefined, signal);
          results.push({ key: `page:${page.url}`, kind: 'page', id: String(page.page_id),
            title: page.title, snippet: null, htmlUrl: page.html_url, pageUrl: page.url, relevance: null });
        } catch (error) { if (signal?.aborted || (error as Error).name === 'CanvasAuthError') throw error; }
      }));
    } catch (error) { if (signal?.aborted || (error as Error).name === 'CanvasAuthError') throw error; }
  }
  const assignmentTopics = new Set(assignments.map((a) => a.discussionTopicId).filter(Boolean));
  for (const d of discussions) {
    if (assignmentTopics.has(d.id)) continue;
    results.push({
      key: `discussion:${d.id}`,
      kind: 'discussion',
      id: d.id,
      title: d.title,
      snippet: d.preview || null,
      htmlUrl: d.htmlUrl,
      relevance: null,
    });
  }
  return { results: [...new Map(results.map((result) => [result.key, result])).values()], unavailable };
}

/** Lowercase without accents, so "psych" finds "Psychologie". */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Title matches, every word somewhere in the title; titles that start with the query first. */
export function searchTitles(index: SearchResult[], query: string): SearchResult[] {
  const q = fold(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/);
  return index
    .filter((r) => {
      const title = fold(r.title);
      return words.every((w) => title.includes(w));
    })
    .sort((a, b) => Number(fold(b.title).startsWith(q)) - Number(fold(a.title).startsWith(q)));
}

export function useSearchIndex(courseId: string, enabled: boolean) {
  return useCanvasQuery(
    ['courses', courseId, 'search', 'index-v2'],
    (client, signal) => fetchSearchIndex(client, courseId, signal),
    { enabled, staleTime: 5 * 60_000 },
  );
}

export function useSmartSearch(courseId: string, query: string, enabled: boolean) {
  return useCanvasQuery(
    ['courses', courseId, 'search', 'smart', query],
    (client, signal) => fetchSmartSearch(client, courseId, query, signal),
    {
      enabled: enabled && query.trim().length > 1,
      staleTime: 5 * 60_000,
      retry: (count, error) => !(error instanceof SmartSearchOff) && count < 1,
      placeholderData: (previous) => previous,
    },
  );
}
