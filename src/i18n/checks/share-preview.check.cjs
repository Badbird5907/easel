/* global __dirname */
/* Actual preview, descriptors, formatters and i18n hook/runtime; synthetic hook
 * subscriptions and inert design/native/thumbnail/icon boundaries. No content
 * parser/store, Canvas transport, storage, clipboard or image loads are allowed.
 * This does not model React reconciliation/Compiler or native accessibility. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
let active;
const jsx = (type, props, key) =>
  typeof type === 'function' ? type(props) : { type, props: props ?? {}, key };
const icons = new Proxy({}, { get: (_, name) => String(name) });
const stubs = {
  'react/jsx-runtime': { jsx, jsxs: jsx },
  react: {
    useMemo: (fn) => fn(),
    useSyncExternalStore(subscribe, snapshot) {
      assert.ok(active, 'hook must render inside a synthetic mounted consumer');
      const h = active;
      if (!h.subscriptions.has(subscribe))
        h.subscriptions.set(
          subscribe,
          subscribe(() => h.render()),
        );
      return snapshot();
    },
  },
  'react-native': { View: 'View' },
  'lucide-react-native': icons,
  '@/design': Object.fromEntries(['Card', 'IconTile', 'ListGroup', 'ListItem', 'Text'].map((v) => [v, v])),
  '@/features/files/FileThumbnail': { FileThumbnail: 'FileThumbnail' },
};
const allowed = new Set(
  [
    'features/share/SharedPreview.tsx',
    'features/files/kinds.ts',
    'lib/dates.ts',
    'i18n/index.ts',
    'i18n/runtime.ts',
    'i18n/en.ts',
    'i18n/fr.ts',
    'i18n/ar.ts',
  ].map((p) => path.join(root, p)),
);
function load(name, dir = root) {
  if (Object.hasOwn(stubs, name)) return stubs[name];
  const base = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(dir, name);
  const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find((p) => fs.existsSync(p));
  assert.ok(allowed.has(file), `Unexpected import (effects denied): ${name}`);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  cache.set(file, module.exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function('require', 'module', 'exports', code)(
    (n) => load(n, path.dirname(file)),
    module,
    module.exports,
  );
  return module.exports;
}
function mount(component, props) {
  const h = {
    props,
    tree: null,
    renders: 0,
    subscriptions: new Map(),
    render() {
      active = h;
      try {
        h.tree = component(h.props);
        h.renders++;
      } finally {
        active = undefined;
      }
    },
    unmount() {
      for (const unsubscribe of h.subscriptions.values()) unsubscribe();
      h.subscriptions.clear();
    },
  };
  h.render();
  return h;
}
function nodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap((v) => nodes(v, type));
  if (!tree || typeof tree !== 'object') return [];
  return [
    ...(tree.type === type ? [tree] : []),
    ...nodes(tree.props.children, type),
    ...nodes(tree.props.leading, type),
  ];
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const runtime = load('@/i18n/runtime');
const { describeFile, formatSize } = load('@/features/files/kinds');
const { SharedFiles, SharedLink, SharedText, SharedPreview } = load('@/features/share/SharedPreview');
const languages = ['en', 'fr', 'ar'];
const locales = [...languages, 'fr-CA', 'ar-EG-u-nu-arab', 'en-US-u-nu-arab'];
const fixtures = [
  ['résumé <&> العربية.docx', null, 1250, false, 'file.type.docx', 'document'],
  ['صورة & é.PNG', 'image/png', 0, true, 'file.type.png', 'image'],
  ['odd.ZQX', 'application/octet-stream', null, false, 'file.extension', 'other'],
  ['', null, undefined, false, 'file.generic.file', 'other'],
  ['Shared file', '', -1, false, 'file.generic.file', 'other'],
  ['Link to', 'application/x-unknown', 1, false, 'file.generic.file', 'other'],
  ['File', 'image/x-unknown', 2, true, 'file.generic.image', 'image'],
  ['<tag>{name} & "é"\nالعربية', 'text/plain; charset=UTF-8', 11000, false, 'file.generic.text', 'text'],
  ['slides.pptx', 'application/pdf', 999, false, 'file.type.pptx', 'presentation'],
];
const files = freeze(
  fixtures.map(([name, mimeType, size, isImage], index) => ({
    uri: `content://shared/${index}/%2f?raw=é&literal={name}#العربية`,
    name,
    mimeType,
    size,
    isImage,
  })),
);
const originalFiles = JSON.stringify(files);
let failures = 0;
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.message.slice(0, 650)}`);
  }
}
check('2995 reviewed catalog hashes per language, future additions permitted', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'share-preview.baseline.json'), 'utf8'));
  for (const language of languages) {
    const catalog = load('@/i18n/' + language)[language];
    assert.equal(Object.keys(baseline.catalogs[language]).length, 2995);
    for (const [key, expected] of Object.entries(baseline.catalogs[language])) {
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
        expected,
        `${language}/${key}`,
      );
    }
    for (const key of ['sharePreview.fileLabel', 'sharePreview.linkLabel'])
      assert.equal(typeof catalog[key], 'string');
  }
});
for (const locale of locales) {
  check(`${locale}: actual file descriptions, raw metadata and thumbnail props`, () => {
    runtime.setAccountLocale('synthetic', locale);
    const h = mount(SharedFiles, { files });
    try {
      const rows = nodes(h.tree, 'ListItem');
      const thumbnails = nodes(h.tree, 'FileThumbnail');
      const t = runtime.createTranslator(locale);
      assert.equal(rows.length, files.length);
      assert.equal(thumbnails.length, files.length);
      rows.forEach(({ props, key }, index) => {
        const file = files[index];
        const [, , , , descriptionKey, kind] = fixtures[index];
        const type = t(
          descriptionKey,
          descriptionKey === 'file.extension' ? { extension: 'ZQX' } : undefined,
        );
        const descriptor = describeFile({ name: file.name, contentType: file.mimeType ?? undefined }, locale);
        assert.equal(descriptor.label, type);
        assert.equal(descriptor.kind, kind);
        const detail = [type, formatSize(file.size, locale)].filter(Boolean).join(' · ');
        assert.equal(props.title, file.name);
        assert.equal(props.subtitle, detail);
        assert.equal(props.accessibilityLabel, t('sharePreview.fileLabel', { name: file.name, detail }));
        assert.equal(props.subtitleLines, 1);
        assert.equal(key, `${file.uri}-${index}`);
        assert.deepEqual(thumbnails[index].props, {
          size: 'lg',
          file: {
            name: file.name,
            filename: file.name,
            contentType: file.mimeType ?? '',
            thumbnailUrl: file.isImage ? file.uri : null,
          },
        });
        const { label: _label, ...classification } = descriptor;
        const { label: _legacy, ...original } = describeFile({
          name: file.name,
          contentType: file.mimeType ?? undefined,
        });
        assert.deepEqual(classification, original, 'locale changes description only');
      });
      assert.equal(JSON.stringify(files), originalFiles);
    } finally {
      h.unmount();
    }
  });
  check(`${locale}: independent byte/unit/number expectations at preview boundary`, () => {
    runtime.setAccountLocale('synthetic', locale);
    const t = runtime.createTranslator(locale);
    const number = (value) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
    const cases = [
      ...[0, 1, 2, 3, 11, 100, 999].map((size) => [size, t('file.bytes', { count: size })]),
      [1000, t('file.kilobytes', { amount: number(1) })],
      [1250, t('file.kilobytes', { amount: number(1.3) })],
      [123456, t('file.kilobytes', { amount: number(123) })],
      [1000000, t('file.megabytes', { amount: number(1) })],
      [2500000000, t('file.gigabytes', { amount: number(2.5) })],
      [1000000000000, t('file.terabytes', { amount: number(1) })],
      [null, null],
      [undefined, null],
      [-1, null],
    ];
    for (const [size, expected] of cases) {
      assert.equal(formatSize(size, locale), expected);
      const h = mount(SharedFiles, { files: [{ ...files[0], size }] });
      try {
        assert.equal(
          nodes(h.tree, 'ListItem')[0].props.subtitle,
          expected === null ? t('file.type.docx') : `${t('file.type.docx')} · ${expected}`,
        );
      } finally {
        h.unmount();
      }
    }
  });
  check(`${locale}: whole link accessibility and exact URL/text`, () => {
    runtime.setAccountLocale('synthetic', locale);
    const t = runtime.createTranslator(locale);
    for (const [url, host] of [
      ['https://www.example.invalid:8443/a%2fb?x=é&y={url}#العربية', 'example.invalid:8443'],
      ['Link to', 'Link to'],
      ['Shared file', 'Shared file'],
      ['File', 'File'],
      ['<x> & "é"\nالعربية', '<x> & "é"\nالعربية'],
      ['', ''],
    ]) {
      const h = mount(SharedLink, { url });
      try {
        assert.equal(
          nodes(h.tree, 'Card')[0].props.accessibilityLabel,
          t('sharePreview.linkLabel', { host, url }),
        );
        const text = nodes(h.tree, 'Text').map((n) => n.props);
        assert.equal(text[0].children, host);
        assert.equal(text[0].numberOfLines, 1);
        assert.equal(text[1].children, url);
        assert.equal(text[1].selectable, true);
        assert.equal(text[1].numberOfLines, 3);
      } finally {
        h.unmount();
      }
      const plain = mount(SharedText, { text: url });
      try {
        const text = nodes(plain.tree, 'Text')[0].props;
        assert.equal(text.children, url);
        assert.equal(text.selectable, true);
        assert.equal(text.numberOfLines, 10);
      } finally {
        plain.unmount();
      }
    }
  });
}
check('same payload locale notifications relabel isolated consumers without parent render', () => {
  runtime.setAccountLocale('synthetic', 'en');
  const h = mount(SharedFiles, { files });
  const url = 'https://www.example.invalid/%2f?raw={url}&é#العربية';
  const link = mount(SharedLink, { url });
  try {
    const originals = nodes(h.tree, 'FileThumbnail').map((n) => n.props);
    for (const locale of ['fr', 'ar', 'fr-CA', 'en']) {
      const before = [h.renders, link.renders];
      runtime.setAccountLocale('synthetic', locale);
      assert.ok(h.renders > before[0], 'SharedFiles subscribes itself');
      assert.ok(link.renders > before[1], 'SharedLink subscribes itself');
      assert.strictEqual(h.props.files, files);
      assert.equal(link.props.url, url);
      assert.deepEqual(
        nodes(h.tree, 'FileThumbnail').map((n) => n.props),
        originals,
      );
      assert.equal(
        nodes(h.tree, 'ListItem')[0].props.subtitle,
        `${runtime.createTranslator(locale)('file.type.docx')} · ${formatSize(1250, locale)}`,
      );
      assert.equal(
        nodes(link.tree, 'Card')[0].props.accessibilityLabel,
        runtime.createTranslator(locale)('sharePreview.linkLabel', { host: 'example.invalid', url }),
      );
    }
  } finally {
    h.unmount();
    link.unmount();
  }
});
check('same preview source replacements and legacy files-first/URL/text visibility and order', () => {
  const cases = [
    { files, url: 'https://example.invalid', text: 'hidden raw text' },
    { files: [], url: 'https://example.invalid', text: 'File & العربية\n{host}' },
    { files: [], url: null, text: 'Shared file' },
    { files: [], url: 'Link to', text: null },
    { files: [], url: '', text: '  ' },
    { files: [], url: null, text: null },
    { files: [files[1], files[0], files[1]], url: 'hidden', text: 'hidden' },
  ].map(freeze);
  const h = mount(SharedPreview, { content: cases[0] });
  try {
    for (const content of cases) {
      const original = JSON.stringify(content);
      h.props = { content };
      h.render();
      for (const locale of ['en', 'fr', 'ar']) {
        runtime.setAccountLocale('synthetic', locale);
        const children = h.tree.props.children.filter(Boolean);
        if (content.files.length) {
          assert.deepEqual(
            children.map((n) => n.type),
            ['ListGroup'],
          );
          assert.deepEqual(
            nodes(h.tree, 'ListItem').map((n) => n.props.title),
            content.files.map((f) => f.name),
          );
          assert.equal(nodes(h.tree, 'Card').length, 0);
        } else {
          assert.equal(nodes(h.tree, 'ListGroup').length, 0);
          assert.equal(children.length, Number(!!content.url) + Number(!!content.text));
          assert.deepEqual(
            nodes(h.tree, 'IconTile').map((n) => n.props.icon),
            [content.url ? 'Link2' : null, content.text ? 'TextQuote' : null].filter(Boolean),
          );
          assert.deepEqual(
            nodes(h.tree, 'Text')
              .filter((n) => n.props.selectable)
              .map((n) => n.props.children),
            [content.url, content.text].filter(Boolean),
          );
        }
        assert.strictEqual(h.props.content, content);
        assert.equal(JSON.stringify(content), original);
      }
    }
  } finally {
    h.unmount();
  }
});
console.log(
  `${failures ? 'FAIL' : 'PASS'} shared preview: ${passed} groups passed, ${failures} failed; TZ=${process.env.TZ}; synthetic boundaries only`,
);
process.exitCode = failures ? 1 : 0;
