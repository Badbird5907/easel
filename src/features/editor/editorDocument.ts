import type { ColorTokens } from '@/design';

import { escapePresentationHtml, scriptJson } from '../content/presentation';

/**
 * The page inside the rich editor's WebView: one `contenteditable` region
 * styled like Easel text, plus the script that sanitizes HTML in and out,
 * reports format state and height, and runs toolbar commands.
 *
 * Messages to React Native (JSON):
 *   { type: 'ready' }
 *   { type: 'change', html }               sanitized HTML, '' when empty
 *   { type: 'height', value }              content height in points
 *   { type: 'state', state: FormatState }  for the toolbar's selected states
 *   { type: 'focus' } / { type: 'blur' }
 *   { type: 'link', text, href }           the selection, for the link sheet
 *
 * Commands from React Native go through `window.easel.*` (see RichEditor).
 */

export type FormatState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  bulleted: boolean;
  numbered: boolean;
  heading: boolean;
  link: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

export const emptyFormat: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  bulleted: false,
  numbered: false,
  heading: false,
  link: false,
  canUndo: false,
  canRedo: false,
};

export type EditorTheme = {
  colors: ColorTokens;
  fontScale: number;
};

/** CSS custom properties for the theme. Updated in place, so a scheme change keeps focus and undo. */
export function themeVariables({ colors: c, fontScale }: EditorTheme): Record<string, string> {
  return {
    '--fg': c.fg,
    '--muted': c.fgMuted,
    '--subtle': c.fgSubtle,
    '--accent': c.accent,
    '--accent-fg': c.accentFg,
    '--accent-soft': c.accentSoft,
    '--border': c.border,
    '--border-strong': c.borderStrong,
    '--sunken': c.surfaceSunken,
    '--size': `${(16 * fontScale).toFixed(1)}px`,
  };
}

