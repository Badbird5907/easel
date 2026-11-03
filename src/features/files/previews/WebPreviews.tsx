import type { File } from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { useCanvas } from '@/canvas/session';
import { Text, useTheme } from '@/design';
import { useTranslation } from '@/i18n';
import { pdfPresentation, pdfPresentationScript } from './presentation';
import { openCanvasLink, resolveCanvasLink } from '@/features/content/links';

type PreviewProps = { onError: () => void };

/**
 * A link tapped inside a document. Canvas pages Easel has a screen for open
 * there; anything else leaves Easel for the browser (or mail, phone, messages).
 * Other schemes, like intent: and file:, are ignored.
 */
function openDocumentLink(url: string, baseUrl: string) {
  if (resolveCanvasLink(url, baseUrl)) {
    openCanvasLink(url, baseUrl);
    return;
  }
  if (/^(https?|mailto|tel|sms):/i.test(url)) Linking.openURL(url).catch(() => {});
}

function Loading() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
      <ActivityIndicator color={colors.fgMuted} accessibilityLabel={t('files.previews.loading')} />
    </View>
  );
}

/**
 * A downloaded file in WKWebView, which renders PDFs (zoom, text selection) and
 * Office, iWork, and RTF documents natively. iOS only. Links in the document
 * open outside it.
 */
export function LocalDocumentPreview({
  local,
  onError,
  title,
}: PreviewProps & { local: File; title: string }) {
  const { account } = useCanvas();
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);
  const folder = local.parentDirectory.uri;
  const source = useMemo(() => ({ uri: local.uri }), [local.uri]);
  return (
    <View className="flex-1">
      <WebView
        source={source}
        contentInsetAdjustmentBehavior="automatic"
        allowingReadAccessToURL={folder}
        originWhitelist={['*']}
        style={{ flex: 1, backgroundColor: colors.bg }}
        javaScriptEnabled={false}
        incognito
        accessibilityLabel={title}
        onLoadEnd={() => {
          loaded.current = true;
          setLoading(false);
        }}
        onError={onError}
        onContentProcessDidTerminate={onError}
        onShouldStartLoadWithRequest={(request) => {
          if (request.url.startsWith('file://') || request.url === 'about:blank') return true;
          // Once the document is showing, any other navigation is a tapped link.
          if (loaded.current && request.isTopFrame) openDocumentLink(request.url, account.baseUrl);
          return false;
        }}
      />
      {loading ? <Loading /> : null}
    </View>
  );
}

/**
 * HTML files, sandboxed: no scripts, no cookies, no storage. Links open outside
 * the sandbox, in Easel when they point at Canvas, otherwise in the browser.
 */
export function HtmlPreview({
  local,
  onError,
  title,
}: PreviewProps & { local: File; title: string }) {
  const { account } = useCanvas();
  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);
  const source = useMemo(() => ({ uri: local.uri }), [local.uri]);
  return (
    <View className="flex-1 bg-surface">
      <WebView
        source={source}
        contentInsetAdjustmentBehavior="automatic"
        allowingReadAccessToURL={local.parentDirectory.uri}
        allowFileAccess
        originWhitelist={['*']}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        javaScriptEnabled={false}
        domStorageEnabled={false}
        incognito
        setSupportMultipleWindows={false}
        accessibilityLabel={title}
        onLoadEnd={() => {
          loaded.current = true;
          setLoading(false);
        }}
        onError={onError}
        onShouldStartLoadWithRequest={(request) => {
          if (request.url.startsWith('file://') || request.url.startsWith('about:'))
            return !loaded.current || request.url === local.uri;
          if (!request.isTopFrame) return false;
          openCanvasLink(request.url, account.baseUrl);
          return false;
        }}
      />
      {loading ? <Loading /> : null}
    </View>
  );
}

/** Canvas DocViewer (Canvadocs) for Office files when the school has it. */
export function DocViewerPreview({
  url,
  onError,
  title,
}: PreviewProps & { url: string; title: string }) {
  const { client, account } = useCanvas();
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const headers = useMemo(() => {
    try {
      // The session URL is HMAC-signed; the token only goes to the school's own host.
      return new URL(url).host === account.host ? client.authHeaders : undefined;
    } catch {
      return undefined;
    }
  }, [url, account.host, client]);
  const source = useMemo(() => ({ uri: url, headers }), [url, headers]);
  return (
    <View className="flex-1">
      <WebView
        source={source}
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: colors.bg }}
        sharedCookiesEnabled
        allowsInlineMediaPlayback
        setSupportMultipleWindows={false}
        accessibilityLabel={title}
        onLoadEnd={() => setLoading(false)}
        onError={onError}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode >= 400) onError();
        }}
      />
      {loading ? <Loading /> : null}
    </View>
  );
}

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
/** Base64 travels through the bridge as one string; past this, open in another app instead. */
export const ANDROID_PDF_LIMIT = 30_000_000;

