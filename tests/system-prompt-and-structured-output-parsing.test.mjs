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