export function buildEditorDocument(options: {
  html: string;
  theme: EditorTheme;
  dark: boolean;
  placeholder: string;
  label: string;
  editable: boolean;
  locale?: string;
  direction?: 'ltr' | 'rtl';
}): string {
  // A JSON string inside the script, so the HTML is only ever parsed inertly by `sanitize`.
  const initial = scriptJson(options.html);
  const vars = Object.entries(themeVariables(options.theme))
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');

  const css = `
    :root { ${vars} color-scheme: ${options.dark ? 'dark' : 'light'}; }
    html, body { margin: 0; padding: 0; background: transparent; min-height: 100%; }
    html { height: 100%; }
    body {
      cursor: text;
      font-family: 'Inter', -apple-system, system-ui, Roboto, 'Segoe UI', sans-serif;
      font-size: var(--size); line-height: 1.5; color: var(--fg);
      -webkit-text-size-adjust: none; -webkit-tap-highlight-color: transparent;
      overflow-wrap: anywhere;
    }
    #editor {
      position: relative; outline: none; min-height: 1.5em;
      padding: 12px 14px 14px; caret-color: var(--accent);
    }
    #editor.empty::before {
      content: attr(data-placeholder); position: absolute; top: 12px; left: 14px; right: 14px;
      color: var(--subtle); pointer-events: none;
      direction: var(--placeholder-direction); text-align: start;
    }
    ::selection { background: var(--accent-soft); }
    a { color: var(--accent-fg); text-decoration: underline; text-underline-offset: 2px; }
    p { margin: 0 0 0.75em; }
    h2, h3, h4 { line-height: 1.25; font-weight: 600; letter-spacing: -0.01em; margin: 1em 0 0.4em; }
    h2 { font-size: 1.35em; } h3 { font-size: 1.2em; } h4 { font-size: 1.05em; }
    #editor > :first-child { margin-top: 0; } #editor > :last-child { margin-bottom: 0; }
    ul, ol { padding-inline-start: 1.4em; margin: 0 0 0.75em; } li { margin: 0.15em 0; }
    blockquote { margin: 0 0 0.75em; padding-inline-start: 0.9em; border-inline-start: 2px solid var(--border-strong); color: var(--muted); }
    img { max-width: 100%; height: auto; border-radius: 8px; }
    code, pre { font-family: ui-monospace, Menlo, monospace; font-size: 0.9em; background: var(--sunken); border-radius: 6px; }
    code { padding: 0.1em 0.3em; } pre { padding: 10px; white-space: pre-wrap; }
  `;

  const script = `
  (function () {
    var editor = document.getElementById('editor');
    function post(message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); }

    // --- Sanitizing: an allowlist of tags and attributes, the shapes Canvas keeps.
    var ALLOWED = {
      P: [], BR: [], STRONG: [], EM: [], U: [], S: [], SUB: [], SUP: [],
      UL: [], OL: [], LI: [], H2: [], H3: [], H4: [], BLOCKQUOTE: [], PRE: [], CODE: [],
      A: ['href', 'title'], IMG: ['src', 'alt', 'width', 'height']
    };
    var RENAME = { B: 'STRONG', I: 'EM', DIV: 'P', H1: 'H2', H5: 'H4', H6: 'H4', STRIKE: 'S', DEL: 'S' };
    var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, FORM: 1, INPUT: 1, BUTTON: 1,
      SELECT: 1, TEXTAREA: 1, META: 1, LINK: 1, TITLE: 1, HEAD: 1, SVG: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1, NOSCRIPT: 1 };

    function unwrap(el) {
      var parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
    function clean(node) {
      var children = Array.prototype.slice.call(node.childNodes);
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child.nodeType === 3) continue;
        if (child.nodeType !== 1) { node.removeChild(child); continue; }
        var tag = child.tagName.toUpperCase();
        if (DROP[tag]) { node.removeChild(child); continue; }
        var mapped = RENAME[tag] || tag;
        if (!ALLOWED[mapped]) { clean(child); unwrap(child); continue; }
        var el = child;
        if (mapped !== tag) {
          el = document.createElement(mapped);
          while (child.firstChild) el.appendChild(child.firstChild);
          node.replaceChild(el, child);
        }
        var attrs = Array.prototype.slice.call(el.attributes);
        for (var j = 0; j < attrs.length; j++) {
          if (ALLOWED[mapped].indexOf(attrs[j].name) < 0) el.removeAttribute(attrs[j].name);
        }
        if (mapped === 'A') {
          var href = (el.getAttribute('href') || '').trim();
          if (!/^(https?:|mailto:|tel:|\\/|#)/i.test(href)) el.removeAttribute('href');
        }
        if (mapped === 'IMG' && !/^(https?:|data:image\\/)/i.test(el.getAttribute('src') || '')) {
          node.removeChild(el);
          continue;
        }
        clean(el);
      }
    }
    // Parsed in an inert document, so nothing in the input loads or runs.
    function sanitize(html) {
      var doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
      clean(doc.body);
      return doc.body.innerHTML;
    }
    function isEmpty() {
      return !editor.textContent.trim() && !editor.querySelector('img');
    }
    function serialize() {
      if (isEmpty()) return '';
      var html = sanitize(editor.innerHTML);
      // Drop the empty paragraphs Enter leaves at the end.
      return html.replace(/(<p>(<br>|\\s|&nbsp;)*<\\/p>)+$/i, '').trim();
    }

    // --- State reporting
    var lastHtml = null, lastState = '', lastHeight = 0;
    function reportHeight() {
      var h = Math.ceil(editor.getBoundingClientRect().height);
      if (h !== lastHeight) { lastHeight = h; post({ type: 'height', value: h }); }
    }
    function closest(tag) {
      var sel = window.getSelection();
      var node = sel && sel.anchorNode;
      while (node && node !== editor) {
        if (node.nodeType === 1 && node.tagName === tag) return node;
        node = node.parentNode;
      }
      return null;
    }
    function q(name) { try { return document.queryCommandState(name); } catch (e) { return false; } }
    function enabled(name) { try { return document.queryCommandEnabled(name); } catch (e) { return false; } }
    function reportState() {
      var block = '';
      try { block = String(document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch (e) {}
      var inHeading = /^h[1-6]$/.test(block) || !!closest('H2') || !!closest('H3') || !!closest('H4');
      var state = {
        // Headings are bold by style; only explicit bold counts there.
        bold: inHeading ? !!(closest('STRONG') || closest('B')) : q('bold'),
        italic: q('italic'),
        // Links are underlined by style; only real underlines count.
        underline: !!closest('U') || (q('underline') && !closest('A')),
        bulleted: q('insertUnorderedList'), numbered: q('insertOrderedList'),
        heading: inHeading,
        link: !!closest('A'),
        canUndo: enabled('undo'), canRedo: enabled('redo')
      };
      var key = JSON.stringify(state);
      if (key !== lastState) { lastState = key; post({ type: 'state', state: state }); }
    }
    function changed() {
      editor.classList.toggle('empty', isEmpty());
      var html = serialize();
      if (html !== lastHtml) { lastHtml = html; post({ type: 'change', html: html }); }
      reportHeight();
      reportState();
    }

    // --- Selection, kept across the link sheet (focus moves to a native field)
    var saved = null;
    function saveSelection() {
      var sel = window.getSelection();
      if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) saved = sel.getRangeAt(0).cloneRange();
    }
    function restoreSelection() {
      editor.focus();
      if (!saved) return;
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(saved);
    }
    function caretToEnd() {
      var range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    function ensureFocus() {
      if (document.activeElement !== editor) {
        editor.focus();
        if (!saved) caretToEnd(); else restoreSelection();
      }
    }

    function escapeHtml(text) {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    window.easel = {
      exec: function (command) {
        ensureFocus();
        if (command === 'heading') {
          var heading = closest('H2') || closest('H3') || closest('H4');
          document.execCommand('formatBlock', false, heading ? '<p>' : '<h3>');
        } else {
          document.execCommand(command, false, null);
        }
        changed();
      },
      requestLink: function () {
        saveSelection();
        var a = closest('A');
        var sel = window.getSelection();
        post({ type: 'link', text: a ? a.textContent : (sel ? sel.toString() : ''), href: a ? a.getAttribute('href') || '' : '' });
      },
      applyLink: function (href, text) {
        restoreSelection();
        var a = closest('A');
        if (a) {
          var range = document.createRange();
          range.selectNode(a);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
        if (!href) {
          document.execCommand('unlink', false, null);
        } else {
          var selected = window.getSelection().toString();
          var label = text || selected || href;
          document.execCommand('insertHTML', false, '<a href="' + escapeHtml(href) + '">' + escapeHtml(label) + '</a>');
        }
        saved = null;
        changed();
      },
      insertImage: function (src, alt) {
        ensureFocus();
        document.execCommand('insertHTML', false, '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt || '') + '">');
        changed();
      },
      setHTML: function (html) {
        // A value set from outside (an @-mention swap) keeps typing at the end, not the start.
        var focused = document.activeElement === editor;
        editor.innerHTML = sanitize(html);
        if (focused) { saved = null; caretToEnd(); }
        lastHtml = serialize();
        editor.classList.toggle('empty', isEmpty());
        reportHeight();
      },
      setTheme: function (vars, dark) {
        for (var key in vars) document.documentElement.style.setProperty(key, vars[key]);
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
        reportHeight();
      },
      setEditable: function (on) {
        editor.setAttribute('contenteditable', on ? 'true' : 'false');
        editor.setAttribute('aria-disabled', on ? 'false' : 'true');
        if (!on) editor.blur();
      },
      // Metadata only: never touch content, selection, focus, undo, or change reporting.
      setPresentation: function (value) {
        document.documentElement.lang = value.locale;
        document.title = value.label;
        editor.setAttribute('aria-label', value.label);
        editor.setAttribute('data-placeholder', value.placeholder);
        editor.style.setProperty('--placeholder-direction', value.direction);
      },
      setPlaceholder: function (text) { editor.setAttribute('data-placeholder', text || ''); },
      focus: function () { ensureFocus(); },
      blur: function () { editor.blur(); }
    };

    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
    window.easel.setHTML(${initial});
    window.easel.setPresentation(${scriptJson({ label: options.label, placeholder: options.placeholder, locale: options.locale ?? 'en', direction: options.direction ?? 'ltr' })});

    editor.addEventListener('input', changed);
    editor.addEventListener('focus', function () { post({ type: 'focus' }); reportState(); });
    editor.addEventListener('blur', function () { saveSelection(); post({ type: 'blur' }); });
    editor.addEventListener('keyup', reportState);
    document.addEventListener('selectionchange', function () {
      if (document.activeElement === editor) reportState();
    });
    // Pasted content keeps its structure but loses outside styles, scripts, and classes.
    editor.addEventListener('paste', function (event) {
      var data = event.clipboardData;
      if (!data) return;
      event.preventDefault();
      var html = data.getData('text/html');
      if (html) document.execCommand('insertHTML', false, sanitize(html));
      else document.execCommand('insertText', false, data.getData('text/plain'));
      changed();
    });
    editor.addEventListener('drop', function (event) { event.preventDefault(); });
    // The page is taller than the text: a tap below the last line writes at the end, like a text view.
    document.addEventListener('click', function (event) {
      if (editor.getAttribute('contenteditable') !== 'true') return;
      if (event.target === document.body || event.target === document.documentElement) {
        editor.focus();
        caretToEnd();
        reportState();
      }
    });
    // Links are for reading later, not for following while writing.
    editor.addEventListener('click', function (event) {
      if (event.target && event.target.closest && event.target.closest('a')) event.preventDefault();
    });
    if (window.ResizeObserver) new ResizeObserver(reportHeight).observe(editor);
    window.addEventListener('load', reportHeight);
    reportHeight();
    post({ type: 'ready' });
  })();
  `;

  const attr = escapePresentationHtml;

  return `<!doctype html><html dir="auto" lang="${attr(options.locale ?? 'en')}"><head>
    <title>${attr(options.label)}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>${css}</style>
  </head><body><div id="editor" dir="auto" role="textbox" aria-multiline="true" aria-label="${attr(options.label)}"
    contenteditable="${options.editable ? 'true' : 'false'}" spellcheck="true" autocapitalize="sentences"
    data-placeholder="${attr(options.placeholder)}"></div><script>${script}</script></body></html>`;
}
