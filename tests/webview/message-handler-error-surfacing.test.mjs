/**
 * Regression: Pre-message failures (invalid parts, server validation) must
 * surface as in-conversation error messages, not be silently swallowed.
 *
 * Bug: The old session.error handler only checked flat payload fields and
 * used keyword-based filtering to drop "noise" errors. Server payloads nest
 * the error message as { error: { data: { message } } }, so the flat
 * extraction missed the real message and the error was silently dropped.
 * Pre-message failures never emit a message.updated sync event, so they
 * had no other path to reach the conversation.
 *
 * Fix: messageHandler now:
 *   1. Extracts error.data.message with priority over flat fields
 *   2. Uses signaling detection (completed/finished/done) instead of keywords
 *   3. Materializes genuine errors as the normal inline assistant error card
 *   4. Always resets SET_ASSISTANT_TURN_PENDING to false
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource, joinFromRoot, extractFunctionBody } from "../helpers/source-utils.mjs";

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

function extractSessionErrorBlock(source) {
  const start = source.indexOf("case 'session.error':");
  if (start === -1) return "";
  // Find the matching `break;` for this case block
  const breakIdx = source.indexOf("break;", start);
  return breakIdx === -1 ? "" : source.slice(start, breakIdx + 6);
}

test("session.error handler handles both session.error and error event types", () => {
  assert.match(
    messageHandlerSource,
    /case 'session\.error':[\s\S]*?case 'error':/,
    "handler must cover both session.error and bare error event types",
  );
});

test("error message extraction prioritizes nested error.data.message", () => {
  const block = extractSessionErrorBlock(messageHandlerSource);
  assert.ok(block.length > 0, "session.error case block must exist");

  // Must access payload.error as a record first
  assert.match(
    block,
    /asRecord\(payload\.error\)/,
    "must cast payload.error to record for nested access",
  );

  // Must access errorRecord.data as a record
  assert.match(
    block,
    /asRecord\(errorRecord\?\.data\)/,
    "must access error.data as a record",
  );

  // The extraction chain must include errorDataRecord.message
  assert.match(
    block,
    /asString\(errorDataRecord\?\.message\)/,
    "must extract message from error.data.message",
  );

  // Must also check flat payload.message as first priority
  assert.match(
    block,
    /asString\(payload\.message\)/,
    "must also check flat payload.message",
  );
});

test("error reason extracted for signaling detection", () => {
  const block = extractSessionErrorBlock(messageHandlerSource);

  assert.match(
    block,
    /const errorReason =[\s\S]*?asString\(properties\?\.reason\)[\s\S]*?asString\(properties\?\.code\)[\s\S]*?asString\(payload\.reason\)[\s\S]*?asString\(payload\.code\)/,
    "must extract reason/code from both wrapped SDK and legacy flat fields",
  );
});

test("isSignalingEvent detects completion signals in reason", () => {
  const block = extractSessionErrorBlock(messageHandlerSource);

  // Must check for completed, finished, done — NOT old keyword filtering
  assert.match(
    block,
    /errorReason\?\.includes\("completed"\)/,
    "must detect 'completed' signaling",
  );
  assert.match(
    block,
    /errorReason\?\.includes\("finished"\)/,
    "must detect 'finished' signaling",
  );
  assert.match(
    block,
    /errorReason\?\.includes\("done"\)/,
    "must detect 'done' signaling",
  );
});

test("isGenuineError requires non-empty message and excludes signaling events", () => {
  const block = extractSessionErrorBlock(messageHandlerSource);

  assert.match(
    block,
    /const isGenuineError =/,
    "must define isGenuineError flag",
  );
  assert.match(
    block,
    /!!errorMessage/,
    "must require errorMessage to be truthy",
  );
  assert.match(
    block,
    /errorMessage\.trim\(\)\.length > 0/,
    "must require non-empty trimmed message",
  );
  assert.match(
    block,
    /!isSignalingEvent/,
    "must exclude signaling events from genuine errors",
  );
});

test("genuine errors materialize the inline assistant error card", () => {
  const block = extractSessionErrorBlock(messageHandlerSource);

  assert.match(
    block,
    /if \(isGenuineError\)/,
    "must branch on isGenuineError",
  );
  assert.match(
    block,
    /materializeSessionErrorMessage\([\s\S]*?errorMessage[\s\S]*?payload/,
    "must materialize a genuine session.error with its raw SDK payload so the centralized transcript can render it",
  );
  assert.match(
    block,
    /dispatch\(\{ type: "ADD_ERROR_MESSAGE", payload: errorMessage \}\)/,
    "a genuine live session.error must also be surfaced through the durable toast channel",
  );
});

test("materialized session errors retain the originating SDK event", () => {
  const helperStart = messageHandlerSource.indexOf("function materializeSessionErrorMessage");
  const helperEnd = messageHandlerSource.indexOf("function finalizeStreamingSnapshotSteps", helperStart);
  const helper = messageHandlerSource.slice(helperStart, helperEnd);
  assert.match(
    helper,
    /rawSdkEventPayloads:\s*rawSdkEventPayload \? \[rawSdkEventPayload\] : \[\]/,
    "strict centralized rendering must receive the session.error event on the materialized message",
  );
});

test("history refresh preserves an SDK-backed live session.error", () => {
  const storeSource = readSource(
    [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
    "store.ts",
  );
  assert.match(
    storeSource,
    /function isSdkBackedSessionErrorMessage[\s\S]*?eventType === "session\.error"[\s\S]*?function retainSdkBackedSessionErrors[\s\S]*?case "SET_MESSAGES":[\s\S]*?retainSdkBackedSessionErrors\(/s,
    "a history replacement must retain an exact SDK session.error rather than clearing the already-rendered terminal error",
  );
});

test("session.error reads the SDK's wrapped properties.error.data.message", () => {
  const block = extractSessionErrorBlock(messageHandlerSource);

  assert.match(
    block,
    /asRecord\(properties\?\.error\) \?\? asRecord\(payload\.error\)/,
    "must prefer the SDK wrapper field before legacy flat errors",
  );
  assert.match(
    messageHandlerSource,
    /const isSessionErrorEvent =\s*getCentralizedEventType\(payload\) === "session\.error"/,
    "outer stream admission must allow terminal session.error frames through",
  );
});

test("live session.error bypasses terminal and stopped-session guards", () => {
  assert.match(
    messageHandlerSource,
    /const isTerminalSessionError =[\s\S]*?isActiveSessionTerminalTranscript && !isTerminalSessionError[\s\S]*?\[LIVE-STREAM-TRACE\]\[ERROR\] admitted-after-terminal-card/s,
    "the terminal-card guard must not discard the SDK error that explains a terminal failure",
  );
  assert.match(
    messageHandlerSource,
    /isStoppedSession\(eventSessionId, activeSessionId\)[\s\S]*?!isTerminalSessionError/s,
    "the stopped-session guard must also allow terminal errors to reach the handler",
  );
  assert.match(
    messageHandlerSource,
    /\[LIVE-STREAM-TRACE\]\[ERROR\] materializing/,
    "debug mode must confirm when the nested SDK error is materialized for the transcript",
  );
});

test("batched and scoped session.error events still reach the toast store", () => {
  assert.match(
    messageHandlerSource,
    /case "streamEventBatch":[\s\S]*?const isTerminalSessionError =[\s\S]*?isStoppedSession\(eventSessionId, activeSessionId\)[\s\S]*?!isTerminalSessionError[\s\S]*?\[LIVE-STREAM-TRACE\]\[ERROR\] batch-admitted/s,
    "the batched stopped-session gate must admit a terminal session.error",
  );
  assert.match(
    messageHandlerSource,
    /toast-forwarded-from-scoped-batch[\s\S]*?case "SET_STREAMING"/s,
    "a session.error from a cached non-selected session must forward ADD_ERROR_MESSAGE to the real store",
  );
  assert.match(
    messageHandlerSource,
    /toast-forwarded-from-scoped-event[\s\S]*?case "SET_STREAMING"/s,
    "the single-event scoped stream path must also forward its toast",
  );
});

test("session.error always resets assistant turn pending regardless of error type", () => {
  const block = extractSessionErrorBlock(messageHandlerSource);

  // SET_ASSISTANT_TURN_PENDING must be OUTSIDE the isGenuineError if-block
  // so it runs for both genuine and signaling events
  const genuineIdx = block.indexOf("if (isGenuineError)");
  const turnPendingIdx = block.indexOf('type: "SET_ASSISTANT_TURN_PENDING"');

  assert.ok(
    turnPendingIdx > genuineIdx,
    "SET_ASSISTANT_TURN_PENDING dispatch must come after the isGenuineError check — it must run unconditionally",
  );

  assert.match(
    block,
    /SET_ASSISTANT_TURN_PENDING["']?,[\s\S]*?payload:\s*\{ pending:\s*false,\s*messageId:\s*null \}/s,
    "must reset assistant turn pending to false with null messageId",
  );
});

test("session.error handler dispatches SET_PROCESSING false and FINISH_STREAMING", () => {
  const block = extractSessionErrorBlock(messageHandlerSource);

  assert.match(
    block,
    /type: 'SET_PROCESSING', payload: false/,
    "must set processing to false on session error",
  );
  assert.match(
    block,
    /type: 'FINISH_STREAMING'/,
    "must finish streaming on session error",
  );
});
