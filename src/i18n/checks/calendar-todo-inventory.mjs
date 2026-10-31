/** Candidate inventory, not a count of confirmed untranslated messages. Run from project root. */
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
const rows = [];
const uiProps =
  /^(title|label|subtitle|description|placeholder|accessibilityLabel|accessibilityHint|header|footer|message|doneLabel|currentHint)$/;
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (file.startsWith('src/i18n') || /\.(check|test)\./.test(file)) continue;
    if (entry.isDirectory()) {
      scan(file);
      continue;
    }
    if (!/\.tsx?$/.test(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      let text;
      if (ts.isJsxText(node)) text = node.text.trim();
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const parent = node.parent;
        const ui =
          (ts.isJsxAttribute(parent) || ts.isPropertyAssignment(parent)) &&
          uiProps.test(parent.name.getText(ast));
        if (ui || /^[A-Z][\s\S]*\s[a-zA-Z]/.test(node.text)) text = node.text;
        if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) text = undefined;
      }
      if (ts.isTemplateExpression(node) && /[A-Za-z]{2}/.test(node.head.text)) text = node.getText(ast);
      if (node.parent && ts.isCallExpression(node.parent) && node.parent.expression.getText(ast) === 't')
        text = undefined;
      if (text && /[A-Za-z]/.test(text) && !text.includes('@/')) {
        const parts = file.split('/');
        const workstream =
          parts[1] === 'features'
            ? `features/${parts[2]}`
            : parts[1] === 'app'
              ? `routes/${parts.slice(2, -1).join('/') || 'root'}`
              : parts[1];
        rows.push({
          workstream,
          path: file,
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
          text,
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
}
for (const dir of [
  'src/app/(app)/(tabs)/calendar',
  'src/app/(app)/(tabs)/todo',
  'src/app/(app)/event',
  'src/app/(app)/planner-note',
  'src/features/calendar',
  'src/features/planner',
])
  scan(dir);
// Exclude reviewed protocol/identity templates and an internal picker diagnostic.
const displayCandidates = rows.filter(({ text, path: file }) =>
  !/^`(?:https?:|geo:|calendar_event_|planner_note_|\/event\/|\/planner-note\/|calendar:exported:|UNTIL=|FREQ=|easel\.calendar\.hidden\.|todo:badge:)/.test(text) &&
  !(file.endsWith('/pickerDates.ts') && text === 'Cannot represent picker time in the device zone'),
);
console.log(JSON.stringify(displayCandidates, null, 2));
