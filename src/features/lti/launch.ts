/**
 * External tool launches (LTI-1 to LTI-3). Every screen that opens a tool goes
 * through `useLaunchTool`, so the launch flow, where the tool opens, and the
 * browser fallback live in one place.
 *
 * 1. A sessionless launch (`external_tools/sessionless_launch`) gets a one-time
 *    URL that signs the tool in without a Canvas session.
 * 2. The tool opens in the in-app browser, or in Easel's signed-in web view when
 *    it needs the Canvas session (New Quizzes, Instructure tools, tools on the
 *    school's Canvas host). The student can switch per tool; Easel remembers it
 *    per account (`preferences.ts`).
 * 3. A launch that fails says why and offers the Canvas page in the browser,
 *    signed in through `session_token` (LTI-3).
 */
import * as WebBrowser from 'expo-web-browser';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';

import {
  bareToolId,
  fetchSessionlessLaunch,
  parseRetrieveUrl,
  type SessionlessLaunchRequest,
  ToolLaunchError,
  type ToolLaunchTarget,
  toolWebUrl,
} from '@/canvas/api/lti';
import { type CanvasClient, CanvasNetworkError } from '@/canvas/client';
import { useCanvas } from '@/canvas/session';
import { useTheme } from '@/design';
import { useTranslation, type Translate } from '@/i18n';
import { sessionUrl } from '@/features/content/browser';
import { openWebView } from '@/features/web/open';

import { useToolLifetime } from './lifetime';

import { type ToolOpenMode, toolOpenMode } from './preferences';

export type ToolLaunch = {
  /** Course for a course-level sessionless launch. Omit for account-level tools. */
  courseId?: string;
  /** Account an account-level tool is installed in. Defaults to the school's root account. */
  accountId?: string;
  /** Launch the tool attached to this assignment (`launch_type=assessment`). */
  assignmentId?: string;
  /** Launch the tool behind this module item (`launch_type=module_item`). */
  moduleItemId?: string;
  /** The module item's module, so the launch can mark it viewed (LTI-7). Looked up when omitted. */
  moduleId?: string;
  /**
   * Launch a tool by its URL, e.g. an LTI link inside content. Also accepts an
   * `external_tools/retrieve` link or a ready-made sessionless launch API URL.
   */
  url?: string;
  /** `context_external_tool_<id>` style ID for a course navigation tab. */
  toolId?: string;
  launchType?: 'assessment' | 'module_item' | 'course_navigation' | 'global_navigation';
  /** Shown while the tool loads. */
  title?: string;
  /** Canvas page that opens in the browser when the launch fails. */
  fallbackUrl?: string;
  /** Resource link for launches from content (`resource_link_lookup_uuid`). */
  resourceLinkLookupUuid?: string;
  /** The tool needs the Canvas session, so it opens in Easel's web view unless the student chose otherwise. */
  needsSession?: boolean;
  /** Asks before leaving the tool, e.g. a quiz in progress. New Quizzes get one automatically. */
  guard?: string;
};

const SESSIONLESS_ENDPOINT =
  /\/api\/v1\/(courses|accounts)\/([^/]+)\/external_tools\/sessionless_launch/;
const TOOL_PAGE = /^\/(courses|accounts)\/([^/]+)\/external_tools\/(\d+)\/?$/;

/** Turns a launch into the sessionless request Canvas expects. */
export function launchRequest(launch: ToolLaunch, baseUrl: string): SessionlessLaunchRequest {
  const base: SessionlessLaunchRequest = {
    courseId: launch.courseId,
    accountId: launch.courseId ? undefined : launch.accountId,
    toolId: launch.toolId,
    launchType: launch.launchType,
    assignmentId: launch.assignmentId,
    moduleItemId: launch.moduleItemId,
    resourceLinkLookupUuid: launch.resourceLinkLookupUuid,
  };
  if (launch.moduleItemId) return { ...base, launchType: 'module_item' };
  if (launch.assignmentId) return { ...base, launchType: 'assessment' };
  if (launch.url) {
    if (SESSIONLESS_ENDPOINT.test(launch.url)) return { ...base, endpoint: launch.url };
    const retrieve = parseRetrieveUrl(launch.url, baseUrl);
    if (retrieve) return { ...base, ...retrieve, courseId: retrieve.courseId ?? launch.courseId };
    try {
      const parsed = new URL(launch.url, baseUrl);
      const page = parsed.host === new URL(baseUrl).host ? parsed.pathname.match(TOOL_PAGE) : null;
      if (page)
        return {
          ...base,
          courseId: page[1] === 'courses' ? page[2] : launch.courseId,
          toolId: page[3],
          launchType: launch.launchType ?? 'course_navigation',
        };
    } catch {
      // Not a URL Easel can read; send it as the tool URL.
    }
    // A tool URL alone is a "retrieve" launch; Canvas finds the tool by its domain.
    return { ...base, url: launch.url, launchType: launch.toolId ? launch.launchType : undefined };
  }
  if (launch.toolId) return { ...base, launchType: launch.launchType ?? 'course_navigation' };
  return base;
}

