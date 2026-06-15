/**
 * SessionService Unit Tests
 *
 * Comprehensive tests for SessionService covering:
 * - Session lifecycle (create, update, delete)
 * - Server/local data merging
 * - Message persistence and retrieval
 * - State management and initialization
 * - Error handling and fallbacks
 * - Data sanitization and compaction
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const sessionServiceSource = readSource(
  [joinFromRoot('src', 'services', 'SessionService.ts')],
  'SessionService.ts',
);

test('SessionService is exported as a class', () => {
  assert.match(
    sessionServiceSource,
    /export\s+class\s+SessionService/,
    'SessionService should be exported as a class'
  );
});

test('SessionService constructor initializes core state', () => {
  assert.match(
    sessionServiceSource,
    /constructor\([\s\S]*context[\s\S]*serverManager/,
    'Constructor should accept context and serverManager parameters'
  );
  assert.match(
    sessionServiceSource,
    /initializationPromise/,
    'Constructor should trigger async state initialization'
  );
});

test('SessionService defines constants for persistence limits', () => {
  assert.match(
    sessionServiceSource,
    /MAX_CACHED_MESSAGES_PER_SESSION\s*=\s*200/,
    'Should define max cached messages per session'
  );
  assert.match(
    sessionServiceSource,
    /MAX_CACHED_SESSION_BYTES\s*=\s*4\s*\*\s*1024\s*\*\s*1024/,
    'Should define max cached session bytes (4MB)'
  );
  assert.match(
    sessionServiceSource,
    /MAX_PERSISTED_STRING_LENGTH\s*=\s*120_000/,
    'Should define max persisted string length'
  );
  assert.match(
    sessionServiceSource,
    /MAX_PERSISTED_ARRAY_LENGTH\s*=\s*256/,
    'Should define max persisted array length'
  );
  assert.match(
    sessionServiceSource,
    /MAX_PERSISTED_OBJECT_KEYS\s*=\s*200/,
    'Should define max persisted object keys'
  );
  assert.match(
    sessionServiceSource,
    /MAX_PERSISTED_DEPTH\s*=\s*8/,
    'Should define max persisted depth'
  );
});

test('SessionService implements createNewSession', () => {
  assert.match(
    sessionServiceSource,
    /async\s+createNewSession\([\s\S]*title\?\s*:\s*string[\s\S]*\)\s*:\s*Promise<Session>/,
    'Should expose createNewSession method'
  );

  const createBody = extractFunctionBody(
    sessionServiceSource,
    'async createNewSession('
  );

  assert.match(
    createBody,
    /const\s+client\s*=\s*await\s+this\.serverManager\.ensureRunning\(\)/,
    'createNewSession should ensure server is running'
  );
  assert.match(
    createBody,
    /client\.session\.create\(/,
    'createNewSession should call server session.create API'
  );
  assert.match(
    createBody,
    /currentSession/,
    'createNewSession should set current session from response'
  );
  assert.match(
    createBody,
    /updateCurrentSessionId|persistState/,
    'createNewSession should persist current session ID'
  );
});

test('SessionService implements listSessions with merge logic', () => {
  assert.match(
    sessionServiceSource,
    /async\s+listSessions\(\)\s*:\s*Promise<Session\[\]>/,
    'Should expose listSessions method'
  );

  const listBody = extractFunctionBody(
    sessionServiceSource,
    'async listSessions(): Promise<Session[]>'
  );

  assert.match(
    listBody,
    /if\s*\(this\.initializationPromise\)[\s\S]*await\s+this\.initializationPromise/,
    'listSessions should wait for initialization'
  );
  assert.match(
    listBody,
    /new\s+Map<string,\s*Session>\(\)/,
    'listSessions should create map for merging'
  );
  assert.match(
    listBody,
    /localSessions\.forEach\(/,
    'listSessions should add local sessions to map'
  );
  assert.match(
    listBody,
    /serverSessions\.forEach\(/,
    'listSessions should add server sessions to map (overwrites local)'
  );
  assert.match(
    listBody,
    /coalesceSessionsById|\.sort/,
    'listSessions should sort sessions (by creation time)'
  );
  assert.match(
    listBody,
    /catch\s*\(error\)/,
    'listSessions should handle server errors gracefully'
  );
  assert.match(
    listBody,
    /Fallback to local history/,
    'listSessions should fallback to local on server error'
  );
});

test('SessionService implements switchSession', () => {
  assert.match(
    sessionServiceSource,
    /async\s+switchSession\([\s\S]*sessionId\s*:\s*string[\s\S]*\)\s*:\s*Promise<Session>/,
    'Should expose switchSession method'
  );

  const switchBody = extractFunctionBody(
    sessionServiceSource,
    'async switchSession('
  );

  assert.match(
    switchBody,
    /client\.session\.get\(/,
    'switchSession should fetch session from server'
  );
  assert.match(
    switchBody,
    /this\.currentSession\s*=\s*response\.data/,
    'switchSession should set as current session from server response'
  );
  assert.match(
    switchBody,
    /catch\s*\([a-z]+\)/,
    'switchSession should handle errors with fallback to local'
  );
  assert.match(
    switchBody,
    /sessionHistory\.find\(\s*\(s\)\s*=>\s*s\.id\s*===\s*sessionId/,
    'switchSession should find target session by ID in local history as fallback'
  );
  assert.match(
    switchBody,
    /this\.persistState\(\)/,
    'switchSession should persist new current session state'
  );
});

test('SessionService implements deleteSession', () => {
  assert.match(
    sessionServiceSource,
    /async\s+deleteSession\([\s\S]*sessionId\s*:\s*string[\s\S]*\)\s*:\s*Promise<void>/,
    'Should expose deleteSession method'
  );

  const deleteBody = extractFunctionBody(
    sessionServiceSource,
    'async deleteSession('
  );

  assert.match(
    deleteBody,
    /const\s+client\s*=\s*await\s+this\.serverManager\.ensureRunning\(\)/,
    'deleteSession should ensure server is running'
  );
  assert.match(
    deleteBody,
    /client\.session\.delete\(/,
    'deleteSession should call server session.delete API'
  );
  assert.match(
    deleteBody,
    /MESSAGES_PREFIX.*sessionId|workspaceState\.update/,
    'deleteSession should delete cached messages from workspace state'
  );
  assert.match(
    deleteBody,
    /if\s*\(this\.currentSession\?\.id\s*===\s*sessionId\)/,
    'deleteSession should clear current session if deleting active'
  );
});

test('SessionService implements getCurrentSession with auto-create', () => {
  assert.match(
    sessionServiceSource,
    /async\s+getCurrentSession\(\)\s*:\s*Promise<Session>/,
    'Should expose getCurrentSession method'
  );

  const getCurrentBody = extractFunctionBody(
    sessionServiceSource,
    'async getCurrentSession(): Promise<Session>'
  );

  assert.match(
    getCurrentBody,
    /if\s*\(this\.initializationPromise\)/,
    'getCurrentSession should wait for initialization'
  );
  assert.match(
    getCurrentBody,
    /if\s*\(this\.currentSession\)[\s\S]*return\s+this\.currentSession/,
    'getCurrentSession should return existing session if available'
  );
  assert.match(
    getCurrentBody,
    /return\s+this\.createNewSession\(\)/,
    'getCurrentSession should auto-create session if none exists'
  );
});

test('SessionService implements getMessages with merge', () => {
  assert.match(
    sessionServiceSource,
    /async\s+getMessages\([\s\S]*sessionId\s*:\s*string[\s\S]*\)\s*:\s*Promise<unknown\[\]>/,
    'Should expose getMessages method'
  );

  const getMessagesBody = extractFunctionBody(
    sessionServiceSource,
    'async getMessages(sessionId: string): Promise<unknown[]>'
  );

  assert.match(
    getMessagesBody,
    /const\s+localMessages\s*=\s*await\s+this\.loadSessionMessages\(/,
    'getMessages should load local cache first'
  );
  assert.match(
    getMessagesBody,
    /client\.session\.messages\(/,
    'getMessages should fetch from server'
  );
  assert.match(
    getMessagesBody,
    /mergeConversationMessages\(\[localMessages,\s*response\.data\]\)/,
    'getMessages should merge local and server messages'
  );
  assert.match(
    getMessagesBody,
    /this\.saveSessionMessages\(/,
    'getMessages should persist merged messages'
  );
});

test('SessionService implements upsertMessage for rich persistence', () => {
  assert.match(
    sessionServiceSource,
    /async\s+upsertMessage\([\s\S]*sessionId\s*:\s*string[\s\S]*message\s*:\s*unknown[\s\S]*\)\s*:\s*Promise<void>/,
    'Should expose upsertMessage method'
  );

  const upsertBody = extractFunctionBody(
    sessionServiceSource,
    'async upsertMessage('
  );

  assert.match(
    upsertBody,
    /const\s+messages\s*=\s*await\s+this\.loadSessionMessages\(/,
    'upsertMessage should load existing messages'
  );
  assert.match(
    upsertBody,
    /getMessageSignaturesForMerge\(/,
    'upsertMessage should compute candidate signature set'
  );
  assert.match(
    upsertBody,
    /pickRicherMessage\(/,
    'upsertMessage should pick richer message on duplicate'
  );
  assert.match(
    upsertBody,
    /this\.saveSessionMessages\(/,
    'upsertMessage should persist updated messages'
  );
});

test('SessionService implements message merge utilities', () => {
  assert.match(
    sessionServiceSource,
    /function\s+mergeConversationMessages\(/,
    'Should define mergeConversationMessages function'
  );
  assert.match(
    sessionServiceSource,
    /function\s+pickRicherMessage\(/,
    'Should define pickRicherMessage function'
  );
  assert.match(
    sessionServiceSource,
    /function\s+getMessageSignature\(/,
    'Should define getMessageSignature function'
  );
  assert.match(
    sessionServiceSource,
    /function\s+mergeRicherMessageFields\(/,
    'Should define mergeRicherMessageFields function'
  );
  assert.match(
    sessionServiceSource,
    /rawSdkEventPayloads/,
    'mergeRicherMessageFields should preserve rawSdkEventPayloads'
  );
  assert.match(
    sessionServiceSource,
    /rawResponse/,
    'mergeRicherMessageFields should preserve rawResponse'
  );
});

test('SessionService implements state initialization', () => {
  assert.match(
    sessionServiceSource,
    /private\s+async\s+loadPersistedState\(\)/,
    'Should expose loadPersistedState method'
  );

  assert.match(
    sessionServiceSource,
    /SESSION_ID_KEY/,
    'loadPersistedState should load persisted session ID using SESSION_ID_KEY'
  );
  assert.match(
    sessionServiceSource,
    /switchSession\(/,
    'loadPersistedState should switch to persisted session'
  );
});

test('SessionService implements message persistence helpers', () => {
  assert.match(
    sessionServiceSource,
    /async\s+loadSessionMessages\(/,
    'Should expose loadSessionMessages method'
  );
  assert.match(
    sessionServiceSource,
    /async\s+saveSessionMessages\(/,
    'Should expose saveSessionMessages method'
  );
});

test('SessionService implements data URL detection and redaction', () => {
  assert.match(
    sessionServiceSource,
    /function\s+isDataUrl\(/,
    'Should define isDataUrl function'
  );

  const isDataUrlBody = extractFunctionBody(
    sessionServiceSource,
    'function isDataUrl('
  );

  assert.match(
    isDataUrlBody,
    /\.test\(value\)/,
    'isDataUrl should use regex to detect data URLs'
  );

  assert.match(
    sessionServiceSource,
    /function\s+redactDataUrl\(/,
    'Should define redactDataUrl function'
  );

  const redactBody = extractFunctionBody(
    sessionServiceSource,
    'function redactDataUrl('
  );

  assert.match(
    redactBody,
    /formatApproxBytes\(/,
    'redactDataUrl should calculate and show approximate size'
  );
  assert.match(
    redactBody,
    /\[omitted\s+data\s+URL/,
    'redactDataUrl should return redacted string'
  );
});

test('SessionService implements string truncation', () => {
  assert.match(
    sessionServiceSource,
    /function\s+truncateString\(/,
    'Should define truncateString function'
  );

  const truncateBody = extractFunctionBody(
    sessionServiceSource,
    'function truncateString('
  );

  assert.match(
    truncateBody,
    /if\s*\(isDataUrl\(value\)\)/,
    'truncateString should redact data URLs'
  );
  assert.match(
    truncateBody,
    /if\s*\(value\.length\s*<=\s*MAX_PERSISTED_STRING_LENGTH\)/,
    'truncateString should check length limit'
  );
  assert.match(
    truncateBody,
    /\.\.\.\[truncated/,
    'truncateString should add truncation marker'
  );
});

test('SessionService implements sanitizeForPersistence', () => {
  assert.match(
    sessionServiceSource,
    /function\s+sanitizeForPersistence\(/,
    'Should define sanitizeForPersistence function'
  );

  const sanitizeBody = extractFunctionBody(
    sessionServiceSource,
    'function sanitizeForPersistence('
  );

  assert.match(
    sanitizeBody,
    /if\s*\(value\s*==\s*null\)\s*return\s+value/,
    'sanitizeForPersistence should handle null/undefined'
  );
  assert.match(
    sanitizeBody,
    /typeof\s+value\s*===\s*"string"[\s\S]*truncateString/,
    'sanitizeForPersistence should truncate strings'
  );
  assert.match(
    sanitizeBody,
    /if\s*\(depth\s*>=\s*MAX_PERSISTED_DEPTH\)/,
    'sanitizeForPersistence should limit depth'
  );
  assert.match(
    sanitizeBody,
    /if\s*\(Array\.isArray\(value\)\)/,
    'sanitizeForPersistence should handle arrays'
  );
  assert.match(
    sanitizeBody,
    /\.slice\(0,\s*MAX_PERSISTED_ARRAY_LENGTH\)/,
    'sanitizeForPersistence should limit array length'
  );
  assert.match(
    sanitizeBody,
    /seen\.has\(/,
    'sanitizeForPersistence should detect circular references'
  );
  assert.match(
    sanitizeBody,
    /Object\.entries\(obj\)\.slice\(0,\s*MAX_PERSISTED_OBJECT_KEYS\)/,
    'sanitizeForPersistence should limit object keys'
  );
  assert.match(
    sanitizeBody,
    /rawSdkEventPayloads/,
    'sanitizeForPersistence should preserve rawSdkEventPayloads even when object keys are truncated'
  );
  assert.match(
    sanitizeBody,
    /rawResponse/,
    'sanitizeForPersistence should preserve rawResponse even when object keys are truncated'
  );
});

test('SessionService implements compaction functions for persistence', () => {
  assert.match(
    sessionServiceSource,
    /function\s+compactReasoningEventForPersistence\(/,
    'Should define compactReasoningEventForPersistence'
  );
  assert.match(
    sessionServiceSource,
    /function\s+compactProgressEventForPersistence\(/,
    'Should define compactProgressEventForPersistence'
  );
  assert.match(
    sessionServiceSource,
    /function\s+compactSubagentForPersistence\(/,
    'Should define compactSubagentForPersistence'
  );
  assert.match(
    sessionServiceSource,
    /compact\.rawSdkEventPayloads\s*=\s*\(rec\.rawSdkEventPayloads as unknown\[\]\)/,
    'compactMessageForPersistence should retain rawSdkEventPayloads'
  );
});

test('SessionService defines compaction limits', () => {
  assert.match(
    sessionServiceSource,
    /MAX_COMPACT_REASONING_EVENTS\s*=\s*120/,
    'Should define max compact reasoning events'
  );
  assert.match(
    sessionServiceSource,
    /MAX_COMPACT_PROGRESS_EVENTS\s*=\s*200/,
    'Should define max compact progress events'
  );
  assert.match(
    sessionServiceSource,
    /MAX_COMPACT_STEPS\s*=\s*200/,
    'Should define max compact steps'
  );
  assert.match(
    sessionServiceSource,
    /MAX_COMPACT_SUBAGENTS\s*=\s*64/,
    'Should define max compact subagents'
  );
  assert.match(
    sessionServiceSource,
    /MAX_COMPACT_SUBAGENT_EVENTS\s*=\s*120/,
    'Should define max compact subagent events'
  );
  assert.match(
    sessionServiceSource,
    /MAX_COMPACT_INTERACTIVE_EVENTS\s*=\s*40/,
    'Should define max compact interactive events'
  );
});

test('SessionService implements byte size estimation', () => {
  assert.match(
    sessionServiceSource,
    /function\s+estimateSerializedBytes\(/,
    'Should define estimateSerializedBytes function'
  );

  const estimateBody = extractFunctionBody(
    sessionServiceSource,
    'function estimateSerializedBytes('
  );

  assert.match(
    estimateBody,
    /Buffer\.byteLength\(JSON\.stringify\(value\),\s*"utf8"\)/,
    'estimateSerializedBytes should calculate UTF8 byte length'
  );
  assert.match(
    estimateBody,
    /catch[\s\S]*return\s+Number\.MAX_SAFE_INTEGER/,
    'estimateSerializedBytes should handle serialization errors'
  );
});

test('SessionService implements current session ID management', () => {
  assert.match(
    sessionServiceSource,
    /persistState/,
    'Should expose persistState method for session ID management'
  );

  const persistBody = extractFunctionBody(
    sessionServiceSource,
    'private persistState()'
  );

  assert.match(
    persistBody,
    /this\.context\.(workspaceState|globalState)\.update\(/,
    'persistState should persist to workspace state'
  );
});

test('SessionService implements loadSessionById', () => {
  // Note: loadSessionById functionality is handled by switchSession
  assert.match(
    sessionServiceSource,
    /switchSession\(/,
    'Should expose switchSession method which loads session by ID'
  );

  const switchBody = extractFunctionBody(
    sessionServiceSource,
    'async switchSession('
  );

  assert.match(
    switchBody,
    /client\.session\.get\(/,
    'switchSession should fetch from server'
  );
  assert.match(
    switchBody,
    /currentSession/,
    'switchSession should set as current session'
  );
});

test('SessionService handles errors gracefully', () => {
  const listBody = extractFunctionBody(
    sessionServiceSource,
    'async listSessions(): Promise<Session[]>'
  );

  assert.match(
    listBody,
    /catch\s*\(error\)/,
    'listSessions should catch server errors'
  );
  assert.match(
    listBody,
    /(console\.error|this\.logger\.error|log\.error)/,
    'listSessions should log errors'
  );

  const getMessagesBody = extractFunctionBody(
    sessionServiceSource,
    'async getMessages(sessionId: string): Promise<unknown[]>'
  );

  assert.match(
    getMessagesBody,
    /catch\s*\(error\)/,
    'getMessages should handle errors'
  );
});

test('SessionService compaction preserves essential fields', () => {
  const compactReasoningBody = extractFunctionBody(
    sessionServiceSource,
    'function compactReasoningEventForPersistence('
  );

  assert.match(
    compactReasoningBody,
    /typeof\s+rec\.id\s*===\s*"string"/,
    'compactReasoningEventForPersistence should preserve id'
  );
  assert.match(
    compactReasoningBody,
    /typeof\s+rec\.text\s*===\s*"string"/,
    'compactReasoningEventForPersistence should preserve text'
  );
  assert.match(
    compactReasoningBody,
    /typeof\s+rec\.createdAt\s*===\s*"number"/,
    'compactReasoningEventForPersistence should preserve createdAt'
  );

  const compactProgressBody = extractFunctionBody(
    sessionServiceSource,
    'function compactProgressEventForPersistence('
  );

  assert.match(
    compactProgressBody,
    /typeof\s+rec\.id\s*===\s*"string"/,
    'compactProgressEventForPersistence should preserve id'
  );
  assert.match(
    compactProgressBody,
    /typeof\s+rec\.title\s*===\s*"string"/,
    'compactProgressEventForPersistence should preserve title'
  );
  assert.match(
    compactProgressBody,
    /typeof\s+rec\.status\s*===\s*"string"/,
    'compactProgressEventForPersistence should preserve status'
  );
});

test('SessionService uses multi-signature matching for message merge/upsert', () => {
  assert.match(
    sessionServiceSource,
    /function\s+getMessageSignaturesForMerge\(/,
    'Should define getMessageSignaturesForMerge helper'
  );

  const signaturesBody = extractFunctionBody(
    sessionServiceSource,
    'function getMessageSignaturesForMerge('
  );
  assert.match(
    signaturesBody,
    /getMessageSignature\(message\)/,
    'Signature helper should include primary message signature'
  );
  assert.match(
    signaturesBody,
    /getMessageFallbackSignature\(message\)/,
    'Signature helper should include fallback signature'
  );
  assert.match(
    signaturesBody,
    /getAssistantContentAliasSignature\(message\)/,
    'Signature helper should include assistant alias signature'
  );

  const mergeBody = extractFunctionBody(
    sessionServiceSource,
    'function mergeConversationMessages('
  );
  assert.match(
    mergeBody,
    /getMessageSignaturesForMerge\(item\.message\)/,
    'Conversation merge should resolve all candidate signatures for incoming message'
  );
  assert.match(
    mergeBody,
    /signatures\s*\.\s*map\(\(signature\)\s*=>\s*indexBySignature\.get\(signature\)\)\s*\.\s*find\(/,
    'Conversation merge should match existing messages by any candidate signature'
  );

  const upsertBody = extractFunctionBody(
    sessionServiceSource,
    'async upsertMessage(sessionId: string, message: unknown): Promise<void>'
  );
  assert.match(
    upsertBody,
    /const\s+incomingSignatures\s*=\s*getMessageSignaturesForMerge\(message\)/,
    'Upsert should compute incoming signature set'
  );
  assert.match(
    upsertBody,
    /incomingSignatures\.some\(\(signature\)\s*=>\s*candidateSignatures\.includes\(signature\),?\s*\)/,
    'Upsert should match existing assistant messages by intersecting signature sets'
  );
});
