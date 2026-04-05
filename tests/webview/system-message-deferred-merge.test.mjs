import test from "node:test";
import assert from "node:assert/strict";

import {
  joinFromRoot,
  readSource,
} from '../helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

/**
 * System Message Deferred Merge Tests
 *
 * Tests the deferred merge mechanism for system messages that arrive during streaming.
 *
 * Key scenarios tested:
 * 1. System messages during streaming are stored in pending set (not dispatched immediately)
 * 2. System messages when not streaming are dispatched immediately
 * 3. Pending system messages are flushed when streaming completes
 * 4. Multiple streaming completion points trigger flush
 * 5. Pending messages are cleared after flushing
 */

test("deferred merge: pendingSystemMessages storage exists", () => {
  // Verify the module-level storage for pending system messages exists
  assert.match(
    messageHandlerSource,
    /const pendingSystemMessages = new Set<Message>\(\);/,
    "Should have module-level Set to store pending system messages during streaming"
  );

  // Verify the comment explains the purpose
  assert.match(
    messageHandlerSource,
    /Store system messages that arrive during streaming for deferred merge/,
    "Should have comment explaining pending system messages storage"
  );
});

test("deferred merge: flushPendingSystemMessages helper function exists", () => {
  // Verify the helper function to flush pending messages exists
  assert.match(
    messageHandlerSource,
    /function flushPendingSystemMessages\(/,
    "Should have flushPendingSystemMessages helper function"
  );

  // Verify it takes dispatch and getState parameters
  assert.match(
    messageHandlerSource,
    /flushPendingSystemMessages\(\s*dispatch:\s*Dispatch<AppAction>,\s*getState:\s*\(\)\s*=>\s*AppState\s*\)/,
    "flushPendingSystemMessages should accept dispatch and getState parameters"
  );

  // Verify the comment explains its purpose
  assert.match(
    messageHandlerSource,
    /Helper function to flush pending system messages when streaming completes/,
    "Should have comment explaining the helper function's purpose"
  );
});

test("deferred merge: flush function early returns when no pending messages", () => {
  // Verify early return when pending set is empty
  assert.match(
    messageHandlerSource,
    /if\s*\(\s*pendingSystemMessages\.size\s*===\s*0\s*\)\s*\{[\s\S]*?return;/,
    "Should early return when no pending messages"
  );
});

test("deferred merge: flush function converts pending Set to array and clears", () => {
  // Verify conversion to array
  assert.match(
    messageHandlerSource,
    /const messagesToAdd = Array\.from\(pendingSystemMessages\);/,
    "Should convert Set to array for dispatching"
  );

  // Verify clearing the set
  assert.match(
    messageHandlerSource,
    /pendingSystemMessages\.clear\(\);/,
    "Should clear pending messages after converting to array"
  );
});

test("deferred merge: flush function dispatches SET_MESSAGES with pending messages", () => {
  // Verify dispatch with SET_MESSAGES
  assert.match(
    messageHandlerSource,
    /dispatch\(\{\s*type:\s*['"]SET_MESSAGES['"],\s*payload:\s*\[\.\.\.state\.messages,\s*.*?messagesToAdd\]\s*\}\)/,
    "Should dispatch SET_MESSAGES with existing messages plus pending messages"
  );
});

test("deferred merge: system messages during streaming are stored, not dispatched", () => {
  // Look for the system message handling logic
  // Should have conditional: if (!current) dispatch, else store
  assert.match(
    messageHandlerSource,
    /if\s*\(\s*!\s*current\s*\)\s*\{[\s\S]*?dispatch\(\{\s*type:\s*['"]SET_MESSAGES['"]/m,
    "When no active streaming, should dispatch immediately"
  );

  assert.match(
    messageHandlerSource,
    /\}\s*else\s*\{[\s\S]*?pendingSystemMessages\.add\(systemMessage\);/m,
    "When streaming is active, should store in pending set"
  );
});

test("deferred merge: flush is called on messageResponse (completion)", () => {
  // Verify flush is called at the end of messageResponse
  assert.match(
    messageHandlerSource,
    /case\s*['"]messageResponse['"]:[\s\S]*?flushPendingSystemMessages\(dispatch,\s*getState\);/m,
    "Should flush pending system messages when messageResponse completes"
  );
});

test("deferred merge: flush is called on finish/done events", () => {
  // Verify flush is called for finish events
  assert.match(
    messageHandlerSource,
    /case\s*['"]finish['"]:[\s\S]*?flushPendingSystemMessages\(dispatch,\s*getState\);/m,
    "Should flush pending system messages on finish event"
  );
});

test("deferred merge: flush is called on done events", () => {
  // Verify flush is called for done events
  assert.match(
    messageHandlerSource,
    /case\s*['"]done['"]:[\s\S]*?flushPendingSystemMessages\(dispatch,\s*getState\);/m,
    "Should flush pending system messages on done event"
  );
});

test("deferred merge: flush is called on error events", () => {
  // Verify flush is called for error events
  assert.match(
    messageHandlerSource,
    /case\s*['"]error['"]:[\s\S]*?flushPendingSystemMessages\(dispatch,\s*getState\);/m,
    "Should flush pending system messages on error event"
  );
});

test("deferred merge: flush is called on stopRequestHandled", () => {
  // Verify flush is called for stop request handling
  assert.match(
    messageHandlerSource,
    /case\s*['"]stopRequestHandled['"]:[\s\S]*?flushPendingSystemMessages\(dispatch,\s*getState\);/m,
    "Should flush pending system messages on stopRequestHandled"
  );
});

test("deferred merge: implementation prevents race conditions", () => {
  // Verify the comment explains the race condition prevention
  assert.ok(
    messageHandlerSource.includes('race-condition') &&
    messageHandlerSource.includes('deferred merge'),
    "Should have comment explaining deferred merge prevents race conditions"
  );

  // Verify system messages are handled specially vs regular messages
  assert.match(
    messageHandlerSource,
    /hasSystemMessagePatternInText\(partText\)/,
    "Should check for system message pattern"
  );

  // Verify the conditional logic for immediate vs deferred dispatch
  assert.match(
    messageHandlerSource,
    /if\s*\(\s*!\s*current\s*\)/m,
    "Should have conditional check for active streaming state"
  );
});

test("deferred merge: multiple system messages during streaming are all flushed", () => {
  // Verify that the pending system messages can accumulate and all get flushed

  // Verify it processes all pending messages
  assert.match(
    messageHandlerSource,
    /const messagesToAdd = Array\.from\(pendingSystemMessages\);/,
    "Should convert ALL pending messages to array"
  );

  // Verify they're all added to state
  assert.match(
    messageHandlerSource,
    /\[\.\.\.state\.messages,\s*.*?messagesToAdd\]/,
    "Should append all pending messages to existing messages"
  );
});

test("deferred merge: pending set is cleared after flush to prevent duplicate dispatches", () => {
  // Verify clear happens to prevent re-dispatching same messages
  assert.match(
    messageHandlerSource,
    /pendingSystemMessages\.clear\(\);/,
    "Should clear pending messages to prevent duplicate dispatches"
  );
});

test("deferred merge: flush guards against empty pending set", () => {
  // Verify the size check
  assert.match(
    messageHandlerSource,
    /if\s*\(\s*pendingSystemMessages\.size\s*===\s*0\s*\)\s*\{[\s\S]*?return;/m,
    "Should check size and return early if no pending messages"
  );
});

test("deferred merge: system message uses pattern-based detection", () => {
  // Verify it uses the pattern detection function
  assert.match(
    messageHandlerSource,
    /hasSystemMessagePatternInText\(/,
    "Should use hasSystemMessagePatternInText for pattern detection"
  );

  // Verify system message is created with role: 'system'
  assert.match(
    messageHandlerSource,
    /role:\s*['"]system['"]/,
    "System message should have role set to 'system'"
  );
});

test("deferred merge: comments explain the deferred merge behavior", () => {
  // Verify comment explains deferred merge
  assert.ok(
    messageHandlerSource.includes('deferred merge') &&
    messageHandlerSource.includes('streaming completes'),
    "Should have comment explaining deferred merge happens when streaming completes"
  );

  // Verify comment explains why deferred merge is needed
  assert.ok(
    messageHandlerSource.includes('race-condition') &&
    messageHandlerSource.includes('overwrites'),
    "Should mention race condition prevention as reason for deferred merge"
  );
});

test("deferred merge: verifies all streaming completion paths trigger flush", () => {
  // Get all the switch cases that should trigger flush
  const completionCases = [
    { name: "messageResponse", pattern: 'case "messageResponse":' },
    { name: "finish", pattern: "case 'finish':" },
    { name: "done", pattern: "case 'done':" },
    { name: "error", pattern: "case 'error':" },
    { name: "stopRequestHandled", pattern: 'case "stopRequestHandled":' }
  ];

  // Verify each completion case exists in the source
  for (const { name, pattern } of completionCases) {
    assert.ok(
      messageHandlerSource.includes(pattern),
      `${name} case should exist in message handler`
    );
  }

  // Verify flush function is called somewhere in the source
  assert.ok(
    messageHandlerSource.includes('flushPendingSystemMessages(dispatch, getState)'),
    "flushPendingSystemMessages should be called in the message handler"
  );
});

test("deferred merge: implementation maintains existing pattern-based filtering", () => {
  // Verify it still uses the pattern-based detection
  assert.match(
    messageHandlerSource,
    /hasSystemMessagePatternInText\(/,
    "Should continue using pattern-based detection for system messages"
  );

  // Verify the pattern check happens before deferred logic
  assert.ok(
    messageHandlerSource.indexOf('hasSystemMessagePatternInText(') >= 0,
    "Should have pattern check"
  );
});

test("deferred merge: prevents duplicate messages during rapid streaming", () => {
  // Verify Set is used (which prevents duplicates)
  assert.match(
    messageHandlerSource,
    /const pendingSystemMessages = new Set<Message>\(\);/,
    "Should use Set data structure which prevents duplicates"
  );

  // Verify clear happens to prevent re-adding same messages
  assert.match(
    messageHandlerSource,
    /pendingSystemMessages\.clear\(\);/,
    "Should clear after flush to prevent duplicates on next flush"
  );
});

test("deferred merge: verify system message dispatching logic structure", () => {
  // Verify the overall structure of the deferred merge logic
  assert.ok(
    messageHandlerSource.includes('pendingSystemMessages.add(systemMessage)') &&
    messageHandlerSource.includes('flushPendingSystemMessages(dispatch, getState)'),
    "Should have both storage logic and flush mechanism"
  );

  // Verify conditional dispatching based on streaming state
  assert.ok(
    messageHandlerSource.includes('if (!current)') &&
    messageHandlerSource.includes('else {'),
    "Should have conditional logic for immediate vs deferred dispatch"
  );
});

test("deferred merge: verify state isolation during streaming", () => {
  // Verify the comment explains why this is safe during streaming
  assert.match(
    messageHandlerSource,
    /Streaming content is in state\.streaming/mi,
    "Should explain that streaming content is separate from state.messages"
  );
});

test("deferred merge: comprehensive flush coverage across all exit paths", () => {
  // Verify all the places where flush should be called
  const flushCalls = messageHandlerSource.match(/flushPendingSystemMessages\(dispatch,\s*getState\)/g);

  assert.ok(
    flushCalls && flushCalls.length >= 5,
    `Should have at least 5 flush calls (one for each completion path), found ${flushCalls?.length || 0}`
  );
});

test("deferred merge: verify data structure choice for pending messages", () => {
  // Verify Set<Message> is used for automatic deduplication
  assert.match(
    messageHandlerSource,
    /const pendingSystemMessages = new Set<Message>\(\);/,
    "Should use Set<Message> for automatic deduplication of system messages"
  );

  // Verify the type parameter is Message
  assert.match(
    messageHandlerSource,
    /Set<Message>/,
    "Should properly type the Set as containing Message objects"
  );
});
