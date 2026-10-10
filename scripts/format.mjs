import ts from 'typescript';
import { readFile, writeFile, readdir } from 'node:fs/promises';
const check = process.argv.includes('--check');
async function visit(dir) {
  const out = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${item.name}`;
    if (item.isDirectory()) out.push(...await visit(path));
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}
let failed = false;
for (const file of [...await visit('src'), 'vite.config.ts']) {
  const content = await readFile(file, 'utf8');
  const host = {
    getScriptFileNames: () => [file], getScriptVersion: () => '1',
    getScriptSnapshot: name => name === file ? ts.ScriptSnapshot.fromString(content) : undefined,
    getCurrentDirectory: () => process.cwd(), getCompilationSettings: () => ({ jsx: ts.JsxEmit.ReactJSX }),
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists, readFile: ts.sys.readFile,
  };
  const service = ts.createLanguageService(host);
  const edits = service.getFormattingEditsForDocument(file, {
    indentSize: 2, tabSize: 2, convertTabsToSpaces: true, newLineCharacter: '\n',
    insertSpaceAfterCommaDelimiter: true, insertSpaceAfterSemicolonInForStatements: true,
    insertSpaceBeforeAndAfterBinaryOperators: true, insertSpaceAfterKeywordsInControlFlowStatements: true,
    insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
    placeOpenBraceOnNewLineForFunctions: false, placeOpenBraceOnNewLineForControlBlocks: false,
  });
  let result = content;
  for (const edit of edits.sort((a, b) => b.span.start - a.span.start)) {
    result = result.slice(0, edit.span.start) + edit.newText + result.slice(edit.span.start + edit.span.length);
  }
  if (check && result !== content) { console.error(`Formatting differs: ${file}`); failed = true; }
  else if (!check && result !== content) await writeFile(file, result);
  service.dispose();
}
if (failed) process.exitCode = 1;
