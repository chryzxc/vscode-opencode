import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readAllSources, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: several long-lived maps/sets in the streaming pipeline
 * accumulate entries without bound for the lifetime of the extension host.
 *
 *   1. ChatViewProvider.streamedSubtaskPartsBySessionId
 *      - set on every subtask part event
 *      - read via Array.from(...).some(...) (scan cost grows with size)
 *      - never cleared on session switch or terminal events
 *
 *   2. StructuredOutputProcessor.structuredValidationFailureCounters
 *      StructuredOutputProcessor.structuredOutputIncompatibleModelKeys
 *      - accumulation-only Map/Set with no eviction path
 *
 *   3. StreamEventHandler.pendingEvents
 *      - grows unbounded if upstream outpaces flush (e.g. large tool bursts)
 *
 * Contract: every long-lived collection on the stream hot path must either
 * (a) be cleared on session switch, (b) have per-entry delete on terminal
 * events, or (c) have an explicit hard cap with eviction.
 */

const chatViewProviderSource = readAllSources(
  [
    joinFromRoot("src", "providers", "ChatViewProvider.ts"),
    joinFromRoot("src", "providers", "chat", "SessionHandler.ts"),
  ],
  "ChatViewProvider.ts",
);
const structuredOutputSource = readSource(
  [joinFromRoot("src", "providers", "chat", "StructuredOutputProcessor.ts")],
  "StructuredOutputProcessor.ts",
);
const streamEventHandlerSource = readSource(
  [joinFromRoot("src", "providers", "chat", "StreamEventHandler.ts")],
  "StreamEventHandler.ts",
);

test("streamedSubtaskPartsBySessionId has an explicit cleanup path", () => {
  assert.match(
    chatViewProviderSource,
    /streamedSubtaskPartsBySessionId\.clear\(\)|streamedSubtaskPartsBySessionId\.delete\(/,
    "streamedSubtaskPartsBySessionId must have a clear() or delete() path so it does not grow unbounded across sessions",
  );
});

test("StructuredOutputProcessor diagnostic counters have an explicit cleanup path", () => {
  assert.match(
    structuredOutputSource,
    /structuredValidationFailureCounters\.(clear\(\)|delete\()/,
    "structuredValidationFailureCounters must be clearable so model-key growth is bounded",
  );
  assert.match(
    structuredOutputSource,
    /structuredOutputIncompatibleModelKeys\.(clear\(\)|delete\()/,
    "structuredOutputIncompatibleModelKeys must be clearable so model-key growth is bounded",
  );
});

test("StreamEventHandler bounds pendingEvents to prevent unbounded growth under backpressure", () => {
  assert.match(
    streamEventHandlerSource,
    /MAX_PENDING_EVENTS|MAX_PENDING_STREAM_EVENTS/,
    "StreamEventHandler should declare a max pending events cap constant",
  );

  // The cap must actually be enforced — when the queue exceeds the cap, the
  // handler must shed events (drop oldest, drop non-terminal, or otherwise
  // bound). Accept splice/shift/length-check patterns.
  assert.match(
    streamEventHandlerSource,
    /pendingEvents\.(splice|shift)\(|pendingEvents\.length\s*[<>]=\s*(?:this\.)?(?:MAX_PENDING|MAX_PENDING_EVENTS|MAX_PENDING_STREAM_EVENTS)/,
    "StreamEventHandler must actively shed events when pendingEvents exceeds the cap",
  );
});
