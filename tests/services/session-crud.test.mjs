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

test('session service implements SDK-authoritative core CRUD operations', () => {
  assert.match(sessionServiceSource, /async\s+createNewSession\(title\?:\s*string\):\s*Promise<Session>/, 'SessionService should expose createNewSession');
  assert.match(sessionServiceSource, /async\s+listSessions\(\):\s*Promise<Session\[\]>/, 'SessionService should expose listSessions');
  assert.match(sessionServiceSource, /async\s+switchSession\(sessionId:\s*string\):\s*Promise<Session>/, 'SessionService should expose switchSession');
  assert.match(sessionServiceSource, /async\s+deleteSession\(sessionId:\s*string\):\s*Promise<void>/, 'SessionService should expose deleteSession');
  assert.match(sessionServiceSource, /async\s+getCurrentSession\(\):\s*Promise<Session>/, 'SessionService should expose getCurrentSession');
  assert.match(sessionServiceSource, /async\s+upsertMessage\(sessionId:\s*string,\s*message:\s*unknown\):\s*Promise<void>/, 'SessionService should preserve the compatibility method while local transcript persistence is disabled');

  const getCurrentBody = extractFunctionBody(sessionServiceSource, 'async getCurrentSession(): Promise<Session>');
  assert.match(getCurrentBody, /if\s*\(this\.currentSession\)\s*\{[\s\S]*return\s+this\.currentSession;/, 'getCurrentSession should return existing active session when available');
  assert.match(getCurrentBody, /client\.session\.list\(\)/, 'startup selection must query the OpenCode SDK');
  assert.match(getCurrentBody, /const newestSdkSession = topLevelSessionsForChat\(normalized\)\[0\];/, 'startup should select the newest session visible in the session picker, never a child/subagent session');
  assert.match(getCurrentBody, /return\s+this\.createNewSession\(\);/, 'a new session may be created only after a successful empty SDK list');
  assert.doesNotMatch(getCurrentBody, /catch[\s\S]*?createNewSession/, 'an SDK list failure must not create a replacement session');

  const listBody = extractFunctionBody(sessionServiceSource, 'async listSessions(): Promise<Session[]>');
  assert.match(listBody, /client\.session\.list\(\)/, 'listSessions should fetch the SDK session list');
  assert.match(listBody, /coalesceSessionsById\(serverSessions\)/, 'listSessions should normalize SDK sessions only');
  assert.doesNotMatch(listBody, /localSessions|mergeMessagesForSessionAliases|initializationPromise/, 'SDK listing must not wait for or merge extension-owned history');
  assert.match(listBody, /this\.sessionHistory\s*=\s*\[\]/, 'SDK errors must not expose stale local sessions');
});

test('session service reads messages exclusively from the OpenCode SDK', () => {
  const getMessagesBody = extractFunctionBody(
    sessionServiceSource,
    'async getMessages(sessionId: string): Promise<unknown[]>',
  );
  assert.match(getMessagesBody, /client\.session\.messages\(/, 'getMessages should call the SDK');
  assert.doesNotMatch(getMessagesBody, /loadSessionMessages|saveSessionMessages|localMessages/, 'getMessages must not read, merge, or persist a local transcript');
  assert.match(
    getMessagesBody,
    /summarizePotentialAssistantDuplicates\(response\.data\)/,
    'getMessages may diagnose duplicate turns in the unmodified SDK response',
  );
});

test('legacy message-cache methods cannot persist or hydrate transcript data', () => {
  const saveBody = extractFunctionBody(sessionServiceSource, 'async saveSessionMessages(');
  const loadBody = extractFunctionBody(sessionServiceSource, 'async loadSessionMessages(');
  assert.doesNotMatch(saveBody, /workspaceState|workspaceFileCache/);
  assert.match(loadBody, /return \[\]/);
});

test('chat provider no longer accepts legacy assistant snapshot persistence from webview', () => {
  assert.doesNotMatch(
    chatProviderSource,
    /case\s+"persistAssistantMessage"/,
    'chat provider should not persist assistant snapshots through the legacy webview backchannel',
  );
});

// Raw SDK event-tape persistence was removed; hydration now snapshots SDK messages directly through SessionSnapshotLoader/SdkMessageAdapter.

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

test('chat provider recreates missing sessions without injecting local transcript context', () => {
  const sendBody = extractFunctionBody(
    chatProviderSource,
    'private async handleSendMessage(',
  );

  assert.doesNotMatch(sendBody, /loadSessionMessages|saveSessionMessages|buildRecoveredTranscript/, 'recovery must not use extension-owned transcript data');
  assert.match(sendBody, /migrateSessionSettings\(/, 'send handler should migrate per-session settings when session IDs are recreated');
  assert.match(sendBody, /return this\.handleSendMessage\([\s\S]*true,[\s\S]*undefined/, 'send handler should retry without a local context payload');
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
