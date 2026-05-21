import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource, readAllSources } from '../helpers/source-utils.mjs';

const storeSource = readAllSources(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);
const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const typesSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'types.ts')],
  'types.ts',
);
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
const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('happy path lifecycle supports pending -> in_progress -> completed rank progression', () => {
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  assert.match(
    storeSource,
    /const\s+LIFECYCLE_RANK:\s*Record<string,\s*number>\s*=\s*\{[\s\S]*pending:\s*0[\s\S]*in_progress:\s*1[\s\S]*completed:\s*2[\s\S]*\}/,
    'LIFECYCLE_RANK must encode pending(0), in_progress(1), completed(2)',
  );
  assert.match(
    reducerBody,
    /case\s+["']UPDATE_TODO_ITEM["']:\s*\{[\s\S]*incomingRank\s*>\s*currentRank[\s\S]*return\s+promoted;/,
    'UPDATE_TODO_ITEM should promote todo state when incoming rank is higher',
  );
});

test('failed lifecycle supports pending -> in_progress -> failed with terminal rank', () => {
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  assert.match(
    storeSource,
    /const\s+LIFECYCLE_RANK:\s*Record<string,\s*number>\s*=\s*\{[\s\S]*failed:\s*2[\s\S]*\}/,
    'LIFECYCLE_RANK should include failed at terminal rank 2',
  );
  assert.match(
    reducerBody,
    /isTerminalStatus\(it\.status\)\s*&&\s*incomingStatus\s*!==\s*it\.status/,
    'UPDATE_TODO_ITEM should prevent transitions away from terminal statuses',
  );
});

test('rank enforcement ignores stale or regressive updates', () => {
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  assert.match(
    reducerBody,
    /incomingRank\s*<\s*currentRank[\s\S]*return\s+it;/,
    'UPDATE_TODO_ITEM should ignore lower-rank stale updates',
  );
  assert.match(
    reducerBody,
    /incomingRank\s*===\s*currentRank[\s\S]*incomingStatus\s*===\s*it\.status[\s\S]*return\s+\{\s*\.\.\.it,\s*\.\.\.rest\s*\};/,
    'same-rank same-status update should only patch non-status fields',
  );
});

test('terminal states are immutable in both update and add paths', () => {
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  assert.match(
    reducerBody,
    /case\s+["']UPDATE_TODO_ITEM["']:[\s\S]*isTerminalStatus\(it\.status\)\s*&&\s*incomingStatus\s*!==\s*it\.status[\s\S]*return\s+it;/,
    'completed/failed todos should not transition back to non-terminal status in UPDATE_TODO_ITEM',
  );
  assert.match(
    reducerBody,
    /case\s+["']ADD_TODO_ITEM["']:[\s\S]*if\s*\(isTerminalStatus\(existing\.status\)\)\s*\{[\s\S]*return\s+state;/,
    'completed/failed todos should remain immutable when replayed through ADD_TODO_ITEM',
  );
});

test('messageHandler uses canonical normalization and ingestion for todo updates', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  assert.match(messageHandlerSource, /function\s+normalizeTodoRecord\(/, 'normalizeTodoRecord should exist');
  assert.match(messageHandlerSource, /function\s+ingestNormalizedTodo\(/, 'ingestNormalizedTodo should exist');
  assert.match(
    handlerBody,
    /case\s+["']todoUpdate["']:\s*\{[\s\S]*const\s+normalized\s*=\s*normalizeTodoRecord\(item\);[\s\S]*ingestNormalizedTodo\(dispatch,\s*getState,\s*normalized\)/,
    'todoUpdate event path should normalize and ingest through canonical pipeline',
  );
  assert.match(
    messageHandlerSource,
    /existingIds\.has\(item\.id\)[\s\S]*type:\s*['"]UPDATE_TODO_ITEM['"][\s\S]*type:\s*['"]ADD_TODO_ITEM['"]/,
    'ingestNormalizedTodo should route existing ids to UPDATE and new ids to ADD',
  );
  assert.match(
    typesSource,
    /status:\s*'pending'\s*\|\s*'in_progress'\s*\|\s*'completed'\s*\|\s*'cancelled'\s*\|\s*'failed';/,
    'TodoItem type should include failed terminal status',
  );
});

test('provider forwards SDK todo stream events and hydrates session todos from SDK', () => {
  assert.match(
    chatProviderSource,
    /handleSdkTodoUpdatedEvent\([\s\S]*todo\.updated/,
    'ChatViewProvider should forward SDK todo.updated events as todoSnapshot messages',
  );
  assert.match(
    chatProviderSource,
    /type:\s*["']todoSnapshot["']/,
    'ChatViewProvider should emit todoSnapshot messages',
  );
  assert.match(
    chatProviderSource,
    /client\.session\.todo\(\{[\s\S]*path:\s*\{\s*id:\s*sessionId\s*\}/,
    'ChatViewProvider should hydrate todos through client.session.todo',
  );
  assert.match(
    chatProviderSource,
    /normalizeSdkTodoItems\([\s\S]*todo\.content[\s\S]*todo\.priority[\s\S]*source:\s*["']sdk["']/,
    'ChatViewProvider should normalize SDK todo content, priority, and source',
  );
  assert.match(
    messageHandlerSource,
    /case\s+["']todoSnapshot["']:\s*\{[\s\S]*SET_TODO_ITEMS/,
    'messageHandler should replace todo state from todoSnapshot',
  );
});

test('TodoInlineSummary renders aggregate counts and latest transition label', () => {
  const summaryBody = extractFunctionBody(
    messageComponentsSource,
    'function TodoInlineSummary(',
  );

  assert.match(messageComponentsSource, /function\s+TodoInlineSummary\(/, 'TodoInlineSummary component should exist');
  assert.match(
    summaryBody,
    /const\s+inProgressCount\s*=\s*todoItems\.reduce\(/,
    'TodoInlineSummary should compute in-progress aggregate count',
  );
  assert.match(
    summaryBody,
    /const\s+completedCount\s*=\s*todoItems\.reduce\(/,
    'TodoInlineSummary should compute completed aggregate count',
  );
});
