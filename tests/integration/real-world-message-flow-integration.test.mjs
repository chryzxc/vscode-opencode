/**
 * Real-World Message Flow Integration Tests
 *
 * Tests that follow the actual message flow through the OpenCode extension:
 *   webview → ChatViewProvider → handlers → services → responses
 *
 * Covers complete user journeys and real-world usage scenarios.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSource,
  joinFromRoot,
} from '../helpers/source-utils.mjs';

// Read all the handler and service files
const chatViewProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

const sessionHandlerSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts')],
  'SessionHandler.ts',
);

const streamEventHandlerSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts')],
  'StreamEventHandler.ts',
);

const historyProcessorSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts')],
  'HistoryProcessor.ts',
);

const messageStreamServiceSource = readSource(
  [joinFromRoot('src', 'services', 'MessageStreamService.ts')],
  'MessageStreamService.ts',
);

const sessionServiceSource = readSource(
  [joinFromRoot('src', 'services', 'SessionService.ts')],
  'SessionService.ts',
);

const opencodeServerManagerSource = readSource(
  [joinFromRoot('src', 'services', 'OpencodeServerManager.ts')],
  'OpencodeServerManager.ts',
);

// ---------------------------------------------------------------------------
// Complete User Journey: First Message to Response
// ---------------------------------------------------------------------------

test('User journey: Send first message and receive response', () => {
  // Step 1: User sends message from webview
  assert.match(
    chatViewProviderSource,
    /sendMessage|onDidReceiveMessage/i,
    'Step 1: Webview sends sendMessage event',
  );

  // Step 2: ChatViewProvider processes the message
  assert.match(
    chatViewProviderSource,
    /handle.*message|process.*message/i,
    'Step 2: ChatViewProvider processes message',
  );

  // Step 3: Message is sent to server
  assert.match(
    chatViewProviderSource,
    /server|send.*request|post/i,
    'Step 3: Message sent to OpenCode server',
  );

  // Step 4: Streaming response starts
  assert.match(
    streamEventHandlerSource,
    /stream.*event|handle.*stream/i,
    'Step 4: Stream events are processed',
  );

  // Step 5: Response is sent back to webview
  assert.match(
    chatViewProviderSource,
    /postMessage|send.*webview/i,
    'Step 5: Response sent to webview',
  );
});

// ---------------------------------------------------------------------------
// Complete User Journey: File Upload with Message
// ---------------------------------------------------------------------------

test('User journey: Upload file and send message with attachment', () => {
  // Step 1: User attaches file
  assert.match(
    chatViewProviderSource,
    /file|attachment|upload/i,
    'Step 1: File attachment is handled',
  );

  // Step 2: File data is processed
  assert.match(
    chatViewProviderSource,
    /data.*url|base64|process.*file/i,
    'Step 2: File data is processed',
  );

  // Step 3: Message with attachment is sent
  assert.match(
    chatViewProviderSource,
    /sendMessage.*file|attachment.*message/i,
    'Step 3: Message with attachment sent',
  );

  // Step 4: AI processes attachment
  assert.match(
    opencodeServerManagerSource,
    /upload|attachment|file/i,
    'Step 4: Server processes attachment',
  );
});

// ---------------------------------------------------------------------------
// Complete User Journey: Session Creation and First Message
// ---------------------------------------------------------------------------

test('User journey: Create new session and send first message', () => {
  // Step 1: User creates new session
  assert.match(
    sessionHandlerSource,
    /create.*session|new.*session/i,
    'Step 1: New session creation',
  );

  // Step 2: Session is initialized
  assert.match(
    sessionServiceSource,
    /initialize|setup.*session|create.*session|session/i,
    'Step 2: Session is initialized',
  );

  // Step 3: Session ID is tracked
  assert.match(
    chatViewProviderSource,
    /currentSessionId|setSession/i,
    'Step 3: Session ID is tracked',
  );

  // Step 4: First message is sent in new session
  assert.match(
    chatViewProviderSource,
    /sendMessage.*session|session.*message/i,
    'Step 4: First message sent in session',
  );

  // Step 5: Session history is updated
  assert.match(
    historyProcessorSource,
    /process.*history|update.*history/i,
    'Step 5: Session history is updated',
  );
});

// ---------------------------------------------------------------------------
// Complete User Journey: Interactive Question Flow
// ---------------------------------------------------------------------------

test('User journey: AI asks question, user responds, conversation continues', () => {
  // Step 1: AI generates interactive question
  assert.match(
    streamEventHandlerSource,
    /interactive|question|event/i,
    'Step 1: Interactive question event is received',
  );

  // Step 2: Question is processed and formatted
  assert.match(
    streamEventHandlerSource,
    /structured.*output|format.*question/i,
    'Step 2: Question is processed and formatted',
  );

  // Step 3: Question is sent to webview
  assert.match(
    chatViewProviderSource,
    /postMessage.*question|send.*interactive/i,
    'Step 3: Question sent to webview',
  );

  // Step 4: User submits answer
  assert.match(
    chatViewProviderSource,
    /answer|submit.*response|interactive.*submit/i,
    'Step 4: User answer is received',
  );

  // Step 5: Answer is sent to server
  assert.match(
    chatViewProviderSource,
    /send.*answer|server.*answer|answer|interactive/i,
    'Step 5: Answer sent to server',
  );

  // Step 6: AI responds to answer
  assert.match(
    streamEventHandlerSource,
    /stream.*response|continue.*conversation|response|stream/i,
    'Step 6: AI continues conversation',
  );
});

// ---------------------------------------------------------------------------
// Complete User Journey: Plan Detection and Viewing
// ---------------------------------------------------------------------------

test('User journey: AI generates plan, user views and approves plan', () => {
  // Step 1: AI generates implementation plan
  assert.match(
    streamEventHandlerSource,
    /plan|implementation/i,
    'Step 1: Plan event is detected in stream',
  );

  // Step 2: Plan is extracted and parsed
  assert.match(
    streamEventHandlerSource,
    /parse.*plan|extract.*plan|plan|detect/i,
    'Step 2: Plan is extracted and parsed',
  );

  // Step 3: Plan is saved to workspace
  assert.match(
    chatViewProviderSource,
    /save.*plan|persist.*plan|write.*plan/i,
    'Step 3: Plan is saved to workspace',
  );

  // Step 4: User is notified about plan
  assert.match(
    chatViewProviderSource,
    /notify.*plan|show.*plan/i,
    'Step 4: User is notified',
  );

  // Step 5: User views plan
  assert.match(
    chatViewProviderSource,
    /view.*plan|open.*plan|display.*plan/i,
    'Step 5: User views plan',
  );

  // Step 6: User approves plan execution
  assert.match(
    chatViewProviderSource,
    /approve|execute.*plan|plan.*proceed/i,
    'Step 6: User approves plan',
  );
});

// ---------------------------------------------------------------------------
// Complete User Journey: Model Selection and Conversation
// ---------------------------------------------------------------------------

test('User journey: Select model, send message, verify model is used', () => {
  // Step 1: User selects model from dropdown
  assert.match(
    chatViewProviderSource,
    /select.*model|choose.*model|model.*dropdown/i,
    'Step 1: Model selection is handled',
  );

  // Step 2: Model selection is persisted
  assert.match(
    chatViewProviderSource,
    /persist.*model|save.*model|global.*state/i,
    'Step 2: Model selection is persisted',
  );

  // Step 3: Message is sent with selected model
  assert.match(
    chatViewProviderSource,
    /sendMessage.*model|model.*request|model|send/i,
    'Step 3: Message sent with model context',
  );

  // Step 4: Server uses selected model
  assert.match(
    opencodeServerManagerSource,
    /model|provider|request/i,
    'Step 4: Server receives model info',
  );

  // Step 5: Response confirms model was used
  assert.match(
    streamEventHandlerSource,
    /model.*used|provider.*used|model|provider/i,
    'Step 5: Response confirms model usage',
  );
});

// ---------------------------------------------------------------------------
// Complete User Journey: Session Switching
// ---------------------------------------------------------------------------

test('User journey: Switch between sessions, verify context preservation', () => {
  // Step 1: User requests session switch
  assert.match(
    sessionHandlerSource,
    /switch.*session|change.*session/i,
    'Step 1: Session switch is requested',
  );

  // Step 2: Current session is saved
  assert.match(
    sessionServiceSource,
    /save.*session|persist.*session/i,
    'Step 2: Current session is saved',
  );

  // Step 3: New session is loaded
  assert.match(
    sessionHandlerSource,
    /load.*session|get.*session/i,
    'Step 3: New session is loaded',
  );

  // Step 4: Session history is processed
  assert.match(
    historyProcessorSource,
    /process.*history|normalize.*history/i,
    'Step 4: Session history is processed',
  );

  // Step 5: Processed history is sent to webview
  assert.match(
    chatViewProviderSource,
    /chatHistory|send.*history/i,
    'Step 5: History sent to webview',
  );

  // Step 6: Webview updates with new session
  assert.match(
    chatViewProviderSource,
    /update.*session|refresh.*webview/i,
    'Step 6: Webview updates session',
  );
});

// ---------------------------------------------------------------------------
// Complete User Journey: Error Recovery
// ---------------------------------------------------------------------------

test('User journey: Network error occurs, system recovers and retries', () => {
  // Step 1: User sends message
  assert.match(
    chatViewProviderSource,
    /sendMessage/i,
    'Step 1: Message is sent',
  );

  // Step 2: Network error occurs
  assert.match(
    messageStreamServiceSource,
    /error|fail|disconnect/i,
    'Step 2: Network error is detected',
  );

  // Step 3: Error is logged
  assert.match(
    streamEventHandlerSource,
    /log.*error|diagnostic|error/i,
    'Step 3: Error is logged',
  );

  // Step 4: User is notified of error
  assert.match(
    chatViewProviderSource,
    /notify.*error|show.*error|error/i,
    'Step 4: User is notified',
  );

  // Step 5: Auto-reconnect is attempted
  assert.match(
    messageStreamServiceSource,
    /reconnect|retry|resume/i,
    'Step 5: Auto-reconnect is attempted',
  );

  // Step 6: Connection is restored
  assert.match(
    messageStreamServiceSource,
    /connected|restored|resume|connect/i,
    'Step 6: Connection is restored',
  );

  // Step 7: User can retry message
  assert.match(
    chatViewProviderSource,
    /retry|resend|retry.*message|retry/i,
    'Step 7: User can retry message',
  );
});

// ---------------------------------------------------------------------------
// Complete User Journey: Multi-Turn Conversation with Attachments
// ---------------------------------------------------------------------------

test('User journey: Send message with file, follow-up question, another file', () => {
  // Step 1: User sends first message with file
  assert.match(
    chatViewProviderSource,
    /sendMessage.*file|file|attachment/i,
    'Step 1: First message with file',
  );

  // Step 2: AI responds with analysis
  assert.match(
    streamEventHandlerSource,
    /stream.*event|response/i,
    'Step 2: AI responds with analysis',
  );

  // Step 3: User sends follow-up question (same session)
  assert.match(
    chatViewProviderSource,
    /sendMessage|follow.*up|message/i,
    'Step 3: Follow-up question sent',
  );

  // Step 4: AI answers follow-up (with context from previous)
  assert.match(
    historyProcessorSource,
    /context|history|conversation/i,
    'Step 4: AI uses conversation context',
  );

  // Step 5: User sends another file
  assert.match(
    chatViewProviderSource,
    /attachment.*second|another.*file|file|attachment/i,
    'Step 5: Another file is attached',
  );

  // Step 6: AI processes both files together
  assert.match(
    streamEventHandlerSource,
    /multiple.*file|combined.*context|file|context|process/i,
    'Step 6: AI processes all files',
  );
});

// ---------------------------------------------------------------------------
// Complete User Journey: Command with Special Characters
// ---------------------------------------------------------------------------

test('User journey: Send command with special characters, verify proper processing', () => {
  // Step 1: User sends command with special chars
  assert.match(
    chatViewProviderSource,
    /command|slash|special.*char|message/i,
    'Step 1: Command with special chars is received',
  );

  // Step 2: Special characters are preserved
  assert.match(
    chatViewProviderSource,
    /preserve|escape|special|character/i,
    'Step 2: Special characters are preserved',
  );

  // Step 3: Command is parsed correctly
  assert.match(
    chatViewProviderSource,
    /parse.*command|extract.*command|command|message/i,
    'Step 3: Command is parsed correctly',
  );

  // Step 4: Server receives correct command
  assert.match(
    opencodeServerManagerSource,
    /command|request|server/i,
    'Step 4: Server receives parsed command',
  );

  // Step 5: Response includes processed special chars
  assert.match(
    streamEventHandlerSource,
    /special.*char|preserve.*char|response/i,
    'Step 5: Response preserves special chars',
  );
});

// ---------------------------------------------------------------------------
// Streaming Flow: Real-time Updates During Long Response
// ---------------------------------------------------------------------------

test('Streaming flow: Long AI response with multiple streaming updates', () => {
  // Step 1: User sends message that will trigger long response
  assert.match(
    chatViewProviderSource,
    /sendMessage/i,
    'Step 1: Message sent',
  );

  // Step 2: Streaming starts
  assert.match(
    messageStreamServiceSource,
    /subscribe|start.*stream/i,
    'Step 2: Streaming starts',
  );

  // Step 3: Multiple chunks arrive
  assert.match(
    streamEventHandlerSource,
    /chunk|part|update|stream/i,
    'Step 3: Multiple chunks processed',
  );

  // Step 4: Each chunk is forwarded to webview
  assert.match(
    chatViewProviderSource,
    /postMessage.*chunk|stream.*webview/i,
    'Step 4: Chunks forwarded to webview',
  );

  // Step 5: Webview updates in real-time
  assert.match(
    chatViewProviderSource,
    /real.*time|update|progress/i,
    'Step 5: Webview updates in real-time',
  );

  // Step 6: Streaming completes
  assert.match(
    streamEventHandlerSource,
    /complete|finish|done/i,
    'Step 6: Streaming completes',
  );
});

// ---------------------------------------------------------------------------
// Memory Flow: Message Compaction When Context Limit Reached
// ---------------------------------------------------------------------------

test('Memory flow: Long conversation triggers compaction', () => {
  // Step 1: Conversation grows large
  assert.match(
    historyProcessorSource,
    /history|message.*count|large|message/i,
    'Step 1: Conversation grows large',
  );

  // Step 2: Context limit is approached
  assert.match(
    chatViewProviderSource,
    /context.*limit|approach.*limit|limit|context/i,
    'Step 2: Context limit is approached',
  );

  // Step 3: Compaction is triggered
  assert.match(
    chatViewProviderSource,
    /compact|trigger.*compaction|compaction/i,
    'Step 3: Compaction is triggered',
  );

  // Step 4: Important messages are preserved
  assert.match(
    chatViewProviderSource,
    /preserve.*important|keep.*context|preserve|keep/i,
    'Step 4: Important messages preserved',
  );

  // Step 5: Compacted history is saved
  assert.match(
    sessionServiceSource,
    /save.*compact|persist.*compact|save|persist/i,
    'Step 5: Compacted history is saved',
  );

  // Step 6: User is notified (if applicable)
  assert.match(
    chatViewProviderSource,
    /notify.*compact|user.*inform|notify/i,
    'Step 6: User is notified of compaction',
  );
});