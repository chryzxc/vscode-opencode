/**
 * MessageStreamService Unit Tests
 *
 * Comprehensive tests for MessageStreamService covering:
 * - SSE streaming lifecycle
 * - Subscribe/unsubscribe patterns
 * - Event normalization and processing
 * - Workspace directory filtering
 * - Duplicate event detection
 * - Auto-reconnect logic
 * - Resource cleanup and disposal
 * - Event logging and debugging
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const messageStreamSource = readSource(
  [joinFromRoot('src', 'services', 'MessageStreamService.ts')],
  'MessageStreamService.ts',
);

test('MessageStreamService exports type definitions', () => {
  assert.match(
    messageStreamSource,
    /export\s+interface\s+StreamEvent/,
    'Should export StreamEvent interface'
  );
  assert.match(
    messageStreamSource,
    /type:\s*string/,
    'StreamEvent should have type property'
  );
  assert.match(
    messageStreamSource,
    /properties\?:\s*Record<string,\s*unknown>/,
    'StreamEvent should have optional properties'
  );

  assert.match(
    messageStreamSource,
    /export\s+type\s+StreamCallback/,
    'Should export StreamCallback type'
  );
  assert.match(
    messageStreamSource,
    /\(event:\s*StreamEvent\)\s*=>\s*void/,
    'StreamCallback should be a function type'
  );
});

test('MessageStreamService is exported as a class', () => {
  assert.match(
    messageStreamSource,
    /export\s+class\s+MessageStreamService/,
    'MessageStreamService should be exported as a class'
  );
});

test('MessageStreamService constructor initializes state', () => {
  assert.match(
    messageStreamSource,
    /constructor\([\s\S]*serverManager/,
    'Constructor should accept serverManager parameter'
  );
});

test('MessageStreamService defines heartbeat event types', () => {
  assert.match(
    messageStreamSource,
    /private\s+static\s+readonly\s+HEARTBEAT_EVENT_TYPES\s*=\s*new Set\(/,
    'Should define HEARTBEAT_EVENT_TYPES set'
  );
  assert.match(
    messageStreamSource,
    /"server\.heartbeat"/,
    'Should include server.heartbeat as heartbeat type'
  );
});

test('MessageStreamService initializes instance state', () => {
  assert.match(
    messageStreamSource,
    /private\s+abortController:\s*AbortController\s*\|\s*null\s*=\s*null/,
    'Should initialize abortController as null'
  );
  assert.match(
    messageStreamSource,
    /private\s+callbacks:\s*Set<StreamCallback>\s*=\s*new Set\(\)/,
    'Should initialize callbacks as empty Set'
  );
  assert.match(
    messageStreamSource,
    /private\s+reconnectTimer:\s*NodeJS\.Timeout\s*\|\s*null\s*=\s*null/,
    'Should initialize reconnectTimer as null'
  );
  assert.match(
    messageStreamSource,
    /private\s+recentEventSignatures:\s*Map</,
    'Should initialize recentEventSignatures map'
  );
});

test('MessageStreamService implements startListening', () => {
  assert.match(
    messageStreamSource,
    /async\s+startListening\(\)\s*:\s*Promise<void>/,
    'Should expose startListening method'
  );

  const startListeningBody = extractFunctionBody(
    messageStreamSource,
    'async startListening(): Promise<void>'
  );

  assert.match(
    startListeningBody,
    /this\.clearReconnectTimer\(\)/,
    'startListening should clear existing reconnect timer'
  );
  assert.match(
    startListeningBody,
    /this\.recentEventSignatures\.clear\(\)/,
    'startListening should clear event signatures'
  );
  assert.match(
    startListeningBody,
    /this\.stopListening\(\)/,
    'startListening should stop existing connection'
  );
  assert.match(
    startListeningBody,
    /this\.abortController\s*=\s*new AbortController\(\)/,
    'startListening should create new AbortController'
  );
  assert.match(
    startListeningBody,
    /const\s+client\s*=\s*await\s+this\.serverManager\.ensureRunning\(\)/,
    'startListening should ensure server is running'
  );
});

test('MessageStreamService handles workspace directory in startListening', () => {
  const startListeningBody = extractFunctionBody(
    messageStreamSource,
    'async startListening(): Promise<void>'
  );

  assert.match(
    startListeningBody,
    /vscode\.workspace\.workspaceFolders\?\.\[0\]\?\.uri\.scheme\s*===\s*"file"/,
    'startListening should check workspace folder scheme'
  );
  assert.match(
    startListeningBody,
    /workspaceDirectory\s*=/,
    'startListening should extract workspace directory'
  );
  assert.match(
    startListeningBody,
    /\.replace\(\/\\\\\/g,\s*["']\/["']\)/,
    'startListening should normalize path separators'
  );
  assert.match(
    startListeningBody,
    /\.replace\(\/\\\/\+\$\/,\s*["']['"]\)/,
    'startListening should remove trailing slashes'
  );
});

test('MessageStreamService subscribes to SDK event streams', () => {
  const startListeningBody = extractFunctionBody(
    messageStreamSource,
    'async startListening(): Promise<void>'
  );

  assert.match(
    startListeningBody,
    /client\.event\.subscribe\(/,
    'startListening should subscribe to /event endpoint'
  );
  assert.match(
    startListeningBody,
    /onSseEvent:\s*\(sseEvent:\s*unknown\)\s*=>/,
    'startListening should attach SSE event callback'
  );
  assert.match(
    startListeningBody,
    /onSseError:\s*\(error:\s*unknown\)\s*=>/,
    'startListening should attach SSE error callback'
  );
});

test('MessageStreamService subscribes to global event fallback', () => {
  const startListeningBody = extractFunctionBody(
    messageStreamSource,
    'async startListening(): Promise<void>'
  );

  assert.match(
    startListeningBody,
    /client\.global/,
    'startListening should check for global event availability'
  );
  assert.match(
    startListeningBody,
    /global\.event\(/,
    'startListening should subscribe to /global/event'
  );
  assert.match(
    startListeningBody,
    /Subscribing\s+to\s+\/global\/event/,
    'startListening should log global event subscription'
  );
});

test('MessageStreamService consumes event streams', () => {
  const startListeningBody = extractFunctionBody(
    messageStreamSource,
    'async startListening(): Promise<void>'
  );

  assert.match(
    startListeningBody,
    /this\.consumeEventStream\(\s*events!?\.stream,\s*"\/event"/,
    'startListening should consume /event stream'
  );
  assert.match(
    startListeningBody,
    /this\.consumeEventStream\(\s*globalEvents\.stream,\s*"\/global\/event"/,
    'startListening should consume /global/event stream'
  );
  assert.match(
    startListeningBody,
    /Promise\.allSettled\(streamTasks\)/,
    'startListening should wait for all streams with allSettled'
  );
});

test('MessageStreamService implements stopListening', () => {
  assert.match(
    messageStreamSource,
    /stopListening\(\)\s*:\s*void/,
    'Should expose stopListening method'
  );

  const stopListeningBody = extractFunctionBody(
    messageStreamSource,
    'stopListening(): void'
  );

  assert.match(
    stopListeningBody,
    /this\.clearReconnectTimer\(\)/,
    'stopListening should clear reconnect timer'
  );
  assert.match(
    stopListeningBody,
    /this\.recentEventSignatures\.clear\(\)/,
    'stopListening should clear event signatures'
  );
  assert.match(
    stopListeningBody,
    /if\s*\(this\.abortController\)/,
    'stopListening should check for abort controller'
  );
  assert.match(
    stopListeningBody,
    /this\.abortController\.abort\(\)/,
    'stopListening should abort the controller'
  );
  assert.match(
    stopListeningBody,
    /this\.abortController\s*=\s*null/,
    'stopListening should clear abort controller reference'
  );
});

test('MessageStreamService implements subscribe with auto-lifecycle', () => {
  assert.match(
    messageStreamSource,
    /subscribe\([\s\S]*callback:\s*StreamCallback[\s\S]*\)\s*:\s*\(\)\s*=>\s*void/,
    'Should expose subscribe method returning unsubscribe function'
  );

  const subscribeBody = extractFunctionBody(
    messageStreamSource,
    'subscribe(callback: StreamCallback)'
  );

  assert.match(
    subscribeBody,
    /this\.callbacks\.add\(callback\)/,
    'subscribe should add callback to callbacks set'
  );
  assert.match(
    subscribeBody,
    /if\s*\(this\.callbacks\.size\s*===\s*1\)/,
    'subscribe should check if first subscriber'
  );
  assert.match(
    subscribeBody,
    /this\.startListening\(\)\.catch\(\(error\)\s*=>\s*(this\.logger\.error|console\.error)/,
    'subscribe should start listening on first subscriber with error handling'
  );
  assert.match(
    subscribeBody,
    /return\s*\(\)\s*=>/,
    'subscribe should return unsubscribe function'
  );
});

test('MessageStreamService unsubscribe stops listening when last subscriber', () => {
  const subscribeBody = extractFunctionBody(
    messageStreamSource,
    'subscribe(callback: StreamCallback)'
  );

  assert.match(
    subscribeBody,
    /this\.callbacks\.delete\(callback\)/,
    'unsubscribe should delete callback from set'
  );
  assert.match(
    subscribeBody,
    /if\s*\(this\.callbacks\.size\s*===\s*0\)/,
    'unsubscribe should check if no more subscribers'
  );
  assert.match(
    subscribeBody,
    /this\.stopListening\(\)/,
    'unsubscribe should stop listening when last subscriber leaves'
  );
});

test('MessageStreamService implements dispose', () => {
  assert.match(
    messageStreamSource,
    /dispose\(\)\s*:\s*void/,
    'Should expose dispose method'
  );

  const disposeBody = extractFunctionBody(
    messageStreamSource,
    'dispose(): void'
  );

  assert.match(
    disposeBody,
    /this\.stopListening\(\)/,
    'dispose should stop listening'
  );
  assert.match(
    disposeBody,
    /this\.callbacks\.clear\(\)/,
    'dispose should clear all callbacks'
  );
});

test('MessageStreamService implements consumeEventStream', () => {
  assert.match(
    messageStreamSource,
    /private\s+async\s+consumeEventStream\(/,
    'Should expose consumeEventStream method'
  );

  const consumeStreamBody = extractFunctionBody(
    messageStreamSource,
    'private async consumeEventStream('
  );

  assert.match(
    consumeStreamBody,
    /for\s+await\s+\(const\s+rawEvent\s+of\s+stream\)/,
    'consumeEventStream should iterate over stream'
  );
  assert.match(
    consumeStreamBody,
    /if\s*\(abortSignal\.aborted\)/,
    'consumeEventStream should check abort signal'
  );
  assert.match(
    consumeStreamBody,
    /break/,
    'consumeEventStream should break loop on abort'
  );
});

test('MessageStreamService normalizes incoming events', () => {
  const consumeStreamBody = extractFunctionBody(
    messageStreamSource,
    'private async consumeEventStream('
  );

  assert.match(
    consumeStreamBody,
    /const\s+normalizedEvent\s*=\s*this\.normalizeIncomingEvent\(/,
    'consumeEventStream should normalize raw events'
  );
  assert.match(
    consumeStreamBody,
    /if\s*\(!normalizedEvent\)/,
    'consumeEventStream should skip unknown event shapes'
  );
  assert.match(
    consumeStreamBody,
    /Skipping\s+unknown\s+event\s+shape/,
    'consumeEventStream should log skipped events'
  );
});

test('MessageStreamService filters events by workspace directory', () => {
  const consumeStreamBody = extractFunctionBody(
    messageStreamSource,
    'private async consumeEventStream('
  );

  assert.match(
    consumeStreamBody,
    /this\.isEventInWorkspaceDirectory\(/,
    'consumeEventStream should check workspace directory match'
  );
  assert.match(
    consumeStreamBody,
    /Ignoring\s+event.*directory\s+mismatch/,
    'consumeEventStream should log filtered events'
  );
});

test('MessageStreamService detects and filters duplicate events', () => {
  const consumeStreamBody = extractFunctionBody(
    messageStreamSource,
    'private async consumeEventStream('
  );

  assert.match(
    consumeStreamBody,
    /if\s*\(this\.isDuplicateEvent\(/,
    'consumeEventStream should check for duplicate events'
  );
  assert.match(
    consumeStreamBody,
    /Dropped\s+duplicate\s+event/,
    'consumeEventStream should log duplicate drops'
  );
  assert.match(
    consumeStreamBody,
    /continue/,
    'consumeEventStream should skip duplicate events'
  );
});

test('MessageStreamService implements normalizeIncomingEvent', () => {
  assert.match(
    messageStreamSource,
    /private\s+normalizeIncomingEvent\(/,
    'Should expose normalizeIncomingEvent method'
  );

  const normalizeBody = extractFunctionBody(
    messageStreamSource,
    'private normalizeIncomingEvent('
  );

  assert.match(
    normalizeBody,
    /const\s+eventRecord\s*=\s*this\.asRecord\(rawEvent\)/,
    'normalizeIncomingEvent should convert to record'
  );
  assert.match(
    normalizeBody,
    /if\s*\(typeof\s+eventRecord\.type\s*===\s*"string"\)/,
    'normalizeIncomingEvent should check for direct type field'
  );
});

test('MessageStreamService normalizes event payload wrappers', () => {
  const normalizeBody = extractFunctionBody(
    messageStreamSource,
    'private normalizeIncomingEvent('
  );

  assert.match(
    normalizeBody,
    /const\s+payload\s*=\s*this\.asRecord\(eventRecord\.payload\)/,
    'normalizeIncomingEvent should extract payload'
  );
  assert.match(
    normalizeBody,
    /typeof\s+payload\.type\s*===\s*"string"/,
    'normalizeIncomingEvent should check payload.type'
  );
  assert.match(
    normalizeBody,
    /const\s+data\s*=\s*this\.asRecord\(eventRecord\.data\)/,
    'normalizeIncomingEvent should extract data'
  );
  assert.match(
    normalizeBody,
    /typeof\s+data\.type\s*===\s*"string"/,
    'normalizeIncomingEvent should check data.type'
  );
});

test('MessageStreamService normalizes nested wrappers', () => {
  const normalizeBody = extractFunctionBody(
    messageStreamSource,
    'private normalizeIncomingEvent('
  );

  assert.match(
    normalizeBody,
    /const\s+nestedPayload\s*=\s*this\.asRecord\(payload\?\.payload\)/,
    'normalizeIncomingEvent should check nested payload'
  );
  assert.match(
    normalizeBody,
    /const\s+nestedData\s*=\s*this\.asRecord\(payload\?\.data\)/,
    'normalizeIncomingEvent should check nested data'
  );
});

test('MessageStreamService implements isEventInWorkspaceDirectory', () => {
  assert.match(
    messageStreamSource,
    /private\s+isEventInWorkspaceDirectory\(/,
    'Should expose isEventInWorkspaceDirectory method'
  );

  const isInWorkspaceBody = extractFunctionBody(
    messageStreamSource,
    'private isEventInWorkspaceDirectory('
  );

  assert.match(
    isInWorkspaceBody,
    /if\s*\(!workspaceDirectory\)/,
    'isEventInWorkspaceDirectory should return true if no workspace directory'
  );
  assert.match(
    isInWorkspaceBody,
    /this\.normalizeDirectory\(/,
    'isEventInWorkspaceDirectory should normalize directories for comparison'
  );
});

test('MessageStreamService implements normalizeDirectory', () => {
  assert.match(
    messageStreamSource,
    /private\s+normalizeDirectory\(/,
    'Should expose normalizeDirectory method'
  );

  const normalizeDirBody = extractFunctionBody(
    messageStreamSource,
    'private normalizeDirectory('
  );

  assert.match(
    normalizeDirBody,
    /\.replace\(\/\\\\\/g,\s*["']\/["']\)/,
    'normalizeDirectory should convert backslashes to forward slashes'
  );
  assert.match(
    normalizeDirBody,
    /\.replace\(\/\\\/\+\$\/,\s*["']['"]\)/,
    'normalizeDirectory should remove trailing slashes'
  );
  assert.match(
    normalizeDirBody,
    /process\.platform\s*===\s*"win32"/,
    'normalizeDirectory should check for Windows platform'
  );
  assert.match(
    normalizeDirBody,
    /\.toLowerCase\(\)/,
    'normalizeDirectory should lowercase on Windows'
  );
});

test('MessageStreamService implements isDuplicateEvent', () => {
  assert.match(
    messageStreamSource,
    /private\s+isDuplicateEvent\(/,
    'Should expose isDuplicateEvent method'
  );

  const isDuplicateBody = extractFunctionBody(
    messageStreamSource,
    'private isDuplicateEvent('
  );

  assert.match(
    isDuplicateBody,
    /const\s+signature\s*=\s*this\.getEventSignature\(/,
    'isDuplicateEvent should get event signature'
  );
  assert.match(
    isDuplicateBody,
    /const\s+duplicateWindowMs\s*=\s*350/,
    'isDuplicateEvent should define 350ms duplicate window'
  );
  assert.match(
    isDuplicateBody,
    /const\s+staleEntryWindowMs\s*=\s*10_000/,
    'isDuplicateEvent should define 10s stale entry window'
  );
  assert.match(
    isDuplicateBody,
    /this\.recentEventSignatures\.set\(/,
    'isDuplicateEvent should record event signature'
  );
});

test('MessageStreamService implements getEventSignature', () => {
  assert.match(
    messageStreamSource,
    /private\s+getEventSignature\(/,
    'Should expose getEventSignature method'
  );

  const getSignatureBody = extractFunctionBody(
    messageStreamSource,
    'private getEventSignature('
  );

  assert.match(
    getSignatureBody,
    /return\s+JSON\.stringify\(/,
    'getEventSignature should return JSON string'
  );
  assert.match(
    getSignatureBody,
    /type:\s*event\.type/,
    'getEventSignature should include event type'
  );
  assert.match(
    getSignatureBody,
    /messageID:/,
    'getEventSignature should include message ID'
  );
  assert.match(
    getSignatureBody,
    /partID:/,
    'getEventSignature should include part ID'
  );
  assert.match(
    getSignatureBody,
    /delta:/,
    'getEventSignature should include delta content'
  );
});

test('MessageStreamService implements notifyCallbacks', () => {
  assert.match(
    messageStreamSource,
    /private\s+notifyCallbacks\(/,
    'Should expose notifyCallbacks method'
  );

  const notifyBody = extractFunctionBody(
    messageStreamSource,
    'private notifyCallbacks('
  );

  assert.match(
    notifyBody,
    /this\.callbacks\.forEach\(\(callback\)\s*=>/,
    'notifyCallbacks should iterate over all callbacks'
  );
  assert.match(
    notifyBody,
    /try\s*\{[\s\S]*callback\(event\)/,
    'notifyCallbacks should call callback in try block'
  );
  assert.match(
    notifyBody,
    /catch\s*\(error\)/,
    'notifyCallbacks should catch callback errors'
  );
  assert.match(
    notifyBody,
    /(this\.logger\.error|console\.error)\("Callback\s*(error|error in subscriber)"/,
    'notifyCallbacks should log callback errors'
  );
});

test('MessageStreamService implements clearReconnectTimer', () => {
  assert.match(
    messageStreamSource,
    /private\s+clearReconnectTimer\(\)/,
    'Should expose clearReconnectTimer method'
  );

  const clearTimerBody = extractFunctionBody(
    messageStreamSource,
    'private clearReconnectTimer()'
  );

  assert.match(
    clearTimerBody,
    /if\s*\(this\.reconnectTimer\)/,
    'clearReconnectTimer should check if timer exists'
  );
  assert.match(
    clearTimerBody,
    /clearTimeout\(this\.reconnectTimer\)/,
    'clearReconnectTimer should clear timer'
  );
  assert.match(
    clearTimerBody,
    /this\.reconnectTimer\s*=\s*null/,
    'clearReconnectTimer should null timer reference'
  );
});

test('MessageStreamService implements auto-reconnect on errors', () => {
  const startListeningBody = extractFunctionBody(
    messageStreamSource,
    'async startListening(): Promise<void>'
  );

  assert.match(
    startListeningBody,
    /catch\s*\(error:\s*any\)/,
    'startListening should catch errors'
  );
  assert.match(
    startListeningBody,
    /if\s*\(error\.name\s*===\s*"AbortError"\s*\|\|\s*abortSignal\.aborted\)/,
    'startListening should check for AbortError'
  );
  assert.match(
    startListeningBody,
    /console\.error/,
    'startListening should log stream errors'
  );
  assert.match(
    startListeningBody,
    /setTimeout/,
    'startListening should schedule reconnect'
  );
  assert.match(
    startListeningBody,
    /5000/,
    'startListening should use 5 second reconnect delay'
  );
  assert.match(
    startListeningBody,
    /if\s*\(this\.callbacks\.size\s*>\s*0\)/,
    'startListening should only reconnect with active subscribers'
  );
});

test('MessageStreamService implements asRecord utility', () => {
  assert.match(
    messageStreamSource,
    /private\s+asRecord\(/,
    'Should expose asRecord utility method'
  );

  const asRecordBody = extractFunctionBody(
    messageStreamSource,
    'private asRecord('
  );

  assert.match(
    asRecordBody,
    /typeof\s+value\s*===\s*"object"\s*&&\s*value\s*!==\s*null/,
    'asRecord should check for non-null object'
  );
});

test('MessageStreamService implements heartbeat event detection', () => {
  assert.match(
    messageStreamSource,
    /private\s+isHeartbeatEvent\(/,
    'Should expose isHeartbeatEvent method'
  );

  const isHeartbeatBody = extractFunctionBody(
    messageStreamSource,
    'private isHeartbeatEvent('
  );

  assert.match(
    isHeartbeatBody,
    /typeof\s+eventType\s*===\s*"string"/,
    'isHeartbeatEvent should check type is string'
  );
  assert.match(
    isHeartbeatBody,
    /MessageStreamService\.HEARTBEAT_EVENT_TYPES\.has\(/,
    'isHeartbeatEvent should check against heartbeat set'
  );
});

test('MessageStreamService implements verbose stream debug check', () => {
  assert.match(
    messageStreamSource,
    /private\s+shouldVerboseStreamDebug\(\)/,
    'Should expose shouldVerboseStreamDebug method'
  );

  const verboseDebugBody = extractFunctionBody(
    messageStreamSource,
    'private shouldVerboseStreamDebug()'
  );

  assert.match(
    verboseDebugBody,
    /getConfiguration/,
    'shouldVerboseStreamDebug should get logging config'
  );
  assert.match(
    verboseDebugBody,
    /"level"/,
    'shouldVerboseStreamDebug should get level with default'
  );
  assert.match(
    verboseDebugBody,
    /toLowerCase\(\)\s*===\s*"debug"/,
    'shouldVerboseStreamDebug should check for debug level'
  );
});

test('MessageStreamService implements asPreview for logging', () => {
  assert.match(
    messageStreamSource,
    /private\s+asPreview\(/,
    'Should expose asPreview method'
  );

  const asPreviewBody = extractFunctionBody(
    messageStreamSource,
    'private asPreview('
  );

  assert.match(
    asPreviewBody,
    /typeof\s+value\s*!==\s*"string"/,
    'asPreview should check for string type'
  );
  assert.match(
    asPreviewBody,
    /value\.length\s*<=\s*max/,
    'asPreview should return as-is if under max length'
  );
  assert.match(
    asPreviewBody,
    /\.\.\./,
    'asPreview should truncate long strings'
  );
});

test('MessageStreamService implements extractEventTypeHints', () => {
  assert.match(
    messageStreamSource,
    /private\s+extractEventTypeHints\(/,
    'Should expose extractEventTypeHints method'
  );

  const extractHintsBody = extractFunctionBody(
    messageStreamSource,
    'private extractEventTypeHints('
  );

  assert.match(
    extractHintsBody,
    /const\s+hints\s*=\s*new Set<string>\(\)/,
    'extractEventTypeHints should create hints set'
  );
  assert.match(
    extractHintsBody,
    /rec\.type/,
    'extractEventTypeHints should extract type field'
  );
  assert.match(
    extractHintsBody,
    /rec\.event/,
    'extractEventTypeHints should extract event field'
  );
});

test('MessageStreamService implements sanitizeForLogging', () => {
  assert.match(
    messageStreamSource,
    /private\s+sanitizeForLogging\(/,
    'Should expose sanitizeForLogging method'
  );

  const sanitizeBody = extractFunctionBody(
    messageStreamSource,
    'private sanitizeForLogging('
  );

  assert.match(
    sanitizeBody,
    /if\s*\(value\s*===\s*null\s*\|\|\s*value\s*===\s*undefined\)/,
    'sanitizeForLogging should handle null/undefined'
  );
  assert.match(
    sanitizeBody,
    /seen\.has\(/,
    'sanitizeForLogging should detect circular references'
  );
  assert.match(
    sanitizeBody,
    /if\s*\(depth\s*>=\s*maxDepth\)/,
    'sanitizeForLogging should limit depth'
  );
  assert.match(
    sanitizeBody,
    /\[Circular\]/,
    'sanitizeForLogging should mark circular references'
  );
  assert.match(
    sanitizeBody,
    /typeof\s+.*\[key\]\s*===\s*"function"/,
    'sanitizeForLogging should skip functions'
  );
  assert.match(
    sanitizeBody,
    /key\.startsWith\("_"\)/,
    'sanitizeForLogging should skip private properties'
  );
});

test('MessageStreamService annotates events with source', () => {
  const consumeStreamBody = extractFunctionBody(
    messageStreamSource,
    'private async consumeEventStream('
  );

  assert.match(
    consumeStreamBody,
    /const\s+eventWithSource\s*=\s*\{[\s\S]*\.\.\.normalizedEvent,[\s\S]*source,\s*\}/,
    'consumeEventStream should add source to events'
  );
});

test('MessageStreamService manages stale entries in signature cache', () => {
  const isDuplicateBody = extractFunctionBody(
    messageStreamSource,
    'private isDuplicateEvent('
  );

  assert.match(
    isDuplicateBody,
    /if\s*\(this\.recentEventSignatures\.size\s*>\s*500\)/,
    'isDuplicateEvent should check cache size limit'
  );
  assert.match(
    isDuplicateBody,
    /now\s*-\s*timestamp\.timestamp\s*>\s*staleEntryWindowMs/,
    'isDuplicateEvent should check for stale entries'
  );
  assert.match(
    isDuplicateBody,
    /this\.recentEventSignatures\.delete\(/,
    'isDuplicateEvent should delete stale entries'
  );
});

test('MessageStreamService only dedupes cross-stream events', () => {
  const isDuplicateBody = extractFunctionBody(
    messageStreamSource,
    'private isDuplicateEvent('
  );

  assert.match(
    isDuplicateBody,
    /if\s*\(!source\s*\|\|\s*!previousSeen\.source\)/,
    'isDuplicateEvent should check for missing sources'
  );
  assert.match(
    isDuplicateBody,
    /return\s+previousSeen\.source\s*!==\s*source/,
    'isDuplicateEvent should only dedupe different sources'
  );
});
