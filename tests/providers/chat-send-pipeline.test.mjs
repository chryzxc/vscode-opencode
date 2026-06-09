import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const source = readSource([joinFromRoot('src', 'providers', 'ChatViewProvider.ts')], 'ChatViewProvider.ts');

test('schedulePromptDispatch exists with prompt mode parameter', () => {
  assert.match(source, /private async schedulePromptDispatch\(\s*mode: PromptDispatchMode,/, 'schedulePromptDispatch should accept a PromptDispatchMode parameter');
  assert.match(source, /payload:\s*\{[\s\S]*forceSendNow\?: boolean;[\s\S]*\}/, 'schedulePromptDispatch should accept dispatch payload flags');
});

test('schedulePromptDispatch trims input text and computes effective mode', () => {
  const body = extractFunctionBody(source, '  private async schedulePromptDispatch(');
  assert.match(body, /const text = typeof payload\.text === "string" \? payload\.text\.trim\(\) : "";/, 'schedulePromptDispatch should trim incoming text');
  assert.match(body, /const effectiveMode =\s*[\s\S]*mode === "send-now"[\s\S]*payload\.forceSendNow[\s\S]*this\.getEffectiveProcessingSessionIds\(\)\.includes\(sessionId\)[\s\S]*\? "steer"[\s\S]*: mode;/, 'schedulePromptDispatch should switch send-now into steer when processing and forceSendNow is false');
});

test('handleSendMessage is async and marks the session as processing', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(body, /const client = await this\.serverManager\.ensureRunning\(\)/, 'handleSendMessage should wait for ensureRunning before session work');
  assert.match(body, /this\.processingSessionIds\.add\(drainSessionId\);/, 'handleSendMessage should mark the session as processing');
  assert.match(body, /this\.sendProcessingSessionsUpdate\(\);/, 'handleSendMessage should notify the webview about processing sessions');
});

test('processing session payloads include active subagent parents', () => {
  const body = extractFunctionBody(source, '  private getEffectiveProcessingSessionIds(): string[]');
  assert.match(body, /const ids = new Set\(this\.processingSessionIds\);/, 'effective processing sessions should start with direct prompt sessions');
  assert.match(body, /this\.subagentTracker\.getActiveProcessingSessionIds\(\)/, 'effective processing sessions should include active subagent parent sessions');
  assert.match(source, /payload: this\.getEffectiveProcessingSessionIds\(\),/, 'processing updates should publish effective sessions');
});

test('handleSendMessage appends the user message before the prompt call', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(body, /await this\.sessionService\.appendMessage\(session\.id, userMessage\);/, 'handleSendMessage should persist the user message');
  assert.match(body, /role: "user" as const,/, 'user message should be stored with role user');
  assert.match(body, /type:\s*"text",[\s\S]*text:\s*text,/, 'user message should preserve the original user text part');
});

