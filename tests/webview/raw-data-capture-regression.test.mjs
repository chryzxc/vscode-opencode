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
    /async loadSessionRawSdkEventPayloads\(sessionId: string\): Promise<unknown\[\]>/s,
    'rehydrated session loads should read the raw SDK tape from the same service',
  );
  assert.match(
    sessionServiceSource,
    /return record\.source !== "\/global\/event" &&[\s\S]*shouldIncludeCentralizedDebugPayload\(event\)/s,
    'session persistence should reuse the shared centralized filter before persisting raw SDK payloads',
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
    /hasStreamingDelta\(event: Record<string, unknown>\): boolean[\s\S]*hasOwnProperty\.call\(properties \?\? {}, "delta"\)[\s\S]*hasOwnProperty\.call\(part \?\? {}, "delta"\)/s,
    'shared filter helper should exclude streaming delta payloads by field presence',
  );
  assert.match(
    centralizedDebugFilterSource,
    /hasOwnProperty\.call\(syncData \?\? {}, "delta"\)[\s\S]*hasOwnProperty\.call\(syncPart \?\? {}, "delta"\)/s,
    'shared filter helper should exclude streaming delta payloads from wrapped sync payloads too',
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
    /rawSdkEventPayloadsBySessionId\?\.\[centralizedSessionId\]/,
    'centralized debug rendering should read from the raw SDK session cache',
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
    /const raw = this\.filterPersistedRawSdkEventPayloads\(Array\.isArray\(value\) \? value : \[\]\);/,
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
    /const centralizedSessionData = await this\.sessionService\.loadCentralizedSessionData\(/s,
    'session hydration should load the centralized session bundle first',
  );
  assert.match(
    sessionHandlerSource,
    /const rawMessages = centralizedSessionData\.rawMessages;/,
    'session hydration should keep the raw message tape separate from processed messages',
  );
  assert.match(
    sessionHandlerSource,
    /const rawSdkEventPayloads = centralizedSessionData\.rawSdkEventPayloads;/,
    'session hydration should keep the raw SDK event tape separate from processed messages',
  );
});
