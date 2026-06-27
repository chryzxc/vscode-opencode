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
    /async loadSessionRawSdkEventPayloads\(sessionId: string\): Promise<unknown\[\]>/s,
    'rehydrated session loads should read the raw SDK tape from the same service',
  );
  assert.match(
    sessionServiceSource,
    /async saveSessionRawSdkEventPayloads\(\s*sessionId: string,\s*events: unknown\[\],\s*\): Promise<void> \{[\s\S]*const persisted = events\.map\(\(event\) =>\s*this\.cloneRawSdkEventPayload\(event\),\s*\);/s,
    'session persistence should clone and store raw SDK payloads without filtering the centralized tape',
  );
  assert.doesNotMatch(
    sessionServiceSource,
    /shouldPersistCentralizedSessionEventPayload/,
    'session persistence should not trim the raw SDK tape before it reaches the centralized UI',
  );
  assert.doesNotMatch(
    sessionServiceSource,
    /filterPersistedRawSdkEventPayloads\(Array\.isArray\(value\) \? value : \[\]\)/,
    'raw SDK loads should no longer re-filter the persisted tape on read',
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
    /getCentralizedDebugPayloadIdentity\(payload: unknown\): string/,
    'shared filter helper should export a canonical payload identity for deduping wrapped duplicates',
  );
  assert.match(
    centralizedDebugFilterSource,
    /shouldPersistCentralizedSessionEventPayload\(payload: unknown\): boolean/,
    'shared filter helper should define a separate persisted-session filter',
  );
  assert.match(
    centralizedDebugFilterSource,
    /const CENTRALIZED_SESSION_PERSISTED_EVENT_TYPES = new Set\(\[[\s\S]*"message\.updated"[\s\S]*"message\.part\.updated"[\s\S]*"session\.diff"[\s\S]*\]\);/s,
    'persisted-session filtering should whitelist only conversation-driving event types',
  );
  assert.match(
    centralizedDebugFilterSource,
    /Removed source filtering for "\/global\/event"/,
    'persisted-session filtering should allow tool events from /global/event to be included',
  );
  assert.doesNotMatch(
    centralizedDebugFilterSource,
    /if \(hasSyncEnvelope\(event\)\) \{/,
    'persisted-session filtering should not drop sync-wrapped conversation events outright',
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
    /shouldPersistCentralizedSessionEventPayload\(payload: unknown\): boolean/,
    'webview should consume the generated copy of the persisted-session helper too',
  );
  assert.match(
    sessionServiceSource,
    /appendRawSdkEventPayload\(sessionId: string, event: unknown\): Promise<void>/,
    'session persistence should accept raw SDK payloads directly',
  );
  assert.match(
    messageComponentsSource,
    /rawSdkEventPayloadsBySessionId\?\.\[centralizedSessionId\]/,
    'centralized debug rendering should read from the raw SDK session cache',
  );
  assert.match(
    messageComponentsSource,
    /normalizeCentralizedEventPayloads\(effectiveCentralizedRawSdkEventPayloads\)/,
    'centralized rendering should normalize the full raw SDK event tape before display',
  );
  assert.match(
    chatShellSource,
    /<CentralizedDebugPanel \/>/,
    'centralized debug should render once from the chat shell at the top of the thread',
  );
});

test('rehydration parsers understand direct wrapped payload.properties entries', () => {
  assert.match(
    messageHandlerSource,
    /const payloadPropertiesPart = asRecord\(asRecord\(payloadRecord\?\.properties\)\?\.part\);[\s\S]*return payloadPropertiesPart;/s,
    'message handler should read wrapped payload.properties.part entries during rehydration',
  );
  assert.match(
    messageHandlerSource,
    /const payloadPropertiesInfo = asRecord\(asRecord\(payloadRecord\?\.properties\)\?\.info\);[\s\S]*return payloadPropertiesInfo;/s,
    'message handler should read wrapped payload.properties.info entries during rehydration',
  );
  assert.match(
    messageComponentsSource,
    /const payloadPropertiesInfo = asRecord\(asRecord\(asRecord\(event\.payload\)\?\.properties\)\?\.info\);[\s\S]*return payloadPropertiesInfo;/s,
    'message components should read wrapped payload.properties.info entries for assistant turn metadata',
  );
});

