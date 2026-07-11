import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("message-attached centralized payloads keep scoped events that lack explicit message ids", () => {
  const body = extractFunctionBody(
    source,
    "const centralizedRawSdkEventPayloads = useMemo(() => {",
  );

  assert.match(
    body,
    /const attachedPayloadsWithoutIds = messageAttachedRawSdkEventPayloads\.filter\(\(event\) =>\s*!extractSemanticEventMessageId\(event\),\s*\);/s,
    "message-attached payload selection should explicitly preserve already-scoped entries that do not expose messageID/messageId",
  );

  assert.match(
    body,
    /return \[\s*\.\.\.scopedAttachedPayloads,\s*(?:\.\.\.sessionScopedNoIdPayloads,\s*)?\.\.\.attachedPayloadsWithoutIds,\s*\];/s,
    "scoped attached payloads should merge in no-id entries instead of dropping them during assistant-scope filtering",
  );

  assert.match(
    body,
    /if \(messageSpecificEvents\.length > 0\) \{\s*return \[\s*\.\.\.messageSpecificEvents,\s*(?:\.\.\.sessionScopedNoIdPayloads,\s*)?\.\.\.attachedPayloadsWithoutIds,\s*\];\s*\}/s,
    "session-scoped message matches should still merge message-attached no-id payloads so the assistant response body cannot disappear during re-scoping",
  );
});

test("assistant cards keep assistant-like no-id centralized terminal payloads from the session tape", () => {
  assert.match(
    source,
    /function isAssistantScopedNoIdPayloadCandidate\(/,
    "MessageComponents should define a dedicated guard for assistant-like centralized payloads that have no explicit message id",
  );

  assert.match(
    source,
    /function extractSemanticEventMessageId\(event: unknown\): string \| null \{[\s\S]*fallbackId\.toLowerCase\(\)\.startsWith\("evt_"\)/,
    "assistant-card scoping should distinguish semantic message ids from wrapper evt_ ids before treating a payload as message-scoped",
  );

  assert.match(
    source,
    /wrapper event id such as `evt_\*`[\s\S]*NOT safe for[\s\S]*assistant-card scoping/s,
    "MessageComponents should document why wrapper evt_ ids must not be treated as semantic assistant message ids",
  );

  const body = extractFunctionBody(
    source,
    "const centralizedRawSdkEventPayloads = useMemo(() => {",
  );

  assert.match(
    body,
    /const sessionScopedNoIdPayloads = sessionScopedRawSdkEventPayloads\.filter\(\(event\) =>\s*isAssistantScopedNoIdPayloadCandidate\(event\),\s*\);/s,
    "assistant card scoping should preserve assistant-like no-id payloads from the session tape",
  );

  assert.match(
    body,
    /return \[\s*\.\.\.messageSpecificEvents,\s*\.\.\.sessionScopedNoIdPayloads,\s*\.\.\.attachedPayloadsWithoutIds,\s*\];/s,
    "message-specific centralized events should merge assistant-like no-id session payloads before attached no-id payloads",
  );
});

test("assistant cards keep no-id session metadata needed for header labels", () => {
  assert.match(
    source,
    /const isAssistantHeaderMetadataEvent =\s*eventType === "session\.next\.agent\.switched" \|\|\s*eventType === "session\.next\.model\.switched" \|\|\s*eventType === "session\.updated";/s,
    "assistant no-id payload guard should treat session-level agent/model updates as header metadata events",
  );

  assert.match(
    source,
    /const hasAssistantHeaderMetadata =\s*!!firstNonEmptyString\([\s\S]*info\?\.agent,[\s\S]*info\?\.providerID,[\s\S]*info\?\.modelID,[\s\S]*info\?\.variant,[\s\S]*\);/s,
    "assistant no-id payload guard should detect header metadata fields on session-scoped events",
  );

  assert.match(
    source,
    /\|\| \(isAssistantHeaderMetadataEvent && hasAssistantHeaderMetadata\);/s,
    "assistant no-id payload guard should preserve header metadata events even when they do not carry text or structured output",
  );

  assert.match(
    source,
    /level metadata rows like `session\.updated` and `session\.next\.\*` stop looking[\s\S]*top response header loses agent\/model\/[\s\S]*thinking labels after hydration/s,
    "MessageComponents should document the hydration regression that occurs when session metadata is mis-scoped",
  );
});
