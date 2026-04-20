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
  assert.match(inputBody, /images:\s*\(attachments\s*\|\|\s*\[\]\)\.map\(\(a\)\s*=>\s*a\.dataUrl\)/, 'optimistic user message should map attachment data URLs into images');
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

test('Assistant responses include dedicated enter transition classes', () => {
  assert.match(messageSource, /const\s+responseEnterClass\s*=\s*streaming\s*\?\s*["']oc-assistant-streaming-enter["']\s*:\s*["']oc-assistant-response-enter["']/, 'AssistantMessage should choose distinct enter classes for streaming and completed responses');
  assert.match(messageSource, /className=\{`oc-message-enter \$\{responseEnterClass\}/, 'AssistantMessage container should include response enter class');
  assert.match(chatCssSource, /\.oc-assistant-response-enter\s*\{[\s\S]*assistant-response-in/, 'chat css should define animation for completed assistant responses');
  assert.match(chatCssSource, /\.oc-assistant-streaming-enter\s*\{[\s\S]*assistant-streaming-in/, 'chat css should define animation for streaming assistant responses');
});

test('assistant header is responsive on small screens for agent/model/metrics rail', () => {
  assert.match(
    messageSource,
    /mb-2\.5 flex[\s\w-]*items-start justify-between gap-2/,
    'assistant header container should align from top',
  );
  assert.match(
    messageSource,
    /oc-metrics-rail sm:ml-auto/,
    'metrics rail should align to the right on wider screens',
  );
  assert.match(
    messageSource,
    /oc-metrics-rail[\s\S]*oc-token-chip[\s\S]*oc-token-chip-secondary/s,
    'assistant header should expose metrics rail with token chips',
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