test('activity render dedupe prefers tool call identity before part or message ids', () => {
  assert.match(
    messageComponentsSource,
    /function activityDisplayEventIdentity\(event: DisplayEvent\): string \{[\s\S]*if \(callID\) \{[\s\S]*if \(partID\) \{[\s\S]*if \(messageID\) \{/s,
    'activity render dedupe should prioritize callID before partID or messageID',
  );
  assert.match(
    messageComponentsSource,
    /event\.kind === "activity"\s*\?\s*activityDisplayEventIdentity\(event\)/s,
    'activity display fingerprints should use the shared activity identity helper during dedupe',
  );
  assert.match(
    messageComponentsSource,
    /if \(event\.kind === "activity"\) \{[\s\S]*const stableIdentity = activityDisplayEventIdentity\(event\);[\s\S]*return stableIdentity;/s,
    'activity display fingerprints should collapse stream and raw variants onto the same call identity',
  );
});

test('activity step indicators preserve pending versus running states', () => {
  assert.match(
    messageComponentsSource,
    /function normalizeProgressStatus\(\s*value\?: string \| null,\s*\): "pending" \| "running" \| "done" \| "error" \{[\s\S]*v === "running"[\s\S]*return "running";/s,
    'message components should preserve running as a distinct progress status',
  );
  assert.match(
    messageHandlerSource,
    /function normalizeProgressStatus\(\s*value\?: string \| null,\s*\): "pending" \| "running" \| "done" \| "error" \{[\s\S]*v === "running"[\s\S]*return "running";/s,
    'message handler should preserve running as a distinct progress status',
  );
  assert.match(
    messageComponentsSource,
    /<StepIndicator\s+status=\{event\.status\}/s,
    'activity rows should render the step indicator from the actual event status',
  );
});

test('centralized debug raw rehydration only reads the raw session cache', () => {
  assert.match(
    sessionServiceSource,
    /const raw = Array\.isArray\(value\) \? value : \[\];/,
    'rehydrated raw SDK payloads should return the persisted tape directly',
  );
  assert.doesNotMatch(
    sessionServiceSource,
    /filterPersistedRawSdkEventPayloads\(Array\.isArray\(value\) \? value : \[\]\)/,
    'rehydrated raw SDK payloads should not be filtered before reaching the centralized tape',
  );
  assert.match(
    messageComponentsSource,
    /rawSdkEventPayloadsBySessionId\?\.\[centralizedSessionId\]/,
    'centralized debug should still render from the raw SDK session cache',
  );
});

test('session raw payload persistence dedupes canonical events instead of wrapper shape', () => {
  assert.match(
    sessionServiceSource,
    /const eventIdentity = getCentralizedDebugPayloadIdentity\(event\);[\s\S]*getCentralizedDebugPayloadIdentity\(existing\) === eventIdentity/s,
    'session persistence should dedupe /event and sync-wrapped copies using canonical event identity',
  );
  assert.match(
    centralizedDebugFilterSource,
    /payloadSyncEvent\?\.id/,
    'canonical payload identity should consider wrapped sync event ids',
  );
});

test('centralized event normalization dedupes direct and sync mirrors before timeline rendering', () => {
  assert.match(
    messageHandlerSource,
    /function normalizedCentralizedEventIdentity\(event: UnknownRecord\): string \{/,
    'message handler should derive a wrapper-independent centralized event identity',
  );
  assert.match(
    messageHandlerSource,
    /const indexByIdentity = new Map<string, number>\(\);/,
    'normalized centralized payloads should track logical identities while building the canonical tape',
  );
  assert.match(
    messageHandlerSource,
    /normalizedCentralizedEventRichness\(event\) >=[\s\S]*normalizedCentralizedEventRichness\(existing\)/,
    'normalization should keep the richer direct or sync mirror when duplicate lifecycle events exist',
  );
});

test('rehydrated chat history merges the full processed message list with the assistant raw cache', () => {
  assert.match(
    messageHandlerSource,
    /rawHistoryMessages[\s\S]*rawMessages/,
    'hydration should merge the full message list with assistant raw cache data so user bubbles survive reload',
  );
  assert.match(
    messageComponentsSource,
    /const messageAttachedRawSdkEventPayloads = useMemo[\s\S]*message\?\.rawSdkEventPayloads/s,
    'assistant cards should preserve message-attached centralized raw payloads',
  );
  assert.match(
    messageComponentsSource,
    /return scopedEvents\.length > 0 \? scopedEvents : messageAttachedRawSdkEventPayloads;/,
    'assistant cards should fall back to attached centralized turn payloads when session scoping is empty',
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
