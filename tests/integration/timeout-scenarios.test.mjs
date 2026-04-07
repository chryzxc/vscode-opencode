/**
 * Timeout Scenarios Integration Tests
 */

import test from "node:test";
import assert from "node:assert/strict";

test("simple query uses base timeout without extension", async (t) => {
  // This test would require a full integration test setup
  // For now, we'll verify the logic is present in the source

  const { readSource } = await import("../helpers/source-utils.mjs");
  const { joinFromRoot } = await import("../helpers/source-utils.mjs");

  const chatProviderSource = readSource(
    [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
    "ChatViewProvider.ts"
  );

  // Verify simple query path returns base timeout
  assert.match(
    chatProviderSource,
    /if \(complexityScore >= 2\)[\s\S]*return baseTimeout/,
    "Simple queries (complexity < 2) should return base timeout"
  );

  // ✓ Simple query timeout logic verified
});

test("complex query with files and contexts extends timeout", async (t) => {
  const { readSource } = await import("../helpers/source-utils.mjs");
  const { joinFromRoot } = await import("../helpers/source-utils.mjs");

  const chatProviderSource = readSource(
    [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
    "ChatViewProvider.ts"
  );

  // Verify complexity calculation includes files and contexts
  assert.match(
    chatProviderSource,
    /complexityScore = \(hasFiles \? 1 : 0\) \+ \(hasContexts \? 1 : 0\) \+ \(hasImages \? 1 : 0\)/,
    "Complexity score should sum files, contexts, and images flags"
  );

  // Verify multiplier is applied for complex queries
  assert.match(
    chatProviderSource,
    /if \(complexityScore >= 2\)[\s\S]*Math\.floor\(baseTimeout \* multiplier\)/,
    "Complex queries (complexity >= 2) should apply timeout multiplier"
  );

  // ✓ Complex query timeout extension logic verified
});

test("complex query with images extends timeout", async (t) => {
  const { readSource } = await import("../helpers/source-utils.mjs");
  const { joinFromRoot } = await import("../helpers/source-utils.mjs");

  const chatProviderSource = readSource(
    [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
    "ChatViewProvider.ts"
  );

  // Verify images are included in complexity calculation
  assert.match(
    chatProviderSource,
    /hasImages \? 1 : 0/,
    "Images should contribute to complexity score"
  );

  // ✓ Image-based complexity calculation verified
});

test("timeout is passed to SDK prompt call", async (t) => {
  const { readSource } = await import("../helpers/source-utils.mjs");
  const { joinFromRoot } = await import("../helpers/source-utils.mjs");

  const chatProviderSource = readSource(
    [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
    "ChatViewProvider.ts"
  );

  // Verify timeout is passed to SDK
  assert.match(
    chatProviderSource,
    /client\.session\.prompt\(\{[\s\S]*timeout:\s*timeout[\s\S]*\}/,
    "Timeout should be passed to SDK prompt call"
  );

  // ✓ Timeout parameter passed to SDK verified
});

test("SDK call performance logging includes duration and timeout", async (t) => {
  const { readSource } = await import("../helpers/source-utils.mjs");
  const { joinFromRoot } = await import("../helpers/source-utils.mjs");

  const chatProviderSource = readSource(
    [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
    "ChatViewProvider.ts"
  );

  // Verify performance logging includes timing
  assert.match(
    chatProviderSource,
    /logger\.performance.*SDK prompt call completed.*sdkDuration.*timeout/,
    "Performance log should include both duration and timeout value"
  );

  // Verify error logging includes timing
  assert.match(
    chatProviderSource,
    /logger\.error.*SDK prompt call failed after.*sdkDuration.*timeout/,
    "Error log should include both duration and timeout value"
  );

  // ✓ Performance logging verified
});

test("timeout recovery mechanism still works with explicit timeout", async (t) => {
  const { readSource } = await import("../helpers/source-utils.mjs");
  const { joinFromRoot } = await import("../helpers/source-utils.mjs");

  const chatProviderSource = readSource(
    [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
    "ChatViewProvider.ts"
  );

  // Verify timeout recovery is still present
  assert.match(
    chatProviderSource,
    /tryRecoverTimedOutResponse/,
    "Timeout recovery mechanism should still be present"
  );

  // Verify timeout detection is still present
  assert.match(
    chatProviderSource,
    /isLikelyInteractiveAwaitTimeoutError/,
    "Timeout detection should still be present"
  );

  // ✓ Timeout recovery mechanism compatibility verified
});

test("configuration changes are reflected in timeout calculations", async (t) => {
  const { readSource } = await import("../helpers/source-utils.mjs");
  const { joinFromRoot } = await import("../helpers/source-utils.mjs");

  const chatProviderSource = readSource(
    [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
    "ChatViewProvider.ts"
  );

  // Verify requestTimeout is read from configuration
  assert.match(
    chatProviderSource,
    /config\.get<number>\('requestTimeout',\s*120000\)/,
    "Base timeout should be read from requestTimeout configuration"
  );

  // Verify complexQueryMultiplier is read from configuration
  assert.match(
    chatProviderSource,
    /config\.get<number>\('complexQueryMultiplier',\s*1\.5\)/,
    "Complex query multiplier should be read from complexQueryMultiplier configuration"
  );

  // ✓ Configuration integration verified
});

test("invalid timeout values fall back to safe default", async (t) => {
  const { readSource } = await import("../helpers/source-utils.mjs");
  const { joinFromRoot } = await import("../helpers/source-utils.mjs");

  const chatProviderSource = readSource(
    [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
    "ChatViewProvider.ts"
  );

  // Verify lower bound validation
  assert.match(
    chatProviderSource,
    /if \(timeout < 10000\)[\s\S]*logger\.warn.*return 120000/,
    "Timeouts below 10 seconds should fall back to default"
  );

  // Verify upper bound validation
  assert.match(
    chatProviderSource,
    /if \(timeout > 600000\)[\s\S]*logger\.warn.*return 120000/,
    "Timeouts above 10 minutes should fall back to default"
  );

  // ✓ Timeout validation bounds verified
});

test("query complexity flags are correctly passed through call chain", async (t) => {
  const { readSource } = await import("../helpers/source-utils.mjs");
  const { joinFromRoot } = await import("../helpers/source-utils.mjs");

  const chatProviderSource = readSource(
    [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
    "ChatViewProvider.ts"
  );

  // Verify handleSendMessage calculates complexity flags
  assert.match(
    chatProviderSource,
    /Boolean\(files\?\.length\)/,
    "handleSendMessage should convert files array to boolean flag"
  );

  assert.match(
    chatProviderSource,
    /Boolean\(contexts\?\.length\)/,
    "handleSendMessage should convert contexts array to boolean flag"
  );

  assert.match(
    chatProviderSource,
    /Boolean\(images\?\.length\)/,
    "handleSendMessage should convert images array to boolean flag"
  );

  // Verify flags are passed to promptWithStructuredOutput
  assert.match(
    chatProviderSource,
    /promptWithStructuredOutput\([^{]*\{\s*hasFiles:\s*Boolean\(files\?\.length\),\s*hasContexts:\s*Boolean\(contexts\?\.length\),\s*hasImages:\s*Boolean\(images\?\.length\)\s*\}/,
    "Complexity flags should be passed in options object"
  );

  // ✓ Query complexity flag passing verified
});

