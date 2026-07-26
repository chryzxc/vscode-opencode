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
 * Note: StreamEventHandler previously buffered events in a `pendingEvents`
 * queue (risking unbounded growth under backpressure). That batching buffer
 * was removed during de-batching — `handleStreamEvent` now forwards each
 * event directly via postMessage, so there is no queue to bound. The guard
 * that asserted the cap has been removed accordingly.
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
