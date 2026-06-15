import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const sessionServiceSource = readSource(
  [joinFromRoot('src', 'services', 'SessionService.ts')],
  'SessionService.ts',
);
const chatViewProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts')],
  'SessionHandler.ts',
);
const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('raw stream capture stores the incoming SDK payload without shaping it', () => {
  assert.ok(
    messageHandlerSource.includes('event: payload,'),
    'stream capture should store the incoming payload object directly',
  );
  assert.ok(
    messageHandlerSource.includes('type: "APPEND_RAW_SDK_EVENT_PAYLOAD"'),
    'stream capture should append the raw payload to the raw event tape',
  );
});

test('raw session persistence stores server raw messages before normalization', () => {
  assert.match(
    sessionServiceSource,
    /await this\.saveSessionRawMessages\(sessionId, response\.data\);/s,
    'server session payload should be saved raw before merge/normalization',
  );
  assert.match(
    chatViewProviderSource,
    /type:\s*"chatHistory"[\s\S]*rawMessages:\s*fallbackMessages,/s,
    'rehydration should forward the raw history payload to the webview',
  );
});

test('centralized debug raw rehydration only reads the raw session cache', () => {
  assert.match(
    messageComponentsSource,
    /const rehydratedMessages =[\s\S]*rawMessagesBySessionId\?\.\[centralizedSessionId\]/s,
    'centralized debug should read the raw session cache for rehydrated data',
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /messagesBySessionId\?\.\[centralizedSessionId\]/,
    'centralized debug should not fall back to normalized messages for rehydrated raw data',
  );
});
