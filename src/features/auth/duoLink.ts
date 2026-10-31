/** Duo device verification is an app handoff, not a web page or an OAuth callback. */
export function isDuoScheme(value: string): boolean {
  return /^duotrustedendpoints:/i.test(value);
}

export function isDuoAppLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'duotrustedendpoints:' && url.hostname === 'duo.com' &&
      url.pathname === '/trusted_ep' && !url.username && !url.password && !url.port && !url.hash;
  } catch {
    return false;
  }
}

/** Only the hosted Duo prompt may ask the clipboard bridge to launch its app. */
export function isDuoPromptPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^api-[a-f0-9]{8}\.duosecurity\.com$/i.test(url.hostname) &&
      !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

/**
 * Duo's Android WebView path writes the trusted-endpoint URL to the clipboard
 * instead of navigating (TrustedEndpointsCollectionPrompt in Duo's App.js).
 * Hand that specific write to native Linking; leave every other clipboard write
 * alone. Install both before content and after load because early injection on
 * Android is best effort. The installation is idempotent and main-frame only.
 */
export const DUO_CLIPBOARD_BRIDGE = String.raw`
(function () {
  if (window.top !== window || window.__easelDuoClipboardHandoff) return;
  if (location.protocol !== 'https:' || location.port ||
      !/^api-[a-f0-9]{8}\.duosecurity\.com$/i.test(location.hostname)) return;
  var clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function' || !window.ReactNativeWebView) return;
  var writeText = clipboard.writeText.bind(clipboard);
  clipboard.writeText = function (value) {
    if (typeof value === 'string') {
      try {
        var url = new URL(value);
        if (url.protocol === 'duotrustedendpoints:' && url.hostname === 'duo.com' &&
            url.pathname === '/trusted_ep' && !url.username && !url.password && !url.port && !url.hash) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'easel-duo-open', url: value }));
          return Promise.resolve();
        }
      } catch (_) {}
    }
    return writeText(value);
  };
  window.__easelDuoClipboardHandoff = true;
})();
true;
`;
