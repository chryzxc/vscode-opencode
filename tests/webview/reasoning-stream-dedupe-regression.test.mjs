import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const messageHandlerSource = readFileSync(
  new URL("../../webview/shared/src/chat/lib/messageHandler.ts", import.meta.url),
  "utf8",
);
const messageComponentsSource = readFileSync(
  new URL("../../webview/shared/src/chat/MessageComponents.tsx", import.meta.url),
  "utf8",
);

test("reasoning chunks are appended only once by the part-event handler", () => {
  const partHandler = messageHandlerSource.slice(
    messageHandlerSource.indexOf("case 'message.part.updated':"),
    messageHandlerSource.indexOf("case 'message.updated':"),
  );
  const explicitGuard = partHandler.slice(
    partHandler.indexOf("const hasExplicitReasoningOnlyChunk"),
    partHandler.indexOf("const isReasoningPart ="),
  );

  assert.doesNotMatch(
    explicitGuard,
    /type:\s*["']UPDATE_STREAMING_REASONING["']/,
    "explicit and embedded reasoning guards must classify the chunk without dispatching it before the canonical reasoning branch",
  );
});

test("final and streaming reasoning snapshots are deduplicated during normalization", () => {
  assert.match(
    messageHandlerSource,
    /function mergeReasoningEventSnapshots\(/,
    "normalization should merge reasoning snapshots through one dedupe helper",
  );
  assert.match(
    messageHandlerSource,
    /const mergedReasoningEvents = mergeReasoningEventSnapshots\(\s*existingReasoningEvents,\s*streaming\?\.reasoningEvents \?\? \[\],\s*\)/s,
    "the final and live reasoning arrays must not be concatenated directly",
  );
});

test("text and reasoning response parts do not become empty activity rows", () => {
  const rawPartProjector = messageComponentsSource.slice(
    messageComponentsSource.indexOf("function progressItemsFromRawResponseParts("),
    messageComponentsSource.indexOf("function progressItemsFromCentralizedData("),
  );

  for (const partType of ["reasoning", "thinking", "thought", "text", "message", "output_text"]) {
    assert.match(
      rawPartProjector,
      new RegExp(`partType === ["']${partType}["']`),
      `${partType} parts should stay in their response lane`,
    );
  }
});
