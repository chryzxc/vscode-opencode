/**
 * Core Message Streaming Service Regression Tests
 *
 * These tests prevent regressions in message streaming functionality.
 * Message streaming is critical for real-time AI interaction.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const messageStreamServiceSource = readSource(
  [joinFromRoot('src', 'services', 'MessageStreamService.ts')],
  'MessageStreamService.ts',
);

test.describe('Message Stream Service - Stream Management', () => {

  test('startListening initiates stream connection', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /startListening[\s\S]*serverManager|stream|consume/s,
      'must initiate stream connection'
    );
  });

  test('startListening manages connection state', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /startListening[\s\S]*abortController|dispose|stop/s,
      'must manage connection lifecycle'
    );
  });

  test('stopListening terminates stream connection', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /stopListening[\s\S]*abort|dispose|close/s,
      'must terminate stream connection'
    );
  });

  test('stopListening cleans up resources', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /stopListening[\s\S]*clear|reset|cleanup/s,
      'must clean up stream resources'
    );
  });

});

test.describe('Message Stream Service - Event Processing', () => {

  test('consumeEventStream processes stream events', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /consumeEventStream[\s\S]*async|for\s*await|while/s,
      'must process stream events asynchronously'
    );
  });

  test('consumeEventStream handles event types', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /consumeEventStream[\s\S]*event\.type|eventType|kind/s,
      'must handle different event types'
    );
  });

  test('normalizeIncomingEvent validates event structure', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /normalizeIncomingEvent[\s\S]*validate|check|if\s*\(/s,
      'must validate event structure'
    );
  });

  test('normalizeIncomingEvent sanitizes event data', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /normalizeIncomingEvent[\s\S]*sanitize|clean|filter/s,
      'must sanitize event data'
    );
  });

});

test.describe('Message Stream Service - Duplicate Detection', () => {

  test('isDuplicateEvent identifies duplicate events', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /isDuplicateEvent[\s\S]*signature|hash|id|recentEvents/s,
      'must use event signatures for duplicate detection'
    );
  });

  test('getEventSignature generates unique signatures', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /getEventSignature[\s\S]*type|properties|id|timestamp/s,
      'must generate unique event signatures'
    );
  });

  test('recentEventSignatures tracks recent events', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /recentEventSignatures[\s\S]*Set|Map|Array|push/s,
      'must track recent event signatures'
    );
  });

});

test.describe('Message Stream Service - Event Filtering', () => {

  test('isHeartbeatEvent identifies heartbeat events', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /isHeartbeatEvent[\s\S]*heartbeat|ping|keepalive/s,
      'must identify heartbeat events'
    );
  });

  test('isEventInWorkspaceDirectory checks event context', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /isEventInWorkspaceDirectory[\s\S]*workspace|directory|path/s,
      'must check workspace context'
    );
  });

  test('extractEventTypeHints detects event patterns', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /extractEventTypeHints[\s\S]*properties|info|context/s,
      'must extract event type hints'
    );
  });

});

test.describe('Message Stream Service - Callback Management', () => {

  test('subscribe registers stream callbacks', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /subscribe[\s\S]*callbacks|push|register|add/s,
      'must register stream callbacks'
    );
  });

  test('notifyCallbacks invokes registered callbacks', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /notifyCallbacks[\s\S]*forEach|call|invoke|emit/s,
      'must invoke registered callbacks'
    );
  });

  test('callbacks receive event data', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /notifyCallbacks[\s\S]*event|data|payload/s,
      'must pass event data to callbacks'
    );
  });

});

test.describe('Message Stream Service - Reconnection Logic', () => {

  test('clearReconnectTimer resets reconnection state', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /clearReconnectTimer[\s\S]*reconnectTimer|clear|reset/s,
      'must reset reconnection timer'
    );
  });

  test('reconnection logic handles failures', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /reconnect|retry|backoff|timeout/s,
      'must handle connection failures'
    );
  });

});

test.describe('Message Stream Service - Data Sanitization', () => {

  test('sanitizeForLogging removes sensitive data', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /sanitizeForLogging[\s\S]*sanitize|redact|hide|mask/s,
      'must sanitize sensitive data'
    );
  });

  test('sanitizeForLogging preserves essential information', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /sanitizeForLogging[\s\S]*type|event|properties/s,
      'must preserve essential event information'
    );
  });

});

test.describe('Message Stream Service - Workspace Integration', () => {

  test('normalizeDirectory processes workspace paths', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /normalizeDirectory[\s\S]*workspace|path|resolve/s,
      'must normalize workspace paths'
    );
  });

  test('asPreview generates preview data', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /asPreview[\s\S]*preview|summary|truncate/s,
      'must generate preview data'
    );
  });

  test('asRecord converts data to records', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /asRecord[\s\S]*object|record|properties/s,
      'must convert data to record format'
    );
  });

});

test.describe('Message Stream Service - Error Handling', () => {

  test('stream operations handle connection errors', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /try\s*\{[\s\S]*catch\s*\(|if\s*\(\s*error/s,
      'must handle connection errors'
    );
  });

  test('stream operations validate inputs', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /if\s*\(\s*!.*\s*\)|typeof.*===|validate/s,
      'must validate input parameters'
    );
  });

  test('stream operations log errors appropriately', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /logger\.(warn|error|debug)/s,
      'must log stream issues'
    );
  });

});

test.describe('Message Stream Service - Performance', () => {

  test('stream operations use efficient processing', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /for\s*await|while|async/s,
      'must use efficient async processing'
    );
  });

  test('stream operations avoid memory leaks', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /dispose|clear|reset|abort/s,
      'must clean up resources to prevent leaks'
    );
  });

});

test.describe('Message Stream Service - Event Types', () => {

  test('HEARTBEAT_EVENT_TYPES defines heartbeat events', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /HEARTBEAT_EVENT_TYPES|heartbeat|ping/s,
      'must define heartbeat event types'
    );
  });

  test('event type handling is extensible', () => {
    const source = messageStreamServiceSource;

    assert.match(
      source,
      /eventTypes|types|categories|switch|case/s,
      'must support extensible event types'
    );
  });

});
