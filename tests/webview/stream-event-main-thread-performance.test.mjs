import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const storeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
);
const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);
const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);
const streamHandlerSource = readSource(
  [joinFromRoot("src", "providers", "chat", "StreamEventHandler.ts")],
  "StreamEventHandler.ts",
);

test("reasoning deltas bypass full accumulated-buffer normalization", () => {
  assert.match(
    storeSource,
    /if \(delta\) \{\s*return \{\s*reasoning: appendStreamingReasoning\(current, incoming\)/s,
  );
  assert.match(
    storeSource,
    /mergeStreamingReasoning\(\s*state\.streaming\.reasoning,[\s\S]*?action\.payload\.delta/s,
  );
});

test("live duplicate-token checks use a bounded response suffix", () => {
  assert.match(
    handlerSource,
    /comparableTokens\(candidateContent\.slice\(-2048\)\)/,
  );
  assert.doesNotMatch(
    handlerSource,
    /const candidateTokens = comparableTokens\(candidateContent\);/,
  );
});

test("extension-host stream delivery is capped below token event frequency", () => {
  assert.match(
    providerSource,
    /STREAM_WEBVIEW_FLUSH_INTERVAL_MS = 50/,
  );
  assert.match(
    streamHandlerSource,
    /STREAM_WEBVIEW_FLUSH_INTERVAL_MS = 50/,
  );
  assert.match(
    streamHandlerSource,
    /MAX_STREAM_WEBVIEW_EVENTS_PER_BATCH = 8/,
  );
  assert.match(
    streamHandlerSource,
    /pendingEvents\.splice\(0, MAX_STREAM_WEBVIEW_EVENTS_PER_BATCH\)/,
  );
  assert.match(
    providerSource,
    /MAX_STREAM_WEBVIEW_EVENTS_PER_BATCH = 8/,
  );
  assert.match(
    providerSource,
    /pendingStreamWebviewEvents\.splice\(\s*0,\s*ChatViewProvider\.MAX_STREAM_WEBVIEW_EVENTS_PER_BATCH/s,
  );
  assert.match(
    providerSource,
    /STREAM_WEBVIEW_BACKLOG_YIELD_MS = 16/,
  );
  assert.doesNotMatch(
    providerSource,
    /flushStreamWebviewEvents\(true\)/,
    "immediate lifecycle events must not bypass the stream batch cap",
  );
});

test("webview appends a streamed raw-event batch with one tape reducer update", () => {
  assert.match(
    handlerSource,
    /const rawEventsBySessionId = new Map<string, unknown\[\]>\(\);/,
  );
  assert.match(
    handlerSource,
    /type: "APPEND_RAW_SDK_EVENT_PAYLOAD_BATCH"/,
  );
  assert.match(
    storeSource,
    /case "APPEND_RAW_SDK_EVENT_PAYLOAD_BATCH":/,
  );
});

test("host only mirrors live-only events into the client debug stream", () => {
  assert.match(
    providerSource,
    /eventType === "tui\.show"[\s\S]*?eventType === "tui\.toast\.show"[\s\S]*?eventType === "session\.status"[\s\S]*?enqueueLiveEventDebugEvent\(/,
  );
});

test("webview transport bounds oversized tool output without truncating persisted events", () => {
  assert.match(
    providerSource,
    /MAX_STREAM_WEBVIEW_TOOL_OUTPUT_CHARS = 16_384/,
  );
  assert.match(
    providerSource,
    /private buildWebviewStreamEvent\(/,
  );
  assert.match(
    providerSource,
    /const eventForWebview = this\.buildWebviewStreamEvent\(/,
  );
  assert.match(
    providerSource,
    /const centralizedEventPayload = \{\s*\.\.\.enrichedEvent,/s,
  );
});
