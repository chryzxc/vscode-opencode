import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readAllSources } from '../../helpers/source-utils.mjs';

const providerSource = readAllSources([
  joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
], 'ChatViewProvider.ts');

test('timeout suppression: awaitingInteractiveAnswer suppresses timeout errors', () => {

  // Find shouldSuppressInteractiveAwaitTimeout method
  const suppressMethod = extractFunctionBody(
    providerSource,
    'private shouldSuppressInteractiveAwaitTimeout(message: string): boolean {'
  );

  assert.ok(suppressMethod, 'shouldSuppressInteractiveAwaitTimeout method should exist');

  // Should check awaitingInteractiveAnswer flag
  assert.match(
    suppressMethod,
    /this\.awaitingInteractiveAnswer/,
    'Should check awaitingInteractiveAnswer flag'
  );

  // Should also check transition window
  assert.match(
    suppressMethod,
    /this\.isInInteractiveResponseTransition\(\)/,
    'Should also check interactive response transition window'
  );

  // Should return true when either condition is met
  assert.match(
    suppressMethod,
    /return\s+this\.awaitingInteractiveAnswer\s*\|\|/,
    'Should suppress when awaitingInteractiveAnswer is true'
  );
});

test('timeout suppression: identifies headers timeout error', () => {

  // Find isLikelyInteractiveAwaitTimeoutError method
  const timeoutCheckMethod = extractFunctionBody(
    providerSource,
    'private isLikelyInteractiveAwaitTimeoutError(message: string): boolean {'
  );

  assert.ok(timeoutCheckMethod, 'isLikelyInteractiveAwaitTimeoutError method should exist');

  // Should check for "headers timeout" pattern
  assert.match(
    timeoutCheckMethod,
    /headers timeout/i,
    'Should identify "headers timeout" error'
  );

  // Should also check for other timeout patterns
  assert.match(
    timeoutCheckMethod,
    /timeout/,
    'Should check for general timeout pattern'
  );
});
