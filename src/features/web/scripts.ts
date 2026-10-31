/**
 * Scripts injected into the authenticated web view and its popups (LTI-4).
 *
 * React Native's WebView can open a popup but can't give it a real
 * `window.opener`, which tools rely on for sign-in popups (Google, Microsoft)
 * and pickers. So the page's `window.open` returns a stand-in window that Easel
 * keeps in sync with the popup sheet: its `location.href` follows the popup's
 * navigation (MSAL-style polling works), `closed` flips when the sheet closes,
 * and `postMessage` reaches the popup. In the popup, `window.opener.postMessage`
 * and `window.close()` come back to the page as real `message` events.
 *
 * On iOS these run in every frame, so tools inside Canvas's iframes get them
 * too. Android's WebView can only inject into the main frame (react-native-webview
 * ignores the `…ForMainFrameOnly` props there), although its message bridge
 * reaches every frame. So on Android, tool launches load the tool as the page
 * itself instead of inside Canvas's iframe (`toolFrameShim`), the way Canvas's
 * own "self" launch type does, and the shims reach the tool.
 */

/** Posts a message to native from any frame. */
const POST = `
  function __easelPost(msg) {
    try {
      var text = JSON.stringify(msg);
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
      else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ReactNativeWebView)
        window.webkit.messageHandlers.ReactNativeWebView.postMessage(text);
    } catch (e) {}
  }
  function __easelSerialize(data) {
    try { return { json: JSON.stringify(data) }; } catch (e) { return { json: 'null' }; }
  }
`;

export const pageShim = `
(function () {
  if (window.__easelPageShim) return;
  window.__easelPageShim = true;
  ${POST}
  var popups = {};
  var seq = 0;
  var nativeOpen = window.open;

  function absolute(url) {
    try { return new URL(url, location.href).href; } catch (e) { return String(url); }
  }

  window.open = function (url, name, features) {
    if (!url || url === 'about:blank') return nativeOpen ? nativeOpen.apply(window, arguments) : null;
    var id = 'p' + (++seq) + '_' + Date.now();
    var href = absolute(url);
    var proxy = {
      closed: false,
      opener: window,
      name: name || '',
      focus: function () {},
      blur: function () {},
      close: function () {
        if (proxy.closed) return;
        proxy.closed = true;
        __easelPost({ type: 'easel-popup-close', id: id });
      },
      postMessage: function (data, origin) {
        __easelPost({ type: 'easel-popup-post', id: id, data: __easelSerialize(data), origin: origin || '*' });
      },
    };
    proxy.location = {
      get href() { return href; },
      set href(value) { href = absolute(value); __easelPost({ type: 'easel-popup-navigate', id: id, url: href }); },
      assign: function (value) { proxy.location.href = value; },
      replace: function (value) { proxy.location.href = value; },
      toString: function () { return href; },
    };
    popups[id] = { proxy: proxy, setHref: function (value) { href = value; } };
    __easelPost({ type: 'easel-popup-open', id: id, url: href, name: name || '' });
    return proxy;
  };

  /**
   * Applies a popup event in this frame. True when this frame opened the popup,
   * so the event needn't travel further. Messages from popups Easel opened
   * without a stand-in (links with target=_blank) have no ID and go everywhere.
   */
  function apply(id, kind, payload) {
    var entry = id ? popups[id] : null;
    if (kind === 'message') {
      if (id && !entry) return false;
      var data = null;
      try { data = JSON.parse(payload.json); } catch (e) {}
      // MessageEvent only takes a real window as its source; attach the stand-in afterwards.
      var event = new MessageEvent('message', { data: data, origin: payload.origin || '' });
      if (entry) { try { Object.defineProperty(event, 'source', { value: entry.proxy }); } catch (e) {} }
      window.dispatchEvent(event);
      return !!entry;
    }
    if (!entry) return false;
    if (kind === 'url') entry.setHref(payload);
    if (kind === 'closed') { entry.proxy.closed = true; delete popups[id]; }
    return true;
  }

  function relay(event) {
    for (var i = 0; i < window.frames.length; i++) {
      try { window.frames[i].postMessage({ __easelPopup: event }, '*'); } catch (e) {}
    }
  }

  // Native calls this in the main frame; it forwards to the child frame that owns the popup.
  window.__easelPopupEvent = function (id, kind, payload) {
    if (!apply(id, kind, payload)) relay({ id: id, kind: kind, payload: payload });
  };

  window.addEventListener('message', function (event) {
    var forwarded = event.data && event.data.__easelPopup;
    if (!forwarded) return;
    event.stopImmediatePropagation();
    if (!apply(forwarded.id, forwarded.kind, forwarded.payload)) relay(forwarded);
  }, true);
})();
true;
`;

/**
 * Android only. Canvas's launch page posts the tool's launch form into
 * `iframe#tool_content`; this sends it to the page itself, so the tool becomes
 * the main frame and gets the page shim. Back from the tool to the spent launch
 * page tells native to leave instead of relaunching.
 */