const NEW_QUIZZES = /^(quizzes 2|quizzes\.next|new quizzes|quizzes)$/i;
const INSTRUCTURE_TOOL = /\b(studio|instructure|mastery connect|canvas)\b/i;
const INSTRUCTURE_HOST = /(^|\.)(instructure\.com|instructuremedia\.com|canvaslms\.com)$/i;

export function isNewQuizzes(name: string | null | undefined) {
  return !!name && NEW_QUIZZES.test(name.trim());
}

/** Where a tool opens when the student hasn't chosen (LTI-2). */
export function defaultOpenMode(
  launch: ToolLaunch,
  target: ToolLaunchTarget,
  baseUrl: string,
): ToolOpenMode {
  if (launch.needsSession || isNewQuizzes(target.name)) return 'app';
  if (target.name && INSTRUCTURE_TOOL.test(target.name)) return 'app';
  // The tool's own URL, not a Canvas launch endpoint or retrieve link that wraps it. Module
  // item and assignment launches don't send it (it would override the launch), but it still
  // says where the tool lives.
  const toolUrl =
    launch.moduleItemId || launch.assignmentId ? launch.url : launchRequest(launch, baseUrl).url;
  if (toolUrl) {
    try {
      const host = new URL(toolUrl, baseUrl).hostname;
      if (host === new URL(baseUrl).hostname || INSTRUCTURE_HOST.test(host)) return 'app';
    } catch {
      // Unknown host; the browser is the safe default.
    }
  }
  return 'browser';
}

/** Where a tool will open before it's launched, from what a screen knows about it. */
export function predictOpenMode(
  name: string | null,
  toolUrl: string | null | undefined,
  baseUrl: string,
  needsSession?: boolean,
): ToolOpenMode {
  return defaultOpenMode(
    { url: toolUrl ?? undefined, needsSession },
    { toolId: null, name, url: '', lti13: false },
    baseUrl,
  );
}

/** The key a tool's remembered choice is stored under. */
export function toolKey(launch: ToolLaunch, target?: ToolLaunchTarget | null): string | null {
  return target?.toolId ?? bareToolId(launch.toolId);
}

/** `platform=mobile` tells LTI 1.3 tools (New Quizzes among them) they're in a phone app. iOS only, as Canvas's own app does. */
function launchUrl(target: ToolLaunchTarget): string {
  if (Platform.OS !== 'ios' || !target.lti13 || /[?&]platform=/.test(target.url)) return target.url;
  const [rest, hash = ''] = target.url.split('#');
  return `${rest}${rest.includes('?') ? '&' : '?'}platform=mobile${hash ? `#${hash}` : ''}`;
}

function failureReason(error: unknown, t: Translate): string {
  if (error instanceof CanvasNetworkError) return t('tools.failure.network');
  if (error instanceof ToolLaunchError) {
    if (error.status === 404) return t('tools.failure.missing');
    if (error.status === 401 || error.status === 403) return t('tools.failure.denied');
    if (error.status === undefined)
      return error.reason === 'missing-settings' ? t('tools.failure.settings') : error.message;
  }
  return t('tools.failure.generic');
}

/** Gets a fresh one-time launch URL for a tool, ready to load. */
export async function launchTarget(
  client: Parameters<typeof fetchSessionlessLaunch>[0],
  launch: ToolLaunch,
): Promise<{ target: ToolLaunchTarget; url: string }> {
  const target = await fetchSessionlessLaunch(client, launchRequest(launch, client.baseUrl));
  return { target, url: launchUrl(target) };
}

/**
 * Fulfills a module item's "view" requirement (LTI-7). Canvas marks an item
 * viewed when its launch passes through the module item page, which LTI 1.3
 * launches do, but an LTI 1.1 sessionless launch skips it. The Canvas apps
 * post `mark_read` after every module item launch, and so does Easel; it's
 * harmless when Canvas already counted the view.
 */
async function markModuleItemViewed(
  client: CanvasClient,
  courseId: string,
  itemId: string,
  moduleId: string | undefined,
  isCurrent: () => boolean,
) {
  if (!isCurrent()) return false;
  let module = moduleId;
  if (!module) {
    const sequence = await client.get<{
      items?: { current?: { module_id?: string | number } | null }[];
    }>(`/api/v1/courses/${courseId}/module_item_sequence`, {
      asset_type: 'ModuleItem',
      asset_id: itemId,
    });
    const found = sequence.items?.[0]?.current?.module_id;
    module = found !== undefined && found !== null ? String(found) : undefined;
  }
  if (!module || !isCurrent()) return false;
  await client.post<unknown>(
    `/api/v1/courses/${courseId}/modules/${module}/items/${itemId}/mark_read`,
  );
  return true;
}

