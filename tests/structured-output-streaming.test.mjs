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
const structuredSchemaSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
  'structuredOutputSchema.ts',
);

test('chat provider negotiates structured json transport and caches per model', () => {
  const helperBody = extractFunctionBody(
    chatProviderSource,
    'private async promptWithStructuredOutput(',
  );

  assert.match(structuredSchemaSource, /type:\s*["']json_schema["']/, 'schema should use json_schema transport');
  assert.match(helperBody, /const transportKey = this\.getStructuredOutputTransportKey\(body\)/, 'prompt helper should key transport mode by provider/model');
  assert.match(helperBody, /this\.structuredOutputTransportByModel\.get\(transportKey\) \?\? "unknown"/, 'prompt helper should read cached transport mode');
  assert.match(helperBody, /\[mode\]: schema/, 'prompt helper should set schema transport field dynamically');
  assert.match(helperBody, /probeMissingStructuredSignal:\s*true/, 'unknown mode should probe missing structured payload signals');
  assert.match(helperBody, /if \(cachedMode === "format"\)/, 'cached format mode should be handled');
  assert.match(helperBody, /if \(cachedMode === "outputFormat"\)/, 'cached outputFormat mode should be handled');
  assert.match(helperBody, /structuredOutputTransportByModel\.set\(transportKey,\s*"disabled"\)/, 'unsupported transports should be cached as disabled');
  assert.match(helperBody, /Structured output format is required for this chat/, 'unsupported transport should return explicit structured format error');
});

test('chat provider validates transport by structured payload signal', () => {
  assert.match(
    chatProviderSource,
    /private hasStructuredOutputTransportSignal\(messageLike: unknown\): boolean/,
    'provider should detect structured payload transport signals before caching mode',
  );
  const helperBody = extractFunctionBody(
    chatProviderSource,
    'private async promptWithStructuredOutput(',
  );
  assert.match(
    helperBody,
    /const hasStructuredSignal = this\.hasStructuredOutputTransportSignal\(\s*response\.data,\s*\)/,
    'transport helper should verify structured signal from response payload',
  );
});

test('chat provider applies strict structured error fallback without hardcoded prose', () => {
  assert.match(
    chatProviderSource,
    /private buildStructuredOutputValidationError\(/,
    'provider should build typed structured validation errors',
  );
  assert.match(
    chatProviderSource,
    /code:\s*"structured_output_invalid"/,
    'structured validation fallback should use structured_output_invalid code',
  );
  assert.doesNotMatch(
    chatProviderSource,
    /I couldn't produce a valid structured response\. Please retry\./,
    'legacy hardcoded fallback prose should be removed',
  );
  assert.match(
    chatProviderSource,
    /private deriveStrictStructuredFallbackAssistantMessage\(/,
    'provider should derive a safe assistant fallback message from plain body text',
  );
  assert.match(
    chatProviderSource,
    /assistantMessage\s*=\s*this\.firstNonEmptyString\(fallbackAssistantMessage\)\s*\|\|\s*validationFailureMessage;/,
    'strict fallback should preserve assistant text when available',
  );
  assert.match(
    chatProviderSource,
    /message:\s*validationFailureMessage/,
    'strict fallback should keep structured error metadata message intact',
  );
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

test('chat provider keeps reasoning parts intact when applying structured output text', () => {
  assert.match(
    chatProviderSource,
    /private isReasoningPartLike\(part: unknown\): boolean/,
    'provider should define reasoning-part guard',
  );
  assert.match(
    chatProviderSource,
    /private isRenderableTextPart\(part: unknown\): boolean/,
    'provider should define text-part guard',
  );
  assert.match(
    chatProviderSource,
    /parts\.findIndex\(\s*\(part: any\) => this\.isRenderableTextPart\(part\)/,
    'provider should only replace non-reasoning text parts when injecting structured message text',
  );
});

test('chat provider uses structured assistant message as source of truth', () => {
  const applyBody = extractFunctionBody(
    chatProviderSource,
    'private applyStructuredOutputToMessage(',
  );

  assert.match(
    applyBody,
    /const messageContent =\s*\n\s*structured\.assistantMessage \|\|\s*\n\s*structured\.message;/,
    'structured assistant message/message should be the final response source',
  );
  assert.match(
    applyBody,
    /if \(messageContent && shouldUseStructuredMessage\)/,
    'structured message should drive rendered content when present',
  );
  assert.match(
    applyBody,
    /const hasJsonOnlyBody = bodyText\.startsWith\("\{"\) && bodyText\.endsWith\("\}"\);/,
    'json-only body should be stripped from render text',
  );
});

test('chat provider enables structured output for all prompts when schema mode is available', () => {
  assert.match(
    chatProviderSource,
    /private structuredOutputMode:\s*StructuredOutputTransportMode\s*=\s*"unknown"/,
    'structured output mode should start in unknown negotiation mode',
  );
  assert.match(
    chatProviderSource,
    /private readonly structuredOutputTransportByModel = new Map</,
    'provider should cache transport mode per model',
  );

  const shouldUseBody = extractFunctionBody(
    chatProviderSource,
    'private shouldUseStructuredOutput(',
  );
  assert.match(
    shouldUseBody,
    /if \(this\.structuredOutputMode === "disabled"\)/,
    'structured output helper should short-circuit when disabled globally',
  );
  assert.match(
    shouldUseBody,
    /return true;/,
    'structured output helper should default to structured mode',
  );
});

test('chat provider does not coerce malformed question payloads into synthetic options', () => {
  const normalizeBody = extractFunctionBody(
    chatProviderSource,
    'private normalizeStructuredOutput(',
  );

  assert.doesNotMatch(
    normalizeBody,
    /Coerced question response into fallback question event/,
    'malformed questions should not be coerced into synthetic events',
  );
  assert.doesNotMatch(
    normalizeBody,
    /label:\s*"Yes"[\s\S]*label:\s*"No"/s,
    'normalizer should not auto-inject yes/no fallback options',
  );
});

test('webview normalizer only parses structured output from explicit structured channels', () => {
  const normalizeBody = extractFunctionBody(
    messageHandlerSource,
    'function normalizeMessage(message: Message, streaming: StreamingState | null): Message | undefined',
  );

  assert.match(
    normalizeBody,
    /normalizeStructuredOutput\(rec\.structuredOutput\)/,
    'webview should parse message structuredOutput field',
  );
  assert.match(
    normalizeBody,
    /normalizeStructuredOutput\(infoRec\?\.structuredOutput\)/,
    'webview should parse info structuredOutput field',
  );
  assert.match(
    normalizeBody,
    /normalizeStructuredOutput\(part\.output\)/,
    'webview should parse structured tool output payload',
  );
  assert.doesNotMatch(
    normalizeBody,
    /normalizeStructuredOutput\(rec\.content\)|normalizeStructuredOutput\(rec\.text\)|normalizeStructuredOutput\(rec\.output\)|normalizeStructuredOutput\(\(rec as UnknownRecord\)\.result\)/,
    'webview should not parse generic text/content/output/result as structured payload',
  );
});

test('webview structured content fallback avoids synthetic default prose', () => {
  const structuredContentBody = extractFunctionBody(
    messageHandlerSource,
    'function structuredContentForResponse(structured?: StructuredOutput): string',
  );

  assert.doesNotMatch(
    structuredContentBody,
    /Implementation plan is ready\.|Todo list updated\.|Structured data response ready\.|I'm here to help\./,
    'structured content helper should avoid synthetic fallback prose',
  );
});

test('webview normalizeMessage can prefer streaming content for structured_output_invalid fallback', () => {
  const normalizeBody = extractFunctionBody(
    messageHandlerSource,
    'function normalizeMessage(message: Message, streaming: StreamingState | null): Message | undefined',
  );

  assert.match(
    normalizeBody,
    /const isStructuredValidationFallbackOnly\s*=\s*[\s\S]*structured_output_invalid/,
    'normalizeMessage should detect structured_output_invalid fallback responses',
  );
  assert.match(
    normalizeBody,
    /\(!hasStructuredOutput \|\| isStructuredValidationFallbackOnly\)/,
    'normalizeMessage should allow streaming fallback when structured output is only validation error',
  );
  assert.match(
    normalizeBody,
    /hasStructuredOutput && !isStructuredValidationFallbackOnly/,
    'normalizeMessage should avoid forcing structured text when response is structured_output_invalid',
  );
});
