/**
 * What a tool hands back from its `homework_submission` picker (ASSIGN-9), and
 * the script that catches it in the picker's web view.
 *
 * Canvas runs the picker inside its resource selection page. When the student
 * picks something, the tool posts its answer back to Canvas, and Canvas's
 * response page posts a message to its parent window, the page Easel loaded:
 * - LTI 1.3: `{ subject: 'LtiDeepLinkingResponse', content_items, errormsg }`
 *   (ui/features/deep_linking_response), items of type `ltiResourceLink`, `link`, `file`.
 * - LTI 1.1: `{ subject: 'A2ExternalContentReady', content_items }` and
 *   `{ subject: 'externalContentReady', contentItems }` (ui/features/external_content_success),
 *   JSON-LD items with `@type` `LtiLinkItem`, `FileItem`, or `ContentItem`, or the
 *   legacy `return_type` form (`url`, `lti_launch_url`, `file`).
 *
 * Canvas's own student view turns links into `basic_lti_launch` and files into
 * uploads (ExternalToolSubmission.tsx, FileUpload.jsx); Easel does the same, and
 * plain web links become `online_url` when the assignment takes one.
 */

export type PickedContent =
  /** A link back into the tool. Submitted as `basic_lti_launch`. */
  | { kind: 'lti'; url: string; title: string | null; lookupUuid: string | null }
  /** A plain web page. Submitted as `online_url`, or `basic_lti_launch` when URLs aren't allowed. */
  | { kind: 'link'; url: string; title: string | null }
  /** A file to download and upload as `online_upload`. */
  | { kind: 'file'; url: string; name: string; mimeType: string | null };

export type PickerOutcome =
  { type: 'picked'; items: PickedContent[] } | { type: 'error'; message: string } | { type: 'cancelled' };

type RawItem = Record<string, unknown>;

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const nameFromUrl = (url: string) => {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '');
    return last || 'File from tool';
  } catch {
    return 'File from tool';
  }
};

function toPicked(raw: RawItem): PickedContent | null {
  const type = str(raw.type) ?? str(raw['@type']) ?? str(raw.return_type);
  const url = str(raw.url) ?? str(raw['@id']);
  const title = str(raw.title) ?? str(raw.text);
  if (!url) return null;
  switch (type) {
    case 'ltiResourceLink':
    case 'LtiLinkItem':
    case 'lti_launch_url':
      return { kind: 'lti', url, title, lookupUuid: str(raw.lookup_uuid) };
    case 'file':
    case 'FileItem':
    case 'image':
      return {
        kind: 'file',
        url,
        name: str(raw.title) ?? str(raw.text) ?? nameFromUrl(url),
        mimeType: str(raw.mediaType) ?? str(raw.content_type),
      };
    case 'link':
    case 'ContentItem':
    case 'url':
    case 'oembed':
    case 'html':
    case 'iframe':
      return { kind: 'link', url, title };
    default:
      return { kind: 'link', url, title };
  }
}

/** Reads one message from the picker page. Null for messages that aren't a tool's answer. */
export function parsePickerMessage(data: unknown): PickerOutcome | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as RawItem;
  const subject = str(message.subject);
  if (subject === 'externalContentCancel') return { type: 'cancelled' };
  if (
    subject !== 'LtiDeepLinkingResponse' &&
    subject !== 'A2ExternalContentReady' &&
    subject !== 'externalContentReady'
  )
    return null;
  const error = str(message.errormsg) ?? str(message.lti_errormsg);
  const rawItems = message.content_items ?? message.contentItems ?? message.retrieved_data;
  const list = Array.isArray(rawItems)
    ? rawItems
    : rawItems && typeof rawItems === 'object'
      ? [rawItems]
      : [];
  const items = list.map((item) => toPicked(item as RawItem)).filter((item): item is PickedContent => !!item);
  if (items.length) return { type: 'picked', items };
  if (error) return { type: 'error', message: error };
  return { type: 'cancelled' };
}

/**
 * Injected before the picker page loads. It forwards the tool's answer, which
 * Canvas posts to the top window, to Easel. Every frame gets it on iOS; only
 * the top window listens.
 */
export const pickerListener = `
(function () {
  if (window !== window.top || window.__easelPickerListener) return;
  window.__easelPickerListener = true;
  var subjects = ['LtiDeepLinkingResponse', 'A2ExternalContentReady', 'externalContentReady', 'externalContentCancel'];
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { return; } }
    if (!data || subjects.indexOf(data.subject) < 0) return;
    try {
      var text = JSON.stringify({ type: 'easel-picker-content', data: data });
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
    } catch (e) {}
  });
})();
true;
`;

// --- Hand-off to the submit screen ------------------------------------------------------
// The parser and bridge above deliberately retain Canvas's raw protocol semantics.
export type PickedFromTool = PickedContent & { toolName: string };
export {
  receivePicks, handToSubmitForm, registerToolEditor, beginToolLaunch,
  revokeToolLaunch, toolLaunchCurrent, claimToolLaunch, subscribeToolLaunches, toolLaunchRevision,
} from './toolLaunch';
export type { ToolLaunchTarget } from './toolLaunch';
