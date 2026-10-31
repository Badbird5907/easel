/**
 * External tools (owned by the web view, LTI, and quizzes workstream): sessionless launches,
 * the Canvas pages that launch tools, the fake tools themselves, a fake New Quizzes, and the
 * Canvas media player that embeds play in.
 *
 * Shapes and rules follow canvas-lms:
 *   app/controllers/external_tools_controller.rb#generate_sessionless_launch and #sessionless_launch
 *   app/controllers/lti/concerns/sessionless_launches.rb   launch URLs per launch type
 *   app/views/lti/_launch_iframe.html.erb                   form posted into iframe#tool_content
 *
 * Tools (installed for every course and the account):
 *   801 Panopto Recordings  LTI 1.1, panopto.example.edu       course 201 tab, module item 7206
 *   802 Gradescope          LTI 1.1: the launch API fails with a 500, for the error path
 *   803 PrairieLearn        LTI 1.1, prairielearn.example.edu  course 225 tab, item 7322, assignment 9113
 *   804 Quizzes 2           LTI 1.3 New Quizzes                 assignment 9130
 *   805 Canvas Studio       LTI 1.3, instructuremedia.com       embeds in page lecture-6-media-and-tools
 *   806 Folio               LTI 1.1, portfolio.example.edu      global navigation (account 1)
 *   807 Library Search      LTI 1.3, library.example.edu        global navigation (account 1)
 *   (805 is in global navigation too.)
 *
 * Launch flow, as in Canvas:
 *   GET /api/v1/courses/:id/external_tools/sessionless_launch?id=…&launch_type=…  -> { id, name, url }
 *     LTI 1.1: url is /courses/:id/external_tools/sessionless_launch?verifier=… (single use;
 *              a second load answers 404 "Cannot locate launch request, please try again.")
 *     LTI 1.3: url carries a session_token (single use) and display=borderless:
 *              /courses/:id/external_tools/:tool, /courses/:id/assignments/:id (assessment),
 *              /courses/:id/external_tools/retrieve?url=… (by URL)
 *   That Canvas page posts the launch into iframe#tool_content, which loads the tool from
 *   http://127.0.0.1:3030/fake-tool/… so tools sit on a different host from Canvas.
 *   A used session_token without the session cookie it set redirects to /login/canvas;
 *   with the cookie (a reload in the same web view) the page loads. Pages without any
 *   session_token load as if signed in, because the fake's /api/v1/login/session_token
 *   hands back return_to unchanged.
 *   Errors: missing params answer 400 with ActiveModel-style errors; an unknown tool URL
 *   answers 200 `{ errors: { external_tool: "Unable to find a matching external tool" } }`;
 *   an unknown tool ID redirects to the course, as Canvas's find_tool does.
 *
 * Tool pages (`embed=1` is the compact, iframe-friendly mode): popup button that logs
 * messages from the popup, "Sign in with Google/Microsoft" OAuth popups that post back to
 * window.opener and close, a Content-Disposition attachment download, a Canvas file link,
 * a Canvas assignment link, file inputs (including capture), a camera and microphone test,
 * and a link with target=_blank. `platform` from the launch shows on the page.
 *
 * Media: /media_objects_iframe/:id is Canvas's media player; /fake-media/:name serves the
 * fixtures with byte ranges so inline video plays.
 */
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE, courseById, user } from '../data.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const PORT = process.env.PORT ?? 3030;
/** Tools live on another host than Canvas, as real tools do. */
const TOOL_BASE = `http://127.0.0.1:${PORT}`;

const state = (globalThis.__easelFakeLti ??= {
  verifiers: new Map(),
  sessionTokens: new Map(),
  newQuizzes: {},
});

const tools = {
  801: { id: '801', name: 'Panopto Recordings', domain: 'panopto.example.edu', version: '1.1' },
  802: { id: '802', name: 'Gradescope', domain: 'gradescope.com', version: '1.1', broken: true },
  803: { id: '803', name: 'PrairieLearn', domain: 'prairielearn.example.edu', version: '1.1' },
  804: { id: '804', name: 'Quizzes 2', domain: 'quiz-lti-iad-prod.instructure.com', version: '1.3' },
  805: { id: '805', name: 'Canvas Studio', domain: 'instructuremedia.com', version: '1.3' },
  806: { id: '806', name: 'Folio', domain: 'portfolio.example.edu', version: '1.1' },
  807: { id: '807', name: 'Library Search', domain: 'library.example.edu', version: '1.3' },
};

/**
 * Tools in Canvas's global navigation, as launch definitions
 * (lib/lti/app_launch_collator.rb#lti1_launch_definition and #global_nav_info).
 */
const globalNavigation = [
  { tool: '805', title: 'Studio', description: 'Your media library: record, upload, and caption videos.' },
  { tool: '806', title: 'Folio', description: 'Collect your best work into a portfolio.' },
  { tool: '807', title: 'Library Search', description: null },
];

function launchDefinitions({ query, url }) {
  const placements = query.placements ?? [];
  if (!(placements.length === 1 && placements[0] === 'global_navigation')) return [];
  return globalNavigation.map(({ tool: id, title, description }) => {
    const tool = tools[id];
    return {
      definition_type: 'ContextExternalTool',
      definition_id: tool.id,
      url: `https://${tool.domain}/lti/launch`,
      name: tool.name,
      description,
      domain: tool.domain,
      placements: {
        global_navigation: {
          message_type: tool.version === '1.3' ? 'LtiResourceLinkRequest' : 'basic-lti-launch-request',
          url: `https://${tool.domain}/lti/launch`,
          title,
          icon_url: null,
          icon_svg_path_64: null,
          html_url: `/accounts/1/external_tools/${tool.id}?launch_type=global_navigation`,
        },
      },
    };
  });
}

