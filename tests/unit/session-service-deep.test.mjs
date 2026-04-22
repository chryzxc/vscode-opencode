import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'services', 'SessionService.ts')],
  'SessionService.ts',
);

test('createNewSession persists successful creates and surfaces server-side error details', () => {
  const body = extractFunctionBody(
    source,
    'async createNewSession(title?: string): Promise<Session> {',
  );

  assert.match(body, /const client = await this\.serverManager\.ensureRunning\(\);/, 'createNewSession should ensure the server is running before creating a session');
  assert.match(body, /const response = await client\.session\.create\(\{[\s\S]*title: title \|\| "Untitled chat",[\s\S]*\}\);/, 'createNewSession should default untitled sessions when no title is provided');
  assert.match(body, /if \(!response\.data\) \{[\s\S]*const msg =[\s\S]*em\?\.message[\s\S]*em\.errors\[0\]\?\.message[\s\S]*"Unknown error";[\s\S]*throw new Error\(`Failed to create session: \$\{msg\}`\);[\s\S]*\}/, 'createNewSession should surface detailed server error messages when creation fails');
  assert.match(body, /this\.currentSession = session;/, 'createNewSession should set the new session as current');
  assert.match(body, /const exists = this\.sessionHistory\.some\(\(s\) => s\.id === session\.id\);[\s\S]*if \(!exists\) \{[\s\S]*this\.sessionHistory\.unshift\(session\);[\s\S]*\}/, 'createNewSession should avoid duplicate history entries');
  assert.match(body, /this\.persistState\(\);/, 'createNewSession should persist workspace state after success');
});

