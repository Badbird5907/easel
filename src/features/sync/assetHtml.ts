/** A small, non-executing scanner for Canvas-sanitized HTML. Never follows links or CSS. */
export type AssetKind = 'image' | 'media' | 'track';
export type AssetReference = { url: string; kind: AssetKind };
const tags =
  /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
const attributes = /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function decode(s: string): string {
  return s.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (s) => {
    const named: Record<string, string> = {
      '&amp;': '&',
      '&quot;': '"',
      '&apos;': "'",
      '&lt;': '<',
      '&gt;': '>',
    };
    if (named[s.toLowerCase()]) return named[s.toLowerCase()];
    const n = s[2].toLowerCase() === 'x' ? parseInt(s.slice(3), 16) : parseInt(s.slice(2), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : s;
  });
}
export function resolveAssetUrl(raw: string, baseUrl: string): string | null {
  try {
    // API HTML resolves against the Canvas origin, just like RichContent's baseUrl.
    const url = new URL(decode(raw).trim(), `${new URL(baseUrl).origin}/`);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}
export function isStreamingUrl(raw: string): boolean {
  return /^(?:blob|skd):|\.(?:m3u8|mpd)(?:[?#]|$)/i.test(raw);
}
function srcset(value: string): { url: string; descriptor: string }[] {
  // Data URLs contain commas; keep them intact (already offline, never downloaded).
  return (value.match(/data:[^\s]+(?:\s+[^,]+)?|[^,]+/g) ?? []).map((part) => {
    const [url, ...rest] = part.trim().split(/\s+/);
    return { url, descriptor: rest.join(' ') };
  });
}
function transform(
  html: string,
  visit: (raw: string, kind: AssetKind) => string | null,
  unsupported: () => void,
): string {
  return html.replace(tags, (tag: string, _raw: string, name?: string) => {
    if (!name) return tag;
    const lower = name.toLowerCase();
    if (['iframe', 'object', 'embed'].includes(lower)) unsupported();
    if (!['img', 'video', 'audio', 'source', 'track'].includes(lower)) return tag;
    return tag.replace(attributes, (attribute, key: string, double: string, single: string, bare: string) => {
      key = key.toLowerCase();
      const value = double ?? single ?? bare;
      const kind: AssetKind =
        key === 'poster' || lower === 'img' || key === 'srcset'
          ? 'image'
          : lower === 'track'
            ? 'track'
            : 'media';
      if (!(
        key === 'src' ||
        (key === 'srcset' && ['img', 'source'].includes(lower)) ||
        (key === 'poster' && lower === 'video')
      ))
        return attribute;
      if (key === 'srcset') {
        let changed = false;
        const candidates = srcset(value).map(({ url, descriptor }) => {
          const replacement = visit(url, kind);
          changed ||= replacement !== null;
          return `${replacement ?? decode(url)}${descriptor ? ` ${descriptor}` : ''}`;
        });
        return changed ? `${key}="${escape(candidates.join(', '))}"` : attribute;
      }
      const replacement = visit(value, kind);
      return replacement === null ? attribute : `${key}="${escape(replacement)}"`;
    });
  });
}
export function discoverAssets(html: string, baseUrl: string, media: boolean) {
  const resources = new Map<string, AssetReference>();
  let unsupported = 0;
  transform(
    html,
    (raw, kind) => {
      if (isStreamingUrl(raw)) {
        if (media) unsupported++;
        return null;
      }
      if (kind !== 'image' && !media) return null;
      const url = resolveAssetUrl(raw, baseUrl);
      if (url) resources.set(`${kind}:${url}`, { url, kind });
      return null;
    },
    () => {
      unsupported++;
    },
  );
  return { resources: [...resources.values()], unsupported };
}
export type OfflineNoticeKind = 'unsupported' | 'missing';
export type OfflineNoticeRenderer = (kind: OfflineNoticeKind) => string;

/** Only attributes with a verified cached match change. Links, scripts and embed launches stay intact. */
export function rewriteAssetHtml(
  html: string,
  baseUrl: string,
  lookup: (url: string, kind: AssetKind) => string | null,
  renderNotice?: OfflineNoticeRenderer,
): string {
  let missing = false;
  let unsupported = false;
  const result = transform(
    html,
    (raw, kind) => {
      if (/^data:/i.test(raw)) return null;
      const url = resolveAssetUrl(raw, baseUrl);
      const local = url ? lookup(url, kind) : null;
      if (!local) missing = true;
      return local;
    },
    () => {
      unsupported = true;
    },
  );
  const kind = unsupported ? 'unsupported' : missing ? 'missing' : null;
  if (kind && renderNotice) return renderNotice(kind) + result;
  const notice = unsupported
    ? 'Embedded players and tools need an internet connection.'
    : missing
      ? 'Some images or media aren’t saved on this device. Connect to the internet to load them.'
      : '';
  return notice ? `<p role="note">${notice}</p>${result}` : result;
}

/** HTML fields nested in page, assignment, discussion and other fetched models. */
export function collectAssetHtml(data: unknown, out: Set<string>) {
  if (typeof data === 'string') {
    if (/<(?:img|source|audio|video|track|iframe|object|embed)\b/i.test(data)) out.add(data);
  } else if (Array.isArray(data)) for (const value of data) collectAssetHtml(value, out);
  else if (data && typeof data === 'object')
    for (const value of Object.values(data)) collectAssetHtml(value, out);
}
