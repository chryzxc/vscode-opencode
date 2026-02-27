import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);
const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('todo event stream handling supports add and update operations', () => {
  // Verify todoUpdate event processing for both creation and mutation paths.
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  assert.match(handlerBody, /case\s+'todoUpdate':\s*\{/, 'message handler must process todoUpdate events');
  assert.match(handlerBody, /if\s*\(action\s*===\s*'add'\)\s*\{[\s\S]*type:\s*'ADD_TODO_ITEM'/, 'todo add event should dispatch ADD_TODO_ITEM');
  assert.match(handlerBody, /else\s+if\s*\(action\s*===\s*'update'\)\s*\{[\s\S]*type:\s*'UPDATE_TODO_ITEM'/, 'todo update event should dispatch UPDATE_TODO_ITEM');
  assert.match(handlerBody, /if\s*\(!item\)\s*break;/, 'todo handler should ignore malformed payloads without item');
});

test('todo state reducer exposes item list set, append, and patch transitions', () => {
  // Verify reducer supports todo panel state transitions used by message handling.
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  assert.match(reducerBody, /case\s+'SET_TODO_ITEMS':\s*\{[\s\S]*todoItems:\s*action\.payload/, 'reducer should replace todo list with SET_TODO_ITEMS');
  assert.match(reducerBody, /case\s+'UPDATE_TODO_ITEM':\s*\{[\s\S]*map\(/, 'reducer should patch matching TODO via UPDATE_TODO_ITEM');
  assert.match(reducerBody, /case\s+'ADD_TODO_ITEM':\s*\{[\s\S]*todoItems:\s*\[\.\.\.\(state\.todoItems\s*\|\|\s*\[\]\),\s*action\.payload\]/, 'reducer should append TODO entries via ADD_TODO_ITEM');
});

test('todo panel renders status icons and empty-state fallback', () => {
  // Verify right-panel TODO UI exposes status-to-icon mapping and no-task fallback.
  const todoBody = extractFunctionBody(panelSource, 'export function TodoPanel()');

  assert.match(todoBody, /case\s+'pending':[\s\S]*return\s+'⏳'/, 'pending status should render hourglass icon');
  assert.match(todoBody, /case\s+'in_progress':[\s\S]*return\s+'🔄'/, 'in_progress status should render sync icon');
  assert.match(todoBody, /case\s+'completed':[\s\S]*return\s+'✅'/, 'completed status should render check icon');
  assert.match(todoBody, /case\s+'failed':[\s\S]*case\s+'cancelled':[\s\S]*return\s+'❌'/, 'failed/cancelled states should render error icon');
  assert.match(todoBody, /No tasks yet/, 'todo panel should render an empty-state message when no tasks exist');
});