function toolForUrl(url) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  return Object.values(tools).find((t) => host === t.domain || host.endsWith(`.${t.domain}`)) ?? null;
}

const json = (body, status = 200) => ({ status, body });
const notFound = () => json({ errors: [{ message: 'The specified resource does not exist.' }] }, 404);
/** `render json: @context.errors` */
const fieldError = (field, message) =>
  json({ errors: { [field]: [{ attribute: field, type: message, message }] } }, 400);
const noMatchingTool = () => json({ errors: { external_tool: 'Unable to find a matching external tool' } });
const serverError = () =>
  json(
    {
      errors: [{ message: 'An error occurred.', error_code: 'internal_server_error' }],
      error_report_id: '4242',
    },
    500,
  );

const html = (body, status = 200, headers = {}) => ({
  status,
  body,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});
const redirect = (location, headers = {}) => ({
  status: 302,
  body: '',
  headers: { Location: location, ...headers },
});

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const secret = () => randomBytes(16).toString('hex');

// ---------------------------------------------------------------------------
// Sessionless launch API
// ---------------------------------------------------------------------------

const assignmentOf = (courseId, id) =>
  globalThis.__easelFakeSubmissions?.course?.assignmentById?.(String(courseId), String(id));
const moduleItemOf = (courseId, id) => globalThis.__easelFakeModules?.moduleItem?.(courseId, id);

/** Mirrors generate_sessionless_launch: which tool, which URL, and what it launches. */
function resolveLaunch(context, query) {
  const launchType = query.launch_type;
  if (query.resource_link_lookup_uuid) {
    const tool = tools[String(query.resource_link_lookup_uuid).split('-')[1]];
    return tool ? { tool, launchUrl: query.url ?? null, launchType } : { error: noMatchingTool() };
  }
  if (launchType === 'module_item') {
    if (!query.module_item_id)
      return {
        error: fieldError('module_item_id', 'A module item id must be provided for module item LTI launch'),
      };
    const item = context.type === 'course' ? moduleItemOf(context.id, query.module_item_id) : null;
    if (!item) return { error: notFound() };
    if (item.type !== 'ExternalTool') return { error: noMatchingTool() };
    const tool = tools[item.content] ?? toolForUrl(item.url);
    if (!tool) return { error: noMatchingTool() };
    return { tool, launchUrl: query.url ?? item.url, launchType, moduleItem: item };
  }
  if (launchType === 'assessment') {
    if (!query.assignment_id)
      return {
        error: fieldError('assignment_id', 'An assignment id must be provided for assessment LTI launch'),
      };
    const a = context.type === 'course' ? assignmentOf(context.id, query.assignment_id) : null;
    if (!a) return { error: notFound() };
    if (!a.tool)
      return { error: fieldError('assignment_id', 'The assignment must have an external tool tag') };
    const tool = a.quizLti ? tools[804] : toolForUrl(a.tool);
    if (!tool) return { error: noMatchingTool() };
    return { tool, launchUrl: query.url ?? a.tool, launchType, assignment: a };
  }
  if (!query.id && !query.url) {
    const message = 'A tool id, tool url, module item id, or resource link lookup uuid must be provided';
    return {
      error: json(
        {
          errors: Object.fromEntries(
            ['id', 'url', 'module_item_id', 'resource_link_lookup_uuid'].map((f) => [
              f,
              [{ attribute: f, type: message, message }],
            ]),
          ),
        },
        400,
      ),
    };
  }
  if (query.url) {
    const tool = (query.id && tools[query.id]) || toolForUrl(query.url);
    return tool ? { tool, launchUrl: query.url, launchType } : { error: noMatchingTool() };
  }
  const tool = tools[query.id];
  if (!tool)
    return { error: redirect(context.type === 'course' ? `${BASE}/courses/${context.id}` : `${BASE}/`) };
  return { tool, launchUrl: null, launchType };
}

function sessionlessLaunch(context, { query }) {
  if (context.type === 'course' && !courseById(context.id)) return notFound();
  const resolved = resolveLaunch(context, query);
  if (resolved.error) return resolved.error;
  const { tool, launchUrl, launchType, assignment, moduleItem } = resolved;
  if (tool.broken) return serverError();
  const prefix = `${BASE}/${context.type === 'course' ? 'courses' : 'accounts'}/${context.id}`;
  const launch = {
    tool: tool.id,
    context,
    launchType: launchType ?? null,
    launchUrl,
    assignmentId: assignment?.id ?? null,
    moduleItemId: moduleItem?.id ?? null,
    title: assignment?.name ?? moduleItem?.title ?? tool.name,
    platform: query.platform ?? null,
    created: Date.now(),
  };
  if (tool.version === '1.3') {
    const sessionToken = secret();
    state.sessionTokens.set(sessionToken, { used: false, created: Date.now() });
    let url;
    if (assignment)
      url = `${prefix}/assignments/${assignment.id}?display=borderless&session_token=${sessionToken}`;
    else if (moduleItem)
      url = `${prefix}/modules/items/${moduleItem.id}?display=borderless&session_token=${sessionToken}`;
    else if (launchUrl && !query.id && !launchType)
      url = `${prefix}/external_tools/retrieve?url=${encodeURIComponent(launchUrl)}&display=borderless&session_token=${sessionToken}`;
    else
      url = `${prefix}/external_tools/${tool.id}?display=borderless&session_token=${sessionToken}${
        launchUrl ? `&launch_url=${encodeURIComponent(launchUrl)}` : ''
      }${launchType ? `&launch_type=${launchType}` : ''}`;
    return { id: tool.id, name: tool.name, url };
  }
  const verifier = secret();
  state.verifiers.set(verifier, launch);
  return {
    id: tool.id,
    name: tool.name,
    url: `${prefix}/external_tools/sessionless_launch?verifier=${verifier}`,
  };
}

