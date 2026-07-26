import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const handlerSource = readFileSync(
  new URL("../../webview/shared/src/chat/lib/messageHandler.ts", import.meta.url),
  "utf8",
);
const messageComponentsSource = readFileSync(
  new URL("../../webview/shared/src/chat/MessageComponents.tsx", import.meta.url),
  "utf8",
);

test("delta-bearing text never enters an assistant response body", () => {
  assert.match(
    handlerSource,
    /function isTextDeltaCentralizedEventPayload\([\s\S]*?part\?\.delta[\s\S]*?if \(isTextDeltaCentralizedEventPayload\(payload\)\) \{\s*continue;/s,
    "raw response extraction must exclude text parts with a delta field",
  );
  assert.match(
    messageComponentsSource,
    /function commentaryItemsFromRawEventPayloads\([\s\S]*?if \(isDeltaCentralizedEventPayload\(event\)\) continue;/s,
    "timeline commentary must exclude delta-bearing text parts",
  );
  assert.match(
    handlerSource,
    /const isReasoning =[\s\S]*?isRawDeltaTextField/s,
    "live text deltas must use the Thinking lane",
  );
  assert.match(
    handlerSource,
    /const isDeltaForActiveReasoningPart = Boolean\([\s\S]*?rawUpdatedDelta\.trim\(\)\.length > 0/s,
    "a later non-delta text snapshot must be able to leave the Thinking lane",
  );
  assert.match(
    handlerSource,
    /if \(isReasoning && reasoningPartID && !isRawDeltaTextField\)/,
    "the later non-delta response snapshot must not be suppressed by its delta precursor",
  );
  assert.match(
    handlerSource,
    /const isTextFieldDelta = Boolean\(asString\(payload\.delta\)\.trim\(\)\);[\s\S]*?const skipContentChunk =[\s\S]*?isTextFieldDelta[\s\S]*?eventPartType === "reasoning"[\s\S]*?isTextFieldDelta/s,
    "the normalized content-delta handler must not bypass the delta-to-Thinking rule",
  );
});
