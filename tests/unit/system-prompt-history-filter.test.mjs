import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

test('history normalization strips injected user prompt echo', () => {
  assert.match(
    messageHandlerSource,
    /function stripLeadingUserEcho\(/,
    'message handler should strip user prompt echo from restored messages',
  );
  assert.match(
    messageHandlerSource,
    /function sanitizeAssistantMessageEcho\(/,
    'message handler should clean assistant message echo',
  );
});

test('sanitizeAssistantMessageEcho cleans up assistant messages', () => {
  const sanitizeBody = extractFunctionBody(
    messageHandlerSource,
    'function sanitizeAssistantMessageEcho(message: Message, state: AppState): Message',
  );

  assert.match(
    sanitizeBody,
    /stripLeadingUserEcho/,
    'stripped prompt history should be removed from assistant output',
  );
  assert.match(
    sanitizeBody,
    /const next = \{\s*\.\.\.message\s*\};/,
    'should create a new message object instead of mutating',
  );
});