test('persisted user message includes file parts from contexts for rehydration survival', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  // The persisted user message must include file-type parts from code contexts so
  // that file attachment chips survive session rehydration.
  assert.match(body, /if\s*\(contexts\s*&&\s*contexts\.length\s*>\s*0\)\s*\{[\s\S]*for\s*\(.*context\b[\s\S]*type:\s*"file"/, 'persisted user message parts should include file entries from contexts');
  assert.match(body, /filename:.*context\.file/, 'persisted file parts should carry the context filename');
  assert.match(body, /source:\s*\{\s*path:.*context\.file/, 'persisted file parts should carry the context source path');
});

test('promptWithStructuredOutput exists and uses client.session.prompt', () => {
  const body = extractFunctionBody(source, '  private async promptWithStructuredOutput(');
  assert.match(source, /private async promptWithStructuredOutput\(\s*client:\s*any,\s*sessionID:\s*string,\s*body:/, 'promptWithStructuredOutput should accept client, sessionId, body, and structured-output flag arguments');
  assert.match(body, /const promise = client\.session\.prompt\(\{/, 'promptWithStructuredOutput should call client.session.prompt directly');
  assert.match(body, /path:\s*\{\s*id:\s*sessionID\s*\}/, 'promptWithStructuredOutput should pass path.id to the SDK');
  assert.match(body, /body:\s*requestBody as SessionPromptData\["body"\]/, 'promptWithStructuredOutput should pass the body payload to the SDK');
});

test('send failures surface friendly user-facing timeout text instead of raw internal labels', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(body, /const userFacingErrorMessage =[\s\S]*getUserFacingSendErrorMessage\(errorMessage\)/s, 'send error handling should map internal errors to user-facing text before showing the banner');
  assert.match(source, /private getUserFacingSendErrorMessage\(errorMessage: string\): string/, 'provider should define a dedicated user-facing send error formatter');
  assert.match(source, /The model did not respond in time\. Please retry\./, 'timeout hangs should be rendered as a friendly retry prompt');
});

test('timeout-like failures clean up with the same stop flow used by the Stop button', () => {
  assert.match(source, /private async cleanupTimedOutSession\(/, 'provider should define a shared timeout cleanup helper');
  assert.match(source, /await this\.handleStopRequest\(sessionId,\s*\{[\s\S]*skipQueueDrain:\s*options\?\.skipQueueDrain \?\? true,/s, 'timeout cleanup should route through handleStopRequest');

  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(body, /isLikelyInteractiveTransportFailure\(errorMessage\)[\s\S]*await this\.cleanupTimedOutSession\(session\.id,\s*errorMessage\)/s, 'response.error timeout failures should invoke stop-style cleanup');
  assert.match(body, /isLikelyInteractiveTransportFailure\(errorMessage\)[\s\S]*await this\.cleanupTimedOutSession\(drainSessionId,\s*errorMessage\)/s, 'thrown timeout failures should invoke stop-style cleanup');
});

test('retryLastMessage uses stop flow instead of only clearing local processing flags', () => {
  const retryBody = extractFunctionBody(source, '        case "retryLastMessage": {');
  assert.match(retryBody, /await this\.handleStopRequest\(retrySessionId,\s*\{[\s\S]*skipQueueDrain:\s*true,/s, 'retry should stop stale in-flight work before resending');
  assert.doesNotMatch(retryBody, /this\.processingSessionIds\.delete\(retrySessionId\);/, 'retry should not only clear processingSessionIds without running full stop cleanup');
});

test('handleSendMessage persists the assistant response and posts messageResponse', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(body, /await this\.sessionService\.appendMessage\(session\.id, \{[\s\S]*role: "assistant"/, 'handleSendMessage should append the assistant response after the prompt returns');
  assert.match(body, /this\.view\?\.webview\.postMessage\(\{\s*type: "messageResponse",/, 'handleSendMessage should post a messageResponse to the webview');
});

test('handleSendMessage drains the queue after the response is processed', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(body, /void this\.handleExecuteQueue\(drainSessionId\);/, 'handleSendMessage should continue queue execution after finishing the message');
  assert.match(body, /if \(drainSessionId\) \{[\s\S]*void this\.handleExecuteQueue\(drainSessionId\);/, 'queue drain should only run once the session is known');
});

test('handleStopRequest aborts the SDK session and cleans up processing state', () => {
  const body = extractFunctionBody(source, '  private async handleStopRequest(');
  assert.match(body, /await client\.session\.abort\(\{/, 'handleStopRequest should call client.session.abort');
  assert.match(body, /path:\s*\{\s*id:\s*resolvedSessionId\s*\}/, 'handleStopRequest should abort the resolved session id');
  assert.match(body, /this\.processingSessionIds\.delete\(resolvedSessionId\);/, 'handleStopRequest should clear processing state for the session');
  assert.match(body, /this\.handleExecuteQueue\(resolvedSessionId\);/, 'handleStopRequest should drain queued prompts after aborting');
});

test('handleLoadSession does not borrow AI processing markers for session loading', () => {
  const body = extractFunctionBody(source, '  private async handleLoadSession(');
  assert.doesNotMatch(body, /addedLoadProcessingMarker/, 'session loading must not create temporary AI processing markers');
  assert.doesNotMatch(body, /this\.processingSessionIds\.add\(sessionId\)/, 'session loading must not mark a session as AI-processing');
  assert.doesNotMatch(body, /this\.processingSessionIds\.delete\(sessionId\)/, 'session loading must not clear AI-processing state');
});

test('init payloads hydrate processing sessions for reloaded webviews', () => {
  assert.match(source, /type: "initState",[\s\S]*processingSessionIds: this\.getEffectiveProcessingSessionIds\(\),[\s\S]*todoItems:/, 'initState should include processingSessionIds during bootstrap/session load');
  assert.match(source, /type: "chatHistory",\s*sessionId: currentSession\.id,\s*messages: messages,/m, 'ready bootstrap should scope chatHistory to the current session');
  assert.match(source, /type: "chatHistory",[\s\S]*processingSessionIds: this\.getEffectiveProcessingSessionIds\(\)/, 'chatHistory should include processingSessionIds so switch hydration can preserve active timelines before initState arrives');
  assert.match(source, /if \(this\.activeStreamSessionId && this\.processingSessionIds\.size > 0\) \{[\s\S]*ids\.add\(this\.activeStreamSessionId\)/, 'effective processing sessions should include the active stream session without recursive getters');
});

test('send flow keeps structured-output and direct-send branches intact', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(body, /if \(responseData && capturePromptDebug\)/, 'handleSendMessage should preserve the response-data branch');
  assert.match(body, /if \(responseError\) \{[\s\S]*return this\.handleSendMessage\(/, 'handleSendMessage should retain the retry path for interactive transport failures');
  assert.doesNotMatch(body, /describe\(/, 'handleSendMessage should remain source-introspection only, not a runtime test');
});

test('file context URLs use absoluteUri.toString() for valid file URLs', () => {
  // Verify that file contexts use proper absolute file URLs instead of invalid template literals
  assert.match(source, /url: absoluteUri\.toString\(\)/, 'file context URLs should use absoluteUri.toString() for valid file URLs');
  assert.doesNotMatch(source, /url:\s*`file:\/\/\$\{ctx\.file\}`/, 'file context URLs should not use invalid template literal format file://${ctx.file}');
  assert.doesNotMatch(source, /url:\s*`file:\/\/\$\{filePath\}`/, 'file attachment URLs should not use invalid template literal format file://${filePath}');
});

test('file contexts include content with start and end positions', () => {
  // Verify that file contexts include the full file content with proper position markers
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(body, /value:\s*textContent/, 'file contexts should include text content value');
  assert.match(body, /start:\s*0/, 'file contexts should start from position 0');
  assert.match(body, /end:\s*textContent\.length/, 'file contexts should end at content length');
});
