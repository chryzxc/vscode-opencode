/**
 * Timeout Edge Cases and Boundary Tests
 *
 * Tests for timeout edge cases, boundary conditions, and error scenarios
 */

import test from "node:test";
import assert from "node:assert/strict";
import { extractFunctionBody, joinFromRoot, readAllSources } from "../../helpers/source-utils.mjs";

const chatProviderSource = readAllSources(
  [
    joinFromRoot("src", "providers", "ChatViewProvider.ts"),
    joinFromRoot("src", "providers", "chat", "DiagnosticsLogger.ts"),
    joinFromRoot("src", "providers", "chat", "StructuredOutputProcessor.ts"),
    joinFromRoot("src", "providers", "chat", "PlanManager.ts"),
    joinFromRoot("src", "providers", "chat", "SubagentPersistence.ts"),
    joinFromRoot("src", "providers", "chat", "CompactionManager.ts"),
    joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts"),
    joinFromRoot("src", "providers", "chat", "ModelAndAgentManager.ts"),
    joinFromRoot("src", "providers", "chat", "QueueManager.ts"),
    joinFromRoot("src", "providers", "chat", "SessionHandler.ts"),
    joinFromRoot("src", "providers", "chat", "StreamEventHandler.ts"),
    joinFromRoot("src", "providers", "chat", "types.ts")
  ],
  "ChatViewProvider.ts"
);

test("minimum timeout boundary (10 seconds) is enforced", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private getRequestTimeout(): number",
  );

  assert.match(
    body,
    /if \(timeout < 10000\)/,
    "Should check for minimum timeout of 10 seconds"
  );

  assert.match(
    body,
    /return 120000/,
    "Should return default for values below minimum"
  );
});

test("maximum timeout boundary (10 minutes) is enforced", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private getRequestTimeout(): number",
  );

  assert.match(
    body,
    /if \(timeout > 600000\)/,
    "Should check for maximum timeout of 10 minutes"
  );

  assert.match(
    body,
    /return 120000/,
    "Should return default for values above maximum"
  );
});

test("invalid timeout types are handled gracefully", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private getRequestTimeout(): number",
  );

  assert.match(
    body,
    /const timeout = config\.get<number>\('requestTimeout'/,
    "Should use typed configuration getter"
  );
});

test("complexity score calculation handles all combinations", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private calculateTimeoutForQuery(",
  );

  // Verify all three flags are included in complexity calculation
  assert.match(
    body,
    /complexityScore[\s\S]*hasFiles[\s\S]*hasContexts[\s\S]*hasImages/,
    "Should include all three flags in complexity calculation"
  );

  // Verify each flag contributes 1 to the score
  assert.match(
    body,
    /\? 1 : 0/,
    "Each flag should contribute 1 point when true"
  );
});

test("complexity threshold of 2 triggers timeout extension", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private calculateTimeoutForQuery(",
  );

  assert.match(
    body,
    /if \(complexityScore >= 2\)/,
    "Should extend timeout when complexity is 2 or more"
  );

  assert.match(
    body,
    /return baseTimeout/,
    "Should use base timeout when complexity is less than 2"
  );
});

test("timeout multiplier is applied correctly", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private calculateTimeoutForQuery(",
  );

  assert.match(
    body,
    /const multiplier = config\.get<number>\('complexQueryMultiplier',\s*1\.5\)/,
    "Should read multiplier from configuration with default 1.5"
  );

  assert.match(
    body,
    /Math\.floor\(baseTimeout \* multiplier\)/,
    "Should apply multiplier and floor the result"
  );
});

test("options parameter defaults to false for undefined values", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private async promptWithStructuredOutput(",
  );

  assert.match(
    body,
    /options\?\.hasFiles\s*\?\?\s*false/,
    "Should default hasFiles to false"
  );

  assert.match(
    body,
    /options\?\.hasContexts\s*\?\?\s*false/,
    "Should default hasContexts to false"
  );

  assert.match(
    body,
    /options\?\.hasImages\s*\?\?\s*false/,
    "Should default hasImages to false"
  );
});

