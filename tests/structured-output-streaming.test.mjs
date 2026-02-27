import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);
const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

test('chat provider configures json_schema output format with compatibility fallback', () => {
  const helperBody = extractFunctionBody(
    chatProviderSource,
    'private async promptWithStructuredOutput(',
  );

  assert.match(chatProviderSource, /type:\s*"json_schema"/, 'structured output should use json_schema format');
  assert.match(helperBody, /outputFormat:\s*schema/, 'first attempt should use outputFormat key');
  assert.match(helperBody, /format:\s*schema/, 'fallback attempt should support legacy format key');
  assert.match(helperBody, /structuredOutputMode\s*=\s*"disabled"/, 'provider should disable structured mode when unsupported');
});

test('chat provider enriches streaming events with structured metadata', () => {
  const enrichBody = extractFunctionBody(
    chatProviderSource,
    'private enrichStreamEvent(event: any): any',
  );

  assert.match(enrichBody, /kind\s*=\s*"thinking"/, 'stream enrichment should classify thinking events');
  assert.match(enrichBody, /kind\s*=\s*"progress"/, 'stream enrichment should classify progress events');
  assert.match(enrichBody, /kind\s*=\s*"message"/, 'stream enrichment should classify message events');
  assert.match(enrichBody, /next\.structured\s*=\s*\{/, 'stream enrichment should attach structured metadata');
});

test('webview stream handler consumes structured metadata and structured outputs', () => {
  assert.match(messageHandlerSource, /function normalizeStructuredOutput\(/, 'message handler should parse structured outputs');
  assert.match(messageHandlerSource, /const structuredKind = asString\(structuredRecord\?\.kind\)/, 'message handler should read structured stream kind metadata');
  assert.match(messageHandlerSource, /if \(finish && structuredOutput\)/, 'message.updated handling should consume structured output on completion');
});