// ---------------------------------------------------------------------------
// Canvas pages that launch tools
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'fake_canvas_session';
const hasSession = (req) =>
  (req.headers.cookie ?? '').split(/;\s*/).some((c) => c.startsWith(`${SESSION_COOKIE}=`));

/**
 * A session_token signs the browser in once and sets the session cookie. Reusing a token
 * without that cookie lands on the login page, as in Canvas.
 */
function session(req, query, returnTo) {
  const tokenValue = query.session_token;
  if (!tokenValue) return { ok: true, headers: {} };
  const record = state.sessionTokens.get(tokenValue);
  if (record && !record.used && Date.now() - record.created < 5 * 60_000) {
    record.used = true;
    return {
      ok: true,
      headers: { 'Set-Cookie': `${SESSION_COOKIE}=${secret()}; Path=/; HttpOnly; SameSite=Lax` },
    };
  }
  if (hasSession(req)) return { ok: true, headers: {} };
  return { ok: false, response: redirect(`${BASE}/login/canvas?return_to=${encodeURIComponent(returnTo)}`) };
}

const style = `
  :root { color-scheme: light dark; --bg: #f5f5f5; --card: #fff; --fg: #2d3b45; --muted: #66727b; --line: #d7dade; --brand: #0b6fb5; --tool: #00594f; --ok: #0b874b; --bad: #c4291c; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111417; --card: #1c2126; --fg: #e8ecef; --muted: #a2adb6; --line: #2f363d; --brand: #5aa9e6; --tool: #4fd1bd; --ok: #4cc38a; --bad: #ff7b6e; } }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font: 16px/1.5 -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--fg); }
  main { max-width: 720px; margin: 0 auto; padding: 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 14px; }
  h1 { font-size: 22px; margin: 0 0 6px; } h2 { font-size: 17px; margin: 0 0 8px; }
  p { margin: 0 0 10px; } .muted { color: var(--muted); } .ok { color: var(--ok); } .bad { color: var(--bad); }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: var(--tool); color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; min-height: 44px; font: inherit; font-weight: 600; text-decoration: none; cursor: pointer; margin: 4px 6px 4px 0; }
  @media (prefers-color-scheme: dark) { .btn { color: #06201c; } }
  .btn.secondary { background: transparent; color: var(--tool); border: 1px solid var(--line); }
  a { color: var(--brand); }
  code { font-size: 13px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; font-size: 14px; } dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
  ul.log { margin: 8px 0 0; padding-left: 18px; font-size: 14px; }
  video { width: 100%; border-radius: 8px; background: #000; }
  input[type=file] { font: inherit; max-width: 100%; }
`;

const doc = (
  title,
  body,
  { script = '', bodyStyle = '' } = {},
) => `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)}</title><style>${style}</style></head><body style="${bodyStyle}">${body}${
  script ? `<script>${script}</script>` : ''
}</body></html>`;