test("timeout is passed as number type to SDK", () => {
  assert.match(
    chatProviderSource,
    /client\.session\.prompt\(\{[\s\S]*timeout:\s*timeout/,
    "Timeout should be passed as a variable (not string)"
  );
});

test("SDK call timing uses millisecond precision", () => {
  assert.match(
    chatProviderSource,
    /Date\.now\(\)/,
    "Should use Date.now() for millisecond precision timing"
  );

  assert.match(
    chatProviderSource,
    /const sdkDuration = Date\.now\(\) - sdkStartTime/,
    "Should calculate duration in milliseconds"
  );
});

test("performance logging includes success and error paths", () => {
  assert.match(
    chatProviderSource,
    /promise\.then\([\s\S]*logger\.performance/,
    "Should log performance on success path"
  );

  assert.match(
    chatProviderSource,
    /\.catch\([\s\S]*logger\.error/,
    "Should log error with timing on failure path"
  );
});

test("timeout logging includes session context", () => {
  assert.match(
    chatProviderSource,
    /logger\.debug[\s\S]*sessionID:\s*sessionID/,
    "Should include session ID in debug logs"
  );

  assert.match(
    chatProviderSource,
    /logger\.performance[\s\S]*sessionID/,
    "Should include session ID in performance logs"
  );

  assert.match(
    chatProviderSource,
    /logger\.error[\s\S]*sessionID/,
    "Should include session ID in error logs"
  );
});

test("timeout adjustment logging includes base and complexity", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private calculateTimeoutForQuery\\(",
  );

  assert.match(
    body,
    /logger\.debug[\s\S]*base:.*baseTimeout.*complexity:.*complexityScore/,
    "Should log both base timeout and complexity score"
  );
});

test("timeout validation warning message is descriptive", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private getRequestTimeout(): number",
  );

  assert.match(
    body,
    /logger\.warn.*Invalid requestTimeout/,
    "Should include 'Invalid requestTimeout' in warning message"
  );

  assert.match(
    body,
    /logger\.warn[\s\S]*120000/,
    "Should mention the default value being used"
  );
});

test("handleSendMessage safely converts arrays to booleans", () => {
  assert.match(
    chatProviderSource,
    /Boolean\(files\?\.length\)/,
    "Should safely convert files array to boolean"
  );

  assert.match(
    chatProviderSource,
    /Boolean\(contexts\?\.length\)/,
    "Should safely convert contexts array to boolean"
  );

  assert.match(
    chatProviderSource,
    /Boolean\(images\?\.length\)/,
    "Should safely convert images array to boolean"
  );
});

test("all timeout calculations happen before SDK call", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private async promptWithStructuredOutput(",
  );

  // Verify order: get base timeout → calculate timeout → pass to SDK
  assert.match(
    body,
    /const baseTimeout[\s\S]*const timeout[\s\S]*client\.session\.prompt/,
    "Should calculate timeout before making SDK call"
  );
});

test("timeout configuration is read at call time (not cached)", () => {
  assert.match(
    chatProviderSource,
    /this\.getRequestTimeout\(\)/,
    "Should call getRequestTimeout method (not use cached value)"
  );

  assert.match(
    chatProviderSource,
    /vscode\.workspace\.getConfiguration/,
    "Should read fresh configuration each time"
  );
});

test("extended timeout logging is only for complex queries", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private calculateTimeoutForQuery(",
  );

  assert.match(
    body,
    /if \(complexityScore >= 2\)[\s\S]*logger\.debug/,
    "Should only log extended timeout message when complexity >= 2"
  );

  assert.match(
    body,
    /return baseTimeout/,
    "Should return without logging for simple queries"
  );
});

test("timeout recovery polling delays are preserved", () => {
  assert.match(
    chatProviderSource,
    /const pollDelaysMs = this\.getTimeoutRecoveryPollDelays\(failureMessage\)/,
    "Timeout recovery should derive polling delays from timeout-aware helper"
  );

  assert.match(
    chatProviderSource,
    /return \[500,\s*1000,\s*1800,\s*2800,\s*4000,\s*5500,\s*7000,\s*9000,\s*12000,\s*15000,\s*20000,\s*25000,\s*30000\]/,
    "Timeout-like failures should use an extended backoff window"
  );

  assert.match(
    chatProviderSource,
    /tryRecoverTimedOutResponse/,
    "Timeout recovery method should still exist"
  );
});
});
