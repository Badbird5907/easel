/*
 * @-mentions in discussion replies (CONTENT-2). Canvas stores a mention as
 *
 *   <span class="mceNonEditable mention" data-mention="USER_ID">@Short Name</span>
 *
 * and notifies the person when the entry saves (DiscussionEntry
 * #parse_and_create_mentions reads `data-mention`). The composer inserts plain
 * "@Short Name" text while the student types, which survives any editor, and
 * wraps it in that span when the reply is sent.
 */

export type Mention = { id: string; name: string };

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntity(code: string): string | null {
  if (code[0] === '#') {
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : null;
  }
  return NAMED[code.toLowerCase()] ?? null;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** HTML tags that read as a line break. */
const BREAK = /^<(?:br\b[^>]*|\/(?:p|div|li|h[1-6])\s*)>$/i;

/**
 * The text a student sees, with where each character came from in the HTML,
 * so an edit to the text can be made to the HTML without disturbing its tags.
 */
export function projectHtml(html: string): { text: string; start: number[]; length: number[] } {
  let text = '';
  const start: number[] = [];
  const length: number[] = [];
  const push = (chars: string, at: number, size: number) => {
    for (const unit of chars.split('')) {
      text += unit;
      start.push(at);
      length.push(size);
    }
  };
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) break;
      const tag = html.slice(i, close + 1);
      if (BREAK.test(tag)) push('\n', i, tag.length);
      i = close + 1;
      continue;
    }
    if (ch === '&') {
      const match = /^&(#\d+|#x[\da-f]+|[a-z]+);/i.exec(html.slice(i, i + 12));
      const decoded = match && decodeEntity(match[1]);
      if (match && decoded) {
        push(decoded, i, match[0].length);
        i += match[0].length;
        continue;
      }
    }
    push(ch, i, 1);
    i += 1;
  }
  return { text, start, length };
}

/** A mention being typed: `@` and what follows it, as a range of the visible text. */
export type MentionQuery = { query: string; from: number; to: number };

// "@", then up to two words, right before the caret. Nothing word-like comes before the "@", so emails don't count.
const TYPING = /(?:^|[^\p{L}\p{N}_])@([^\s@<>]{0,30}(?: [^\s@<>]{1,30})?)$/u;

/**
 * Finds a mention being typed. The editor reports only its value, so the caret
 * is taken to be where the text changed.
 */
