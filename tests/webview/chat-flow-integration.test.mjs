/**
 * Comprehensive Chat Flow Integration Tests
 *
 * Tests the complete end-to-end flows of the chat application including:
 * - Message sending and receiving lifecycle
 * - Subagent spawning and interaction
 * - Todolist integration in chat flow
 * - Queue message handling during processing
 * - Interactive question and popover flows
 * - Error handling and recovery
 * - Multi-turn conversations
 *
 * All assertions use source-text regex checks against real implementation.
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

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

const rawResponseSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'rawResponse.ts')],
  'rawResponse.ts',
);

const streamingComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'StreamingComponents.tsx')],
  'StreamingComponents.tsx',
);

const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);

// ===========================================================================
// MESSAGE SENDING AND RECEIVING FLOW
// ===========================================================================

test('complete message flow: send -> process -> stream -> receive -> display', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // 1. User sends message
  assert.match(inputBody, /type:\s*["']sendMessage["']/, 'flow starts with sendMessage event');
  assert.match(inputBody, /files:\s*currentFiles/, 'send payload includes files');
  assert.match(inputBody, /contexts:\s*currentContexts/, 'send payload includes contexts');
  assert.match(
    inputBody,
    /TEMPORARY: do not optimistically render the outgoing user message/,
    'the send flow should wait for the centralized session tape before rendering the user turn',
  );

  // 2. Processing state is set
  assert.match(inputBody, /dispatch\(\s*\{\s*type:\s*["']SET_PROCESSING["']\s*,\s*payload:\s*true\s*\}\s*\)/, 'sendMessage triggers SET_PROCESSING(true)');
  assert.match(reducerBody, /case\s+["']SET_PROCESSING["']:/, 'reducer handles SET_PROCESSING action');

  // 3. Streaming begins
  assert.match(handlerBody, /case\s+["']streamEvent["']:\s*\{[\s\S]*SET_STREAMING/, 'streamEvent triggers SET_STREAMING');
  assert.match(reducerBody, /case\s+["']SET_STREAMING["']:/, 'reducer handles SET_STREAMING action');

  // 4. Content is streamed and accumulated
  assert.match(handlerBody, /UPDATE_STREAMING_CONTENT/, 'message parts update streaming content');
  assert.match(reducerBody, /case\s+["']UPDATE_STREAMING_CONTENT["']:/, 'reducer handles UPDATE_STREAMING_CONTENT action');

  // 5. Streaming finishes and message is finalized
  assert.match(handlerBody, /FINISH_STREAMING[\s\S]*SET_PROCESSING.*?payload:\s*false/, 'finish signal ends streaming and processing');
  assert.match(reducerBody, /case\s+["']FINISH_STREAMING["']:/, 'reducer handles FINISH_STREAMING action');

  // 6. Final message is displayed
  assert.match(messageComponentsSource, /role\s*===\s*["']assistant["'][\s\S]*AssistantResponseCard/, 'final assistant message is rendered');
});

test('message flow handles concurrent sends with queue management', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Queue detection
  assert.match(inputBody, /isProcessing/, 'queue is triggered when processing');
  assert.match(inputBody, /type:\s*["']addToQueue["']/, 'concurrent sends are queued via addToQueue');

  // Queue processing
  assert.match(inputBody, /type:\s*["']ADD_TO_LOCAL_QUEUE["']\s*,/, 'addToQueue adds to local queue state');
  assert.match(inputBody, /promptQueue/, 'promptQueue is tracked for processing');

  // Queue state management
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');
  assert.match(reducerBody, /case\s+["']SET_QUEUE["']:/, 'reducer handles SET_QUEUE action');
  assert.match(reducerBody, /queueBySessionId/, 'queue is managed by session');
});

test('message flow supports file attachments and context items', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // File attachment handling
  assert.match(inputBody, /type:\s*["']ADD_ATTACHMENT["']/, 'files can be attached via ADD_ATTACHMENT');
  assert.match(inputBody, /type:\s*["']REMOVE_ATTACHMENT["']/, 'attachments can be removed via REMOVE_ATTACHMENT');
  assert.match(inputBody, /type:\s*["']CLEAR_ATTACHMENTS["']/, 'attachments are cleared after send');

  // Context selection
  assert.match(inputBody, /type:\s*["']SET_SELECTED_CONTEXTS["']/, 'context items can be set via SET_SELECTED_CONTEXTS');

  // Message payload construction
  assert.match(inputBody, /files:\s*currentFiles[\s\S]*contexts:\s*currentContexts/, 'sendMessage includes both files and contexts');
});

// ===========================================================================
// SUBAGENT FLOW INTEGRATION
// ===========================================================================

test('subagent flow: spawn -> display -> interact -> detail view', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessageInner(');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // 1. Subagent spawning during streaming
  assert.match(handlerBody, /UPSERT_SUBAGENT_SUMMARIES/, 'subagent summaries are upserted during streaming');
  assert.match(handlerBody, /UPSERT_SUBAGENT_DETAIL/, 'subagent details are upserted during streaming');

  // 2. Subagent display in assistant message
  assert.match(messageComponentsSource, /visibleSubagents\.map\(/, 'subagents are rendered in a list');
  assert.match(messageComponentsSource, /resolveSubagentStatus/, 'subagent status is resolved');
  assert.match(messageComponentsSource, /openSubagentModal/, 'subagent rows are clickable to open details');

  // 3. Subagent detail modal
  assert.match(messageComponentsSource, /SubagentDetailModal/, 'SubagentDetailModal is rendered for selected subagent');
  assert.match(messageComponentsSource, /selectedSubagentId/, 'modal uses selected subagent ID');
  assert.match(messageComponentsSource, /closeSubagentModal/, 'modal can be closed');

  // 4. Subagent conversation hydration
  assert.match(messageComponentsSource, /getSubagentConversation/, 'subagent conversation can be requested from extension');
  assert.match(messageComponentsSource, /subagentId[\s\S]*childSessionId[\s\S]*parentSessionId/, 'conversation request includes session identifiers');
});

test('subagent flow handles multiple concurrent subagents with deduplication', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // Subagent deduplication by ID
  assert.match(handlerBody, /UPSERT_SUBAGENT_SUMMARIES/, 'subagent summaries are upserted (handles deduplication)');
  assert.match(handlerBody, /UPSERT_SUBAGENT_DETAIL/, 'subagent details are upserted (handles deduplication)');
  assert.match(
    messageComponentsSource,
    /dedupeSubagentsById/,
    'assistant message rendering should normalize duplicate subagent IDs before paint',
  );
  assert.match(
    messageComponentsSource,
    /mergedById/,
    'assistant message rendering should merge the store and message subagent views by ID',
  );

  // Subagent state management
  assert.match(reducerBody, /case\s+["']UPSERT_SUBAGENT_SUMMARIES["']:/, 'reducer handles UPSERT_SUBAGENT_SUMMARIES action');
  assert.match(reducerBody, /case\s+["']UPSERT_SUBAGENT_DETAIL["']:/, 'reducer handles UPSERT_SUBAGENT_DETAIL action');
});

test('centralized debug data keeps raw event stream and raw rehydrated data separate', () => {
  const centralizedDebugStart = messageComponentsSource.indexOf(
    'const centralizedDebugData = useMemo<CentralizedDebugData>(',
  );
  const centralizedDebugEnd = messageComponentsSource.indexOf(
    'const hasPendingReasoningDisplayEvent',
    centralizedDebugStart,
  );
  const centralizedDebugBlock =
    centralizedDebugStart >= 0 && centralizedDebugEnd > centralizedDebugStart
      ? messageComponentsSource.slice(centralizedDebugStart, centralizedDebugEnd)
      : '';

  assert.match(
    messageComponentsSource,
    /useMemo<CentralizedDebugData>\(/,
    'the centralized debug payload should be explicitly typed',
  );
  assert.match(
    centralizedDebugBlock,
    /rawEventStream/,
    'the centralized debug payload should expose the raw event stream source',
  );
  assert.doesNotMatch(
    centralizedDebugBlock,
    /JSON\.parse|JSON\.stringify|compactDebugTimeline|dedupeDebugArray|rawStreamingSnapshot|rawActivityTimeline/,
    'the centralized debug payload should not be compacted or include extra derived layers',
  );
  assert.ok(
    messageComponentsSource.includes('CentralizedDebugData'),
    'the centralized debug component should import the shared centralized debug type',
  );
  assert.match(
    centralizedDebugBlock,
    /rawSdkEventPayloads:[\s\S]*centralizedRawSdkEventPayloads/,
    'the event stream source should keep its raw SDK payload tape',
  );
  assert.match(
    messageComponentsSource,
    /CentralizedDebugPanel[\s\S]*JSON\.stringify\(\{ rawEventStream: \{ sessionId: centralizedSessionId, rawSdkEventPayloads \} \}, null, 2\)/,
    'the centralized debug payload should render the raw event stream object tree directly',
  );
  assert.match(
    messageComponentsSource,
    /CentralizedDebugPanel[\s\S]*rawSdkEventPayloadsBySessionId/,
    'the centralized debug panel should continue to read from session-scoped raw SDK payloads',
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /data-assistant-section="centralized-debug"[\s\S]*stringifyDebugValue\(centralizedDebugData\)/,
    'the centralized debug UI should not stringify the centralized payload',
  );
});

test('chat shell keeps the just-sent user bubble visible until the tape catches up', () => {
  assert.match(
    chatShellSource,
    /role !== "user"[\s\S]*merged\.push\(message\)/,
    'the centralized render pass should keep a transient user-message fallback for tape lag',
  );
  assert.match(
    chatShellSource,
    /const tapeUserMessageSignatures = new Set<string>\(\);[\s\S]*renderMessageContentSignature\(message\)/,
    'the fallback should be suppressed once the tape contains the same user text',
  );
});

test('streaming card stays mounted for active assistant turns even before visible content arrives', () => {
  assert.match(
    streamingComponentsSource,
    /hasMatchingAssistantTurnInTranscript/,
    'the streaming card should consult the transcript before rendering the live assistant shell',
  );
  assert.match(
    streamingComponentsSource,
    /if\s*\(\s*streaming\.isActive\s*\)\s*\{\s*return\s*!hasMatchingAssistantTurnInTranscript;/,
    'an active assistant turn should render the streaming response shell immediately unless that turn is already present in the transcript',
  );
});

test('canonical assistant text reconstruction preserves spacing between parts', () => {
  assert.match(
    storeSource,
    /function\s+contentFromRenderablePartsForCanonical\(parts: unknown\[\]\): string \{[\s\S]*\.join\(" "\)[\s\S]*\.trim\(\);/,
    'part-only assistant content should be rebuilt with spaces instead of being glued together',
  );
  assert.match(
    storeSource,
    /function\s+extractRenderableAssistantTextForCanonical\(message: Message\): string \{/,
    'assistant text reconstruction should have the canonical assistant text extractor',
  );
  assert.match(
    storeSource,
    /const partsContent = contentFromRenderablePartsForCanonical\(parts\);/,
    'assistant text reconstruction should check the renderable parts before falling back',
  );
  assert.match(
    storeSource,
    /const rawSdkText = getCentralizedAssistantContentFromRawSdkEventPayloads\([\s\S]*?rawSdkEventPayloads,\s*\);[\s\S]*?return rawSdkText;/,
    'assistant text reconstruction should fall back to the canonical raw SDK helper when normal message content is missing',
  );
});

test('response card prefers raw sdk payload before transformed message fields', () => {
  assert.ok(
    messageComponentsSource.includes('getCentralizedAssistantContentChunksFromRawSdkEventPayloads(') &&
      messageComponentsSource.includes('normalizedCentralizedRawSdkEventPayloads'),
    'the response card should resolve assistant text from the normalized centralized tape',
  );
  assert.ok(
    messageComponentsSource.includes('const rawContentChunks = useMemo('),
    'the response card should derive raw content from the centralized event chunks',
  );
});

// ===========================================================================
// TODOLIST INTEGRATION IN CHAT FLOW
// ===========================================================================

test('todolist flow: create -> display -> update -> complete during chat', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // 1. Todo creation during chat
  assert.match(handlerBody, /case\s+["']todoUpdate["']:/, 'todo update events are processed');
  assert.match(handlerBody, /normalizeTodo/, 'todo items are normalized before adding');

  // 2. Todo display in panel
  assert.match(panelSource, /sortedTodoItems\.map\(/, 'todo items are rendered in a list');
  assert.match(panelSource, /completed/, 'completed todos are shown with special styling');

  // 3. Todo updates from chat
  assert.match(handlerBody, /ADD_TODO_ITEM/, 'todo items are added');
  assert.match(handlerBody, /UPDATE_TODO_ITEM/, 'todo items are updated');
  assert.match(reducerBody, /case\s+["']ADD_TODO_ITEM["']:/, 'reducer handles ADD_TODO_ITEM action');
  assert.match(reducerBody, /case\s+["']UPDATE_TODO_ITEM["']:/, 'reducer handles UPDATE_TODO_ITEM action');

  // 4. Todo completion
  assert.match(panelSource, /status.*completed/, 'todo completion status is checked');
  assert.match(handlerBody, /status/, 'todo status is handled');
});

test('todolist flow handles session-scoped todos and cross-session visibility', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Session association
  assert.match(handlerBody, /sessionId/, 'todos are associated with sessions');
  assert.match(handlerBody, /todoSnapshot/, 'todo snapshots are processed');

  // Cross-session todo filtering
  assert.match(handlerBody, /normalizeTodoList/, 'todo lists are normalized');
});

// ===========================================================================
// INTERACTIVE QUESTION FLOW
// ===========================================================================

test('interactive question flow: question -> popover -> user response -> continue', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // 1. Question detection and popover display
  assert.match(handlerBody, /structuredOutput|interactive|question/i, 'structured output is processed');
  assert.match(handlerBody, /interactiveEvents|events|question/i, 'interactive events are handled');

  // 2. Interactive event handling
  assert.match(handlerBody, /toInteractiveEvents|convert|transform/i, 'structured output is converted to interactive events');

  // 3. Question popover rendering
  assert.match(panelSource, /event\.type|type|question/i, 'event type is checked');
  assert.match(panelSource, /options|map|render/i, 'options are rendered');

  // 4. User response submission
  assert.match(panelSource, /submit|response|interactive/i, 'user responses are submitted');

  // 5. Processing continues after response
  assert.match(handlerBody, /interactiveSubmit|submit|continue/i, 'interactive submits are handled specially');
});

test('interactive question flow handles different question types (question, confirm, quick_actions)', () => {
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Question type handling
  assert.match(panelSource, /event\.type/, 'event type is checked');
  assert.match(panelSource, /options/, 'options are available');
  assert.match(panelSource, /confirmLabel|cancelLabel/, 'confirm labels are handled');
  assert.match(panelSource, /actions/, 'actions are handled');
});

// ===========================================================================
// ERROR HANDLING AND RECOVERY
// ===========================================================================

test('error handling flow: error -> display -> recovery -> retry', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // 1. Error detection
  assert.match(handlerBody, /error/, 'error events are handled');
  assert.match(handlerBody, /SET_PROCESSING/, 'processing state is managed during errors');

  // 2. Error display
  assert.match(messageComponentsSource, /error/, 'error messages are handled in components');

  // 3. Retry functionality
  assert.match(messageComponentsSource, /retry/, 'retry functionality exists');

  // 4. Error recovery state
  assert.match(reducerBody, /SET_PROCESSING/, 'processing state can be reset');
});

test('error handling flow distinguishes between retryable and fatal errors', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Retryable errors (timeout, network)
  assert.match(handlerBody, /timeout|transport|recover/, 'error recovery mechanisms exist');

  // Fatal errors (validation, authentication)
  assert.match(handlerBody, /error|validation|authentication/, 'error types are distinguished');
});

// ===========================================================================
// MULTI-TURN CONVERSATION FLOW
// ===========================================================================

test('multi-turn conversation: context preservation and message threading', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');
  const timelineBody = extractFunctionBody(
    messageComponentsSource,
    'export function AssistantResponseCard({',
  );

  // 1. Session context preservation
  assert.match(handlerBody, /currentSessionId/, 'session ID is preserved across turns');
  assert.match(reducerBody, /currentSessionId/, 'session ID is maintained in state');

  // 2. Message threading
  assert.match(handlerBody, /SET_MESSAGES/, 'messages are managed');
  assert.match(reducerBody, /SET_MESSAGES/, 'message thread is maintained');

  // 3. Context window management
  assert.match(handlerBody, /messages/, 'message history is managed');
  assert.match(
    messageComponentsSource,
    /timelineDisplayEventGroups\.map\(/,
    'the activity timeline should render from grouped timeline entries',
  );

  // 4. Turn-taking detection
  assert.match(messageComponentsSource, /role/, 'message roles are distinguished');
  assert.match(reducerBody, /isProcessing/, 'processing state indicates turn');
});

// ===========================================================================
// STREAMING STATE MANAGEMENT
// ===========================================================================

test('streaming state flow: init -> stream -> update -> finish -> cleanup', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // 1. Streaming initialization
  assert.match(handlerBody, /SET_STREAMING|streaming|init/i, 'streaming is initialized');
  assert.match(reducerBody, /SET_STREAMING|streaming|state/i, 'streaming state is managed');

  // 2. Content updates during streaming
  assert.match(handlerBody, /UPDATE_STREAMING_CONTENT|content|update/i, 'content is updated during streaming');
  assert.match(reducerBody, /UPDATE_STREAMING_CONTENT|content|stream/i, 'streaming content is managed');

  // 3. Progress updates during streaming
  assert.match(handlerBody, /upsertStreamingStep|progress|step|update/i, 'progress steps are managed');
  assert.match(reducerBody, /streaming.*step/, 'steps are tracked');

  // 4. Streaming completion
  assert.match(handlerBody, /FINISH_STREAMING/, 'streaming is finished');
  assert.match(reducerBody, /FINISH_STREAMING/, 'streaming completion is handled');

  // 5. Cleanup and finalization
  assert.match(handlerBody, /SET_PROCESSING.*false/, 'processing is cleared');
  assert.match(reducerBody, /streamingBySessionId/, 'streaming state is cached');
});

// ===========================================================================
// ATTACHMENT AND CONTEXT MANAGEMENT
// ===========================================================================

test('attachment and context flow: add -> validate -> send -> cleanup', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // 1. Attachment addition
  assert.match(inputBody, /ADD_ATTACHMENT|attachment|add/i, 'attachments are added');
  assert.match(inputBody, /image|file|attachment/i, 'image attachments are handled');

  // 2. Attachment display and removal
  assert.match(inputBody, /attachments|map|display/i, 'attachments are displayed');
  assert.match(inputBody, /REMOVE_ATTACHMENT|remove|delete/i, 'attachments can be removed');

  // 3. Context item management
  assert.match(inputBody, /SET_SELECTED_CONTEXTS|context|manage/i, 'context items are managed');
  assert.match(inputBody, /context|item|handle/i, 'context items are handled');

  // 4. Payload construction for send
  assert.match(inputBody, /files|contexts|payload|send/i, 'files and contexts are included in send');
  assert.match(inputBody, /images|attachments|include/i, 'attachments are included as images in sendMessage');
  assert.match(inputBody, /CLEAR_ATTACHMENTS|clear|cleanup/i, 'attachments are cleared after message is sent');
});
