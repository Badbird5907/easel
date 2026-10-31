import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { PixelRatio, Platform, useWindowDimensions, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { extractThemeFiles, type SchoolTheme, useSchoolTheme } from '@/canvas/api/brand';
import { parseRetrieveUrl } from '@/canvas/api/lti';
import { useCanvas } from '@/canvas/session';
import { type ColorTokens, useTheme } from '@/design';
import { useToolAction } from '@/features/lti/action';
import { useLaunchTool } from '@/features/lti/launch';
import { useLocalStore } from '@/features/offline/store';
import { useOnline } from '@/features/offline/useOnline';
import { assetIndex, offlineAssetHtml } from '@/features/sync/assets';
import { useSchoolThemeEnabled } from '@/features/offline/schoolTheme';

import { useTranslation } from '@/i18n';
import type { OfflineNoticeKind } from '../sync/assetHtml';

import { openCanvasLink } from './links';
import { useContentSession } from './session';
import { contentPresentation, contentPresentationScript, scriptJson } from './presentation';

export type RichContentProps = {
  /** Canvas HTML (assignment description, page body, announcement, discussion post). */
  html: string;
  /** Overrides link handling; defaults to routing Canvas links in-app. */
  onLinkPress?: (url: string) => void;
  /** Height to reserve before the content measures itself. */
  minHeight?: number;
  /** `subhead` matches secondary text in callouts and cards: smaller and muted. */
  variant?: 'body' | 'subhead';
};

// Bounded, account-scoped layout memory. Never retain the HTML or a WebView session.
const contentHeights = new Map<string, number>();
function contentHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
}

type Message =
  | { type: 'height'; value: number }
  | { type: 'presentationReady' }
  | { type: 'session' }
  | { type: 'launch'; url: string; title?: string };

/** Links that start a tool rather than open a page: `external_tools/retrieve` and course tool pages. */
const TOOL_LINK = /^\/(courses|accounts)\/[^/]+\/external_tools\/(retrieve|\d+)\/?$/;

/**
 * Renders author-written Canvas HTML in Easel's type and colors. Sizes itself to
 * its content, so it sits inside a screen's scroll view like any other block.
 * Links open in Easel when they point at Canvas content, otherwise in the in-app browser.
 *
 * Embeds (HTML-4, LTI-5): YouTube, Vimeo, and other players play inline. Canvas
 * media, Studio, and tool iframes (`external_tools/retrieve`) need the Canvas web
 * session, so they wait while the page starts one through `session_token`, and
 * the session is kept alive while the content stays on screen (HTML-6). Every
 * tool iframe gets an "Open tool" button that launches it full screen.
 */
