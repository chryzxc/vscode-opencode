import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

test('history normalization strips injected internal system instruction text', () => {
  assert.match(
    messageHandlerSource,
    /const INTERNAL_SYSTEM_INSTRUCTION_OPENING\s*=/,
    'message handler should define the internal system prompt opening marker',
  );
  assert.match(
    messageHandlerSource,
    /function stripInternalSystemInstruction\(/,
    'message handler should strip internal system prompt text from restored messages',
  );
});

test('normalizeMessage keeps stripped prompt messages out of assistant timeline', () => {
  const normalizeMessageBody = extractFunctionBody(
    messageHandlerSource,
    'function normalizeMessage(message: Message, streaming: StreamingState | null): Message | undefined',
  );

  assert.match(
    normalizeMessageBody,
    /if \(internalPromptStripped && !role\)\s*\{\s*role = 'user';\s*\}/,
    'stripped prompt history should be treated as user-authored text when role metadata is missing',
  );
  assert.match(
    normalizeMessageBody,
    /if \(internalPromptStripped && !hasVisibleContent && !hasVisibleAttachments\)\s*\{\s*return undefined;\s*\}/,
    'empty prompt-only artifacts should be dropped from chat history',
  );
});
