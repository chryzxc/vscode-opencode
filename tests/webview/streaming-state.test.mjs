/**
 * Streaming State Tests
 *
 * Tests for streaming display functionality including:
 * - Early streaming state creation on SET_PROCESSING
 * - Type-safe helper functions for agent/model info
 * - Text part bootstrapping for streaming
 * - Enhanced StreamingCard visibility logic
 * - Defensive null/undefined checks
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource, readAllSources } from '../helpers/source-utils.mjs';

// Load source files
const storeSource = readAllSources(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);
const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);
const streamingComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'StreamingComponents.tsx')],
  'StreamingComponents.tsx',
);
const chatViewProviderSource = readSource(
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

test('SET_PROCESSING reducer creates streaming state when processing starts', () => {
  // Verify that when processing starts, a streaming state is created
  const setProcessingCase = storeSource.match(
    /case ['"]SET_PROCESSING['"]:[\s\S]*?case ['"][\w]+['"]:|case ['"]SET_PROCESSING['"]:[\s\S]*?\n\s{2}\}/
  );

  assert.ok(setProcessingCase, 'SET_PROCESSING case should exist in reducer');

  const processingLogic = setProcessingCase[0];

  // Check for streaming state creation when processing becomes true
  assert.match(
    processingLogic,
    /if\s*\(\s*action\.payload\s*&&\s*!state\.streaming\s*\)/,
    'Should create a fresh stream when processing starts and no stream snapshot exists'
  );

  assert.match(
    processingLogic,
    /if\s*\(\s*action\.payload\s*&&\s*state\.streaming\s*&&\s*!state\.streaming\.isActive\s*\)/,
    'Should reactivate an existing inactive stream snapshot instead of recreating it'
  );

  assert.match(
    processingLogic,
    /streamingState:\s*StreamingState\s*=\s*\{/,
    'Should create a StreamingState object with proper typing'
  );

  // Verify the streaming state has all required fields
  assert.match(
    processingLogic,
    /messageId:\s*null/,
    'StreamingState should have messageId: null'
  );

  assert.match(
    processingLogic,
    /isActive:\s*true/,
    'StreamingState should have isActive: true'
  );

  assert.match(
    processingLogic,
    /content:\s*['"]{2}/,
    'StreamingState should have empty content initially'
  );

  assert.match(
    processingLogic,
    /reasoning:\s*['"]{2}/,
    'StreamingState should have empty reasoning initially'
  );

  // Verify error handling
  assert.match(
    processingLogic,
    /try\s*\{/,
    'Should have try-catch for error handling'
  );

  assert.match(
    processingLogic,
    /logger\.error\s*\(\s*['"]\s*Error creating streaming state/,
    'Should log errors if streaming state creation fails'
  );
});

test('StreamingCard matches transcript ownership using centralized assistant ids', () => {
  assert.match(
    streamingComponentsSource,
    /transcriptAssistantMessageIds\?: string\[];/,
    'StreamingCard should accept centralized transcript assistant ids instead of the full legacy message list',
  );
  assert.match(
    streamingComponentsSource,
    /transcriptAssistantMessageIds\.some\(\(messageId\) => candidateIds\.has\(messageId\)\)/,
    'StreamingCard should decide duplicate ownership from centralized transcript assistant ids',
  );
  assert.doesNotMatch(
    streamingComponentsSource,
    /messages\.some\(\(message\)/,
    'StreamingCard should no longer scan the legacy messages list to decide transcript ownership',
  );
  assert.match(
    streamingComponentsSource,
    /hasTranscriptAssistantForCurrentTurn\?: boolean;/,
    'StreamingCard should accept a current-turn transcript ownership flag',
  );
});

test('SET_PROCESSING keeps completed streaming state when processing ends', () => {
  const setProcessingCase = storeSource.match(
    /case ['"]SET_PROCESSING['"]:[\s\S]*?case ['"][\w]+['"]:|case ['"]SET_PROCESSING['"]:[\s\S]*?\n\s{2}\}/
  );

  assert.ok(setProcessingCase, 'SET_PROCESSING case should exist');

  const processingLogic = setProcessingCase[0];

  // Check that processing=false branch no longer wipes streaming immediately.
  assert.match(
    processingLogic,
    /if\s*\(\s*!action\.payload\s*\)/,
    'Should check if processing is false'
  );

  assert.doesNotMatch(
    processingLogic,
    /if\s*\(\s*!action\.payload\s*\)\s*\{[\s\S]*streaming:\s*null/s,
    'Should not clear streaming in SET_PROCESSING(false); explicit lifecycle handlers clear it'
  );

  assert.match(
    processingLogic,
    /return\s*\{\s*\.\.\.state,\s*isProcessing:\s*false(?:\s*,\s*isSteering:\s*false)?\s*\}/,
    'Should end processing while preserving the latest streaming snapshot'
  );
});

test('shouldBootstrapStreamingFromPart includes text parts', () => {
  // Verify that text parts can bootstrap streaming state
  const functionBody = extractFunctionBody(
    messageHandlerSource,
    'function shouldBootstrapStreamingFromPart'
  );

  assert.ok(functionBody, 'shouldBootstrapStreamingFromPart function should exist');

  // Check that 'text' is included in bootstrap conditions
  assert.match(
    functionBody,
    /partType\s*===\s*['"]text['"]/,
    'Should include text parts for bootstrapping streaming state'
  );

  // Verify other bootstrap types are still there
  assert.match(
    functionBody,
    /['"]reasoning['"]|['"]step-start['"]|['"]tool['"]|['"]patch['"]/,
    'Should still include reasoning, step-start, tool, and patch parts'
  );
});

test('createMessageHandler sets processing before handling message types', () => {
  // Verify that processing flag is set before stream events are handled
  const createMessageHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler'
  );

  assert.ok(createMessageHandlerBody, 'createMessageHandler function should exist');

  // Check for the processing flag check
  assert.match(
    createMessageHandlerBody,
    /asBoolean\(data\.processing/,
    'Should check data.processing flag'
  );

  // Verify the processing check comes before the switch statement
  const processingIndex = createMessageHandlerBody.search(/asBoolean\(data\.processing/);
  const switchIndex = createMessageHandlerBody.search(/switch\s*\(\s*type\s*\)/);

  assert.ok(
    processingIndex > 0 && switchIndex > 0 && processingIndex < switchIndex,
    'Processing check should occur before switch statement'
  );

  assert.match(
    createMessageHandlerBody,
    /type:\s*"SET_PROCESSING",\s*payload:\s*true/,
    'Should dispatch SET_PROCESSING with true when data.processing is true'
  );
});


test('assistant burst coalescing preserves aborted state for interrupted turns', () => {
  assert.match(
    messageHandlerSource,
    /const wasAborted = burst\.some\([\s\S]*?base\.aborted = true;[\s\S]*?base\.info = \{ \.\.\.infoRec, aborted: true \};/s,
    'assistant burst coalescing should carry aborted state forward when merges happen after stop',
  );
});

test('createMessageHandler handles stopRequestHandled by finalizing streaming', () => {
  const createMessageHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler'
  );

  assert.ok(createMessageHandlerBody, 'createMessageHandler function should exist');

  assert.match(
    createMessageHandlerBody,
    /case\s*["']stopRequestHandled["']\s*:/,
    'Should handle stopRequestHandled messages from the provider'
  );

  assert.match(
    createMessageHandlerBody,
    /case\s*["']stopRequestHandled["']\s*:[\s\S]*type:\s*["']SET_PROCESSING["']\s*,\s*payload:\s*false/s,
    'stopRequestHandled should clear processing state'
  );

  assert.match(
    createMessageHandlerBody,
    /case\s*["']stopRequestHandled["']\s*:[\s\S]*type:\s*["']SET_ASSISTANT_TURN_PENDING["'][\s\S]*pending:\s*false/s,
    'stopRequestHandled should clear assistantTurnPending so the stop button disappears'
  );

  assert.match(
    createMessageHandlerBody,
    /case\s*["']stopRequestHandled["']\s*:[\s\S]*type:\s*["']FINISH_STREAMING["']/s,
    'stopRequestHandled should finalize the streaming snapshot'
  );

  assert.match(
    createMessageHandlerBody,
    /case\s*["']stopRequestHandled["']\s*:[\s\S]*type:\s*["']SET_INTERACTIVE_EVENTS["']\s*,\s*payload:\s*\[\]/s,
    'stopRequestHandled should clear stale interactive events so previous questions are not replayed',
  );
});

test('getAgentName helper provides type-safe agent name extraction', () => {
  // Verify the type-safe helper function exists
  assert.match(
    messageComponentsSource,
    /function getAgentName\(/,
    'getAgentName helper function should exist'
  );

  const functionBody = extractFunctionBody(
    messageComponentsSource,
    'function getAgentName'
  );

  assert.ok(functionBody, 'getAgentName function body should be extracted');

  // Check for defensive programming - no type assertions on potentially undefined values
  assert.doesNotThrow(
    () => {
      const hasUnsafeAssertion = /as string\s*\?\?\s*undefined/.test(functionBody);
      if (hasUnsafeAssertion) {
        throw new Error('Found unsafe type assertion');
      }
    },
    'Should not use unsafe type assertions'
  );

  // Verify multiple fallback sources are checked
  assert.match(
    functionBody,
    /message\?\.info\?\.agent/,
    'Should check message.info.agent (nested structure)'
  );

  assert.match(
    functionBody,
    /["']agent["']\s+in\s+message/,
    'Should check message.agent property existence (backwards compatibility)'
  );

  assert.match(
    functionBody,
    /streaming\?\.agent/,
    'Should check streaming.agent (real-time streaming)'
  );

  assert.match(
    functionBody,
    /return\s*['"]assistant['"]/,
    'Should return "assistant" as final fallback'
  );

  // Verify typeof checks for type safety
  assert.match(
    functionBody,
    /typeof\s+\w+\s*===\s*['"]string['"]/,
    'Should use typeof checks for type safety'
  );
});

test('getTokenInfo helper provides type-safe token extraction', () => {
  // Verify the type-safe helper function exists and has proper structure
  assert.match(
    messageComponentsSource,
    /function getTokenInfo\(/,
    'getTokenInfo helper function should exist'
  );

  // Check that the function has the right return type
  assert.match(
    messageComponentsSource,
    /function getTokenInfo\([^)]*\)[\s\S]*?\{\s*input\?\s*:\s*number/,
    'getTokenInfo should have correct return type'
  );

  // Check for early return on undefined message
  assert.match(
    messageComponentsSource,
    /if\s*\(\s*!message\s*\)/,
    'Should guard against undefined message'
  );

  // Check for nested info structure
  assert.match(
    messageComponentsSource,
    /message\.info\?\.tokens/,
    'Should check message.info.tokens (nested structure)'
  );

  // Check for backwards compatibility using 'in' operator
  assert.match(
    messageComponentsSource,
    /["']tokens["']\s+in\s+message/,
    'Should check for tokens property existence (backwards compatibility)'
  );
});

test('getDuration helper provides type-safe duration extraction', () => {
  // Verify the type-safe helper function exists
  assert.match(
    messageComponentsSource,
    /function getDuration\(/,
    'getDuration helper function should exist'
  );

  const functionBody = extractFunctionBody(
    messageComponentsSource,
    'function getDuration'
  );

  assert.ok(functionBody, 'getDuration function body should be extracted');

  // Check for streaming state first (most common case)
  assert.match(
    functionBody,
    /streaming\?\.usage\?\.duration/,
    'Should check streaming.usage.duration first (most common)'
  );

  // Check for early return on undefined message
  assert.match(
    functionBody,
    /if\s*\(\s*!message\s*\)\s*\{/,
    'Should guard against undefined message'
  );

  // Check for !== undefined instead of truthy checks
  assert.match(
    functionBody,
    /!==\s*undefined/,
    'Should use !== undefined checks instead of truthy checks'
  );

  // Check for property existence before accessing
  assert.match(
    functionBody,
    /["']duration["']\s+in\s+\w+/,
    'Should use "in" operator to check property existence'
  );

  // Check for defensive timing.duration access
  assert.match(
    functionBody,
    /message\.timing\s*&&\s*["']duration["']\s+in\s+message\.timing/,
    'Should check timing exists before accessing timing.duration'
  );
});

test('AssistantMessage uses type-safe helpers instead of type assertions', () => {
  // Check that the AssistantMessage function exists
  assert.ok(
    messageComponentsSource.includes('AssistantResponseCard'),
    'AssistantResponseCard export should exist'
  );

  // Verify helpers are used in the source
  assert.match(
    messageComponentsSource,
    /const agentName = turnMetadata\.agent \|\| getAgentName\(message,\s*streaming\)/,
    'Should use getAgentName helper'
  );

  assert.match(
    messageComponentsSource,
    /const tokens = getTokenInfo\(message\)/,
    'Should use getTokenInfo helper'
  );

  assert.match(
    messageComponentsSource,
    /const duration = getDuration\(message,\s*streaming\)/,
    'Should use getDuration helper'
  );

  // Should NOT have unsafe type assertions (checking for common patterns)
  const assistantStart = messageComponentsSource.indexOf('export function AssistantResponseCard');
  const assistantEnd = messageComponentsSource.indexOf('export const PermissionCard');
  const assistantMessageSection =
    assistantStart >= 0 && assistantEnd > assistantStart
      ? [messageComponentsSource.slice(assistantStart, assistantEnd)]
      : null;

  assert.ok(assistantMessageSection, 'Should find AssistantMessage function');

  const unsafeAssertionPatterns = [
    /\(message as Record<string, unknown>\)\.agent/g,
    /\(message as Record<string, unknown>\)\.tokens/g,
    /\(message as Record<string, unknown>\)\.duration/g,
  ];

  let totalUnsafeAssertions = 0;
  for (const pattern of unsafeAssertionPatterns) {
    const matches = assistantMessageSection[0].match(pattern);
    if (matches) {
      totalUnsafeAssertions += matches.length;
    }
  }

  assert.ok(
    totalUnsafeAssertions === 0,
    `Should not have unsafe type assertions for agent/tokens/duration (found ${totalUnsafeAssertions})`
  );
});

test('StreamingCard visibility hides when the same assistant turn is already in the transcript', () => {
  // Verify enhanced visibility conditions in the full source (works with memo wrapper)
  assert.match(
    streamingComponentsSource,
    /const visible = useMemo/,
    'Should use useMemo for visibility calculation'
  );

  assert.match(
    streamingComponentsSource,
    /hasMatchingAssistantTurnInTranscript/,
    'Should compute whether the transcript already contains the current assistant turn'
  );

  assert.match(
    streamingComponentsSource,
    /transcriptAssistantMessageIds\?: string\[];/,
    'Should use centralized transcript assistant ids when checking for duplicates'
  );

  assert.match(
    streamingComponentsSource,
    /if\s*\(\s*hasMatchingAssistantTurnInTranscript\s*\)\s*return false;/s,
    'Should hide the live streaming card once the same assistant turn is already rendered in the transcript'
  );
  assert.match(
    streamingComponentsSource,
    /if\s*\(\s*hasTranscriptAssistantForCurrentTurn\s*\)\s*return false;/s,
    'Should hide the live streaming card once any transcript assistant card already owns the current turn'
  );

  assert.match(
    streamingComponentsSource,
    /\[\s*hasMatchingAssistantTurnInTranscript,\s*hasTranscriptAssistantForCurrentTurn,\s*interactiveEvents,\s*streaming,\s*subagentsByParentMessageId,\s*\]/,
    'Should include the duplicate-suppression guard in the memo dependencies'
  );

  assert.match(
    streamingComponentsSource,
    /if\s*\(\s*!streaming\s*\)/,
    'Should check streaming exists'
  );

  assert.doesNotMatch(
    streamingComponentsSource,
    /step\.partType === "step-finish" \|\| step\.partType === "step-stop"/,
    'StreamingCard should not gate the whole wrapper on a terminal step marker'
  );

  assert.match(
    streamingComponentsSource,
    /streaming\.content\.trim\(\)\.length > 0/,
    'Should still require visible assistant content'
  );

  assert.match(
    streamingComponentsSource,
    /streaming\.reasoning\.trim\(\)\.length > 0/,
    'Should still allow reasoning content once terminal'
  );

  assert.match(
    streamingComponentsSource,
    /streaming\.edits\.length > 0/,
    'Should still allow edit metadata once terminal'
  );

  // Verify early return for visibility
  assert.match(
    streamingComponentsSource,
    /if\s*\(\s*!visible\s*\|\|\s*!streaming\s*\)\s*return\s*null/,
    'Should return null early if not visible or no streaming state'
  );
});

test('ChatViewProvider has logger with error handling', () => {
  // Verify logger is initialized in ChatViewProvider
  assert.match(
    chatViewProviderSource,
    /private readonly logger: ReturnType<typeof createLogger>/,
    'ChatViewProvider should have logger property with correct type'
  );

  // Verify logger is initialized in constructor
  const constructorBody = extractFunctionBody(
    chatViewProviderSource, 'constructor('
  );

  assert.ok(constructorBody, 'Constructor should exist');

  assert.match(
    constructorBody,
    /this\.logger\s*=\s*createLogger\(LoggingCategories\.CHAT_VIEW\)/,
    'Logger should be initialized in constructor with the CHAT_VIEW category'
  );

  // Verify stream event logging has error handling
  assert.match(
    chatViewProviderSource,
    /try\s*\{[\s\S]*logger\.aiStreamEvent|streamService/,
    'Stream event logging should have try-catch'
  );

  assert.match(
    chatViewProviderSource,
    /catch\s*\(error\)\s*\{[\s\S]*(console\.error|logger\.error)/,
    'Stream event logging should catch and log errors'
  );
});

test('buildStreamingMessage includes model/agent metadata', () => {
  // Verify buildStreamingMessage populates info with metadata
  const functionBody = extractFunctionBody(
    messageHandlerSource,
    'function buildStreamingMessage'
  );

  assert.ok(functionBody, 'buildStreamingMessage function should exist');

  // Check that info object is created with metadata
  assert.match(
    functionBody,
    /info:\s*{/,
    'buildStreamingMessage should create info object'
  );

  assert.match(
    functionBody,
    /agent:\s*streaming\.agent/,
    'info should include agent from streaming state'
  );

  assert.match(
    functionBody,
    /model:\s*streaming\.model/,
    'info should include model from streaming state'
  );

  assert.match(
    functionBody,
    /modelID:\s*streaming\.modelID/,
    'info should include modelID from streaming state'
  );

  assert.match(
    functionBody,
    /providerID:\s*streaming\.providerID/,
    'info should include providerID from streaming state'
  );
});

test('StreamingState type includes model/agent metadata fields', () => {
  // Verify StreamingState type has all required fields
  const typesSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'types.ts')],
    'types.ts',
  );

  assert.match(
    typesSource,
    /export interface StreamingState/,
    'StreamingState interface should exist'
  );

  // Verify new metadata fields exist anywhere in the interface
  assert.match(
    typesSource,
    /agent\?\s*:\s*string/,
    'StreamingState should have optional agent field'
  );

  assert.match(
    typesSource,
    /model\?\s*:\s*{/,
    'StreamingState should have optional model object field'
  );

  assert.match(
    typesSource,
    /modelID\?\s*:\s*string/,
    'StreamingState should have optional modelID field'
  );

  assert.match(
    typesSource,
    /providerID\?\s*:\s*string/,
    'StreamingState should have optional providerID field'
  );
});

test('modelLabel function handles both nested and top-level model properties', () => {
  // Verify modelLabel function exists and handles both structures
  assert.match(
    messageComponentsSource,
    /function modelLabel\(/,
    'modelLabel function should exist'
  );

  const functionBody = extractFunctionBody(
    messageComponentsSource,
    'function modelLabel'
  );

  assert.ok(functionBody, 'modelLabel function body should be extracted');

  // Check for nested info structure
  assert.match(
    functionBody,
    /message\.info\?\.model/,
    'Should check message.info.model (nested structure)'
  );

  // Check for top-level model (backwards compatibility)
  assert.match(
    functionBody,
    /typeof message\.model\s*===\s*['"]object['"]/,
    'Should check message.model (top-level, backwards compatibility)'
  );

  // Check for modelID/providerID fallbacks
  assert.match(
    functionBody,
    /message\.info\?\.modelID/,
    'Should check info.modelID as fallback'
  );

  assert.match(
    functionBody,
    /message\.info\?\.providerID/,
    'Should check info.providerID as fallback'
  );
});
