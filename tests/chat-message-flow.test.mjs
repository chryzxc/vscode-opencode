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

test('chat send flow posts message with image attachments and updates thread state', () => {
  // Verify primary send behavior includes image payload and optimistic user message rendering state.
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  assert.match(inputBody, /type:\s*'sendMessage'/, 'InputWrapper must send a sendMessage event');
  assert.match(inputBody, /images:\s*attachments\s*\|\|\s*\[\]/, 'sendMessage payload must include attachments as images');
  assert.match(inputBody, /role:\s*'user'/, 'send flow should append an optimistic user message');
  assert.match(inputBody, /images:\s*\(attachments\s*\|\|\s*\[\]\)\.map\(\(a\)\s*=>\s*a\.dataUrl\)/, 'optimistic user message should map attachment data URLs into images');
  assert.match(inputBody, /type:\s*'CLEAR_ATTACHMENTS'/, 'attachments must be cleared after send');
});

test('chat flow handles paste attachments and queued sends while processing', () => {
  // Verify common alternate paths: paste image ingestion and queue fallback when processing is active.
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  assert.match(inputBody, /if\s*\(isProcessing\)\s*\{[\s\S]*type:\s*'addToQueue'/, 'when processing, prompt should be queued instead of directly sent');
  assert.match(inputBody, /type:\s*'ADD_ATTACHMENT'/, 'paste handler should add image attachments to state');
  assert.match(inputBody, /item\.type\.startsWith\('image\/'\)/, 'paste handler must filter clipboard items by image MIME type');
  assert.match(inputBody, /type:\s*'REMOVE_ATTACHMENT'/, 'attachment chips must support removing individual attachments');
});

test('message thread renders user and assistant content including image thumbnails', () => {
  // Verify thread-level rendering and image output in user bubbles.
  assert.match(messageSource, /export function UserMessage\(/, 'UserMessage component should exist');
  assert.match(messageSource, /message\.images\s*&&\s*message\.images\.length\s*>\s*0/, 'UserMessage should guard image rendering with a non-empty images check');
  assert.match(messageSource, /<img\s+key=\{src\}\s+src=\{src\}\s+alt="attachment"/, 'UserMessage should render image thumbnails for attachments');

  assert.match(chatShellSource, /state\.messages\.map\(\(msg:\s*Message\)\s*=>/, 'Chat shell must iterate and render message thread');
  assert.match(chatShellSource, /return\s*<UserMessage\s+key=\{key\}\s+message=\{msg\}\s*\/>/, 'chat shell should render user messages with UserMessage component');
  assert.match(chatShellSource, /return\s*<AssistantMessage\s+key=\{key\}\s+message=\{msg\}\s*\/>/, 'chat shell should render assistant messages with AssistantMessage component');
});

test('error events clear processing and streaming state to avoid stuck thinking UI', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  assert.match(handlerBody, /case\s+'error'\s*:\s*\{[\s\S]*SET_PROCESSING[\s\S]*false/, 'error handler should stop processing state');
  assert.match(handlerBody, /case\s+'error'\s*:\s*\{[\s\S]*FINISH_STREAMING/, 'error handler should finish any active stream');
  assert.match(handlerBody, /case\s+'error'\s*:\s*\{[\s\S]*SET_STREAMING',\s*payload:\s*null/, 'error handler should clear streaming state');
});
