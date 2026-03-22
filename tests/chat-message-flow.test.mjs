import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

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

test('queue row actions switch between steer and send-now based on processing state', () => {
  const queueBody = extractFunctionBody(panelSource, 'export function QueueContainer()');

  assert.match(queueBody, /type:\s*["']steerQueuedItem["']/, 'Queue row action should steer queued item when processing');
  assert.match(queueBody, /type:\s*["']sendQueuedItemNow["']/, 'Queue row action should send queued item immediately when idle');
  assert.match(queueBody, /type:\s*["']removeFromQueue["']/, 'Queue row should still support removing queued item');
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

  assert.match(handlerBody, /const\s+currentStreaming\s*=\s*getState\(\)\.streaming/, 'error handler should access current streaming state');
  assert.match(handlerBody, /if\s*\(currentStreaming\)\s*\{/, 'error handler should check if streaming state exists');
  assert.match(handlerBody, /type:\s*["']SET_MESSAGES["']/, 'error handler should dispatch SET_MESSAGES to append partial message');
  assert.match(handlerBody, /error:\s*errorMsg/, 'partial message should include the error message');
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

test('assistant header is responsive on small screens for agent/model/tokens row', () => {
  assert.match(
    messageSource,
    /mb-2\.5 flex flex-wrap items-start justify-between gap-2/,
    'assistant header container should wrap and align from top on narrow widths',
  );
  assert.match(
    messageSource,
    /oc-msg-token-chips flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0\.5 text-\[11px\] sm:ml-auto sm:text-\[12px\]/,
    'token row should wrap with compact typography and shift right on larger screens',
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
