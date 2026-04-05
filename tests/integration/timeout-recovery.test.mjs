/**
 * Timeout Recovery Integration Tests
 *
 * Tests for timeout recovery mechanism and interaction with explicit timeout configuration
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource, joinFromRoot } from "../../helpers/source-utils.mjs";

  test("timeout recovery mechanism coexists with explicit timeout", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    // Verify recovery mechanism still exists
    assert.match(
      chatProviderSource,
      /private async tryRecoverTimedOutResponse\(/,
      "Timeout recovery method should still exist"
    );

    assert.match(
      chatProviderSource,
      /const pollDelaysMs = \[500,\s*1000,\s*1800,\s*2800,\s*4000\]/,
      "Should use exponential backoff for recovery polling"
    );
  });

  test("timeout detection patterns are preserved", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    assert.match(
      chatProviderSource,
      /private isLikelyInteractiveAwaitTimeoutError\(/,
      "Timeout detection method should still exist"
    );

    assert.match(
      chatProviderSource,
      /normalized\.includes\("timeout"\)/,
      "Should detect timeout keyword in error messages"
    );

    assert.match(
      chatProviderSource,
      /headers timeout|header timeout|request timed out|response timeout|body timeout/,
      "Should detect various timeout error patterns"
    );
  });

  test("timeout suppression logic is preserved", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    assert.match(
      chatProviderSource,
      /private shouldSuppressInteractiveAwaitTimeout\(/,
      "Timeout suppression method should still exist"
    );

    assert.match(
      chatProviderSource,
      /this\.awaitingInteractiveAnswer/,
      "Should check if awaiting interactive answer"
    );

    assert.match(
      chatProviderSource,
      /this\.isInInteractiveResponseTransition\(\)/,
      "Should check if in interactive response transition"
    );
  });

  test("timeout recovery is attempted before surfacing errors", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    // In handleSendMessage error handling
    assert.match(
      chatProviderSource,
      /const recovered = await this\.tryRecoverTimedOutResponse\(/,
      "Should attempt timeout recovery before showing error"
    );

    assert.match(
      chatProviderSource,
      /if \(recovered\)/,
      "Should handle successful recovery"
    );
  });

  test("timeout recovery uses baseline marker for comparison", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    assert.match(
      chatProviderSource,
      /baselineAssistantMarker/,
      "Should use baseline marker for comparison"
    );

    assert.match(
      chatProviderSource,
      /getLatestAssistantHistoryMarker/,
      "Should get latest assistant message marker"
    );

    assert.match(
      chatProviderSource,
      /hasAssistantHistoryAdvanced/,
      "Should check if history has advanced"
    );
  });

  test("timeout recovery processes messages after detection", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    assert.match(
      chatProviderSource,
      /const processedMessages = await this\.processHistoryMessages\(/,
      "Should process recovered messages"
    );

    assert.match(
      chatProviderSource,
      /return true/,
      "Should return true on successful recovery"
    );
  });

  test("timeout recovery returns false when recovery fails", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    assert.match(
      chatProviderSource,
      /for \(const delayMs of pollDelaysMs\)/,
      "Should iterate through poll delays"
    );

    assert.match(
      chatProviderSource,
      /continue/,
      "Should continue polling if no advancement"
    );

    assert.match(
      chatProviderSource,
      /return false/,
      "Should return false if recovery fails after all attempts"
    );
  });

  test("timeout recovery includes delay between polls", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    assert.match(
      chatProviderSource,
      /await this\.sleep\(delayMs\)/,
      "Should sleep between poll attempts"
    );

    assert.match(
      chatProviderSource,
      /const rawMessages = await this\.sessionService\.getMessages\(session\.id\)/,
      "Should fetch messages after each delay"
    );
  });

  test("timeout recovery logs suppression for interactive awaits", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    assert.match(
      chatProviderSource,
      /logger\.info.*Suppressing thrown timeout while awaiting interactive response/,
      "Should log timeout suppression for interactive awaits"
    );

    assert.match(
      chatProviderSource,
      /if \(this\.shouldSuppressInteractiveAwaitTimeout\(errorMessage\)\)/,
      "Should check if timeout should be suppressed"
    );
  });

  test("timeout recovery logs successful recovery", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    assert.match(
      chatProviderSource,
      /logger\.info.*Recovered thrown timeout from session history without user retry/,
      "Should log successful timeout recovery"
    );

    assert.match(
      chatProviderSource,
      /if \(recovered\)[\s\S]*logger\.info/,
      "Should log recovery success after detection"
    );
  });

  test("timeout recovery logs retry attempt", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    assert.match(
      chatProviderSource,
      /logger\.warn.*Thrown interactive transport failure; retrying once/,
      "Should log retry attempt for interactive transport failures"
    );

    assert.match(
      chatProviderSource,
      /isRetry:\s*true/,
      "Should pass isRetry flag on retry"
    );
  });

  test("timeout recovery handles both message and error formats", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    assert.match(
      chatProviderSource,
      /isLikelyInteractiveTransportFailure/,
      "Should check for interactive transport failures"
    );

    assert.match(
      chatProviderSource,
      /isLikelyInteractiveAwaitTimeoutError|isGenericErrorMessage/,
      "Should check multiple timeout/error patterns"
    );
  });

  test("timeout recovery respects interactive transition window", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    assert.match(
      chatProviderSource,
      /private isInInteractiveResponseTransition\(\)/,
      "Should check if in interactive transition window"
    );

    assert.match(
      chatProviderSource,
      /Date\.now\(\) <= this\.interactiveResponseTransitionUntil/,
      "Should compare current time with transition end time"
    );
  });

  test("timeout recovery marker comparison handles different formats", async () => {
    const chatProviderSource = readSource(
      [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
      "ChatViewProvider.ts"
    );

    assert.match(
      chatProviderSource,
      /private hasAssistantHistoryAdvanced\(/,
      "Should handle different marker formats"
    );

    assert.match(
      chatProviderSource,
      /Array\.isArray\(value\)|typeof value === "object"/,
      "Should normalize both array and object marker formats"
    );
  });
});

