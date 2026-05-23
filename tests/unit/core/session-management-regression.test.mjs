/**
 * Core Session Management Regression Tests
 *
 * These tests prevent regressions in session lifecycle management.
 * Session bugs can cause data loss, incorrect state, and poor user experience.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readAllSources, readSource } from '../../helpers/source-utils.mjs';

const sessionServiceSource = readSource(
  [joinFromRoot('src', 'services', 'SessionService.ts')],
  'SessionService.ts',
);

const sessionHandlerSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts')],
  'SessionHandler.ts',
);

test.describe('Session Service - Core CRUD Operations', () => {

  test('createNewSession generates session via server', () => {
    const createBody = extractFunctionBody(sessionServiceSource, 'async createNewSession(');

    assert.match(
      createBody,
      /client\.session\.create|ensureRunning/,
      'must create session via server API'
    );
    assert.match(
      createBody,
      /response\.data|session\.id/,
      'must extract session from response'
    );
  });

  test('createNewSession initializes session state correctly', () => {
    const createBody = extractFunctionBody(sessionServiceSource, 'async createNewSession(');

    assert.match(
      createBody,
      /title\s*\?\s*\{ body: \{ title \} \}\s*:\s*\{\}/,
      'must only send an explicit title when the caller provided one'
    );
    assert.doesNotMatch(
      createBody,
      /Untitled chat/,
      'must not send a local fallback title for new sessions'
    );
    assert.match(
      createBody,
      /sessionHistory\.unshift|currentSession\s*=\s*session/,
      'must add to history and set as current'
    );
  });

  test('switchSession validates session existence', () => {
    const switchBody = extractFunctionBody(sessionServiceSource, 'async switchSession(');

    assert.match(
      switchBody,
      /client\.session\.get|sessionHistory\.find/,
      'must verify session exists via server or local history'
    );
    assert.match(
      switchBody,
      /response\.data|localSession/,
      'must handle server or local session'
    );
  });

  test('deleteSession cleans up resources properly', () => {
    const deleteBody = extractFunctionBody(sessionServiceSource, 'async deleteSession(');

    assert.match(
      deleteBody,
      /sessionHistory\.filter|client\.session\.delete/,
      'must remove from local history and server'
    );
    assert.match(
      deleteBody,
      /currentSession\s*=\s*null|currentSession\?\.id\s*===\s*sessionId/,
      'must clear current session if deleting active session'
    );
  });

});

test.describe('Session Handler - Message Loading', () => {

  test('handleLoadSession validates session data', () => {
    const loadBody = extractFunctionBody(sessionHandlerSource, 'async handleLoadSession(');

    assert.match(
      loadBody,
      /if\s*\(\s*!sessionId\s*\)|sessionId\s*=/,
      'must validate session ID'
    );
    assert.match(
      loadBody,
      /processingSessionIds\.has/,
      'must check for duplicate load requests'
    );
  });

  test('handleLoadSession processes messages correctly', () => {
    const loadBody = extractFunctionBody(sessionHandlerSource, 'async handleLoadSession(');

    assert.match(
      loadBody,
      /switchSession|loadSessionMessages/,
      'must switch session and load messages'
    );
    assert.match(
      loadBody,
      /processHistoryMessages/,
      'must process loaded messages'
    );
  });

});

test.describe('Session Handler - Session State Management', () => {

  test('handleDeleteSession cleans up properly', () => {
    const deleteBody = extractFunctionBody(sessionHandlerSource, 'async handleDeleteSession(');

    assert.match(
      deleteBody,
      /sessionService\.deleteSession/,
      'must delete from session service'
    );
    assert.match(
      deleteBody,
      /clearPersistedSubagentSnapshot|clearPersistedCompactionViewState/,
      'must clean up related state'
    );
  });

  test('handleRenameSession validates input', () => {
    const renameBody = extractFunctionBody(sessionHandlerSource, 'async handleRenameSession(');

    assert.match(
      renameBody,
      /if\s*\(\s*!sessionId\s*\|\|\s*!newTitle/s,
      'must validate session ID and new title'
    );
    assert.match(
      renameBody,
      /sessionService\.renameSession/,
      'must rename via session service'
    );
  });

});

test.describe('Session Handler - Error Scenarios', () => {

  test('session operations handle errors gracefully', () => {
    const source = sessionHandlerSource;

    assert.match(
      source,
      /try\s*\{[\s\S]*catch\s*\(|logger\.error/,
      'must wrap operations in error handling'
    );
    assert.match(
      source,
      /processingSessionIds\.delete|finally/,
      'must clean up state in finally blocks'
    );
  });

  test('handleGetSessions handles concurrent requests', () => {
    const getSessionsBody = extractFunctionBody(sessionHandlerSource, 'async handleGetSessions(');

    assert.match(
      getSessionsBody,
      /sessionsListRequestVersion|currentVersion/,
      'must handle request versioning'
    );
    assert.match(
      getSessionsBody,
      /fingerprint|lastSessionsPayloadFingerprint/,
      'must avoid duplicate updates'
    );
  });

});
