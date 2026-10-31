import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { fetchCourseAnnouncements } from '@/canvas/api/announcements';
import {
  assignmentKeys,
  fetchAssignment,
  fetchAssignmentGroups as fetchAssignmentList,
  fetchGradingPeriods as fetchAssignmentPeriods,
  fetchSubmission,
} from '@/canvas/api/assignments';
import { fetchCourse } from '@/canvas/api/courses';
import {
  contextKey,
  courseContext,
  type DiscussionTopic,
  fetchDiscussions,
  fetchDiscussionThread,
  fetchDiscussionTopic,
} from '@/canvas/api/discussions';
import {
  type FileItem,
  fetchFile,
  fetchFolderContents,
  fetchRootFolder,
  fileKey,
  type FolderItem,
} from '@/canvas/api/files';
import {
  fetchAssignmentGroups as fetchGradeGroups,
  fetchCustomGradeStatuses,
  fetchEnrollmentGrades,
  fetchGradesCourse,
  fetchGradingPeriods as fetchGradePeriods,
} from '@/canvas/api/grades';
import { fetchModuleItemSequence, fetchModules } from '@/canvas/api/modules';
import { fetchPage, fetchPages, FRONT_PAGE } from '@/canvas/api/pages';
import { fetchSyllabus } from '@/canvas/api/syllabus';
import { fetchCourseTabs } from '@/canvas/api/tabs';
import { CanvasAuthError, type CanvasClient, CanvasNetworkError } from '@/canvas/client';
import type { Account } from '@/canvas/session';
import { downloadFile, FileDownloadError, listDownloads, removeDownload } from '@/features/files/download';
import { describeFile } from '@/features/files/kinds';

import { courseSnapshotEntries, saveCourseSnapshot, type SnapshotEntry, snapshotSize } from './snapshots';
import { collectAssetHtml } from './assetHtml';
import { courseAssetBytes, removeCourseAssets, syncEmbeddedAssets } from './assets';
import { beginCourseSync } from './lifecycle';
import { courseStatus, setCourseStatus, type SyncContent } from './settings';

/*
 * Course sync (OFF-3): downloads everything a course's screens need, so they
 * open offline exactly as they do online. Each piece is fetched with the
 * feature's own fetcher and stored under the same query key its screen uses
 * (keep these in step with the hooks in src/canvas/api/*). The results go into
 * the live query cache, when the app is running, and into the course's
 * snapshot on disk. Files are kept under Documents, where the viewer finds them.
 */

const stepLabels = {
  course: 'Course',
  pages: 'Pages',
  modules: 'Modules',
  assignments: 'Assignments',
  grades: 'Grades',
  syllabus: 'Syllabus',
  announcements: 'Announcements',
  discussions: 'Discussions',
  files: 'Files',
  embeddedAssets: 'Embedded images and media',
} as const;
export type SyncStep = keyof typeof stepLabels;

export type SyncProgress = {
  courseId: string;
  courseName: string;
  /** What's happening: "Pages", "Files". */
  step: string;
  /** Stable presentation identifier; optional for compatibility with older progress snapshots. */
  stepKey?: SyncStep;
  done: number;
  total: number;
  /** Bytes downloaded for files in this run. */
  bytes: number;
};

export type CourseToSync = { id: string; name: string; content: SyncContent[] };

export type SyncContext = {
  account: Account;
  client: CanvasClient;
  queryClient: QueryClient | null;
  signal: AbortSignal;
  onProgress: (progress: SyncProgress) => void;
};

export type CourseSyncResult = { courseId: string; ok: boolean; error: string | null; bytes: number };

/** Requests in flight at once. Canvas rate-limits heavy clients; this stays well under it. */
const CONCURRENCY = 4;

class Cancelled extends Error {
  constructor() {
    super('Sync cancelled');
    this.name = 'AbortError';
  }
}

const isAbort = (error: unknown) => (error as Error)?.name === 'AbortError';

