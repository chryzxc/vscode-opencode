import test from "node:test";
import assert from "node:assert/strict";

import {
  joinFromRoot,
  readSource,
} from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("implementation_plan turns do not use a legacy structured text fallback in the generic assistant response body", () => {
  assert.doesNotMatch(
    messageComponentsSource,
    /const structuredResponseMessage\s*=/,
    "generic assistant renderer should not keep a legacy structured text fallback outside the centralized chunk path",
  );

  assert.match(
    messageComponentsSource,
    /if \(orderedChunks\.length > 0\) \{\s*return orderedChunks;\s*\}/s,
    "assistant response renderer should still allow centralized assistant text chunks to render when they exist",
  );

  assert.match(
    messageComponentsSource,
    /const rawChunks = getCentralizedAssistantContentChunksFromRawSdkEventPayloads\(\s*responseBodyRawSdkEventPayloads,\s*\);[\s\S]*if \(rawChunks\.length > 0\) \{\s*return rawChunks;\s*\}/s,
    "assistant response fallback should prefer raw SDK assistant text extraction before snapshot content",
  );

  assert.match(
    messageComponentsSource,
    /function getRenderablePlanResponseChunks\(/,
    "implementation-plan response presentation should be centralized in a dedicated helper",
  );

  assert.match(
    messageComponentsSource,
    /const suppressAssistantChunksForPlanCard = shouldShowPlanCard;/,
    "implementation-plan response helper should suppress generic assistant chunks when the dedicated plan card is shown",
  );
});

test("centralized assistant content extractor skips structured implementation_plan tool text", () => {
  assert.match(
    messageHandlerSource,
    /const structuredType = firstNonEmptyString\([\s\S]*\?\.toLowerCase\(\);[\s\S]*if \(structuredType === "implementation_plan"\) \{\s*continue;\s*\}/s,
    "implementation_plan structured tool payloads should not be treated as generic assistant response text",
  );
});

test("centralized structured-output reader does not synthesize plan cards from fallback text fields", () => {
  assert.match(
    messageHandlerSource,
    /const structured = structuredOutputFromCentralizedEventPayload\([\s\S]*includeFallbackCandidate:\s*false[\s\S]*\);/s,
    "centralized raw structured-output extraction should rely on explicit structured channels only",
  );
});