/** Canvas's borderless launch page: a form posted into a full-size iframe#tool_content. */
function launchPage(title, action, fields) {
  const inputs = Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`)
    .join('');
  return doc(
    title,
    `<form action="${esc(action)}" method="POST" target="tool_content" id="tool_form">${inputs}
      <noscript><button type="submit">Load ${esc(title)}</button></noscript></form>
     <iframe name="tool_content" id="tool_content" title="${esc(title)}" src="about:blank"
       style="position: fixed; inset: 0; width: 100%; height: 100%; border: 0;"
       allow="camera; microphone; fullscreen; autoplay; clipboard-write; display-capture; geolocation; encrypted-media"
       allowfullscreen="true" webkitallowfullscreen="true" mozallowfullscreen="true"></iframe>`,
    { script: `document.getElementById('tool_form').submit();`, bodyStyle: 'overflow: hidden;' },
  );
}

/** What LTI 1.1 posts (a subset; no OAuth signature checks in the fake). */
function launchFields(launch, tool, extra = {}) {
  const courseId = launch.context?.type === 'course' ? launch.context.id : null;
  return {
    lti_message_type: 'basic-lti-launch-request',
    lti_version: tool.version === '1.3' ? 'LTI-1p3' : 'LTI-1p0',
    resource_link_id: `rl-${tool.id}-${launch.moduleItemId ?? launch.assignmentId ?? 'nav'}`,
    resource_link_title: launch.title,
    context_id: courseId ? `course-${courseId}` : 'account-1',
    context_title: courseId ? (courseById(courseId)?.name ?? 'Course') : 'Fake University',
    custom_canvas_course_id: courseId,
    custom_canvas_assignment_id: launch.assignmentId,
    custom_canvas_module_item_id: launch.moduleItemId,
    custom_canvas_user_id: user.id,
    lis_person_name_full: user.name,
    launch_presentation_document_target: 'iframe',
    launch_presentation_return_url: courseId
      ? `${BASE}/courses/${courseId}/external_content/success/external_tool_redirect`
      : `${BASE}/`,
    ext_launch_type: launch.launchType,
    ext_launch_url: launch.launchUrl,
    platform: launch.platform,
    ...extra,
  };
}

const toolAction = (tool, { embed = false } = {}) =>
  `${TOOL_BASE}/fake-tool/${tool.id}/launch${embed ? '?embed=1' : ''}`;

function verifierPage({ query }) {
  const launch = state.verifiers.get(query.verifier);
  if (!launch || Date.now() - launch.created > 5 * 60_000) {
    state.verifiers.delete(query.verifier);
    return {
      status: 404,
      body: 'Cannot locate launch request, please try again.',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    };
  }
  state.verifiers.delete(query.verifier);
  const tool = tools[launch.tool];
  return html(launchPage(tool.name, toolAction(tool), launchFields(launch, tool)));
}

/** /courses/:id/external_tools/:tool (LTI 1.3 sessionless, or a course navigation tool). */
function toolPage(contextType) {
  return ({ params, query, req, url }) => {
    const tool = tools[params.toolId];
    const context = { type: contextType, id: params.contextId };
    if (!tool || (contextType === 'course' && !courseById(params.contextId))) return html(missingPage(), 404);
    const s = session(req, query, url.pathname);
    if (!s.ok) return s.response;
    const launch = {
      tool: tool.id,
      context,
      launchType: query.launch_type ?? 'course_navigation',
      launchUrl: query.launch_url ?? null,
      assignmentId: null,
      moduleItemId: null,
      title: tool.name,
      platform: query.platform ?? null,
    };
    return html(launchPage(tool.name, toolAction(tool), launchFields(launch, tool)), 200, s.headers);
  };
}

/** /courses/:id/assignments/:id?display=borderless: an assessment launch (New Quizzes). */
function assignmentPage({ params, query, req, url }) {
  if (query.display !== 'borderless') return notFound();
  const a = assignmentOf(params.courseId, params.assignmentId);
  if (!a?.tool) return html(missingPage(), 404);
  const s = session(req, query, url.pathname);
  if (!s.ok) return s.response;
  const tool = a.quizLti ? tools[804] : toolForUrl(a.tool);
  if (!tool) return html(missingPage(), 404);
  const launch = {
    tool: tool.id,
    context: { type: 'course', id: params.courseId },
    launchType: 'assessment',
    launchUrl: a.tool,
    assignmentId: a.id,
    moduleItemId: null,
    title: a.name,
    platform: query.platform ?? null,
  };
  return html(launchPage(a.name, toolAction(tool), launchFields(launch, tool)), 200, s.headers);
}

/** /courses/:id/modules/items/:id?display=borderless: a module item launch (1.3 tools). */
function moduleItemPage({ params, query, req, url }) {
  if (query.display !== 'borderless') return notFound();
  const item = moduleItemOf(params.courseId, params.itemId);
  const tool = item && (tools[item.content] ?? toolForUrl(item.url));
  if (!item || item.type !== 'ExternalTool' || !tool) return html(missingPage(), 404);
  const s = session(req, query, url.pathname);
  if (!s.ok) return s.response;
  const launch = {
    tool: tool.id,
    context: { type: 'course', id: params.courseId },
    launchType: 'module_item',
    launchUrl: item.url,
    assignmentId: null,
    moduleItemId: item.id,
    title: item.title,
    platform: query.platform ?? null,
  };
  return html(launchPage(item.title, toolAction(tool), launchFields(launch, tool)), 200, s.headers);
}

/** /courses/:id/external_tools/retrieve?url=…: embedded tools in content, and 1.3 URL launches. */
function retrievePage(contextType) {
  return ({ params, query, req, url }) => {
    const tool = toolForUrl(query.url);
    if (!tool || tool.broken) return html(missingPage(), 404);
    const s = session(req, query, url.pathname);
    if (!s.ok) return s.response;
    const launch = {
      tool: tool.id,
      context: { type: contextType, id: params.contextId },
      launchType: null,
      launchUrl: query.url,
      assignmentId: null,
      moduleItemId: null,
      title: tool.name,
      platform: query.platform ?? null,
    };
    const embed = query.display === 'borderless' || query.display === 'in_rce';
    return html(
      launchPage(tool.name, toolAction(tool, { embed }), launchFields(launch, tool)),
      200,
      s.headers,
    );
  };
}

const missingPage = () =>
  doc(
    'Couldn’t find valid settings for this link',
    `<main><div class="card"><h1>Couldn’t find valid settings for this link</h1>
     <p class="muted">The tool may have been removed from this course.</p></div></main>`,
  );

// ---------------------------------------------------------------------------
// The fake tools (served from TOOL_BASE)
// ---------------------------------------------------------------------------

const fields = ({ body, query }) => ({
  ...(query ?? {}),
  ...(body && typeof body === 'object' && !Buffer.isBuffer(body) ? body : {}),
});

function toolLaunch(ctx) {
  const tool = tools[ctx.params.toolId];
  if (!tool) return html(missingPage(), 404);
  const f = fields(ctx);
  const embed = f.embed === '1';
  if (tool.id === '804') return html(newQuizzesPage(f));
  if (embed) return html(embedPage(tool, f));
  return html(fullToolPage(tool, f));
}

function embedPage(tool, f) {
  const studio = tool.id === '805';
  const title = studio ? 'Membrane channels walkthrough' : 'Lecture 6 recording';
  return doc(
    title,
    `<div style="padding: 8px;">
      <video controls playsinline preload="metadata" src="${TOOL_BASE}/fake-media/lecture-clip.mp4"></video>
      <p style="margin: 6px 2px 0; font-size: 14px;"><strong>${esc(title)}</strong>
      <span class="muted"> · ${esc(tool.name)}</span></p>
      <p class="muted" style="margin: 0 2px; font-size: 13px;">Embedded with <code>display=borderless</code>${
        f.platform ? `, platform ${esc(f.platform)}` : ''
      }</p></div>`,
    { bodyStyle: 'background: transparent;' },
  );
}

function fullToolPage(tool, f) {
  const courseId = f.custom_canvas_course_id;
  const rows = [
    ['Signed in as', f.lis_person_name_full ?? 'Unknown'],
    ['Course', f.context_title ?? '—'],
    ['Launch type', f.ext_launch_type ?? 'none'],
    ['LTI version', f.lti_version ?? '—'],
    ['Platform', f.platform ?? 'not sent'],
    ['Resource', f.resource_link_title ?? '—'],
  ];
  const script = `
    var log = document.getElementById('log');
    function note(text, cls) { var li = document.createElement('li'); li.textContent = text; if (cls) li.className = cls; log.appendChild(li); }
    window.addEventListener('message', function (event) {
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'popup-hello') note('Message from the popup: ' + event.data.text, 'ok');
      if (event.data.type === 'oauth') note('Signed in with ' + event.data.provider + ' as ' + event.data.email + ' (code ' + event.data.code + ')', 'ok');
    });
    function watch(win, label) {
      if (!win) { note(label + ' was blocked.', 'bad'); return; }
      note(label + ' opened.');
      var timer = setInterval(function () { try { if (win.closed) { clearInterval(timer); note(label + ' closed.'); } } catch (e) {} }, 500);
    }
    document.getElementById('popup').onclick = function () {
      watch(window.open('${TOOL_BASE}/fake-tool/${tool.id}/popup', 'tool_popup', 'width=420,height=640'), 'Popup');
    };
    document.querySelectorAll('[data-oauth]').forEach(function (b) {
      b.onclick = function () {
        var provider = b.getAttribute('data-oauth');
        var url = '${TOOL_BASE}/fake-tool/oauth/authorize?provider=' + provider + '&state=s' + Date.now() +
          '&redirect_uri=' + encodeURIComponent('${TOOL_BASE}/fake-tool/oauth/callback');
        watch(window.open(url, 'oauth_' + provider, 'width=480,height=640'), provider + ' sign-in');
      };
    });
    document.querySelectorAll('input[type=file]').forEach(function (input) {
      input.onchange = function () {
        var out = document.getElementById(input.id + '-out');
        out.textContent = input.files.length
          ? Array.prototype.map.call(input.files, function (f) { return f.name + ' (' + Math.round(f.size / 1024) + ' KB, ' + (f.type || 'unknown type') + ')'; }).join(', ')
          : 'No file chosen';
      };
    });
    var stream = null;
    document.getElementById('camera').onclick = function () {
      var status = document.getElementById('camera-status');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { status.textContent = 'This browser has no camera API.'; status.className = 'bad'; return; }
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(function (s) {
        stream = s;
        var v = document.getElementById('preview'); v.srcObject = s; v.style.display = 'block';
        status.textContent = 'Camera and microphone are on: ' + s.getTracks().map(function (t) { return t.kind; }).join(' and ') + '.';
        status.className = 'ok';
      }).catch(function (e) { status.textContent = 'Couldn’t use the camera: ' + e.name; status.className = 'bad'; });
    };
    document.getElementById('camera-stop').onclick = function () {
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      document.getElementById('preview').style.display = 'none';
      document.getElementById('camera-status').textContent = 'Stopped.';
    };
  `;
  return doc(
    tool.name,
    `<main>
     <div class="card"><h1>${esc(tool.name)}</h1><p class="muted">A fake external tool for testing launches.</p>
       <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
     <div class="card"><h2>Popups</h2>
       <button class="btn" id="popup" type="button">Open popup</button>
       <button class="btn secondary" type="button" data-oauth="Google">Sign in with Google</button>
       <button class="btn secondary" type="button" data-oauth="Microsoft">Sign in with Microsoft</button>
       <p><a href="${TOOL_BASE}/fake-tool/${tool.id}/popup?standalone=1" target="_blank">Open help in a new tab</a></p>
       <ul class="log" id="log" aria-live="polite"></ul></div>
     <div class="card"><h2>Downloads</h2>
       <p><a class="btn" href="${TOOL_BASE}/fake-tool/files/worksheet.pdf">Download worksheet (PDF)</a></p>
       <p><a href="${TOOL_BASE}/fake-tool/files/lab-data.csv">Download lab data (CSV)</a></p>
       <p><a href="${TOOL_BASE}/fake-tool/files/report" download="Progress report.pdf">Download progress report</a></p>
       <p><a href="${BASE}/courses/201/files/6001/download?download_frd=1">Syllabus.pdf from Canvas</a></p></div>
     <div class="card"><h2>Canvas links</h2>
       <p><a href="${BASE}/courses/201/assignments/9101">Lab Report: Diffusion</a></p>
       ${courseId ? `<p><a href="${BASE}/courses/${esc(courseId)}/modules">Course modules</a></p>` : ''}
       <p><a href="${esc(f.launch_presentation_return_url ?? `${BASE}/`)}">Return to Canvas</a></p></div>
     <div class="card"><h2>Files</h2>
       <p><label for="any">Any file</label><br /><input id="any" type="file" /> <span class="muted" id="any-out"></span></p>
       <p><label for="photo">Photo (camera)</label><br /><input id="photo" type="file" accept="image/*" capture="environment" /> <span class="muted" id="photo-out"></span></p>
       <p><label for="many">Several documents</label><br /><input id="many" type="file" multiple accept=".pdf,.doc,.docx,.txt" /> <span class="muted" id="many-out"></span></p>
       <form method="post" enctype="multipart/form-data" action="${TOOL_BASE}/fake-tool/${tool.id}/upload">
         <p><input type="file" name="file" aria-label="File to upload" /></p><button class="btn secondary" type="submit">Upload to the tool</button></form></div>
     <div class="card"><h2>Camera and microphone</h2>
       <button class="btn" id="camera" type="button">Start camera</button>
       <button class="btn secondary" id="camera-stop" type="button">Stop</button>
       <p id="camera-status" class="muted" aria-live="polite">Off.</p>
       <video id="preview" autoplay playsinline muted style="display: none;"></video></div>
     </main>`,
    { script },
  );
}

function popupPage({ params, query }) {
  const tool = tools[params.toolId] ?? { name: 'Tool' };
  const script = `
    var hasOpener = !!window.opener;
    document.getElementById('opener').textContent = hasOpener ? 'This window has an opener.' : 'This window has no opener.';
    document.getElementById('send').onclick = function () {
      if (!window.opener) { document.getElementById('sent').textContent = 'No opener to send to.'; return; }
      window.opener.postMessage({ type: 'popup-hello', text: 'Hello from the popup at ' + new Date().toLocaleTimeString() }, '*');
      document.getElementById('sent').textContent = 'Sent.';
    };
    document.getElementById('close').onclick = function () { window.close(); };
  `;
  return html(
    doc(
      `${tool.name} popup`,
      `<main><div class="card"><h1>${query.standalone ? 'Help' : 'Popup window'}</h1>
       <p>${esc(tool.name)} opened this window.</p><p class="muted" id="opener"></p>
       <button class="btn" id="send" type="button">Send a message to the tool</button>
       <button class="btn secondary" id="close" type="button">Close this window</button>
       <p class="muted" id="sent" aria-live="polite"></p></div></main>`,
      { script },
    ),
  );
}

function oauthAuthorize({ query }) {
  const provider = query.provider === 'Microsoft' ? 'Microsoft' : 'Google';
  const email =
    provider === 'Google' ? 'evan.student@gmail.example' : 'evan.student@fakeu.onmicrosoft.example';
  const next = `${query.redirect_uri ?? `${TOOL_BASE}/fake-tool/oauth/callback`}?code=fake-${provider.toLowerCase()}-${Date.now()}&state=${encodeURIComponent(query.state ?? '')}&provider=${provider}&email=${encodeURIComponent(email)}`;
  return html(
    doc(
      `Sign in with ${provider}`,
      `<main><div class="card"><h1>Sign in with ${provider}</h1>
       <p class="muted">A fake ${provider} account chooser.</p>
       <p><a class="btn" href="${esc(next)}">Continue as ${esc(email)}</a></p>
       <p><a class="btn secondary" href="${esc(`${query.redirect_uri ?? ''}?error=access_denied&provider=${provider}`)}">Cancel</a></p></div></main>`,
    ),
  );
}

function oauthCallback({ query }) {
  const payload = JSON.stringify({
    type: 'oauth',
    provider: query.provider ?? 'Google',
    code: query.code ?? null,
    state: query.state ?? null,
    email: query.email ?? null,
    error: query.error ?? null,
  });
  const script = `
    var data = ${payload.replace(/</g, '\\u003c')};
    if (window.opener) {
      window.opener.postMessage(data, '*');
      document.getElementById('msg').textContent = 'Signed in. This window closes now.';
      setTimeout(function () { window.close(); }, 400);
    } else {
      document.getElementById('msg').textContent = data.error ? 'Sign-in was cancelled.' : 'Signed in, but this window has no opener to return to. Go back to the tool.';
    }
  `;
  return html(
    doc(
      'Signed in',
      `<main><div class="card"><h1>${esc(query.provider ?? 'Google')}</h1><p id="msg"></p></div></main>`,
      { script },
    ),
  );
}

function toolDownload({ params }) {
  const files = {
    'worksheet.pdf': { fixture: 'syllabus.pdf', type: 'application/pdf', name: 'Worksheet 6.pdf' },
    'lab-data.csv': { fixture: 'lab-data.csv', type: 'text/csv', name: 'Lab data.csv' },
    // No extension in the URL: only the response says it's a file.
    report: { fixture: 'syllabus.pdf', type: 'application/pdf', name: 'Progress report.pdf' },
  };
  const f = files[params.name];
  if (!f) return notFound();
  return {
    status: 200,
    body: readFileSync(join(fixtures, f.fixture)),
    headers: {
      'Content-Type': f.type,
      'Content-Disposition': `attachment; filename="${f.name}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    },
  };
}