async function pool<T>(items: T[], signal: AbortSignal, run: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (signal.aborted) throw new Cancelled();
      const item = items[next++];
      await run(item);
    }
  };
  // Let every in-flight worker settle before saving partial results or starting another course.
  const results = await Promise.allSettled(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

/** One course: every chosen kind of content, then its snapshot. */
export async function syncCourse(course: CourseToSync, ctx: SyncContext): Promise<CourseSyncResult> {
  const lease = beginCourseSync(ctx.account.id, course.id, ctx.signal);
  try {
    return await syncCourseWithLease(course, { ...ctx, signal: lease.controller.signal }, () => !lease.removed);
  } finally { lease.finish(); }
}

async function syncCourseWithLease(course: CourseToSync, ctx: SyncContext, canSave: () => boolean): Promise<CourseSyncResult> {
  const { account, client, queryClient, signal } = ctx;
  const accountId = account.id;
  const want = new Set(course.content);
  const entries = new Map<string, SnapshotEntry>();
  const files = new Map<string, FileItem>();
  const html = new Set<string>();
  const attemptedFileIds = new Set<string>();
  let unsupportedEmbeds = 0;
  let skipped = 0;
  let bytes = 0;
  const keptIds: string[] = [];
  const progress: SyncProgress = {
    courseId: course.id,
    courseName: course.name,
    step: 'Course',
    stepKey: 'course',
    done: 0,
    total: 2,
    bytes: 0,
  };
  const report = () => ctx.onProgress({ ...progress });

  const put = (key: QueryKey, data: unknown) => {
    if (!canSave()) throw new Cancelled();
    collectAssetHtml(data, html);
    const queryKey = [accountId, ...key];
    const updatedAt = Date.now();
    entries.set(JSON.stringify(queryKey), { queryKey, data, updatedAt });
    queryClient?.setQueryData(queryKey, data, { updatedAt });
  };

  /** Runs one request; failures that aren't about the connection are counted and skipped. */
  const step = async <T>(run: () => Promise<T>): Promise<T | null> => {
    if (signal.aborted) throw new Cancelled();
    try {
      return await run();
    } catch (error) {
      if (isAbort(error) || signal.aborted) throw new Cancelled();
      if (error instanceof CanvasNetworkError || error instanceof CanvasAuthError) throw error;
      skipped += 1;
      return null;
    } finally {
      progress.done += 1;
      report();
    }
  };

  const plan = (n: number, stepKey: SyncStep) => {
    progress.total += n;
    progress.step = stepLabels[stepKey];
    progress.stepKey = stepKey;
    report();
  };

  const c = course.id;
  try {
    report();
    // The course home and its tabs, always: without them nothing else opens.
    const detail = await step(() => fetchCourse(client, c, signal));
    if (detail) put(['courses', c], detail);
    const tabs = await step(() => fetchCourseTabs(client, c, signal));
    if (tabs) put(['courses', c, 'tabs'], tabs);

    const pageUrls = new Set<string>();
    const assignmentIds = new Set<string>();
    const topicIds = new Set<string>();
    const fileIds = new Set<string>();

    if (want.has('pages')) {
      plan(1, 'pages');
      const pages = await step(() => fetchPages(client, c, signal));
      if (pages) {
        put(['courses', c, 'pages'], pages);
        for (const page of pages) pageUrls.add(page.url);
        if (pages.some((p) => p.isFrontPage)) pageUrls.add(FRONT_PAGE);
      }
    }

    if (want.has('modules')) {
      plan(1, 'modules');
      const modules = await step(() => fetchModules(client, c, signal));
      if (modules) {
        put(['courses', c, 'modules'], modules);
        const items = modules.flatMap((m) => m.items).filter((i) => i.type !== 'SubHeader');
        plan(items.length, 'modules');
        await pool(items, signal, async (item) => {
          const sequence = await step(() => fetchModuleItemSequence(client, c, item.id, signal));
          if (sequence) put(['courses', c, 'module_item_sequence', item.id], sequence);
        });
        // What the modules point at opens offline too, even when its own tab is hidden.
        for (const item of items) {
          if (item.type === 'Page' && item.pageUrl) pageUrls.add(item.pageUrl);
          if (item.type === 'Assignment' && item.contentId) assignmentIds.add(item.contentId);
          if (item.type === 'Discussion' && item.contentId) topicIds.add(item.contentId);
          if (item.type === 'File' && item.contentId) fileIds.add(item.contentId);
        }
      }
    }

    if (pageUrls.size) {
      const urls = [...pageUrls];
      plan(urls.length, 'pages');
      await pool(urls, signal, async (url) => {
        const page = await step(() => fetchPage(client, c, url, signal));
        if (page) {
          put(['courses', c, 'pages', url], page);
          if (url === FRONT_PAGE) put(['courses', c, 'pages', page.url], page);
        }
      });
    }

    if (want.has('assignments')) {
      plan(1, 'assignments');
      const periods = (await step(() => fetchAssignmentPeriods(client, c, signal))) ?? [];
      put(['courses', c, 'grading_periods'], periods);
      const views: (string | null)[] = [null, ...periods.map((p) => p.id)];
      plan(views.length, 'assignments');
      await pool(views, signal, async (periodId) => {
        const list = await step(() => fetchAssignmentList(client, c, periodId, signal));
        if (!list) return;
        put(['courses', c, 'assignment_groups', periodId ?? 'all'], list);
        for (const a of list.assignments) assignmentIds.add(a.id);
      });
    }

    if (assignmentIds.size) {
      const ids = [...assignmentIds];
      plan(ids.length * 2, 'assignments');
      await pool(ids, signal, async (id) => {
        const assignment = await step(() => fetchAssignment(client, c, id, signal));
        if (assignment) put(assignmentKeys.detail(c, id), assignment);
        const submission = await step(() => fetchSubmission(client, c, id, signal));
        if (submission) put(assignmentKeys.submission(c, id), submission);
      });
    }

    if (want.has('grades')) {
      plan(2, 'grades');
      const settings = await step(() => fetchGradesCourse(client, c, signal));
      if (settings) put(['grades', c, 'course'], settings);
      const periods = (await step(() => fetchGradePeriods(client, c, signal))) ?? [];
      put(['grades', c, 'periods'], periods);
      const views: (string | null)[] = [null, ...periods.map((p) => p.id)];
      plan(views.length * 2, 'grades');
      let customStatuses = false;
      await pool(views, signal, async (periodId) => {
        const groups = await step(() => fetchGradeGroups(client, c, periodId, signal));
        if (groups) {
          put(['grades', c, 'groups', periodId ?? 'all'], groups);
          customStatuses ||= groups.some((g) => g.assignments.some((a) => a.submission?.customStatusId));
        }
        // Null is a real answer here ("no grades yet"), so wrap it to tell it from a skipped request.
        const enrollment = await step(async () => ({
          value: await fetchEnrollmentGrades(client, c, account.user.id, periodId, signal),
        }));
        if (enrollment) put(['grades', c, 'enrollment', periodId ?? 'all'], enrollment.value);
      });
      if (customStatuses) {
        plan(1, 'grades');
        const statuses = await step(() => fetchCustomGradeStatuses(client, c));
        if (statuses) put(['grades', c, 'custom-statuses'], statuses);
      }
    }

    if (want.has('syllabus')) {
      plan(1, 'syllabus');
      const syllabus = await step(() => fetchSyllabus(client, c, signal));
      if (syllabus) put(['courses', c, 'syllabus'], syllabus);
    }

    const context = courseContext(c);
    const topics: DiscussionTopic[] = [];
    if (want.has('announcements')) {
      plan(1, 'announcements');
      const announcements = await step(() => fetchCourseAnnouncements(client, c, signal));
      if (announcements) {
        put(['announcements', 'course', c], announcements);
        for (const a of announcements) topicIds.add(a.id);
      }
    }
    if (want.has('discussions')) {
      plan(1, 'discussions');
      const list = await step(() => fetchDiscussions(client, context, signal));
      if (list) {
        put(['discussions', contextKey(context)], list);
        for (const t of list) topicIds.add(t.id);
      }
    }
    if (topicIds.size) {
      const ids = [...topicIds];
      plan(ids.length * 2, want.has('discussions') ? 'discussions' : 'announcements');
      await pool(ids, signal, async (id) => {
        const topic = await step(() => fetchDiscussionTopic(client, context, id, signal));
        if (!topic) {
          progress.done += 1;
          return;
        }
        topics.push(topic);
        put(['discussion', contextKey(context), id], topic);
        if (!topic.canSeePosts) {
          progress.done += 1;
          return;
        }
        const thread = await step(() =>
          fetchDiscussionThread(client, context, id, account.user.id, topic.anonymity !== null, signal),
        );
        if (thread) put(['discussion', contextKey(context), id, 'view'], thread);
      });
    }

    const keepFiles = want.has('files') || want.has('media');
    if (keepFiles || fileIds.size) {
      plan(1, 'files');
      const listed = keepFiles ? await walkFiles(client, c, signal, put, (n) => plan(n, 'files'), step) : [];
      for (const file of listed) files.set(file.id, file);
      // Files the modules use, even if the Files tab isn't synced.
      const missing = [...fileIds].filter((id) => !files.has(id));
      plan(missing.length, 'files');
      await pool(missing, signal, async (id) => {
        const file = await step(() => fetchFile(client, id, { courseId: c, signal }));
        if (file) {
          files.set(file.id, file);
          put(fileKey(file.id), file);
        }
      });
    }

    const toKeep = [...files.values()].filter((file) => {
      if (file.lockedForUser || !file.url) return false;
      const { kind } = describeFile(file);
      const media = kind === 'video' || kind === 'audio';
      // Module files are kept regardless of kind, except media unless asked for.
      if (media) return want.has('media');
      return want.has('files') || fileIds.has(file.id);
    });
    if (toKeep.length) {
      plan(toKeep.length, 'files');
      await pool(toKeep, signal, async (file) => {
        if (signal.aborted) throw new Cancelled();
        try {
          let last = 0;
          attemptedFileIds.add(file.id);
          const local = await downloadFile(client, accountId, file, {
            keep: true,
            signal,
            onProgress: ({ bytes: written }) => {
              progress.bytes += written - last;
              last = written;
              report();
            },
          });
          keptIds.push(file.id);
          bytes += local.size ?? 0;
        } catch (error) {
          if (isAbort(error) || signal.aborted) throw new Cancelled();
          if (error instanceof FileDownloadError && error.kind === 'offline') throw new CanvasNetworkError();
          skipped += 1;
        } finally {
          progress.done += 1;
          report();
        }
      });
    }

    const assets = await syncEmbeddedAssets({
      accountId, courseId: c, client, html, media: want.has('media'), signal, canSave, preservePrevious: skipped > 0,
      onProgress: (done, total) => {
        progress.stepKey = 'embeddedAssets';
        progress.step = stepLabels.embeddedAssets;
        progress.done = done;
        progress.total = total;
        report();
      },
    });
    unsupportedEmbeds = assets.unsupported;
    skipped += assets.skipped + assets.unsupported;
    if (!canSave()) throw new Cancelled();
    const previous = courseStatus(accountId, c);
    // A partial response must not erase previously usable offline content.
    if (skipped) {
      for (const old of courseSnapshotEntries(accountId, c)) {
        const key = JSON.stringify(old.queryKey);
        if (!entries.has(key)) entries.set(key, old);
      }
      for (const id of previous?.fileIds ?? []) if (!keptIds.includes(id)) keptIds.push(id);
    } else {
      for (const id of previous?.fileIds ?? [])
        if (!keptIds.includes(id)) removeDownload(accountId, id, 'kept');
    }

    const snapshotBytes = saveCourseSnapshot(accountId, c, [...entries.values()]);
    if (!canSave()) throw new Cancelled();
    bytes = listDownloads(accountId)
      .filter((download) => download.kept && keptIds.includes(download.file.id))
      .reduce((total, download) => total + download.size, 0);
    setCourseStatus(accountId, c, {
      syncedAt: Date.now(),
      bytes: bytes + snapshotBytes + courseAssetBytes(accountId, c),
      fileIds: keptIds,
      skipped,
      unsupportedEmbeds,
      error: null,
    });
    return { courseId: c, ok: true, error: null, bytes: bytes + snapshotBytes + courseAssetBytes(accountId, c) };
  } catch (error) {
    if (!canSave()) {
      // All workers have settled. Delete even partially written file directories.
      for (const id of attemptedFileIds) removeDownload(accountId, id, 'kept');
      removeCourseAssets(accountId, c);
      throw new Cancelled();
    }
    // Keep what came down, merged over the last full sync, so a cancelled or
    // interrupted sync never leaves the course with less than before.
    if (entries.size) {
      const merged = new Map<string, SnapshotEntry>();
      for (const old of courseSnapshotEntries(accountId, c)) merged.set(JSON.stringify(old.queryKey), old);
      for (const [key, entry] of entries) merged.set(key, entry);
      saveCourseSnapshot(accountId, c, [...merged.values()]);
    }
    if (!canSave()) throw new Cancelled();
    const message = isAbort(error)
      ? null
      : error instanceof CanvasNetworkError
        ? 'Sync stopped because Canvas couldn’t be reached.'
        : error instanceof CanvasAuthError
          ? 'Sign in again to sync this course.'
          : 'Something went wrong while syncing.';
    const previous = courseStatus(accountId, c);
    setCourseStatus(accountId, c, {
      syncedAt: previous?.syncedAt ?? null,
      bytes: snapshotSize(accountId, c) + courseAssetBytes(accountId, c) + listDownloads(accountId)
        .filter((download) => download.kept && [...(previous?.fileIds ?? []), ...keptIds].includes(download.file.id))
        .reduce((total, download) => total + download.size, 0),
      fileIds: [...new Set([...(previous?.fileIds ?? []), ...keptIds])],
      skipped,
      unsupportedEmbeds: unsupportedEmbeds || previous?.unsupportedEmbeds || 0,
      error: message,
    });
    if (isAbort(error)) throw error;
    return { courseId: c, ok: false, error: message, bytes };
  }
}

type Put = (key: QueryKey, data: unknown) => void;
type Step = <T>(run: () => Promise<T>) => Promise<T | null>;

/**
 * Every folder and file in the course, stored under the keys the file browser
 * reads (its default sort: name, ascending).
 */
async function walkFiles(
  client: CanvasClient,
  courseId: string,
  signal: AbortSignal,
  put: Put,
  plan: (n: number) => void,
  step: Step,
): Promise<FileItem[]> {
  const context = { type: 'courses' as const, id: courseId };
  const root = await step(() => fetchRootFolder(client, context, signal));
  if (!root) return [];
  put(['files', 'root', 'courses', courseId], root);
  put(['files', 'folder', root.id], root);
  const files: FileItem[] = [];
  let level: FolderItem[] = [root];
  while (level.length) {
    plan(level.length);
    const next: FolderItem[] = [];
    await pool(level, signal, async (folder) => {
      const contents = await step(() =>
        fetchFolderContents(client, folder.id, { by: 'name', order: 'asc' }, signal),
      );
      if (!contents) return;
      put(['files', 'contents', folder.id, 'name', 'asc'], contents);
      for (const sub of contents.folders) {
        put(['files', 'folder', sub.id], sub);
        if (!sub.lockedForUser) next.push(sub);
      }
      for (const file of contents.files) {
        const withContext: FileItem = file.context
          ? file
          : { ...file, context: { type: 'course', id: courseId } };
        put(fileKey(file.id), withContext);
        files.push(withContext);
      }
    });
    level = next;
  }
  return files;
}

/** Bytes a synced course uses now: its snapshot plus its kept files. */
export function courseBytes(accountId: string, courseId: string): number {
  const status = courseStatus(accountId, courseId);
  return status ? status.bytes : snapshotSize(accountId, courseId);
}
