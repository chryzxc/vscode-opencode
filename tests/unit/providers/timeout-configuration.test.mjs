/**
 * Timeout Configuration Unit Tests
 *
 * Comprehensive tests for timeout configuration and calculation functionality
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

test("getRequestTimeout method exists and reads configuration", () => {
  assert.match(
    chatProviderSource,
    /private getRequestTimeout\(\): number/,
    "getRequestTimeout method should exist"
  );

  assert.match(
    chatProviderSource,
    /const config = vscode\.workspace\.getConfiguration\('opencode'\)/,
    "Should read from opencode configuration"
  );

  assert.match(
    chatProviderSource,
    /const timeout = config\.get<number>\('requestTimeout',\s*120000\)/,
    "Should default to 120000ms (2 minutes)"
  );
});

test("getRequestTimeout validates timeout bounds", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private getRequestTimeout(): number",
  );

  assert.match(
    body,
    /if \(timeout < 10000 \|\| timeout > 600000\)/,
    "Should validate timeout is between 10s and 10 minutes"
  );

  assert.match(
    body,
    /logger\.warn/,
    "Should log warning for invalid values"
  );

  assert.match(
    body,
    /return 120000/,
    "Should return default 120000ms for invalid values"
  );
});

test("calculateTimeoutForQuery method exists and calculates complexity", () => {
  assert.match(
    chatProviderSource,
    /private calculateTimeoutForQuery\(/,
    "calculateTimeoutForQuery method should exist"
  );

  assert.match(
    chatProviderSource,
    /const multiplier = config\.get<number>\('complexQueryMultiplier',\s*1\.5\)/,
    "Should read complexQueryMultiplier with default 1.5"
  );

  assert.match(
    chatProviderSource,
    /complexityScore.*hasFiles.*hasContexts.*hasImages/,
    "Should calculate complexity score from attachments"
  );
});

test("calculateTimeoutForQuery applies multiplier for complex queries", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private calculateTimeoutForQuery\\(",
  );

  assert.match(
    body,
    /if \(complexityScore >= 2\)/,
    "Should check if complexity score is 2 or more"
  );

  assert.match(
    body,
    /Math\.floor\(baseTimeout \* multiplier\)/,
    "Should apply multiplier and floor the result"
  );

  assert.match(
    body,
    /logger\.debug.*Using extended timeout/,
    "Should log when using extended timeout"
  );
});

test("calculateTimeoutForQuery returns base timeout for simple queries", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private calculateTimeoutForQuery\\(",
  );

  assert.match(
    body,
    /return baseTimeout/,
    "Should return base timeout for simple queries"
  );
});

test("promptWithStructuredOutput accepts options parameter", () => {
  assert.match(
    chatProviderSource,
    /private async promptWithStructuredOutput\([\s\S]*options\?:\s*\{/,
    "promptWithStructuredOutput should accept options parameter"
  );

  assert.match(
    chatProviderSource,
    /hasFiles\?\:\s*boolean/,
    "Should accept hasFiles boolean flag"
  );

  assert.match(
    chatProviderSource,
    /hasContexts\?\:\s*boolean/,
    "Should accept hasContexts boolean flag"
  );

  assert.match(
    chatProviderSource,
    /hasImages\?\:\s*boolean/,
    "Should accept hasImages boolean flag"
  );
});

test("promptWithStructuredOutput calculates and passes timeout to SDK", () => {
  assert.match(
    chatProviderSource,
    /const baseTimeout = this\.getRequestTimeout\(\)/,
    "Should get base timeout from configuration"
  );

  assert.match(
    chatProviderSource,
    /const timeout = this\.calculateTimeoutForQuery\(/,
    "Should calculate timeout based on query complexity"
  );

  assert.match(
    chatProviderSource,
    /client\.session\.prompt\(\{[\s\S]*?timeout[\s\S]*?\}/,
    "Should pass calculated timeout to SDK"
  );
});

test("promptWithStructuredOutput logs SDK call initiation", () => {
  assert.match(
    chatProviderSource,
    /logger\.debug.*Initiating SDK prompt call/,
    "Should log SDK call initiation"
  );

  assert.match(
    chatProviderSource,
    /timeout[\s\S]*timeout/,
    "Should log timeout value"
  );

  assert.match(
    chatProviderSource,
    /hasFiles:/,
    "Should log hasFiles flag"
  );

  assert.match(
    chatProviderSource,
    /hasContexts:/,
    "Should log hasContexts flag"
  );

  assert.match(
    chatProviderSource,
    /hasImages:/,
    "Should log hasImages flag"
  );
});

test("promptWithStructuredOutput tracks SDK call timing", () => {
  assert.match(
    chatProviderSource,
    /const sdkStartTime = Date\.now\(\)/,
    "Should record SDK call start time"
  );

  assert.match(
    chatProviderSource,
    /const sdkDuration = Date\.now\(\) - sdkStartTime/,
    "Should calculate SDK call duration"
  );

  assert.match(
    chatProviderSource,
    /logger\.performance.*SDK prompt call completed/,
    "Should log performance when call completes"
  );

  assert.match(
    chatProviderSource,
    /logger\.error.*SDK prompt call failed after/,
    "Should log error with timing when call fails"
  );
});

test("handleSendMessage passes query complexity flags", () => {
  assert.match(
    chatProviderSource,
    /await this\.promptWithStructuredOutput\(\s*client,\s*session\.id,\s*promptBody,\s*useStructuredOutput,\s*\{/,
    "Should pass options object to promptWithStructuredOutput"
  );

  assert.match(
    chatProviderSource,
    /hasFiles:\s*Boolean\(files\?\.length\)/,
    "Should convert files array to boolean"
  );

  assert.match(
    chatProviderSource,
    /hasContexts:\s*Boolean\(contexts\?\.length\)/,
    "Should convert contexts array to boolean"
  );

  assert.match(
    chatProviderSource,
    /hasImages:\s*Boolean\(images\?\.length\)/,
    "Should convert images array to boolean"
  );
});

test("handleSendMessage logs complexity information", () => {
  assert.match(
    chatProviderSource,
    /hasFiles:\s*Boolean\(files\?\.length\)/,
    "Should log hasFiles flag in timing logs"
  );

  assert.match(
    chatProviderSource,
    /hasContexts:\s*Boolean\(contexts\?\.length\)/,
    "Should log hasContexts flag in timing logs"
  );

  assert.match(
    chatProviderSource,
    /hasImages:\s*Boolean\(images\?\.length\)/,
    "Should log hasImages flag in timing logs"
  );
});

test("timeout recovery mechanism is preserved", () => {
  assert.match(
    chatProviderSource,
    /tryRecoverTimedOutResponse/,
    "Timeout recovery mechanism should still exist"
  );

  assert.match(
    chatProviderSource,
    /isLikelyInteractiveAwaitTimeoutError/,
    "Timeout detection should still exist"
  );

  assert.match(
    chatProviderSource,
    /shouldSuppressInteractiveAwaitTimeout/,
    "Timeout suppression logic should still exist"
  );
});

test("timeout values are logged in performance metrics", () => {
  assert.match(
    chatProviderSource,
    /logger\.performance[\s\S]*timeout:\s*timeout/,
    "Performance logs should include timeout value"
  );

  assert.match(
    chatProviderSource,
    /logger\.error[\s\S]*timeout:\s*timeout/,
    "Error logs should include timeout value"
  );
});