function toolUpload({ body, req }) {
  const raw = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
  const boundary = /boundary=([^;]+)/.exec(req.headers['content-type'] ?? '')?.[1];
  const files = [];
  if (boundary) {
    for (const part of raw.toString('latin1').split(`--${boundary}`)) {
      const name = /filename="([^"]*)"/.exec(part)?.[1];
      if (!name) continue;
      const begin = part.indexOf('\r\n\r\n') + 4;
      files.push({
        name: Buffer.from(name, 'latin1').toString('utf8'),
        size: part.lastIndexOf('\r\n') - begin,
      });
    }
  }
  return html(
    doc(
      'Uploaded',
      `<main><div class="card"><h1>Upload received</h1>${
        files.length
          ? `<ul>${files.map((f) => `<li>${esc(f.name)}, ${f.size} bytes</li>`).join('')}</ul>`
          : '<p class="bad">No file arrived.</p>'
      }<p><a href="javascript:history.back()">Back to the tool</a></p></div></main>`,
    ),
  );
}

// ---------------------------------------------------------------------------
// New Quizzes (tool 804)
// ---------------------------------------------------------------------------

const nqQuestions = [
  {
    text: 'A critical point of f has ∇f = 0. Which test classifies it?',
    choices: ['Second derivative test', 'Ratio test', 'Root test'],
    correct: 0,
  },
  { text: 'Maximize xy subject to x + y = 4. What is the maximum?', choices: ['2', '4', '8'], correct: 1 },
  { text: 'Lagrange multipliers need ∇g ≠ 0 at the extremum.', choices: ['True', 'False'], correct: 0 },
];

