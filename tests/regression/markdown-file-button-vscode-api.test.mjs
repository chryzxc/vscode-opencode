import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';

const rendererPath = join(process.cwd(), 'webview/shared/src/components/MarkdownRenderer.tsx');
const rendererSource = fs.readFileSync(rendererPath, 'utf8');

test('MarkdownRenderer imports the VS Code API used by file buttons', () => {
  assert.match(
    rendererSource,
    /import vscode from ['"]\.\.\/chat\/lib\/vscode['"];/,
    'MarkdownRenderer must use the shared VS Code API wrapper rather than an undeclared global',
  );
  assert.match(
    rendererSource,
    /vscode\?\.postMessage\(\{ type: ['"]openFile['"], file: filePath \}\)/,
    'file buttons must continue to send openFile messages',
  );
});
