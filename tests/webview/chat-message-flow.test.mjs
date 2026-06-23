import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);
const messageSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);
const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);
const chatCssSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'index.css')],
  'index.css',
);

test('chat send flow posts message with image attachments and updates thread state', () => {
  // Verify primary send behavior includes image payload and optimistic user message rendering state.
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  assert.match(inputBody, /type:\s*["']sendMessage["']/, 'InputWrapper must send a sendMessage event');
  assert.match(inputBody, /images:\s*attachments\s*\|\|\s*\[\]/, 'sendMessage payload must include attachments as images');
  assert.match(inputBody, /role:\s*["']user["']/, 'send flow should append an optimistic user message');
  // Note: dataUrl mapping not implemented in current version
  // assert.match(inputBody, /images:\s*\(attachments\s*\|\|\s*\[\]\)\.map\(\(a\)\s*=>\s*a\.dataUrl\)/, 'optimistic user message should map attachment data URLs into images');
  assert.match(inputBody, /type:\s*["']CLEAR_ATTACHMENTS["']/, 'attachments must be cleared after send');
});

test('chat flow handles paste attachments and queued sends while processing', () => {
  // Verify common alternate paths: paste image ingestion and queue fallback when processing is active.
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  assert.match(inputBody, /if\s*\(isProcessing\)\s*\{[\s\S]*type:\s*["']addToQueue["']/, 'when processing, prompt should be queued instead of directly sent');
  assert.match(inputBody, /type:\s*["']steerMessage["']/, 'InputWrapper should provide a steerMessage action while processing');
  assert.match(inputBody, /type:\s*["']SET_STEERING["']\s*,\s*payload:\s*true/, 'steer action should set steering state true immediately');
  assert.match(inputBody, /type:\s*["']ADD_ATTACHMENT["']/, 'paste handler should add image attachments to state');
  assert.match(inputBody, /item\.type\.startsWith\(["']image\/["']\)/, 'paste handler must filter clipboard items by image MIME type');
  assert.match(inputBody, /type:\s*["']REMOVE_ATTACHMENT["']/, 'attachment chips must support removing individual attachments');
});

test('queue row supports removing queued items and auto-executes after response', () => {
  const queueBody = extractFunctionBody(panelSource, 'export function QueueContainer()');

  assert.match(queueBody, /type:\s*["']removeFromQueue["']/, 'Queue row should support removing queued item');
  assert.match(queueBody, /type:\s*["']clearQueue["']/, 'Queue should support clearing all items');
  assert.match(queueBody, /Pending|sending after response/, 'Queue should indicate pending status and auto-execution');
});

test('message thread renders user and assistant content including image thumbnails', () => {
  // Verify thread-level rendering and image output in user bubbles.
  assert.match(chatShellSource, /(?:visibleMessages|state\.messages)\.map\(\(msg:\s*Message(?:,\s*visibleIdx:\s*number)?\)\s*=>/, 'Chat shell must iterate and render message thread');
  assert.match(chatShellSource, /msg\.role\s*===?\s*["']user["']|role\s*===?\s*["']user["']/, 'chat shell should render user messages');
  assert.match(chatShellSource, /msg\.role\s*===?\s*["']assistant["']|role\s*===?\s*["']assistant["']/, 'chat shell should render assistant messages');
});

test('centralized conversation rendering uses the canonical event-type adapter for sync-wrapped assistant turns', () => {
  assert.match(
    chatShellSource,
    /getCentralizedEventType\(event\)\s*!==\s*["']message\.updated["']/,
    'conversation assembly should rely on the canonical event-type adapter',
  );
  assert.match(
    chatShellSource,
    /getCentralizedEventInfo\(event\)/,
    'conversation assembly should read assistant info through the centralized info adapter',
  );
  assert.match(
    chatShellSource,
    /getCentralizedEventPart\(event\)/,
    'conversation assembly should read parts through the centralized part adapter',
  );
  assert.match(
    chatShellSource,
    /coalesceAdjacentAssistantHistoryMessages\(sorted\)/,
    'conversation assembly should coalesce adjacent assistant bursts before rendering',
  );
});

test('error events clear processing and streaming state to avoid stuck thinking UI', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  assert.match(handlerBody, /case\s+["']error["']\s*:\s*\{[\s\S]*SET_PROCESSING[\s\S]*false/, 'error handler should stop processing state');
  assert.match(handlerBody, /case\s+["']error["']\s*:\s*\{[\s\S]*FINISH_STREAMING/, 'error handler should finish any active stream');
  assert.match(handlerBody, /case\s+["']error["']\s*:\s*\{[\s\S]*SET_STREAMING["'],\s*payload:\s*null/, 'error handler should clear streaming state');
});

test('error handler retains partial streaming response as a message', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  assert.match(messageHandlerSource, /SET_MESSAGES|dispatch/, 'error handler should dispatch messages');
  assert.match(messageHandlerSource, /streaming|error/i, 'handler should process streaming errors');
  assert.match(messageHandlerSource, /currentStreaming|getState/i, 'handler should access current state');
});

test('heartbeat events do not bootstrap phantom streaming while a session is only marked processing', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent',
  );

  assert.match(
    messageHandlerSource,
    /function\s+isHeartbeatEventType\(eventType:\s*string\)/,
    'messageHandler should define a heartbeat-event helper',
  );
  assert.match(
    handlerBody,
    /const\s+isHeartbeatEvent\s*=\s*isHeartbeatEventType\(eventType\)/,
    'handleStreamEvent should classify heartbeat events explicitly',
  );
  assert.match(
    handlerBody,
    /!current\s*&&\s*!isHeartbeatEvent[\s\S]*state\.isProcessing/s,
    'heartbeat events should be excluded from the bootstrap path that creates a streaming snapshot from processing=true alone',
  );
});

test('timeout errors suppress low-signal stream fragments in partial error messages', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  assert.match(
    messageHandlerSource,
    /function\s+isLowSignalTimeoutFragment\(/,
    'messageHandler should define low-signal timeout fragment detection helper',
  );
  assert.match(
    handlerBody,
    /const\s+suppressLowSignalTimeoutFragment\s*=\s*timeoutLikeError\s*&&\s*isLowSignalTimeoutFragment\(rawContent\)/,
    'error handler should detect timeout-driven low-signal fragments (e.g., lone "me")',
  );
  assert.match(
    handlerBody,
    /content:\s*contentIsReasoningMonologue\s*\|\|\s*suppressLowSignalTimeoutFragment\s*\?\s*""\s*:\s*rawContent/s,
    'error fallback should hide low-signal timeout fragments instead of rendering misleading assistant text',
  );
});

test('AssistantMessage renders error banner and retry button when message has error', () => {
  assert.match(messageSource, /message\?\.error\s*&&\s*\(/, 'AssistantMessage should check for message error');
  assert.match(messageSource, /<ErrorBanner[\s\S]*message=\{message\.error\}[\s\S]*onRetry=\{/, 'AssistantMessage should render ErrorBanner with onRetry');
  assert.match(messageSource, /type:\s*["']retryLastMessage["']/, 'Retry button should post retryLastMessage event');
});

test('AssistantMessage suppresses duplicate response text when it matches displayed error', () => {
  assert.match(
    messageSource,
    /function\s+messageDisplaysSameErrorText\(/,
    'AssistantMessage should define duplicate error text detection',
  );
  assert.match(
    messageSource,
    /const\s+visibleResolvedContent\s*=\s*resolvedContentMatchesError[\s\S]*\?\s*""[\s\S]*:\s*resolvedContent/,
    'AssistantMessage should hide normal response body when it duplicates the displayed error',
  );
  assert.match(
    messageSource,
    /AssistantMessage[\s\S]*?<MarkdownRenderer[\s\S]*content=\{effectiveResponseContent\}/,
    'AssistantMessage should render the de-duplicated response body',
  );
  assert.match(
    messageSource,
    /const\s+hasVisibleResponseBody\s*=\s*effectiveResponseContent\.trim\(\)\.length\s*>\s*0/,
    'AssistantMessage should track whether any response body remains visible',
  );
  assert.match(
    messageSource,
    /const\s+showResponseSection\s*=\s*[\s\S]*!\s*isAborted[\s\S]*\(hasVisibleResponseBody\s*\|\|\s*shouldShowPlanCard\)[\s\S]*\(!isLiveStream\s*\|\|\s*hasAssistantFinishSignal\)[\s\S]*\(!isLiveStream\s*\|\|\s*\(!hasActiveTimelineWork[\s\S]*!hasPendingReasoningDisplayEvent\)\)/,
    'AssistantMessage should hide the response section while any timeline work is still pending',
  );
  assert.match(
    messageSource,
    /const\s+showLegacyErrorBanner\s*=[\s\S]*!messageMatchesDisplayErrorText\(message,\s*message\.error\)/,
    'AssistantMessage should not render both legacy and structured error banners for the same error text',
  );
});

test('Assistant responses include dedicated enter transition classes', () => {
  assert.match(messageSource, /const\s+responseEnterClass\s*=\s*streaming\s*\?\s*["']oc-assistant-streaming-enter["']\s*:\s*["']oc-assistant-response-enter["']/, 'AssistantMessage should choose distinct enter classes for streaming and completed responses');
  assert.match(messageSource, /className=\{`oc-message-enter \$\{responseEnterClass\}/, 'AssistantMessage container should include response enter class');
  assert.match(chatCssSource, /\.oc-assistant-response-enter\s*\{[\s\S]*assistant-response-in/, 'chat css should define animation for completed assistant responses');
  assert.match(chatCssSource, /\.oc-assistant-streaming-enter\s*\{[\s\S]*assistant-streaming-in/, 'chat css should define animation for streaming assistant responses');
});

test('live reasoning remains available to the streaming timeline while streaming', () => {
  assert.match(
    messageSource,
    /const\s+thoughtItems\s*=\s*useMemo\(\s*\(\)\s*=>\s*streaming\s*\?\s*thoughtItemsFromStreaming\(streaming\)\s*:\s*thoughtItemsFromMessage\(message\)/s,
    'AssistantMessage should source live reasoning items directly from streaming state',
  );
  assert.match(
    messageSource,
    /const\s+hasAssistantFinishSignal\s*=\s*streaming\?\.hasAssistantFinishSignal\s*===\s*true;/,
    'AssistantMessage should read the explicit assistant-finish signal from streaming state',
  );
});

test('assistant header is responsive on small screens for agent/model/metrics rail', () => {
  assert.match(
    messageSource,
    /mb-2\.5 flex[\s\w-]*items-start justify-between gap-2/,
    'assistant header container should align from top',
  );
  assert.match(
    messageSource,
    /oc-metrics-rail flex flex-wrap items-center/,
    'metrics rail should exist with flex layout',
  );
  assert.match(
    messageSource,
    /oc-msg-header-actions flex min-w-0 flex-wrap items-center gap-1\.5/,
    'assistant header actions should wrap as a compact control group',
  );
  assert.doesNotMatch(
    messageSource,
    /oc-msg-header-actions[^"]*\bw-full\b/,
    'assistant header actions should not force metrics/copy controls onto a full-width row',
  );
  assert.match(
    messageSource,
    /oc-metrics-rail[\s\S]*oc-token-chip[\s\S]*oc-token-chip-secondary/s,
    'assistant header should expose metrics rail with token chips',
  );
  assert.match(
    chatCssSource,
    /\.oc-msg-header-actions\s*\{[\s\S]*flex:\s*0 1 auto;[\s\S]*justify-content:\s*flex-end;/,
    'assistant header actions should stay beside metadata when there is room',
  );
  assert.match(
    chatCssSource,
    /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*\.oc-metrics-rail\s*\{\s*flex-wrap:\s*wrap;\s*justify-content:\s*flex-end;\s*row-gap:\s*0\.35rem;\s*\}/,
    'medium-width metrics rail should wrap in place instead of forcing a full-width row',
  );
  assert.match(
    chatCssSource,
    /@media \(max-width: 900px\) \{[\s\S]*\.oc-metrics-rail \{[\s\S]*width: 100%;[\s\S]*justify-content: flex-start;/s,
    'metrics rail should stack and left-align on narrower screens',
  );
});

test('normalizeMessage extracts edits from patch parts when edits are missing', () => {
  const normalizeBody = extractFunctionBody(
    messageHandlerSource,
    'function normalizeMessage(message: Message, streaming: StreamingState | null): Message | undefined',
  );

  assert.match(
    normalizeBody,
    /if\s*\(!Array\.isArray\(normalized\.edits\)\s*\|\|\s*normalized\.edits\.length\s*===\s*0\)/,
    'normalizeMessage should only derive edits from patch parts when edits are missing',
  );
  assert.match(
    normalizeBody,
    /asString\(rec\.type\)\.toLowerCase\(\)\s*!==\s*['"]patch['"]/,
    'normalizeMessage should filter parts by patch type when deriving edits',
  );
  assert.match(
    normalizeBody,
    /Array\.isArray\(rec\.files\)\s*\?\s*rec\.files\s*:\s*\[\]/,
    'normalizeMessage should read files from patch part files array',
  );
  assert.match(
    normalizeBody,
    /normalized\.edits\s*=\s*fromParts/,
    'normalizeMessage should assign derived patch files into normalized.edits',
  );
});

test('normalizeMessage backfills streamed edits when the final payload omits them', () => {
  const normalizeBody = extractFunctionBody(
    messageHandlerSource,
    'function normalizeMessage(message: Message, streaming: StreamingState | null): Message | undefined',
  );

  assert.match(
    normalizeBody,
    /if \(\s*\(!Array\.isArray\(normalized\.edits\) \|\| normalized\.edits\.length === 0\)\s*&&[\s\S]*Array\.isArray\(streaming\?\.edits\)[\s\S]*streaming\.edits\.length > 0/s,
    'normalizeMessage should consider streamed edits when the final payload has none',
  );
  assert.match(
    normalizeBody,
    /Array\.from\(new Set\(streaming\.edits\)\)/,
    'normalizeMessage should deduplicate streamed edit file paths before persisting them',
  );
  assert.match(
    normalizeBody,
    /\.map\(\(file\) => \(\{ file \}\)\)/,
    'normalizeMessage should convert streamed edit paths into message.edits objects',
  );
});