/** Additional live caller policy; never serialized into ToolLaunch or navigation. */
export type ToolLaunchLifetime = { isCurrent: () => boolean };

/** Account/client safety is intrinsic. Resource policy belongs to the optional caller scope. */
export function useLaunchTool(): (
  launch: ToolLaunch,
  lifetime?: ToolLaunchLifetime,
) => Promise<void> {
  const { t } = useTranslation();
  const { client, account } = useCanvas();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const owner = useToolLifetime(JSON.stringify([account.id, account.baseUrl]), client);

  return useCallback(
    async (launch: ToolLaunch, lifetime?: ToolLaunchLifetime) => {
      const live = owner.capture();
      const callerCurrent = () => live() && (lifetime?.isCurrent() ?? true);
      if (!callerCurrent()) return;
      // A deliberate retry supersedes this request's old alert, without gating other tools.
      const invocationKey = JSON.stringify(launchRequest(launch, account.baseUrl));
      const invocation = {};
      owner.invocations.set(invocationKey, invocation);
      const isCurrent = () =>
        callerCurrent() && owner.invocations.get(invocationKey) === invocation;
      const openFallback = async (url: string) => {
        if (!isCurrent()) return;
        const signed = await sessionUrl(client, url);
        if (!isCurrent()) return;
        // Preserve openSignedIn's default native options, but guard its async boundary here.
        await WebBrowser.openBrowserAsync(signed);
      };
      const name = launch.title ?? t('tools.thisTool');
      const fallback =
        launch.fallbackUrl ?? toolWebUrl(account.baseUrl, launchRequest(launch, account.baseUrl));
      let launched: { target: ToolLaunchTarget; url: string };
      try {
        launched = await launchTarget(client, launch);
      } catch (error) {
        if (!isCurrent()) return;
        let consumed = false;
        const consume = () => {
          if (consumed || !isCurrent()) return false;
          consumed = true;
          return true;
        };
        const reason = failureReason(error, t);
        Alert.alert(
          t('tools.failure.title', { name }),
          fallback ? t('tools.failure.fallback', { reason }) : reason,
          fallback
            ? [
                {
                  text: t('common.cancel'),
                  style: 'cancel',
                  onPress: () => {
                    consume();
                  },
                },
                {
                  text: t('tools.openBrowser'),
                  onPress: () => {
                    if (consume()) return openFallback(fallback).catch(() => {});
                  },
                },
              ]
            : [
                {
                  text: t('tools.ok'),
                  onPress: () => {
                    consume();
                  },
                },
              ],
          {
            onDismiss: () => {
              consume();
            },
          },
        );
        return;
      }

      if (!isCurrent()) return;
      const { target, url } = launched;
      const key = toolKey(launch, target);

      if (launch.courseId && launch.moduleItemId) {
        const courseId = launch.courseId;
        markModuleItemViewed(client, courseId, launch.moduleItemId, launch.moduleId, isCurrent)
          // Module progress and what it unlocks.
          .then((marked) => {
            if (marked)
              return queryClient.invalidateQueries({
                queryKey: [account.id, 'courses', courseId, 'modules'],
              });
          })
          // Locked items and offline launches fail here; the launch itself still goes ahead.
          .catch(() => {});
      }
      const mode =
        (await toolOpenMode(account.id, key)) ?? defaultOpenMode(launch, target, account.baseUrl);
      if (!isCurrent()) return;
      const newQuiz = isNewQuizzes(target.name);

      if (mode === 'browser') {
        await WebBrowser.openBrowserAsync(url, {
          controlsColor: colors.accentFg,
          toolbarColor: colors.bg,
          secondaryToolbarColor: colors.bg,
          dismissButtonStyle: 'done',
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
          enableBarCollapsing: true,
          showTitle: true,
        }).catch(() => openFallback(fallback ?? url).catch(() => {}));
        return;
      }

      openWebView({
        url,
        signed: true,
        title: launch.title ?? target.name ?? (newQuiz ? t('tools.quiz') : t('tools.tool')),
        guard: launch.guard ?? (newQuiz ? t('quizEntry.leave') : undefined),
        launch: { ...launch, fallbackUrl: fallback ?? undefined },
        tool: { id: key, name: target.name },
        courseId: launch.courseId,
      });
    },
    [client, account.id, account.baseUrl, colors.accentFg, colors.bg, queryClient, t, owner],
  );
}
