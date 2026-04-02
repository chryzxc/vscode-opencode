import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readAllSources, readSource } from '../helpers/source-utils.mjs';

const providerSource = readAllSources([joinFromRoot('src', 'providers', 'ChatViewProvider.ts'), joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'), joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'), joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'), joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'), joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'), joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts')],
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

test('ChatViewProvider removes legacy system-instruction helpers and does not strip message text', () => {
  const processHistoryBody = providerSource;

  assert.doesNotMatch(processHistoryBody, /stripLegacyInstruction/, 'history processor should not strip prompt prefixes');
  assert.doesNotMatch(providerSource, /private stripLegacyInstruction\(/, 'provider should not define stripLegacyInstruction helper');
  assert.doesNotMatch(providerSource, /private getLegacySystemInstruction\(/, 'provider should not define legacy system-instruction helper');
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
  assert.match(
    extractBody,
    /pushCandidate\s*\(\s*part\.state\.output,/,
    'extractor should parse structured tool state.output',
  );
  assert.match(
    extractBody,
    /pushCandidate\s*\(\s*part\.state\.result,/,
    'extractor should parse structured tool state.result',
  );
  assert.doesNotMatch(
    extractBody,
    /messageLike\.content|messageLike\.text/,
    'extractor should not parse plain text as structured payload (delegated to bodyText fallback)',
  );
});

test('provider and webview normalize structured output with strict validation before sanitize', () => {
  const providerNormalizeBody = extractFunctionBody(
    providerSource,
    'normalizeStructuredOutput(\n    raw: unknown,',
  );
  const webviewNormalizeBody = extractFunctionBody(
    messageHandlerSource,
    'function normalizeStructuredOutput(value: unknown): StructuredOutput | undefined',
  );

  assert.match(providerNormalizeBody, /(const|let)\s+validation\s*=\s*validateStructuredOutput\(canonicalRec\)/, 'provider should validate canonical structured payload');
  assert.match(providerNormalizeBody, /(const|let)\s+sanitizedCanonicalRec\s*=\s*sanitizeStructuredOutput\(canonicalRec\)/, 'provider should sanitize only after validation');

  assert.match(webviewNormalizeBody, /(const|let)\s+validation\s*=\s*validateStructuredOutput\(rec\)/, 'webview should validate structured payload');
  assert.match(webviewNormalizeBody, /(const|let)\s+sanitizedRec\s*=\s*sanitizeStructuredOutput\(rec\)/, 'webview should sanitize only after validation');
});

test('ChatViewProvider suppresses StructuredOutput tool call rows from UI activity', () => {
  const applyBody = extractFunctionBody(
    providerSource,
    'private applyStructuredOutputToMessage(',
  );
  const enrichBody = extractFunctionBody(providerSource, 'enrichStreamEvent(event: any): any',
  );

  assert.match(applyBody, /part\.type === "tool"/, 'applyStructuredOutputToMessage should inspect tool rows');
  assert.match(applyBody, /toolName\.includes\("structuredoutput"\)/, 'applyStructuredOutputToMessage should hide StructuredOutput tool rows');
  assert.match(enrichBody, /enriched\.hasStructuredOutput = true/, 'stream enrichment should mark structured payloads for downstream handling');
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

  assert.doesNotMatch(
    normalizeMessageBody,
    /normalizeStructuredOutput/,
    'normalizeMessage should not parse structured output (delegated to steps/stream handler)',
  );

  assert.match(streamEventBody, /normalizeStructuredOutput\(\s*payload\.structuredOutput\s*\)/, 'stream parser should parse payload.structuredOutput');
  assert.doesNotMatch(
    streamEventBody,
    /normalizeStructuredOutput\(\s*payload\.content\s*\)|normalizeStructuredOutput\(\s*payload\.text\s*\)|normalizeStructuredOutput\(\s*payload\.output\s*\)|normalizeStructuredOutput\(\s*\(payload as UnknownRecord\)\.result\s*\)/,
    'stream parser should not parse generic content/text/output/result as structured payload',
  );
});

test('WebView parser uses text-based fallback for numbered questions when responseType is not question', () => {
  const normalizeBody = extractFunctionBody(
    messageHandlerSource,
    'function normalizeStructuredOutput(value: unknown): StructuredOutput | undefined',
  );

  assert.match(
    normalizeBody,
    /parseNumberedQuestionsFromText/,
    'WebView should attempt text-based parsing for numbered questions'
  );
  assert.match(
    normalizeBody,
    /interactiveEvents\.length === 0/,
    'Text-based parsing should only occur if no interactive events were explicitly provided'
  );
});
