import { CanvasAuthError, type CanvasClient, CanvasError } from '../client';
import { useCanvasQuery } from '../query';

/*
 * School branding from the Theme Editor (HTML-8). Two separate things reach a mobile client:
 *
 * - `GET /api/v1/brand_variables` (brand_configs_api_controller.rb#show) needs no token and
 *   redirects to a static JSON file of the account's variables
 *   (BrandableCSS.all_brand_variable_values): a flat map such as
 *   `{ "ic-brand-primary": "#2B7ABC", "ic-brand-header-image": "https://…/logo.png", … }`.
 *   Easel doesn't recolor its chrome with them (PRD section 12, decision 6).
 * - The mobile theme files (BrandConfig `mobile_css_overrides` and `mobile_js_overrides`) are
 *   not in that JSON. Canvas writes their URLs into every piece of API HTML it sends to a
 *   token request (Api::Html::Content#add_css_and_js_overrides): a `<link rel="stylesheet">`
 *   per file at the start, a `<script src>` per file at the end, root account first. They're
 *   public-read uploads (S3 or inst-fs, usually another host), and an admin's new upload gets
 *   a new URL.
 */

/** `GET /api/v1/brand_variables`: every brandable variable, keyed by its CSS name. */
type CanvasBrandVariables = Record<string, unknown>;

/** The school's brand, for places that show the school (such as its logo), not for Easel's chrome. */
export type BrandVariables = {
  /** `ic-brand-primary`. */
  primary: string | null;
  /** `ic-link-color`. */
  linkColor: string | null;
  /** `ic-brand-font-color-dark`. */
  fontColorDark: string | null;
  /** `ic-brand-global-nav-bgd`, the web navigation bar. */
  navBackground: string | null;
  /** `ic-brand-mobile-global-nav-logo`, falling back to `ic-brand-header-image`. */
  logoUrl: string | null;
  /** `ic-brand-global-nav-logo-bgd`, what the logo sits on. */
  logoBackground: string | null;
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function color(raw: CanvasBrandVariables, key: string): string | null {
  const value = raw[key];
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim() : null;
}

/** An absolute http(s) URL, or null. Default images come back as root-relative paths without a CDN. */
function absoluteUrl(raw: unknown, baseUrl: string): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `${baseUrl.split(':')[0]}:${value}`;
  if (value.startsWith('/')) return `${baseUrl}${value}`;
  return null;
}

export async function fetchBrandVariables(
  client: CanvasClient,
  signal?: AbortSignal,
): Promise<BrandVariables | null> {
  let raw: CanvasBrandVariables;
  try {
    raw = await client.get<CanvasBrandVariables>('/api/v1/brand_variables', undefined, signal);
  } catch (error) {
    // Schools without it answer 404 or a non-JSON page: no branding, not an error.
    if ((error instanceof CanvasError && !(error instanceof CanvasAuthError)) || error instanceof SyntaxError)
      return null;
    throw error;
  }
  if (!raw || typeof raw !== 'object') return null;
  return {
    primary: color(raw, 'ic-brand-primary'),
    linkColor: color(raw, 'ic-link-color'),
    fontColorDark: color(raw, 'ic-brand-font-color-dark'),
    navBackground: color(raw, 'ic-brand-global-nav-bgd'),
    logoUrl:
      absoluteUrl(raw['ic-brand-mobile-global-nav-logo'], client.baseUrl) ??
      absoluteUrl(raw['ic-brand-header-image'], client.baseUrl),
    logoBackground: color(raw, 'ic-brand-global-nav-logo-bgd'),
  };
}

/** The active school's brand variables, or null when it has none. Brands rarely change; a day is fresh. */
export function useBrandVariables() {
  return useCanvasQuery(['brand', 'variables'], fetchBrandVariables, { staleTime: 24 * 60 * 60_000 });
}

/** URLs of the school's mobile theme files that Canvas wrote into a piece of HTML, in Canvas's order. */
export type ThemeFiles = { css: string[]; js: string[] };

/** The theme files' text, in Canvas's order (root account first). Files that didn't load are left out. */
export type SchoolTheme = { css: string[]; js: string[] };

const THEME_TAG = /<(?:link|script)\b/i;
const LINK_TAG = /<link\b[^>]*>/gi;
const SCRIPT_TAG = /<script\b[^>]*>\s*<\/script\s*>/gi;
const ENTITIES: Record<string, string> = { amp: '&', quot: '"', '#39': "'", '#x27': "'", lt: '<', gt: '>' };

/** An attribute's value from a serialized tag, with Nokogiri's entity escaping undone. */
function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!match) return null;
  return (match[1] ?? match[2] ?? match[3] ?? '').replace(
    /&(amp|quot|#39|#x27|lt|gt);/g,
    (entity, name: string) => ENTITIES[name] ?? entity,
  );
}

/**
 * Takes Canvas's theme tags out of API HTML. Canvas's sanitizer never lets authors write
 * `<link>` or `<script>` (canvas_sanitize.rb), so every one of these is the theme. The HTML
 * comes back without them, so nothing from the theme loads unless the student turned it on.
 */
export function extractThemeFiles(html: string, baseUrl: string): { html: string; files: ThemeFiles | null } {
  if (!THEME_TAG.test(html)) return { html, files: null };
  const css: string[] = [];
  const js: string[] = [];
  const add = (list: string[], raw: string | null) => {
    const url = raw === null ? null : absoluteUrl(raw, baseUrl);
    if (url && !list.includes(url)) list.push(url);
  };
  const stripped = html
    .replace(LINK_TAG, (tag) => {
      if (!/stylesheet/i.test(attribute(tag, 'rel') ?? '')) return tag;
      add(css, attribute(tag, 'href'));
      return '';
    })
    .replace(SCRIPT_TAG, (tag) => {
      const src = attribute(tag, 'src');
      if (src === null) return tag;
      add(js, src);
      return '';
    });
  return { html: stripped, files: css.length || js.length ? { css, js } : null };
}

/** Larger files are skipped: a mobile theme is a few kilobytes, and the text is cached on disk. */
const MAX_THEME_FILE = 512 * 1024;

/**
 * One public theme file's text, or '' when it's gone, private, or not CSS or JS. Plain
 * `fetch` with no token: these files usually live on another host.
 */
async function fetchThemeFile(url: string, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    // Not a CanvasNetworkError: an unreachable file host doesn't mean Canvas is down.
    throw new Error('Couldn’t load the school theme.');
  }
  if (!response.ok || /text\/html/i.test(response.headers.get('Content-Type') ?? '')) return '';
  const text = await response.text();
  return text.length > MAX_THEME_FILE ? '' : text;
}

export async function fetchSchoolTheme(files: ThemeFiles, signal?: AbortSignal): Promise<SchoolTheme> {
  const [css, js] = await Promise.all([
    Promise.all(files.css.map((url) => fetchThemeFile(url, signal))),
    Promise.all(files.js.map((url) => fetchThemeFile(url, signal))),
  ]);
  return { css: css.filter(Boolean), js: js.filter(Boolean) };
}

/** The text of the theme files in a piece of HTML. Pass null to skip (theme off, or none in the HTML). */
export function useSchoolTheme(files: ThemeFiles | null) {
  return useCanvasQuery<SchoolTheme>(
    ['brand', 'mobileTheme', files],
    (_client, signal) => (files ? fetchSchoolTheme(files, signal) : Promise.resolve({ css: [], js: [] })),
    // A theme file's URL changes with every upload, so the text at a URL never goes stale.
    { enabled: files !== null, staleTime: Infinity },
  );
}