/**
 * Android's WebView can't render PDFs, so pdf.js does, page by page as they
 * scroll into view. Pinch zoom comes from the viewport. Links open outside the
 * viewer, or jump to the page they point at.
 */
export function PdfJsPreview({
  local,
  onError,
  title,
}: PreviewProps & { local: File; title: string }) {
  const { t, locale } = useTranslation();
  const { account } = useCanvas();
  const webRef = useRef<WebView<object>>(null);
  const labels = useMemo(() => pdfPresentationScript(pdfPresentation(locale)), [locale]);
  const currentLabels = useRef(labels);
  useEffect(() => {
    currentLabels.current = labels;
    webRef.current?.injectJavaScript(labels);
  }, [labels]);
  const { colors } = useTheme();
  const [data, setData] = useState<string | null>(null);
  const [page, setPage] = useState<{ current: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const html = useMemo(() => pdfJsDocument(colors.bg, colors.fgMuted), [colors.bg, colors.fgMuted]);
  const source = useMemo(() => ({ html, baseUrl: 'https://cdnjs.cloudflare.com/' }), [html]);

  useEffect(() => {
    let alive = true;
    local.base64().then(
      (base64) => alive && setData(base64),
      () => alive && onError(),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.uri]);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as {
        type: string;
        page?: number;
        pages?: number;
        url?: string;
      };
      if (message.type === 'loaded') {
        setLoading(false);
        setPage({ current: 1, total: message.pages ?? 1 });
      } else if (message.type === 'page' && message.page) {
        setPage((p) => (p ? { ...p, current: message.page! } : p));
      } else if (message.type === 'link' && message.url) {
        openDocumentLink(message.url, account.baseUrl);
      } else if (message.type === 'error') {
        onError();
      }
    } catch {
      // Ignore.
    }
  };

  return (
    <View className="flex-1">
      {data ? (
        <WebView
          ref={webRef}
          source={source}
          onLoadEnd={() => webRef.current?.injectJavaScript(currentLabels.current)}
          originWhitelist={['*']}
          style={{ flex: 1, backgroundColor: colors.bg }}
          javaScriptEnabled
          setBuiltInZoomControls
          setDisplayZoomControls={false}
          accessibilityLabel={title}
          // Runs once the page (and pdf.js) has loaded.
          injectedJavaScript={`window.renderPdf && window.renderPdf(${JSON.stringify(data)}); true;`}
          onMessage={onMessage}
          onError={onError}
          onShouldStartLoadWithRequest={(request: { url: string }) =>
            request.url.startsWith('https://cdnjs.cloudflare.com/') ||
            request.url.startsWith('about:') ||
            request.url.startsWith('data:')
          }
        />
      ) : null}
      {loading ? <Loading /> : null}
      {page && page.total > 1 ? (
        <View
          pointerEvents="none"
          className="absolute right-3 top-3 rounded-full bg-surface-raised px-3 py-1.5"
        >
          <Text variant="caption" tone="muted" tabular accessibilityLiveRegion="polite">
            {t('files.previews.pageBadge', { current: page.current, total: page.total })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function pdfJsDocument(background: string, muted: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes">
<style>
  html, body { margin: 0; background: ${background}; }
  #pages { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px 0 32px; }
  .page { background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); position: relative; }
  .page canvas { display: block; width: 100%; height: 100%; }
  .page a { position: absolute; }
  #status { font: 15px system-ui, sans-serif; color: ${muted}; text-align: center; padding: 48px 24px; }
</style>
<script src="${PDFJS}/pdf.min.js"></script>
</head><body><div id="pages"></div>
<script>
(function () {
  function post(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  if (!window.pdfjsLib) { post({ type: 'error', message: 'pdf.js did not load' }); return; }
  pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS}/pdf.worker.min.js';
  // Presentation only: holders, canvases and numeric page protocol stay intact.
  var labelHolders = [], labelTotal = 0;
  function labelPage(div) {
    var labels = window.easelPdfLabels;
    if (!labels) return;
    function number(n) { return String(n).replace(/[0-9]/g, function (d) { return labels.digits[Number(d)]; }); }
    function name(page) {
      return labels.page.replace(/\\{(current|total)\\}/g, function (_, key) {
        return number(key === 'current' ? page : labelTotal);
      });
    }
    div.setAttribute('aria-label', name(div.dataset.page));
    // A link to another page reads as that page.
    (div.links || []).forEach(function (a) { if (a.dataset.page) a.setAttribute('aria-label', name(a.dataset.page)); });
  }
  window.easelUpdatePdfLabels = function () { labelHolders.forEach(labelPage); };
  window.renderPdf = async function (b64) {
    try {
      var raw = atob(b64), bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      var pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      var container = document.getElementById('pages');
      var width = Math.min(document.documentElement.clientWidth - 24, 900);
      var ratio = Math.min(window.devicePixelRatio || 1, 3);
      var first = (await pdf.getPage(1)).getViewport({ scale: 1 });
      var holders = [];
      labelHolders = holders;
      labelTotal = pdf.numPages;
      for (var n = 1; n <= pdf.numPages; n++) {
        var div = document.createElement('div');
        div.className = 'page';
        div.dataset.page = n;
        div.setAttribute('role', 'img');
        labelPage(div);
        div.style.width = width + 'px';
        div.style.height = Math.round(width * first.height / first.width) + 'px';
        container.appendChild(div);
        holders.push(div);
      }
      post({ type: 'loaded', pages: pdf.numPages });
      async function draw(div) {
        if (div.dataset.drawn) return;
        div.dataset.drawn = '1';
        var page = await pdf.getPage(Number(div.dataset.page));
        var base = page.getViewport({ scale: 1 });
        var viewport = page.getViewport({ scale: (width / base.width) * ratio });
        div.style.height = Math.round(width * base.height / base.width) + 'px';
        var canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        div.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
        addLinks(page, div, width / base.width).catch(function () {});
      }
      // Links: a web, mail or phone link goes to the app; a link inside the PDF scrolls to its page.
      async function linkTarget(a) {
        if (a.subtype !== 'Link') return null;
        if (a.url) return { url: a.url };
        if (!a.dest) return null;
        var dest = typeof a.dest === 'string' ? await pdf.getDestination(a.dest) : a.dest;
        var ref = Array.isArray(dest) ? dest[0] : null;
        var index = ref && typeof ref === 'object' ? await pdf.getPageIndex(ref) : ref;
        return Number.isInteger(index) && holders[index] ? { page: index + 1 } : null;
      }
      async function addLinks(page, div, scale) {
        var annotations = await page.getAnnotations({ intent: 'display' });
        var targets = await Promise.all(annotations.map(function (a) {
          return linkTarget(a).catch(function () { return null; });
        }));
        var viewport = page.getViewport({ scale: scale }), links = [];
        annotations.forEach(function (a, i) {
          var target = targets[i];
          if (!target) return;
          var r = pdfjsLib.Util.normalizeRect(viewport.convertToViewportRectangle(a.rect));
          var link = document.createElement('a');
          link.href = target.url || '#';
          if (target.page) link.dataset.page = target.page;
          else link.setAttribute('aria-label', target.url.replace(/^mailto:/, ''));
          link.style.left = r[0] + 'px';
          link.style.top = r[1] + 'px';
          link.style.width = r[2] - r[0] + 'px';
          link.style.height = r[3] - r[1] + 'px';
          link.addEventListener('click', function (e) {
            e.preventDefault();
            if (target.url) post({ type: 'link', url: target.url });
            else holders[target.page - 1].scrollIntoView();
          });
          div.appendChild(link);
          links.push(link);
        });
        if (!links.length) return;
        // An image's children are hidden from screen readers; a group's links aren't.
        div.links = links;
        div.setAttribute('role', 'group');
        labelPage(div);
      }
      // End links.
      var seen = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) draw(e.target); });
      }, { rootMargin: '800px 0px' });
      holders.forEach(function (d) { seen.observe(d); });
      var current = 1;
      window.addEventListener('scroll', function () {
        var middle = window.scrollY + window.innerHeight / 2, at = 1;
        holders.forEach(function (d) { if (d.offsetTop <= middle) at = Number(d.dataset.page); });
        if (at !== current) { current = at; post({ type: 'page', page: at }); }
      }, { passive: true });
    } catch (e) { post({ type: 'error', message: String(e && e.message || e) }); }
  };
})();
</script></body></html>`;
}

/** Whether this platform previews a downloaded document locally. */
export const previewsOfficeLocally = Platform.OS === 'ios';
