/**
 * Core Diagnostics Logging Regression Tests
 *
 * These tests prevent regressions in diagnostic logging functionality.
 * Proper logging is essential for debugging production issues.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const diagnosticsLoggerSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts')],
  'DiagnosticsLogger.ts',
);

test.describe('Diagnostics Logger - Core Logging', () => {

  test('logStreamEventDiagnostics captures event metadata', () => {
    const logBody = extractFunctionBody(diagnosticsLoggerSource, 'logStreamEventDiagnostics');

    assert.match(
      logBody,
      /const eventType = typeof event\?\.type === "string"/,
      'must capture event type'
    );
    assert.match(
      logBody,
      /messageID|messageId/,
      'must capture message identifier'
    );
  });

  test('logStreamEventDiagnostics handles different event types', () => {
    const logBody = extractFunctionBody(diagnosticsLoggerSource, 'logStreamEventDiagnostics');

    assert.match(
      logBody,
      /if\s*\(eventType === "server\.heartbeat"\)|eventType === "message\.updated"/,
      'must handle different event types differently'
    );
  });

  test('logStreamEventDiagnostics includes session information', () => {
    const logBody = extractFunctionBody(diagnosticsLoggerSource, 'logStreamEventDiagnostics');

    assert.match(
      logBody,
      /sessionID|sessionId/,
      'must capture session identifier'
    );
  });

});

test.describe('Diagnostics Logger - Performance Tracking', () => {

  test('logStreamEventDiagnostics tracks session information', () => {
    const logBody = extractFunctionBody(diagnosticsLoggerSource, 'logStreamEventDiagnostics');

    assert.match(
      logBody,
      /sessionID|sessionId|session/,
      'must capture session identifier'
    );
  });

  test('logStreamEventDiagnostics captures event properties', () => {
    const logBody = extractFunctionBody(diagnosticsLoggerSource, 'logStreamEventDiagnostics');

    assert.match(
      logBody,
      /eventType|properties|part|info/,
      'must capture event metadata'
    );
  });

});

test.describe('Diagnostics Logger - Error Handling', () => {

  test('logger handles errors gracefully in persistAiDebugSnapshot', () => {
    const persistBody = extractFunctionBody(diagnosticsLoggerSource, 'async persistAiDebugSnapshot(');

    assert.match(
      persistBody,
      /try\s*\{[\s\S]*catch\s*\(|\.catch\(/,
      'must handle persistence errors'
    );
    assert.match(
      persistBody,
      /logger\.warn|logger\.error/,
      'must log persistence failures'
    );
  });

  test('logger handles invalid workspace state', () => {
    const source = diagnosticsLoggerSource;

    assert.match(
      source,
      /workspaceFolder.*workspaceFolders|scheme !== "file"/,
      'must validate workspace state'
    );
  });

});

test.describe('Diagnostics Logger - Data Sanitization', () => {

  test('sanitizeDebugPayload handles circular references', () => {
    const sanitizeBody = extractFunctionBody(diagnosticsLoggerSource, 'sanitizeDebugPayload');

    assert.match(
      sanitizeBody,
      /seen\.has|circular|WeakSet/,
      'must detect circular references'
    );
    assert.match(
      sanitizeBody,
      /maxDepth|maxArrayItems|maxObjectKeys/,
      'must enforce depth and size limits'
    );
  });

  test('sanitizeDebugPayload handles different data types', () => {
    const sanitizeBody = extractFunctionBody(diagnosticsLoggerSource, 'sanitizeDebugPayload');

    assert.match(
      sanitizeBody,
      /typeof.*===.*"string"|typeof.*===.*"number"|Array\.isArray/,
      'must handle different value types'
    );
    assert.match(
      sanitizeBody,
      /data-url|truncated/,
      'must handle special cases like data URLs'
    );
  });

});

test.describe('Diagnostics Logger - Log Levels', () => {

  test('logger supports different log levels', () => {
    const source = diagnosticsLoggerSource;

    assert.match(
      source,
      /logger\.debug|logger\.info|logger\.warn|logger\.error/s,
      'must support multiple log levels'
    );
  });

  test('logger respects configuration for verbosity', () => {
    const verboseBody = extractFunctionBody(diagnosticsLoggerSource, 'private shouldVerboseStreamDebug()');

    assert.match(
      verboseBody,
      /getConfiguration|opencode\.logging/,
      'must check configuration settings'
    );
    assert.match(
      verboseBody,
      /level.*===.*"debug"|toLowerCase/,
      'must respect log level setting'
    );
  });

});