function newQuizzesPage(f) {
  const assignmentId = f.custom_canvas_assignment_id ?? 'unknown';
  const done = state.newQuizzes[assignmentId];
  const title = f.resource_link_title ?? 'New Quiz';
  if (done)
    return doc(
      title,
      `<main><div class="card"><h1>${esc(title)}</h1><p class="ok"><strong>Submitted.</strong> Score: ${done.score} out of ${nqQuestions.length}.</p>
       <p class="muted">Submitted ${esc(new Date(done.at).toLocaleString())}</p>
       <form method="post" action="${TOOL_BASE}/fake-tool/804/retake"><input type="hidden" name="assignment" value="${esc(assignmentId)}" />
       <button class="btn secondary" type="submit">Reset this fake quiz</button></form></div></main>`,
    );
  const ends = Date.now() + 10 * 60_000;
  const script = `
    var end = ${ends}; var el = document.getElementById('timer');
    function tick() { var s = Math.max(0, Math.round((end - Date.now()) / 1000)); el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' left';
      if (s === 0) { document.getElementById('nq').submit(); return; } setTimeout(tick, 1000); }
    tick();
  `;
  return doc(
    title,
    `<div style="position: sticky; top: 0; background: var(--card); border-bottom: 1px solid var(--line); padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; font-weight: 600;">
       <span>${esc(title)}</span><span id="timer" style="font-variant-numeric: tabular-nums;" aria-live="off"></span></div>
     <main><p class="muted">New Quizzes${f.platform ? ` · platform ${esc(f.platform)}` : ''}</p>
     <form id="nq" method="post" action="${TOOL_BASE}/fake-tool/804/submit">
       <input type="hidden" name="assignment" value="${esc(assignmentId)}" />
       ${nqQuestions
         .map(
           (q, i) =>
             `<fieldset class="card" style="margin: 0 0 14px;"><legend style="font-weight: 600; padding: 0 4px;">Question ${i + 1}</legend><p>${esc(q.text)}</p>${q.choices
               .map(
                 (c, j) =>
                   `<label style="display: flex; gap: 10px; align-items: center; min-height: 44px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; margin: 6px 0;"><input type="radio" name="q${i}" value="${j}" /> ${esc(c)}</label>`,
               )
               .join('')}</fieldset>`,
         )
         .join('')}
       <button class="btn" type="submit">Submit</button></form></main>`,
    { script },
  );
}

