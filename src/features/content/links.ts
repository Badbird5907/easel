import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

type RouteTarget = { pathname: string; params?: Record<string, string> };

/**
 * Canvas URL patterns and the Easel route each opens. Order matters: first match wins.
 * Routes are root-stack screens so any tab can open them. Every push carries
 * `canvasUrl` so a screen (or +not-found) can offer "Open in browser".
 *
 * `pattern` is tested against the path. `search`, when set, must also match the
 * query string (with its `?`); its match is the route's second argument.
 *
 * Feature owners: add a pattern here when you ship the screen it points to.
 */
const internalRoutes: {
  pattern: RegExp;
  search?: RegExp;
  route: (m: RegExpMatchArray, s: RegExpMatchArray) => RouteTarget;
}[] = [
  {
    pattern: /^\/courses\/(\d+)\/assignments\/syllabus\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/syllabus', params: { courseId: m[1] } }),
  },
  {
    pattern: /^\/courses\/(\d+)\/assignments\/(\d+)\/submissions\/(self|\d+)/,
    route: (m) => ({
      pathname: '/course/[courseId]/assignment/[assignmentId]/submission',
      params: { courseId: m[1], assignmentId: m[2], submissionUserId: m[3] },
    }),
  },
  // Peer reviews (ASSIGN-12): the planner's assessment_request links and the peer review list.
  // They're more specific than the assignment pattern below, so they come first.
  {
    pattern: /^\/courses\/(\d+)\/assignments\/(\d+)\/?$/,
    search: /[?&]reviewee_id=(\d+)/,
    route: (m, s) => ({
      pathname: '/peer-review/[courseId]/[assignmentId]/[reviewee]',
      params: { courseId: m[1], assignmentId: m[2], reviewee: `user-${s[1]}` },
    }),
  },
  {
    pattern: /^\/courses\/(\d+)\/assignments\/(\d+)\/?$/,
    search: /[?&]anonymous_asset_id=([^&#]+)/,
    route: (m, s) => ({
      pathname: '/peer-review/[courseId]/[assignmentId]/[reviewee]',
      params: { courseId: m[1], assignmentId: m[2], reviewee: `anon-${decodeURIComponent(s[1])}` },
    }),
  },
  {
    pattern: /^\/courses\/(\d+)\/assignments\/(\d+)\/anonymous_submissions\/([^/?#]+)/,
    route: (m) => ({
      pathname: '/peer-review/[courseId]/[assignmentId]/[reviewee]',
      params: { courseId: m[1], assignmentId: m[2], reviewee: `anon-${decodeURIComponent(m[3])}` },
    }),
  },
  {
    pattern: /^\/courses\/(\d+)\/assignments\/(\d+)\/peer_reviews\/?$/,
    route: (m) => ({
      pathname: '/peer-review/[courseId]/[assignmentId]',
      params: { courseId: m[1], assignmentId: m[2] },
    }),
  },
  {
    pattern: /^\/courses\/(\d+)\/assignments\/(\d+)/,
    route: (m) => ({
      pathname: '/course/[courseId]/assignment/[assignmentId]',
      params: { courseId: m[1], assignmentId: m[2] },
    }),
  },
  {
    pattern: /^\/courses\/(\d+)\/assignments\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/assignments', params: { courseId: m[1] } }),
  },
  {
    pattern: /^\/courses\/(\d+)\/quizzes\/(\d+)/,
    route: (m) => ({
      pathname: '/course/[courseId]/quiz/[quizId]',
      params: { courseId: m[1], quizId: m[2] },
    }),
  },
  {
    pattern: /^\/courses\/(\d+)\/(?:discussion_topics|announcements)\/(\d+)/,
    route: (m) => ({
      pathname: '/course/[courseId]/discussion/[topicId]',
      params: { courseId: m[1], topicId: m[2] },
    }),
  },
  {
    pattern: /^\/courses\/(\d+)\/(?:pages|wiki)\/([^/?#]+)/,
    route: (m) => ({
      pathname: '/course/[courseId]/page/[pageUrl]',
      params: { courseId: m[1], pageUrl: m[2] },
    }),
  },
  {
    pattern: /^\/courses\/(\d+)\/modules\/items\/(\d+)/,
    route: (m) => ({
      pathname: '/course/[courseId]/module-item/[itemId]',
      params: { courseId: m[1], itemId: m[2] },
    }),
  },
  {
    pattern: /^\/courses\/(\d+)\/modules\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/modules', params: { courseId: m[1] } }),
  },
  {
    pattern: /^\/courses\/(\d+)\/files\/(\d+)/,
    route: (m) => ({ pathname: '/file/[fileId]', params: { fileId: m[2], courseId: m[1] } }),
  },
  {
    pattern: /^\/courses\/(\d+)\/grades\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/grades', params: { courseId: m[1] } }),
  },
  {
    pattern: /^\/courses\/(\d+)\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]', params: { courseId: m[1] } }),
  },
  { pattern: /^\/files\/(\d+)/, route: (m) => ({ pathname: '/file/[fileId]', params: { fileId: m[1] } }) },
  {
    pattern: /^\/conversations\/(\d+)/,
    route: (m) => ({ pathname: '/conversation/[conversationId]', params: { conversationId: m[1] } }),
  },
  // Files (owned by the Files workstream).
  {
    pattern: /^\/courses\/(\d+)\/files\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/files', params: { courseId: m[1] } }),
  },
  {
    pattern: /^\/courses\/(\d+)\/files\/folder\/(.+?)\/?$/,
    route: (m) => ({
      pathname: '/course/[courseId]/files',
      params: { courseId: m[1], path: decodeURIComponent(m[2]) },
    }),
  },
  {
    pattern: /^\/(?:users|groups)\/\d+\/files\/(\d+)/,
    route: (m) => ({ pathname: '/file/[fileId]', params: { fileId: m[1] } }),
  },
  {
    pattern: /^\/groups\/(\d+)\/files\/?$/,
    route: (m) => ({ pathname: '/files/group/[groupId]', params: { groupId: m[1] } }),
  },
  { pattern: /^\/files\/?$/, route: () => ({ pathname: '/files' }) },
  // Grades: a student's own grades page (enrollment html_url) and the all-courses grades page.
  {
    pattern: /^\/courses\/(\d+)\/grades\/\d+\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/grades', params: { courseId: m[1] } }),
  },
  { pattern: /^\/grades\/?$/, route: () => ({ pathname: '/grades' }) },
  // Announcements, discussions, and inbox lists.
  {
    pattern: /^\/courses\/(\d+)\/announcements\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/announcements', params: { courseId: m[1] } }),
  },
  {
    pattern: /^\/courses\/(\d+)\/discussion_topics\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/discussions', params: { courseId: m[1] } }),
  },
  { pattern: /^\/conversations\/?$/, route: () => ({ pathname: '/inbox' }) },
  // Calendar events, with or without a context prefix (/courses/1/calendar_events/2, /calendar_events/2).
  {
    pattern: /^\/(?:(?:courses|groups|users)\/\d+\/)?calendar_events\/(\d+)/,
    route: (m) => ({ pathname: '/event/[eventId]', params: { eventId: m[1] } }),
  },
  // Course content lists: pages, the front page, quizzes, people, a single module, all courses.
  {
    pattern: /^\/courses\/(\d+)\/pages\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/pages', params: { courseId: m[1] } }),
  },
  {
    pattern: /^\/courses\/(\d+)\/wiki\/?$/,
    route: (m) => ({
      pathname: '/course/[courseId]/page/[pageUrl]',
      params: { courseId: m[1], pageUrl: 'front_page' },
    }),
  },
  {
    pattern: /^\/courses\/(\d+)\/quizzes\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/quizzes', params: { courseId: m[1] } }),
  },
  {
    pattern: /^\/courses\/(\d+)\/users\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/people', params: { courseId: m[1] } }),
  },
  {
    pattern: /^\/courses\/(\d+)\/modules\/\d+\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/modules', params: { courseId: m[1] } }),
  },
  { pattern: /^\/courses\/?$/, route: () => ({ pathname: '/courses' }) },
  // Web-only course pages and tools (web view and LTI workstream): Easel's signed-in web view,
  // which reads the page from `canvasUrl`.
  {
    pattern: /^\/courses\/(\d+)\/(collaborations)\/?$/,
    route: (m) => ({
      pathname: '/web',
      params: { courseId: m[1], title: m[2][0].toUpperCase() + m[2].slice(1) },
    }),
  },
  {
    pattern: /^\/courses\/(\d+)\/external_tools\/\d+\/?$/,
    route: (m) => ({ pathname: '/web', params: { courseId: m[1], title: 'Tool' } }),
  },
  // Groups and course search (Course content and communication workstream).
  {
    pattern: /^\/groups\/(\d+)\/?$/,
    route: (m) => ({ pathname: '/group/[groupId]', params: { groupId: m[1] } }),
  },
  {
    pattern: /^\/groups\/(\d+)\/(?:discussion_topics|announcements)\/(\d+)/,
    route: (m) => ({
      pathname: '/group/[groupId]/discussion/[topicId]',
      params: { groupId: m[1], topicId: m[2] },
    }),
  },
  {
    pattern: /^\/groups\/(\d+)\/discussion_topics\/?$/,
    route: (m) => ({ pathname: '/group/[groupId]/discussions', params: { groupId: m[1] } }),
  },
  {
    pattern: /^\/groups\/(\d+)\/announcements\/?$/,
    route: (m) => ({ pathname: '/group/[groupId]/announcements', params: { groupId: m[1] } }),
  },
  {
    pattern: /^\/groups\/(\d+)\/(?:pages|wiki)\/([^/?#]+)/,
    route: (m) => ({ pathname: '/group/[groupId]/page/[pageUrl]', params: { groupId: m[1], pageUrl: m[2] } }),
  },
  {
    pattern: /^\/groups\/(\d+)\/(?:pages|wiki)\/?$/,
    route: (m) => ({ pathname: '/group/[groupId]/pages', params: { groupId: m[1] } }),
  },
  {
    pattern: /^\/groups\/(\d+)\/users\/?$/,
    route: (m) => ({ pathname: '/group/[groupId]/people', params: { groupId: m[1] } }),
  },
  {
    pattern: /^\/groups\/(\d+)\/conferences\/?$/,
    route: (m) => ({ pathname: '/group/[groupId]/conferences', params: { groupId: m[1] } }),
  },
  {
    pattern: /^\/courses\/(\d+)\/conferences\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/conferences', params: { courseId: m[1] } }),
  },
  {
    pattern: /^\/courses\/(\d+)\/search\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/search', params: { courseId: m[1] } }),
  },
  // Settings (SET-4, SET-6).
  { pattern: /^\/profile\/?$/, route: () => ({ pathname: '/profile' }) },
  { pattern: /^\/profile\/communication\/?$/, route: () => ({ pathname: '/canvas-notifications' }) },
  // Appointment scheduler (CAL-6), from the Calendar workstream.
  {
    pattern: /^\/appointment_groups\/(\d+)/,
    route: (m) => ({ pathname: '/appointments/[groupId]', params: { groupId: m[1] } }),
  },
  { pattern: /^\/appointment_groups\/?$/, route: () => ({ pathname: '/appointments' }) },
  // A calendar event's html_url: /calendar?event_id=8001&include_contexts=course_201 (CAL-3).
  {
    pattern: /^\/calendar2?\/?$/,
    search: /[?&]event_id=(\d+)/,
    route: (_m, s) => ({ pathname: '/event/[eventId]', params: { eventId: s[1] } }),
  },
  // Native own-user outcomes and ePortfolio list (CONTENT-12, CONTENT-13).
  {
    pattern: /^\/courses\/(\d+)\/outcomes\/?$/,
    route: (m) => ({ pathname: '/course/[courseId]/outcomes', params: { courseId: m[1] } }),
  },
  { pattern: /^\/dashboard\/eportfolios\/?$/, route: () => ({ pathname: '/eportfolios' }) },

];

/** The first route whose pattern (and query, when it has one) matches. */
function matchRoute(pathname: string, search: string): RouteTarget | null {
  for (const { pattern, search: query, route } of internalRoutes) {
    const match = pathname.match(pattern);
    if (!match) continue;
    const queryMatch = query ? search.match(query) : ([] as unknown as RegExpMatchArray);
    if (!queryMatch) continue;
    return route(match, queryMatch);
  }
  return null;
}

/** Resolves a Canvas link (absolute or relative) to an Easel route, or null. */
export function resolveCanvasLink(url: string, baseUrl: string) {
  try {
    const base = new URL(baseUrl);
    let parsed = new URL(url, base);
    // Scheme links carry a Canvas path, with its first segment in the hostname.
    // Use the current school, just as +native-intent does for OS-delivered links.
    if (parsed.protocol === 'easel:')
      parsed = new URL(`/${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`, base);
    if (!/^https?:$/.test(parsed.protocol) || parsed.host !== base.host) return null;
    const target = matchRoute(parsed.pathname, parsed.search);
    if (!target) return null;
    return { pathname: target.pathname, params: { ...target.params, canvasUrl: parsed.toString() } };
  } catch {
    return null;
  }
}

/** `/course/[courseId]` with `{ courseId: '1', tab: 'x' }` → `/course/1?tab=x`. */
export function hrefFor(target: RouteTarget): string {
  const params = { ...target.params };
  const pathname = target.pathname.replace(/\[([^\]]+)\]/g, (_, name: string) => {
    const value = params[name] ?? '';
    delete params[name];
    return encodeURIComponent(value);
  });
  const query = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * A Canvas path (`/courses/1/assignments/2?x=y`) as an Easel href, for links
 * that arrive without a school, like `easel://courses/1/assignments/2` (SYS-3).
 * Null when Easel has no screen for it, or the screen needs the full Canvas URL
 * (the signed-in web view).
 */
export function resolveCanvasPath(pathWithQuery: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`, 'https://canvas.invalid');
  } catch {
    return null;
  }
  const target = matchRoute(parsed.pathname, parsed.search);
  if (!target || target.pathname === '/web') return null;
  return hrefFor(target);
}

/** Opens a link from Canvas content: in Easel when it can, otherwise the in-app browser. */
export function openCanvasLink(url: string, baseUrl: string) {
  const target = resolveCanvasLink(url, baseUrl);
  if (target) {
    router.push(target as never);
    return;
  }
  let absolute = url;
  try {
    absolute = new URL(url, baseUrl).toString();
  } catch {
    return;
  }
  if (/^(mailto|tel|sms):/.test(absolute)) {
    Linking.openURL(absolute).catch(() => {});
    return;
  }
  return WebBrowser.openBrowserAsync(absolute).catch(() => {});
}
