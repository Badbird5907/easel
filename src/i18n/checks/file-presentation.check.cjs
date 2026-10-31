const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
/** Freshly transpiled production classification, presentation, adapter and rows.
 * Stateful hook simulation; native/design/thumbnail nodes are prop records.
 * Client/query and openFile boundaries are explicit mocks. No native rendering,
 * React Compiler scheduling, network or actual file opening is exercised. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..'), cache = new Map();
let scope;
const calls = [];
const react = {
  useState(initial) { const s = scope, i = s.cursor++; if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial; return [s.slots[i], v => { s.slots[i] = typeof v === 'function' ? v(s.slots[i]) : v; }]; },
  useRef(v) { return react.useState(() => ({ current: v }))[0]; },
  useMemo(fn, deps) { const r = react.useRef(); if (!r.current || deps.some((v, i) => !Object.is(v, r.current.deps[i]))) r.current = { deps, value: fn() }; return r.current.value; },
  useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
};
const jsx = (type, props, key) => ({ type, props, key });
const mock = {
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': new Proxy({}, { get: (_o, k) => k }),
  'lucide-react-native': new Proxy({}, { get: (_o, k) => k }),
  '@/canvas/client': { CanvasError: class extends Error {}, CanvasAuthError: class extends Error {} },
  '@/canvas/query': { useCanvasQuery: () => { throw Error('unexpected query'); } },
  '@/design': new Proxy({}, { get: (_o, k) => k }),
  '@/features/files/FileThumbnail': { FileThumbnail: 'FileThumbnail' },
  '@/features/files/open': { openFile: (...args) => calls.push(['openFile', ...args]) },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  if (isIntlPolyfills(name)) return intlPolyfills;
  const key = name.startsWith('.') ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name)) : name;
  if (mock[key]) return mock[key];
  if (!key.startsWith('@/')) return require(key);
  const file = ['.ts', '.tsx', '/index.ts'].map(ext => path.join(root, key.slice(2)) + ext).find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', js)(n => load(n, file), module, module.exports);
  return module.exports;
}
function harness(fn) { const s = { slots: [], cursor: 0 }; return props => { scope = s; s.cursor = 0; try { return fn(props); } finally { scope = null; } }; }
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, type, test = () => true) => nodes(tree).find(n => n.type === type && test(n.props))?.props;
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const k = load('@/features/files/kinds'), dates = load('@/lib/dates');
const i18n = load('@/i18n/runtime'), ui = load('@/features/files/AttachmentList');
const { toFileItem } = load('@/canvas/api/files');
const baseline = require('./file-presentation.baseline.json');
const langs = ['en', 'fr', 'ar'], zones = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'];
const catalogs = langs.map(lang => load(`@/i18n/${lang}`)[lang]);
const slots = value => [...new Set(JSON.stringify(value).match(/\{\w+\}/g) ?? [])].sort();
assert.ok(Object.keys(catalogs[0]).length >= 1491);
for (const [i, lang] of langs.entries()) {
  assert.equal(baseline.catalogKeys.length, 1388);
  const hash = createHash('sha256').update(JSON.stringify(baseline.catalogKeys.map(key => [key, catalogs[i][key]]))).digest('hex');
  assert.equal(hash, baseline.catalogHashes[lang], `${lang}: all 1388 baseline values unchanged`);
  assert.deepEqual(Object.keys(catalogs[i]).sort(), Object.keys(catalogs[0]).sort());
  for (const key of Object.keys(catalogs[0])) assert.deepEqual(slots(catalogs[i][key]), slots(catalogs[0][key]), key);
}
// Entire original table: every extension, every derived MIME and alias; filename/MIME
// precedence, generic MIME substitution, icons, UTI and preferred-extension metadata.
for (const { file, extension, description } of baseline.cases) {
  Object.freeze(file);
  assert.equal(k.extensionFor(file), extension);
  assert.deepEqual(JSON.parse(JSON.stringify(k.describeFile(file))), description);
  for (const locale of langs) {
    const result = k.describeFile(file, locale);
    const { label, ...intent } = result, { label: _oldLabel, ...oldIntent } = description;
    assert.deepEqual(JSON.parse(JSON.stringify(intent)), oldIntent);
    assert.equal(typeof label, 'string'); assert.ok(label); assert.ok(!label.startsWith('file.'));
    if (locale === 'en') assert.equal(label, description.label);
    const key = `file.type.${extension}`;
    if (Object.hasOwn(catalogs[0], key)) assert.equal(label, i18n.createTranslator(locale)(key));
  }
}
for (const raw of ['constructor', 'toString', '__proto__', 'normal-unknown']) {
  assert.equal(k.extensionFor({ name: 'raw', contentType: raw }), '');
  for (const locale of langs) {
    const t = i18n.createTranslator(locale);
    const result = k.describeFile({ name: 'raw', contentType: raw }, locale);
    assert.equal(result.kind, 'other'); assert.equal(result.label, t('file.generic.file'));
    assert.equal(result.mimeType, raw.toLowerCase()); assert.equal(result.uti, undefined);
    assert.equal(result.utiMatchesExtension, false); assert.equal(result.icon, 'File');
    const file = { name: 'raw.' + raw };
    const extension = k.extensionOf(file.name);
    assert.equal(k.describeFile(file, locale).label, extension ? t('file.extension', { extension: extension.toUpperCase() }) : t('file.generic.file'));
    assert.equal(k.describeFile(file, locale).mimeType, 'application/octet-stream');
  }
}
// Extensions retain the preexisting 1–8 alphanumeric grammar (toString -> tostring).
assert.equal(k.extensionOf('raw.constructor'), ''); assert.equal(k.extensionOf('raw.__proto__'), '');
assert.equal(k.extensionOf('raw.toString'), 'tostring');
for (const locale of langs) {
  const t = i18n.createTranslator(locale);
  for (const bytes of [null, undefined, -1, -Infinity]) assert.equal(k.formatSize(bytes, locale), null);
  for (const bytes of [0, -0, 1, 2, 3, 11, 99, 101, 1.5, 999, 999.99]) assert.equal(k.formatSize(bytes, locale), t('file.bytes', { count: bytes }));
  for (const [bytes, value, key] of [
    [1000,1,'kilobytes'], [1050,1.1,'kilobytes'], [99949,99.9,'kilobytes'],
    [99999,100,'kilobytes'], [100000,100,'kilobytes'], [100499,100,'kilobytes'],
    [100500,101,'kilobytes'], [999999,1000,'kilobytes'], [1e6,1,'megabytes'],
    [1e9,1,'gigabytes'], [1e12,1,'terabytes'], [1e15,1000,'terabytes'],
  ]) assert.equal(k.formatSize(bytes, locale), t(`file.${key}`, { amount: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value) }));
  // Nonfinite input has preexisting display artifacts, not a validation contract.
  assert.equal(k.formatSize(NaN, locale), t('file.kilobytes', { amount: new Intl.NumberFormat(locale).format(NaN) }));
  assert.equal(k.formatSize(Infinity, locale), t('file.terabytes', { amount: new Intl.NumberFormat(locale).format(Infinity) }));
}
assert.equal(k.formatSize(0), '0 bytes'); assert.equal(k.formatSize(1), '1 byte');
assert.equal(k.formatSize(100500), '101 KB'); assert.equal(k.formatSize(NaN), 'NaN KB'); assert.equal(k.formatSize(Infinity), 'Infinity TB');
// Dates stay the same objects across all locale/Canvas-zone changes, including civil
// years that disagree with UTC and device time. Expected dates use independent Intl.
const pairs = [
  [new Date('2026-01-01T01:00:00Z'), new Date('2025-12-31T23:00:00Z')],
  [new Date('2025-12-31T16:00:00Z'), new Date('2025-12-31T14:00:00Z')],
  [new Date('2026-07-01T00:30:00Z'), new Date('2026-06-30T23:30:00Z')],
];
const available = { lockedForUser: false, unlockAt: null, lockAt: null, hidden: false };
for (const locale of langs) for (const zone of zones) {
  const context = dates.createDateContext(locale, zone), t = i18n.createTranslator(locale);
  // Foreground state deliberately disagrees: pure APIs must obey their arguments.
  i18n.setAccountLocale('unrelated', locale === 'ar' ? 'fr' : 'ar'); dates.setDisplayTimeZone(zone === 'UTC' ? 'Asia/Tokyo' : 'UTC');
  for (const [date, now] of pairs) {
    const before = [date.getTime(), now.getTime()];
    const fmt = options => new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, ...options });
    const sameYear = fmt({year:'numeric'}).format(date) === fmt({year:'numeric'}).format(now);
    const day = fmt({month:'short',day:'numeric', ...(!sameYear && {year:'numeric'})}).format(date);
    const datetime = t('date.at', {day, time: fmt({hour:'numeric',minute:'2-digit'}).format(date)});
    assert.equal(k.formatDay(date, now, context), day); assert.equal(k.formatDateTime(date, now, context), datetime);
    assert.equal(k.availabilityOf(available, now, context), null);
    assert.deepEqual(k.availabilityOf({...available, lockedForUser:true, unlockAt:date, lockAt:now, hidden:true}, now, context), {tone:'warning',short:t('file.lockedUntil',{date:day}),long:t('file.lockedUntil',{date:datetime})});
    assert.deepEqual(k.availabilityOf({...available, lockAt:date, hidden:true}, now, context), {tone:'neutral',short:t('file.availableUntil',{date:day}),long:t('file.availableUntil',{date:datetime})});
    assert.deepEqual([date.getTime(), now.getTime()], before);
    for(const delta of [-1,0,1]) {
      const boundary = new Date(now.getTime()+delta);
      const locked = k.availabilityOf({...available, lockedForUser:true, unlockAt:boundary},now,context);
      assert.equal(locked.tone,'warning');
      assert.equal(locked.long, delta > 0 ? t('file.lockedUntil',{date:k.formatDateTime(boundary,now,context)}) : t('file.instructorLocked'));
      const expired = k.availabilityOf({...available, lockedForUser:true, lockAt:boundary},now,context);
      assert.equal(expired.long, delta <= 0 ? t('file.lockedSince',{date:k.formatDateTime(boundary,now,context)}) : t('file.instructorLocked'));
      const expiring = k.availabilityOf({...available, lockAt:boundary},now,context);
      assert.equal(expiring?.tone ?? null, delta > 0 ? 'neutral' : null);
    }
    assert.deepEqual(k.availabilityOf({...available,hidden:true},now,context),{tone:'neutral',short:t('file.hidden'),long:t('file.hiddenExplanation')});
    // Legacy wrappers remain English but legacy dates follow the global date module.
    assert.deepEqual(k.availabilityOf({...available,lockedForUser:true},now),{tone:'warning',short:'Locked',long:'Locked by your instructor'});
    assert.equal(k.formatDay(date,now), dates.formatShortDate(date,now));
    const year = dates.formatDate(date,{year:'numeric'}) === dates.formatDate(now,{year:'numeric'});
    assert.equal(k.formatDateTime(date,now), dates.formatDate(date,{month:'short',day:'numeric',...(!year && {year:'numeric'}),hour:'numeric',minute:'2-digit'}));
  }
}
const attachments = [
  {id:1, display_name:'Locked.pdf', filename:'raw.docx', 'content-type':'application/pdf', size:100500, url:'https://raw.invalid/file?verifier=raw', locked_for_user:true, unlock_at:'2026-01-01T01:00:00Z', lock_explanation:'Raw server detail'},
  {id:'two', display_name:'Available until.txt', size:1, lock_at:'2026-01-01T01:00:00Z'},
  {id:'three', display_name:'Hidden العربية.zzz', size:0, hidden:true},
  {id:'empty', display_name:'', filename:'fallback.txt', size:null},
  {id:'raw', display_name:'Word document', size:-1},
];
for (const item of attachments) Object.freeze(item); Object.freeze(attachments);
const expectedFiles = attachments.map(toFileItem), before = JSON.stringify(attachments);
const render = harness(ui.AttachmentList), RealDate = Date;
// Deterministic row now; no timers, browser or device operations.
global.Date = class extends RealDate { constructor(...args) { return new RealDate(...(args.length ? args : ['2025-12-31T23:00:00Z'])); } };
try {
  let payload;
  for(const locale of langs) for(const zone of zones) for(const header of [undefined,'Attachments','', 'Raw العربية']) {
    i18n.setAccountLocale('synthetic',locale); dates.setDisplayTimeZone(zone);
    const t = i18n.createTranslator(locale), context = dates.createDateContext(locale,zone), effects = calls.length;
    const tree = render({attachments,courseId:'course-raw',header,className:'custom'});
    assert.equal(calls.length,effects);
    assert.equal(find(tree,'ListGroup').header,header); assert.equal(find(tree,'ListGroup').className,'custom');
    const rows = nodes(tree).filter(n=>n.type==='ListItem'); assert.deepEqual(rows.map(n=>n.key),expectedFiles.map(f=>f.id));
    for(const [index,{props:row}] of rows.entries()) {
      const file = expectedFiles[index], name = attachments[index].display_name;
      const summary = ui.fileSummary(file,locale), a = k.availabilityOf(file,new Date(),context);
      assert.equal(row.title,name); assert.equal(row.subtitle,summary); assert.equal(row.subtitleLines,1);
      assert.equal(row.accessibilityHint,t('file.openHint'));
      assert.equal(row.accessibilityLabel,a ? t('file.rowAvailabilityLabel',{name,summary,availability:a.short}) : t('file.rowLabel',{name,summary}));
      const badge = find(row.trailing,'Badge');
      if(a?.tone==='warning') { assert.equal(badge.tone,'warning'); assert.equal(badge.icon,'Lock'); assert.equal(text(badge.children),t('file.locked')); } else assert.equal(row.trailing,null);
      assert.deepEqual(row.leading.props.file,file);
      row.onPress(); assert.deepEqual(calls.at(-1),['openFile',file.id,{courseId:'course-raw',files:expectedFiles}]);
      const files = calls.at(-1)[2].files;
      if(payload) assert.equal(files,payload,'same mapped files through locale/zone/header switches'); else payload=files;
      assert.equal(ui.fileSummary(file),[k.describeFile(file).label,k.formatSize(file.size)].filter(Boolean).join(' · '));
    }
  }
  assert.equal(render({attachments:[]}),null);
} finally { global.Date = RealDate; }
assert.equal(JSON.stringify(attachments),before);
console.log(`file presentation: PASS (${process.env.TZ || 'host TZ'}); 565 frozen classification cases, >=1491 keys, explicit locale/Canvas zone; mocked rendering/openFile only`);
