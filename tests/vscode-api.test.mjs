import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from './helpers/source-utils.mjs';

const vscodeLibSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'vscode.ts')],
  'vscode.ts',
);

test('VS Code API acquisition implements robust singleton pattern', () => {
  // Verify that we check for existing instance before calling acquireVsCodeApi
  assert.match(vscodeLibSource, /if\s*\(\(window\s+as\s+any\)\.__vscode_api\)\s+return\s+\(window\s+as\s+any\)\.__vscode_api;/, 'vscode lib must check __vscode_api on window first');
  
  // Verify that it stores the instance on window
  assert.match(vscodeLibSource, /\(window\s+as\s+any\)\.__vscode_api\s*=\s*acquireVsCodeApi\(\);/, 'vscode lib must store acquired api on window');
  
  // Verify error handling (swallowing already-acquired errors if they occur in between checks)
  assert.match(vscodeLibSource, /catch\s*\(e\)\s*\{\s*\/\/ ignore/, 'vscode lib should gracefully handle acquisition errors');
});

test('VS Code API lib exports the singleton instance', () => {
  assert.match(vscodeLibSource, /const\s+vscode\s*=\s*getVsCodeApi\(\);/, 'vscode lib should initialize instance via helper');
  assert.match(vscodeLibSource, /export\s+default\s+vscode;/, 'vscode lib must export default instance');
});
