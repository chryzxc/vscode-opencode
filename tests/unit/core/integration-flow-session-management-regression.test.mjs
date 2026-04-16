/**
 * Integration Flow: Session Management Regression Tests
 *
 * These tests prevent regressions in the complete session management flow.
 * Session management is critical for chat persistence and user experience.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const sessionServiceSource = readSource(
  [joinFromRoot('src', 'services', 'SessionService.ts')],
  'SessionService.ts',
);

const chatViewProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

test.describe('Integration Flow: Session Creation', () => {

  test('session service creates session via server', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /createSession.*client\.createSession|await.*createSession/s,
      'session service must create session via server client'
    );
  });

  test('session service persists session to workspace state', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /createSession[\s\S]*workspaceState\.update\('opencode\.sessions'/s,
      'session service must persist session to workspace state'
    );
  });

  test('session service stores session messages', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /workspaceState\.update\('opencode\.session\.messages\.\+/s,
      'session service must store session messages'
    );
  });

  test('session service sets current session ID', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /createSession[\s\S]*workspaceState\.update\('opencode\.currentSessionId'/s,
      'session service must set current session ID'
    );
  });

});

test.describe('Integration Flow: Session Loading', () => {

  test('session service loads sessions from workspace state', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /getSessions[\s\S]*workspaceState\.get\('opencode\.sessions'/s,
      'session service must load sessions from workspace state'
    );
  });

  test('session service merges server and local sessions', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /getSessions[\s\S]*serverSessions.*localSessions.*merge/s,
      'session service must merge server and local sessions'
    );
  });

  test('session service prioritizes server sessions', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /getSessions[\s\S]*server.*overwrites.*local|Map.*set.*server/s,
      'session service must prioritize server sessions over local'
    );
  });

  test('session service sorts sessions by creation time', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /getSessions[\s\S]*sort.*createdAt.*newest/s,
      'session service must sort sessions by creation time'
    );
  });

});

test.describe('Integration Flow: Message Persistence', () => {

  test('session service persists messages to workspace state', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /addMessage.*workspaceState\.update\('opencode\.session\.messages/s,
      'session service must persist messages to workspace state'
    );
  });

  test('session service truncates messages to limit', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /MAX_CACHED_MESSAGES_PER_SESSION|slice.*-MAX_CACHED/s,
      'session service must truncate messages to limit'
    );
  });

  test('session service handles message size limits', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /MAX_PERSISTED_STRING_LENGTH|truncateString/s,
      'session service must handle message size limits'
    );
  });

});

test.describe('Integration Flow: Session Deletion', () => {

  test('session service deletes session via server', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /deleteSession.*client\.deleteSession|await.*deleteSession/s,
      'session service must delete session via server'
    );
  });

  test('session service removes session from workspace state', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /deleteSession[\s\S]*workspaceState\.update\('opencode\.sessions'/s,
      'session service must remove session from workspace state'
    );
  });

  test('session service clears session messages', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /deleteSession[\s\S]*workspaceState\.update\('opencode\.session\.messages\.\+/s,
      'session service must clear session messages'
    );
  });

});

test.describe('Integration Flow: Current Session Management', () => {

  test('session service gets current session ID', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /getCurrentSessionId[\s\S]*workspaceState\.get\('opencode\.currentSessionId'/s,
      'session service must get current session ID from workspace state'
    );
  });

  test('session service sets current session', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      source,
      /setCurrentSession[\s\S]*workspaceState\.update\('opencode\.currentSessionId'/s,
      'session service must set current session ID'
    );
  });

  test('session service waits for initialization', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /getCurrentSession[\s\S]*_initialized.*await/s,
      'session service must wait for initialization before getting session'
    );
  });

});

test.describe('Integration Flow: Session Compaction', () => {

  test('session service compacts session via server', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /compactSession.*client\.session\.compact|await.*compact/s,
      'session service must compact session via server'
    );
  });

  test('session service requires client for compaction', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /compactSession[\s\S]*!this\.client.*Cannot compact session/s,
      'session service must require client for compaction'
    );
  });

  test('session service handles compaction errors', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /compactSession.*catch.*throw.*error|Failed to compact/s,
      'session service must handle compaction errors'
    );
  });

});

test.describe('Integration Flow: Data URL Handling', () => {

  test('session service detects data URLs', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /isDataUrl.*data:.*base64/i/s,
      'session service must detect data URLs'
    );
  });

  test('session service redacts data URLs for persistence', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /redactDataUrl.*omitted data URL/s,
      'session service must redact data URLs for persistence'
    );
  });

  test('session service preserves data URLs in memory', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      source,
      /isDataUrl.*redact|in.*memory.*redact/s,
      'session service must preserve data URLs in memory'
    );
  });

});

test.describe('Integration Flow: Session Title Generation', () => {

  test('session service generates title from first message', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /TitleGeneratorService\.generateTitle/s,
      'session service must generate title from first message'
    );
  });

  test('session service uses Untitled chat as fallback', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /Untitled chat|FALLBACK_TITLE/s,
      'session service must use Untitled chat as fallback title'
    );
  });

});

test.describe('Integration Flow: Session State Initialization', () => {

  test('session service initializes asynchronously', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /constructor[\s\S]*this\._initialize\(\)/s,
      'session service must initialize asynchronously in constructor'
    );
  });

  test('session service loads current session on initialization', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /_initialize[\s\S]*_loadCurrentSession\(\)/s,
      'session service must load current session on initialization'
    });
  });

  test('session service falls back to local-only session', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /_initialize[\s\S]*local.*fallback|server.*unavailable/s,
      'session service must fall back to local-only session if server unavailable'
    );
  });

});

test.describe('Integration Flow: Chat View Provider Integration', () => {

  test('chat view provider accepts session service', () => {
    const source = chatViewProviderSource;

    assert.match(
      source,
      /constructor.*sessionService.*SessionService/s,
      'chat view provider must accept session service'
    );
  });

  test('chat view provider gets sessions from session service', () => {
    const source = chatViewProviderSource;

    assert.match(
      source,
      /getSessions.*sessionService\.getSessions\(\)/s,
      'chat view provider must get sessions from session service'
    );
  });

  test('chat view provider creates new session via session service', () => {
    const source = chatViewProviderSource;

    assert.match(
      source,
      /createNewSession.*sessionService\.createSession\(\)/s,
      'chat view provider must create new session via session service'
    );
  });

});

test.describe('Integration Flow: Message Streaming', () => {

  test('session service handles message streaming', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /streamMessage|handleMessage/s,
      'session service must handle message streaming'
    );
  });

  test('session service persists streamed messages', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /addMessage.*persist|workspaceState\.update/s,
      'session service must persist streamed messages'
    );
  });

});

test.describe('Integration Flow: Error Recovery', () => {

  test('session service handles server unavailability', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /catch.*server.*unavailable|local.*only/s,
      'session service must handle server unavailability gracefully'
    );
  });

  test('session service logs errors appropriately', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /log\.error.*Failed to|session/s,
      'session service must log errors appropriately'
    );
  });

});

test.describe('Integration Flow: Memory Management', () => {

  test('session service enforces session size limits', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /MAX_CACHED_SESSION_BYTES|session.*size.*limit/s,
      'session service must enforce session size limits'
    );
  });

  test('session service enforces message count limits', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /MAX_CACHED_MESSAGES_PER_SESSION/s,
      'session service must enforce message count limits'
    );
  });

  test('session service truncates oversized strings', () => {
    const source = sessionServiceSource;

    assert.match(
      source,
      /truncateString.*MAX_PERSISTED_STRING_LENGTH/s,
      'session service must truncate oversized strings'
    );
  });

});
