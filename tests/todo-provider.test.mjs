import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const chatProviderSource = readSource([
  joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
], 'ChatViewProvider.ts');

test('ChatViewProvider forwards todo_update stream events as todoUpdate postMessage to webview', () => {
  // Ensure provider forwards structured todo_update events into the webview
  assert.match(
    chatProviderSource,
    /postMessage\(\{[\s\S]*type:\s*["']todoUpdate["']/,
    'extension host should forward todo_update stream events as todoUpdate postMessage to webview',
  );
});

test('ChatViewProvider persists todo snapshot to workspaceState after todo_update', () => {
  // Verify workspaceState update call exists for todo snapshot persistence
  assert.match(
    chatProviderSource,
    /workspaceState\.update\(\s*key\s*,\s*\{[\s\S]*items:\s*updatedItems[\s\S]*\}/,
    'provider should persist todo snapshot to workspaceState using key and updatedItems',
  );
});

test('initState payload includes todoItems loaded from workspaceState for rehydration', () => {
  // initState should include todoItems loaded via loadPersistedTodos
  assert.match(
    chatProviderSource,
    /postMessage\(\{[\s\S]*type:\s*["']initState["'][\s\S]*todoItems\s*:\s*this\.loadPersistedTodos\(this\.currentSessionId\)\.items[\s\S]*\}/,
    'initState payload should include todoItems from loadPersistedTodos for session rehydration',
  );
});

test('todo update handles missing sessionId gracefully and persistence is guarded', () => {
  // Check that sessionId is optional in forwarded todoUpdate and persistence only when currentSessionId present
  assert.match(
    chatProviderSource,
    /\.\.\.\(sessionId\s*\?\s*\{\s*sessionId\s*\}\s*:\s*\{\}\)/,
    'todoUpdate postMessage should include optional sessionId spreading',
  );

  assert.match(
    chatProviderSource,
    /if\s*\(this\.currentSessionId\)\s*\{[\s\S]*workspaceState\.update\(/,
    'persistence of todo snapshot must be guarded by this.currentSessionId check',
  );
});

test('ChatViewProvider exposes getTodoStorageKey and loadPersistedTodos helpers', () => {
  // Ensure helper functions exist for todo storage
  assert.match(chatProviderSource, /private getTodoStorageKey\(sessionId: string\): string/);
  assert.match(chatProviderSource, /private loadPersistedTodos\(sessionId\?: string\): \{ items: unknown\[\]; lastUpdatedAt\?: number \}/);
});
