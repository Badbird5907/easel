import * as WebBrowser from 'expo-web-browser';
import { useMemo, useRef, useState } from 'react';
import { PixelRatio, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { type ColorTokens, useTheme } from '@/design';
import { useTranslation } from '@/i18n';

import { authTermsClaim, useAuthTermsLifetime } from './authTermsLifetime';

/**
 * A school's terms of use, as HTML, before the account is signed in.
 * RichContent needs a signed-in account, so this is a lighter version with the
 * same type and colors. It sizes itself to the text; links open in the browser.
 */
export function TermsDocument({ html, baseUrl }: { html: string; baseUrl: string }) {
  const { colors, scheme } = useTheme();
  const { t } = useTranslation();
  const loaded = useRef<object | null>(null);
  const fontScale = PixelRatio.getFontScale();
  const document = useMemo(
    () => buildDocument(html, colors, scheme === 'dark', fontScale),
    [html, colors, scheme, fontScale],
  );

  const source = useMemo(() => ({ html: document, baseUrl }), [document, baseUrl]);
  const owner = useAuthTermsLifetime(source);
  const [measurement, setMeasurement] = useState<{ owner: typeof owner; height: number } | null>(
    null,
  );
  const height = measurement?.owner === owner ? measurement.height : 120;

  return (
    <View style={{ height }}>
      <WebView
        key={JSON.stringify([document, baseUrl])}
        source={source}
        accessibilityLabel={t('authTerms.heading')}
        originWhitelist={['*']}
        scrollEnabled={false}
        style={{ backgroundColor: 'transparent' }}
        textZoom={100}
        setSupportMultipleWindows={false}
        onLoadEnd={() => {
          if (owner.active) loaded.current = owner;
        }}
        onMessage={(event) => {
          const value = Number(event.nativeEvent.data);
          // Ignore non-finite/unsafe dimensions; retain the previous valid measurement.
          if (owner.active && value > 0 && Number.isSafeInteger(Math.ceil(value))) {
            setMeasurement({ owner, height: Math.ceil(value) });
          }
        }}
        onShouldStartLoadWithRequest={(request) => {
          if (!owner.active) return false;
          if (!request.isTopFrame || loaded.current !== owner || request.url.startsWith('about:'))
            return true;
          if (/^https?:/.test(request.url)) {
            const operation = authTermsClaim(owner);
            if (operation) {
              void WebBrowser.openBrowserAsync(request.url)
                .catch(() => {})
                .finally(() => operation.release());
            }
          }
          return false;
        }}
      />
    </View>
  );
}

function buildDocument(html: string, c: ColorTokens, dark: boolean, fontScale: number) {
  const css = `
    :root { color-scheme: ${dark ? 'dark' : 'light'}; }
    html, body { margin: 0; padding: 0; background: transparent; }
    body { font-family: 'Inter', -apple-system, system-ui, Roboto, sans-serif; font-size: ${(15 * fontScale).toFixed(1)}px;
      line-height: 1.5; color: ${c.fg}; -webkit-text-size-adjust: none; overflow-wrap: anywhere; }
    a { color: ${c.accentFg}; text-underline-offset: 2px; }
    p, ul, ol { margin: 0 0 0.85em; } ul, ol { padding-inline-start: 1.4em; }
    h1, h2, h3, h4 { line-height: 1.25; font-weight: 600; margin: 1.2em 0 0.45em; }
    h1 { font-size: 1.4em; } h2 { font-size: 1.25em; } h3 { font-size: 1.1em; } h4 { font-size: 1em; }
    body > :first-child { margin-top: 0; } body > :last-child { margin-bottom: 0; }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; } th, td { border: 1px solid ${c.border}; padding: 4px 6px; }
  `;
  const script = `
    (function () {
      document.querySelectorAll('a[target]').forEach(function (a) { a.removeAttribute('target'); });
      function post() { window.ReactNativeWebView.postMessage(String(Math.ceil(document.body.getBoundingClientRect().height))); }
      if (window.ResizeObserver) new ResizeObserver(post).observe(document.body);
      window.addEventListener('load', post);
      post();
    })();
  `;
  return `<!doctype html><html dir="auto"><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>${css}</style></head><body>${html}<script>${script}</script></body></html>`;
}
