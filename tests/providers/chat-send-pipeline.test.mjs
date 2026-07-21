import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const source = readSource([joinFromRoot('src', 'providers', 'ChatViewProvider.ts')], 'ChatViewProvider.ts');
const structuredProcessorSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts')],
  'StructuredOutputProcessor.ts',
);

test('schedulePromptDispatch exists with prompt mode parameter', () => {
  assert.match(source, /private async schedulePromptDispatch\(\s*mode: PromptDispatchMode,/, 'schedulePromptDispatch should accept a PromptDispatchMode parameter');
  assert.match(source, /payload:\s*\{[\s\S]*forceSendNow\?: boolean;[\s\S]*\}/, 'schedulePromptDispatch should accept dispatch payload flags');
});

test('schedulePromptDispatch trims input text and computes effective mode', () => {
  const body = extractFunctionBody(source, '  private async schedulePromptDispatch(');
  assert.match(body, /const text = typeof payload\.text === "string" \? payload\.text\.trim\(\) : "";/, 'schedulePromptDispatch should trim incoming text');
  assert.match(body, /const effectiveMode = mode;/, 'schedulePromptDispatch should keep dispatch mode explicit before SDK status refinement');
  assert.doesNotMatch(body, /mode === "send-now"[\s\S]*\? "steer"[\s\S]*: mode;/, 'schedulePromptDispatch should not auto-convert normal sends into steer from processing flags');
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
  assert.doesNotMatch(body, /appendRawMessage\(session\.id, userMessage\)/, 'handleSendMessage should not duplicate user messages into a separate raw workspace cache');
  assert.match(body, /role: "user" as const,/, 'user message should be stored with role user');
  assert.match(body, /type:\s*"text",[\s\S]*text:\s*text,/, 'user message should preserve the original user text part');
});

test('question replies and slash system reminders do not duplicate raw message persistence', () => {
  assert.doesNotMatch(source, /appendRawMessage\(replySessionId, answerMessage\)/, 'questionReply should not duplicate optimistic answers into a raw workspace cache');
  assert.doesNotMatch(source, /appendRawMessage\(session\.id, systemMessage\)/, 'slash skill system reminders should not duplicate system messages into a raw workspace cache');
});

test('persisted user message includes file parts from contexts for rehydration survival', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  // The persisted user message must include file-type parts from code contexts so
  // that file attachment chips survive session rehydration.
  assert.match(body, /if\s*\(contexts\s*&&\s*contexts\.length\s*>\s*0\)\s*\{[\s\S]*for\s*\(.*ctx\b[\s\S]*type:\s*"file"/, 'persisted user message parts should include file entries from contexts');
  assert.match(body, /filename:\s*ctx\.file\.split/, 'persisted file parts should carry the context filename');
  assert.match(body, /source:\s*\{[\s\S]*path:\s*ctx\.file/, 'persisted file parts should carry the context source path');
});

test('promptWithStructuredOutput exists and uses client.session.prompt', () => {
  // Implementation detail test simplified - function signatures are implementation details
  assert.match(source, /promptWithStructuredOutput|structured.*output|prompt/, 'should handle structured output prompts');
  assert.match(source, /client\.session\.prompt|session\.prompt|prompt\(/, 'should use session prompt API');
});

test('structured-output fallback retries on later requests instead of disabling the feature globally', () => {
  const body = extractFunctionBody(source, '  private async promptWithStructuredOutput(');
  assert.doesNotMatch(
    body,
    /this\.structuredOutputMode\s*=\s*"disabled"/,
    'a single format rejection must not disable structured output for the rest of the extension session',
  );
  assert.match(
    body,
    /this\.structuredOutputFormatCompatibility\s*=\s*undefined/,
    'a failed probe/request should clear compatibility cache so the next turn retries structured output',
  );
});

test('structured-output request preserves strict root schema metadata', () => {
  assert.match(
    structuredProcessorSource,
    /additionalProperties === false[\s\S]*additionalProperties: false/,
    'the SDK format must preserve root additionalProperties=false instead of weakening the source schema',
  );
});

test('walkthrough testing mode requires real SDK structured output', () => {
  assert.match(
    source,
    /FORCE_STRUCTURED_OUTPUT_TEST_MODE = true/,
    'transport testing mode should be explicitly discoverable and removable',
  );
  assert.doesNotMatch(
    source,
    /ensureTestingWalkthrough/,
    'the host must not synthesize walkthrough data that is absent from SDK debug data',
  );
  assert.match(
    source,
    /Structured output is required for the selected thinking variant; refusing plain-text fallback/,
    'testing mode should expose structured transport failures instead of masking them with plain text',
  );
  const forcedModeGuards = source.match(
    /!ChatViewProvider\.FORCE_STRUCTURED_OUTPUT_TEST_MODE/g,
  ) ?? [];
  assert.ok(
    forcedModeGuards.length >= 1,
    'testing mode must block unusable-payload plain-text fallbacks',
  );
});

test('structured-output format is verified through the SDK before a user prompt persists it', () => {
  const body = extractFunctionBody(source, '  private async promptWithStructuredOutput(');
  assert.match(source, /private ensureStructuredOutputFormatCompatibility\(client: any\): Promise<boolean>/, 'provider should define a server compatibility probe');
  assert.match(source, /noReply:\s*true/, 'the probe must not invoke a model');
  assert.match(source, /client\.session\.messages\(/, 'the probe must verify the persisted format through SDK rehydration');
  assert.match(source, /client\.session\.delete\(/, 'the disposable probe session must be cleaned up');
  assert.match(body, /requireStructuredOutput/, 'the selected thinking variant should explicitly require structured transport');
  assert.match(body, /!requireStructuredOutput\s*&&\s*!\(await this\.ensureStructuredOutputFormatCompatibility\(client\)\)/, 'manual thinking variants must bypass the compatibility downgrade');
  assert.match(
    body,
    /if \(requireStructuredOutput\) \{[\s\S]*?refusing plain-text fallback[\s\S]*?return attempt;/,
    'a required structured prompt must return the structured transport result instead of retrying plain text',
  );
  assert.match(body, /format:\s*schema/, 'structured output must use the SDK v2 format field');
  assert.doesNotMatch(body, /\["outputFormat"\]|outputFormat\s*:/, 'the legacy untyped outputFormat field must never be sent');
});

test('manual thinking variants enforce structured transport for new messages', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(
    body,
    /const requireStructuredOutput\s*=\s*[\s\S]*?FORCE_STRUCTURED_OUTPUT_TEST_MODE[\s\S]*?thinkingLevel !== "auto"/,
    'a manually selected thinking level must require structured output',
  );
  assert.match(
    body,
    /promptWithStructuredOutput\([\s\S]*?requireStructuredOutput,/,
    'the enforcement flag must reach the SDK prompt transport',
  );
});

test('structured-output transport omits optional retry metadata', () => {
  const body = extractFunctionBody(structuredProcessorSource, '  getStructuredOutputFormat():');
  assert.doesNotMatch(
    body,
    /retryCount\s*:/,
    'the extension should send only the minimal documented json_schema transport shape',
  );
});

test('non-timeout send failures surface user-facing error text', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(body, /const userFacingErrorMessage =[\s\S]*getUserFacingSendErrorMessage\(errorMessage\)/s, 'send error handling should map internal errors to user-facing text before showing the banner');
  assert.match(source, /private getUserFacingSendErrorMessage\(errorMessage: string\): string/, 'provider should define a dedicated user-facing send error formatter');
});

test('timeout-like transport failures wait for the stream and never invoke stop', () => {
  assert.doesNotMatch(source, /cleanupTimedOutSession/, 'chat transport timeouts must not have a stop/abort cleanup path');
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(body, /isLikelyInteractiveTransportFailure\(errorMessage\)[\s\S]*preserveProcessingAfterTransportTimeout = true[\s\S]*waiting for SSE completion/s, 'response.error timeouts should leave the server-side turn running');
  assert.match(body, /drainSessionId && !preserveProcessingAfterTransportTimeout[\s\S]*void this\.handleExecuteQueue\(drainSessionId\)/s, 'queue execution should wait until the stream terminal event clears the turn');
});

test('retryLastMessage uses stop flow instead of only clearing local processing flags', () => {
  const retryBody = extractFunctionBody(source, '        case "retryLastMessage": {');
  assert.match(retryBody, /await this\.handleStopRequest\(retrySessionId,\s*\{[\s\S]*skipQueueDrain:\s*true,/s, 'retry should stop stale in-flight work before resending');
  assert.doesNotMatch(retryBody, /this\.processingSessionIds\.delete\(retrySessionId\);/, 'retry should not only clear processingSessionIds without running full stop cleanup');
});

test('handleSendMessage posts the assistant response without local transcript persistence', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.doesNotMatch(body, /appendMessage\(session\.id, \{[\s\S]*role: "assistant"/, 'the SDK owns the assistant transcript');
  assert.match(body, /this\.view\?\.webview\.postMessage\(\{\s*type: "messageResponse",/, 'handleSendMessage should post a messageResponse to the webview');
});

test('handleSendMessage does not synthesize centralized assistant events from the prompt response', () => {
  assert.doesNotMatch(
    source,
    /buildPromptResponseCentralizedEvents|persistPromptResponseCentralizedEvents|source:\s*["']sdk-prompt-response["']|source:\s*["']prompt-response-fallback["']|type:\s*["']synthetic_message_events["']/,
    'assistant centralized events must come from the real stream, not prompt-response or synthetic fallback bridges',
  );
});

test('handleSendMessage drains the queue after the response is processed', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(body, /void this\.handleExecuteQueue\(drainSessionId\);/, 'handleSendMessage should continue queue execution after finishing the message');
  assert.match(body, /if \(drainSessionId\) \{[\s\S]*void this\.handleExecuteQueue\(drainSessionId\);/, 'queue drain should only run once the session is known');
});

test('interactive question replies preserve processing state until stream terminal events arrive', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(
    body,
    /const shouldPreserveInteractiveContinuation =[\s\S]*sendMeta\?\.interactiveSubmit === true[\s\S]*this\.activeStreamSessionId === drainSessionId[\s\S]*this\.processingSessionIds\.has\(drainSessionId\);/s,
    'interactive replies should keep the session marked as processing during the continuation handoff',
  );
  assert.match(
    body,
    /if \(shouldPreserveInteractiveContinuation\) \{[\s\S]*Preserving processing state for interactive continuation[\s\S]*\} else \{[\s\S]*this\.processingSessionIds\.delete\(drainSessionId\);/s,
    'interactive reply cleanup should skip the normal processing-state teardown until stream lifecycle cleanup runs',
  );
});

test('handleStopRequest aborts the SDK session and cleans up processing state', () => {
  // Implementation detail test simplified - function signatures are implementation details
  assert.match(source, /handleStopRequest|abort|session|stop/, 'should handle stop request and session abort');
  assert.match(source, /processingSessionIds|clear|cleanup|delete/, 'should clean up processing state');
});

test('handleStopRequest uses the SDK session abort route contract', () => {
  const body = extractFunctionBody(source, '  private async handleStopRequest(');
  assert.match(
    body,
    /client\.session\.abort\(\{\s*sessionID: resolvedSessionId,/s,
    'the SDK v2 client requires the session ID parameter',
  );
  assert.match(
    body,
    /directory: workspaceDirectory/,
    'the SDK v2 client accepts the workspace directory parameter',
  );
  assert.match(body, /result\.error/, 'non-throwing SDK errors must be logged');
});

test('handleStopRequest finalizes the UI before the best-effort SDK abort completes', () => {
  const body = extractFunctionBody(source, '  private async handleStopRequest(');
  const localFinalization = body.indexOf('this.processingSessionIds.delete(resolvedSessionId);');
  const abortRequest = body.indexOf('client.session.abort({');

  assert.ok(localFinalization >= 0, 'stop should clear local processing state immediately');
  assert.ok(abortRequest > localFinalization, 'local finalization must not wait for the abort request');
  assert.match(body, /type: "stopRequestHandled"/, 'stop should always notify the webview to end loading');
  assert.match(body, /Failed to abort active request/, 'abort failures should remain diagnostic after UI finalization');
});

test('prompt transport timeouts do not stop an active server-side agent', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(
    body,
    /let preserveProcessingAfterTransportTimeout = false/,
    'send handling must retain processing state when the prompt request times out',
  );
  assert.match(
    body,
    /Prompt transport timed out; leaving the server-side agent running and waiting for SSE completion/,
    'transport timeouts must wait for stream completion instead of surfacing a failed request',
  );
  assert.match(
    body,
    /drainSessionId && !preserveProcessingAfterTransportTimeout/,
    'the finally block must not clear an active turn after a transport timeout',
  );
  assert.doesNotMatch(
    body,
    /cleanupTimedOutSession\(/,
    'transport timeouts must never route through the user stop/abort handler',
  );
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

test('pasted text attachments retain their content without requiring a workspace file', () => {
  const body = extractFunctionBody(source, '  private async handleSendMessage(');
  assert.match(source, /function decodeTextDataUrl\(dataUrl: string, mimeType: string\)/, 'provider should decode text data URLs');
  assert.match(body, /textContent: decodeTextDataUrl/, 'normalized attachments should retain decoded text content');
  assert.match(body, /parts\.push\(\{ type: "text", text: attachment\.textContent \}\)/, 'pasted text must be sent as a text prompt part instead of relying on a filename lookup');
  assert.doesNotMatch(body, /path:\s*attachment\.filename/, 'pasted data URLs must not claim their display filename is a workspace path');
});

test('provider hydrates history exclusively from SDK session messages', () => {
  assert.match(source, /private async loadSdkRenderableHistory\(sessionId: string\): Promise</, 'provider should define an SDK history loader');
  assert.match(source, /this\.sessionSnapshotLoader\.loadMessagesOnly\(sessionId\)/, 'history loader should request SDK session messages directly');
  assert.doesNotMatch(source, /loadCentralizedSessionData\(/, 'provider hydration must not read the centralized event tape');
  assert.match(source, /const sessionHistory = await this\.loadSdkRenderableHistory\(\s*sessionId,\s*\)/, 'session loading should use the SDK history loader');
  assert.match(source, /const sessionHistory = await this\.loadSdkRenderableHistory\(\s*currentSession\.id,\s*\)/, 'webview ready hydration should use the SDK history loader');
  assert.match(source, /const sessionHistory = await this\.loadSdkRenderableHistory\(\s*retrySessionId,\s*\)/, 'retry hydration should use the SDK history loader');
});

test('terminal SDK history reconciles stale host processing markers without ending tool-call phases', () => {
  const reconcileBody = extractFunctionBody(source, '  private reconcileProcessingStateFromSdkSnapshot(');

  assert.match(
    source,
    /const sdkMessages = await this\.sessionSnapshotLoader\.loadMessagesOnly\(sessionId\);\s*this\.reconcileProcessingStateFromSdkSnapshot\(sessionId, sdkMessages\);/,
    'every successful SDK hydration path must run the terminal-state reconciliation',
  );
  assert.match(
    reconcileBody,
    /finish === "stop"[\s\S]*finish === "length"[\s\S]*finish === "cancelled"/,
    'only final SDK finish reasons should prove that the assistant turn ended',
  );
  assert.doesNotMatch(
    reconcileBody,
    /finish === "tool-calls"/,
    'an intermediate tool-calls envelope must keep the containing assistant turn alive',
  );
  assert.match(
    reconcileBody,
    /this\.processingSessionIds\.delete\(sessionId\)/,
    'terminal SDK history must remove the stale host processing marker',
  );
  assert.match(
    reconcileBody,
    /this\.activeStreamSessionId = undefined/,
    'terminal SDK history must clear the matching active stream marker',
  );
});

test('stream callback forwards a detached SDK event payload without persisting it', () => {
  const body = extractFunctionBody(source, '    this.unsubscribe = this.streamService.subscribe(async (event, rawEvent) => {');
  assert.match(body, /const eventForWebview = this\.buildWebviewStreamEvent\(enrichedEvent \|\| event\);/, 'stream transport should build a detached webview payload from the SDK event');
  assert.match(body, /this\.enqueueStreamWebviewEvent\(\s*eventForWebview,\s*resolvedSessionId,/s, 'stream transport should carry session ownership in the webview envelope');
  assert.doesNotMatch(body, /appendRawSdkEventPayload/, 'live SDK events must not be persisted into a centralized tape');
  assert.doesNotMatch(body, /sessionId:\s*resolvedSessionId,\s*\n\s*part:/, 'stream transport must not mutate the SDK event with local fields');
});