export function mentionQuery(previous: string, next: string): MentionQuery | null {
  if (previous === next) return null;
  let head = 0;
  while (head < previous.length && head < next.length && previous[head] === next[head]) head += 1;
  let tail = 0;
  while (
    tail < previous.length - head &&
    tail < next.length - head &&
    previous[previous.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail += 1;
  const caret = next.length - tail;
  const match = TYPING.exec(next.slice(0, caret));
  if (!match) return null;
  const query = match[1];
  return { query, from: caret - query.length - 1, to: caret };
}

/** Replaces the typed `@query` with the person's name and a space. */
export function insertMention(html: string, at: MentionQuery, mention: Mention): string {
  const { text, start, length } = projectHtml(html);
  if (at.from < 0 || at.to > text.length || text[at.from] !== '@') return html;
  const htmlFrom = start[at.from];
  const last = at.to - 1;
  const htmlTo = start[last] + length[last];
  // A no-break space: editors collapse a plain one at the end of a line, and the next word would join the name.
  const spaced = /[ \u00a0]/.test(text[at.to] ?? '') ? '' : '&nbsp;';
  return `${html.slice(0, htmlFrom)}${escapeHtml(`@${mention.name}`)}${spaced}${html.slice(htmlTo)}`;
}

export const mentionSpan = (mention: Mention) =>
  `<span class="mceNonEditable mention" data-mention="${escapeHtml(mention.id)}">${escapeHtml(`@${mention.name}`)}</span>`;

/** Splits HTML into tags and text, so text can change without touching markup. */
const TOKENS = /(<[^>]+>)/;
const MENTION_OPEN = /^<span\b[^>]*\bdata-mention=/i;

/**
 * Wraps every "@Name" of the chosen people in Canvas's mention markup, leaving
 * mentions the editor already marked up alone. Names the student deleted are skipped.
 */
export function applyMentions(html: string, mentions: Mention[]): string {
  const unique = [...new Map(mentions.map((m) => [m.name, m])).values()].sort(
    (a, b) => b.name.length - a.name.length,
  );
  if (!unique.length) return html;
  const pattern = new RegExp(
    `@(${unique.map((m) => escapeRegExp(escapeHtml(m.name))).join('|')})(?![\\p{L}\\p{N}])`,
    'gu',
  );
  const byName = new Map(unique.map((m) => [escapeHtml(m.name), m]));
  let inside = 0;
  return html
    .split(TOKENS)
    .map((token) => {
      if (token.startsWith('<')) {
        if (MENTION_OPEN.test(token)) inside += 1;
        else if (inside && /^<\/span>/i.test(token)) inside -= 1;
        return token;
      }
      if (inside) return token;
      return token.replace(pattern, (whole, name: string) => {
        const m = byName.get(name);
        return m ? mentionSpan(m) : whole;
      });
    })
    .join('');
}

/** The mentions already marked up in a post, so an edit keeps them. */
export function mentionsIn(html: string): Mention[] {
  const found: Mention[] = [];
  const pattern = /<span\b[^>]*\bdata-mention="([^"]*)"[^>]*>([\s\S]*?)<\/span>/gi;
  for (const match of html.matchAll(pattern)) {
    const name = projectHtml(match[2]).text.replace(/^@/, '').trim();
    if (match[1] && name) found.push({ id: match[1], name });
  }
  return found;
}

/** Visible text of a post: for empty checks. */
export const visibleText = (html: string) => projectHtml(html).text.replace(/ /g, ' ').trim();

export type Segment = { kind: 'text'; text: string } | { kind: 'mention'; text: string; userId: string };

/**
 * Lines of a simple post, with mentions marked, for native rendering. Each line
 * is a paragraph or a line break in the HTML.
 */
export function postLines(html: string): Segment[][] {
  const lines: Segment[][] = [[]];
  let mentionUser: string | null = null;
  const add = (segment: Segment) => {
    const line = lines[lines.length - 1];
    const prev = line[line.length - 1];
    if (segment.kind === 'text' && prev?.kind === 'text') prev.text += segment.text;
    else line.push(segment);
  };
  for (const token of html.split(TOKENS)) {
    if (!token) continue;
    if (token.startsWith('<')) {
      if (MENTION_OPEN.test(token)) mentionUser = /data-mention="([^"]*)"/i.exec(token)?.[1] ?? '';
      else if (mentionUser !== null && /^<\/span>/i.test(token)) mentionUser = null;
      else if (BREAK.test(token)) lines.push([]);
      continue;
    }
    const text = projectHtml(token).text.replace(/ /g, ' ');
    if (!text) continue;
    if (mentionUser !== null) add({ kind: 'mention', text, userId: mentionUser });
    else add({ kind: 'text', text });
  }
  return lines
    .map((line) =>
      line
        .map((s) => (s.kind === 'text' ? { ...s, text: s.text.replace(/\s+/g, ' ') } : s))
        .filter((s) => s.text.length > 0),
    )
    .map((line) => {
      // Trim the line's ends, as HTML would.
      if (line[0]?.kind === 'text') line[0] = { ...line[0], text: line[0].text.trimStart() };
      const end = line.length - 1;
      if (line[end]?.kind === 'text') line[end] = { ...line[end], text: line[end].text.trimEnd() };
      return line.filter((s) => s.text.length > 0);
    })
    .filter((line) => line.length > 0);
}

/** For posts rendered as HTML: mentions read as bold names. */
export const boldMentions = (html: string) =>
  html.replace(/<span\b[^>]*\bdata-mention=[^>]*>([\s\S]*?)<\/span>/gi, '<strong>$1</strong>');
