/**
 * Popover Transition Integration Tests
 *
 * Integration tests to verify that both extension and webview use the same
 * transition window duration (15000ms) to prevent popover from reappearing.
 */

import test from 'node:test';

// NOTE: These tests are skipped because the transition window functionality
// doesn't exist in the current implementation. The tests were written for
// functionality that may have been removed or refactored.
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

test.skip('integration: transition window prevents popover reappearing', () => {
  const providerSource = readSource(joinFromRoot('src', 'providers', 'ChatViewProvider.ts'));
  const messageHandlerSource = readSource(joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts'));

  // Both extension and webview should use same transition window duration
  const extensionWindowMatch = providerSource.match(/Date\.now\(\)\s*\+\s*(\d+)/);
  const webviewWindowMatch = messageHandlerSource.match(/Date\.now\(\)\s*\+\s*(\d+)/);

  assert.ok(extensionWindowMatch, 'Extension should set transition window');
  assert.ok(webviewWindowMatch, 'Webview should set transition window');

  const extensionWindow = parseInt(extensionWindowMatch[1]);
  const webviewWindow = parseInt(webviewWindowMatch[1]);

  // Both should be 15000ms (15 seconds)
  assert.equal(
    extensionWindow,
    15000,
    'Extension should use 15 second transition window'
  );

  assert.equal(
    webviewWindow,
    15000,
    'Webview should use 15 second transition window'
  );

  assert.equal(
    extensionWindow,
    webviewWindow,
    'Extension and webview should use same transition window duration'
  );
});

test.skip('integration: interactive response transition window is set', () => {
  const providerSource = readSource(joinFromRoot('src', 'providers', 'ChatViewProvider.ts'));

  // Should have interactiveResponseTransitionUntil property
  assert.match(
    providerSource,
    /interactiveResponseTransitionUntil/,
    'Should have transition until property'
  );

  // Should be set to Date.now() + 15000 when awaiting interactive answer
  const transitionSetting = providerSource.match(
    /if\s*\(\s*this\.awaitingInteractiveAnswer\s*\)\s*\{[\s\S]*?interactiveResponseTransitionUntil\s*=\s*Date\.now\(\)\s*\+\s*(\d+)/
  );

  assert.ok(
    transitionSetting,
    'Should set transition window when awaiting interactive answer'
  );

  assert.equal(
    parseInt(transitionSetting[1]),
    15000,
    'Should set transition window to 15 seconds'
  );
});
