import { type CanvasClient, CanvasError } from '../client';
import { useCanvasQuery } from '../query';

/**
 * Sessionless tool launches (LTI-1). Canvas answers with a one-time URL that
 * signs the launch in by itself, so it works in a browser that has no Canvas
 * session: `app/controllers/external_tools_controller.rb#generate_sessionless_launch`
 * and `lti/concerns/sessionless_launches.rb`.
 */

/** `GET /api/v1/{courses|accounts}/:id/external_tools/sessionless_launch` */
export type CanvasSessionlessLaunch = {
  id?: string | number;
  name?: string;
  url?: string;
  /** Canvas answers 200 with this when no tool matches. */
  errors?: Record<string, unknown>;
};

export type SessionlessLaunchRequest = {
  /** Omit for account-level (global navigation) tools. */
  courseId?: string;
  /** Account for an account-level launch; `self` (the school's root account) when omitted. */
  accountId?: string;
  /** Tool ID, `context_external_tool_<id>` or bare. */
  toolId?: string;
  launchType?: 'assessment' | 'module_item' | 'course_navigation' | 'global_navigation';
  /** Tool launch URL, e.g. the `url` of an `external_tools/retrieve` link. */
  url?: string;
  assignmentId?: string;
  moduleItemId?: string;
  resourceLinkLookupUuid?: string;
  /**
   * A ready-made sessionless launch API URL, such as a course tab's `url`.
   * Used as is when present.
   */
  endpoint?: string;
};

export type ToolLaunchTarget = {
  /** The tool's ID in Canvas, stable across launches. Null if Canvas didn't say. */
  toolId: string | null;
  name: string | null;
  /** One-time launch URL. Open it within about 30 seconds. */
  url: string;
  /** LTI 1.3 launches carry a session token in the URL; 1.1 launches carry a verifier. */
  lti13: boolean;
};

export class ToolLaunchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly reason?: 'missing-settings',
  ) {
    super(message);
    this.name = 'ToolLaunchError';
  }
}

/** `context_external_tool_801` → `801`. */
export function bareToolId(id: string | null | undefined): string | null {
  if (!id) return null;
  const match = String(id).match(/(\d+)$/);
  return match ? match[1] : String(id);
}

function contextPath(request: Pick<SessionlessLaunchRequest, 'courseId' | 'accountId'>) {
  return request.courseId ? `courses/${request.courseId}` : `accounts/${request.accountId ?? 'self'}`;
}

function endpointPath(request: SessionlessLaunchRequest) {
  return `/api/v1/${contextPath(request)}/external_tools/sessionless_launch`;
}

function errorText(errors: Record<string, unknown>): string | null {
  for (const value of Object.values(errors)) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const first = value[0] as { message?: string } | string | undefined;
      if (typeof first === 'string') return first;
      if (first?.message) return first.message;
    }
  }
  return null;
}

export async function fetchSessionlessLaunch(
  client: CanvasClient,
  request: SessionlessLaunchRequest,
): Promise<ToolLaunchTarget> {
  let data: CanvasSessionlessLaunch;
  try {
    data = request.endpoint
      ? await client.get<CanvasSessionlessLaunch>(request.endpoint)
      : await client.get<CanvasSessionlessLaunch>(endpointPath(request), {
          id: bareToolId(request.toolId) ?? undefined,
          launch_type: request.launchType,
          url: request.url,
          assignment_id: request.assignmentId,
          module_item_id: request.moduleItemId,
          resource_link_lookup_uuid: request.resourceLinkLookupUuid,
        });
  } catch (error) {
    if (error instanceof CanvasError) throw new ToolLaunchError(error.message, error.status);
    throw error;
  }
  if (!data?.url) {
    const reason = data?.errors ? errorText(data.errors) : null;
    throw new ToolLaunchError(reason ?? 'Canvas couldn’t find the settings for this tool.', undefined,
      reason === null ? 'missing-settings' : undefined);
  }
  let lti13 = false;
  try {
    lti13 = new URL(data.url, client.baseUrl).searchParams.has('session_token');
  } catch {
    // Not a parseable URL; treat it as LTI 1.1.
  }
  return {
    toolId: data.id !== undefined && data.id !== null ? String(data.id) : null,
    name: data.name ?? null,
    url: new URL(data.url, client.baseUrl).toString(),
    lti13,
  };
}

/**
 * Where a tool lives on the Canvas web. Opening it with a Canvas session
 * relaunches the tool, which makes it the "Open in browser" fallback (LTI-3).
 */
