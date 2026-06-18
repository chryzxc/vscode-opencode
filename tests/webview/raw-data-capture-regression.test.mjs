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
const centralizedDebugFilterSource = readSource(
  [joinFromRoot('src', 'shared', 'centralizedDebugPayloadFilter.ts')],
  'centralizedDebugPayloadFilter.ts',
);
const centralizedDebugFilterGeneratedSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'generated', 'centralizedDebugPayloadFilter.ts')],
  'generated centralizedDebugPayloadFilter.ts',
);
const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);
const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);
const sessionHandlerSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts')],
  'SessionHandler.ts',
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
    /filterPersistedRawSdkEventPayloads\(events: unknown\[\] \| undefined\): unknown\[\]/s,
    'session persistence should use a shared filter helper for raw SDK payloads',
  );
  assert.match(
    sessionServiceSource,
    /function normalizePersistedRawSdkEventPayload\(value: unknown\): unknown/,
    'session persistence should normalize wrapped debug payloads into the flat centralized event shape',
  );
  assert.match(
    sessionServiceSource,
    /async loadSessionRawSdkEventPayloads\(sessionId: string\): Promise<unknown\[\]>/s,
    'rehydrated session loads should read the raw SDK tape from the same service',
  );
  assert.match(
    sessionServiceSource,
    /normalizePersistedRawSdkEventPayload\(event\)/,
    'session persistence should normalize raw SDK payloads when saving and loading them',
  );
});

test('centralized debug payload filtering is defined once and reused by both tiers', () => {
  assert.match(
    centralizedDebugFilterSource,
    /shouldIncludeCentralizedDebugPayload\(payload: unknown\): boolean/,
    'shared filter helper should live in src/shared as the source of truth',
  );
  assert.match(
    centralizedDebugFilterSource,
    /"server\.heartbeat"/,
    'shared filter helper should include server heartbeat exclusions',
  );
  assert.match(
    centralizedDebugFilterSource,
    /"payload\.properties\.info\.format\.type"/,
    'shared filter helper should include the wrapped payload json_schema exclusion',
  );
  assert.match(
    centralizedDebugFilterSource,
    /"payload\.syncEvent\.data\.info\.format\.type"/,
    'shared filter helper should include the wrapped syncEvent json_schema exclusion',
  );
  assert.match(
    centralizedDebugFilterSource,
    /candidatePayloads\(event: Record<string, unknown>\): unknown\[\]/,
    'shared filter helper should inspect wrapped payload objects too',
  );
  assert.match(
    centralizedDebugFilterGeneratedSource,
    /shouldIncludeCentralizedDebugPayload\(payload: unknown\): boolean/,
    'webview should consume the generated copy of the same filter helper',
  );
  assert.match(
    sessionServiceSource,
    /shouldIncludeCentralizedDebugPayload/,
    'session persistence should reuse the shared centralized debug filter',
  );
  assert.match(
    messageComponentsSource,
    /shouldIncludeCentralizedDebugPayload/,
    'centralized debug rendering should reuse the generated shared filter',
  );
  assert.match(
    chatShellSource,
    /<CentralizedDebugPanel \/>/,
    'centralized debug should render once from the chat shell at the top of the thread',
  );
});

test('centralized debug raw rehydration only reads the raw session cache', () => {
  assert.match(
    sessionServiceSource,
    /return events\.filter\(\(event\) => shouldIncludeCentralizedDebugPayload\(event\)\);/,
    'rehydrated raw SDK payloads should be filtered through the shared helper before being returned',
  );
  assert.match(
    messageComponentsSource,
    /rawSdkEventPayloadsBySessionId\?\.\[centralizedSessionId\]/,
    'centralized debug should still render from the raw SDK session cache',
  );
});

test('rehydrated chat history merges the full processed message list with the assistant raw cache', () => {
  assert.match(
    messageHandlerSource,
    /rawHistoryMessages[\s\S]*rawMessages/,
    'hydration should merge the full message list with assistant raw cache data so user bubbles survive reload',
  );
});

test('session hydration sends persisted messages first and keeps raw history separate', () => {
  assert.match(
    sessionHandlerSource,
    /const persistedMessages = await this\.sessionService\.loadSessionMessages\(sessionId\);/,
    'session hydration should load the full persisted message list',
  );
  assert.match(
    sessionHandlerSource,
    /const sourceMessages = persistedMessages\.length > 0\s*\?\s*persistedMessages\s*:\s*rawHistoryMessages;/s,
    'session hydration should prefer persisted messages over the raw history cache',
  );
  assert.match(
    sessionHandlerSource,
    /rawMessages: rawHistoryMessages/,
    'session hydration should keep raw history separate from processed messages',
  );
});
