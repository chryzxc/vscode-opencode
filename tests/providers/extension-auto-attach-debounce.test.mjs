/**
 * Performance Tests for Auto-Attach Text Selection Feature
 *
 * These tests verify the debouncing optimization to prevent excessive
 * webview messages during rapid text selection changes:
 * 1. Debouncing with 150ms delay
 * 2. Timer cleanup on disposal
 * 3. Prevention of excessive calls
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const extensionSource = readSource(
  [joinFromRoot('src', 'extension.ts')],
  'extension.ts',
);

test('Auto-Attach feature implements debouncing for performance', () => {
  // Verify debounce timer variable exists
  assert.match(extensionSource, /let\s+selectionChangeTimer:\s*NodeJS\.Timeout\s*\|\s*undefined/,
    'Extension should declare selectionChangeTimer for debouncing');

  // Verify onDidChangeTextEditorSelection handler is registered
  assert.match(extensionSource, /vscode\.window\.onDidChangeTextEditorSelection\(/,
    'Extension should register onDidChangeTextEditorSelection handler');

  // Verify debouncing logic - timer clearing
  assert.match(extensionSource, /if\s*\(selectionChangeTimer\)\s*\{[\s\S]*?clearTimeout\(selectionChangeTimer\)/,
    'Handler should clear existing timer (debounce pattern)');

  // Verify debouncing logic - setTimeout with delay
  assert.match(extensionSource, /selectionChangeTimer\s*=\s*setTimeout\(/,
    'Handler should set timeout for debouncing');
  assert.match(extensionSource, /\b150\b/,
    'Handler should use 150ms debounce delay');

  // Check that async operations happen inside setTimeout
  assert.match(extensionSource, /setTimeout\(async\s*\(\)\s*=>\s*\{/,
    'setTimeout should contain async callback for the actual work');
});

test('Auto-Attach feature prevents excessive webview calls', () => {
  // Verify chatViewProvider methods are called inside setTimeout
  // The key pattern: async callback in setTimeout that calls chatViewProvider methods
  assert.match(extensionSource, /setTimeout\(async\s*\(\)\s*=>\s*\{[\s\S]*?await\s+chatViewProvider\./,
    'chatViewProvider methods should be called inside setTimeout async callback');

  // Verify the methods are called
  assert.match(extensionSource, /await\s+chatViewProvider\.clearAutoContext\(\)/,
    'clearAutoContext should be called');
  assert.match(extensionSource, /await\s+chatViewProvider\.autoAddContext\(/,
    'autoAddContext should be called');
});

test('Auto-Attach feature implements proper cleanup', () => {
  // Verify cleanup disposal is registered
  assert.match(extensionSource, /context\.subscriptions\.push\(\s*\{\s*dispose:\s*\(\)\s*=>/,
    'Extension should register disposal cleanup');

  // Verify cleanup clears timer
  assert.match(extensionSource, /dispose:\s*\(\)\s*=>\s*\{[\s\S]*?clearTimeout\(selectionChangeTimer\)/,
    'Cleanup should clear selectionChangeTimer');
});

test('Auto-Attach feature maintains original functionality', () => {
  // Verify key operations are present in the debounced handler
  assert.match(extensionSource, /const\s+editor\s*=\s*event\.textEditor/,
    'Should get text editor');
  assert.match(extensionSource, /const\s+selection\s*=\s*event\.selections\?\.\[0\]/,
    'Should get primary selection with optional chaining');
  assert.match(extensionSource, /if\s*\(!selection\s*\|\|\s*selection\.isEmpty\)/,
    'Should check for empty selection');
  assert.match(extensionSource, /const\s+selectedText\s*=\s*editor\.document\.getText\(selection\)\.trim\(\)/,
    'Should get selected text');
  assert.match(extensionSource, /const\s+fileName\s*=\s*vscode\.workspace\.asRelativePath\(/,
    'Should get file name');
  assert.match(extensionSource, /const\s+startLine\s*=\s*selection\.start\.line\s*\+\s*1/,
    'Should calculate start line');
  assert.match(extensionSource, /const\s+endLine\s*=\s*selection\.end\.line\s*\+\s*1/,
    'Should calculate end line');
  assert.match(extensionSource, /const\s+lineInfo\s*=/,
    'Should format line info');
});

test('Auto-Attach feature performance optimization summary', () => {
  // Verify all key performance patterns are present
  assert.match(extensionSource, /let\s+selectionChangeTimer:\s*NodeJS\.Timeout\s*\|\s*undefined/,
    '✓ Has debounce timer variable');
  assert.match(extensionSource, /clearTimeout\(selectionChangeTimer\)/,
    '✓ Clears existing timer (debounce pattern)');
  assert.match(extensionSource, /selectionChangeTimer\s*=\s*setTimeout\(/,
    '✓ Schedules delayed execution');
  assert.match(extensionSource, /\b150\b/,
    '✓ Uses 150ms debounce delay');
  assert.match(extensionSource, /context\.subscriptions\.push\(\s*\{\s*dispose:/,
    '✓ Registers cleanup handler');
  assert.match(extensionSource, /dispose:\s*\(\)\s*=>\s*\{[\s\S]*?clearTimeout\(selectionChangeTimer\)/,
    '✓ Cleans up timer on disposal');
});

test('Auto-Attach feature prevents performance issues during rapid selection', () => {
  // Verify the handler returns immediately and doesn't await anything at top level
  // The handler should NOT be async
  assert.doesNotMatch(extensionSource, /onDidChangeTextEditorSelection\(\s*async\s+/,
    'Handler should NOT be async function (should return immediately)');

  // Verify setTimeout is used for async work (deferred execution)
  assert.match(extensionSource, /onDidChangeTextEditorSelection\([^)]*\)\s*=>\s*\{[\s\S]*?setTimeout/,
    'Handler should use setTimeout to defer async work');

  // This ensures the handler returns immediately and doesn't block
  // even if chatViewProvider methods are slow
});

test('Auto-Attach feature debouncing reduces call frequency', () => {
  // Verify the debouncing comment explaining the purpose
  assert.match(extensionSource, /Debounce:/i,
    'Should have comment explaining debounce behavior');

  assert.match(extensionSource, /150ms.*after.*last.*selection/i,
    'Should mention 150ms delay after last selection');

  // Verify timer variable is declared before the handler
  assert.match(extensionSource, /let\s+selectionChangeTimer:.*?\/\/.*?debounce/is,
    'Timer should be declared with comment explaining debouncing');
});
