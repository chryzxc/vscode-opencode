/**
 * Quota Integration Tests
 *
 * Tests for quota data flow between extension and webview:
 * - Extension to webview communication
 * - Message handling
 * - Initial data loading
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);
const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

test('ChatViewProvider posts quotaData on quotaUpdate events', () => {
  assert.match(
    chatProviderSource,
    /this\.quotaService\.on\("quotaUpdate",\s*\(data\)\s*=>\s*\{[\s\S]*type:\s*"quotaData"/,
    'Should post quotaData message on quotaUpdate'
  );
});

test('ChatViewProvider ready flow inspects cached quota data', () => {
  assert.match(
    chatProviderSource,
    /const\s+quotaData\s*=\s*this\.quotaService\.cachedData;/,
    'Should check cached quota data'
  );
});

test('ChatViewProvider posts cached quota data when available', () => {
  assert.match(
    chatProviderSource,
    /if\s*\(quotaData(\s*!==\s*undefined)?\)\s*\{[\s\S]*type:\s*"quotaData"/,
    'Should post cached data when available'
  );
});

test('ChatViewProvider refreshes quota when cache is empty', () => {
  assert.match(
    chatProviderSource,
    /else\s*\{[\s\S]*this\.quotaService\.refreshQuota\(\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/,
    'Should refresh when cache is empty'
  );
});

test('Message handler processes quota messages', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)'
  );

  assert.match(
    handlerBody,
    /quotaData|quotaUpdate/,
    'Should handle quota messages'
  );
});

test('Message handler dispatches SET_QUOTA_DATA action', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)'
  );

  assert.match(
    handlerBody,
    /SET_QUOTA_DATA/,
    'Should dispatch SET_QUOTA_DATA'
  );
});
