/**
 * Queue Management Integration Tests
 *
 * Comprehensive tests for message queue functionality including:
 * - Queue creation and management
 * - Queue processing and execution
 * - Queue priority and ordering
 * - Queue UI integration
 * - Queue error handling and recovery
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);

// ===========================================================================
// QUEUE CREATION AND MANAGEMENT
// ===========================================================================

test('queue flow: concurrent send -> queue creation -> state update -> UI display', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // 1. Queue detection on concurrent sends
  assert.match(inputBody, /const\s+isProcessing\s*=\s*useSelector\(\s*state\s*=>\s*state\.isProcessing\s*\)/, 'processing state is checked');
  assert.match(inputBody, /const\s+streaming\s*=\s*useSelector\(\s*state\s*=>\s*state\.streaming\s*\)/, 'streaming state is checked');
  assert.match(inputBody, /isProcessing\s*\|\|\s*streaming\.isActive/, 'queue is triggered when processing or streaming active');

  // 2. Queue item creation
  assert.match(inputBody, /type:\s*["']addToQueue["'][\s\S]*text:\s*inputValue[\s\S]*files:\s*selectedFiles[\s\S]*contexts:\s*selectedContexts/, 'queue item contains message data');
  assert.match(inputBody, /timestamp:\s*Date\.now\(\)/, 'queue item is timestamped');

  // 3. Queue state update
  assert.match(handlerBody, /case\s+["']addToQueue["']:\s*\{[\s\S]*type:\s*["']ADD_QUEUE_ITEM"']\s*,\s*payload:\s*queueItem/, 'addToQueue dispatches ADD_QUEUE_ITEM');
  assert.match(reducerBody, /case\s+["']ADD_QUEUE_ITEM["']:\s*\{[\s\S]*queueItems:\s*\[\.\.\.state\.queueItems,\s*action\.payload\]/, 'queue items are appended to state');

  // 4. Queue UI display
  assert.match(inputBody, /queueItems\.length\s*>\s*0[\s\S]*Queue:\s*\{queueItems\.length\}/i, 'queue count is displayed');
  assert.match(inputBody, /<Queue[\s\S]*items=\{queueItems\}/, 'queue component receives items');
});

test('queue management: add -> remove -> reorder -> clear operations', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // Add to queue
  assert.match(inputBody, /type:\s*["']addToQueue["']/i, 'addToQueue event is dispatched');
  assert.match(handlerBody, /case\s+["']addToQueue["']:\s*\{[\s\S]*type:\s*["']ADD_QUEUE_ITEM"']/i, 'addToQueue is handled');

  // Remove from queue
  assert.match(inputBody, /onRemoveQueueItem\s*=\s*\{\(\)\s*=>\s*handleRemoveQueueItem\(item\.id\)\}/, 'remove handler exists');
  assert.match(inputBody, /type:\s*["']REMOVE_QUEUE_ITEM"'][\s\S]*id:\s*itemId/, 'REMOVE_QUEUE_ITEM event includes item ID');
  assert.match(reducerBody, /case\s+["']REMOVE_QUEUE_ITEM["']:\s*\{[\s\S]*queueItems:\s*state\.queueItems\.filter\(\s*item\s*=>\s*item\.id\s*!==\s*action\.payload\s*\)/, 'items are removed by ID');

  // Reorder queue
  assert.match(inputBody, /onReorderQueue\s*=\s*\{\(\)\s*=>\s*handleReorderQueue\(fromIndex,\s*toIndex\)\}/, 'reorder handler exists');
  assert.match(inputBody, /type:\s*["']REORDER_QUEUE_ITEM"'][\s\S]*fromIndex[\s\S]*toIndex/, 'REORDER_QUEUE_ITEM includes position info');
  assert.match(reducerBody, /case\s+["']REORDER_QUEUE_ITEM["']:\s*\{[\s\S]*queueItems\.splice\(\s*fromIndex,\s*1\s*\)[\s\S]*queueItems\.splice\(\s*toIndex,\s*0,\s*movedItem\s*\)/, 'queue items are reordered');

  // Clear queue
  assert.match(inputBody, /onClearQueue\s*=\s*\{\(\)\s*=>\s*handleClearQueue\(\)\}/, 'clear handler exists');
  assert.match(inputBody, /type:\s*["']CLEAR_QUEUE"']/i, 'CLEAR_QUEUE event is dispatched');
  assert.match(reducerBody, /case\s+["']CLEAR_QUEUE["']:\s*\{[\s\S]*queueItems:\s*\[\]/, 'queue is cleared');
});

// ===========================================================================
// QUEUE PROCESSING AND EXECUTION
// ===========================================================================

test('queue processing flow: processNextItem -> dequeue -> execute -> update status', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // 1. Process next item trigger
  assert.match(handlerBody, /case\s+["']processNextItem["']:\s*\{/, 'processNextItem event is handled');
  assert.match(handlerBody, /const\s+queueItems\s*=\s*getState\(\)\.queueItems\s*\|\|\s*\[\]/, 'current queue state is retrieved');
  assert.match(handlerBody, /if\s*\(\s*queueItems\.length\s*===\s*0\s*\)\s*\{[\s\S]*return;/, 'processing stops if queue is empty');

  // 2. Dequeue next item
  assert.match(handlerBody, /const\s+nextItem\s*=\s*queueItems\[0\]/, 'first item is dequeued');
  assert.match(handlerBody, /type:\s*["']REMOVE_QUEUE_ITEM"']\s*,\s*payload:\s*nextItem\.id/, 'item is removed from queue');
  assert.match(handlerBody, /type:\s*["']SET_QUEUE_PROCESSING"']\s*,\s*payload:\s*true/, 'queue processing state is set');

  // 3. Execute queued message
  assert.match(handlerBody, /type:\s*["']sendMessage"'][\s\S]*text:\s*nextItem\.text[\s\S]*files:\s*nextItem\.files/, 'dequeued item is sent as message');
  assert.match(handlerBody, /isQueueItem:\s*true/, 'message is marked as queue item');

  // 4. Update processing status
  assert.match(reducerBody, /case\s+["']SET_QUEUE_PROCESSING["']:\s*\{[\s\S]*isQueueProcessing:\s*action\.payload/, 'queue processing state is tracked');
  assert.match(handlerBody, /isQueueProcessing\s*\|\|\s*isProcessing/, 'queue processing affects UI behavior');

  // 5. Completion and next item trigger
  assert.match(handlerBody, /if\s*\(\s*!isProcessing\s*&&\s*queueItems\.length\s*>\s*0\s*\)\s*\{[\s\S]*processNextItem/, 'next item is processed when current completes');
  assert.match(handlerBody, /type:\s*["']SET_QUEUE_PROCESSING"']\s*,\s*payload:\s*false/, 'queue processing is cleared after completion');
});

test('queue processing handles priority and ordering', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Priority-based queue ordering
  assert.match(inputBody, /const\s+priority\s*=\s*item\.priority\s*\|\|\s*["']normal"']/i, 'queue items have priority');
  assert.match(inputBody, /high.*?medium.*?low/i, 'priority levels are defined');

  // FIFO vs priority ordering
  assert.match(inputBody, /queueItems\.sort\(\s*\(\s*a,\s*b\s*\)\s*=>\s*\{[\s\S]*return\s*b\.priority\s*-\s*a\.priority/i, 'queue is sorted by priority');
  assert.match(inputBody, /timestamp.*?older\s*first/i, 'timestamp is used as tiebreaker');

  // Queue position display
  assert.match(inputBody, /position:\s*index\s*\+\s*1/, 'queue position is calculated');
  assert.match(inputBody, /\#\{\s*position\s*\}/, 'position is displayed in UI');

  // Queue limit handling
  assert.match(inputBody, /maxQueueSize\s*=\s*10/, 'maximum queue size is defined');
  assert.match(inputBody, /queueItems\.length\s*>=\s*maxQueueSize[\s\S]*alert|warning/i, 'user is warned when queue is full');
});

// ===========================================================================
// QUEUE UI INTEGRATION
// ===========================================================================

test('queue UI flow: display -> interaction -> feedback -> updates', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Queue display in input area
  assert.match(inputBody, /queueItems\.length\s*>\s*0[\s\S]*<Queue[\s\S]*items=\{queueItems\}/, 'queue is shown when items exist');
  assert.match(inputBody, /Queue:\s*\{queueItems\.length\}/, 'queue count is displayed');
  assert.match(inputBody, /position.*?title.*?remove/i, 'queue items show position, title, and remove action');

  // Queue item components
  assert.match(inputBody, /QueueItem[\s\S]*item=\{item\}[\s\S]*index=\{index\}/, 'individual queue items are rendered');
  assert.match(inputBody, /onRemove\s*=\s*\{\(\)\s*=>\s*onRemoveQueueItem\(item\.id\)\}/, 'remove action is handled per item');

  // Queue interaction feedback
  assert.match(inputBody, /onRemoveQueueItem\s*=\s*\{\(\)\s*=>\s*\{[\s\S]*type:\s*["']REMOVE_QUEUE_ITEM"'][\s\S]*id:\s*itemId/, 'remove triggers state update');
  assert.match(inputBody, /const\s+handleRemoveQueueItem\s*=\s*\(\s*id:\s*string\s*\)\s*=>\s*\{[\s\S]*dispatch\(\{\s*type:\s*["']REMOVE_QUEUE_ITEM"']/, 'remove is dispatched immediately');

  // Queue processing feedback
  assert.match(inputBody, /isQueueProcessing\s*\|\|\s*isProcessing/, 'processing state affects queue UI');
  assert.match(inputBody, /queueProcessing.*?<Processing|Sending|Queueing>/i, 'processing status is shown');

  // Queue completion feedback
  assert.match(inputBody, /onQueueComplete\s*=\s*\{\(\)\s*=>\s*handleQueueComplete\(\)/, 'completion handler exists');
  assert.match(inputBody, /type:\s*["']QUEUE_ITEM_COMPLETED"'][\s\S]*success:\s*true/i, 'completion event indicates success');
});

test('queue UI handles empty and full queue states', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Empty queue state
  assert.match(inputBody, /queueItems\.length\s*===\s*0[\s\S]*<No\s+queue\s+items>/i, 'empty state shows message');
  assert.match(inputBody, /\{queueItems\.length\s*===\s*0\s*\?\s*null\s*:\s*<Queue/i, 'queue component is hidden when empty');

  // Full queue state
  assert.match(inputBody, /maxQueueSize\s*=\s*10/, 'maximum queue size is defined');
  assert.match(inputBody, /queueItems\.length\s*>=\s*maxQueueSize[\s\S]*disabled/i, 'add is disabled when queue is full');
  assert.match(inputBody, /Queue\s+full/i, 'warning is shown when queue is full');

  // Queue limit feedback
  assert.match(inputBody, /if\s*\(\s*queueItems\.length\s*>=\s*maxQueueSize\s*\)\s*\{[\s\S]*alert\(\s*["']Queue\s+is\s+full["']/i, 'user is alerted when queue is full');

  // Queue item limit
  assert.match(inputBody, /maxQueueItemsPerSession\s*=\s*20/i, 'session queue limit is defined');
  assert.match(inputBody, /totalQueued\s*>\s*maxQueueItemsPerSession[\s\S]*warning/i, 'session limit is enforced');
});

// ===========================================================================
// QUEUE ERROR HANDLING AND RECOVERY
// ===========================================================================

test('queue error handling: send failure -> retry -> skip -> continue', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Send failure detection
  assert.match(handlerBody, /catch\s*\(\s*error\s*\)\s*\{[\s\S]*logger\.error\(\s*["']Failed\s+to\s+send\s+queued\s+message["']/i, 'send failures are caught and logged');
  assert.match(handlerBody, /type:\s*["']QUEUE_ITEM_ERROR"'][\s\S]*error:\s*error\.message/i, 'error is recorded for queue item');

  // Error state in queue
  assert.match(inputBody, /item\.status\s*===\s*["']error"'][\s\S]*retry|error/i, 'error status is displayed');
  assert.match(inputBody, /item\.retryCount\s*>\s*3[\s\S]*failed/i, 'retry limit is enforced');

  // Retry mechanism
  assert.match(inputBody, /onRetryQueueItem\s*=\s*\{\(\)\s*=>\s*handleRetry\(item\.id\)\}/, 'retry handler exists');
  assert.match(handlerBody, /const\s*handleRetry\s*=\s*\(\s*id:\s*string\s*\)\s*=>\s*\{[\s\S]*type:\s*["']RETRY_QUEUE_ITEM"'][\s\S]*id:\s*itemId/, 'retry increments retry count');

  // Skip failed item
  assert.match(inputBody, /onSkipQueueItem\s*=\s*\{\(\)\s*=>\s*handleSkip\(item\.id\)\}/, 'skip handler exists');
  assert.match(inputBody, /type:\s*["']REMOVE_QUEUE_ITEM"'][\s\S]*id:\s*itemId/, 'skip removes item from queue');
  assert.match(handlerBody, /processNextItem\s*\(\)/, 'next item is processed after skip');

  // Continue processing after error
  assert.match(handlerBody, /if\s*\(\s*!error\s*\)\s*\{[\s\S]*processNextItem/, 'processing continues on success');
  assert.match(handlerBody, /type:\s*["']QUEUE_ITEM_COMPLETED"'][\s\S]*nextItem:\s*true/i, 'completion triggers next item');
});

test('queue error handling: processing failure -> rollback -> recovery', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // Processing failure detection
  assert.match(handlerBody, /try\s*\{\s*\.\.\.processing\s*\}\s*catch\s*\(\s*error\s*\)\s*\{[\s\S]*logger\.error\(\s*["']Queue\s+processing\s+failed["']/i, 'processing errors are caught');

  // Rollback to queue
  assert.match(handlerBody, /type:\s*["']ADD_QUEUE_ITEM"'][\s\S]*payload:\s*\{\s*\.\.\.failedItem,\s*status:\s*["']pending"']\s*\}/i, 'failed item is re-queued with pending status');
  assert.match(reducerBody, /case\s+["']ADD_QUEUE_ITEM["']:\s*\{[\s\S]*queueItems:\s*\[\.\.\.state\.queueItems,\s*action\.payload\]/, 're-queued item is added back');

  // Recovery state
  assert.match(handlerBody, /SET_QUEUE_PROCESSING\(\s*false\s*\)/, 'processing state is cleared on error');
  assert.match(reducerBody, /isQueueProcessing:\s*action\.payload/, 'queue processing state is updated');

  // User notification
  assert.match(inputBody, /error\s*&&\s*<.*?error.*?>/i, 'error is displayed to user');
  assert.match(inputBody, /retry\s*&&\s*<button[^>]*>.*?Retry.*?<\/button>/i, 'retry option is shown');
  assert.match(inputBody, /skip\s*&&\s*<button[^>]*>.*?Skip.*?<\/button>/i, 'skip option is shown');

  // Automatic retry logic
  assert.match(handlerBody, /if\s*\(\s*item\.retryCount\s*<\s*maxRetries\s*\)\s*\{[\s\S]*setTimeout\(\s*\(\s*\)\s*=>\s*processNextItem\(/i, 'automatic retry is attempted');
  assert.match(handlerBody, /retryDelay\s*=\s*Math\.pow\(\s*2,\s*item\.retryCount\s*\)\s*\*\s*1000/, 'exponential backoff is used');
});

// ===========================================================================
// QUEUE INTEGRATION WITH PROCESSING STATE
// ===========================================================================

test('queue integration with processing state: queue -> process -> complete -> next', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Queue when processing starts
  assert.match(inputBody, /isProcessing\s*\|\|\s*streaming\.isActive/, 'queue is triggered when processing starts');
  assert.match(inputBody, /if\s*\(\s*isProcessing\s*\|\|\s*isAiResponding\s*\)\s*\{[\s\S]*type:\s*["']addToQueue["']/, 'concurrent sends are queued');

  // Process when idle
  assert.match(handlerBody, /if\s*\(\s*!isProcessing\s*&&\s*queueItems\.length\s*>\s*0\s*\)\s*\{[\s\S]*processNextItem/, 'queue processing starts when idle');
  assert.match(handlerBody, /const\s+canProcessQueue\s*=\s*!isProcessing\s*&&\s*queueItems\.length\s*>\s*0/, 'queue processing conditions are checked');

  // Queue completion and next item
  assert.match(handlerBody, /if\s*\(\s*!isProcessing\s*&&\s*queueItems\.length\s*>\s*0\s*\)\s*\{[\s\S]*processNextItem/, 'next item starts after current completes');
  assert.match(handlerBody, /type:\s*["']processNextItem"'][\s\S]*dispatch\(\{\s*type:\s*["']processNextItem"']\)/, 'next item is triggered automatically');

  // Queue state cleanup
  assert.match(handlerBody, /queueItems\.length\s*===\s*0\s*&&\s*isQueueProcessing[\s\S]*SET_QUEUE_PROCESSING\(\s*false\s*\)/, 'queue processing state is cleared when empty');
  assert.match(handlerBody, /SET_QUEUE_PROCESSING.*?payload:\s*false/, 'queue processing is turned off');

  // Visual feedback during queue processing
  assert.match(inputBody, /isQueueProcessing.*?<Processing|Sending>/i, 'processing status is shown');
  assert.match(inputBody, /currentQueueItem.*?text.*?preview/i, 'current queue item is previewed');
  assert.match(inputBody, /queuePosition.*?of.*?total/i, 'queue position is displayed');
});

test('queue integration with steering: queue -> steer -> send -> continue', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Steer message functionality
  assert.match(inputBody, /type:\s*["']steerMessage"']/i, 'steerMessage event exists');
  assert.match(inputBody, /onSteer\s*=\s*\{\(\)\s*=>\s*handleSteer\(message\.text\)\}/, 'steer handler exists');
  assert.match(inputBody, /const\s*handleSteer\s*=\s*\(\s*text:\s*string\s*\)\s*=>\s*\{[\s\S]*type:\s*["']ADD_QUEUE_ITEM"'][\s\S]*steer:\s*true/, 'steer adds to queue with special flag');

  // Steer message handling
  assert.match(handlerBody, /case\s+["']steerMessage"']:\s*\{[\s\S]*type:\s*["']SET_STEERING"']\s*,\s*payload:\s*true/, 'steerMessage sets steering state');
  assert.match(handlerBody, /steer:\s*true.*?addToQueue/i, 'steer messages are added to queue');

  // Queue item with steer flag
  assert.match(inputBody, /item\.steer\s*=\s*true/, 'queue items can be marked as steer');
  assert.match(inputBody, /steer.*?<Steering|Guiding>/i, 'steer items show special indicator');

  // Send as steer vs normal message
  assert.match(inputBody, /item\.steer\s*\?\s*type:\s*["']steerMessage"']\s*:\s*type:\s*["']sendMessage"']/i, 'steer flag affects send type');
  assert.match(handlerBody, /steerMessage.*?steering.*?true/i, 'steer messages maintain steering state');

  // Continue queue after steer
  assert.match(handlerBody, /if\s*\(\s*!isProcessing\s*&&\s*queueItems\.length\s*>\s*0\s*\)\s*\{[\s\S]*processNextItem/, 'queue continues after steer');
  assert.match(handlerBody, /SET_STEERING.*?payload:\s*false/, 'steering state is cleared after steer completes');
});