export const toolFrameShim = `
(function () {
  if (window.__easelToolShim) return;
  window.__easelToolShim = true;
  ${POST}
  var KEY = '__easelUnwrapped';
  var here = location.href.split('#')[0];
  var revisited = false;
  try { revisited = sessionStorage.getItem(KEY) === here; } catch (e) {}
  if (revisited) __easelPost({ type: 'easel-tool-revisited' });
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    try { if (sessionStorage.getItem(KEY) === here) __easelPost({ type: 'easel-tool-revisited' }); } catch (e) {}
  });

  function launchForm(form) {
    var target = form.getAttribute('target') || '';
    if (!/^tool_content/.test(target) || !/^tool_form/.test(form.id || '')) return false;
    var frame = document.getElementsByName(target)[0];
    return !!frame && frame.tagName === 'IFRAME';
  }
  /** False when the form shouldn't go at all: a launch already used. */
  function retarget(form) {
    if (!launchForm(form)) return true;
    if (revisited) return false;
    form.setAttribute('target', '_self');
    try { sessionStorage.setItem(KEY, here); } catch (e) {}
    __easelPost({ type: 'easel-tool-unwrapped' });
    return true;
  }
  var nativeSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    if (retarget(this)) return nativeSubmit.apply(this, arguments);
  };
  if (HTMLFormElement.prototype.requestSubmit) {
    var nativeRequest = HTMLFormElement.prototype.requestSubmit;
    HTMLFormElement.prototype.requestSubmit = function () {
      if (retarget(this)) return nativeRequest.apply(this, arguments);
    };
  }
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (form && form.tagName === 'FORM' && !retarget(form)) event.preventDefault();
  }, true);
})();
true;
`;

/**
 * Android only. Its WebView hands downloads to the system download manager,
 * which skips Easel's viewer. Links marked as downloads come to native instead.
 * (iOS reports downloads through onFileDownload.)
 */
export const androidDownloadShim = `
(function () {
  if (window.__easelDownloadShim) return;
  window.__easelDownloadShim = true;
  ${POST}
  document.addEventListener('click', function (event) {
    var el = event.target;
    var link = el && el.closest ? el.closest('a[download]') : null;
    if (!link || !link.href || !/^https?:/i.test(link.href)) return;
    event.preventDefault();
    __easelPost({ type: 'easel-download', url: link.href, name: link.getAttribute('download') || '' });
  }, true);
})();
true;
`;

/** The popup's side: `window.opener` and `window.close()` that reach the page. */
export const popupShim = `
(function () {
  if (window.__easelPopupShim) return;
  window.__easelPopupShim = true;
  ${POST}
  var opener = {
    closed: false,
    postMessage: function (data, origin) {
      __easelPost({ type: 'easel-opener-post', data: __easelSerialize(data), origin: location.origin, target: origin || '*' });
    },
    focus: function () {},
    location: { href: '', reload: function () {} },
  };
  try { Object.defineProperty(window, 'opener', { configurable: true, get: function () { return opener; } }); }
  catch (e) { try { window.opener = opener; } catch (e2) {} }
  window.close = function () { __easelPost({ type: 'easel-popup-self-close' }); };
})();
true;
`;

/** Messages from the page into the popup arrive as real `message` events there. */
export function deliverToPopup(payload: { json: string }, origin: string) {
  return `(function () {
    var data = null;
    try { data = JSON.parse(${JSON.stringify(payload.json)}); } catch (e) {}
    window.dispatchEvent(new MessageEvent('message', { data: data, origin: ${JSON.stringify(origin)} }));
  })(); true;`;
}

/** Calls the page shim's `__easelPopupEvent` from native. */
export function popupEvent(id: string | null, kind: 'url' | 'closed' | 'message', payload: unknown) {
  return `window.__easelPopupEvent && window.__easelPopupEvent(${JSON.stringify(id)}, ${JSON.stringify(kind)}, ${JSON.stringify(payload)}); true;`;
}

export type ShimMessage =
  | { type: 'easel-popup-open'; id: string; url: string; name: string }
  | { type: 'easel-popup-close'; id: string }
  | { type: 'easel-popup-navigate'; id: string; url: string }
  | { type: 'easel-popup-post'; id: string; data: { json: string }; origin: string }
  | { type: 'easel-opener-post'; data: { json: string }; origin: string; target: string }
  | { type: 'easel-popup-self-close' }
  | { type: 'easel-tool-unwrapped' }
  | { type: 'easel-tool-revisited' }
  | { type: 'easel-download'; url: string; name: string };

export function parseShimMessage(raw: string): ShimMessage | null {
  if (!raw || raw[0] !== '{' || !raw.includes('"easel-')) return null;
  try {
    const message = JSON.parse(raw) as ShimMessage;
    return typeof message.type === 'string' && message.type.startsWith('easel-') ? message : null;
  } catch {
    return null;
  }
}
