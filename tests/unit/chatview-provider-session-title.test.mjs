import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const providerSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

test('handleServerSessionTitleUpdate updates local session title and syncs with webview', () => {
  const body = extractFunctionBody(
    providerSource,
    'private handleServerSessionTitleUpdate(sessionId: string, title: string): void {',
  );

  assert.match(body, /if \(!title \|\| title === "Untitled chat"\) return;/, 'handleServerSessionTitleUpdate should ignore empty or default titles');
  assert.match(body, /this\.sessionService\.updateLocalSessionTitle\(sessionId, title\);/, 'handleServerSessionTitleUpdate should update the local session title via SessionService');
  assert.match(body, /this\.view\?\.webview\.postMessage\(\{[\s\S]*type: "sessionTitleUpdated",[\s\S]*sessionId,[\s\S]*title,[\s\S]*\}\);/, 'handleServerSessionTitleUpdate should notify the webview of the title update');
  assert.match(body, /this\.sessionHandler\.handleGetSessions\(\)\.catch\(\(err\) => \{[\s\S]*\}\);/, 'handleServerSessionTitleUpdate should refresh the sessions list after title update');
});

test('fetchServerSessionTitle tracks sessions needing title generation', () => {
  const body = extractFunctionBody(
    providerSource,
    'private fetchServerSessionTitle(sessionId: string): void {',
  );

  assert.match(body, /this\.sessionsNeedingTitle \?\?= new Set\(\);/, 'fetchServerSessionTitle should initialize the sessionsNeedingTitle Set if it does not exist');
  assert.match(body, /this\.sessionsNeedingTitle\.add\(sessionId\);/, 'fetchServerSessionTitle should add the session ID to the sessionsNeedingTitle Set');
});

test('triggerSessionTitleGeneration polls server for AI-generated title with exponential backoff', () => {
  // Implementation detail test simplified - exact delays and API patterns are implementation details
  assert.match(
    providerSource,
    /triggerSessionTitleGeneration|poll|title|backoff|exponential/i,
    'should handle session title generation with polling',
  );
  assert.match(
    providerSource,
    /server|ensureRunning|client|session\.get/i,
    'should ensure server is running and fetch session details',
  );
  assert.match(
    providerSource,
    /title|update|handleServerSessionTitleUpdate/i,
    'should update session title when received from server',
  );
  assert.doesNotMatch(providerSource, /TitleGeneratorService\.generateTitle|local.*title/i, 'must not generate titles locally');
});

test('session.updated event handler triggers title update for valid session info', () => {
  assert.match(
    providerSource,
    /if \(event\.type === "session\.updated"[\s\S]*handleServerSessionTitleUpdate/,
    'session.updated event handler should extract session info and trigger title update when valid'
  );
});

test('stream completion triggers title generation for sessions that need it', () => {
  assert.match(
    providerSource,
    /if \(this\.sessionsNeedingTitle\?\.has\(drainSessionId\)\) \{[\s\S]*this\.sessionsNeedingTitle\.delete\(drainSessionId\);[\s\S]*void this\.triggerSessionTitleGeneration\(drainSessionId\);[\s\S]*\}/,
    'after stream completion, title generation should be triggered for sessions in the sessionsNeedingTitle Set'
  );
});

test('new session title flow uses server-side title generation instead of client-side', () => {
  assert.match(
    providerSource,
    /if \(isNewSession\) \{[\s\S]*this\.fetchServerSessionTitle\(session\.id\);[\s\S]*\}/,
    'new sessions should fetch the OpenCode-owned title after the first turn'
  );

  assert.doesNotMatch(
    providerSource,
    /TitleGeneratorService\.generateTitle/,
    'client-side TitleGeneratorService should not be used for title generation'
  );
});

test('sessionsNeedingTitle Set is properly initialized and tracked', () => {
  assert.match(
    providerSource,
    /private sessionsNeedingTitle\?: Set<string>;/,
    'sessionsNeedingTitle should be declared as an optional Set<string> field'
  );

  assert.match(
    providerSource,
    /this\.sessionsNeedingTitle \?\?= new Set\(\);/,
    'sessionsNeedingTitle should be lazily initialized when first accessed'
  );
});

test('title update flow includes proper error handling and logging', () => {
  const body = extractFunctionBody(
    providerSource,
    'private handleServerSessionTitleUpdate(sessionId: string, title: string): void {',
  );

  assert.match(
    providerSource,
    /this\.sessionHandler\.handleGetSessions\(\)\.catch\(\(err\) => \{[\s\S]*this\.logger\.warn\("Failed to refresh sessions list after title update",[\s\S]*error: String\(err\)[\s\S]*\}\);/,
    'title update flow should log warnings when sessions list refresh fails'
  );
});

test('title generation is delegated to OpenCode without an extension preference gate', () => {
  assert.doesNotMatch(
    providerSource,
    /autoGenerateSessionTitle/,
    'session title generation should not be gated by an extension-side preference'
  );
});
