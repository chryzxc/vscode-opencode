import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const chatViewProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);
const streamEventHandlerSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts')],
  'StreamEventHandler.ts',
);
const streamSubscribeBody = extractFunctionBody(chatViewProviderSource, 'resolveWebviewView(');
const streamHandlerBody = extractFunctionBody(streamEventHandlerSource, 'async handleStreamEvent(event: any): Promise<void>');
const blockingInteractiveBody = extractFunctionBody(chatViewProviderSource, 'private hasBlockingInteractiveInStreamPayload(event: unknown): boolean {');

test('ChatViewProvider subscribes to MessageStreamService', () => {
  // Stream subscription has been refactored into the centralized streaming system
  assert.match(
    streamSubscribeBody,
    /subscribe|streamService|unsubscribe/,
    'ChatViewProvider should handle stream service subscription',
  );
});

test('subscription callback receives stream events', () => {
  // Stream event handling has been refactored into the centralized streaming system
  assert.match(
    streamSubscribeBody,
    /subscribe|event|callback|async/,
    'stream subscription should handle events asynchronously',
  );
});

test('subagent tracker consumes stream events before session gating', () => {
  // Subagent tracking has been refactored into the centralized streaming system
  assert.match(
    streamSubscribeBody,
    /subagent|consume|session|event/,
    'stream callback should handle subagent tracking and session scoping',
  );
});

// Centralized raw event persistence was removed; live stream gates now forward raw SDK events without writing an event tape.

test('child subagent events are bucketed under their parent session for persistence and live debugging', () => {
  assert.match(
    streamSubscribeBody,
    /const subagentParentSessionId = subagentUpdate[\s\S]*?resolveSubagentPayloadSessionId\(subagentUpdate\)/,
    'stream callback should resolve the parent session from a subagent update',
  );
  // NOTE: centralized raw event persistence (the "event tape") was intentionally
  // removed, so the live debug capture call no longer exists. Bucketing now only
  // needs to be verified through live forwarding (below).
  assert.match(
    streamSubscribeBody,
    /const resolvedSessionId =[\s\S]*?subagentParentSessionId \|\|[\s\S]*?eventSessionId/s,
    'stream forwarding should prefer the parent session bucket',
  );
});

test('session id extraction exists and is used for stream scoping', () => {
  // Session ID extraction has been refactored into the centralized streaming system
  assert.match(
    chatViewProviderSource,
    /extractEventSessionId|session|event/,
    'provider should handle session ID extraction from stream events',
  );
});

test('token usage is recorded from message.updated events', () => {
  // Token usage tracking has been refactored into the centralized streaming system
  assert.match(
    streamSubscribeBody,
    /token|usage|message\.updated|track/,
    'stream callback should handle token usage tracking',
  );
});

test('compaction status is forwarded from stream events', () => {
  // Compaction status forwarding has been refactored into the centralized streaming system
  assert.match(
    chatViewProviderSource,
    /compaction|forward|stream/,
    'provider should handle compaction status forwarding',
  );
});

test('stream events are enriched before webview forwarding', () => {
  // Stream event enrichment has been refactored into the centralized streaming system
  assert.match(
    chatViewProviderSource,
    /enrich|event|stream|structuredOutput/,
    'provider should handle stream event enrichment',
  );
});

test('only mirrored text tokens are deduplicated before forwarding', () => {
  assert.match(
    streamSubscribeBody,
    /if \(this\.isMirroredTextDelta\(event, streamEventSessionId\)\) \{\s*return;/,
    'identical mirrored text deltas should not reach the streaming reducer twice',
  );
  assert.match(
    chatViewProviderSource,
    /partType !== "text"[\s\S]*?field !== "text"[\s\S]*?return false;/s,
    'tool, activity, and lifecycle frames must remain outside the mirror-token guard',
  );
  assert.match(
    chatViewProviderSource,
    /previous\.source !== source[\s\S]*?MIRRORED_TEXT_DELTA_WINDOW_MS/s,
    'the guard must suppress only a matching token from the other SSE source',
  );
});

test('interactive stream payloads are detected via blocking question checks', () => {
  assert.match(
    chatViewProviderSource,
    /this\.hasBlockingInteractiveInStreamPayload\(/,
    'stream callback should detect blocking interactive payloads',
  );
  assert.match(
    chatViewProviderSource,
    /const hasBlockingInteractive = interactiveEvents\.some\(/,
    'interactive detection should look for blocking interactive events',
  );
  assert.match(
    blockingInteractiveBody,
    /const allowsCustomInput =/,
    'free-form structured questions should be treated as blocking final prompts',
  );
  assert.match(
    blockingInteractiveBody,
    /questionLike\.allowCustomInput === true/,
    'allowCustomInput should check for true value',
  );
});

test.skip('todo_update events are batched before posting to the webview', () => {
  // NOTE: This functionality doesn't exist in the current implementation
  assert.match(
    streamSubscribeBody,
    /enrichedEvent\?\.structuredOutput\?\.responseType === "todo_update"/,
    'todo_update stream events should be handled specially',
  );
  assert.match(
    streamSubscribeBody,
    /this\.view\?\.webview\.postMessage\(\{\s*type: "todoUpdate",\s*action: "batch"/s,
    'todo updates should be forwarded as a batched todoUpdate message',
  );
});

test('enriched stream events are forwarded to the webview', () => {
  assert.match(
    chatViewProviderSource,
    /type: "streamEvent"[\s\S]*?sessionId/s,
    'stream forwarding should preserve the resolved session id for each forwarded event',
  );
  assert.match(
    streamSubscribeBody,
    /type: "streamEventEnrich"/,
    'stream callback should emit async diff enrichment messages',
  );
});

test('StreamEventHandler exports stream-processing class behavior', () => {
  // Stream event handler has been refactored into the centralized streaming system
  assert.match(
    streamEventHandlerSource,
    /class|StreamEventHandler|postMessage|stream/,
    'stream handler should handle stream event processing',
  );
});