test('current session retrieval waits for initialization and auto-creates when empty, while listSessions merges server and local state', () => {
  const currentBody = extractFunctionBody(
    source,
    'async getCurrentSession(): Promise<Session> {',
  );
  const listBody = extractFunctionBody(
    source,
    'async listSessions(): Promise<Session[]> {',
  );

  assert.match(currentBody, /if \(this\.initializationPromise\) \{[\s\S]*await this\.initializationPromise;[\s\S]*\}/, 'getCurrentSession should wait for asynchronous initialization to finish');
  assert.match(currentBody, /if \(this\.currentSession\) \{[\s\S]*return this\.currentSession;[\s\S]*\}[\s\S]*return this\.createNewSession\(\);/, 'getCurrentSession should create a new session when none is active');
  assert.match(listBody, /const client = await this\.serverManager\.ensureRunning\(\);[\s\S]*const response = await client\.session\.list\(\);/, 'listSessions should fetch server sessions before merging');
  assert.match(listBody, /const mergedMap = new Map<string, Session>\(\);[\s\S]*localSessions\.forEach\([\s\S]*mergedMap\.set\(s\.id, s\);[\s\S]*serverSessions\.forEach\([\s\S]*mergedMap\.set\(s\.id, s\);/, 'listSessions should merge local sessions first and then let server sessions win');
  assert.match(listBody, /const normalized = coalesceSessionsById\(mergedSessions\);/, 'listSessions should coalesce canonical and alias session ids after merging');
  assert.match(listBody, /if \(hasSessionAliasConflicts\(normalized\.aliasesByCanonicalId\)\) \{[\s\S]*await this\.mergeMessagesForSessionAliases\([\s\S]*\);[\s\S]*\}/, 'listSessions should merge cached messages when alias conflicts are detected');
  assert.match(listBody, /catch \(error\) \{[\s\S]*const normalizedLocal = coalesceSessionsById\(this\.sessionHistory\);[\s\S]*this\.sessionHistory = normalizedLocal\.sessions;[\s\S]*this\.persistState\(\);[\s\S]*\}/, 'listSessions should normalize and persist local fallback state when server fetch fails');
});

test('switchSession, deleteSession, and renameSession all preserve local resilience around server failures', () => {
  const switchBody = extractFunctionBody(
    source,
    'async switchSession(sessionId: string): Promise<Session> {',
  );
  const deleteBody = extractFunctionBody(
    source,
    'async deleteSession(sessionId: string): Promise<void> {',
  );
  const renameBody = extractFunctionBody(
    source,
    'async renameSession(sessionId: string, newTitle: string): Promise<Session> {',
  );

  assert.match(switchBody, /const response = await client\.session\.get\(\{[\s\S]*path: \{ id: sessionId \},[\s\S]*\}\);/, 'switchSession should fetch the requested session from the server');
  assert.match(switchBody, /catch \(error\) \{[\s\S]*const localSession = this\.sessionHistory\.find\(\(s\) => s\.id === sessionId\);[\s\S]*this\.currentSession = localSession;[\s\S]*this\.persistState\(\);[\s\S]*return localSession;[\s\S]*\}/, 'switchSession should fall back to matching local session metadata when server fetch fails');
  assert.match(deleteBody, /catch \(error\) \{[\s\S]*log\.warn\("Server delete failed, continuing with local cleanup",[\s\S]*\);[\s\S]*\}/, 'deleteSession should continue local cleanup when server deletion fails');
  assert.match(deleteBody, /await this\.context\.workspaceState\.update\([\s\S]*`\$\{SessionService\.MESSAGES_PREFIX\}\$\{sessionId\}`,[\s\S]*undefined,[\s\S]*\);/, 'deleteSession should clear persisted cached messages for the deleted session');
  assert.match(renameBody, /const response = await client\.session\.update\(\{[\s\S]*body: \{ title: newTitle \},[\s\S]*\}\);/, 'renameSession should attempt a server-side title update');
  assert.match(renameBody, /catch \(error\) \{[\s\S]*const localSession = this\.sessionHistory\.find\(\(s\) => s\.id === sessionId\);[\s\S]*localSession\.title = newTitle;[\s\S]*if \(this\.currentSession\?\.id === sessionId\) \{[\s\S]*this\.currentSession\.title = newTitle;[\s\S]*\}[\s\S]*this\.persistState\(\);[\s\S]*return localSession;[\s\S]*\}/, 'renameSession should optimistically update local and current session titles when the server update fails');
  assert.doesNotMatch(deleteBody, /throw error/, 'deleteSession should not rethrow server delete failures after local cleanup succeeds');
});

test('getMessages merges local and server conversation history before falling back to cached messages', () => {
  const body = extractFunctionBody(
    source,
    'async getMessages(sessionId: string): Promise<unknown[]> {',
  );

  assert.match(body, /const localMessages = await this\.loadSessionMessages\(sessionId\);/, 'getMessages should load cached local messages first');
  assert.match(body, /const response = await client\.session\.messages\(\{[\s\S]*path: \{[\s\S]*id: sessionId,[\s\S]*\},[\s\S]*\}\);/, 'getMessages should ask the server for session messages');
  assert.match(body, /const mergedMessages =[\s\S]*localMessages\.length > 0[\s\S]*mergeConversationMessages\(\[localMessages, response\.data\]\)[\s\S]*: response\.data;/, 'getMessages should merge cached and server messages when both are available');
  assert.match(body, /await this\.saveSessionMessages\(sessionId, mergedMessages\);[\s\S]*return mergedMessages;/, 'getMessages should persist merged server results back to local cache');
  assert.match(body, /catch \(error\) \{[\s\S]*log\.warn\("Error fetching messages from server, using local cache",[\s\S]*\);[\s\S]*\}/, 'getMessages should log server message fetch failures before using cache');
  assert.match(body, /return localMessages;/, 'getMessages should fall back to cached local messages');
});

test('persistence and merge helpers compact payloads, deduplicate messages, and normalize alias session ids', () => {
  assert.match(source, /function redactDataUrl\(value: string\): string \{[\s\S]*return `\[omitted data URL \$\{header\}; ~\$\{formatApproxBytes\(approxBytes\)\}\]`;/, 'redactDataUrl should summarize large inline data URLs for persistence');
  assert.match(source, /function truncateString\(value: string\): string \{[\s\S]*if \(isDataUrl\(value\)\) \{[\s\S]*return redactDataUrl\(value\);[\s\S]*\}[\s\S]*\.\.\.\[truncated \$\{value\.length - MAX_PERSISTED_STRING_LENGTH\} chars\]/, 'truncateString should redact data URLs and truncate oversized strings');
  assert.match(source, /function sanitizeForPersistence\([\s\S]*if \(depth >= MAX_PERSISTED_DEPTH\) \{[\s\S]*return "\[omitted: max depth reached\]";[\s\S]*\}[\s\S]*if \(seen\.has\(obj\)\) \{[\s\S]*return "\[omitted: circular reference\]";[\s\S]*\}/, 'sanitizeForPersistence should cap depth and replace circular references');
  assert.match(source, /function messageRichnessScore\(message: unknown\): number \{[\s\S]*score \+= reasoningEventsCount \* 12;[\s\S]*score \+= progressEventsCount \* 10;[\s\S]*score \+= subagentsCount \* 16;[\s\S]*if \(rec\.structuredOutput && typeof rec\.structuredOutput === "object"\) \{[\s\S]*score \+= 20;[\s\S]*\}/, 'messageRichnessScore should reward richer assistant payloads when choosing merge winners');
  assert.match(source, /function pickRicherMessage\(existing: unknown, incoming: unknown\): unknown \{[\s\S]*const existingScore = messageRichnessScore\(existing\);[\s\S]*const incomingScore = messageRichnessScore\(incoming\);[\s\S]*return mergeRicherMessageFields\(bytePreferred, byteFallback\);[\s\S]*\}/, 'pickRicherMessage should prefer richer messages and break ties by serialized size');
  assert.match(source, /function mergeConversationMessages\(messageGroups: unknown\[\]\[\]\): unknown\[\] \{[\s\S]*flattened\.sort\([\s\S]*a\.created === b\.created \? a\.order - b\.order : a\.created - b\.created,[\s\S]*\)[\s\S]*const indexBySignature = new Map<string, number>\(\);/, 'mergeConversationMessages should order by creation time and deduplicate by message signatures');
  assert.match(source, /function coalesceSessionsById\(sessions: Session\[\]\): \{[\s\S]*const canonicalId = normalizeSessionId\(rawId\);[\s\S]*mergeSessionRecords\(existing, normalizedSession\)[\s\S]*aliasesByCanonicalId\.set\(canonicalId, Array\.from\(aliasSet\)\);/, 'coalesceSessionsById should normalize aliases and merge duplicate session records');
});
