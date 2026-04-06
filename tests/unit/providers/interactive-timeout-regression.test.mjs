/**
 * Interactive Timeout Regression Tests
 *
 * Tests for the transition window duration mismatch bug fix.
 * Ensures the extension uses the same 15-second window as the webview
 * to prevent the popover from reappearing after submitting answers.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource } from "../../helpers/source-utils.mjs";

test('transition window: extension matches webview 15-second duration', () => {
  const providerSource = readSource('src/providers/ChatViewProvider.ts');

  // Find the dispatchInteractiveResponse method area
  const dispatchMatch = providerSource.match(
    /private async dispatchInteractiveResponse[\s\S]*?interactiveResponseTransitionUntil[\s\S]*?\n\s*\}/m
  );

  assert.ok(dispatchMatch, 'dispatchInteractiveResponse method should exist');

  const methodBody = dispatchMatch[0];

  // Check for 15000ms (15 seconds) window, not 3000ms (3 seconds)
  assert.match(
    methodBody,
    /15000/,
    'Extension should use 15000ms transition window to match webview'
  );

  assert.doesNotMatch(
    methodBody,
    /3000/,
    'Extension should NOT use 3000ms transition window (causes popover reappearing)'
  );
});

test('transition window: is set when awaitingInteractiveAnswer is true', () => {
  const providerSource = readSource('src/providers/ChatViewProvider.ts');

  // Find the section where we check awaitingInteractiveAnswer and set transition window
  const windowSettingSection = providerSource.match(
    /if\s*\(\s*this\.awaitingInteractiveAnswer\s*\)\s*\{[\s\S]*?interactiveResponseTransitionUntil[\s\S]*?\}/
  );

  assert.ok(
    windowSettingSection,
    'Should have transition window logic when awaitingInteractiveAnswer is true'
  );

  assert.match(
    windowSettingSection[0],
    /Date\.now\(\)\s*\+\s*15000/,
    'Should set transition window to current time + 15000ms'
  );
});