export function RichContent({ html, onLinkPress, minHeight = 24, variant = 'body' }: RichContentProps) {
  const { t, locale, direction } = useTranslation();
  const presentation = useMemo(() => contentPresentation(t, locale, direction), [t, locale, direction]);
  const { colors, scheme } = useTheme();
  const { account, client } = useCanvas();
  const launchTool = useLaunchTool();
  const { width } = useWindowDimensions();
  const [measured, setMeasured] = useState<{ key: string; height: number } | null>(null);
  const fontScale = PixelRatio.getFontScale();

  // HTML-8: Canvas writes the school's mobile theme tags into API HTML. They always come
  // out here, and go back in (guarded) only when the student turned the theme on.
  const themeEnabled = useSchoolThemeEnabled();
  const { html: content, files: themeFiles } = useMemo(
    () => extractThemeFiles(html, account.baseUrl),
    [html, account.baseUrl],
  );
  const { data: schoolTheme } = useSchoolTheme(themeEnabled ? themeFiles : null);
  const theme = themeEnabled && schoolTheme ? schoolTheme : null;

  const online = useOnline();
  const assets = useLocalStore(assetIndex);
  const offlineContent = useMemo(
    () => {
      let notice: OfflineNoticeKind | null = null;
      const html = online
        ? content
        : offlineAssetHtml(account.id, account.baseUrl, content, assets, (kind) => {
            notice = kind;
            return ''; // Render only Easel's structured notice, separately from Canvas HTML.
          });
      return { html, notice };
    },
    // A completed sync or removal must refresh already mounted content.
    [online, content, account.id, account.baseUrl, assets],
  );

  const document = useMemo(
    () =>
      buildDocument(
        offlineContent.html,
        colors,
        scheme === 'dark',
        fontScale,
        variant,
        account.baseUrl,
        theme,
        offlineContent.notice,
      ),
    [offlineContent, colors, scheme, fontScale, variant, account.baseUrl, theme],
  );

  const heightKey = useMemo(() => `${account.id}:${width}:${contentHash(document)}`,
    [account.id, width, document]);
  const height = measured?.key === heightKey ? measured.height : contentHeights.get(heightKey) ?? minHeight;

  const source = useMemo(() => ({ html: document, baseUrl: account.baseUrl }), [document, account.baseUrl]);

  const toolAction = useToolAction(JSON.stringify([document, account.baseUrl, online]), online);

  const session = useContentSession(account.id, account.baseUrl, client, source, !!account.expired);
  const attachSession = useCallback((handle: WebView<object> | null) => session?.attach(handle), [session]);
  // Publish presentation at commit too: discarded locale renders cannot relabel a live page.
  useLayoutEffect(() => {
    session?.setPresentation(contentPresentationScript(presentation));
  }, [session, presentation]);

  const launch = (url: string, title?: string) => {
    const retrieve = parseRetrieveUrl(url, account.baseUrl);
    const course = url.match(/\/courses\/(\d+)\//)?.[1];
    toolAction
      .run((isCurrent) =>
        launchTool(
          { url, courseId: retrieve?.courseId ?? course, title: title || undefined },
          { isCurrent },
        ),
      )
      .catch(() => {});
  };

  const onMessage = (event: WebViewMessageEvent) => {
    let message: Message;
    try {
      message = JSON.parse(event.nativeEvent.data) as Message;
    } catch {
      // Ignore messages from embedded content.
      return;
    }
    if (message.type === 'presentationReady') {
      session?.presentationReady();
    }
    if (message.type === 'height' && Number.isFinite(message.value) && message.value > 0) {
      const height = Math.ceil(message.value);
      contentHeights.delete(heightKey);
      contentHeights.set(heightKey, height);
      if (contentHeights.size > 64) contentHeights.delete(contentHeights.keys().next().value!);
      setMeasured({ key: heightKey, height });
    }
    if (message.type === 'session') {
      session?.demand();
    }
    if (message.type === 'launch' && message.url) launch(message.url, message.title);
  };

  const isToolLink = (url: string) => {
    try {
      const parsed = new URL(url, account.baseUrl);
      return parsed.host === new URL(account.baseUrl).host && TOOL_LINK.test(parsed.pathname);
    } catch {
      return false;
    }
  };

  return (
    <View style={{ height: Math.max(height, minHeight) }}>
      {session && (
        <WebView
          key={session.key}
          ref={attachSession}
          source={source}
          originWhitelist={['*']}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          style={{ backgroundColor: 'transparent' }}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction
          allowsFullscreenVideo
          allowsPictureInPictureMediaPlayback
          allowsAirPlayForMediaPlayback
          thirdPartyCookiesEnabled
          textZoom={100}
          setSupportMultipleWindows={false}
          onMessage={onMessage}
          onLoadEnd={session.loadEnd}
          onShouldStartLoadWithRequest={(request) => {
            if (!session.active) return false;
            // Embedded iframes (video, tools) load in place; only top-level taps are links.
            // Our own document (first load, or a reload after a theme change) isn't a link tap.
            const ownDocument =
              request.url === account.baseUrl ||
              request.url === `${account.baseUrl}/` ||
              request.url.startsWith('about:');
            // Android doesn't say which frame is navigating; it asks about the main frame.
            const topFrame = Platform.OS === 'android' ? request.isTopFrame !== false : request.isTopFrame;
            if (!topFrame || !session.loaded || ownDocument) return true;
            if (Platform.OS === 'android' && isEmbedLoad(request.url, account.baseUrl)) return true;
            if (onLinkPress) onLinkPress(request.url);
            else if (isToolLink(request.url)) launch(request.url);
            else openCanvasLink(request.url, account.baseUrl);
            return false;
          }}
        />
      )}
    </View>
  );
}

/** The page's own embed and session loads, which Android reports like link taps. */
function isEmbedLoad(url: string, baseUrl: string) {
  if (!url.startsWith(baseUrl)) return false;
  return /\/(login\/session_token|favicon\.ico|media_objects_iframe|media_attachments_iframe|users\/self\/media_download)|\/external_tools\/retrieve[^#]*display=borderless/.test(
    url,
  );
}

const MATH = /\\\(|\\\[|\$\$|<math[\s>]|class="math_equation_latex"/;

export function buildDocument(
  html: string,
  c: ColorTokens,
  dark: boolean,
  fontScale: number,
  variant: 'body' | 'subhead',
  baseUrl: string,
  theme: SchoolTheme | null = null,
  offlineNotice: OfflineNoticeKind | null = null,
): string {
  const body = prepareEmbeds(html, baseUrl);
  // Mirrors the body (16/24) and subhead (14/20) text variants.
  const text =
    variant === 'subhead'
      ? { size: 14, lineHeight: 20 / 14, color: c.fgMuted }
      : { size: 16, lineHeight: 1.5, color: c.fg };
  const css = `
    :root { color-scheme: ${dark ? 'dark' : 'light'}; }
    html, body { margin: 0; padding: 0; background: transparent; }
    body {
      font-family: 'Inter', -apple-system, system-ui, Roboto, 'Segoe UI', sans-serif;
      font-size: ${(text.size * fontScale).toFixed(1)}px; line-height: ${text.lineHeight.toFixed(3)}; color: ${text.color};
      -webkit-text-size-adjust: none; overflow-wrap: anywhere;
    }
    ::selection { background: ${c.accentSoft}; }
    a { color: ${c.accentFg}; text-decoration: underline; text-underline-offset: 2px; }
    p { margin: 0 0 0.85em; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.25; font-weight: 600; letter-spacing: -0.01em; margin: 1.25em 0 0.5em; }
    h1 { font-size: 1.6em; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; } h4, h5, h6 { font-size: 1em; }
    body > :first-child { margin-top: 0; } body > :last-child { margin-bottom: 0; }
    ul, ol { padding-inline-start: 1.4em; margin: 0 0 0.85em; } li { margin: 0.2em 0; }
    img { max-width: 100% !important; height: auto !important; border-radius: 8px; }
    img.equation_image { border-radius: 0; vertical-align: middle; ${dark ? 'filter: invert(0.92);' : ''} }
    /* Keep table drags outside Android's edge-back gesture area. */
    .easel-overflow-frame { position: relative; min-width: 0; max-width: 100%; margin: 0 ${Platform.OS === 'android' ? '16px' : '0'} 1em; }
    .easel-overflow-frame[data-more="true"]::after {
      content: ''; position: absolute; inset-block: 0; right: 0; width: 18px; pointer-events: none;
      background: linear-gradient(to right, transparent, ${c.bg});
    }
    .easel-table { max-width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-x: contain; }
    .easel-table table { overflow-wrap: normal; word-break: normal; }
    .easel-table table.easel-wide { width: auto !important; table-layout: auto !important; }
    .easel-wide th, .easel-wide td { min-width: 5em; overflow-wrap: normal !important; word-break: normal !important; }
    table { border-collapse: collapse; min-width: 100%; font-size: 0.92em; }
    th, td { border: 1px solid ${c.border}; padding: 6px 8px; text-align: start; vertical-align: top; }
    th { background: ${c.surfaceSunken}; font-weight: 600; }
    blockquote { margin: 0 0 1em; padding: 0.1em 0 0.1em 1em; border-inline-start: 2px solid ${c.borderStrong}; color: ${c.fgMuted}; }
    code, pre { font-family: ui-monospace, Menlo, monospace; font-size: 0.88em; background: ${c.surfaceSunken}; border-radius: 6px; }
    code { padding: 0.1em 0.35em; } pre { padding: 12px; max-width: 100%; box-sizing: border-box; overflow-x: auto; overscroll-behavior-x: contain; overflow-wrap: normal; white-space: pre; } pre code { padding: 0; background: none; }
    hr { border: 0; border-top: 1px solid ${c.border}; margin: 1.5em 0; }
    iframe, video { max-width: 100%; border: 0; border-radius: 8px; }
    iframe { width: 100%; }
    video, audio { width: 100%; }
    .easel-embed { margin: 0 0 1em; }
    .easel-embed iframe { display: block; margin: 0; background: ${c.surfaceSunken}; }
    .easel-launch {
      display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; min-height: 44px;
      margin-top: 8px; padding: 10px 16px; border: 0; border-radius: 999px; background: ${c.accentSoft};
      color: ${c.accentFg}; font: inherit; font-size: 0.94em; font-weight: 600; cursor: pointer;
    }
    .easel-launch:active { opacity: 0.6; }
    .easel-blank {
      display: inline-block; min-width: 1.9em; margin: 0 0.15em; padding: 0 0.45em; border-radius: 6px;
      background: ${c.accentSoft}; color: ${c.accentFg}; font-weight: 600; text-align: center;
      font-variant-numeric: tabular-nums; line-height: 1.5;
    }
  `;

  // Runs after the content: wraps tables, keeps authored colors legible, reports height.
  const script = `
    (function () {
      var dark = ${dark};
      var page = ${JSON.stringify(hexToRgb(c.bg))};
      var fg = ${JSON.stringify(c.fg)};
      var sunken = ${JSON.stringify(c.surfaceSunken)};
      function parse(value) {
        var m = value && value.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/);
        if (!m || (m[4] !== undefined && Number(m[4]) < 0.3)) return null;
        return [Number(m[1]), Number(m[2]), Number(m[3])];
      }
      function lum(rgb) {
        var v = rgb.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      }
      function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

      document.querySelectorAll('table').forEach(function (t) {
        if (t.parentElement && t.parentElement.classList.contains('easel-table')) return;
        var frame = document.createElement('div');
        frame.className = 'easel-overflow-frame';
        var wrap = document.createElement('div');
        wrap.className = 'easel-table';
        t.parentNode.insertBefore(frame, t);
        frame.appendChild(wrap);
        wrap.appendChild(t);
        function measure() {
          var columns = Array.from(t.rows).reduce(function (max, row) {
            return Math.max(max, Array.from(row.cells).reduce(function (n, cell) { return n + cell.colSpan; }, 0));
          }, 0);
          t.classList.toggle('easel-wide', columns * 5 * parseFloat(getComputedStyle(t).fontSize) > wrap.clientWidth || t.scrollWidth > wrap.clientWidth);
          frame.dataset.more = String(wrap.scrollWidth - wrap.clientWidth - Math.abs(wrap.scrollLeft) > 2);
        }
        wrap.addEventListener('scroll', measure, { passive: true });
        if (window.ResizeObserver) new ResizeObserver(measure).observe(wrap);
        measure();
      });
      document.querySelectorAll('a[target]').forEach(function (a) { a.removeAttribute('target'); });
      // Players fill the width and keep their authored shape (560x315 stays 16:9, not letterboxed).
      document.querySelectorAll('iframe').forEach(function (f) {
        var wa = f.getAttribute('width') || f.style.width || '';
        var ha = f.getAttribute('height') || f.style.height || '';
        var w = parseFloat(wa), h = parseFloat(ha);
        if (w > 0 && h > 0 && !/%/.test(wa) && !/%/.test(ha)) {
          f.style.width = '100%'; f.style.height = 'auto'; f.style.aspectRatio = w + ' / ' + h;
        } else if (!ha) {
          f.style.aspectRatio = '16 / 9'; f.style.height = 'auto';
        }
      });

      // Authors pick colors for a white page. Swap backgrounds that would glare in dark
      // mode, and text colors that would vanish against the page.
      document.querySelectorAll('[style], font[color]').forEach(function (el) {
        var style = getComputedStyle(el);
        var bg = el.style.backgroundColor ? parse(style.backgroundColor) : null;
        if (bg && dark && lum(bg) > 0.45) { el.style.backgroundColor = sunken; bg = null; }
        var color = (el.style.color || el.getAttribute('color')) ? parse(style.color) : null;
        if (color && contrast(color, bg || page) < 3) el.style.color = fg;
      });

      // References only to Easel-created controls; Canvas titles/content remain verbatim.
      var launchLabels = [];
      var noticeKind = ${scriptJson(offlineNotice)};
      var notice = null;
      if (noticeKind) {
        notice = document.createElement('p');
        notice.setAttribute('role', 'note');
        document.body.insertBefore(notice, document.body.firstChild);
      }
      window.easelContentPresentation = function (value) {
        launchLabels.forEach(function (entry) {
          entry.button.textContent = entry.name
            ? value.openNamedTool.replace(/\{name\}/g, function () { return entry.name; })
            : value.openTool;
          entry.button.lang = value.locale;
          entry.button.dir = value.direction;
        });
        if (notice) {
          notice.textContent = value[noticeKind];
          notice.lang = value.locale;
          notice.dir = value.direction;
        }
        window.easelPostHeight && window.easelPostHeight();
      };

      // Tool iframes get a button that opens the tool full screen (LTI-5).
      document.querySelectorAll('iframe[data-easel-kind="lti"]').forEach(function (f) {
        var wrap = document.createElement('div');
        wrap.className = 'easel-embed';
        f.parentNode.insertBefore(wrap, f);
        wrap.appendChild(f);
        var name = f.getAttribute('title');
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'easel-launch';
        launchLabels.push({ button: button, name: name });
        button.addEventListener('click', function () {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'launch', url: f.getAttribute('data-easel-src') || f.src, title: name || '' }));
        });
        wrap.appendChild(button);
      });
      document.querySelectorAll('video').forEach(function (v) {
        v.setAttribute('playsinline', '');
        v.setAttribute('webkit-playsinline', '');
        if (!v.hasAttribute('autoplay')) v.setAttribute('controls', '');
        if (!v.getAttribute('preload')) v.setAttribute('preload', 'metadata');
      });

      // Canvas-hosted embeds wait for a web session, then load (HTML-6).
      var deferred = document.querySelectorAll('[data-easel-src]');
      function activate() {
        deferred.forEach(function (el) {
          var src = el.getAttribute('data-easel-src');
          if (!src) return;
          el.removeAttribute('data-easel-src');
          el.setAttribute('src', src);
          var media = (el.tagName === 'SOURCE' || el.tagName === 'TRACK') ? el.parentElement : null;
          if (media && media.load) media.load();
        });
        window.easelPostHeight && window.easelPostHeight();
      }
      function sessionFrame(url, done) {
        var frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.setAttribute('tabindex', '-1');
        frame.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;border:0;left:-10px;top:-10px;';
        var finished = false;
        function finish() { if (finished) return; finished = true; done && done(); setTimeout(function () { frame.remove(); }, 1000); }
        frame.addEventListener('load', finish);
        setTimeout(finish, 6000);
        frame.src = url;
        document.body.appendChild(frame);
      }
      window.easelSession = function (url) { if (url) sessionFrame(url, activate); else activate(); };
      window.easelRefreshSession = function (url) { if (url) sessionFrame(url); };
      if (deferred.length) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'session' }));

      function postHeight() {
        var h = Math.ceil(document.body.getBoundingClientRect().height);
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'height', value: h }));
      }
      window.easelPostHeight = postHeight;
      document.querySelectorAll('img').forEach(function (img) { img.addEventListener('load', postHeight); });
      if (window.ResizeObserver) new ResizeObserver(postHeight).observe(document.body);
      window.addEventListener('load', postHeight);
      postHeight();
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'presentationReady' }));
    })();
  `;

  const math = MATH.test(html)
    ? `<script>window.MathJax = { tex: { inlineMath: [['\\\\(', '\\\\)']] }, startup: { pageReady: function () { return MathJax.startup.defaultPageReady().then(function () { window.easelPostHeight && window.easelPostHeight(); }); } } };</script>
       <script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>`
    : '';

  const school = theme && (theme.css.length || theme.js.length) ? theme : null;

  return `<!doctype html><html dir="auto"><head>
    <meta charset="utf-8" />${school ? SCHOOL_THEME_CSP : ''}
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" media="print" onload="this.media='all'" />
    <style>${css}</style>${school ? schoolThemeStyle(school.css, fontScale) : ''}${math}
  </head><body>${body}<script>${script}</script>${school ? schoolThemeScript(school.js, c, dark) : ''}</body></html>`;
}

const VIDEO_HOSTS =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|player\.vimeo\.com|instructuremedia\.com|kaltura\.com|panopto\.com|loom\.com|wistia\.(com|net))$/i;
const IFRAME_ALLOW =
  'autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write; camera; microphone; display-capture';

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function hostOf(url: string): string {
  return url.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.toLowerCase() ?? '';
}

/** An embed's `src` as an absolute URL, or null for `data:`, `blob:`, and other schemes. */
function absoluteSrc(raw: string, baseUrl: string): string | null {
  const src = raw.trim().replace(/&amp;/g, '&');
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('//')) return `${baseUrl.split(':')[0]}:${src}`;
  if (src.startsWith('/')) return `${baseUrl}${src}`;
  return null;
}

/**
 * Rewrites embeds before the page parses, so nothing loads without a session:
 * Canvas-hosted iframes and media keep their URL in `data-easel-src` until the
 * session is up, and tool iframes are marked for a launch button. Players from
 * other hosts load right away with inline playback and fullscreen allowed.
 */
function prepareEmbeds(html: string, baseUrl: string): string {
  if (!/<(iframe|video|audio|source|track)\b/i.test(html)) return html;
  const canvasHost = hostOf(baseUrl);
  return html.replace(
    /<(iframe|video|audio|source|track)\b([^>]*?)(\/?)>/gi,
    (tag, name: string, attrs: string, close: string) => {
      const match = attrs.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const abs = match ? absoluteSrc(match[2] ?? match[3] ?? match[4] ?? '', baseUrl) : null;
      const iframe = name.toLowerCase() === 'iframe';
      let rest = attrs;
      if (iframe && !/\sallow\s*=/i.test(rest)) rest += ` allow="${IFRAME_ALLOW}"`;
      if (iframe && !/\sallowfullscreen/i.test(rest)) rest += ' allowfullscreen';
      if (!match || !abs) return `<${name}${rest}${close}>`;

      const host = hostOf(abs);
      if (host !== canvasHost) {
        if (!iframe || !VIDEO_HOSTS.test(host)) return `<${name}${rest}${close}>`;
        // Inline playback on iOS (YouTube plays fullscreen-only without it), and a referrer YouTube accepts.
        let src = abs;
        if (/youtube/i.test(host) && !/[?&]playsinline=/.test(src))
          src += `${src.includes('?') ? '&' : '?'}playsinline=1`;
        if (!/\sreferrerpolicy\s*=/i.test(rest)) rest += ' referrerpolicy="strict-origin-when-cross-origin"';
        return `<${name}${rest.replace(match[0], ` src="${escapeAttr(src)}"`)}${close}>`;
      }

      const lti = /\/external_tools\/retrieve/.test(abs);
      const src =
        lti && !/[?&]display=/.test(abs) ? `${abs}${abs.includes('?') ? '&' : '?'}display=borderless` : abs;
      const marked = ` data-easel-src="${escapeAttr(src)}" data-easel-kind="${lti ? 'lti' : 'canvas'}"`;
      return `<${name}${rest.replace(match[0], marked)}${close}>`;
    },
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/*
 * HTML-8: the school's mobile theme sits under Easel's styles, not over them.
 *
 * - CSS goes in a cascade layer after Easel's stylesheet, with `!important` removed. It
 *   styles what Easel leaves alone (custom classes, callouts, heading colors), never
 *   Easel's body type, links, tables, embeds, or authored inline colors. Fixed and sticky
 *   positions become static so nothing covers the content, and px and pt font sizes and
 *   line heights become rem, which follows the system text size (HTML-7). A file with
 *   unbalanced braces is dropped, since it could escape the layer.
 * - JS runs after Easel's script, each file in its own try/catch, once Easel's bridge
 *   (height, session, launch) is locked against replacement. `window.open` and
 *   `document.write` do nothing.
 * - A guard pass runs after the JS and after every DOM change: text under WCAG AA contrast
 *   against its real background goes back to Easel's colors, light backgrounds turn dark
 *   in dark mode, and fixed or sticky elements become static.
 * - A Content-Security-Policy blocks fetch, XHR, beacons, WebSockets, form posts, and
 *   scripts from new hosts. Images and iframes stay as open as authored content needs.
 * - Navigation stays native: every page load still goes through onShouldStartLoadWithRequest.
 */
const SCHOOL_THEME_CSP = `
    <meta http-equiv="Content-Security-Policy" content="connect-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; base-uri 'none'; form-action 'none'" />`;

/** px and pt as rem, which the theme's style ties to the system text size. */
function toRem(value: string, unit: string): string {
  const px = unit.toLowerCase() === 'pt' ? (Number(value) * 4) / 3 : Number(value);
  return `${Number((px / 16).toFixed(4))}rem`;
}

/** One theme stylesheet, rewritten to the policy above; '' when it can't be layered safely. */
function schoolThemeCss(source: string): string {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  // Equal brace counts alone allow a leading `}` to escape our cascade layer.
  // Ignore quoted strings and escaped characters while checking each nesting level.
  const structure = css.replace(/(["'])(?:\\[\s\S]|(?!\1)[^\\])*?\1/g, '').replace(/\\[\s\S]/g, '');
  let depth = 0;
  for (const char of structure) {
    if (char === '{') depth += 1;
    if (char === '}' && --depth < 0) return '';
  }
  if (depth !== 0) return '';
  return css
    .replace(/<\/style/gi, '<\\/style')
    .replace(/@(import|charset|namespace)\b[^;]*;/gi, '')
    .replace(/!\s*important/gi, '')
    .replace(/(position\s*:\s*)(?:-webkit-)?(?:fixed|sticky)/gi, '$1static')
    .replace(
      /(^|[{;\s])(font-size|line-height|font)(\s*:)([^;{}]*)/gi,
      (_match, before: string, property: string, colon: string, value: string) =>
        `${before}${property}${colon}${value.replace(/(\d*\.?\d+)(px|pt)\b/gi, (_size, n: string, unit: string) => toRem(n, unit))}`,
    );
}

function schoolThemeStyle(files: string[], fontScale: number): string {
  const layered = files.map(schoolThemeCss).filter(Boolean).join('\n');
  // Unlayered, so the theme can't change it.
  return `<style>@layer easel-school {\n${layered}\n}\nhtml { font-size: ${(16 * fontScale).toFixed(1)}px; }</style>`;
}

function schoolThemeScript(files: string[], c: ColorTokens, dark: boolean): string {
  // JSON with `<` escaped can't close the script tag, whatever the files contain.
  const sources = JSON.stringify(files).replace(/</g, '\\u003c');
  return `<script>
    (function () {
      var dark = ${dark};
      var page = ${JSON.stringify(hexToRgb(c.bg))}, text = ${JSON.stringify(hexToRgb(c.fg))};
      var fg = ${JSON.stringify(c.fg)}, bg = ${JSON.stringify(c.bg)};
      var sunken = ${JSON.stringify(c.surfaceSunken)}, sunkenRgb = ${JSON.stringify(hexToRgb(c.surfaceSunken))};
      function parse(value) {
        var m = value && value.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?/);
        if (!m || (m[4] !== undefined && Number(m[4]) < 0.3)) return null;
        return [Number(m[1]), Number(m[2]), Number(m[3])];
      }
      function lum(rgb) {
        var v = rgb.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      }
      function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
      function ownText(el) {
        for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && /\\S/.test(n.nodeValue)) return true;
        return false;
      }
      function lightGradient(image) {
        return (image.match(/rgba?\\([^)]*\\)/g) || []).some(function (stop) { var rgb = parse(stop); return rgb && lum(rgb) > 0.45; });
      }

      // Easel's bridge stays Easel's.
      try { Object.freeze(window.ReactNativeWebView); } catch (e) {}
      ['ReactNativeWebView', 'easelPostHeight', 'easelSession', 'easelRefreshSession', 'easelContentPresentation'].forEach(function (key) {
        try { Object.defineProperty(window, key, { value: window[key], writable: false, configurable: false }); } catch (e) {}
      });
      window.open = function () { return null; };
      document.write = document.writeln = function () {};

      ${sources}.forEach(function (source) {
        try { (0, eval)(source); } catch (e) {}
      });

      // Reads everything first, then writes, so the pass never forces a layout per element.
      var ours = new WeakSet();
      function guard() {
        var under = new Map(), writes = [];
        document.body.querySelectorAll('*').forEach(function (el) {
          if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
          var style = getComputedStyle(el);
          if (style.position === 'fixed' || style.position === 'sticky') writes.push([el, 'position', 'static']);
          var back = parse(style.backgroundColor);
          if (dark && back && lum(back) > 0.45) { writes.push([el, 'background-color', sunken]); back = sunkenRgb; }
          if (dark && style.backgroundImage.indexOf('gradient') >= 0 && lightGradient(style.backgroundImage)) {
            writes.push([el, 'background-image', 'none']);
            if (!back) { writes.push([el, 'background-color', sunken]); back = sunkenRgb; }
          }
          var behind = back || under.get(el.parentElement) || page;
          under.set(el, behind);
          if (!ownText(el)) return;
          var color = parse(style.color);
          if (!color) return;
          // Authored colors keep the content pass's bar; the theme's meet AA (3:1 for large text).
          var authored = (el.style.color && !ours.has(el)) || el.hasAttribute('color');
          var size = parseFloat(style.fontSize), weight = parseInt(style.fontWeight, 10) || 400;
          var need = authored || size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
          if (contrast(color, behind) >= need) return;
          writes.push([el, 'color', contrast(text, behind) >= contrast(page, behind) ? fg : bg]);
          ours.add(el);
        });
        writes.forEach(function (w) { w[0].style.setProperty(w[1], w[2], 'important'); });
      }
      var timer = null;
      var observer = window.MutationObserver ? new MutationObserver(function () { if (!timer) timer = setTimeout(run, 150); }) : null;
      function run() {
        timer = null;
        if (observer) observer.disconnect();
        try { guard(); } catch (e) {}
        if (observer) observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
        window.easelPostHeight && window.easelPostHeight();
      }
      run();
      window.addEventListener('load', run);
    })();
  </script>`;
}
