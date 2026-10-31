import { useQueryClient } from '@tanstack/react-query';

import { htmlToText } from '../html';
import type { CanvasClient } from '../client';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';

/** Where a page lives: a course's or a group's wiki (COURSE-7). */
export type PageContext = { type: 'course' | 'group'; id: string };

const base = (c: PageContext) => `/api/v1/${c.type === 'course' ? 'courses' : 'groups'}/${c.id}`;
/** Course pages keep the keys they had before groups: ['courses', id, 'pages', …]. */
const keyBase = (c: PageContext) => [c.type === 'course' ? 'courses' : 'groups', c.id, 'pages'];

/** `GET /api/v1/courses/:id/pages[/:url]` (lib/api/v1/wiki_page.rb) */
export type CanvasPage = {
  page_id: string;
  url: string;
  title: string;
  /** Only on single-page requests, and never when locked. */
  body?: string | null;
  created_at: string;
  updated_at: string;
  front_page: boolean;
  published?: boolean;
  html_url: string;
  locked_for_user?: boolean;
  lock_explanation?: string | null;
  last_edited_by?: { display_name?: string } | null;
  /** Comma-separated: `teachers`, `students`, `members`, `public`. */
  editing_roles?: string | null;
};

export type Page = {
  id: string;
  /** URL slug, the page's identifier in routes and the API. */
  url: string;
  title: string;
  html: string;
  htmlUrl: string;
  updatedAt: Date;
  isFrontPage: boolean;
  locked: boolean;
  lockExplanation: string | null;
  editedBy: string | null;
  /**
   * Students may edit it (CONTENT-8): its editing roles include students, or
   * everyone in the group or course (wiki_page.rb#can_edit_page?). Canvas has
   * the last word when the edit is saved.
   */
  editable: boolean;
};

/** Route value that stands for the course's front page (`GET …/front_page`). */
export const FRONT_PAGE = 'front_page';

function toPage(p: CanvasPage): Page {
  const roles = (p.editing_roles ?? 'teachers').split(',').map((r) => r.trim());
  return {
    id: String(p.page_id),
    url: p.url,
    title: p.title,
    html: p.body ?? '',
    htmlUrl: p.html_url,
    updatedAt: new Date(p.updated_at),
    isFrontPage: p.front_page,
    locked: p.locked_for_user ?? false,
    lockExplanation: p.lock_explanation ? htmlToText(p.lock_explanation) : null,
    editedBy: p.last_edited_by?.display_name ?? null,
    editable: !p.locked_for_user && roles.some((r) => r === 'students' || r === 'members' || r === 'public'),
  };
}

export async function fetchContextPages(client: CanvasClient, context: PageContext, signal?: AbortSignal) {
  const pages = await client.getAll<CanvasPage>(
    `${base(context)}/pages`,
    { sort: 'title', order: 'asc' },
    { signal },
  );
  // Front page first, then alphabetical.
  return pages.map(toPage).sort((a, b) => Number(b.isFrontPage) - Number(a.isFrontPage));
}

export const fetchPages = (client: CanvasClient, courseId: string, signal?: AbortSignal) =>
  fetchContextPages(client, { type: 'course', id: courseId }, signal);

/** A course's or group's pages (CONTENT-8). */
export function useContextPages(context: PageContext) {
  return useCanvasQuery(keyBase(context), (client, signal) => fetchContextPages(client, context, signal));
}

/** The course's pages (CONTENT-8). */
export function usePages(courseId: string) {
  return useContextPages({ type: 'course', id: courseId });
}

export async function fetchContextPage(
  client: CanvasClient,
  context: PageContext,
  pageUrl: string,
  signal?: AbortSignal,
) {
  const path =
    pageUrl === FRONT_PAGE
      ? `${base(context)}/front_page`
      : `${base(context)}/pages/${encodeURIComponent(pageUrl)}`;
  return toPage(await client.get<CanvasPage>(path, undefined, signal));
}

export const fetchPage = (client: CanvasClient, courseId: string, pageUrl: string, signal?: AbortSignal) =>
  fetchContextPage(client, { type: 'course', id: courseId }, pageUrl, signal);

/** One page with its body. Pass `FRONT_PAGE` for the front page. */
export function useContextPage(context: PageContext, pageUrl: string | null | undefined) {
  return useCanvasQuery(
    [...keyBase(context), pageUrl],
    (client, signal) => fetchContextPage(client, context, pageUrl!, signal),
    { enabled: !!pageUrl },
  );
}

/** One course page with its body. Pass `FRONT_PAGE` for the course's front page. */
export function usePage(courseId: string, pageUrl: string | null | undefined) {
  return useContextPage({ type: 'course', id: courseId }, pageUrl);
}

// MARK: Editing (CONTENT-8)

/** `GET …/pages/:url/revisions/latest?summary=true` */
type CanvasRevision = { revision_id: number | string; updated_at: string; edited_by?: { display_name?: string } };

export type Revision = { id: string; updatedAt: Date; editedBy: string | null };

/**
 * The page's newest revision. Canvas has no conflict check on save (last
 * write wins), so the editor compares this before and after, like the web
 * editor's "This page has changed since you started editing it".
 */
export async function fetchLatestRevision(
  client: CanvasClient,
  context: PageContext,
  pageUrl: string,
  signal?: AbortSignal,
): Promise<Revision> {
  const r = await client.get<CanvasRevision>(
    `${base(context)}/pages/${encodeURIComponent(pageUrl)}/revisions/latest`,
    { summary: true },
    signal,
  );
  return { id: String(r.revision_id), updatedAt: new Date(r.updated_at), editedBy: r.edited_by?.display_name ?? null };
}

export type PageEdit = { context: PageContext; pageUrl: string; html: string };

/**
 * Saves a page's body (`PUT …/pages/:url` with `wiki_page[body]`). Students
 * with edit rights may change only the body unless the course allows more,
 * so the title isn't sent.
 */
export function useUpdatePage() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    async (client, { context, pageUrl, html }: PageEdit) =>
      toPage(
        await client.put<CanvasPage>(`${base(context)}/pages/${encodeURIComponent(pageUrl)}`, {
          wiki_page: { body: html },
        }),
      ),
    {
      onSuccess: (page, { context, pageUrl }) => {
        queryClient.setQueryData([accountKey, ...keyBase(context), pageUrl], page);
        if (page.isFrontPage) queryClient.setQueryData([accountKey, ...keyBase(context), FRONT_PAGE], page);
        return queryClient.invalidateQueries({ queryKey: [accountKey, ...keyBase(context)] });
      },
    },
  );
}