export function toolWebUrl(baseUrl: string, request: SessionlessLaunchRequest): string | null {
  const course = request.courseId;
  if (course && request.moduleItemId)
    return `${baseUrl}/courses/${course}/modules/items/${request.moduleItemId}`;
  if (course && request.assignmentId)
    return `${baseUrl}/courses/${course}/assignments/${request.assignmentId}`;
  const tool = bareToolId(request.toolId);
  if (tool) {
    const launchType = request.launchType === 'global_navigation' ? '?launch_type=global_navigation' : '';
    return `${baseUrl}/${contextPath(request)}/external_tools/${tool}${launchType}`;
  }
  if (request.url) {
    const query = new URLSearchParams({ url: request.url, display: 'borderless' });
    if (request.resourceLinkLookupUuid)
      query.set('resource_link_lookup_uuid', request.resourceLinkLookupUuid);
    return `${baseUrl}/${contextPath(request)}/external_tools/retrieve?${query}`;
  }
  return null;
}

/**
 * Reads an `external_tools/retrieve` link (an LTI iframe or button in content)
 * into a launch request: the tool URL, the resource link, and the context.
 */
export function parseRetrieveUrl(url: string, baseUrl: string): SessionlessLaunchRequest | null {
  let parsed: URL;
  try {
    parsed = new URL(url, baseUrl);
  } catch {
    return null;
  }
  const match = parsed.pathname.match(/^\/(courses|accounts)\/([^/]+)\/external_tools\/retrieve\/?$/);
  if (!match) return null;
  const toolUrl = parsed.searchParams.get('url') ?? undefined;
  const lookup =
    parsed.searchParams.get('resource_link_lookup_uuid') ??
    parsed.searchParams.get('resource_link_lookup_id') ??
    undefined;
  if (!toolUrl && !lookup) return null;
  return {
    courseId: match[1] === 'courses' ? match[2] : undefined,
    url: toolUrl,
    resourceLinkLookupUuid: lookup,
  };
}

// ---------------------------------------------------------------------------
// Global navigation tools (LTI-6)

/**
 * `GET /api/v1/accounts/self/lti_apps/launch_definitions?placements[]=global_navigation`
 * (lti/lti_apps_controller.rb#launch_definitions, lib/lti/app_launch_collator.rb). Students
 * may read this one placement at the account level; it's what the Canvas apps use.
 */
export type CanvasLaunchDefinition = {
  definition_type: string;
  definition_id: string;
  name: string;
  description?: string | null;
  url?: string | null;
  domain?: string | null;
  placements?: {
    global_navigation?: {
      title?: string | null;
      url?: string | null;
      icon_url?: string | null;
      /** `/accounts/:account_id/external_tools/:id?launch_type=global_navigation` */
      html_url?: string | null;
      message_type?: string | null;
    };
  };
};

export type GlobalTool = {
  /** The tool's ID in Canvas. */
  id: string;
  name: string;
  description: string | null;
  domain: string | null;
  iconUrl: string | null;
  /** The tool's launch URL, for telling where it opens. */
  url: string | null;
  /** The account the tool is installed in, read from its Canvas page. */
  accountId: string | null;
  /** The tool's Canvas page, which relaunches it: the "Open in browser" fallback. */
  webUrl: string | null;
};

export function toGlobalTool(def: CanvasLaunchDefinition, baseUrl: string): GlobalTool {
  const placement = def.placements?.global_navigation;
  let accountId: string | null = null;
  let webUrl: string | null = null;
  if (placement?.html_url) {
    try {
      const page = new URL(placement.html_url, baseUrl);
      accountId = page.pathname.match(/^\/accounts\/([^/]+)\/external_tools\//)?.[1] ?? null;
      webUrl = page.toString();
    } catch {
      // No Canvas page; launches go through the root account.
    }
  }
  return {
    id: String(def.definition_id),
    name: placement?.title || def.name,
    description: def.description || null,
    domain: def.domain || null,
    iconUrl: placement?.icon_url || null,
    url: placement?.url || def.url || null,
    accountId,
    webUrl,
  };
}

export async function fetchGlobalTools(client: CanvasClient, signal?: AbortSignal): Promise<GlobalTool[]> {
  const defs = await client.getAll<CanvasLaunchDefinition>(
    '/api/v1/accounts/self/lti_apps/launch_definitions',
    { placements: ['global_navigation'] },
    { signal, maxPages: 5 },
  );
  return defs
    .filter((d) => d.definition_type === 'ContextExternalTool' && d.placements?.global_navigation)
    .map((d) => toGlobalTool(d, client.baseUrl))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Tools the school added to Canvas's main menu, like Studio or a portfolio. */
export function useGlobalTools() {
  return useCanvasQuery(['lti', 'global'], fetchGlobalTools, { staleTime: 10 * 60_000 });
}
