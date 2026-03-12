import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

test('ChatViewProvider streams events to webview progressively', () => {
  const registerHandlersBody = extractFunctionBody(
    chatProviderSource,
    'resolveWebviewView(',
  );

  assert.match(
    registerHandlersBody,
    /this\.unsubscribe\s*=\s*this\.streamService\.subscribe\(/,
    'ChatViewProvider should subscribe to MessageStreamService'
  );

  assert.match(
    registerHandlersBody,
    /this\.logStreamEventDiagnostics\(event\)/,
    'ChatViewProvider should emit detailed diagnostics for each incoming stream event',
  );

  assert.match(
    registerHandlersBody,
    /const enrichedEvent\s*=\s*this\.enrichStreamEvent\(event\)/,
    'ChatViewProvider should enrich the raw stream event'
  );

  assert.match(
    registerHandlersBody,
    /this\.view\?\.webview\.postMessage\(\s*\{\s*type:\s*["']streamEvent["'],\s*event:\s*enrichedEvent,\s*\}\s*\)/,
    'ChatViewProvider should progressively dispatch streamEvent to the webview'
  );

  assert.match(
    registerHandlersBody,
    /console\.log\(\s*["']\[ChatViewProvider\] streamEvent forwarded["']/,
    'ChatViewProvider should log each forwarded streamEvent for debugging',
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

test('ChatViewProvider records streaming token usage during message.updated events', () => {
  const registerHandlersBody = extractFunctionBody(
    chatProviderSource,
    'resolveWebviewView(',
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
    chatProviderSource,
    'resolveWebviewView(',
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
    /const isToolDone = partType === "tool" && part\.state\?\.status === "done";/,
    'diff enrichment should detect completed tool events',
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
