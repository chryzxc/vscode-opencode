import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { readSource, extractFunctionBody, joinFromRoot } from '../helpers/source-utils.mjs';

/**
 * Session Unrevert (Restore) Handler — Integration Tests
 *
 * Guards the "Restore reverted messages" feature that calls the OpenCode SDK's
 * session.unrevert endpoint. Parity with Codex's undo/restore behavior.
 *
 * Regression triggers:
 *   - handleUnrevertSession method removed or renamed
 *   - Message handler case "unrevertSession" removed
 *   - SDK call shape changed (sessionID path param, directory query param)
 *   - Post-unrevert session reload skipped (stale UI)
 */

const source = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

// ============================================================================
// Layer 1: Message Handler Wiring
// ============================================================================

describe('unrevertSession message handler wiring', () => {
  test('case "unrevertSession" exists in message switch', () => {
    assert.match(
      source,
      /case\s+"unrevertSession"/,
      'ChatViewProvider must handle the "unrevertSession" webview message type',
    );
  });

  test('unrevertSession case calls handleUnrevertSession', () => {
    const caseBody = extractFunctionBody(source, '        case "unrevertSession": {');
    assert.ok(caseBody, 'unrevertSession case body must exist');
    assert.match(
      caseBody,
      /handleUnrevertSession\(/,
      'case must call handleUnrevertSession method',
    );
  });
});

// ============================================================================
// Layer 2: handleUnrevertSession Method
// ============================================================================

describe('handleUnrevertSession method', () => {
  test('method exists as private async', () => {
    assert.match(
      source,
      /private\s+async\s+handleUnrevertSession\(/,
      'handleUnrevertSession must be a private async method',
    );
  });

  test('accepts optional requestedSessionId parameter', () => {
    assert.match(
      source,
      /handleUnrevertSession\(\s*requestedSessionId\?:\s*string/,
      'handleUnrevertSession must accept optional requestedSessionId for routing',
    );
  });

  test('resolves target session ID with firstNonEmptyString fallback', () => {
    const body = extractFunctionBody(source, '  private async handleUnrevertSession(');
    assert.ok(body, 'method body must exist');
    assert.match(
      body,
      /firstNonEmptyString\(\s*requestedSessionId,\s*this\.currentSessionId/,
      'must fall back to currentSessionId when requestedSessionId is empty',
    );
  });

  test('returns early with a visible warning when no session ID is available', () => {
    const body = extractFunctionBody(source, '  private async handleUnrevertSession(');
    assert.match(
      body,
      /if\s*\(!targetSessionId\)\s*\{[\s\S]*?showWarningMessage/,
      'must show a warning to the user when targetSessionId is falsy',
    );
  });
});

// ============================================================================
// Layer 4b: RequestResult Error Checking (ThrowOnError=false)
// ============================================================================

describe('handleUnrevertSession checks result.error before data', () => {
  test('checks unrevertResult.error before proceeding', () => {
    const body = extractFunctionBody(source, '  private async handleUnrevertSession(');
    assert.match(
      body,
      /unrevertError/,
      'must extract error from the SDK result',
    );
    assert.match(
      body,
      /if\s*\(\s*unrevertError\s*\)/,
      'must check the extracted error before accessing data',
    );
  });

  test('shows error message when SDK returns an HTTP error', () => {
    const body = extractFunctionBody(source, '  private async handleUnrevertSession(');
    assert.match(
      body,
      /showErrorMessage\([\s\S]*?Failed to restore/,
      'must show a user-facing error when the SDK returns an HTTP error',
    );
  });
});

// ============================================================================
// Layer 3: SDK Call Shape
// ============================================================================

describe('handleUnrevertSession SDK call', () => {
  test('awaits ensureRunning before making the SDK call', () => {
    const body = extractFunctionBody(source, '  private async handleUnrevertSession(');
    assert.match(
      body,
      /const\s+client\s*=\s*await\s+this\.serverManager\.ensureRunning\(\)/,
      'must wait for server readiness before unrevert',
    );
  });

  test('calls client.session.unrevert with sessionID path param', () => {
    const body = extractFunctionBody(source, '  private async handleUnrevertSession(');
    assert.match(
      body,
      /client\.session\.unrevert\(\s*\{[\s\S]*?sessionID:\s*targetSessionId/,
      'must call client.session.unrevert with sessionID path parameter',
    );
  });

  test('passes workspace directory as query param when available', () => {
    const body = extractFunctionBody(source, '  private async handleUnrevertSession(');
    assert.match(
      body,
      /getWorkspaceDirectory\(\)/,
      'must resolve workspace directory',
    );
    assert.match(
      body,
      /directory:\s*workspaceDir/,
      'must pass directory as query parameter to unrevert',
    );
  });

  test('does NOT send a body (unrevert is bodyless per SDK contract)', () => {
    const body = extractFunctionBody(source, '  private async handleUnrevertSession(');
    // The unrevert call should only have sessionID (path) and directory (query) — no body
    const unrevertMatch = body.match(/client\.session\.unrevert\(\s*\{([\s\S]*?)\}\s*\)/);
    assert.ok(unrevertMatch, 'unrevert call must exist');
    assert.doesNotMatch(
      unrevertMatch[1],
      /body:/,
      'unrevert must NOT include a body parameter (SDK contract: body is never)',
    );
  });
});

// ============================================================================
// Layer 4: Post-Unrevert Reload + Error Handling
// ============================================================================

describe('handleUnrevertSession post-call behavior', () => {
  test('reloads the session after unrevert', () => {
    const body = extractFunctionBody(source, '  private async handleUnrevertSession(');
    assert.match(
      body,
      /handleLoadSession\(targetSessionId\)/,
      'must reload the session to refresh message list after unrevert',
    );
  });

  test('refreshes the session list after unrevert', () => {
    const body = extractFunctionBody(source, '  private async handleUnrevertSession(');
    assert.match(
      body,
      /handleGetSessions\(\)/,
      'must refresh the sessions list after unrevert',
    );
  });

  test('catches errors and shows user-facing error message', () => {
    const body = extractFunctionBody(source, '  private async handleUnrevertSession(');
    assert.match(
      body,
      /catch\s*\(\s*error\s*\)/,
      'must have a catch block for error handling',
    );
    assert.match(
      body,
      /showErrorMessage\(/,
      'must show an error message to the user on failure',
    );
    assert.match(
      body,
      /Failed to restore/,
      'error message must be user-facing ("Failed to restore...")',
    );
  });

  test('logs the error with session context', () => {
    const body = extractFunctionBody(source, '  private async handleUnrevertSession(');
    assert.match(
      body,
      /this\.logger\.error\(/,
      'must log the error for diagnostics',
    );
    assert.match(
      body,
      /sessionId:\s*targetSessionId/,
      'error log must include the sessionId for traceability',
    );
  });
});

// ============================================================================
// Layer 5: Parity with handleUndoMessageChanges
// ============================================================================

describe('unrevert handler mirrors revert handler structure', () => {
  test('both handlers use the same ensureRunning + directory resolution pattern', () => {
    const undoBody = extractFunctionBody(source, '  private async handleUndoMessageChanges(');
    const unrevertBody = extractFunctionBody(source, '  private async handleUnrevertSession(');
    assert.ok(undoBody, 'handleUndoMessageChanges must exist');
    assert.ok(unrevertBody, 'handleUnrevertSession must exist');

    // Both must resolve workspace directory the same way
    assert.match(undoBody, /getWorkspaceDirectory\(\)/);
    assert.match(unrevertBody, /getWorkspaceDirectory\(\)/);

    // Both must reload session + refresh sessions list
    assert.match(undoBody, /handleLoadSession\(/);
    assert.match(unrevertBody, /handleLoadSession\(/);
    assert.match(undoBody, /handleGetSessions\(\)/);
    assert.match(unrevertBody, /handleGetSessions\(\)/);
  });

  test('both handlers check result.error before accessing data (ThrowOnError=false)', () => {
    const undoBody = extractFunctionBody(source, '  private async handleUndoMessageChanges(');
    const unrevertBody = extractFunctionBody(source, '  private async handleUnrevertSession(');

    assert.match(undoBody, /revertError/, 'revert handler must extract error from result');
    assert.match(undoBody, /if\s*\(\s*revertError\s*\)/, 'revert handler must check extracted error');
    assert.match(unrevertBody, /unrevertError/, 'unrevert handler must extract error from result');
    assert.match(unrevertBody, /if\s*\(\s*unrevertError\s*\)/, 'unrevert handler must check extracted error');
  });

  test('both handlers show showWarningMessage on early return', () => {
    const undoBody = extractFunctionBody(source, '  private async handleUndoMessageChanges(');
    const unrevertBody = extractFunctionBody(source, '  private async handleUnrevertSession(');

    assert.match(undoBody, /showWarningMessage/, 'revert handler must show warning on early return');
    assert.match(unrevertBody, /showWarningMessage/, 'unrevert handler must show warning on early return');
  });
});
