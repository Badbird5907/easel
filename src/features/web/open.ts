import { router } from 'expo-router';

import type { ToolLaunch } from '@/features/lti/launch';

export type WebViewRoute = {
  /** A Canvas page, any URL, or a one-time launch URL (with `signed`). */
  url: string;
  title?: string;
  /** Asks before leaving, e.g. "Leave this quiz? Your answers are saved, but the timer keeps running." */
  guard?: string;
  /** `url` is a one-time signed URL. */
  signed?: boolean;
  /** The tool behind the page, for relaunching and for "Open this tool in". */
  launch?: ToolLaunch;
  tool?: { id: string | null; name: string | null };
  courseId?: string;
};

/** Opens a page in Easel's signed-in web view (`/web`). */
export function openWebView({ url, title, guard, signed, launch, tool, courseId }: WebViewRoute) {
  const params: Record<string, string> = { url };
  if (title) params.title = title;
  if (guard) params.guard = guard;
  if (signed) params.signed = '1';
  if (launch) params.launch = JSON.stringify(launch);
  if (tool) params.tool = JSON.stringify(tool);
  if (courseId) params.courseId = courseId;
  router.push({ pathname: '/web', params } as never);
}

/** The guard for quizzes taken on the web: Canvas keeps the answers but not the clock. */
export const QUIZ_LEAVE_GUARD = 'Leave this quiz? Your answers are saved, but the timer keeps running.';
