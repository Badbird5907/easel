import { router } from 'expo-router';
import type { Translate } from '@/i18n';

import type { Assignment } from '@/canvas/api/assignments';
import type { ModuleItem } from '@/canvas/api/modules';
import { FRONT_PAGE } from '@/canvas/api/pages';
import type { CourseTab } from '@/canvas/api/tabs';
import type { ToolLaunch } from '@/features/lti/launch';

export type RouteTarget = { pathname: string; params?: Record<string, string> };

/**
 * Pushes a route. Some targets (files, grades, announcements, discussions) belong
 * to screens other workstreams are building; until they land, +not-found offers
 * the Canvas page instead, using `canvasUrl`.
 */
export function pushRoute(target: RouteTarget) {
  router.push(target as never);
}

/** Course tabs Easel shows natively, by Canvas tab ID (COURSE-3). */
const nativeTabRoutes: Record<string, string> = {
  assignments: '/course/[courseId]/assignments',
  modules: '/course/[courseId]/modules',
  pages: '/course/[courseId]/pages',
  syllabus: '/course/[courseId]/syllabus',
  quizzes: '/course/[courseId]/quizzes',
  people: '/course/[courseId]/people',
  files: '/course/[courseId]/files',
  grades: '/course/[courseId]/grades',
  announcements: '/course/[courseId]/announcements',
  discussions: '/course/[courseId]/discussions',
  conferences: '/course/[courseId]/conferences',
  search: '/course/[courseId]/search',
  outcomes: '/course/[courseId]/outcomes',
};

export type DefaultView = 'feed' | 'wiki' | 'modules' | 'assignments' | 'syllabus';

/** What the Home tab shows, per the course's `default_view` (COURSE-2). */
export const defaultViewLabels: Record<DefaultView, string> = {
  modules: 'Modules',
  assignments: 'Assignments',
  syllabus: 'Syllabus',
  wiki: 'Front page',
  feed: 'Recent activity',
};

export function asDefaultView(value: string | null | undefined): DefaultView {
  return value && Object.hasOwn(defaultViewLabels, value) ? (value as DefaultView) : 'modules';
}

/** Viewing-language label; legacy English table remains for existing consumers. */
export function defaultViewLabel(view: DefaultView, t: Translate): string {
  return t(`course.default.${asDefaultView(view)}`);
}

export type TabAction =
  | { kind: 'route'; target: RouteTarget }
  /** An external tool tab, launched per LTI-2 (COURSE-4). */
  | { kind: 'tool'; launch: ToolLaunch }
  /** Collaborations and other web-only tabs: Easel's signed-in web view. */
  | { kind: 'web'; url: string; title: string };

/**
 * Where a course tab goes: a native screen, a tool launch, or the Canvas web
 * in Easel's signed-in web view for Collaborations and anything
 * else without a native screen (COURSE-4).
 */
export function tabAction(tab: CourseTab, courseId: string, defaultView: DefaultView, t?: Translate): TabAction {
  defaultView = asDefaultView(defaultView);
  const webUrl = tab.fullUrl ?? tab.htmlUrl;
  const web: TabAction = { kind: 'web', url: webUrl, title: tab.label };
  if (tab.external)
    return {
      kind: 'tool',
      launch: {
        courseId,
        toolId: tab.id,
        launchType: 'course_navigation',
        url: tab.launchUrl ?? undefined,
        title: tab.label,
        fallbackUrl: webUrl,
      },
    };
  // Home opens the course's default view. It skips the hidden-tab check: Canvas
  // shows the default view even when its tab is hidden.
  if (tab.id === 'home') {
    switch (defaultView) {
      case 'feed':
        return { ...web, title: t ? defaultViewLabel('feed', t) : defaultViewLabels.feed };
      case 'wiki':
        return {
          kind: 'route',
          target: {
            pathname: '/course/[courseId]/page/[pageUrl]',
            params: { courseId, pageUrl: FRONT_PAGE },
          },
        };
      default:
        return {
          kind: 'route',
          target: { pathname: nativeTabRoutes[defaultView], params: { courseId, fromHome: '1' } },
        };
    }
  }
  const pathname = Object.hasOwn(nativeTabRoutes, tab.id) ? nativeTabRoutes[tab.id] : undefined;
  if (!pathname) return web;
  return { kind: 'route', target: { pathname, params: { courseId, canvasUrl: webUrl } } };
}

/** Quizzes and graded discussions open their own screens; everything else opens assignment details. */
export function assignmentTarget(a: Assignment): RouteTarget {
  const courseId = a.courseId;
  if (a.kind === 'quiz' && a.quizId)
    return { pathname: '/course/[courseId]/quiz/[quizId]', params: { courseId, quizId: a.quizId } };
  if (a.kind === 'discussion' && a.discussionTopicId)
    return {
      pathname: '/course/[courseId]/discussion/[topicId]',
      params: { courseId, topicId: a.discussionTopicId, canvasUrl: a.htmlUrl },
    };
  return {
    pathname: '/course/[courseId]/assignment/[assignmentId]',
    params: { courseId, assignmentId: a.id },
  };
}

export function moduleItemTarget(courseId: string, item: ModuleItem): RouteTarget {
  return {
    pathname: '/course/[courseId]/module-item/[itemId]',
    params: { courseId, itemId: item.id },
  };
}

export function discussionTarget(courseId: string, topicId: string, canvasUrl?: string | null): RouteTarget {
  return {
    pathname: '/course/[courseId]/discussion/[topicId]',
    params: { courseId, topicId, ...(canvasUrl && { canvasUrl }) },
  };
}

export function fileTarget(fileId: string, courseId?: string, canvasUrl?: string | null): RouteTarget {
  return {
    pathname: '/file/[fileId]',
    params: { fileId, ...(courseId && { courseId }), ...(canvasUrl && { canvasUrl }) },
  };
}
