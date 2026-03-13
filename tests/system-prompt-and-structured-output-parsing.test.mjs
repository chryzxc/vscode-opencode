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

test('ChatViewProvider no longer injects manual system instructions', () => {
  const handleSendMessageBody = extractFunctionBody(
    providerSource,
    'private async handleSendMessage(',
  );

  // Check that getSystemInstruction (or getLegacySystemInstruction) is NOT called anymore in handleSendMessage
  assert.ok(!handleSendMessageBody.includes('getSystemInstruction()'), 'Should not use getSystemInstruction() anymore');
  assert.ok(!handleSendMessageBody.includes('getLegacySystemInstruction()'), 'Should not use getLegacySystemInstruction() anymore');
});

test('ChatViewProvider strips legacy instructions from history via unified helper', () => {
  const processHistoryBody = extractFunctionBody(
    providerSource,
    'private processHistoryMessages(rawMessages: any[]): any[]',
  );

  assert.match(processHistoryBody, /this\.stripLegacyInstruction\(p\.text\)/, 'processHistoryMessages should use the unified strip helper');
});

test('ChatViewProvider implements unified stripLegacyInstruction helper', () => {
  const stripBody = extractFunctionBody(
    providerSource,
    'private stripLegacyInstruction(text: string): string',
  );

  assert.match(stripBody, /getLegacySystemInstruction\(\)/, 'strip helper should fetch legacy instructions');
  assert.match(stripBody, /text\.startsWith\(legacyWithNewline\)/, 'strip helper should handle newlines');
});

test('ChatViewProvider strips instructions globally via extractMessageBodyText', () => {
  const extractBodyTextBody = extractFunctionBody(
    providerSource,
    'private extractMessageBodyText(message: any): string',
  );

  assert.match(extractBodyTextBody, /return this\.stripLegacyInstruction\(rawText\)/, 'extractMessageBodyText should apply stripping globally');
});

test('ChatViewProvider builds clean recovered transcripts', () => {
  const buildRecoveredBody = extractFunctionBody(
    providerSource,
    'private buildRecoveredTranscript(messages: unknown[]): string',
  );

  assert.match(buildRecoveredBody, /extractMessageBodyText\(rec\)/, 'buildRecoveredTranscript should use extraction logic that includes stripping');
});

test('ChatViewProvider unpacks structured output from tool parts', () => {
  const extractBody = extractFunctionBody(
    providerSource,
    'private extractStructuredOutput(',
  );

  assert.match(extractBody, /part\.type === ["']tool["']/, 'extractStructuredOutput should look for tool parts');
  assert.match(extractBody, /structuredoutput/, 'extractStructuredOutput should search for structuredoutput tool name');
  assert.match(extractBody, /part\.state\.result/, 'extractStructuredOutput should check state.result for tool output');
  assert.doesNotMatch(
    extractBody,
    /part\.state\.input/,
    'extractStructuredOutput should not parse tool input payloads to avoid prompt leakage into UI fields',
  );
});

test('structured output normalization requires explicit responseType and assistant message field', () => {
  const providerNormalizeBody = extractFunctionBody(
    providerSource,
    'private normalizeStructuredOutput(',
  );
  assert.match(
    providerNormalizeBody,
    /if \(!responseType\)\s*\{\s*return undefined;\s*\}/,
    'provider normalizeStructuredOutput should require responseType before accepting payloads',
  );
  assert.match(
    providerNormalizeBody,
    /sanitizedRec\.assistantMessage/,
    'provider normalizeStructuredOutput should read assistantMessage explicitly',
  );
  assert.doesNotMatch(
    providerNormalizeBody,
    /rec\.content|rec\.text|rec\.thinking|rec\.thoughts/,
    'provider normalizeStructuredOutput should not infer message/reasoning from generic content or thinking fields',
  );

  const webviewNormalizeBody = extractFunctionBody(
    messageHandlerSource,
    'function normalizeStructuredOutput(value: unknown): StructuredOutput | undefined',
  );
  assert.match(
    webviewNormalizeBody,
    /if \(!responseType\)\s*\{\s*return undefined;\s*\}/,
    'webview normalizeStructuredOutput should require responseType before accepting payloads',
  );
  assert.match(
    webviewNormalizeBody,
    /sanitizedRec\.assistantMessage/,
    'webview normalizeStructuredOutput should read assistantMessage explicitly',
  );
  assert.doesNotMatch(
    webviewNormalizeBody,
    /rec\.content|rec\.text|rec\.thinking|rec\.thoughts/,
    'webview normalizeStructuredOutput should not infer message/reasoning from generic content or thinking fields',
  );
});

test('ChatViewProvider suppresses StructuredOutput tool call from UI', () => {
  const applyBody = extractFunctionBody(
    providerSource,
    'private applyStructuredOutputToMessage(',
  );

  assert.match(applyBody, /\.filter\(/, 'applyStructuredOutputToMessage should filter parts');
  assert.match(applyBody, /part\.type === ["']tool["']/, 'applyStructuredOutputToMessage should check part type');

  const enrichBody = extractFunctionBody(
    providerSource,
    'private enrichStreamEvent(event: any): any',
  );
  assert.match(enrichBody, /kind\s*=\s*["']other["']/, 'enrichStreamEvent should suppress structuredoutput tools by marking kind as other');
});

test('WebView message handler hides StructuredOutput tool from progress steps', () => {
  const normalizeBody = extractFunctionBody(
    messageHandlerSource,
    'normalizeMessage(',
  );

  assert.match(normalizeBody, /structuredoutput/, 'normalizeMessage should skip structuredoutput tool steps');
});
