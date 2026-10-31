/** Production components/scripts with simulated hooks, native props and minimal DOM.
 * No React reconciliation, browser engine, mounted WebView, native focus or real undo stack. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
const output = mkdtempSync(resolve(tmpdir(), 'easel-editor-content-'));
const mock = `
import { rewriteAssetHtml } from '${process.cwd()}/src/features/sync/assetHtml';
export const state = { online: false, assetReads: 0, announcements: [] };
let current;
export function harness(component, props) {
  const scope = { slots: [], cursor: 0, effects: [], dirty: false };
  return { render(next = props) {
    props = next;
    let tree;
    do { scope.dirty = false; scope.cursor = 0; current = scope; tree = component(props);
      current = null;
      for (const effect of scope.effects.splice(0)) effect();
    } while (scope.dirty);
    return tree;
  } };
}
export function useState(initial) {
 const scope = current, i = scope.cursor++;
 if (!(i in scope.slots)) scope.slots[i] = typeof initial === 'function' ? initial() : initial;
 return [scope.slots[i], value => { const v = typeof value === 'function' ? value(scope.slots[i]) : value; if (!Object.is(v, scope.slots[i])) { scope.slots[i] = v; scope.dirty = true; } }];
}
export const useRef = v => useState(() => ({ current: v }))[0];
const same = (a,b) => a && b && a.length === b.length && a.every((x,i) => Object.is(x,b[i]));
export function useMemo(fn, deps) { const slot = useRef(); if (!slot.current || !same(slot.current.deps, deps)) slot.current = { deps, value: fn() }; return slot.current.value; }
export const useCallback = (fn, deps) => useMemo(() => fn, deps);
export function useEffect(fn, deps) { const slot = useRef(); if (!slot.current || !same(slot.current.deps, deps)) { slot.current = { deps }; current.effects.push(fn); } }
export function useLayoutEffect(fn, deps) {
 const slot = useRef(); const old = slot.current;
 if (!old || !same(old.deps, deps)) { const next = { deps }; slot.current = next; current.effects.push(() => { old?.cleanup?.(); next.cleanup = fn(); }); }
}
export const useImperativeHandle = () => {};
export const useSyncExternalStore = (_subscribe, snapshot) => snapshot();
export const jsx = (type, props) => ({ type, props });
export const jsxs = jsx;
export const Fragment = 'Fragment';
export const View = 'View', ScrollView = 'ScrollView', Pressable = 'Pressable', Modal = 'Modal', KeyboardAvoidingView = 'KeyboardAvoidingView', WebView = 'WebView';
export const Button = 'Button', Divider = 'Divider', IconButton = 'IconButton', Text = 'Text', TextField = 'TextField';
export const Bold = 'Bold', Heading = 'Heading', Italic = 'Italic', Link2 = 'Link2', List = 'List', ListOrdered = 'ListOrdered', Redo2 = 'Redo2', Underline = 'Underline', Undo2 = 'Undo2';
export const AccessibilityInfo = { announceForAccessibility: x => state.announcements.push(x) };
export const Keyboard = { dismiss() {}, addListener: () => ({ remove() {} }) };
export const AppState = { addListener: () => ({ remove() {} }) };
export const Platform = { OS: 'ios' }, PixelRatio = { getFontScale: () => 1 };
export const useWindowDimensions = () => ({ height: 800 });
export const useSafeAreaInsets = () => ({ top: 0, bottom: 0 });
export const colors = new Proxy({}, { get: () => '#112233' });
const theme = { colors, scheme: 'light' };
export const useTheme = () => theme;
export const haptics = { selection() {} };
export const cn = (...x) => x.filter(Boolean).join(' ');
const canvas = { account: { id: 'a', baseUrl: 'https://canvas.invalid' }, client: {} };
export const useCanvas = () => canvas;
export const isStoredAccountClient = () => true;
export const extractThemeFiles = html => ({ html, files: [] });
export const useSchoolTheme = () => ({ data: null });
export const useSchoolThemeEnabled = () => false;
export const useLaunchTool = () => async () => {};
export const useOnline = () => state.online;
const assets = {};
export const useLocalStore = () => assets;
export const assetIndex = {};
export function offlineAssetHtml(_id, base, html, _index, render) { state.assetReads++; return rewriteAssetHtml(html, base, () => null, render); }
export const parseRetrieveUrl = () => null;
export const openCanvasLink = () => {};
export const markSessionStarted = () => {}, SESSION_MAX_AGE = 600000, sessionIsFresh = () => true, sessionStartUrl = async () => null;
`;
try {
  await build({
    stdin: {
      contents: `
      export { RichEditor } from './src/features/editor/RichEditor';
      export { buildEditorDocument } from './src/features/editor/editorDocument';
      export { RichContent, buildDocument } from './src/features/content/RichContent';
      export * from './src/features/content/presentation';
      export * from './src/features/sync/assetHtml';
      export * from './src/i18n/runtime';
      export { en } from './src/i18n/en'; export { fr } from './src/i18n/fr'; export { ar } from './src/i18n/ar';
      export { harness, colors, state } from 'test-boundaries';
    `,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: resolve(output, 'check.mjs'),
    plugins: [
      {
        name: 'explicit-simulated-boundaries',
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(test-boundaries|react(?:\/jsx-runtime)?|react-native(?:-.*)?|lucide-react-native|@\/design|@\/lib\/cn|@\/canvas\/(api\/(brand|lti)|session)|@\/features\/(lti\/launch|offline\/(store|useOnline|schoolTheme)|sync\/assets|web\/session)|\.\/links)$/,
            },
            () => ({ path: 'mock', namespace: 'mock' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
            contents: mock,
            loader: 'js',
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  const api = await import(pathToFileURL(resolve(output, 'check.mjs')));
  const nodes = (tree) =>
    !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  const find = (tree, type) => nodes(tree).find((n) => n.type === type);
  const all = (tree, type) => nodes(tree).filter((n) => n.type === type);
  const message = (web, data) => web.props.onMessage({ nativeEvent: { data: JSON.stringify(data) } });
  const hostile = `"' & <tag>\n\u2028\u2029</script><script>throw 1</script>`;
  const userHtml = '<p>User draft Bold Open tool</p><p dir="ltr">Original العربية</p>';
  const props = Object.freeze({ value: userHtml, onChange: (value) => changes.push(value) });
  const changes = [],
    injections = [];
  api.setAccountLocale('a', 'en');
  const editor = api.harness(api.RichEditor, props);
  let tree = editor.render();
  let web = find(tree, 'WebView');
  web.props.ref.current = { injectJavaScript: (s) => injections.push(s) };
  const source = web.props.source;
  message(web, { type: 'ready' });
  editor.render();
  injections.length = 0;
  let sheetProps;
  for (const locale of ['en', 'fr', 'ar']) {
    api.setAccountLocale('a', locale);
    const t = api.createTranslator(locale);
    tree = editor.render();
    web = find(tree, 'WebView');
    assert.strictEqual(web.props.source, source, 'same editor source object across language changes');
    assert.equal(web.props.accessibilityLabel, t('editor.defaultLabel'));
    assert.equal(
      find(tree, 'ScrollView').props.accessibilityLabel,
      t('editor.formatting', { name: t('editor.defaultLabel') }),
    );
    const buttons = all(tree, 'IconButton');
    assert.deepEqual(
      buttons.map((b) => b.props.accessibilityLabel),
      ['bold', 'italic', 'underline', 'heading', 'bulleted', 'numbered', 'link', 'undo', 'redo'].map((k) =>
        t('editor.' + k),
      ),
    );
    assert.ok(
      injections.every((s) => s.includes('setPresentation')),
      'locale effects only update presentation',
    );
    injections.length = 0;
    buttons[0].props.onPress();
    assert.match(injections.pop(), /easel.exec\("bold"\)/);
    assert.equal(api.state.announcements.at(-1), t('editor.formatOn', { name: t('editor.bold') }));
    message(web, { type: 'link', text: 'User label', href: 'https://example.com/original' });
    tree = editor.render();
    sheetProps = nodes(tree).find((n) => n.type?.name === 'LinkSheet');
  }
  assert.deepEqual(changes, [], 'label changes do not emit onChange');
  // A pending parent echo must not clobber a newer unsaved draft on relabeling.
  message(web, { type: 'change', html: '<p>Unsaved latest draft</p>' });
  injections.length = 0;
  api.setAccountLocale('a', 'fr');
  editor.render();
  assert.deepEqual(changes, ['<p>Unsaved latest draft</p>']);
  assert.ok(injections.every((s) => s.includes('setPresentation')));
  const custom = editor.render({ ...props, label: hostile, placeholder: hostile, error: hostile });
  assert.equal(find(custom, 'WebView').props.accessibilityLabel, hostile);
  assert.ok(all(custom, 'Text').some((n) => n.props.children === hostile));
  assert.strictEqual(find(custom, 'WebView').props.source, source);

  // Keep one link form instance, including its invalid state, while switching languages.
  const applied = [];
  const link = Object.freeze({ text: hostile, href: 'not a valid address', editing: true });
  const sheet = api.harness(sheetProps.type, {
    link,
    onCancel() {},
    onApply: (...args) => applied.push(args),
  });
  let sheetTree = sheet.render();
  all(sheetTree, 'Button').at(-1).props.onPress();
  for (const locale of ['en', 'fr', 'ar']) {
    api.setAccountLocale('a', locale);
    const t = api.createTranslator(locale);
    sheetTree = sheet.render();
    const fields = all(sheetTree, 'TextField');
    assert.equal(fields[0].props.error, t('editor.linkInvalid'));
    assert.equal(fields[0].props.label, t('editor.webAddress'));
    assert.equal(fields[0].props.placeholder, t('editor.addressPlaceholder'));
    assert.equal(fields[1].props.label, t('editor.linkText'));
    assert.equal(fields[1].props.placeholder, t('editor.linkTextPlaceholder'));
    assert.equal(fields[1].props.value, hostile);
    for (const key of ['editLink', 'cancel', 'removeLink', 'save'])
      assert.ok(nodes(sheetTree).some((n) => n.props.children === t('editor.' + key)));
    assert.equal(all(sheetTree, 'Pressable')[0].props.accessibilityLabel, t('editor.close'));
  }
  for (const [input, expected] of [
    ['example.com/article', 'https://example.com/article'],
    ['mailto:me@example.com', 'mailto:me@example.com'],
    ['', ''],
  ]) {
    all(sheetTree, 'TextField')[0].props.onChangeText(input);
    sheetTree = sheet.render();
    all(sheetTree, 'Button').at(-1).props.onPress();
    assert.equal(applied.at(-1)[0], expected);
  }
  const beforeInvalid = applied.length;
  for (const input of ['javascript:alert(1)', 'https://bad host.com']) {
    all(sheetTree, 'TextField')[0].props.onChangeText(input);
    sheetTree = sheet.render();
    all(sheetTree, 'Button').at(-1).props.onPress();
  }
  assert.equal(applied.length, beforeInvalid);
  const addSheet = api.harness(sheetProps.type, {
    link: { text: '', href: '', editing: false },
    onCancel() {},
    onApply() {},
  });
  for (const locale of ['en', 'fr', 'ar']) {
    api.setAccountLocale('a', locale);
    assert.equal(
      all(addSheet.render(), 'Button').at(-1).props.children,
      api.createTranslator(locale)('editor.addLink'),
    );
  }

  // RichContent's memoized source and offline processing are independent of locale.
  const contentProps = Object.freeze({
    html: '<p dir="ltr">Open tool</p><iframe src="/courses/1/external_tools/retrieve" title="User tool"></iframe>',
  });
  const content = api.harness(api.RichContent, contentProps);
  let contentTree = content.render(),
    contentWeb = find(contentTree, 'WebView');
  const contentSource = contentWeb.props.source,
    reads = api.state.assetReads,
    contentInjections = [];
  contentWeb.props.ref({ injectJavaScript: (s) => contentInjections.push(s) });
  // A language change during load is applied by the latest load callback.
  api.setAccountLocale('a', 'fr');
  contentTree = content.render();
  message(find(contentTree, 'WebView'), { type: 'presentationReady' });
  assert.ok(contentInjections.at(-1).includes(api.fr['content.openTool']));
  api.setAccountLocale('a', 'ar');
  contentTree = content.render();
  assert.ok(
    contentInjections.at(-1).includes(api.ar['content.openTool']),
    'relabel after bridge ready while resources still load',
  );
  find(contentTree, 'WebView').props.onLoadEnd();
  assert.ok(contentInjections.at(-1).includes(api.ar['content.openTool']));
  for (const locale of ['en', 'fr', 'ar']) {
    api.setAccountLocale('a', locale);
    contentTree = content.render();
    assert.strictEqual(find(contentTree, 'WebView').props.source, contentSource);
    assert.equal(api.state.assetReads, reads, 'no rereading assets on locale changes');
    assert.ok(contentInjections.at(-1).includes(api[locale]['content.openTool']));
  }

  // Safe HTML attribute/text escaping and script serialization, including script terminators.
  const doc = api.buildEditorDocument({
    html: hostile,
    label: hostile,
    placeholder: hostile,
    editable: true,
    dark: false,
    theme: { colors: api.colors, fontScale: 1 },
    locale: hostile,
  });
  assert.equal((doc.match(/<script>/g) || []).length, 1);
  assert.equal((doc.match(/<\/script>/g) || []).length, 1);
  assert.ok(doc.includes('aria-label="' + api.escapePresentationHtml(hostile) + '"'));
  assert.equal(vm.runInNewContext(api.scriptJson(hostile)), hostile);
  assert.ok(!api.scriptJson(hostile).includes('\u2028'));
  assert.ok(!api.scriptJson(hostile).includes('</script>'));
  for (const locale of ['en', 'fr', 'ar']) {
    const label = api[locale]['editor.defaultLabel'];
    const localizedDoc = api.buildEditorDocument({
      html: userHtml,
      label,
      placeholder: '',
      editable: false,
      dark: false,
      theme: { colors: api.colors, fontScale: 1 },
      locale,
    });
    assert.ok(localizedDoc.includes('lang="' + locale + '"'));
    assert.ok(localizedDoc.includes('<title>' + api.escapePresentationHtml(label) + '</title>'));
    assert.match(localizedDoc, /<div id="editor" dir="auto"/,
      'draft direction is determined inside the editable area, independently of the translated title');
    assert.ok(localizedDoc.includes('contenteditable="false"'));
    assert.ok(localizedDoc.includes('data-placeholder=""'), 'empty default placeholder stays empty');
  }
  const base = 'https://canvas.invalid';
  const assetHtml =
    '<p>Embedded players and tools need an internet connection.</p><img src="/image" alt="User alt"><iframe title="User tool" src="/tool"></iframe>';
  for (const locale of ['en', 'fr', 'ar']) {
    const p = api.contentPresentation(api.createTranslator(locale), locale, locale === 'ar' ? 'rtl' : 'ltr');
    const result = api.rewriteAssetHtml(
      assetHtml,
      base,
      () => 'data:image/png;base64,AA==',
      (kind) => api.offlineNoticeHtml(kind, p),
    );
    assert.ok(result.includes(api.escapePresentationHtml(p.unsupported)));
    assert.ok(result.endsWith(assetHtml.replace('src="/image"', 'src="data:image/png;base64,AA=="')));
    const missing = api.rewriteAssetHtml(
      '<img src="/absent">',
      base,
      () => null,
      (kind) => api.offlineNoticeHtml(kind, p),
    );
    assert.ok(missing.includes(api.escapePresentationHtml(p.missing)));
  }
  assert.ok(api.rewriteAssetHtml(assetHtml, base, () => null).startsWith('<p role="note">Embedded players'));

  // Minimal simulated DOM: actual generated JS executes, but parsing, selection and
  // execCommand/undo are spies. We assert absence of edits and unchanged bridge commands.
  function element(tag, attrs = {}) {
    const el = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      attrs: { ...attrs },
      childNodes: [],
      listeners: {},
      style: {
        setProperty(k, v) {
          this[k] = v;
        },
      },
      textContent: '',
      htmlWrites: 0,
      attrWrites: [],
      getAttribute(k) {
        return this.attrs[k] ?? null;
      },
      hasAttribute(k) {
        return k in this.attrs;
      },
      setAttribute(k, v) {
        this.attrs[k] = v;
        this.attrWrites.push([k, v]);
      },
      removeAttribute(k) {
        delete this.attrs[k];
      },
      appendChild(n) {
        this.childNodes.push(n);
        n.parentNode = n.parentElement = this;
      },
      insertBefore(n) {
        this.childNodes.unshift(n);
        n.parentNode = n.parentElement = this;
      },
      addEventListener(k, f) {
        this.listeners[k] = f;
      },
      contains(n) {
        return n === this;
      },
      querySelector() {
        return null;
      },
      getBoundingClientRect: () => ({ height: 100 }),
      classList: { toggle() {} },
      focus() {},
      blur() {},
    };
    Object.defineProperty(el, 'innerHTML', {
      get: () => el.html ?? '',
      set(v) {
        el.html = v;
        el.htmlWrites++;
      },
    });
    return el;
  }
  const editEl = element('div', { dir: doc.match(/<div id="editor" dir="([^"]+)"/)[1] }),
    rootEl = element('html'),
    body = element('body');
  editEl.textContent = 'User draft';
  const commands = [],
    messages = [],
    selectionWrites = [],
    focusCalls = [];
  editEl.focus = () => focusCalls.push('focus');
  editEl.blur = () => focusCalls.push('blur');
  const range = {
    cloneRange() {
      return this;
    },
    selectNodeContents() {},
    collapse() {},
    selectNode() {},
  };
  const selection = {
    anchorNode: editEl,
    rangeCount: 1,
    getRangeAt: () => range,
    removeAllRanges() {
      selectionWrites.push('remove');
    },
    addRange(r) {
      selectionWrites.push(r);
    },
    toString: () => 'User selection',
  };
  const document = {
    documentElement: rootEl,
    body,
    activeElement: editEl,
    title: '',
    listeners: {},
    getElementById: () => editEl,
    execCommand: (...args) => commands.push(args),
    queryCommandState: () => false,
    queryCommandEnabled: () => true,
    queryCommandValue: () => '',
    createRange: () => range,
    addEventListener(k, f) {
      this.listeners[k] = f;
    },
  };
  const window = {
    ReactNativeWebView: { postMessage: (s) => messages.push(JSON.parse(s)) },
    getSelection: () => selection,
    addEventListener() {},
  };
  const context = vm.createContext({
    window,
    document,
    DOMParser: class {
      parseFromString(html) {
        return { body: { childNodes: [], innerHTML: html.slice(6, -7) } };
      }
    },
  });
  vm.runInContext(doc.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  window.easel.requestLink();
  const before = {
    html: editEl.innerHTML,
    writes: editEl.htmlWrites,
    commands: commands.length,
    messages: messages.length,
    selection: selectionWrites.length,
  };
  for (const locale of ['en', 'fr', 'ar']) {
    const p = {
      label: api[locale]['editor.defaultLabel'],
      placeholder: hostile,
      locale,
      direction: locale === 'ar' ? 'rtl' : 'ltr',
    };
    vm.runInContext(`window.easel.setPresentation(${api.scriptJson(p)})`, context);
    assert.equal(document.title, p.label);
    assert.equal(editEl.getAttribute('aria-label'), p.label);
    assert.equal(editEl.getAttribute('data-placeholder'), hostile);
    assert.equal(editEl.style['--placeholder-direction'], p.direction);
    assert.equal(editEl.getAttribute('dir'), 'auto', 'locale updates keep the draft direction automatic');
    assert.equal(editEl.innerHTML, before.html);
    assert.equal(editEl.htmlWrites, before.writes);
    assert.equal(commands.length, before.commands);
    assert.equal(messages.length, before.messages);
    assert.equal(selectionWrites.length, before.selection);
    assert.deepEqual(focusCalls, []);
    assert.equal(rootEl.dir, undefined, 'content direction not forced by UI language');
  }
  window.easel.applyLink('https://example.com', hostile);
  assert.equal(selectionWrites[1], range, 'saved selection reference survives relabeling');
  assert.deepEqual(commands.at(-1), [
    'insertHTML',
    false,
    '<a href="https://example.com">' +
      hostile.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') +
      '</a>',
  ]);
  window.easel.exec('undo');
  assert.deepEqual(commands.at(-1), ['undo', false, null]);
  window.easel.exec('redo');
  assert.deepEqual(commands.at(-1), ['redo', false, null]);
  window.easel.setEditable(false);
  assert.equal(editEl.attrs.contenteditable, 'false');
  assert.equal(editEl.attrs['aria-disabled'], 'true');
  assert.ok(editEl.listeners.paste && editEl.listeners.input && document.listeners.selectionchange);

  // Execute the full RichContent document script with fake existing iframe/media nodes.
  const iframe = element('iframe', {
    title: hostile,
    'data-easel-kind': 'lti',
    'data-easel-src': base + '/courses/1/external_tools/retrieve?display=borderless',
  });
  const unnamed = element('iframe', {
    'data-easel-kind': 'lti',
    'data-easel-src': base + '/courses/1/external_tools/retrieve?x=2',
  });
  const video = element('video', { src: 'data:video/mp4;base64,AA==' });
  const canvasText = element('p', { dir: 'ltr', 'data-easel-offline-notice': 'missing' });
  canvasText.textContent = 'Open tool';
  const contentBody = element('body');
  contentBody.appendChild(canvasText);
  contentBody.appendChild(iframe);
  contentBody.appendChild(unnamed);
  contentBody.appendChild(video);
  const created = [],
    posted = [];
  const contentDoc = {
    body: contentBody,
    createElement(tag) {
      const el = element(tag);
      created.push(el);
      return el;
    },
    querySelectorAll(selector) {
      return (
        {
          iframe: [iframe, unnamed],
          'iframe[data-easel-kind="lti"]': [iframe, unnamed],
          video: [video],
          '[data-easel-src]': [iframe, unnamed],
        }[selector] ?? []
      );
    },
  };
  const contentWindow = {
    ReactNativeWebView: { postMessage: (s) => posted.push(JSON.parse(s)) },
    addEventListener() {},
  };
  const contentContext = vm.createContext({ window: contentWindow, document: contentDoc, setTimeout() {} });
  const richDoc = api.buildDocument(
    contentProps.html,
    api.colors,
    false,
    1,
    'body',
    base,
    null,
    'unsupported',
  );
  assert.ok(richDoc.includes('<p dir="ltr">Open tool</p>'));
  assert.ok(richDoc.includes('data-easel-kind="lti"'));
  vm.runInContext(richDoc.match(/<script>([\s\S]*?)<\/script>/)[1], contentContext);
  const controls = created.filter((el) => el.tagName === 'BUTTON'),
    notice = created.find((el) => el.attrs.role === 'note');
  const writes = [iframe.attrWrites.length, unnamed.attrWrites.length, video.attrWrites.length];
  for (const locale of ['en', 'fr', 'ar']) {
    const p = api.contentPresentation(api.createTranslator(locale), locale, locale === 'ar' ? 'rtl' : 'ltr');
    vm.runInContext(api.contentPresentationScript(p), contentContext);
    assert.equal(
      controls[0].textContent,
      api.createTranslator(locale)('content.openNamedTool', { name: hostile }),
    );
    assert.equal(controls[1].textContent, p.openTool);
    assert.equal(notice.textContent, p.unsupported);
    assert.equal(canvasText.textContent, 'Open tool');
    assert.equal(canvasText.attrs.dir, 'ltr');
    assert.deepEqual([iframe.attrWrites.length, unnamed.attrWrites.length, video.attrWrites.length], writes);
    controls[0].listeners.click();
    const sent = posted.at(-1);
    assert.equal(sent.type, 'launch');
    assert.equal(sent.title, hostile);
    assert.equal(sent.url, iframe.attrs['data-easel-src']);
  }
  const hostilePresentation = {
    locale: hostile,
    direction: 'rtl',
    openTool: hostile,
    openNamedTool: hostile + '{name}',
    missing: hostile,
    unsupported: hostile,
  };
  const hostileScript = api.contentPresentationScript(hostilePresentation);
  assert.ok(!hostileScript.includes('</script>'));
  vm.runInContext(hostileScript, contentContext);
  assert.equal(controls[0].textContent, hostile + hostile);
  assert.equal(controls[1].textContent, hostile);
  assert.equal(notice.textContent, hostile);
  assert.ok(
    api.offlineNoticeHtml('missing', hostilePresentation).includes(api.escapePresentationHtml(hostile)),
  );
  assert.ok(!api.offlineNoticeHtml('missing', hostilePresentation).includes('<script>'));
  contentWindow.easelSession(null);
  assert.equal(iframe.attrs.src, base + '/courses/1/external_tools/retrieve?display=borderless');
  assert.equal(posted.filter((m) => m.type === 'session').length, 1, 'locale updates never start a session');
  assert.equal(posted.filter((m) => m.type === 'presentationReady').length, 1);
  const themedDoc = api.buildDocument(contentProps.html, api.colors, false, 1, 'body', base, {
    css: ['p { color: red !important; position: fixed; }'],
    js: [hostile],
  });
  assert.ok(themedDoc.includes('connect-src'));
  assert.ok(themedDoc.includes('color: red ; position: static;'));
  assert.ok(
    themedDoc.includes("'easelContentPresentation'].forEach"),
    'new bridge protected alongside session bridge',
  );
  assert.ok(Object.keys(api.en).length >= 730); // Later workstreams add catalog keys.
  for (const locale of ['fr', 'ar']) assert.deepEqual(Object.keys(api[locale]).sort(), Object.keys(api.en).sort());
  console.log(
    'PASS editor/content presentation, stable sources, locale-reactive controls/errors, escaping, structured offline notices, simulated DOM bridge/selection/commands/session invariants. Native/WebView/real DOM undo not verified.',
  );
} finally {
  rmSync(output, { recursive: true, force: true });
}
