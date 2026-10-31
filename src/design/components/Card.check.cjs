const { isIntlPolyfills, intlPolyfills } = require('../../i18n/checks/node-boundaries.cjs');
/* global __dirname */
// Actual Card + SharedLink output with synthetic native/theme/pressable boundaries.
// This checks prop forwarding and consumer opt-in, not a native accessibility tree.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
let locale = 'en';
const jsx = (type, props) => (typeof type === 'function' ? type(props) : { type, props: props ?? {} });
const stubs = {
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'View' },
  '../theme/ThemeProvider': { useTheme: () => ({ shadows: { card: 'synthetic-shadow' } }) },
  './PressableScale': { PressableScale: 'PressableScale' },
  'lucide-react-native': { Link2: 'Link2', TextQuote: 'TextQuote' },
  '@/features/files/FileThumbnail': { FileThumbnail: 'FileThumbnail' },
  '@/features/files/kinds': {
    describeFile() {
      throw Error('File descriptors are outside this shared-link check');
    },
    formatSize() {
      throw Error('File sizes are outside this shared-link check');
    },
  },
};
const allowed = new Set(
  [
    'components/Card.tsx',
    'tokens/typography.ts',
    '../features/share/SharedPreview.tsx',
    '../lib/cn.ts',
    '../i18n/runtime.ts',
    '../i18n/en.ts',
    '../i18n/fr.ts',
    '../i18n/ar.ts',
  ].map((file) => path.resolve(root, file)),
);
function load(name, dir = root) {
  if (isIntlPolyfills(name)) return intlPolyfills;
  if (Object.hasOwn(stubs, name)) return stubs[name];
  if (['class-variance-authority', 'clsx', 'tailwind-merge'].includes(name)) return require(name);
  const base = name.startsWith('@/') ? path.resolve(root, '..', name.slice(2)) : path.resolve(dir, name);
  const file = [base + '.ts', base + '.tsx'].find((candidate) => fs.existsSync(candidate));
  assert.ok(allowed.has(file), `Unexpected import: ${name}`);
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
    (id) => load(id, path.dirname(file)),
    module,
    module.exports,
  );
  return module.exports;
}
const { Card } = load('./components/Card');
const runtime = load('@/i18n/runtime');
stubs['@/design'] = {
  Card,
  IconTile: 'IconTile',
  ListGroup: 'ListGroup',
  ListItem: 'ListItem',
  Text: 'Text',
};
stubs['@/i18n'] = { useTranslation: () => ({ locale, t: runtime.createTranslator(locale) }) };
const { SharedLink } = load('@/features/share/SharedPreview');
const children = { type: 'IconButton', props: { accessibilityLabel: 'Remove file', onPress() {} } };

// A label alone must not group or hide descendant controls such as Remove file.
for (const label of [undefined, '', 'Uploaded file']) {
  const card = Card({ children, accessibilityLabel: label });
  assert.equal(card.type, 'View');
  assert.equal(card.props.accessible, undefined);
  assert.equal(card.props.accessibilityLabel, label);
  assert.equal(card.props.children, children);
  assert.equal(card.props.accessibilityRole, undefined);
  assert.equal(card.props.onPress, undefined);
}
for (const accessible of [true, false]) {
  const card = Card({ children, accessible, accessibilityLabel: 'Named content' });
  assert.equal(card.props.accessible, accessible);
  assert.equal(card.props.accessibilityLabel, 'Named content');
  assert.equal(card.props.children, children);
}
let presses = 0;
const onPress = () => {
  presses++;
};
for (const accessible of [undefined, true, false]) {
  const card = Card({ children, onPress, accessible, accessibilityLabel: 'Open course' });
  assert.equal(card.type, 'PressableScale');
  assert.equal(card.props.accessibilityRole, 'button');
  assert.equal(card.props.accessible, accessible);
  assert.equal(card.props.accessibilityLabel, 'Open course');
  assert.equal(card.props.onPress, onPress);
  assert.equal(card.props.children, children);
  card.props.onPress();
}
assert.equal(presses, 3);

const url = 'https://www.example.invalid:8443/é?raw=%2f&text={name}#العربية';
for (locale of ['en', 'fr', 'ar']) {
  const tree = SharedLink({ url });
  assert.equal(tree.type, 'View', 'actual Card renders the noninteractive native boundary');
  assert.equal(tree.props.accessible, true, 'only this consumer explicitly opts into grouping');
  assert.equal(
    tree.props.accessibilityLabel,
    runtime.createTranslator(locale)('sharePreview.linkLabel', { host: 'example.invalid:8443', url }),
  );
  assert.equal(tree.props.accessibilityRole, undefined, 'a preview is not an action');
  const text = tree.props.children[1].props.children[1];
  assert.equal(text.type, 'Text');
  assert.equal(text.props.children, url);
  assert.equal(text.props.selectable, true);
}
console.log(
  'PASS actual Card forwarding, explicit grouping, unchanged descendant/pressable defaults and SharedLink en/fr/ar integration; native/AT not verified',
);
