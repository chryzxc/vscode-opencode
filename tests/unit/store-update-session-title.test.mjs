import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);

test('UPDATE_SESSION_TITLE action type is defined in AppAction union', () => {
  assert.match(
    storeSource,
    /\| \{ type: "UPDATE_SESSION_TITLE"; payload: \{ sessionId: string; title: string \} \}/,
    'UPDATE_SESSION_TITLE action should be defined in the AppAction union type with proper payload structure'
  );
});

test('UPDATE_SESSION_TITLE action payload structure is strongly typed', () => {
  assert.match(
    storeSource,
    /UPDATE_SESSION_TITLE"; payload: \{ sessionId: string; title: string \}/,
    'UPDATE_SESSION_TITLE payload should have sessionId as string and title as string'
  );
});

test('appReducer handles UPDATE_SESSION_TITLE action', () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    'export function appReducer(state: AppState, action: AppAction): AppState {',
  );

  assert.match(
    reducerBody,
    /case "UPDATE_SESSION_TITLE": \{/,
    'appReducer should have a case for UPDATE_SESSION_TITLE action'
  );
});

test('UPDATE_SESSION_TITLE reducer updates session title in sessionsList', () => {
  assert.match(
    storeSource,
    /case "UPDATE_SESSION_TITLE": \{[\s\S]*const \{ sessionId, title \} = action\.payload;[\s\S]*const updated = state\.sessionsList\.map\(\(s\) =>[\s\S]*s\.id === sessionId \? \{ \.\.\.s, title \} : s,[\s\S]*\);[\s\S]*return \{ \.\.\.state, sessionsList: updated \};[\s\S]*\}/,
    'UPDATE_SESSION_TITLE reducer should map over sessionsList and update the title for matching session ID'
  );
});

test('UPDATE_SESSION_TITLE reducer uses immutable update pattern', () => {
  assert.match(
    storeSource,
    /s\.id === sessionId \? \{ \.\.\.s, title \} : s/,
    'UPDATE_SESSION_TITLE reducer should use spread operator for immutable update'
  );

  assert.match(
    storeSource,
    /return \{ \.\.\.state, sessionsList: updated \};/,
    'UPDATE_SESSION_TITLE reducer should spread state for immutable return'
  );
});

test('UPDATE_SESSION_TITLE reducer preserves other session properties', () => {
  assert.match(
    storeSource,
    /\{ \.\.\.s, title \}/,
    'UPDATE_SESSION_TITLE reducer should preserve all other session properties using spread operator'
  );
});

test('UPDATE_SESSION_TITLE only updates matching session by ID', () => {
  assert.match(
    storeSource,
    /state\.sessionsList\.map\(\(s\) =>[\s\S]*s\.id === sessionId/,
    'UPDATE_SESSION_TITLE reducer should only update sessions where the ID matches'
  );
});

test('UPDATE_SESSION_TITLE action is placed logically in AppAction union', () => {
  assert.match(
    storeSource,
    /\| \{ type: "SET_SESSIONS_LIST"; payload: Session\[\] \}[\s\S]*\| \{ type: "UPDATE_SESSION_TITLE"; payload: \{ sessionId: string; title: string \} \}[\s\S]*\| \{ type: "SET_PROCESSING_SESSIONS"; payload: string\[\] \}/,
    'UPDATE_SESSION_TITLE action should be positioned between SET_SESSIONS_LIST and SET_PROCESSING_SESSIONS in the AppAction union'
  );
});

test('UPDATE_SESSION_TITLE maintains sessionsList type integrity', () => {
  assert.match(
    storeSource,
    /const updated = state\.sessionsList\.map\(\(s\) =>/,
    'UPDATE_SESSION_TITLE reducer should use map to maintain Session[] array type'
  );
});

test('UPDATE_SESSION_TITLE reducer does not mutate original state', () => {
  assert.match(
    storeSource,
    /const updated = state\.sessionsList\.map\(/,
    'UPDATE_SESSION_TITLE reducer should create a new array via map instead of mutating'
  );

  assert.match(
    storeSource,
    /return \{ \.\.\.state, sessionsList: updated \};/,
    'UPDATE_SESSION_TITLE reducer should return a new state object'
  );
});