function newQuizzesSubmit(ctx) {
  const f = fields(ctx);
  const score = nqQuestions.filter((q, i) => String(q.correct) === f[`q${i}`]).length;
  state.newQuizzes[f.assignment ?? 'unknown'] = { score, at: Date.now() };
  return html(
    doc(
      'Submitted',
      `<main><div class="card"><h1>Quiz submitted</h1><p class="ok">Score: ${score} out of ${nqQuestions.length}.</p>
       <p class="muted">You can close this quiz now.</p></div></main>`,
    ),
  );
}

// ---------------------------------------------------------------------------
// Canvas media
// ---------------------------------------------------------------------------

const mediaFiles = {
  'lecture-clip.mp4': 'video/mp4',
  'office-hours.m4a': 'audio/mp4',
  'cell-cycle.gif': 'image/gif',
};

function mediaBytes({ params, req }) {
  const type = mediaFiles[params.name];
  if (!type) return notFound();
  const path = join(fixtures, params.name);
  const size = statSync(path).size;
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const bytes = readFileSync(path);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end)
      return { status: 416, body: '', headers: { 'Content-Range': `bytes */${size}` } };
    return {
      status: 206,
      body: req.method === 'HEAD' ? '' : bytes.subarray(start, end + 1),
      headers: {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      },
    };
  }
  return {
    status: 200,
    body: req.method === 'HEAD' ? '' : bytes,
    headers: { ...headers, 'Content-Length': String(size) },
  };
}

