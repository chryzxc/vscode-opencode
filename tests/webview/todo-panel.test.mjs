import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource, readAllSources } from '../helpers/source-utils.mjs';

const messageHandlerSource = readAllSources(
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

  assert.match(handlerBody, /case\s+["']todoUpdate["']:\s*\{/, 'message handler must process todoUpdate events');
  assert.match(handlerBody, /if\s*\(action\s*===\s*["']add["']\)\s*\{[\s\S]*type:\s*["']ADD_TODO_ITEM["']/, 'todo add event should dispatch ADD_TODO_ITEM');
  assert.match(handlerBody, /else\s+if\s*\(action\s*===\s*["']update["']\)\s*\{[\s\S]*type:\s*["']UPDATE_TODO_ITEM["']/, 'todo update event should dispatch UPDATE_TODO_ITEM');
  assert.match(handlerBody, /if\s*\(!item\)\s*break;/, 'todo handler should ignore malformed payloads without item');
  assert.match(handlerBody, /else\s*\{[\s\S]*ingestNormalizedTodo\(dispatch,\s*getState,\s*normalized\)/, 'unknown todo actions should use normalized ingestion fallback');
  assert.match(messageHandlerSource, /function\s+ingestNormalizedTodo\([\s\S]*existingIds\.has\(item\.id\)[\s\S]*type:\s*['"]UPDATE_TODO_ITEM['"]/, 'ingestion helper should route existing todo ids through UPDATE_TODO_ITEM');
});

test('todo state reducer exposes item list set, append, and patch transitions', () => {
  // Verify reducer supports todo panel state transitions used by message handling.
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  assert.match(reducerBody, /case\s+["']SET_TODO_ITEMS["']:\s*\{[\s\S]*todoItems:\s*action\.payload/, 'reducer should replace todo list with SET_TODO_ITEMS');
  assert.match(reducerBody, /case\s+["']UPDATE_TODO_ITEM["']:\s*\{[\s\S]*map\(/, 'reducer should patch matching TODO via UPDATE_TODO_ITEM');
  assert.match(reducerBody, /case\s+["']ADD_TODO_ITEM["']:\s*\{[\s\S]*todoItems:\s*\[\.\.\.\(state\.todoItems\s*\|\|\s*\[\]\),\s*action\.payload\]/, 'reducer should append TODO entries via ADD_TODO_ITEM');
  assert.match(reducerBody, /incomingRank\s*>\s*currentRank/, 'reducer should accept higher-rank lifecycle promotions');
  assert.match(reducerBody, /incomingRank\s*===\s*currentRank[\s\S]*incomingStatus\s*===\s*it\.status/, 'reducer should treat same-rank same-status updates as idempotent');
  assert.match(reducerBody, /incomingRank\s*<\s*currentRank[\s\S]*return\s+it;/, 'reducer should reject stale lower-rank updates');
  assert.match(reducerBody, /isTerminalStatus\(it\.status\)\s*&&\s*incomingStatus\s*!==\s*it\.status/, 'reducer should block transitions away from terminal statuses');
  assert.match(reducerBody, /action\.payload\.status\s*===\s*existing\.status[\s\S]*return\s+state;/, 'ADD_TODO_ITEM should no-op duplicate replay events for same status');
});

test('todo panel renders status icons and empty-state fallback', () => {
  // Verify right-panel TODO UI exposes status-to-icon mapping and no-task fallback.
  const todoBody = extractFunctionBody(panelSource, 'export function TodoPanel()');

  assert.match(todoBody, /case\s+["']pending["']:[\s\S]*return\s+["']⏳["']/, 'pending status should render hourglass icon');
  assert.match(todoBody, /case\s+["']in_progress["']:[\s\S]*return\s+["']🔄["']/, 'in_progress status should render sync icon');
  assert.match(todoBody, /case\s+["']completed["']:[\s\S]*return\s+["']✅["']/, 'completed status should render check icon');
  assert.match(todoBody, /case\s+["']failed["']:[\s\S]*case\s+["']cancelled["']:[\s\S]*return\s+["']❌["']/, 'failed/cancelled states should render error icon');
  assert.match(todoBody, /No tasks yet/, 'todo panel should render an empty-state message when no tasks exist');
});

// RED: will pass after Task 1 implementation (provider + reducer + schema + initState)
test('provider should forward todo_update stream events as todoUpdate postMessage to webview', () => {
  // Verify extension host forwards structured todo_update stream events into the webview
  const chatProviderSource = readAllSources(
    [
    joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
    joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'),
    joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'),
    joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'),
    joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'),
    joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts'),
    joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'),
    joinFromRoot('src', 'providers', 'chat', 'types.ts')
  ],
    'ChatViewProvider.ts',
  );

  // Expect the provider to post a todoUpdate message when the stream contains responseType=todo_update
  assert.match(
    chatProviderSource,
    /postMessage\(\{[\s\S]*type:\s*["']todoUpdate["']/,
    'extension host should forward todo_update stream events as todoUpdate postMessage to webview',
  );
});

// RED: will pass after Task 1 implementation (reducer upsert behavior)
test('todo reducer should upsert existing todo items instead of blindly appending on duplicate id', () => {
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // The reducer should handle duplicate todo ids on add by replacing/upserting the existing item
  // (look for findIndex / some / replace logic within the ADD_TODO_ITEM case)
  assert.match(
    reducerBody,
    /case\s+['"]ADD_TODO_ITEM['"]:\s*\{[\s\S]*?(?:findIndex\(|\.some\(|replace\(|filter\(|splice\()/,
    'reducer should upsert existing TODOs when an item with the same id is added',
  );
});

// RED: will pass after Task 1 implementation (schema adds failed status)
test('structured output schema must include failed status for todoItems', () => {
  const schemaSource = readSource([joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')], 'structuredOutputSchema.ts');

  // The todoItems.status enum must include a 'failed' state to allow the reducer/UI to render failures
  assert.match(
    schemaSource,
    /\[\s*"pending"\s*,\s*"in_progress"\s*,\s*"completed"\s*,\s*"cancelled"\s*,[\s\S]*"failed"/,
    'structured output schema must include "failed" in todoItems status enum',
  );
});

// RED: will pass after Task 1 implementation (initState includes todos for rehydration)
test('initState payload sent to webview should include todoItems for session rehydration', () => {
  const chatProviderSource = readSource(
    [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
    'ChatViewProvider.ts',
  );

  // The provider must include todoItems in the initState payload when posting initial state to the webview
  assert.match(
    chatProviderSource,
    /postMessage\(\{[\s\S]*type:\s*["']initState["'][\s\S]*todoItems\s*:/,
    'initState payload should include todoItems to allow the webview to rehydrate todos',
  );
});

test('messageHandler exposes normalizeTodoRecord and ingestNormalizedTodo for unified todo ingestion', () => {
  assert.match(
    messageHandlerSource,
    /function\s+normalizeTodoRecord\(/,
    'messageHandler should define normalizeTodoRecord to validate incoming todo records',
  );

  assert.match(
    messageHandlerSource,
    /function\s+ingestNormalizedTodo\(/,
    'messageHandler should define ingestNormalizedTodo to ingest normalized todos',
  );

  // ingestNormalizedTodo should check existingIds.has and dispatch UPDATE_TODO_ITEM / ADD_TODO_ITEM
  assert.match(
    messageHandlerSource,
    /existingIds\.has\(item\.id\)/,
    'ingestNormalizedTodo must inspect existingIds to select add vs update path',
  );
  assert.match(
    messageHandlerSource,
    /type:\s*["']UPDATE_TODO_ITEM["']/,
    'ingestNormalizedTodo should dispatch UPDATE_TODO_ITEM for existing todo ids',
  );
  assert.match(
    messageHandlerSource,
    /type:\s*["']ADD_TODO_ITEM["']/,
    'ingestNormalizedTodo should dispatch ADD_TODO_ITEM for new todo ids',
  );
});

test('store lifecycle rank, upsert and terminal-immutability exist for todo reducer', () => {
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // LIFECYCLE_RANK must include failed and cancelled entries
  assert.match(
    storeSource,
    /const\s+LIFECYCLE_RANK:\s*Record<string,\s*number>\s*=\s*\{[\s\S]*failed:\s*2[\s\S]*cancelled:\s*2[\s\S]*\}/,
    'store should expose LIFECYCLE_RANK with failed and cancelled rank entries',
  );

  // UPDATE_TODO_ITEM must enforce terminal immutability and compare incomingRank/currentRank
  assert.match(
    reducerBody,
    /case\s+['"]UPDATE_TODO_ITEM['"]:\s*\{[\s\S]*isTerminalStatus\(it\.status\)[\s\S]*return it;[\s\S]*incomingRank\s*>\s*currentRank/,
    'UPDATE_TODO_ITEM should check terminal status and use lifecycle rank comparisons',
  );

  // ADD_TODO_ITEM should detect duplicate ids and apply rank-based upsert
  assert.match(
    reducerBody,
    /case\s+['"]ADD_TODO_ITEM['"]:\s*\{[\s\S]*const\s+idx\s*=\s*current\.findIndex\(\(it\)\s*=>\s*it\.id\s*===\s*action\.payload\.id\);[\s\S]*if\s*\(idx\s*>=?\s*0\)\s*\{[\s\S]*incomingRank\s*>\s*currentRank/,
    'ADD_TODO_ITEM must find existing item by id and use lifecycle rank to decide upsert vs ignore',
  );
});

test('types still include cancelled todo status (regression guard)', () => {
  const typesSource = readSource([
    joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'types.ts')
  ], 'types.ts');

  assert.match(
    typesSource,
    /'pending'\s*\|\s*'in_progress'\s*\|\s*'completed'\s*\|\s*'cancelled'\s*\|\s*'failed'/,
    'TodoItem.status union must still include cancelled and failed',
  );
});

test('PanelComponents still renders failed/cancelled icon for todo statuses', () => {
  const todoBody = extractFunctionBody(panelSource, 'export function TodoPanel()');
  assert.match(
    todoBody,
    /case\s+['"]failed['"]:[\s\S]*case\s+['"]cancelled['"]:[\s\S]*return\s+['"]❌['"]/,
    'PanelComponents should render an error icon for failed/cancelled todo states',
  );
});
