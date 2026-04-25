import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const serviceSource = readSource(
  [joinFromRoot('src', 'services', 'SessionService.ts')],
  'SessionService.ts',
);

test('updateLocalSessionTitle updates session in history when found', () => {
  const body = extractFunctionBody(
    serviceSource,
    'updateLocalSessionTitle(sessionId: string, title: string): void {',
  );

  assert.match(body, /const localSession = this\.sessionHistory\.find\(\(s\) => s\.id === sessionId\);/, 'updateLocalSessionTitle should find the session in sessionHistory by ID');
  assert.match(body, /if \(localSession\) \{[\s\S]*localSession\.title = title;[\s\S]*\}/, 'updateLocalSessionTitle should update the title when the session is found in history');
});

test('updateLocalSessionTitle updates current session when it matches', () => {
  const body = extractFunctionBody(
    serviceSource,
    'updateLocalSessionTitle(sessionId: string, title: string): void {',
  );

  assert.match(body, /if \(this\.currentSession\?\.id === sessionId\) \{[\s\S]*this\.currentSession\.title = title;[\s\S]*\}/, 'updateLocalSessionTitle should update the current session title when the ID matches');
});

test('updateLocalSessionTitle persists state after updating titles', () => {
  const body = extractFunctionBody(
    serviceSource,
    'updateLocalSessionTitle(sessionId: string, title: string): void {',
  );

  assert.match(body, /this\.persistState\(\);/, 'updateLocalSessionTitle should persist the state after updating titles');
});

test('updateLocalSessionTitle is a synchronous void method', () => {
  assert.match(
    serviceSource,
    /updateLocalSessionTitle\(sessionId: string, title: string\): void \{/,
    'updateLocalSessionTitle should be a synchronous method that returns void'
  );
});

test('updateLocalSessionTitle handles missing sessions gracefully', () => {
  const body = extractFunctionBody(
    serviceSource,
    'updateLocalSessionTitle(sessionId: string, title: string): void {',
  );

  assert.match(body, /const localSession = this\.sessionHistory\.find\(\(s\) => s\.id === sessionId\);[\s\S]*if \(localSession\) \{[\s\S]*\}/, 'updateLocalSessionTitle should check if session exists before updating');
});

test('updateLocalSessionTitle updates both history and current session when applicable', () => {
  const body = extractFunctionBody(
    serviceSource,
    'updateLocalSessionTitle(sessionId: string, title: string): void {',
  );

  // Verify both update paths exist
  assert.match(body, /localSession\.title = title;/, 'updateLocalSessionTitle should update sessionHistory entry');
  assert.match(body, /this\.currentSession\.title = title;/, 'updateLocalSessionTitle should update currentSession entry');
});

test('updateLocalSessionTitle complements async renameSession method', () => {
  assert.match(
    serviceSource,
    /updateLocalSessionTitle\(sessionId: string, title: string\): void \{[\s\S]*\}[\s\S]*async renameSession\(sessionId: string, newTitle: string\): Promise<Session>/,
    'updateLocalSessionTitle should be defined before the async renameSession method'
  );

  const renameBody = extractFunctionBody(
    serviceSource,
    'async renameSession(sessionId: string, newTitle: string): Promise<Session> {',
  );

  assert.match(renameBody, /const response = await client\.session\.update\(\{[\s\S]*body: \{ title: newTitle \},[\s\S]*\}\);/, 'renameSession should call the server API to update the title');
  assert.match(renameBody, /catch \(error\) \{[\s\S]*const localSession = this\.sessionHistory\.find\(\(s\) => s\.id === sessionId\);[\s\S]*localSession\.title = newTitle;[\s\S]*\}/, 'renameSession should fall back to local updates when server fails');
});
