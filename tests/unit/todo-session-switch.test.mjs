import test from 'node:test';
import assert from 'node:assert/strict';

import { readAllSources, readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const providerSource = readAllSources([joinFromRoot('src', 'providers', 'ChatViewProvider.ts'), joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'), joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'), joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'), joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'), joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'), joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts')],
  'ChatViewProvider.ts',
);

const handlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

test('handleLoadSession clears in-memory todos and posts rehydrated todo snapshot', () => {
  // Ensure switching sessions clears in-memory todo cache before rehydration
  assert.match(
    providerSource,
    /private async handleLoadSession\(sessionId: string\): Promise<void>[\s\S]*this\.clearSessionTodos\(sessionId\);[\s\S]*todoItems:\s*\[\s*\]/,
    'handleLoadSession should clear in-memory todos and then post initState with empty todoItems',
  );
});

test('clearSessionTodos implementation resets currentTodoItems', () => {
  assert.match(
    providerSource,
    /private clearSessionTodos\(sessionId\?\: string\): void \{[\s\S]*this\.currentTodoItems = \[\];/,
    'clearSessionTodos should reset this.currentTodoItems to an empty array',
  );
});

test('initState sent during webview ready includes todoItems for rehydration', () => {
  assert.match(
    providerSource,
    /postMessage\(\{[\s\S]*type: "initState"[\s\S]*todoItems: \[\]/,
    'initial initState sent during webview ready should include empty todoItems',
  );
});

test('messageHandler exposes todo normalization and ingestion helpers', () => {
  assert.match(
    handlerSource,
    /function normalizeTodoRecord\(raw: unknown\): TodoItem \| null/,
    'messageHandler should export normalizeTodoRecord helper for incoming todo-like payloads',
  );

  assert.match(
    handlerSource,
    /function ingestNormalizedTodo\([\s\S]*dispatch:[\s\S]*getState:[\s\S]*item:[\s\S]*\): void \{[\s\S]*UPDATE_TODO_ITEM[\s\S]*ADD_TODO_ITEM/,
    'ingestNormalizedTodo should dispatch UPDATE_TODO_ITEM or ADD_TODO_ITEM depending on presence in state',
  );
});
