import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const sessionServiceSource = readSource(
  [joinFromRoot('src', 'services', 'SessionService.ts')],
  'SessionService.ts',
);
const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);
const sessionModalSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'components', 'SessionModal.tsx')],
  'SessionModal.tsx',
);
const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

test('session service implements core CRUD operations and active-session fallback behavior', () => {
  // Verify create/list/switch/delete/get-current APIs and key fallback logic exist.
  assert.match(sessionServiceSource, /async\s+createNewSession\(title\?:\s*string\):\s*Promise<Session>/, 'SessionService should expose createNewSession');
  assert.match(sessionServiceSource, /async\s+listSessions\(\):\s*Promise<Session\[\]>/, 'SessionService should expose listSessions');
  assert.match(sessionServiceSource, /async\s+switchSession\(sessionId:\s*string\):\s*Promise<Session>/, 'SessionService should expose switchSession');
  assert.match(sessionServiceSource, /async\s+deleteSession\(sessionId:\s*string\):\s*Promise<void>/, 'SessionService should expose deleteSession');
  assert.match(sessionServiceSource, /async\s+getCurrentSession\(\):\s*Promise<Session>/, 'SessionService should expose getCurrentSession');
  assert.match(sessionServiceSource, /async\s+upsertMessage\(sessionId:\s*string,\s*message:\s*unknown\):\s*Promise<void>/, 'SessionService should expose upsertMessage for richer local message persistence');

  const getCurrentBody = extractFunctionBody(sessionServiceSource, 'async getCurrentSession(): Promise<Session>');
  assert.match(getCurrentBody, /if\s*\(this\.currentSession\)\s*\{[\s\S]*return\s+this\.currentSession;/, 'getCurrentSession should return existing active session when available');
  assert.match(getCurrentBody, /return\s+this\.createNewSession\(\);/, 'getCurrentSession should auto-create a session when none exists');

  const listBody = extractFunctionBody(sessionServiceSource, 'async listSessions(): Promise<Session[]>');
  assert.match(listBody, /new\s+Map<string,\s*Session>\(\)/, 'listSessions should merge server and local sessions via keyed map');
  assert.match(
    listBody,
    /if\s*\(this\.initializationPromise\)\s*\{[\s\S]*await\s+this\.initializationPromise;[\s\S]*\}/,
    'listSessions should wait for persisted-state initialization before merging and persisting',
  );
  assert.match(listBody, /localSessions\.forEach\(\(s\)\s*=>\s*\{[\s\S]*mergedMap\.set\(s\.id,\s*s\)/, 'listSessions should include local sessions in merge');
  assert.match(listBody, /serverSessions\.forEach\(\(s\)\s*=>\s*\{[\s\S]*mergedMap\.set\(s\.id,\s*s\)/, 'listSessions should include server sessions in merge');
  assert.match(listBody, /catch\s*\(error\)\s*\{[\s\S]*Fallback to local history/, 'listSessions should keep local fallback on server errors');
});

test('session service merges server/local messages and keeps richer duplicates', () => {
  const getMessagesBody = extractFunctionBody(
    sessionServiceSource,
    'async getMessages(sessionId: string): Promise<unknown[]>',
  );
  assert.match(
    getMessagesBody,
    /const localMessages = await this\.loadSessionMessages\(sessionId\);/,
    'getMessages should load local cache before server fetch',
  );
  assert.match(
    getMessagesBody,
    /mergeConversationMessages\(\[localMessages,\s*response\.data\]\)/,
    'getMessages should merge local and server histories to preserve richer local metadata',
  );
  assert.match(
    getMessagesBody,
    /summarizePotentialAssistantDuplicates\(response\.data\)/,
    'getMessages should inspect raw SDK server history for duplicate assistant turns before merging local cache',
  );
  assert.match(
    getMessagesBody,
    /summarizePotentialAssistantDuplicates\(mergedMessages\)/,
    'getMessages should compare merged history duplicates against raw SDK server history',
  );

  assert.match(
    sessionServiceSource,
    /function pickRicherMessage\(/,
    'SessionService should define a richer-message selector for duplicate signatures',
  );

  const mergeConversationBody = extractFunctionBody(
    sessionServiceSource,
    'function mergeConversationMessages(messageGroups: unknown[][]): unknown[]',
  );
  assert.match(
    mergeConversationBody,
    /pickRicherMessage\(/,
    'mergeConversationMessages should keep the richer duplicate instead of first-write-wins',
  );

  const upsertBody = extractFunctionBody(
    sessionServiceSource,
    'async upsertMessage(sessionId: string, message: unknown): Promise<void>',
  );
  assert.match(
    upsertBody,
    /messages\.findIndex\([\s\S]*getMessageSignaturesForMerge/,
    'upsertMessage should match existing cached messages by stable signature',
  );
  assert.match(
    upsertBody,
    /pickRicherMessage\(/,
    'upsertMessage should replace with richer content when an existing signature is found',
  );

  assert.match(
    sessionServiceSource,
    /function mergeRicherMessageFields\(/,
    'SessionService should merge richer metadata from duplicate messages',
  );
  const mergeFieldsBody = extractFunctionBody(
    sessionServiceSource,
    'function mergeRicherMessageFields(',
  );
  assert.match(
    mergeFieldsBody,
    /backfillArrayField\("subagents",\s*true\)/,
    'duplicate merge should preserve subagents from either message copy',
  );
  assert.match(
    mergeFieldsBody,
    /backfillArrayField\("reasoningEvents"\)/,
    'duplicate merge should preserve reasoning events from either copy',
  );
  assert.match(
    mergeFieldsBody,
    /backfillArrayField\("progressEvents"\)/,
    'duplicate merge should preserve progress events from either copy',
  );
  assert.match(
    mergeFieldsBody,
    /backfillArrayField\("images"\)/,
    'duplicate merge should preserve image attachments from either copy',
  );
  assert.match(
    mergeFieldsBody,
    /backfillArrayField\("attachments"\)/,
    'duplicate merge should preserve structured attachments from either copy',
  );
  assert.match(
    sessionServiceSource,
    /function getAssistantContentAliasSignatures\(message: unknown\): string\[\] \{[\s\S]*getMessageRoleForSignature\(message\)[\s\S]*getMessageTextForSignature\(message\)[\s\S]*Math\.floor\(created \/ 15_000\)/,
    'assistant alias signatures should use canonical role/text extraction and a time bucket to merge local assistant snapshots with SDK history',
  );
});

test('session service compaction preserves rich assistant metadata used by history UI', () => {
  assert.match(
    sessionServiceSource,
    /function compactSubagentForPersistence\(/,
    'SessionService should define subagent compaction helper',
  );

  const compactMessageBody = extractFunctionBody(
    sessionServiceSource,
    'function compactMessageForPersistence(message: unknown): unknown',
  );
  assert.match(
    compactMessageBody,
    /compact\.reasoningEvents =/,
    'compactMessageForPersistence should retain reasoningEvents',
  );
  assert.match(
    compactMessageBody,
    /compact\.progressEvents =/,
    'compactMessageForPersistence should retain progressEvents',
  );
  assert.match(
    compactMessageBody,
    /compact\.steps =/,
    'compactMessageForPersistence should retain steps',
  );
  assert.match(
    compactMessageBody,
    /compact\.subagents =/,
    'compactMessageForPersistence should retain subagents',
  );

  const compactSubagentBody = extractFunctionBody(
    sessionServiceSource,
    'function compactSubagentForPersistence(subagent: unknown): unknown',
  );
  assert.match(
    compactSubagentBody,
    /compact\.thinkingEvents =/,
    'compactSubagentForPersistence should retain thinking events',
  );
  assert.match(
    compactSubagentBody,
    /compact\.progressEvents =/,
    'compactSubagentForPersistence should retain progress events',
  );
  assert.match(
    compactSubagentBody,
    /compact\.timelineEvents =/,
    'compactSubagentForPersistence should retain timeline events',
  );
});

test('chat provider no longer accepts legacy assistant snapshot persistence from webview', () => {
  assert.doesNotMatch(
    chatProviderSource,
    /case\s+"persistAssistantMessage"/,
    'chat provider should not persist assistant snapshots through the legacy webview backchannel',
  );
});

test('session service upgrades duplicate raw sdk event identities to the richer payload', () => {
  assert.match(
    sessionServiceSource,
    /function rawSdkEventPersistenceRichness\(event: unknown\): number/,
    'session raw SDK persistence should define a richness scorer for duplicate event upgrades',
  );
  assert.match(
    sessionServiceSource,
    /const existingIndex = events\.findIndex\([\s\S]*getCentralizedDebugPayloadIdentity\(existing\) === eventIdentity[\s\S]*rawSdkEventPersistenceRichness\(snapshot\)\s*>=[\s\S]*rawSdkEventPersistenceRichness\(existingEvent\)/s,
    'duplicate raw SDK events should keep the richer payload instead of dropping later updates',
  );
});

test('history sidebar emits session create/switch/delete events to extension', () => {
  // Verify webview session controls post expected protocol messages.
  assert.match(panelSource, /createSession/, 'panel should post createSession message');
  assert.match(sessionModalSource, /switchSession/, 'session modal should post switchSession message');
  assert.match(sessionModalSource, /handleDeleteConfirm/, 'session modal should handle delete confirm action');
});

test('chat provider routes session CRUD messages and handles delete edge cases', () => {
  // Verify extension-side message routing and delete fallback paths are present.
  assert.match(chatProviderSource, /case\s+"newSession"[\s\S]*case\s+"createSession"/, 'chat provider should support create session message aliases');
  assert.match(chatProviderSource, /case\s+"loadSession"[\s\S]*case\s+"openSession"[\s\S]*case\s+"switchSession"/, 'chat provider should support switch session message aliases');
  assert.match(chatProviderSource, /case\s+"deleteSession"/, 'chat provider should support delete session message');
  assert.doesNotMatch(chatProviderSource, /case\s+"persistAssistantMessage"/, 'chat provider should not accept legacy assistant snapshot persistence messages from webview');

  const deleteBody = extractFunctionBody(chatProviderSource, 'private async handleDeleteSession(sessionId: string): Promise<void>');
  assert.match(deleteBody, /await\s+this\.sessionService\.deleteSession\(sessionId\)/, 'delete handler should call SessionService.deleteSession');
  assert.match(deleteBody, /if\s*\(!currentSession\)\s*\{[\s\S]*createNewSession\(\)/, 'delete handler should create a new session when none remains');
  assert.match(deleteBody, /showErrorMessage\(`Failed to delete session:\s*\$\{error\}`\)/, 'delete handler should surface deletion failures');
});

test('chat provider preserves conversation context when recreating missing server sessions', () => {
  const sendBody = extractFunctionBody(
    chatProviderSource,
    'private async handleSendMessage(',
  );

  assert.match(sendBody, /buildRecoveredTranscript\(/, 'send handler should build a recovered transcript during session recreation');
  assert.match(sendBody, /saveSessionRecoveryMap\(/, 'send handler should persist old-to-new session mapping for recovery visibility');
  assert.match(sendBody, /migrateSessionSettings\(/, 'send handler should migrate per-session settings when session IDs are recreated');
  assert.match(sendBody, /return this\.handleSendMessage\([\s\S]*true,[\s\S]*previousSessionId/, 'send handler should retry as retry=true with recovered context payload');
  assert.match(sendBody, /if \(this\.currentSessionId && session\.id !== this\.currentSessionId\)/, 'send handler should realign to explicitly selected session before prompting');

  assert.match(chatProviderSource, /private buildRecoveredTranscript\(messages: unknown\[\]\): string/, 'chat provider should expose transcript compaction helper for session recovery');
  assert.match(chatProviderSource, /private\s+migrateSessionSettings\(\s*oldSessionId:\s*string,\s*newSessionId:\s*string,?\s*\):\s*void/, 'chat provider should expose session settings migration helper');
});

test('chat provider refreshes sessions list during message handling', () => {
  const sendBody = extractFunctionBody(
    chatProviderSource,
    'private async handleSendMessage(',
  );

  assert.match(chatProviderSource, /private\s+async\s+handleGetSessions\(\):\s*Promise<void>/, 'chat provider should expose session list refresh helper');
  assert.match(sendBody, /await\s+this\.handleGetSessions\(\)/, 'send flow should trigger a sessions refresh');
});
