/* global __dirname */
/** Fresh production transpilation. Hooks/effects/contexts/timers are simulated; native/design
 * elements are prop records. Editor/content/upload UI and query/cache/session are mocked.
 * Real mentions, file conversion, Intl, catalogs, CanvasError and discussion adapters execute.
 * Synthetic clients only; no network, React Compiler, native focus or WebView acceptance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..'), cache = new Map();
let scope, nextId = 0;
const calls = [], queries = [], alerts = [], timers = new Map();
const state = { users: { data: [] }, uploads: null, thread: null, host: null };
const react = {
  useState(initial) { const s = scope, i = s.cursor++; if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial; return [s.slots[i], v => { s.slots[i] = typeof v === 'function' ? v(s.slots[i]) : v; }]; },
  useRef(value) { return react.useState(() => ({ current: value }))[0]; },
  useMemo(fn, deps) { const r = react.useRef(); if (!r.current || deps.some((d, i) => !Object.is(d, r.current.deps[i]))) r.current = { deps, value: fn() }; return r.current.value; },
  useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
  useEffect(fn, deps) { const r = react.useRef(); if (!r.current || !deps || deps.some((d, i) => !Object.is(d, r.current.deps?.[i]))) { scope.effects.push(() => { r.current?.cleanup?.(); r.current = { deps, cleanup: fn() }; }); } },
  useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
  useId() { return react.useState(() => `owner-${++nextId}`)[0]; },
  createContext() { return { index: nextId++ }; },
  use(ctx) { return ctx.index === 0 ? state.host : state.thread; },
};
const jsx = (type, props, key) => ({ type, props, key });
const queryClient = new Proxy({}, { get: (_o, k) => (...args) => calls.push([k, ...args]) });
const mock = {
  'expo-router': { useIsFocused: () => true },
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': new Proxy({ Alert: { alert: (...args) => alerts.push(args) } }, { get: (o, k) => o[k] ?? k }),
  'lucide-react-native': new Proxy({}, { get: (_o, k) => k }),
  '@tanstack/react-query': { useQueryClient: () => queryClient },
  '@/canvas/query': { useAccountKey: () => 'account', useCanvasQuery: (...args) => { queries.push(args); return state.users; }, useCanvasMutation: (fn, options) => ({ run: fn, options }) },
  '@/canvas/session': { useCanvas: () => ({ account: { id: 'account', user: { id: 'self' } } }) },
  '@/design': new Proxy({ useTheme: () => ({ colors: { accentFg: 'accent' } }) }, { get: (o, k) => o[k] ?? k }),
  '@/features/content/RichContent': { RichContent: 'RichContent' },
  '@/features/editor/RichEditor': { RichEditor: 'RichEditor' },
  '@/features/files/AttachmentList': { AttachmentList: 'AttachmentList' },
  '@/features/inbox/OptionsSheet': { OptionsSheet: 'OptionsSheet' },
  '@/features/inbox/attachments': { AttachButton: 'AttachButton', AttachmentStatus: 'AttachmentStatus', PendingAttachmentList: 'PendingAttachmentList', useAttachmentUploads: options => { const { owner, ...legacy } = options; assert.deepEqual(legacy, { folderPath: 'unfiled', max: 1 }); assert.equal(typeof owner.resource, 'string'); assert.equal(owner.focused, true); assert.equal(typeof owner.eligible, 'boolean'); return state.uploads; } },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.') ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name)) : name;
  if (mock[key]) return mock[key];
  if (!key.startsWith('@/')) return require(key);
  const file = ['.ts', '.tsx', '/index.ts'].map(ext => path.join(root, key.slice(2)) + ext).find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  let source = fs.readFileSync(file, 'utf8');
  if (key === '@/features/discussions/Thread') source += '\nexport { Entry, ActionButton, MentionSuggestions };';
  const js = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', js)(n => load(n, file), module, module.exports, fn => { const id = ++nextId; timers.set(id, fn); return id; }, id => timers.delete(id));
  return module.exports;
}
function harness(fn) {
  const s = { slots: [], cursor: 0, effects: [] };
  const render = props => { scope = s; s.cursor = 0; s.effects = []; try { const tree = fn(props); s.effects.forEach(effect => effect()); return tree; } finally { scope = null; } };
  render.unmount = () => s.slots.forEach(slot => slot?.current?.cleanup?.());
  return render;
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, type, test = () => true) => nodes(tree).find(n => n.type === type && test(n.props))?.props;
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const i18n = load('@/i18n/runtime'), dates = load('@/lib/dates');
const ui = load('@/features/discussions/Thread'), api = load('@/canvas/api/discussions');
const { CanvasError } = load('@/canvas/client');
const { entryAuthorName, discussionErrorMessage } = load('@/features/discussions/threadPresentation');
const presentation = load('@/features/discussions/presentation').discussionPresentation;
const mentions = load('@/features/discussions/mentions');
const view = (locale, zone = 'UTC') => { i18n.setAccountLocale('account', locale); dates.setDisplayTimeZone(zone); return i18n.createTranslator(locale); };
const now = new Date('2026-01-01T08:15:00Z'), createdAt = new Date('2025-12-20T00:30:00Z');
const entry = (id, props = {}) => ({ id, parentId: null, author: { id: 'person', name: 'Unknown', avatarUrl: null }, html: '<p>needle</p>', createdAt, updatedAt: createdAt, edited: true, deleted: false, unread: false, likes: 3, liked: false, mine: false, anonymous: false, attachments: [], replies: [], ...props });
const context = { type: 'course', id: 'c /' };
state.thread = { context, topicId: 't /', courseId: 'c /', userId: 'self', now, target: null, canReply: true, threaded: true, canLike: true, canAttach: true, canManage: () => true, canPostAnonymously: true, fullyAnonymous: false, submitting: false, error: null, ...Object.fromEntries(['setTarget','reply','edit','remove','like','markUnread','registerUnread','onLayoutChange'].map(k => [k, (...args) => calls.push([k, ...args])])) };
function uploads(files = []) { return { files, uploading: false, failed: false, seed: files => { calls.push(['seed', files]); state.uploads.files = files; } }; }
const attachment = { id: 'file /', display_name: 'Unknown', filename: 'raw.png', 'content-type': 'image/png', url: 'https://example.invalid/raw', size: 3, thumbnail_url: null };
(async () => {
  const catalogs = ['en','fr','ar'].map(lang => load(`@/i18n/${lang}`)[lang]);
  assert.ok(Object.keys(catalogs[0]).length >= 1359);
  const slots = value => [...new Set(JSON.stringify(value).match(/\{\w+\}/g) ?? [])].sort();
  for (const catalog of catalogs.slice(1)) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(catalogs[0]).sort());
    for (const key of Object.keys(catalog)) assert.deepEqual(slots(catalog[key]), slots(catalogs[0][key]), key);
  }
  // Optional baseline is captured before this implementation; portable checks do not require /tmp.
  const baseline = process.env.DISCUSSION_THREAD_BASELINE;
  if (baseline) for (const [i, lang] of ['en','fr','ar'].entries()) {
    const module = { exports: {} };
    new Function('exports', ts.transpileModule(fs.readFileSync(path.join(baseline, `${lang}.ts`), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(module.exports);
    for (const [key, value] of Object.entries(module.exports[lang])) assert.deepEqual(catalogs[i][key], value, `baseline ${lang}/${key}`);
  }
  const parent = entry('p', { anonymous: true, author: { id: 'anonymous_p', name: 'Anonymous 4f', avatarUrl: null }, authorNameOrigin: { kind: 'anonymous', token: '4f' }, replies: [entry('child')] });
  const renderEntry = harness(ui.Entry), renderSearch = harness(ui.SearchResults);
  for (const locale of ['en','fr','ar']) for (const zone of ['UTC','America/Los_Angeles','Asia/Tokyo']) {
    const t = view(locale, zone), p = presentation(locale, zone), before = calls.length;
    const author = entryAuthorName(parent, t);
    let tree = renderEntry({ entry: parent, depth: 4, parentAuthor: 'Raw parent' });
    assert.equal(find(tree, 'Avatar').name, author);
    assert.ok(text(tree).includes(t('discussionThread.editedAge', { age: p.dates.relativeAge(createdAt, now) })));
    const header = nodes(tree).find(n => n.props?.accessible && n.props?.accessibilityLabel)?.props;
    assert.ok(header.accessibilityLabel.includes(author)); assert.ok(header.accessibilityLabel.includes(p.ageLabel(createdAt, now)));
    assert.equal(find(tree, ui.Entry).parentAuthor, author);
    tree = renderSearch({ results: ui.searchEntries([parent], ' needle '), term: ' needle ' });
    assert.equal(find(tree, ui.Entry, p => p.entry.id === 'child').parentAuthor, author);
    assert.ok(text(tree).includes(t('discussionThread.matches', { count: 2, number: p.number(2), term: 'needle' })));
    assert.equal(calls.length, before, 'locale/zone rendering causes no writes, reads, navigation or refetches');
    assert.equal(ui.searchEntries([parent], author, e => entryAuthorName(e, t))[0]?.entry.id, parent.id, 'search matches the displayed generated author');
    assert.equal(ui.searchEntries([parent], author.replace(/[\u2068\u2069]/g, ''), e => entryAuthorName(e, t))[0]?.entry.id, parent.id, 'students do not need to type interpolation isolation controls');
    assert.equal(ui.searchEntries([parent], 'Anonymous 4f', e => entryAuthorName(e, t))[0]?.entry.id, parent.id, 'raw author search remains compatible');
    assert.deepEqual(ui.searchEntries([parent], 'needle', e => entryAuthorName(e, t)), ui.searchEntries([parent], 'needle'));
    assert.equal(p.number(3.9999), new Intl.NumberFormat(locale, { maximumSignificantDigits: 21 }).format(3.9999));
    assert.notEqual(p.number(3.9999), p.number(4)); assert.notEqual(p.number(1e-21), p.number(0));
    assert.equal(p.dates.relativeAge(createdAt, now), new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, month: 'short', day: 'numeric' }).format(createdAt));
    assert.equal(p.ageLabel(createdAt, now), new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, year: 'numeric', month: 'short', day: 'numeric' }).format(createdAt));
    for (const minutes of [0, 1, 59, 60, 1439, 1440, 10079]) {
      const date = new Date(now - minutes * 60000);
      const [n, unit] = minutes < 60 ? [minutes, 'minute'] : minutes < 1440 ? [Math.floor(minutes / 60), 'hour'] : [Math.floor(minutes / 1440), 'day'];
      assert.equal(p.ageLabel(date, now), minutes === 0 ? t('date.now') : new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-n, unit));
    }
    for (const name of ['', 'Unknown', 'Anonymous', 'Anonymous 4f', 'Anonymous (you)']) for (const origin of [undefined, { kind: 'future' }, { kind: 'anonymous', token: 42 }]) {
      assert.equal(entryAuthorName({ author: { name }, authorNameOrigin: origin }, t), name);
    }
    assert.equal(entryAuthorName({ author: null }, t), t('discussionThread.unknown'));
    assert.equal(entryAuthorName({ author: { name: 'Unknown' }, authorNameOrigin: { kind: 'unknown' } }, t), t('discussionThread.unknown'));
    assert.equal(entryAuthorName({ ...parent, authorNameOrigin: { kind: 'anonymous', token: 'current_user' } }, t), t('discussionThread.anonymousYou'));
    for (const count of [0,1,2,3,11,100]) {
      const e = entry('count', { likes: count, replies: Array.from({ length: count }, (_, i) => entry(String(i))) });
      tree = renderEntry({ entry: e, depth: 0 });
      const like = find(tree, ui.ActionButton, p => p.icon === 'ThumbsUp');
      assert.equal(like.label, count ? p.number(count) : undefined);
      const category = new Intl.PluralRules(locale).select(count), message = catalogs[['en','fr','ar'].indexOf(locale)]['discussionThread.likes'];
      const expected = t('discussionThread.likes', p.countParams(count));
      assert.equal(expected.replace(/[\u2068\u2069]/g, ''), (message[category] ?? message.other).replace('{number}', p.number(count)));
      assert.equal(like.accessibilityLabel, t('discussionThread.like', { likes: expected }));
      if (count) {
        const collapse = find(tree, ui.ActionButton, p => p.expanded !== undefined);
        assert.equal(collapse.label, p.replies(count));
        assert.equal(collapse.accessibilityLabel, t(collapse.expanded ? 'discussionThread.hideReplies' : 'discussionThread.showReplies', { ...p.countParams(count), name: e.author.name }));
      }
      const matching = Array.from({ length: count }, (_, i) => ({ entry: entry(String(i)), parentAuthor: null }));
      const search = renderSearch({ results: matching, term: ' Raw term ' });
      assert.ok(text(search).includes(count ? t('discussionThread.matches', { ...p.countParams(count), term: 'Raw term' }) : t('discussionThread.noMatches', { term: 'Raw term' })));
      state.thread.canLike = false;
      tree = renderEntry({ entry: e, depth: 0 });
      if (count) assert.ok(nodes(tree).some(n => n.props?.accessibilityLabel === expected));
      state.thread.canLike = true;
    }
  }
  // Deleted parents never leak a reply-to name; traversal and newest-first ordering stay compatible.
  const deleted = entry('deleted', { deleted: true, replies: [entry('after', { createdAt: now })] });
  const results = ui.searchEntries([parent, deleted], 'needle');
  assert.equal(results[0].entry.id, 'after'); assert.equal(results[0].parentAuthor, null); assert.equal(results[0].parentAuthorOrigin, undefined);
  assert.deepEqual(ui.searchEntries([parent], '  '), []);
  assert.equal(ui.searchEntries([entry('legacy')], 'unknown')[0].entry.id, 'legacy');
  // Native text vs HTML and actual mention markup decisions are unchanged.
  assert.equal(ui.EntryBody({ html: '<table><tr><td>raw</td></tr></table>' }).type, 'RichContent');
  assert.equal(ui.EntryBody({ html: '<p style="color:red">raw</p>' }).type, 'RichContent');
  const mentionHtml = mentions.applyMentions('<p>@Raw Name</p>', [{ id: 'self', name: 'Raw Name' }]);
  assert.ok(text(ui.EntryBody({ html: mentionHtml, userId: 'self' })).includes('@Raw Name'));
  assert.ok(nodes(ui.EntryBody({ html: mentionHtml, userId: 'self' })).some(n => n.props?.className === 'bg-accent-soft'));
  // An open menu and expanded chain keep local state while callbacks retain exact IDs.
  const own = entry('own /', { mine: true, unread: true, replies: [entry('nested')] }), menu = harness(ui.Entry);
  view('en'); let tree = menu({ entry: own, depth: 2 });
  assert.equal(find(tree, ui.ActionButton, p => p.expanded !== undefined).expanded, false);
  find(tree, ui.ActionButton, p => p.expanded !== undefined).onPress();
  find(tree, 'IconButton').onPress();
  for (const locale of ['en','fr','ar']) {
    const t = view(locale), before = calls.length;
    tree = menu({ entry: own, depth: 2 });
    assert.equal(calls.length, before); assert.equal(find(tree, 'OptionsSheet').visible, true);
    assert.equal(find(tree, ui.ActionButton, p => p.expanded !== undefined).expanded, true);
    const options = find(tree, 'OptionsSheet').options;
    assert.deepEqual(options.map(o => o.key), ['edit','delete']);
    assert.equal(options[0].label, t('discussionThread.editReply'));
    options[0].onPress(); assert.deepEqual(calls.at(-1), ['setTarget', { kind: 'edit', entryId: own.id }]);
    options[1].onPress(); const alert = alerts.at(-1);
    assert.equal(alert[0], t('discussionThread.deleteTitle')); assert.equal(alert[1], t('discussionThread.deleteBody'));
    assert.deepEqual(alert[2].map(b => [b.text,b.style]), [[t('common.cancel'),'cancel'],[t('discussionThread.delete'),'destructive']]);
    alert[2][1].onPress(); assert.deepEqual(calls.at(-1), ['remove', own.id]);
    find(tree, ui.ActionButton, p => p.icon === 'Reply').onPress(); assert.deepEqual(calls.at(-1), ['setTarget', { kind: 'reply', parentId: own.id }]);
    find(tree, ui.ActionButton, p => p.icon === 'ThumbsUp').onPress(); assert.deepEqual(calls.at(-1), ['like', own.id, true]);
    assert.ok(nodes(tree).some(n => n.props?.accessibilityLabel?.includes(t('discussionThread.you', { name: 'Unknown' }))));
    state.thread.target = { kind: 'edit', entryId: own.id };
    tree = menu({ entry: own, depth: 2 }); let c = find(tree, ui.Composer);
    assert.equal(c.initialHtml, own.html); assert.equal(c.initialAttachments, own.attachments); assert.equal(c.label, t('discussionThread.editYourReply'));
    c.onSubmit({ html: 'raw' }); assert.deepEqual(calls.at(-1), ['edit', own.id, { html: 'raw' }]);
    c.onCancel(); assert.deepEqual(calls.at(-1), ['setTarget', null]);
    state.thread.target = { kind: 'reply', parentId: parent.id };
    tree = menu({ entry: parent, depth: 4 }); c = find(tree, ui.Composer);
    assert.equal(c.initialMention, undefined); assert.equal(c.label, t('discussionThread.replyTo', { name: entryAuthorName(parent,t) }));
    c.onSubmit({ html: 'raw' }); assert.deepEqual(calls.at(-1), ['reply', parent.id, { html: 'raw' }]);
    state.thread.target = { kind: 'reply', parentId: 'other' };
    tree = menu({ entry: entry('other'), depth: 4 });
    assert.deepEqual(find(tree, ui.Composer).initialMention, { id: 'person', name: 'Unknown' });
    find(tree, 'OptionsSheet').options[0].onPress(); assert.deepEqual(calls.at(-1), ['markUnread', 'other']);
    state.thread.target = null;
    tree = menu({ entry: deleted, depth: 0 }); assert.equal(find(tree,'Avatar'), undefined); assert.ok(text(tree).includes(t('discussionThread.deleted')));
  }
  // Suggestions: real debounce effect (synthetic timers), raw names/pronouns/query and exclusions.
  const suggestions = harness(ui.MentionSuggestions);
  const suggestionProps = { context, topicId: 't /', query: 'Raw', exclude: ['excluded'], onPick: user => calls.push(['pick', user]) };
  const users = [{ id: 'excluded', name: 'exclude', shortName: 'e' }, ...Array.from({ length: 7 }, (_, i) => ({ id: String(i), name: `Raw ${i}`, shortName: `Short ${i}`, pronouns: 'they/iel' }))];
  for (const locale of ['en','fr','ar']) {
    const t = view(locale), p = presentation(locale, 'UTC');
    state.users = { data: users };
    tree = suggestions(suggestionProps);
    assert.deepEqual(queries.at(-1)[0], ['discussion', 'c /', 't /', 'mentionable', 'Raw']);
    assert.equal(queries.at(-1)[2].enabled, true);
    assert.equal(tree.props.accessibilityLabel, t('discussionThread.mentionPeople'));
    assert.ok(text(tree).includes(t('discussionThread.peopleFound', p.countParams(5))));
    const options = nodes(tree).filter(n => n.type === 'Pressable'); assert.equal(options.length, 5);
    assert.equal(options[0].props.accessibilityLabel, t('discussionThread.mention', { name: 'Raw 0' }));
    assert.ok(text(tree).includes('they/iel')); options[0].props.onPress(); assert.deepEqual(calls.at(-1), ['pick', users[1]]);
    state.users = { isError: true }; assert.ok(text(suggestions(suggestionProps)).includes(t('discussionThread.mentionError')));
    state.users = { isPending: true }; assert.ok(find(suggestions(suggestionProps), 'Skeleton'));
    state.users = { data: [] }; assert.ok(text(suggestions(suggestionProps)).includes(t('discussionThread.mentionNoMatches', { term: 'Raw' })));
    assert.ok(text(harness(ui.MentionSuggestions)({ ...suggestionProps, query: '' })).includes(t('discussionThread.mentionEmpty')));
    assert.ok(text(harness(ui.MentionHint)()).includes(t('discussionThread.mentionHint')));
  }
  // Same focused composer retains draft, in-progress mention, uploads, anonymity and header owner.
  const hostRender = harness(ui.useComposerActionHost); let host = hostRender(); state.host = host.host;
  const composer = harness(ui.Composer);
  state.uploads = uploads();
  const props = { context, topicId: 't /', label: 'label', placeholder: 'placeholder', submitLabel: 'Post reply', initialHtml: '<p>Draft</p>', initialAttachments: [attachment], canAttach: true, canPostAnonymously: true, submitting: false, onSubmit: draft => calls.push(['submit', draft]), onCancel: () => calls.push(['cancel']), scrollViewRef: { current: null } };
  view('en'); tree = composer(props); assert.equal(calls.filter(c => c[0] === 'seed').length, 1);
  find(tree, 'RichEditor').onFocus(); find(tree, 'ListItem').onPress();
  find(tree, 'RichEditor').onChange('<p>Draft @Ra</p>');
  const originalFile = state.uploads.files[0], target = state.thread.target;
  for (const locale of ['fr','ar','en']) {
    const t = view(locale), before = calls.length;
    tree = composer({ ...props, label: t('discussionDetail.yourReply'), placeholder: t('discussionDetail.writeReply'), submitLabel: t('discussionDetail.postReply') });
    assert.equal(find(tree, 'RichEditor').value, '<p>Draft @Ra</p>');
    assert.equal(find(tree, ui.MentionSuggestions).query, 'Ra');
    assert.equal(find(find(tree, 'ListItem').trailing, 'Switch').value, true); assert.equal(state.uploads.files[0], originalFile);
    assert.equal(state.thread.target, target); assert.equal(calls.length, before);
    assert.equal(find(tree,'AttachButton').label, t('discussions.attach'));
    assert.equal(find(tree,'RichEditor').scrollViewRef, props.scrollViewRef);
    host = hostRender(); assert.equal(host.host, state.host); assert.equal(host.action.label, t('discussionDetail.postReply'));
    assert.equal(host.action.disabled, false); assert.equal(host.action.loading, false);
    assert.equal(text(ui.ComposerHeaderButton({ action: host.action })), t('discussionDetail.postReply'));
  }
  find(tree, ui.MentionSuggestions).onPick({ id: 'user /', shortName: 'Raw Name', name: 'Supplied Name' });
  tree = composer(props); assert.equal(find(tree, ui.MentionSuggestions), undefined);
  const draftHtml = find(tree, 'RichEditor').value;
  for (const locale of ['fr','ar']) {
    view(locale); tree = composer(props); assert.equal(find(tree, 'RichEditor').value, draftHtml);
    hostRender().action.submit();
    const submitted = calls.at(-1)[1];
    assert.deepEqual(submitted, { html: mentions.applyMentions(draftHtml, [{ id: 'user /', name: 'Raw Name' }]), fileId: null, removeAttachment: false, attachments: [attachment], anonymous: true });
  }
  // Upload and pending guards at both button boundaries. Button's disabled/loading behavior is mocked.
  for (const flags of [{ uploading: true }, { failed: true }, { submitting: true }]) {
    Object.assign(state.uploads, { uploading: false, failed: false }, flags);
    tree = composer({ ...props, submitting: !!flags.submitting });
    const action = hostRender().action, button = find(tree, 'Button', p => p.variant !== 'ghost');
    assert.equal(button.disabled, !!(flags.uploading || flags.failed)); assert.equal(action.disabled, button.disabled);
    assert.equal(button.loading, !!flags.submitting); assert.equal(action.loading, button.loading);
    assert.equal(find(tree,'RichEditor').editable, !flags.submitting);
    const before = calls.length;
    action.submit(); button.onPress();
    assert.equal(calls.length, before, 'blocked composer callbacks do not submit');
  }
  Object.assign(state.uploads, { uploading: false, failed: false });
  find(tree, 'RichEditor').onChange('<p><br></p>'); tree = composer(props);
  assert.equal(hostRender().action.disabled, true); assert.equal(find(tree,'Button',p => p.variant !== 'ghost').disabled, true);
  const beforeEmpty = calls.length;
  hostRender().action.submit(); find(tree, 'Button', p => p.variant !== 'ghost').onPress();
  assert.equal(calls.length, beforeEmpty, 'empty composer callbacks do not submit');
  find(tree, 'RichEditor').onChange(draftHtml); state.uploads.files = [];
  tree = composer(props); hostRender().action.submit();
  assert.equal(calls.at(-1)[1].removeAttachment, true); assert.equal(calls.at(-1)[1].fileId, null);
  state.uploads.files = [{ ...originalFile, id: 'replacement /' }];
  tree = composer(props); hostRender().action.submit(); assert.equal(calls.at(-1)[1].fileId, 'replacement /');
  tree = composer({ ...props, canPostAnonymously: false, fullyAnonymous: true }); hostRender().action.submit();
  assert.equal(calls.at(-1)[1].anonymous, false); assert.ok(text(tree).includes(view('ar')('discussionThread.anonymousDiscussion')));
  assert.equal(calls.filter(c => c[0] === 'seed').length, 1);
  find(tree,'Button',p => p.variant === 'ghost').onPress(); assert.deepEqual(calls.at(-1), ['cancel']);
  // A stale owner's blur/unmount must not clear another focused composer's header.
  const second = harness(ui.Composer); tree = second({ ...props, initialAttachments: [] }); find(tree,'RichEditor').onFocus(); second({ ...props, initialAttachments: [], submitLabel: 'Second' });
  assert.equal(hostRender().action.label, 'Second'); composer.unmount(); assert.equal(hostRender().action.label, 'Second');
  tree = second({ ...props, initialAttachments: [], submitLabel: 'Second' }); find(tree,'RichEditor').onBlur(); second({ ...props, initialAttachments: [] }); assert.equal(hostRender().action, null);
  // Seeded initial mention survives locale changes, without regenerating editor content.
  state.host = null; state.uploads = uploads(); const seeded = harness(ui.Composer);
  const seededProps = { ...props, initialHtml: undefined, initialAttachments: [], initialMention: { id: 'raw /', name: 'Raw <Name' } };
  tree = seeded(seededProps); const initialValue = find(tree,'RichEditor').value;
  for (const locale of ['en','fr','ar']) { view(locale); tree = seeded(seededProps); assert.equal(find(tree,'RichEditor').value, initialValue); }
  // Production REST and GraphQL adapters: tag only the exact generated branches.
  const stamp = '2026-01-01T00:30:00Z';
  const raw = { id: 'e', user_id: 'self', created_at: stamp, updated_at: stamp };
  const rest = async (rawEntry, participants = []) => api.fetchDiscussionThread({ get: async () => ({ participants, unread_entries: [], entry_ratings: {}, view: [rawEntry] }) }, context, 't', 'self', false);
  assert.deepEqual((await rest(raw)).entries[0].authorNameOrigin, { kind: 'unknown' });
  for (const name of ['', 'Unknown', 'Anonymous', 'Anonymous 4f']) {
    const e = (await rest({ ...raw, user_name: name })).entries[0]; assert.equal(e.author.name,name); assert.equal(e.authorNameOrigin,undefined); assert.equal(e.mine,true);
    const fromPerson = (await rest(raw,[{ id:'self',display_name:name }])).entries[0]; assert.equal(fromPerson.author.name,name); assert.equal(fromPerson.authorNameOrigin,undefined);
  }
  assert.equal((await rest({ ...raw,user_id:null })).entries[0].author,null);
  const gql = async nodes => api.fetchDiscussionThread({ request: async () => ({ data: { legacyNode: { discussionEntriesConnection: { nodes } } } }) },context,'t','self',true);
  for (const token of ['4f','current_user']) {
    const e = (await gql([{ _id:'a',createdAt:stamp,anonymousAuthor:{ id:'pseudonym',shortName:token,avatarUrl:'hidden-avatar' } }])).entries[0];
    assert.equal(e.author.id,'anonymous_pseudonym'); assert.equal(e.author.avatarUrl,null); assert.equal(e.author.name,api.anonymousName(token)); assert.equal(e.mine,token === 'current_user');
    assert.equal(e.anonymous,true); assert.deepEqual(e.authorNameOrigin,{ kind:'anonymous',token });
    for (const locale of ['en','fr','ar']) {
      const t = view(locale); assert.equal(entryAuthorName(e,t),token === 'current_user' ? t('discussionThread.anonymousYou') : t('discussionThread.anonymousToken',{token}));
      const headerTree = harness(ui.Entry)({ entry:e,depth:0 });
      assert.equal(find(headerTree,'Avatar').uri,null); assert.ok(!JSON.stringify(headerTree).includes('hidden-avatar'));
    }
    assert.deepEqual(JSON.parse(JSON.stringify(e.authorNameOrigin)),e.authorNameOrigin);
  }
  for (const name of [null,'','Unknown','Anonymous']) {
    const e = (await gql([{ _id:'a',createdAt:stamp,author:{_id:'self',name},anonymousAuthor:{id:'hidden',shortName:'hidden'} }])).entries[0];
    assert.equal(e.author.name,name ?? 'Unknown'); assert.equal(e.anonymous,false); assert.equal(e.mine,true);
    assert.deepEqual(e.authorNameOrigin,name == null ? { kind:'unknown' } : undefined); assert.ok(!JSON.stringify(e).includes('hidden'));
  }
  // Explicit local missing-data and missing-create-ID errors vs same-text server/legacy/unknown origins.
  const errorFrom = async fn => { try { await fn(); assert.fail('expected rejection'); } catch(e) { assert.ok(e instanceof CanvasError); return e; } };
  const client = response => ({ request: async (...args) => { calls.push(['request',...args]); return response; } });
  const local = await errorFrom(() => api.graphql(client({}), 'Test','query',{}));
  const sameText = 'Canvas didn’t answer. Try again.';
  const server = await errorFrom(() => api.graphql(client({errors:[{message:sameText}]}),'Test','query',{}));
  const creation = api.useCreateTopic();
  const newTopic = { context,title:'Raw',html:'<p>raw</p>',fileId:'f /',threaded:true,requireInitialPost:false,allowRating:true };
  const absentId = await errorFrom(() => creation.run(client({data:{createDiscussionTopic:{discussionTopic:null}}}),newTopic));
  assert.deepEqual(calls.at(-1)[2].body.variables,{contextId:'c /',contextType:'Course',title:'Raw',message:'<p>raw</p>',fileId:'f /',discussionType:'threaded',requireInitialPost:false,allowRating:true});
  for (const e of [local,absentId,server]) { assert.equal(e.status,400); assert.equal(e.path,'/api/graphql'); assert.equal(e.message,sameText); }
  for (const locale of ['en','fr','ar']) {
    const t = view(locale); assert.equal(discussionErrorMessage(local,t),t('discussionThread.noResponse')); assert.equal(discussionErrorMessage(absentId,t),t('discussionThread.noResponse'));
    for (const e of [server,new Error(sameText),new CanvasError(sameText,400,'/api/graphql'),Object.assign(new CanvasError(sameText,400,'/api/graphql'),{reason:'future'})]) assert.equal(discussionErrorMessage(e,t),sameText);
    assert.equal(discussionErrorMessage(null,t),null);
  }
  for (const message of ['constructor','toString','__proto__','Unknown server detail']) {
    const e = await errorFrom(() => api.graphql(client({errors:[{message}]}),'Test','query',{})); assert.equal(e.message,message); assert.equal(e.reason,undefined);
  }
  for (const [message, expected] of Object.entries({'Insufficient Permissions':'You can’t do that in this discussion.','Insufficient attach permissions':'This discussion doesn’t take attachments.','not found':'This post no longer exists. Pull to refresh the discussion.'})) {
    const e = await errorFrom(() => api.graphql(client({errors:[{message}]}),'Test','query',{})); assert.equal(e.message,expected);
  }
  // Exact production mutation request payloads; query cache/network implementation remains mocked.
  await api.usePostEntry().run(client({data:{createDiscussionEntry:{discussionEntry:{_id:'new'}}}}),{context,topicId:'t /',parentId:'parent /',html:mentionHtml,fileId:'file /',anonymous:true});
  assert.deepEqual(calls.at(-1)[2].body.variables,{topicId:'t /',message:mentionHtml,parentId:'parent /',fileId:'file /',anonymous:true});
  await api.useUpdateEntry().run(client({data:{updateDiscussionEntry:{discussionEntry:{_id:'e'}}}}),{context,topicId:'t /',entryId:'e /',html:'raw',removeAttachment:true,attachments:[]});
  assert.deepEqual(calls.at(-1)[2].body.variables,{entryId:'e /',message:'raw',fileId:null,removeAttachment:true});
  console.log(`Discussion thread: ${Object.keys(catalogs[0]).length} keys, en/fr/ar × scoped zones, host TZ=${process.env.TZ}; production helpers/components/adapters passed (simulated boundaries).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
