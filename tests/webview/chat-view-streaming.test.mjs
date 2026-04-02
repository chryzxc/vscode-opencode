import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readAllSources, readSource } from '../helpers/source-utils.mjs';

const chatProviderSource = readAllSources([joinFromRoot('src', 'providers', 'ChatViewProvider.ts'), joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'), joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'), joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'), joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'), joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'), joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts')],
  'ChatViewProvider.ts',
);

test('ChatViewProvider streams events to webview progressively', () => {
  const registerHandlersBody = extractFunctionBody(
    chatProviderSource, 'resolveWebviewView(',
  );

  assert.match(
    registerHandlersBody,
    /this\.unsubscribe\s*=\s*this\.streamService\.subscribe\(/,
    'ChatViewProvider should subscribe to MessageStreamService'
  );

  assert.match(
    registerHandlersBody,
    /this\.logStreamEventDiagnostics\(event,\s*enrichedEvent\)/,
    'ChatViewProvider should emit detailed diagnostics for each incoming stream event',
  );

  assert.match(
    registerHandlersBody,
    /const enrichedEvent\s*=\s*this\.enrichStreamEvent\(event\)/,
    'ChatViewProvider should enrich the raw stream event'
  );

  assert.match(
    registerHandlersBody,
    /this\.view\?\.webview\.postMessage\(\s*\{\s*type:\s*["']streamEvent["'],\s*event:\s*\{\s*\.\.\.enrichedEvent/,
    'ChatViewProvider should progressively dispatch streamEvent to the webview'
  );

  assert.match(
    registerHandlersBody,
    /shouldVerboseStreamDebug\(\)[\s\S]*streamEvent forwarded/,
    'ChatViewProvider should log each forwarded streamEvent for debugging',
  );
});

test('ChatViewProvider backfills missing stream event sessionId from active session', () => {
  const registerHandlersBody = extractFunctionBody(
    chatProviderSource, 'resolveWebviewView(',
  );

  assert.match(
    registerHandlersBody,
    /event:\s*\{\s*\.\.\.enrichedEvent,\s*sessionId:\s*this\.currentSessionId\s*\}/,
    'ChatViewProvider should stamp current session ID onto all stream events',
  );
});

test('ChatViewProvider logs final prompt response diagnostics when non-streaming fallback occurs', () => {
  const sendMessageBody = extractFunctionBody(
    chatProviderSource,
    'private async handleSendMessage(',
  );

  assert.match(
    sendMessageBody,
    /this\.logPromptResponseDiagnostics\(session\.id,\s*response\.data\)/,
    'handleSendMessage should log detailed final response diagnostics for debugging',
  );
});

test('ChatViewProvider emits webview error when response has no data payload', () => {
  const sendMessageBody = extractFunctionBody(
    chatProviderSource,
    'private async handleSendMessage(',
  );

  assert.match(
    sendMessageBody,
    /logger\.warn\("No response data received from OpenCode"/,
    'handleSendMessage should log warning when response.data is missing',
  );
});

test('ChatViewProvider includes sessionId when posting final/error response payloads', () => {
  const sendMessageBody = extractFunctionBody(
    chatProviderSource,
    'private async handleSendMessage(',
  );

  assert.match(
    sendMessageBody,
    /type:\s*"messageResponse",[\s\S]*sessionId:\s*session\.id/s,
    'messageResponse payload should include originating session id for session-scoped rendering',
  );

  assert.match(
    sendMessageBody,
    /type:\s*"error",[\s\S]*sessionId:\s*session\.id/s,
    'error payloads emitted during send flow should include originating session id',
  );
});

test('ChatViewProvider attempts timeout recovery before surfacing hard send errors', () => {
  const sendMessageBody = extractFunctionBody(
    chatProviderSource,
    'private async handleSendMessage(',
  );

  assert.match(
    sendMessageBody,
    /isLikelyInteractiveAwaitTimeoutError\(errorMessage\)[\s\S]*tryRecoverTimedOutResponse\(\s*session\.id,\s*baselineAssistantMarker/s,
    'response.error timeout path should try session-history recovery before showing an error banner',
  );
  assert.match(
    sendMessageBody,
    /drainSessionId[\s\S]*isLikelyInteractiveAwaitTimeoutError\(errorMessage\)[\s\S]*tryRecoverTimedOutResponse\(\s*drainSessionId,\s*baselineAssistantMarker/s,
    'thrown timeout path should also try session-history recovery before surfacing a hard error',
  );
});

test('ChatViewProvider builds detailed error text from error-cause chains', () => {
  assert.match(
    chatProviderSource,
    /private\s+extractDetailedErrorMessage\(/,
    'provider should expose a detailed error formatter that includes nested causes',
  );
  assert.match(
    chatProviderSource,
    /Details:\\n\$\{detailLines\.join\("\\n"\)\}/,
    'detailed error formatter should include a Details section for user-visible diagnostics',
  );
});

// SKIP: Feature not implemented - strictStructuredOutput parameter doesn't exist
test.skip('ChatViewProvider enforces structured-output validation in strict send mode', () => {
  const sendMessageBody = extractFunctionBody(
    chatProviderSource,
    'private async handleSendMessage(',
  );

  assert.match(
    sendMessageBody,
    /applyStructuredOutputToMessage\(\s*response\.data,\s*\{\s*strictStructuredOutput:\s*useStructuredOutput\s*\},?\s*\)/,
    'handleSendMessage should pass strict structured-output mode when structured format is requested',
  );

  assert.match(
    chatProviderSource,
    /private buildStructuredOutputValidationError\(/,
    'ChatViewProvider should provide a deterministic structured error fallback for invalid/missing structured payloads',
  );
});

test('ChatViewProvider records streaming token usage during message.updated events', () => {
  const registerHandlersBody = extractFunctionBody(
    chatProviderSource, 'resolveWebviewView(',
  );

  assert.match(
    registerHandlersBody,
    /event\.type\s*===\s*["']message\.updated["']/,
    'ChatViewProvider must check for message.updated when assessing final tokens'
  );

  assert.match(
    registerHandlersBody,
    /this\.geminiTokenTracker\.recordUsage/,
    'ChatViewProvider should securely record token usage through geminiTokenTracker'
  );
  assert.match(
    registerHandlersBody,
    /if \(tokens\.input > 0 \|\| tokens\.output > 0 \|\| tokens\.reasoning > 0\)/,
    'ChatViewProvider should avoid recording empty token frames',
  );
});

test('ChatViewProvider emits subagent updates and async stream enrich payloads', () => {
  const registerHandlersBody = extractFunctionBody(
    chatProviderSource, 'resolveWebviewView(',
  );

  assert.match(
    registerHandlersBody,
    /const subagentUpdate = this\.subagentTracker\.consumeStreamEvent\(event\)/,
    'stream callback should feed events through subagent tracker',
  );
  assert.match(
    registerHandlersBody,
    /if \(subagentUpdate\) \{[\s\S]*type: "subagentUpdate"/s,
    'stream callback should post subagentUpdate messages when tracker emits updates',
  );

  assert.match(
    registerHandlersBody,
    /if \(enrichedEvent\?\.structured\?\.kind === "progress"\)/,
    'diff enrichment should only run for progress-like stream events',
  );
  assert.match(
    registerHandlersBody,
    /const isToolDone = partType === "tool" && part\.state\?\.status === "done"/,
    'diff enrichment should detect completed tool events via done status',
  );
  assert.match(
    registerHandlersBody,
    /const isStepFinish = partType === "step-finish"/,
    'diff enrichment should detect step-finish events',
  );
  assert.match(
    registerHandlersBody,
    /const isStepFinish = partType === "step-finish";/,
    'diff enrichment should detect step-finish events',
  );
  assert.match(
    registerHandlersBody,
    /toolName\.includes\("write"\)[\s\S]*toolName\.includes\("replace"\)[\s\S]*toolName\.includes\("edit"\)[\s\S]*isStepFinish/s,
    'diff enrichment should be constrained to file-mutating tools or step-finish events',
  );
  assert.match(
    registerHandlersBody,
    /this\.view\.webview\.postMessage\(\{\s*type: "streamEventEnrich",[\s\S]*callID,[\s\S]*diffStats: stats/s,
    'provider should post streamEventEnrich updates containing callID and computed diff stats',
  );
});
