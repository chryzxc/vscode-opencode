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

test('chat provider configures json_schema output format with compatibility fallback', () => {
  const helperBody = extractFunctionBody(
    chatProviderSource,
    'private async promptWithStructuredOutput(',
  );

  assert.match(structuredSchemaSource, /type:\s*["']json_schema["']/, 'structured output should use json_schema format');
  assert.match(structuredSchemaSource, /retryCount:\s*2/, 'structured output should include retryCount for schema retries');
  assert.match(helperBody, /const workspaceDirectory = this\.getWorkspaceDirectory\(\)/, 'prompt helper should resolve workspace directory before sending prompts');
  assert.match(helperBody, /query:\s*workspaceDirectory \? \{ directory: workspaceDirectory \} : undefined/, 'prompt helper should scope prompt calls using query.directory');
  assert.match(helperBody, /format:\s*schema/, 'first attempt should use SDK-documented format key');
  assert.match(helperBody, /outputFormat:\s*schema/, 'fallback attempt should support outputFormat key');
  assert.match(helperBody, /if \(!useStructuredOutput \|\| this\.structuredOutputMode === "disabled"\)/, 'helper should allow default text-mode prompts when structured output is not needed');
  assert.match(helperBody, /structuredOutputMode\s*=\s*"disabled"/, 'provider should disable structured mode when unsupported');
});

test('chat provider derives workspace directory from first file-based folder', () => {
  assert.match(
    chatProviderSource,
    /private getWorkspaceDirectory\(\): string \| undefined/,
    'ChatViewProvider should define workspace-directory helper',
  );
  const workspaceHelperBody = extractFunctionBody(
    chatProviderSource,
    'private getWorkspaceDirectory(): string | undefined',
  );
  assert.match(workspaceHelperBody, /vscode\.workspace\.workspaceFolders\?\.\[0\]/, 'workspace helper should read first workspace folder');
  assert.match(workspaceHelperBody, /workspaceFolder\.uri\.scheme !== "file"/, 'workspace helper should guard non-file workspace schemes');
  assert.match(workspaceHelperBody, /workspaceFolder\.uri\.fsPath/, 'workspace helper should return fsPath for file workspaces');
  assert.match(workspaceHelperBody, /replace\(\/\\\\\/g,\s*["']\/["']\)\.replace\(\/\\\/\+\$\/,\s*["']['"]\)/, 'workspace helper should normalize directory separators for SDK queries');
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

test('chat provider keeps default response text when structured output is present', () => {
  const applyBody = extractFunctionBody(
    chatProviderSource,
    'private applyStructuredOutputToMessage(message: any): any',
  );

  assert.match(
    applyBody,
    /const hasJsonOnlyBody = bodyText\.startsWith\("\{"\) && bodyText\.endsWith\("\}"\);/,
    'applyStructuredOutputToMessage should detect JSON-only body text',
  );
  assert.match(
    applyBody,
    /const shouldUseStructuredMessage = !bodyText \|\| hasJsonOnlyBody;/,
    'structured message should only be used as fallback when default text is absent',
  );
  assert.match(
    applyBody,
    /if \(messageContent && shouldUseStructuredMessage\)/,
    'structured message should not overwrite normal assistant prose by default',
  );
});

test('chat provider selects structured output only for structured-response intents', () => {
  assert.match(
    chatProviderSource,
    /private shouldUseStructuredOutput\(/,
    'provider should define structured-output auto-selection helper',
  );
  assert.match(
    chatProviderSource,
    /const useStructuredOutput = this\.shouldUseStructuredOutput\(/,
    'send path should compute whether to request structured output',
  );
  assert.match(
    chatProviderSource,
    /const promptBody:\s*NonNullable<SessionPromptData\["body"\]>\s*=\s*\{/,
    'send path should construct a reusable prompt body object',
  );
  assert.match(
    chatProviderSource,
    /await this\.promptWithStructuredOutput\(\s*client,\s*session\.id,\s*promptBody,\s*useStructuredOutput,\s*\)/s,
    'prompt call should pass structured-output decision to helper',
  );
});

test('chat provider logs request and response payload diagnostics', () => {
  assert.match(
    chatProviderSource,
    /private sanitizeDebugPayload\(value: unknown\): unknown/,
    'provider should sanitize debug payloads before logging',
  );
  assert.match(
    chatProviderSource,
    /private async logPromptRequestPayload\(/,
    'provider should log outgoing prompt payloads',
  );
  assert.match(
    chatProviderSource,
    /private async logPromptResponsePayload\(/,
    'provider should log incoming response payloads',
  );
  assert.match(
    chatProviderSource,
    /await this\.logPromptRequestPayload\(\s*session\.id,\s*promptBody,\s*useStructuredOutput,\s*\)/s,
    'send path should emit prompt payload debug logs',
  );
  assert.match(
    chatProviderSource,
    /await this\.logPromptResponsePayload\(\s*session\.id,\s*response,\s*duration,\s*useStructuredOutput,\s*\)/s,
    'send path should emit response payload debug logs',
  );
});

test('chat provider keeps structured output enabled by default for UI-driven response types', () => {
  assert.match(
    chatProviderSource,
    /private structuredOutputMode:\s*"format"\s*\|\s*"disabled"\s*=\s*"format"/,
    'structured output mode should default to format',
  );

  const shouldUseBody = extractFunctionBody(
    chatProviderSource,
    'private shouldUseStructuredOutput(',
  );
  assert.match(
    shouldUseBody,
    /return this\.structuredOutputMode !== "disabled";/,
    'structured output helper should keep schema mode on unless explicitly disabled',
  );
  assert.doesNotMatch(
    shouldUseBody,
    /const activeAgent =|const promptText =|implementation\[_\\s-]\?plan/,
    'structured output helper should not rely on previous prompt keyword heuristics',
  );
});
