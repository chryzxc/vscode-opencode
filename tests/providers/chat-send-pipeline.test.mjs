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
  assert.match(body, /parts:\s*\[\s*\{\s*type: "text",\s*text: text,/, 'user message should preserve the original user text part');
});

test('promptWithStructuredOutput exists and uses client.session.prompt', () => {
  const body = extractFunctionBody(source, '  private async promptWithStructuredOutput(');
  assert.match(source, /private async promptWithStructuredOutput\(\s*client:\s*any,\s*sessionID:\s*string,\s*body:/, 'promptWithStructuredOutput should accept client, sessionId, body, and structured-output flag arguments');
  assert.match(body, /const promise = client\.session\.prompt\(\{/, 'promptWithStructuredOutput should call client.session.prompt');
  assert.match(body, /path:\s*\{\s*id:\s*sessionID\s*\}/, 'promptWithStructuredOutput should pass path.id to the SDK');
  assert.match(body, /body:\s*requestBody as SessionPromptData\["body"\]/, 'promptWithStructuredOutput should pass the body payload to the SDK');
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

test('handleLoadSession preserves existing AI processing markers while switching sessions', () => {
  const body = extractFunctionBody(source, '  private async handleLoadSession(');
  assert.match(body, /const addedLoadProcessingMarker = !this\.processingSessionIds\.has\(sessionId\);/, 'handleLoadSession should detect whether the session was already processing');
  assert.match(body, /if \(addedLoadProcessingMarker\) \{[\s\S]*this\.processingSessionIds\.add\(sessionId\);[\s\S]*this\.sendProcessingSessionsUpdate\(\);[\s\S]*\}/, 'handleLoadSession should only add a temporary loading marker when needed');
  assert.match(body, /if \(addedLoadProcessingMarker\) \{[\s\S]*this\.processingSessionIds\.delete\(sessionId\);[\s\S]*this\.sendProcessingSessionsUpdate\(\);[\s\S]*\}/, 'handleLoadSession should not clear a pre-existing AI processing marker');
});

test('init payloads hydrate processing sessions for reloaded webviews', () => {
  assert.match(source, /type: "initState",[\s\S]*processingSessionIds: this\.getEffectiveProcessingSessionIds\(\),[\s\S]*todoItems:/, 'initState should include processingSessionIds during bootstrap/session load');
  assert.match(source, /type: "chatHistory",\s*sessionId: currentSession\.id,\s*messages: messages,/m, 'ready bootstrap should scope chatHistory to the current session');
});

test('send flow keeps structured-output and direct-send branches intact', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(body, /if \(response\.data && capturePromptDebug\)/, 'handleSendMessage should preserve the response-data branch');
  assert.match(body, /if \(response\.error\) \{[\s\S]*return this\.handleSendMessage\(/, 'handleSendMessage should retain the retry path for interactive transport failures');
  assert.doesNotMatch(body, /describe\(/, 'handleSendMessage should remain source-introspection only, not a runtime test');
});
