import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

test('initState hydrates processing session ids before selecting the active session', () => {
  const processingIndex = messageHandlerSource.indexOf(
    'type: "SET_PROCESSING_SESSIONS"',
  );
  const sessionIndex = messageHandlerSource.indexOf(
    'type: "SET_SESSION_ID", payload: sessionId',
  );
  const setProcessingIndex = messageHandlerSource.indexOf(
    'type: "SET_PROCESSING", payload: true',
    sessionIndex,
  );

  assert.notStrictEqual(processingIndex, -1, 'initState should dispatch processing session ids');
  assert.notStrictEqual(sessionIndex, -1, 'initState should select the active session');
  assert.ok(
    processingIndex < sessionIndex,
    'processing ids must be in state before SET_SESSION_ID derives isProcessing',
  );
  assert.ok(
    sessionIndex < setProcessingIndex,
    'initState should explicitly restore isProcessing for an already-active session',
  );
  assert.match(
    messageHandlerSource,
    /const processingSessionIds = asArray\([\s\S]*state\.processingSessionIds[\s\S]*typeof item === "string"[\s\S]*\);/,
    'initState should normalize processingSessionIds from the backend payload',
  );
  assert.match(
    messageHandlerSource,
    /if \(processingSessionIds\.includes\(sessionId\)\) \{[\s\S]*dispatch\(\{ type: "SET_PROCESSING", payload: true \}\);[\s\S]*\}/,
    'initState should show responding UI when the active session is still processing',
  );
});
