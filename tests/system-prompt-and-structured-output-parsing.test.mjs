import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const providerSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

test('ChatViewProvider does not inject wrapper system prompts in send path', () => {
  const handleSendMessageBody = extractFunctionBody(
    providerSource,
    'private async handleSendMessage(',
  );

  assert.ok(!handleSendMessageBody.includes('getSystemInstruction()'), 'send path should not call getSystemInstruction');
  assert.ok(!handleSendMessageBody.includes('getLegacySystemInstruction()'), 'send path should not call getLegacySystemInstruction');
});

test('ChatViewProvider keeps legacy instruction stripping for transcript hygiene only', () => {
  const processHistoryBody = extractFunctionBody(
    providerSource,
    'private processHistoryMessages(rawMessages: any[]): any[]',
  );
  const stripBody = extractFunctionBody(
    providerSource,
    'private stripLegacyInstruction(text: string): string',
  );

  assert.match(processHistoryBody, /this\.stripLegacyInstruction\(p\.text\)/, 'history processor should strip legacy instruction text');
  assert.match(stripBody, /getLegacySystemInstruction\(\)/, 'strip helper should compare against legacy instruction text');
});

test('ChatViewProvider structured extraction reads explicit structured channels only', () => {
  const extractBody = extractFunctionBody(
    providerSource,
    'private extractStructuredOutput(',
  );

  assert.match(extractBody, /messageLike\.structuredOutput/, 'extractor should read structuredOutput');
  assert.match(extractBody, /messageLike\.structured_output/, 'extractor should read structured_output');
  assert.match(extractBody, /messageLike\.info\?\.structuredOutput/, 'extractor should read info.structuredOutput');
  assert.match(extractBody, /part\.type === "tool"/, 'extractor should inspect tool parts');
  assert.match(extractBody, /stateRec\.output/, 'extractor should parse structured tool state.output');
  assert.match(extractBody, /stateRec\.result/, 'extractor should parse structured tool state.result compatibility');
  assert.doesNotMatch(
    extractBody,
    /messageLike\.content|messageLike\.text|part\.state\.input/,
    'extractor should not parse plain text or tool input as structured payload',
  );
});

test('provider and webview normalize structured output with strict validation before sanitize', () => {
  const providerNormalizeBody = extractFunctionBody(
    providerSource,
    'private normalizeStructuredOutput(',
  );
  const webviewNormalizeBody = extractFunctionBody(
    messageHandlerSource,
    'function normalizeStructuredOutput(value: unknown): StructuredOutput | undefined',
  );

  assert.match(providerNormalizeBody, /const validation = validateStructuredOutput\(canonicalRec\)/, 'provider should validate canonical structured payload');
  assert.match(providerNormalizeBody, /const sanitizedRec = sanitizeStructuredOutput\(canonicalRec\)/, 'provider should sanitize only after validation');
  assert.match(providerNormalizeBody, /delete canonicalRec\.response_type;/, 'provider should canonicalize response_type alias');

  assert.match(webviewNormalizeBody, /const validation = validateStructuredOutput\(canonicalRec\)/, 'webview should validate canonical structured payload');
  assert.match(webviewNormalizeBody, /const sanitizedRec = sanitizeStructuredOutput\(canonicalRec\)/, 'webview should sanitize only after validation');
  assert.match(webviewNormalizeBody, /delete canonicalRec\.response_type;/, 'webview should canonicalize response_type alias');
});

test('ChatViewProvider suppresses StructuredOutput tool call rows from UI activity', () => {
  const applyBody = extractFunctionBody(
    providerSource,
    'private applyStructuredOutputToMessage(',
  );
  const enrichBody = extractFunctionBody(
    providerSource,
    'private enrichStreamEvent(event: any): any',
  );

  assert.match(applyBody, /part\.type === "tool"/, 'applyStructuredOutputToMessage should inspect tool rows');
  assert.match(applyBody, /toolName\.includes\("structuredoutput"\)/, 'applyStructuredOutputToMessage should hide StructuredOutput tool rows');
  assert.match(enrichBody, /kind = "other"/, 'stream enrichment should classify StructuredOutput tool rows as other');
});

test('WebView parser reads structured output from explicit channels and structured tool outputs only', () => {
  const normalizeMessageBody = extractFunctionBody(
    messageHandlerSource,
    'function normalizeMessage(message: Message, streaming: StreamingState | null): Message | undefined',
  );
  const streamEventBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );

  assert.match(normalizeMessageBody, /normalizeStructuredOutput\(rec\.structuredOutput\)/, 'normalizeMessage should parse top-level structuredOutput');
  assert.match(normalizeMessageBody, /normalizeStructuredOutput\(part\.output\)/, 'normalizeMessage should parse structured tool part output');
  assert.doesNotMatch(
    normalizeMessageBody,
    /normalizeStructuredOutput\(rec\.content\)|normalizeStructuredOutput\(rec\.text\)|normalizeStructuredOutput\(rec\.output\)|normalizeStructuredOutput\(\(rec as UnknownRecord\)\.result\)/,
    'normalizeMessage should not parse generic text/content/output/result as structured payload',
  );

  assert.match(streamEventBody, /normalizeStructuredOutput\(payload\.structuredOutput\)/, 'stream parser should parse payload.structuredOutput');
  assert.match(streamEventBody, /structuredOutputFromEventPart/, 'stream parser should parse structured tool output parts');
  assert.doesNotMatch(
    streamEventBody,
    /normalizeStructuredOutput\(payload\.content\)|normalizeStructuredOutput\(payload\.text\)|normalizeStructuredOutput\(payload\.output\)|normalizeStructuredOutput\(\(payload as UnknownRecord\)\.result\)/,
    'stream parser should not parse generic content/text/output/result as structured payload',
  );
});
