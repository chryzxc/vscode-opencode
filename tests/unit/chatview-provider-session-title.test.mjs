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
  const body = extractFunctionBody(
    providerSource,
    'private async triggerSessionTitleGeneration(sessionId: string): Promise<void> {',
  );

  assert.match(body, /const client = await this\.serverManager\.ensureRunning\(\);/, 'triggerSessionTitleGeneration should ensure the server is running before polling');
  assert.match(body, /for \(const delay of \[2000, 5000, 10000\]\)/, 'triggerSessionTitleGeneration should poll with exponential backoff delays (2s, 5s, 10s)');
  assert.match(body, /const resp = await client\.session\.get\(\{ path: \{ id: sessionId \} \}\);/, 'triggerSessionTitleGeneration should fetch session details from the server');
  assert.match(body, /if \(resp\.data\?\.title && resp\.data\.title !== "Untitled chat"\) \{[\s\S]*this\.handleServerSessionTitleUpdate\(sessionId, resp\.data\.title\);[\s\S]*return;[\s\S]*\}/, 'triggerSessionTitleGeneration should update the session title when a non-default title is received');
  assert.match(body, /catch \{[\s\S]*break;[\s\S]*\}/, 'triggerSessionTitleGeneration should stop polling on server errors');
});

test('session.updated event handler triggers title update for valid session info', () => {
  assert.match(
    providerSource,
    /if \(event\.type === "session\.updated" && event\.properties\) \{[\s\S]*const sessionInfo = \(event\.properties as any\)\?\.info;[\s\S]*if \(sessionInfo\?\.id && typeof sessionInfo\.title === "string"\) \{[\s\S]*this\.handleServerSessionTitleUpdate\(sessionInfo\.id, sessionInfo\.title\);[\s\S]*\}[\s\S]*\}/,
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

test('autoGenerateSessionTitle uses server-side title generation instead of client-side', () => {
  assert.match(
    providerSource,
    /const autoGenerateTitle = config\.get<boolean>\('autoGenerateSessionTitle', true\);[\s\S]*if \(autoGenerateTitle\) \{[\s\S]*this\.fetchServerSessionTitle\(session\.id\);[\s\S]*\}/,
    'when autoGenerateSessionTitle is enabled, fetchServerSessionTitle should be called instead of client-side TitleGeneratorService'
  );

  assert.doesNotMatch(
    providerSource,
    /const generatedTitle = TitleGeneratorService\.generateTitle\(text\);[\s\S]*await this\.updateSessionTitle\(session\.id, generatedTitle\);/,
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

test('title generation respects user preferences and configuration', () => {
  assert.match(
    providerSource,
    /const config = vscode\.workspace\.getConfiguration\('opencode'\);[\s\S]*const autoGenerateTitle = config\.get<boolean>\('autoGenerateSessionTitle', true\);/,
    'title generation should check the autoGenerateSessionTitle configuration setting'
  );
});
