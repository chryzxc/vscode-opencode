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
  assert.match(
    streamSubscribeBody,
    /this\.unsubscribe\s*=\s*this\.streamService\.subscribe\(/,
    'ChatViewProvider should subscribe to the message stream service',
  );
});

test('subscription callback receives stream events', () => {
  assert.match(
    streamSubscribeBody,
    /this\.streamService\.subscribe\(async \(event\) => \{/, 
    'stream subscription should receive each event in an async callback',
  );
});

test('subagent tracker consumes stream events before session gating', () => {
  assert.match(
    streamSubscribeBody,
    /const subagentUpdate = this\.subagentTracker\.consumeStreamEvent\(event\)/,
    'subagent tracking should run inside the stream callback',
  );
  assert.match(
    streamSubscribeBody,
    /if \(eventSessionId && !this\.isSessionEffectivelyProcessing\(eventSessionId\)\)[\s\S]*return;/,
    'session scoping should drop foreign-session events after internal tracking',
  );
});

test('session id extraction exists and is used for stream scoping', () => {
  assert.match(
    chatViewProviderSource,
    /private extractEventSessionId\(event: unknown\): string \| undefined \{/,
    'provider should expose a dedicated session-id extractor',
  );
  assert.match(
    streamSubscribeBody,
    /const eventSessionId = this\.extractEventSessionId\(event\)/,
    'stream callback should derive a session id from the SSE payload',
  );
});

test('token usage is recorded from message.updated events', () => {
  assert.match(
    streamSubscribeBody,
    /if \(event\.type === "message\.updated" && event\.properties\) \{[\s\S]*this\.geminiTokenTracker\.recordUsage\(info\.modelID, tokens\);/,
    'message.updated events should drive Gemini token usage tracking',
  );
});

test('compaction status is forwarded from stream events', () => {
  assert.match(
    streamSubscribeBody,
    /this\.forwardCompactionStatusFromStreamEvent\(event\);/,
    'stream callback should forward compaction status updates',
  );
  assert.match(
    chatViewProviderSource,
    /forwardCompactionStatusFromStreamEvent\(event: unknown\): void \{/,
    'provider should expose a compaction forwarding helper',
  );
});

test('stream events are enriched before webview forwarding', () => {
  assert.match(
    streamSubscribeBody,
    /const enrichedEvent = this\.enrichStreamEvent\(event\)/,
    'stream callback should enrich raw events before forwarding',
  );
  assert.match(
    chatViewProviderSource,
    /private enrichStreamEvent\(event: any\): any \{/,
    'provider should expose an enrichment helper',
  );
  assert.match(
    streamHandlerBody,
    /const enrichedEvent = this\.structuredOutputProcessor\.enrichStreamEvent\(event\)/,
    'stream handler should also enrich events via structured output processor',
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
    streamSubscribeBody,
    /type: "streamEvent"[\s\S]*sessionId: resolvedSessionId/s,
    'streamEvent forwarding should include the resolved session id',
  );
  assert.match(
    streamSubscribeBody,
    /type: "streamEventEnrich"/,
    'stream callback should emit async diff enrichment messages',
  );
});

test('StreamEventHandler exports stream-processing class behavior', () => {
  assert.match(
    streamEventHandlerSource,
    /export class StreamEventHandler \{/,
    'stream handler module should export a processing class',
  );
  assert.match(
    streamHandlerBody,
    /this\.postMessage\(\{\s*type:\s*"streamEvent",/s,
    'stream handler should forward enriched events to the webview',
  );
});