function mediaPlayer({ params, query }) {
  const audio = query.type === 'audio';
  const src = `${BASE}/fake-media/${audio ? 'office-hours.m4a' : 'lecture-clip.mp4'}`;
  return html(
    doc(
      `Media ${params.mediaId}`,
      audio
        ? `<audio controls preload="metadata" src="${src}" style="width: 100%;" aria-label="Audio ${esc(params.mediaId)}"></audio>`
        : `<video controls playsinline preload="metadata" src="${src}" style="position: fixed; inset: 0; width: 100%; height: 100%; border-radius: 0; object-fit: contain;" aria-label="Video ${esc(params.mediaId)}"></video>`,
      { bodyStyle: 'background: #000;' },
    ),
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const course = (handler) => (ctx) => handler({ type: 'course', id: ctx.params.courseId }, ctx);
const account = (handler) => (ctx) => handler({ type: 'account', id: ctx.params.accountId }, ctx);

/** A stand-in for Canvas's own web page, so the signed-in web view has something real to show. */
function webOnlyPage(page, courseId) {
  const content = {
    outcomes: {
      title: 'Outcomes',
      body: `<p>Learning outcomes for this course, and how you're doing on each.</p>
        <ul><li><b>Compute partial derivatives</b>: Meets mastery (3 of 3)</li>
        <li><b>Apply the second derivative test</b>: Near mastery (2 of 3)</li>
        <li><b>Optimize with Lagrange multipliers</b>: Not yet assessed</li></ul>`,
    },
    collaborations: {
      title: 'Collaborations',
      body: `<p>Shared documents for this course.</p>
        <ul><li><a href="https://docs.example.com/essay-2-peer-notes">Essay 2 peer notes</a> (Google Docs)</li>
        <li><a href="https://docs.example.com/group-outline">Group outline</a> (Microsoft 365)</li></ul>`,
    },
    conferences: {
      title: 'Conferences',
      body: '<p>No conferences are scheduled. Your instructor starts them from here.</p>',
    },
  }[page];
  return html(
    doc(
      content.title,
      `<main><div class="card"><h1>${content.title}</h1>${content.body}<p><a href="${BASE}/courses/${esc(courseId)}/assignments/9101">Lab Report: Diffusion</a></p></div></main>`,
    ),
  );
}

export const routes = [
  // API
  { path: '/api/v1/courses/:courseId/external_tools/sessionless_launch', handler: course(sessionlessLaunch) },
  {
    path: '/api/v1/accounts/:accountId/external_tools/sessionless_launch',
    handler: account(sessionlessLaunch),
  },
  { path: '/api/v1/accounts/:accountId/lti_apps/launch_definitions', handler: launchDefinitions },
  // Canvas pages that launch tools (order matters: literal segments before :toolId)
  { path: '/courses/:contextId/external_tools/sessionless_launch', public: true, handler: verifierPage },
  { path: '/accounts/:contextId/external_tools/sessionless_launch', public: true, handler: verifierPage },
  { path: '/courses/:contextId/external_tools/retrieve', public: true, handler: retrievePage('course') },
  { path: '/accounts/:contextId/external_tools/retrieve', public: true, handler: retrievePage('account') },
  { path: '/courses/:contextId/external_tools/:toolId', public: true, handler: toolPage('course') },
  { path: '/accounts/:contextId/external_tools/:toolId', public: true, handler: toolPage('account') },
  { path: '/courses/:courseId/assignments/:assignmentId', public: true, handler: assignmentPage },
  { path: '/courses/:courseId/modules/items/:itemId', public: true, handler: moduleItemPage },
  {
    path: '/courses/:courseId/external_content/success/external_tool_redirect',
    public: true,
    handler: ({ params }) =>
      html(
        doc(
          'Back in Canvas',
          `<main><div class="card"><h1>You’re back in Canvas</h1><p><a href="${BASE}/courses/${esc(params.courseId)}">Go to the course</a></p></div></main>`,
        ),
      ),
  },
  // The tools
  { path: '/fake-tool/oauth/authorize', public: true, handler: oauthAuthorize },
  { path: '/fake-tool/oauth/callback', public: true, handler: oauthCallback },
  { path: '/fake-tool/files/:name', public: true, handler: toolDownload },
  { path: '/fake-tool/804/submit', method: 'POST', public: true, handler: newQuizzesSubmit },
  {
    path: '/fake-tool/804/retake',
    method: 'POST',
    public: true,
    handler: (ctx) => {
      delete state.newQuizzes[fields(ctx).assignment ?? 'unknown'];
      return html(
        doc(
          'Reset',
          '<main><div class="card"><p>Reset. Launch the quiz again to retake it.</p></div></main>',
        ),
      );
    },
  },
  { path: '/fake-tool/:toolId/launch', method: 'POST', public: true, handler: toolLaunch },
  { path: '/fake-tool/:toolId/launch', public: true, handler: toolLaunch },
  { path: '/fake-tool/:toolId/popup', public: true, handler: popupPage },
  { path: '/fake-tool/:toolId/upload', method: 'POST', public: true, handler: toolUpload },
  // Canvas web pages Easel has no native screen for (COURSE-4): Outcomes, Collaborations, Conferences.
  ...['outcomes', 'collaborations', 'conferences'].map((page) => ({
    path: `/courses/:courseId/${page}`,
    public: true,
    handler: ({ params }) => webOnlyPage(page, params.courseId),
  })),
  // Canvas media
  { path: '/media_objects_iframe/:mediaId', public: true, handler: mediaPlayer },
  { path: '/fake-media/:name', public: true, handler: mediaBytes },
  { path: '/fake-media/:name', method: 'HEAD', public: true, handler: mediaBytes },
];
